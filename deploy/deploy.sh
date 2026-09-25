#!/usr/bin/env bash
# Build ECO Label Studio and deploy it to the Pi as a new release. Run on the
# Mac from anywhere:
#
#   deploy/deploy.sh [--skip-build] [HOST]    (default HOST: ajclausen@192.168.51.242)
#   npm run deploy -- [--skip-build] [HOST]
#
# Each deploy goes to /opt/eco-studio/releases/<UTC timestamp> and
# /opt/eco-studio/current is switched to it. The activation steps on the Pi
# (dependency install, database backup, health check, rollback) are in
# deploy-remote.sh.
#
# --stage-to DIR stages the release and copies it to a local DIR with the same
# rsync flags as the upload, then exits. deploy/test/run.sh uses it.
set -euo pipefail

DEFAULT_HOST="ajclausen@192.168.51.242"

usage() {
  cat <<EOF
Usage: $(basename "$0") [--skip-build] [HOST]
       $(basename "$0") [--skip-build] --stage-to DIR

Build the app and deploy it to HOST (default $DEFAULT_HOST).
  --skip-build     deploy the existing build output without running npm run build
  --stage-to DIR   stage the release into local DIR instead of deploying (for tests)
EOF
}

log() { printf '==> %s\n' "$*"; }
die() {
  printf 'error: %s\n' "$*" >&2
  exit 1
}

SKIP_BUILD=0
HOST=""
STAGE_TO=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --skip-build) SKIP_BUILD=1 ;;
    --stage-to)
      [[ $# -ge 2 ]] || {
        usage >&2
        exit 2
      }
      STAGE_TO="$2"
      shift
      ;;
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

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

command -v rsync >/dev/null 2>&1 || die "rsync not found (brew install rsync)"
command -v npm >/dev/null 2>&1 || die "npm not found"
[[ -f "$SCRIPT_DIR/deploy-remote.sh" ]] || die "missing $SCRIPT_DIR/deploy-remote.sh"

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
# mktemp -d creates 0700, and rsync would carry that to the Pi, where the
# eco-studio user could not enter the release.
chmod 755 "$STAGE"
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

# Fixed modes regardless of the local umask. Nothing in a release needs +x:
# node runs server/dist/main.js.
# shellcheck disable=SC2054 # the comma is part of rsync's --chmod value
RSYNC_FLAGS=(-az --delete --chmod=D755,F644)

if [[ -n "$STAGE_TO" ]]; then
  rsync "${RSYNC_FLAGS[@]}" "$STAGE/" "$STAGE_TO/"
  log "Staged release $RELEASE in $STAGE_TO"
  exit 0
fi

log "Uploading to $HOST:$REMOTE_STAGE"
UPLOADED=1
rsync "${RSYNC_FLAGS[@]}" "$STAGE/" "$HOST:$REMOTE_STAGE/"

log "Activating release on $HOST (sudo may ask for your password)"
# deploy-remote.sh travels base64-encoded on the command line rather than on
# stdin: sudo needs the terminal from ssh -t for its password prompt, and a
# script fed through stdin would be consumed by that prompt. base64 output is
# shell-safe.
ENCODED="$(base64 <"$SCRIPT_DIR/deploy-remote.sh" | tr -d '\n')"
ssh -t "$HOST" "sudo bash -c \"\$(echo $ENCODED | base64 -d)\" eco-studio-deploy $RELEASE"
ACTIVATED=1

log "Done: $RELEASE on $HOST"
