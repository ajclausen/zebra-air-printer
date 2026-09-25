#!/usr/bin/env bash
# Local tests for the deploy/ scripts. Runs on macOS (bash 3.2) and Linux, needs
# node (for node:sqlite and the polkit rule), openssl, rsync 3.x, and perl.
# Nothing here touches the Pi or needs root: system commands are replaced by
# the fakes in deploy/test/fakes.
#
#   deploy/test/run.sh
set -euo pipefail

TEST_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEPLOY_DIR="$(cd "$TEST_DIR/.." && pwd)"
FAKES="$TEST_DIR/fakes"
TMP_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/eco-deploy-test.XXXXXX")"
trap 'rm -rf "$TMP_ROOT"' EXIT

PASSED=0
FAILED=0
section() { printf '\n## %s\n' "$*"; }
pass() {
  PASSED=$((PASSED + 1))
  printf '  ok    %s\n' "$*"
}
fail() {
  FAILED=$((FAILED + 1))
  printf '  FAIL  %s\n' "$*"
}
check() { # check DESCRIPTION COMMAND...
  local desc=$1
  shift
  if "$@"; then pass "$desc"; else fail "$desc"; fi
}
file_contains() { grep -qF -- "$2" "$1"; }
file_lacks() { ! grep -qF -- "$2" "$1"; }
checksum() { cksum <"$1"; }

# Directories must be r-x and files r-- for "other" (the eco-studio user), and
# nothing may be writable by group or other.
tree_world_readable() {
  local root=$1
  [[ -z "$(find "$root" -type d ! -perm -0555 -print -quit)" ]] &&
    [[ -z "$(find "$root" -type f ! -perm -0444 -print -quit)" ]] &&
    [[ -z "$(find "$root" \( -perm -0020 -o -perm -0002 \) ! -type l -print -quit)" ]]
}

# --- Static checks -------------------------------------------------------------

section "syntax"
for script in deploy.sh deploy-remote.sh provision.sh provision-remote.sh eco-studio-tls test/run.sh; do
  check "bash -n $script" bash -n "$DEPLOY_DIR/$script"
