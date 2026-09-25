#!/usr/bin/env bash
# Provision a Raspberry Pi (Debian 13) for ECO Label Studio. Runs as root on
# the Pi. Usually started by deploy/provision.sh from the Mac; can also be run
# directly on the Pi:
#
#   sudo deploy/provision-remote.sh [SRC_DIR]
#   deploy/provision-remote.sh --patch-health-only
#   deploy/provision-remote.sh --dirs-only
#
# SRC_DIR holds eco-studio.service, eco-studio-tls.service, eco-studio-tls.timer,
# eco-studio-tls and 50-eco-studio.rules, and defaults to this script's
# directory. --patch-health-only and --dirs-only run just that step, which makes
# them testable on any machine (with ECO_HEALTH_SCRIPT and ECO_PROVISION_ROOT
# pointing at scratch paths). Safe to re-run.
set -euo pipefail

# Test-only prefix for the directories ensure_dirs creates. Always empty on the Pi.
ROOT="${ECO_PROVISION_ROOT:-}"
SERVICE_USER=eco-studio
OPT_DIR="$ROOT/opt/eco-studio"
RELEASES_DIR="$OPT_DIR/releases"
CURRENT_DIR="$OPT_DIR/current"
DATA_DIR="$ROOT/var/lib/eco-studio"
# The patched LPrint driver writes page bitmaps here (only if it exists);
# eco-studio turns them into history previews and deletes them.
CAPTURE_DIR="$ROOT/var/spool/lprint-capture"
NODE_MAJOR_WANTED=24
HEALTH_MARKER='record_ok studio'
HEALTH_ANCHOR_RE='^# 4\. Keep a known-good copy'

export DEBIAN_FRONTEND=noninteractive

log() { printf '==> %s\n' "$*"; }
warn() { printf 'warning: %s\n' "$*" >&2; }
die() {
  printf 'error: %s\n' "$*" >&2
  exit 1
}

# Temp files to remove on exit (space-separated; paths never contain spaces).
TMP_FILES=""
cleanup() {
  if [[ -n "$TMP_FILES" ]]; then
    # shellcheck disable=SC2086 # intentional word splitting of the path list
    rm -f $TMP_FILES
  fi
}
trap cleanup EXIT

usage() {
  cat <<EOF
Usage: $(basename "$0") [SRC_DIR]
       $(basename "$0") --patch-health-only
       $(basename "$0") --dirs-only

Provision this Pi for ECO Label Studio (run as root). SRC_DIR defaults to the
directory containing this script.
EOF
}

# --- eco-printer-health patch ----------------------------------------------

health_block() {
  cat <<'EOF'
# Label Studio web app (added by eco-studio provision). Only checked once the
# service is enabled, so a half-provisioned Pi doesn't restart-loop it.
if systemctl is-enabled --quiet eco-studio 2>/dev/null; then
  if curl -fsk --max-time 10 https://127.0.0.1/api/health >/dev/null; then
    record_ok studio
  else
    record_fail studio 3 60 1800 systemctl restart eco-studio
  fi
fi
EOF
}

# Insert the studio check into eco-printer-health, right before the
# "# 4. Keep a known-good copy" section. Idempotent: does nothing if the
# marker is already present. Never fails provisioning: if the script is
# missing, has no anchor line, or the result doesn't parse, it warns and
# leaves the file untouched.
patch_health_script() {
  local target="${ECO_HEALTH_SCRIPT:-/usr/local/sbin/eco-printer-health}"
  local tmp backup

  if [[ ! -f "$target" ]]; then
    warn "$target not found; skipping health check patch"
    return 0
  fi
  if grep -qF "$HEALTH_MARKER" "$target"; then
    log "$target already has the studio check"
    return 0
  fi
  if ! grep -q "$HEALTH_ANCHOR_RE" "$target"; then
    warn "$target has no line matching '$HEALTH_ANCHOR_RE'; not patching it. Add the studio check by hand (see health_block in deploy/provision-remote.sh)."
    return 0
  fi

  tmp="$(mktemp "$(dirname "$target")/.eco-printer-health.XXXXXX")"
  TMP_FILES="$TMP_FILES $tmp"

  # The block goes in through ENVIRON rather than awk -v, because -v would
  # interpret backslash escapes and some awks reject newlines in -v values.
  # The regex is repeated literally here for the same reason; keep it in sync
  # with HEALTH_ANCHOR_RE.
  ECO_HEALTH_BLOCK="$(health_block)" awk '
    !done && /^# 4\. Keep a known-good copy/ {
      print ENVIRON["ECO_HEALTH_BLOCK"]
      print ""
      done = 1
    }
    { print }
  ' "$target" >"$tmp"

  if ! grep -qF "$HEALTH_MARKER" "$tmp"; then
    warn "awk did not insert the studio check; left $target unchanged"
    return 0
  fi
  if ! bash -n "$tmp"; then
    warn "patched health script fails bash -n; left $target unchanged"
    return 0
  fi

  backup="$target.bak-$(date -u +%Y%m%dT%H%M%SZ)"
  cp -p "$target" "$backup"
  chmod 0755 "$tmp"
  mv -f "$tmp" "$target"
  log "Added the studio check to $target (backup: $backup)"
}

