#!/usr/bin/env bash
# Activate an uploaded ECO Label Studio release. Runs as root on the Pi.
#
#   deploy-remote.sh RELEASE
#
# deploy.sh uploads the release to /tmp/eco-studio-release-RELEASE, then ships
# this script base64-encoded over ssh and runs it with sudo. Steps:
#   1. move the upload to /opt/eco-studio/releases/RELEASE and install
#      production dependencies,
#   2. back up the database (VACUUM INTO) and record its user_version,
#   3. switch /opt/eco-studio/current, restart eco-studio, poll /api/health,
#   4. on failure roll back the symlink, and restore the database if the new
#      release changed its schema version,
#   5. on success prune old releases and backups.
#
# The ECO_DEPLOY_* variables exist only for deploy/test/run.sh. sudo resets
# the environment, so a real deploy always uses the defaults.
set -euo pipefail

RELEASE="${1:-}"
BASE="${ECO_DEPLOY_BASE:-/opt/eco-studio}"
DATA_DIR="${ECO_DEPLOY_DATA_DIR:-/var/lib/eco-studio}"
STAGE_PREFIX="${ECO_DEPLOY_STAGE_PREFIX:-/tmp/eco-studio-release-}"
HEALTH_TIMEOUT="${ECO_DEPLOY_HEALTH_TIMEOUT:-30}"
SERVICE_USER=eco-studio
KEEP_RELEASES=5
KEEP_BACKUPS=5
RELEASE_RE='^[0-9]{8}T[0-9]{6}Z$'

log() { printf '==> %s\n' "$*"; }
die() {
  printf 'error: %s\n' "$*" >&2
  exit 1
}

[[ "$RELEASE" =~ $RELEASE_RE ]] || die "invalid release name '$RELEASE'"
STAGED="$STAGE_PREFIX$RELEASE"
DEST="$BASE/releases/$RELEASE"
DB="$DATA_DIR/studio.db"
BACKUP_DIR="$DATA_DIR/backups"

[[ -d "$BASE/releases" ]] || die "$BASE/releases not found; run deploy/provision.sh first"
[[ -d "$STAGED" ]] || die "staged release $STAGED not found"
[[ ! -e "$DEST" ]] || die "$DEST already exists"

# Node one-liners for the database. With node -e, process.argv[1] is the first
# argument after the script. node:sqlite prints an experimental warning on
# some Node versions, hence --no-warnings.
JS_BACKUP='const {DatabaseSync} = require("node:sqlite");
const [src, dst] = process.argv.slice(1);
const db = new DatabaseSync(src);
db.prepare("VACUUM INTO ?").run(dst);
db.close();'
JS_USER_VERSION='const {DatabaseSync} = require("node:sqlite");
const db = new DatabaseSync(process.argv[1]);
console.log(db.prepare("PRAGMA user_version").get().user_version);
db.close();'

# Run as the service user so SQLite's -wal/-shm files keep the right owner.
as_service_user() {
  runuser -u "$SERVICE_USER" -- "$@"
}

db_user_version() {
  as_service_user node --no-warnings -e "$JS_USER_VERSION" "$1"
}

# Entry names in a directory, newest first. Release and backup names embed a
# UTC timestamp, so reverse name order is newest first.
newest_first() {
  local p names=() i
  for p in "$1"/*; do
    if [[ -e "$p" ]]; then names+=("${p##*/}"); fi
  done
  i=${#names[@]}
  while ((i > 0)); do
    i=$((i - 1))
    printf '%s\n' "${names[$i]}"
  done
}

# --- 1. Install the release --------------------------------------------------

mv "$STAGED" "$DEST"
chown -R root:root "$DEST"
# Readable and traversable by eco-studio, writable only by root.
chmod -R u=rwX,go=rX "$DEST"

log "Installing production dependencies in $DEST"
cd "$DEST"
# Files end up root-owned and read-only to the service user, which is intended.
export HOME=/root
export npm_config_cache=/root/.npm

check_shared() {
  (cd server && node --input-type=module -e "await import('@eco/shared')")
}

if npm ci --omit=dev --workspace=@eco/server --include-workspace-root=false --no-audit --no-fund &&
  check_shared; then
  :
else
  log "Workspace-scoped npm ci failed or @eco/shared did not resolve; retrying with a full npm ci"
  npm ci --omit=dev --no-audit --no-fund
  check_shared || die "@eco/shared still does not resolve from server/ after full npm ci"
fi
chmod -R u=rwX,go=rX "$DEST"

# --- 2. Back up the database -------------------------------------------------

