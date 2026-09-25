#!/usr/bin/env bash
# Provision the Pi for ECO Label Studio. Run on the Mac:
#
#   deploy/provision.sh [HOST]      (default HOST: ajclausen@192.168.51.242)
#
# Copies the unit, TLS helper, polkit rule and provision-remote.sh to a temp
# dir on the host and runs provision-remote.sh there with sudo. Safe to re-run.
set -euo pipefail

DEFAULT_HOST="ajclausen@192.168.51.242"

usage() {
  cat <<EOF
Usage: $(basename "$0") [HOST]

Provision the Pi for ECO Label Studio over ssh. HOST defaults to $DEFAULT_HOST.
Prompts for the sudo password on the host. Safe to re-run.
EOF
}

case "${1:-}" in
  -h | --help)
    usage
    exit 0
    ;;
  -*)
    usage >&2
    exit 2
    ;;
esac
[[ $# -le 1 ]] || {
  usage >&2
  exit 2
}

HOST="${1:-$DEFAULT_HOST}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
FILES=(eco-studio.service eco-studio-tls 50-eco-studio.rules provision-remote.sh)

log() { printf '==> %s\n' "$*"; }
die() {
  printf 'error: %s\n' "$*" >&2
  exit 1
}

for f in "${FILES[@]}"; do
  [[ -f "$SCRIPT_DIR/$f" ]] || die "missing $SCRIPT_DIR/$f"
done

log "Creating temp dir on $HOST"
REMOTE_TMP="$(ssh "$HOST" mktemp -d)"
# The path is interpolated into remote shell commands below, so accept only a
# plain absolute path.
[[ "$REMOTE_TMP" =~ ^/[A-Za-z0-9._/-]+$ ]] || die "unexpected temp dir from remote mktemp: '$REMOTE_TMP'"

cleanup() {
  # shellcheck disable=SC2029 # expanding the validated path locally is intended
  ssh "$HOST" "rm -rf -- '$REMOTE_TMP'" || printf 'warning: could not remove %s on %s\n' "$REMOTE_TMP" "$HOST" >&2
}
trap cleanup EXIT

log "Copying provisioning files to $HOST:$REMOTE_TMP"
paths=()
for f in "${FILES[@]}"; do
  paths+=("$SCRIPT_DIR/$f")
done
scp -q "${paths[@]}" "$HOST:$REMOTE_TMP/"

log "Running provision-remote.sh on $HOST (sudo may ask for your password)"
# -t gives sudo a terminal for the password prompt.
ssh -t "$HOST" "sudo bash '$REMOTE_TMP/provision-remote.sh' '$REMOTE_TMP'"

log "Provisioning finished"
