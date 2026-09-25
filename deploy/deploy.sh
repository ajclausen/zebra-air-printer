#!/usr/bin/env bash
# Build ECO Label Studio and deploy it to the Pi as a new release. Run on the
# Mac from anywhere:
#
#   deploy/deploy.sh [--skip-build] [HOST]    (default HOST: ajclausen@192.168.51.242)
#   npm run deploy -- [--skip-build] [HOST]
#
# Each deploy goes to /opt/eco-studio/releases/<UTC timestamp> and
# /opt/eco-studio/current is switched to it. If the health check fails, the
# symlink is switched back to the previous release.
set -euo pipefail

DEFAULT_HOST="ajclausen@192.168.51.242"

usage() {
  cat <<EOF
Usage: $(basename "$0") [--skip-build] [HOST]

Build the app and deploy it to HOST (default $DEFAULT_HOST).
  --skip-build   deploy the existing build output without running npm run build
EOF
}

log() { printf '==> %s\n' "$*"; }
die() {
  printf 'error: %s\n' "$*" >&2
  exit 1
}

SKIP_BUILD=0
HOST=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --skip-build) SKIP_BUILD=1 ;;
    -h | --help)
      usage
      exit 0
      ;;
    -*)
      usage >&2
      exit 2
      ;;
    *)
      [[ -z "$HOST" ]] || {
        usage >&2
        exit 2
      }
      HOST="$1"
      ;;
  esac
  shift
done
HOST="${HOST:-$DEFAULT_HOST}"

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

command -v rsync >/dev/null 2>&1 || die "rsync not found (brew install rsync)"
command -v npm >/dev/null 2>&1 || die "npm not found"

if [[ $SKIP_BUILD -eq 0 ]]; then
  log "Building (npm run build)"
  npm run build
fi

for f in server/dist/main.js shared/dist/index.js web/dist/index.html package-lock.json; do
  [[ -f "$f" ]] || die "missing $REPO_ROOT/$f; run npm install and npm run build first"
done

RELEASE="$(date -u +%Y%m%dT%H%M%SZ)"
REMOTE_STAGE="/tmp/eco-studio-release-$RELEASE"
STAGE="$(mktemp -d "${TMPDIR:-/tmp}/eco-studio-stage.XXXXXX")"
UPLOADED=0
ACTIVATED=0

cleanup() {
  rm -rf "$STAGE"
  # If the remote step failed before moving the upload into place, remove it
  # from /tmp. After the move this is a no-op.
  if [[ $UPLOADED -eq 1 && $ACTIVATED -eq 0 ]]; then
    # shellcheck disable=SC2029 # expanding the fixed-format path locally is intended
    ssh "$HOST" "rm -rf -- '$REMOTE_STAGE'" 2>/dev/null || true
  fi
}
trap cleanup EXIT

log "Staging release $RELEASE"
mkdir -p "$STAGE/shared" "$STAGE/server" "$STAGE/web"
cp package.json package-lock.json "$STAGE/"
# Every workspace listed in the root package.json needs its package.json for
# npm ci, including web, whose runtime deps are not installed on the Pi.
# Source maps are kept on purpose: they make stack traces readable.
for ws in shared server web; do
  cp "$ws/package.json" "$STAGE/$ws/"
  rsync -a "$ws/dist/" "$STAGE/$ws/dist/"
done

log "Uploading to $HOST:$REMOTE_STAGE"
UPLOADED=1
rsync -az --delete "$STAGE/" "$HOST:$REMOTE_STAGE/"

# Runs as root on the Pi. Quoted heredoc: nothing in it expands locally.
# read -d '' (instead of $(cat <<...)) avoids bash 3.2 misparsing quotes inside
# a heredoc nested in command substitution; macOS still ships bash 3.2.
# read returns 1 at end of input, hence || true.
IFS= read -r -d '' REMOTE_SCRIPT <<'REMOTE' || true
set -euo pipefail

RELEASE="${1:-}"
BASE=/opt/eco-studio
KEEP=5

log() { printf '==> %s\n' "$*"; }
die() { printf 'error: %s\n' "$*" >&2; exit 1; }

[[ "$RELEASE" =~ ^[0-9]{8}T[0-9]{6}Z$ ]] || die "invalid release name '$RELEASE'"
STAGED="/tmp/eco-studio-release-$RELEASE"
DEST="$BASE/releases/$RELEASE"

[[ -d "$BASE/releases" ]] || die "$BASE/releases not found; run deploy/provision.sh first"
[[ -d "$STAGED" ]] || die "staged release $STAGED not found"
[[ ! -e "$DEST" ]] || die "$DEST already exists"

mv "$STAGED" "$DEST"
chown -R root:root "$DEST"
chmod -R go-w "$DEST"

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
chmod -R go-w "$DEST"

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
deadline=$((SECONDS + 30))
while ((SECONDS < deadline)); do
  if HEALTH="$(curl -fsk --max-time 3 https://127.0.0.1/api/health)"; then
    break
  fi
  HEALTH=""
  sleep 1
done

if [[ -z "$HEALTH" ]]; then
  echo "Health check failed. Last 50 journal lines:" >&2
  journalctl -u eco-studio -n 50 --no-pager -o short-iso >&2 || true
  if [[ -n "$PREV" && -d "$PREV" && "$PREV" != "$DEST_REAL" ]]; then
    switch_to "$PREV"
    systemctl restart eco-studio || true
    die "Deploy failed; rolled back to $PREV"
  fi
  die "Deploy failed and there is no previous release to roll back to; $RELEASE is still current"
fi

# Keep the newest $KEEP releases (names sort by time) plus whatever current
# points to. Ignore anything that doesn't look like a release.
CURRENT_REAL="$(readlink -f "$BASE/current")"
n=0
while IFS= read -r name; do
  [[ "$name" =~ ^[0-9]{8}T[0-9]{6}Z$ ]] || continue
  n=$((n + 1))
  ((n > KEEP)) || continue
  dir="$BASE/releases/$name"
  [[ "$(readlink -f "$dir")" != "$CURRENT_REAL" ]] || continue
  log "Removing old release $name"
  rm -rf -- "$dir"
done < <(find "$BASE/releases" -mindepth 1 -maxdepth 1 -type d -printf '%f\n' | LC_ALL=C sort -r)

echo "$HEALTH"
log "Deployed release $RELEASE"
REMOTE

log "Activating release on $HOST (sudo may ask for your password)"
# The script travels base64-encoded on the command line rather than on stdin:
# sudo needs the terminal from ssh -t for its password prompt, and a script fed
# through stdin would be consumed by that prompt. base64 output is shell-safe.
ENCODED="$(printf '%s' "$REMOTE_SCRIPT" | base64 | tr -d '\n')"
ssh -t "$HOST" "sudo bash -c \"\$(echo $ENCODED | base64 -d)\" eco-studio-deploy $RELEASE"
ACTIVATED=1

log "Done: $RELEASE on $HOST"