BACKUP=""
BACKUP_VERSION=""
if [[ -f "$DB" ]]; then
  mkdir -p "$BACKUP_DIR"
  chown "$SERVICE_USER:$SERVICE_USER" "$BACKUP_DIR"
  chmod 0750 "$BACKUP_DIR"
  BACKUP="$BACKUP_DIR/studio-$RELEASE.db"
  rm -f "$BACKUP" # VACUUM INTO refuses to overwrite
  # VACUUM INTO writes a consistent snapshot, including WAL contents, while
  # the app keeps running.
  as_service_user node --no-warnings -e "$JS_BACKUP" "$DB" "$BACKUP" ||
    die "database backup to $BACKUP failed; not switching releases"
  BACKUP_VERSION="$(db_user_version "$BACKUP")" ||
    die "could not read user_version from $BACKUP; not switching releases"
  log "Backed up $DB to $BACKUP (user_version $BACKUP_VERSION)"

  n=0
  while IFS= read -r f; do
    [[ "$f" =~ ^studio-[0-9]{8}T[0-9]{6}Z\.db$ ]] || continue
    n=$((n + 1))
    if ((n > KEEP_BACKUPS)); then
      log "Removing old backup $f"
      rm -f -- "$BACKUP_DIR/$f"
    fi
  done < <(newest_first "$BACKUP_DIR")
else
  log "No database at $DB yet; skipping backup"
fi

# --- 3. Switch and check -----------------------------------------------------

# Only a symlink counts as a previous release. readlink -f on a missing path
# would print the path itself.
PREV=""
if [[ -L "$BASE/current" ]]; then
  PREV="$(readlink -f "$BASE/current" || true)"
fi
DEST_REAL="$(readlink -f "$DEST")"

# Build the new link beside the old one, then rename over it: the rename is
# atomic, so current never points nowhere.
switch_to() {
  ln -sfn "$1" "$BASE/current.new"
  mv -T "$BASE/current.new" "$BASE/current"
}

log "Switching $BASE/current to $RELEASE"
switch_to "$DEST"
systemctl restart eco-studio

log "Waiting for https://127.0.0.1/api/health"
HEALTH=""
deadline=$((SECONDS + HEALTH_TIMEOUT))
while ((SECONDS < deadline)); do
  if HEALTH="$(curl -fsk --max-time 3 https://127.0.0.1/api/health)"; then
    break
  fi
  HEALTH=""
  sleep 1
done

# --- 4. Roll back on failure -------------------------------------------------

if [[ -z "$HEALTH" ]]; then
  echo "Health check failed. Last 50 journal lines:" >&2
  journalctl -u eco-studio -n 50 --no-pager -o short-iso >&2 || true

  if [[ -z "$PREV" || ! -d "$PREV" || "$PREV" == "$DEST_REAL" ]]; then
    die "Deploy failed and there is no previous release to roll back to; $RELEASE is still current"
  fi

  restore_db=0
  if [[ -n "$BACKUP" ]]; then
    live_version="$(db_user_version "$DB" 2>/dev/null || echo unreadable)"
    if [[ "$live_version" != "$BACKUP_VERSION" ]]; then
      log "Database user_version is now $live_version, was $BACKUP_VERSION; restoring $BACKUP"
      restore_db=1
    fi
  fi

  # From here on, keep going on errors: the symlink must go back even if the
  # database restore fails.
  if [[ $restore_db -eq 1 ]]; then
    systemctl stop eco-studio || true
    if cp "$BACKUP" "$DB.restore-tmp" && mv -f "$DB.restore-tmp" "$DB"; then
      rm -f "$DB-wal" "$DB-shm"
      chown "$SERVICE_USER:$SERVICE_USER" "$DB" || true
    else
      printf 'error: restoring %s failed; restore it by hand (see deploy/README.md)\n' "$BACKUP" >&2
    fi
    switch_to "$PREV"
    systemctl start eco-studio || true
  else
    switch_to "$PREV"
    systemctl restart eco-studio || true
  fi
  die "Deploy failed; rolled back to $PREV"
fi

# --- 5. Prune old releases ---------------------------------------------------

# Keep the newest releases (names sort by time) plus whatever current points
# to. Ignore anything that doesn't look like a release.
CURRENT_REAL="$(readlink -f "$BASE/current")"
n=0
while IFS= read -r name; do
  [[ "$name" =~ $RELEASE_RE ]] || continue
  dir="$BASE/releases/$name"
  [[ -d "$dir" && ! -L "$dir" ]] || continue
  n=$((n + 1))
  ((n > KEEP_RELEASES)) || continue
  [[ "$(readlink -f "$dir")" != "$CURRENT_REAL" ]] || continue
  log "Removing old release $name"
  rm -rf -- "$dir"
done < <(newest_first "$BASE/releases")

echo "$HEALTH"
log "Deployed release $RELEASE"
