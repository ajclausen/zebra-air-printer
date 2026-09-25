# Deploying ECO Label Studio

ECO Label Studio runs on the Raspberry Pi `eco-printer` (Debian 13, arm64) as the systemd service `eco-studio`. It serves HTTPS on port 443 and HTTP on port 80. HTTP redirects to HTTPS, except `/ca.crt` and `/api/health`.

## Prerequisites

- ssh access to the Pi (default `ajclausen@192.168.51.242`), ideally with a key.
- sudo on the Pi. The scripts prompt for the password.
- On the Mac: Node 24 or newer, npm, and rsync.

Both scripts take the host as an optional argument, for example `deploy/deploy.sh pi@10.0.0.7`.

## Provision

```sh
deploy/provision.sh [HOST]
```

Run this once per Pi, and again whenever a file in `deploy/` other than `deploy.sh` changes. It is safe to re-run. It copies the unit file, the TLS script, the polkit rule and `provision-remote.sh` to a temp dir on the Pi, then runs `provision-remote.sh` there as root. That script:

1. Installs `ca-certificates`, `curl`, `gnupg`, `openssl` and `rsync` if any are missing.
2. Installs Node 24 from NodeSource if `node` is missing or older than 24, and pins `nodejs` to NodeSource so Debian's older package does not replace it.
3. Creates the system user `eco-studio` and adds it to `systemd-journal`.
4. Creates `/opt/eco-studio/releases` and `/var/lib/eco-studio`.
5. Installs the unit, the TLS script and the polkit rule, and installs `polkitd` if it is missing.
6. Adds the `studio` check to `/usr/local/sbin/eco-printer-health` (see below).
7. Enables `eco-studio`. It restarts the service if a release is already deployed. Otherwise it prints "No release deployed yet; run deploy/deploy.sh".

On the Pi you can also run it directly: `sudo deploy/provision-remote.sh [SRC_DIR]`.

## Deploy

```sh
npm run deploy                     # or: npm run deploy -- [--skip-build] [HOST]
deploy/deploy.sh [--skip-build] [HOST]
```

A deploy does the following:

1. Runs `npm run build` at the repo root, unless you pass `--skip-build`.
2. Stages the root `package.json` and `package-lock.json`, plus `package.json` and `dist/` for `shared`, `server` and `web`, then rsyncs them to `/tmp/eco-studio-release-<ts>` on the Pi. `<ts>` is a UTC timestamp such as `20260925T191250Z`. Source maps are included so stack traces stay readable.
3. On the Pi, as root: moves the upload to `/opt/eco-studio/releases/<ts>` and runs `npm ci --omit=dev` for `@eco/server` only. If that fails, it falls back to a full `npm ci --omit=dev`. It then checks that `@eco/shared` resolves from `server/`.
4. Points `/opt/eco-studio/current` at the new release (atomic rename) and restarts `eco-studio`.
5. Polls `https://127.0.0.1/api/health` for up to 30 seconds.

If the health check passes, the deploy prints the health JSON and deletes old releases, keeping the five newest plus whatever `current` points to.

If it fails, the deploy prints the last 50 journal lines, points `current` back at the previous release, restarts the service and exits with an error. The failed release directory stays on disk so you can inspect it, and it counts toward the five kept releases. If there is no previous release, nothing is rolled back and the failed release stays current.

## Manual rollback

```sh
ls /opt/eco-studio/releases
readlink -f /opt/eco-studio/current
sudo ln -sfn /opt/eco-studio/releases/<ts> /opt/eco-studio/current.new
sudo mv -T /opt/eco-studio/current.new /opt/eco-studio/current
sudo systemctl restart eco-studio
```

## Where things live