done
for fake in "$FAKES"/remote/* "$FAKES"/tls/*; do
  check "sh -n fakes/${fake#"$FAKES"/}" sh -n "$fake"
done

# --- 1. Release permissions ------------------------------------------------------

section "release permissions (umask 077)"
REPO="$TMP_ROOT/repo"
(
  umask 077
  mkdir -p "$REPO/deploy"
  cp "$DEPLOY_DIR/deploy.sh" "$DEPLOY_DIR/deploy-remote.sh" "$REPO/deploy/"
  echo '{}' >"$REPO/package.json"
  echo '{}' >"$REPO/package-lock.json"
  for ws in shared server web; do
    mkdir -p "$REPO/$ws/dist/nested/deeper"
    echo '{}' >"$REPO/$ws/package.json"
    echo 'x' >"$REPO/$ws/dist/nested/deeper/file.js"
  done
  touch "$REPO/server/dist/main.js" "$REPO/shared/dist/index.js" "$REPO/web/dist/index.html"
)
STAGED_OUT="$TMP_ROOT/staged"
if (umask 077 && bash "$REPO/deploy/deploy.sh" --skip-build --stage-to "$STAGED_OUT") >"$TMP_ROOT/stage.log" 2>&1; then
  pass "deploy.sh --stage-to succeeds"
else
  fail "deploy.sh --stage-to succeeds"
  cat "$TMP_ROOT/stage.log"
fi
check "staged tree is traversable and readable by other users" tree_world_readable "$STAGED_OUT"
check "staged tree has the release layout" test -f "$STAGED_OUT/server/dist/main.js" -a -f "$STAGED_OUT/web/package.json" -a -f "$STAGED_OUT/package-lock.json"
check "no stray files (node_modules, src) in staged tree" test -z "$(find "$STAGED_OUT" -name node_modules -o -name src | head -1)"

# The same chmod deploy-remote.sh applies on the Pi fixes a 0700/0600 tree.
LOCKED="$TMP_ROOT/locked"
(
  umask 077
  mkdir -p "$LOCKED/a/b"
  echo x >"$LOCKED/a/b/f"
  chmod 0700 "$LOCKED/a/b/f"
)
chmod -R u=rwX,go=rX "$LOCKED"
check "chmod -R u=rwX,go=rX makes a umask-077 tree readable" tree_world_readable "$LOCKED"
check "chmod keeps an executable file executable" test -x "$LOCKED/a/b/f"

# --- 5. Health check patch (real eco-printer-health as fixture) -----------------

section "eco-printer-health patch"
HEALTH="$TMP_ROOT/health/eco-printer-health"
mkdir -p "$(dirname "$HEALTH")"
cp "$TEST_DIR/fixtures/eco-printer-health" "$HEALTH"
chmod 0755 "$HEALTH"
ANCHOR='# 4. Keep a known-good copy of the LPrint config for eco-printer-prestart.'
check "fixture has the real anchor line" file_contains "$HEALTH" "$ANCHOR"

patch() { ECO_HEALTH_SCRIPT="$1" bash "$DEPLOY_DIR/provision-remote.sh" --patch-health-only; }

if patch "$HEALTH" >"$TMP_ROOT/patch1.log" 2>&1; then pass "first patch exits 0"; else fail "first patch exits 0"; fi
check "studio check inserted" file_contains "$HEALTH" "record_fail studio 3 60 1800 systemctl restart eco-studio"
check "patched script passes bash -n" bash -n "$HEALTH"
check "patched script keeps mode 0755" test -x "$HEALTH"
# The block ends right before the anchor, separated by one blank line.
before_anchor="$(awk -v a="$ANCHOR" '$0 == a { print prev2 "|" prev1; exit } { prev2 = prev1; prev1 = $0 }' "$HEALTH")"
check "block sits directly before the anchor" test "$before_anchor" = "fi|"
check "anchor appears once" test "$(grep -cF "$ANCHOR" "$HEALTH")" = 1
check "backup written" test -n "$(find "$(dirname "$HEALTH")" -name 'eco-printer-health.bak-*' -print -quit)"
sum1="$(checksum "$HEALTH")"
patch "$HEALTH" >"$TMP_ROOT/patch2.log" 2>&1
check "second patch is a no-op" test "$sum1" = "$(checksum "$HEALTH")"
check "second patch says so" file_contains "$TMP_ROOT/patch2.log" "already has the studio check"

NOANCHOR="$TMP_ROOT/health/no-anchor"
grep -vF "$ANCHOR" "$TEST_DIR/fixtures/eco-printer-health" >"$NOANCHOR"
sum_na="$(checksum "$NOANCHOR")"
if patch "$NOANCHOR" >"$TMP_ROOT/patch3.log" 2>&1; then pass "missing anchor is not fatal (exit 0)"; else fail "missing anchor is not fatal (exit 0)"; fi
check "missing anchor warns" file_contains "$TMP_ROOT/patch3.log" "warning:"
check "file without anchor is untouched" test "$sum_na" = "$(checksum "$NOANCHOR")"
if patch "$TMP_ROOT/health/missing" >/dev/null 2>&1; then pass "missing health script is not fatal"; else fail "missing health script is not fatal"; fi

# Run the inserted block with the real record_* helpers from the fixture, the
# real `now` logic, and fake systemctl/curl, to check its behaviour.
HB="$TMP_ROOT/hb"
mkdir -p "$HB/bin" "$HB/state"
cat >"$HB/bin/systemctl" <<'EOF'
#!/bin/sh
echo "systemctl $*" >>"$HB/calls"
if [ "$1" = is-enabled ]; then [ -f "$HB/enabled" ]; exit $?; fi
exit 0
EOF
cat >"$HB/bin/curl" <<'EOF'
#!/bin/sh
echo "curl $*" >>"$HB/calls"
[ -f "$HB/healthy" ]
EOF
chmod +x "$HB/bin/systemctl" "$HB/bin/curl"
{
  echo 'set -u'
  echo "STATE='$HB/state'"
  # shellcheck disable=SC2016 # written literally into the generated script
  echo 'now=$(date +%s)'
  echo 'log() { echo "eco-printer-health: $*"; }'
  # Helpers from the real script: read_state .. record_ok.
  awk '/^read_state\(\)/,/^# 1\./' "$HEALTH" | sed '$d'
  # The inserted block.
  awk '/^# Label Studio web app/,/^# 4\./' "$HEALTH" | sed '$d'
} >"$HB/check.sh"
export HB # the fake systemctl/curl read it
run_block() { PATH="$HB/bin:$PATH" bash "$HB/check.sh" >>"$HB/out" 2>&1; }

run_block
check "disabled service: no health probe" file_lacks "$HB/calls" "curl"
touch "$HB/enabled"
run_block
run_block
check "two failures: counter 2, no restart yet" test "$(cut -d' ' -f1 "$HB/state/studio")" = 2
check "two failures: no restart yet" file_lacks "$HB/calls" "systemctl restart eco-studio"
run_block
check "third failure restarts eco-studio" file_contains "$HB/calls" "systemctl restart eco-studio"
check "probe uses curl -fsk against /api/health" file_contains "$HB/calls" "curl -fsk --max-time 10 https://127.0.0.1/api/health"
touch "$HB/healthy"
run_block
check "recovery resets the counter" test "$(cat "$HB/state/studio")" = "0 0 0"

# --- Directories and capture spool ---------------------------------------------------

section "provision directories"
PROV="$TMP_ROOT/prov"
mkdir -p "$PROV"
provision_dirs() {
  SIM="$PROV" ECO_PROVISION_ROOT="$PROV/root" PATH="$FAKES/remote:$PATH" \
    bash "$DEPLOY_DIR/provision-remote.sh" --dirs-only
}
if provision_dirs >"$PROV/dirs1.log" 2>&1; then pass "--dirs-only succeeds"; else fail "--dirs-only succeeds"; cat "$PROV/dirs1.log"; fi
if provision_dirs >"$PROV/dirs2.log" 2>&1; then pass "--dirs-only is idempotent"; else fail "--dirs-only is idempotent"; fi
CAP="$PROV/root/var/spool/lprint-capture"
mode_of() { stat -f '%Lp' "$1" 2>/dev/null || stat -c '%a' "$1"; }
# macOS drops the setgid bit for non-root users outside the directory's group,
# so check the permission bits on disk and the setgid request in the script.
check "capture dir is group rwx, no access for others" test "$(mode_of "$CAP")" = 770
# shellcheck disable=SC2016 # literal text searched for in the script
check "capture dir is made setgid (2770)" file_contains "$DEPLOY_DIR/provision-remote.sh" 'chmod 2770 "$CAPTURE_DIR"'
check "capture dir owned root:eco-studio" file_contains "$PROV/chown.log" "chown root:eco-studio $CAP"
check "data dir owned eco-studio" file_contains "$PROV/chown.log" "chown eco-studio:eco-studio $PROV/root/var/lib/eco-studio"
check "releases dir is 0755" test "$(mode_of "$PROV/root/opt/eco-studio/releases")" = 755
check "unit can write the capture dir (optional path)" file_contains "$DEPLOY_DIR/eco-studio.service" "ReadWritePaths=/var/lib/eco-studio -/var/spool/lprint-capture"
check "unit points the app at the capture dir" file_contains "$DEPLOY_DIR/eco-studio.service" "Environment=ECO_CAPTURE_DIR=/var/spool/lprint-capture"

# --- 6. TLS script ---------------------------------------------------------------

section "eco-studio-tls"
REAL_OPENSSL="$(command -v openssl)"
TLS="$TMP_ROOT/tls"
tls() {
  ECO_TLS_DIR="$TLS" ECO_TLS_OWNER="$(id -un)" ECO_TEST_REAL_OPENSSL="$REAL_OPENSSL" \
    FAKE_SYSTEMCTL_LOG="$TMP_ROOT/tls-systemctl.log" PATH="$FAKES/tls:$PATH" \
    bash "$DEPLOY_DIR/eco-studio-tls" "$@"
}
fp() { openssl x509 -in "$1" -noout -fingerprint -sha256; }
pair_matches() {
  [[ "$(openssl pkey -in "$TLS/server.key" -pubout)" == "$(openssl x509 -in "$TLS/server.crt" -noout -pubkey)" ]]
}
leaf_verifies() { openssl verify -CAfile "$TLS/ca.crt" "$TLS/leaf.crt" >/dev/null 2>&1; }

if tls >"$TMP_ROOT/tls1.log" 2>&1; then pass "first run exits 0"; else fail "first run exits 0"; fi
check "first run creates CA, leaf, chain, key" test -s "$TLS/ca.crt" -a -s "$TLS/ca.key" -a -s "$TLS/server.crt" -a -s "$TLS/server.key" -a -s "$TLS/leaf.crt"
check "leaf verifies against the CA" leaf_verifies
check "server.crt holds leaf + CA" test "$(grep -c 'BEGIN CERTIFICATE' "$TLS/server.crt")" = 2
check "server.key matches server.crt" pair_matches
check "key files are 0600" test -z "$(find "$TLS" -name '*.key' ! -perm 0600 -print -quit)"
tls >"$TMP_ROOT/tls2.log" 2>&1
check "second run does nothing" file_contains "$TMP_ROOT/tls2.log" "nothing to do"

FAKE_IPS="192.168.51.242 169.254.3.3 127.0.1.1 10.0.0.5 fe80::1" tls >"$TMP_ROOT/tls-ips.log" 2>&1
check "IP change re-issues with global IPv4 SANs only" test "$(cat "$TLS/leaf-ips.txt")" = "10.0.0.5,192.168.51.242"
check "SAN includes the LAN address" sh -c "openssl x509 -in '$TLS/leaf.crt' -noout -ext subjectAltName | grep -q '192.168.51.242'"

# --reload: only when the leaf changed and eco-studio is active.
: >"$TMP_ROOT/tls-systemctl.log"
FAKE_IPS="10.0.0.5 192.168.51.242" FAKE_ACTIVE=1 tls --reload >/dev/null 2>&1
check "--reload with nothing issued does not reload" file_lacks "$TMP_ROOT/tls-systemctl.log" "reload"
rm -f "$TLS/leaf-ips.txt"
FAKE_ACTIVE=1 tls --reload >/dev/null 2>&1
check "--reload after issuing reloads eco-studio" file_contains "$TMP_ROOT/tls-systemctl.log" "reload eco-studio"
: >"$TMP_ROOT/tls-systemctl.log"
rm -f "$TLS/leaf-ips.txt"
FAKE_ACTIVE=0 tls --reload >/dev/null 2>&1
check "--reload skips an inactive service" file_lacks "$TMP_ROOT/tls-systemctl.log" "reload eco-studio"

# CA within 30 days of expiry: replaced loudly, leaf re-issued under the new CA.
old_ca="$(fp "$TLS/ca.crt")"
openssl req -x509 -new -key "$TLS/ca.key" -days 5 -subj "/CN=ECO Label Studio Local CA" -out "$TLS/ca.crt" 2>/dev/null
if tls >"$TMP_ROOT/tls-expiring.log" 2>&1; then pass "expiring CA: exit 0"; else fail "expiring CA: exit 0"; fi
check "expiring CA: loud replacement warning" file_contains "$TMP_ROOT/tls-expiring.log" "REPLACING THE LOCAL CA"
check "expiring CA: new CA" test "$old_ca" != "$(fp "$TLS/ca.crt")"
check "expiring CA: old CA kept aside" test -n "$(find "$TLS" -name 'ca.crt.replaced-*' -print -quit)"
check "expiring CA: leaf verifies against new CA" leaf_verifies
check "expiring CA: pair matches" pair_matches

# CA key that doesn't match the CA certificate.
old_ca="$(fp "$TLS/ca.crt")"
openssl genpkey -algorithm EC -pkeyopt ec_paramgen_curve:P-256 -out "$TLS/ca.key" 2>/dev/null
sleep 1 # distinct .replaced-<timestamp> names
if tls >"$TMP_ROOT/tls-mismatch.log" 2>&1; then pass "mismatched CA key: exit 0"; else fail "mismatched CA key: exit 0"; fi
check "mismatched CA key: reported" file_contains "$TMP_ROOT/tls-mismatch.log" "ca.key does not match ca.crt"
check "mismatched CA key: new CA and valid leaf" sh -c "test '$old_ca' != \"\$(openssl x509 -in '$TLS/ca.crt' -noout -fingerprint -sha256)\" && openssl verify -CAfile '$TLS/ca.crt' '$TLS/leaf.crt' >/dev/null 2>&1"

# Signing fails but a usable pair exists: keep it, exit 0.
rm -f "$TLS/leaf-ips.txt"
crt_before="$(checksum "$TLS/server.crt")"
if ECO_TEST_FAIL_SIGN=1 tls >"$TMP_ROOT/tls-signfail.log" 2>&1; then pass "signing fails with usable pair: exit 0"; else fail "signing fails with usable pair: exit 0"; fi
check "signing fails with usable pair: warns" file_contains "$TMP_ROOT/tls-signfail.log" "keeping the existing server certificate"
check "signing fails with usable pair: pair unchanged" test "$crt_before" = "$(checksum "$TLS/server.crt")"
check "signing fails with usable pair: no work dirs left" test -z "$(find "$TLS" -name '.work.*' -print -quit)"

# Verification fails after issuing: the new leaf is not installed.
rm -f "$TLS/leaf-ips.txt"
if ECO_TEST_FAIL_VERIFY=1 tls >"$TMP_ROOT/tls-verifyfail.log" 2>&1; then pass "verify fails with usable pair: exit 0"; else fail "verify fails with usable pair: exit 0"; fi
check "verify fails with usable pair: pair unchanged" test "$crt_before" = "$(checksum "$TLS/server.crt")"
check "verify fails with usable pair: pair still matches" pair_matches

# Signing fails and nothing usable exists: non-zero so the failure is visible.
rm -f "$TLS/server.crt" "$TLS/server.key" "$TLS/leaf.crt"
if ECO_TEST_FAIL_SIGN=1 tls >"$TMP_ROOT/tls-nopair.log" 2>&1; then fail "signing fails without a pair: non-zero exit"; else pass "signing fails without a pair: non-zero exit"; fi
check "signing fails without a pair: explains" file_contains "$TMP_ROOT/tls-nopair.log" "no usable server.crt/server.key pair"

# A mismatched existing pair is repaired.
openssl genpkey -algorithm EC -pkeyopt ec_paramgen_curve:P-256 -out "$TLS/server.key" 2>/dev/null
tls >/dev/null 2>&1 || true
check "recovers: issues a fresh matching pair" pair_matches

# --- 7. deploy-remote.sh: DB backup, rollback, restore, pruning ------------------

section "deploy-remote.sh"
SIM="$TMP_ROOT/sim"
export SIM
mkdir -p "$SIM/opt/eco-studio/releases" "$SIM/data" "$SIM/stage"
node --no-warnings -e '
  const { DatabaseSync } = require("node:sqlite");
  const db = new DatabaseSync(process.argv[1]);
  db.exec("PRAGMA journal_mode = WAL; CREATE TABLE t (id INTEGER PRIMARY KEY, note TEXT); PRAGMA user_version = 1;");
  db.prepare("INSERT INTO t (note) VALUES (?)").run("original");
  db.close();' "$SIM/data/studio.db"

db_q() { # db_q SQL -> first column of first row
  node --no-warnings -e '
    const { DatabaseSync } = require("node:sqlite");
    const db = new DatabaseSync(process.argv[1], { readOnly: true });
    const row = db.prepare(process.argv[2]).get();
    console.log(row ? Object.values(row)[0] : "");' "$1" "$2"
}

stage_release() { # stage_release NAME: a minimal release uploaded with umask 077
  (
    umask 077
    local d="$SIM/stage/eco-studio-release-$1"
    mkdir -p "$d/shared/dist" "$d/server/dist"
    echo '{"name":"@eco/shared","type":"module","main":"./dist/index.js"}' >"$d/shared/package.json"
    echo 'export const ok = true;' >"$d/shared/dist/index.js"
    echo '{"name":"@eco/server","type":"module"}' >"$d/server/package.json"
    echo '' >"$d/server/dist/main.js"
  )
}

deploy_remote() { # deploy_remote RELEASE
  stage_release "$1"
  ECO_DEPLOY_BASE="$SIM/opt/eco-studio" ECO_DEPLOY_DATA_DIR="$SIM/data" \
    ECO_DEPLOY_STAGE_PREFIX="$SIM/stage/eco-studio-release-" ECO_DEPLOY_HEALTH_TIMEOUT=2 \
    PATH="$FAKES/remote:$PATH" bash "$DEPLOY_DIR/deploy-remote.sh" "$1"
}
current_release() { basename "$(readlink "$SIM/opt/eco-studio/current")"; }

R1=20260101T000001Z
if deploy_remote $R1 >"$SIM/d1.log" 2>&1; then pass "first deploy succeeds"; else fail "first deploy succeeds"; cat "$SIM/d1.log"; fi
check "current points at the first release" test "$(current_release)" = $R1
check "release dir is readable by the service user" tree_world_readable "$SIM/opt/eco-studio/releases/$R1"
check "backup written before switching" test -s "$SIM/data/backups/studio-$R1.db"
check "backup has user_version 1" test "$(db_q "$SIM/data/backups/studio-$R1.db" 'PRAGMA user_version')" = 1
check "backup has the original row" test "$(db_q "$SIM/data/backups/studio-$R1.db" "SELECT note FROM t WHERE id = 1")" = original

# A release whose migration bumps user_version and then fails health: the
# symlink and the database both go back.
R2=20260101T000002Z
touch "$SIM/MIGRATE" "$SIM/FAIL_HEALTH"
: >"$SIM/systemctl.log"
if deploy_remote $R2 >"$SIM/d2.log" 2>&1; then fail "migrating deploy with failed health exits non-zero"; else pass "migrating deploy with failed health exits non-zero"; fi
rm -f "$SIM/MIGRATE" "$SIM/FAIL_HEALTH"
check "rolled back to the previous release" test "$(current_release)" = $R1
check "reports the rollback" file_contains "$SIM/d2.log" "rolled back to"
check "restores the database" file_contains "$SIM/d2.log" "restoring"
check "backup of the pre-deploy state includes WAL contents" test "$(db_q "$SIM/data/backups/studio-$R2.db" "SELECT COUNT(*) FROM t WHERE note = 'started $R1'")" = 1
check "service stopped before restore and started after" sh -c "grep -n '' '$SIM/systemctl.log' | grep -E ':(stop|start) eco-studio' | tr '\n' ' ' | grep -q 'stop eco-studio.*start eco-studio'"
check "restored database has user_version 1" test "$(db_q "$SIM/data/studio.db" 'PRAGMA user_version')" = 1
check "restored database lacks the failed release's row" test "$(db_q "$SIM/data/studio.db" "SELECT COUNT(*) FROM t WHERE note = 'started $R2'")" = 0

# Failed health without a schema change: roll back the code only.
R3=20260101T000003Z
touch "$SIM/FAIL_HEALTH"
if deploy_remote $R3 >"$SIM/d3.log" 2>&1; then fail "failed health exits non-zero"; else pass "failed health exits non-zero"; fi
rm -f "$SIM/FAIL_HEALTH"
check "rolled back to the previous release again" test "$(current_release)" = $R1
check "no restore when user_version is unchanged" file_lacks "$SIM/d3.log" "restoring"

# A failed backup stops the deploy before anything is switched or restarted.
R4=20260101T000004Z
touch "$SIM/FAIL_RUNUSER"
: >"$SIM/systemctl.log"
if deploy_remote $R4 >"$SIM/d4.log" 2>&1; then fail "failed backup exits non-zero"; else pass "failed backup exits non-zero"; fi
rm -f "$SIM/FAIL_RUNUSER"
check "failed backup: current unchanged" test "$(current_release)" = $R1
check "failed backup: service untouched" test ! -s "$SIM/systemctl.log"
check "failed backup: explains" file_contains "$SIM/d4.log" "not switching releases"
rm -rf "${SIM:?}/opt/eco-studio/releases/$R4"

# More good deploys: 5 releases and 5 backups remain, other directories stay.
mkdir -p "$SIM/opt/eco-studio/releases/not-a-release"
for i in 5 6 7 8 9; do
  deploy_remote "20260101T00000${i}Z" >"$SIM/d$i.log" 2>&1 || {
    fail "deploy $i"
    cat "$SIM/d$i.log"
  }
done
check "current is the newest release" test "$(current_release)" = 20260101T000009Z
check "keeps 5 releases" test "$(find "$SIM/opt/eco-studio/releases" -mindepth 1 -maxdepth 1 -type d -name '2026*' | wc -l | tr -d ' ')" = 5
check "pruning ignores non-release directories" test -d "$SIM/opt/eco-studio/releases/not-a-release"
check "keeps 5 backups" test "$(find "$SIM/data/backups" -name 'studio-*.db' | wc -l | tr -d ' ')" = 5
check "rejects a bad release name" sh -c "! ECO_DEPLOY_BASE='$SIM/opt/eco-studio' bash '$DEPLOY_DIR/deploy-remote.sh' '2026;id' >/dev/null 2>&1"

# Stop the stand-in app.
PATH="$FAKES/remote:$PATH" systemctl stop eco-studio >/dev/null 2>&1 || true

# --- 14. polkit rule --------------------------------------------------------------

section "polkit rule"
if node - "$DEPLOY_DIR/50-eco-studio.rules" <<'EOF'; then pass "polkit cases"; else fail "polkit cases"; fi
const fs = require('node:fs');
let rule;
const polkit = { Result: { YES: 'yes' }, addRule: (fn) => { rule = fn; } };
new Function('polkit', fs.readFileSync(process.argv[2], 'utf8'))(polkit);
const action = (id, unit, verb) => ({ id, lookup: (k) => ({ unit, verb })[k] });
const cases = [
  ['eco-studio', 'org.freedesktop.systemd1.manage-units', 'lprint.service', 'restart', 'yes'],
  ['eco-studio', 'org.freedesktop.systemd1.manage-units', 'avahi-daemon.service', 'restart', 'yes'],
  ['eco-studio', 'org.freedesktop.systemd1.manage-units', 'eco-studio.service', 'restart', 'yes'],
  ['eco-studio', 'org.freedesktop.systemd1.manage-units', 'lprint.service', 'stop', undefined],
  ['eco-studio', 'org.freedesktop.systemd1.manage-units', 'ssh.service', 'restart', undefined],
  ['eco-studio', 'org.freedesktop.login1.reboot', null, null, 'yes'],
  ['eco-studio', 'org.freedesktop.login1.reboot-multiple-sessions', null, null, 'yes'],
  ['eco-studio', 'org.freedesktop.login1.reboot-ignore-inhibit', null, null, 'yes'],
  ['eco-studio', 'org.freedesktop.login1.power-off', null, null, undefined],
  ['eco-studio', 'org.freedesktop.systemd1.manage-unit-files', 'lprint.service', 'enable', undefined],
  ['someone', 'org.freedesktop.login1.reboot', null, null, undefined],
  ['someone', 'org.freedesktop.systemd1.manage-units', 'lprint.service', 'restart', undefined],
];
let bad = 0;
for (const [user, id, unit, verb, want] of cases) {
  const got = rule(action(id, unit, verb), { user });
  if (got !== want) { bad++; console.error(`  ${user} ${id} ${unit} ${verb}: got ${got}, want ${want}`); }
}
const src = fs.readFileSync(process.argv[2], 'utf8').replace(/\/\/.*$/gm, '');
if (/\b(let|const)\b|=>/.test(src)) { bad++; console.error('  rule uses non-ES5 syntax'); }
process.exit(bad ? 1 : 0);
EOF

# --- Summary -----------------------------------------------------------------------

printf '\n%d passed, %d failed\n' "$PASSED" "$FAILED"
[[ $FAILED -eq 0 ]]