# --- Full provisioning -------------------------------------------------------

apt_updated=0
apt_install() {
  if [[ $apt_updated -eq 0 ]]; then
    apt-get update
    apt_updated=1
  fi
  apt-get install -y "$@"
}

pkg_installed() {
  dpkg-query -W -f='${Status}' "$1" 2>/dev/null | grep -q 'install ok installed'
}

install_base_packages() {
  local missing=()
  pkg_installed ca-certificates || missing+=(ca-certificates)
  command -v curl >/dev/null 2>&1 || missing+=(curl)
  command -v gpg >/dev/null 2>&1 || missing+=(gnupg)
  command -v openssl >/dev/null 2>&1 || missing+=(openssl)
  # deploy.sh copies releases with rsync.
  command -v rsync >/dev/null 2>&1 || missing+=(rsync)
  if [[ ${#missing[@]} -gt 0 ]]; then
    log "Installing ${missing[*]}"
    apt_install "${missing[@]}"
  else
    log "Base packages present"
  fi
}

node_major() {
  local v=""
  if command -v node >/dev/null 2>&1; then
    v="$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || true)"
  fi
  if [[ "$v" =~ ^[0-9]+$ ]]; then echo "$v"; else echo 0; fi
}

install_node() {
  local major
  major="$(node_major)"
  if [[ "$major" -ge $NODE_MAJOR_WANTED ]]; then
    log "Node $(node --version) present"
    return 0
  fi

  log "Installing Node $NODE_MAJOR_WANTED from NodeSource (found major version: $major)"
  install -d -m 0755 /etc/apt/keyrings
  local keytmp=/etc/apt/keyrings/.nodesource.gpg.tmp
  TMP_FILES="$TMP_FILES $keytmp"
  curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key |
    gpg --dearmor --batch --yes -o "$keytmp"
  chmod 0644 "$keytmp"
  mv -f "$keytmp" /etc/apt/keyrings/nodesource.gpg

  cat >/etc/apt/sources.list.d/nodesource.sources <<EOF
Types: deb
URIs: https://deb.nodesource.com/node_${NODE_MAJOR_WANTED}.x
Suites: nodistro
Components: main
Architectures: $(dpkg --print-architecture)
Signed-By: /etc/apt/keyrings/nodesource.gpg
EOF

  # Without this pin, Debian's own (older) nodejs package can win.
  cat >/etc/apt/preferences.d/nodesource <<'EOF'
Package: nodejs
Pin: origin deb.nodesource.com
Pin-Priority: 600
EOF

  apt-get update
  apt_updated=1
  apt-get install -y nodejs

  major="$(node_major)"
  [[ "$major" -ge $NODE_MAJOR_WANTED ]] ||
    die "Node $NODE_MAJOR_WANTED+ required but found major version $major after install; check 'apt-cache policy nodejs'"
  log "Installed Node $(node --version)"
}

ensure_user() {
  if id -u "$SERVICE_USER" >/dev/null 2>&1; then
    log "User $SERVICE_USER exists"
  else
    log "Creating system user $SERVICE_USER"
    useradd --system --home-dir "$DATA_DIR" --no-create-home \
      --shell /usr/sbin/nologin --user-group "$SERVICE_USER"
  fi
  # The app reads its own logs with journalctl.
  usermod -aG systemd-journal "$SERVICE_USER"
}

ensure_dirs() {
  mkdir -p "$RELEASES_DIR" "$DATA_DIR" "$CAPTURE_DIR"
  chown root:root "$OPT_DIR" "$RELEASES_DIR"
  chmod 0755 "$OPT_DIR" "$RELEASES_DIR"
  chown "$SERVICE_USER:$SERVICE_USER" "$DATA_DIR"
  chmod 0750 "$DATA_DIR"
  # LPrint (root) writes captures; setgid keeps them in group eco-studio, which
  # can read and delete them. Nobody else can list the directory.
  chown "root:$SERVICE_USER" "$CAPTURE_DIR"
  chmod 2770 "$CAPTURE_DIR"
  log "Directories ready: $RELEASES_DIR, $DATA_DIR, $CAPTURE_DIR"
}

install_files() {
  local src=$1 f
  for f in eco-studio.service eco-studio-tls.service eco-studio-tls.timer eco-studio-tls 50-eco-studio.rules; do
    [[ -f "$src/$f" ]] || die "missing $src/$f"
  done

  for f in eco-studio.service eco-studio-tls.service eco-studio-tls.timer; do
    install -m 0644 -o root -g root "$src/$f" "/etc/systemd/system/$f"
  done
  install -m 0755 -o root -g root "$src/eco-studio-tls" /usr/local/sbin/eco-studio-tls
  log "Installed eco-studio.service, eco-studio-tls.service and eco-studio-tls.timer in /etc/systemd/system, and /usr/local/sbin/eco-studio-tls"

  if [[ ! -x /usr/lib/polkit-1/polkitd ]]; then
    log "Installing polkitd"
    apt_install polkitd
  fi
  # Only create the directory if missing; the polkitd package may own it with
  # its own mode.
  [[ -d /etc/polkit-1/rules.d ]] || install -d -m 0755 /etc/polkit-1/rules.d
  install -m 0644 -o root -g root "$src/50-eco-studio.rules" /etc/polkit-1/rules.d/50-eco-studio.rules
  # polkitd watches rules.d and reloads on its own; this is belt and braces.
  systemctl try-reload-or-restart polkit || warn "could not reload polkit"
  log "Installed /etc/polkit-1/rules.d/50-eco-studio.rules"
}

enable_service() {
  systemctl daemon-reload
  systemctl enable eco-studio.service
  systemctl enable --now eco-studio-tls.timer
  log "Enabled eco-studio.service and eco-studio-tls.timer"
  if [[ -f "$CURRENT_DIR/server/dist/main.js" ]]; then
    log "Restarting eco-studio"
    systemctl restart eco-studio || warn "eco-studio failed to restart; see journalctl -u eco-studio"
  else
    log "No release deployed yet; run deploy/deploy.sh"
  fi
}

summary() {
  echo
  echo "Summary"
  echo "  node:    $(node --version)"
  echo "  user:    $(id "$SERVICE_USER")"
  echo "  enabled: $(systemctl is-enabled eco-studio 2>/dev/null || true)"
  echo "  active:  $(systemctl is-active eco-studio 2>/dev/null || true)"
  echo "  tls timer: $(systemctl is-enabled eco-studio-tls.timer 2>/dev/null || true)"
}

main() {
  local src_dir=""
  case "${1:-}" in
    -h | --help)
      usage
      return 0
      ;;
    --patch-health-only)
      patch_health_script
      return
      ;;
    --dirs-only)
      ensure_dirs
      return
      ;;
    -*)
      usage >&2
      return 2
      ;;
  esac
  src_dir="${1:-$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)}"

  [[ $EUID -eq 0 ]] || die "must run as root (sudo $0)"
  [[ -d "$src_dir" ]] || die "source dir $src_dir not found"

  install_base_packages
  install_node
  ensure_user
  ensure_dirs
  install_files "$src_dir"
  # Enable first: the health check only looks at eco-studio once it is enabled,
  # and a failed patch must not leave the service disabled.
  enable_service
  patch_health_script
  summary
}

main "$@"