| What | Path |
| --- | --- |
| Releases | `/opt/eco-studio/releases/<ts>` |
| Active release | `/opt/eco-studio/current` (symlink) |
| Data | `/var/lib/eco-studio` |
| Database | `/var/lib/eco-studio/studio.db` (SQLite, WAL mode, so also `-wal` and `-shm` files) |
| Print images | `/var/lib/eco-studio/prints/<historyId>/<n>.png` |
| TLS files | `/var/lib/eco-studio/tls/` |
| Logs | `journalctl -u eco-studio` |
| Unit | `/etc/systemd/system/eco-studio.service` |
| Polkit rule | `/etc/polkit-1/rules.d/50-eco-studio.rules` |
| TLS script | `/usr/local/sbin/eco-studio-tls` |
| Health counters | `/run/eco-printer-health/studio` |

The service runs as `eco-studio`, and only `/var/lib/eco-studio` is writable to it. Release files are owned by root. The polkit rule lets `eco-studio` restart `lprint`, `avahi-daemon` and `eco-studio` and reboot the Pi. It allows nothing else.

## TLS

`/usr/local/sbin/eco-studio-tls` runs as root before every service start (`ExecStartPre=+`). It maintains two things in `/var/lib/eco-studio/tls`:

- A local CA: `ca.key` and `ca.crt`, EC P-256, valid for 10 years, subject "ECO Label Studio Local CA". It is created once and never replaced automatically.
- A server certificate signed by that CA: `server.key` and `leaf.crt`, plus `server.crt`, which is the leaf followed by the CA certificate. It is valid for 825 days, the maximum Apple devices accept. It covers `eco-printer.local`, `eco-printer`, `localhost`, `127.0.0.1` and every global IPv4 address the Pi has at the time. Those addresses are recorded in `leaf-ips.txt`.

The server certificate is re-issued when any of its files are missing, when it expires within 30 days, when the Pi's IPv4 addresses differ from `leaf-ips.txt`, or when the CA is new. The check runs on every service start, so a restart picks up a new IP address.

- Force a re-issue: `sudo rm /var/lib/eco-studio/tls/server.crt && sudo systemctl restart eco-studio`.
- Reload certificates without a restart: run `sudo /usr/local/sbin/eco-studio-tls`, then `sudo systemctl reload eco-studio`. Reload sends SIGHUP, and the server re-reads its certificate and key.
- If you delete `ca.key` or `ca.crt`, a new CA is created on the next start, and every device has to trust the new CA.

## Trusting the CA

Download the CA certificate from `http://eco-printer.local/ca.crt`, then install it on each device:

- **macOS:** Open the file to add it to Keychain Access. Double-click "ECO Label Studio Local CA", expand Trust, and set "When using this certificate" to Always Trust. From a terminal you can instead run `sudo security add-trusted-cert -d -r trustRoot -k /Library/Keychains/System.keychain ca.crt`.
- **iOS and iPadOS:** Open the URL in Safari and allow the profile download. Install it under Settings > General > VPN & Device Management. Then turn on full trust for the CA under Settings > General > About > Certificate Trust Settings.
- **Windows:** Double-click `ca.crt` and choose Install Certificate > Local Machine > "Place all certificates in the following store" > Trusted Root Certification Authorities. From an elevated prompt you can instead run `certutil -addstore -f Root ca.crt`.
- **Firefox:** Firefox keeps its own certificate store and ignores the system one unless `security.enterprise_roots.enabled` is on. Import the CA in Firefox's settings or turn that option on.
- **Android:** Settings > Security > Encryption & credentials > Install a certificate > CA certificate.

## Health check

Provisioning adds a `studio` check to `/usr/local/sbin/eco-printer-health`, just before the "Keep a known-good copy" section. The original script is backed up as `eco-printer-health.bak-<ts>`. The check only runs when `eco-studio` is enabled. It calls `https://127.0.0.1/api/health`, and after 3 consecutive failures it restarts `eco-studio`. Further restarts back off from 60 seconds up to 30 minutes. Its counters are in `/run/eco-printer-health/studio`.

To test the patch step without a Pi: `ECO_HEALTH_SCRIPT=/path/to/copy deploy/provision-remote.sh --patch-health-only`.
