# Deploying ECO Label Studio

ECO Label Studio runs on the Raspberry Pi `eco-printer` (Debian 13, arm64) as the systemd service `eco-studio`. It serves HTTPS on port 443 and HTTP on port 80. HTTP redirects to HTTPS, except `/ca.crt` and `/api/health`.

## Prerequisites

- ssh access to the Pi (default `ajclausen@192.168.51.242`), ideally with a key.
- sudo on the Pi. The scripts prompt for the password.
- On the Mac: Node 24 or newer, npm, and rsync 3.x (`brew install rsync`). deploy.sh uses `rsync --chmod`.

Both scripts take the host as an optional argument, for example `deploy/deploy.sh pi@10.0.0.7`.

## Provision

```sh
deploy/provision.sh [HOST]
```

Run this once per Pi, and again whenever a file in `deploy/` other than `deploy.sh` and `deploy-remote.sh` changes. It is safe to re-run. It copies the unit files, the TLS script, the polkit rule and `provision-remote.sh` to a temp dir on the Pi, then runs `provision-remote.sh` there as root. That script:

1. Installs `ca-certificates`, `curl`, `gnupg`, `openssl` and `rsync` if any are missing.
2. Installs Node 24 from NodeSource if `node` is missing or older than 24, and pins `nodejs` to NodeSource so Debian's older package does not replace it.
3. Creates the system user `eco-studio` and adds it to `systemd-journal`.
4. Creates `/opt/eco-studio/releases`, `/var/lib/eco-studio`, and the LPrint page-capture directory `/var/spool/lprint-capture` (`root:eco-studio`, mode `2770`; setgid so captures belong to group `eco-studio`). The patched LPrint driver only writes captures when that directory exists (see `deploy/patches/`).
5. Installs `eco-studio.service`, `eco-studio-tls.service`, `eco-studio-tls.timer`, the TLS script and the polkit rule, and installs `polkitd` if it is missing.
6. Enables `eco-studio` and enables and starts `eco-studio-tls.timer`. It restarts `eco-studio` if a release is already deployed. Otherwise it prints "No release deployed yet; run deploy/deploy.sh".
7. Adds the `studio` check to `/usr/local/sbin/eco-printer-health` (see below). If that fails, it prints a warning and provisioning still succeeds.

On the Pi you can also run it directly: `sudo deploy/provision-remote.sh [SRC_DIR]`.

## Deploy

```sh
npm run deploy                     # or: npm run deploy -- [--skip-build] [HOST]
deploy/deploy.sh [--skip-build] [HOST]
```

A deploy does the following:

1. Runs `npm run build` at the repo root, unless you pass `--skip-build`.
2. Stages the root `package.json` and `package-lock.json`, plus `package.json` and `dist/` for `shared`, `server` and `web`, then rsyncs them to `/tmp/eco-studio-release-<ts>` on the Pi. `<ts>` is a UTC timestamp such as `20260925T191250Z`. Source maps are included so stack traces stay readable. Directories are uploaded as 755 and files as 644, whatever your local umask.
3. On the Pi, `deploy-remote.sh` runs as root. It moves the upload to `/opt/eco-studio/releases/<ts>`, makes it root-owned and read-only for everyone else (`u=rwX,go=rX`), and runs `npm ci --omit=dev` for `@eco/server` only. If that fails, it falls back to a full `npm ci --omit=dev`. It then checks that `@eco/shared` resolves from `server/`.
4. If `/var/lib/eco-studio/studio.db` exists, it backs it up to `/var/lib/eco-studio/backups/studio-<ts>.db` and records the backup's `PRAGMA user_version` (the schema version). If the backup fails, the deploy stops here and the running release is not touched.
5. Points `/opt/eco-studio/current` at the new release (atomic rename) and restarts `eco-studio`.
6. Polls `https://127.0.0.1/api/health` for up to 30 seconds.

If the health check passes, the deploy prints the health JSON and deletes old releases, keeping the five newest plus whatever `current` points to.

If it fails, the deploy prints the last 50 journal lines and points `current` back at the previous release. If the new release changed the database's `user_version`, for example by running a migration, it also restores the backup: it stops `eco-studio`, copies the backup over `studio.db`, deletes `studio.db-wal` and `studio.db-shm`, and starts the service on the previous release. Anything written to the database between the switch and the rollback is lost in that case. If `user_version` did not change, the database is left alone and the service is restarted. The deploy then exits with an error. The failed release directory stays on disk so you can inspect it, and it counts toward the five kept releases. If there is no previous release, nothing is rolled back and the failed release stays current.

## Database backups

Every deploy that finds a database writes a backup before switching releases:
`/var/lib/eco-studio/backups/studio-<ts>.db`, where `<ts>` is the release it was taken for. The five newest are kept. Backups are made with SQLite's `VACUUM INTO` while the app runs, so they are consistent and include data still in the WAL. The directory is owned by `eco-studio` with mode 0750.

To restore one by hand:

```sh
sudo systemctl stop eco-studio
sudo cp /var/lib/eco-studio/backups/studio-<ts>.db /var/lib/eco-studio/studio.db
sudo rm -f /var/lib/eco-studio/studio.db-wal /var/lib/eco-studio/studio.db-shm
sudo chown eco-studio:eco-studio /var/lib/eco-studio/studio.db
sudo systemctl start eco-studio
```

Delete the `-wal` and `-shm` files. Otherwise SQLite replays the old write-ahead log onto the restored file. If the backup predates a schema migration, also switch `current` back to a release that matches it (see below).

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
| Database backups | `/var/lib/eco-studio/backups/studio-<ts>.db` |
| Print images | `/var/lib/eco-studio/prints/<historyId>/<n>.png` |
| LPrint page captures | `/var/spool/lprint-capture/job-<id>-page-<n>.pbm` (transient; eco-studio converts and deletes them) |
| TLS files | `/var/lib/eco-studio/tls/` |
| Logs | `journalctl -u eco-studio` |
| Units | `/etc/systemd/system/eco-studio.service`, `eco-studio-tls.service`, `eco-studio-tls.timer` |
| Polkit rule | `/etc/polkit-1/rules.d/50-eco-studio.rules` |
| TLS script | `/usr/local/sbin/eco-studio-tls` |
| Health counters | `/run/eco-printer-health/studio` |

The service runs as `eco-studio`, and only `/var/lib/eco-studio` and `/var/spool/lprint-capture` are writable to it. Release files are owned by root. The polkit rule lets `eco-studio` restart `lprint`, `avahi-daemon` and `eco-studio` and reboot the Pi, including when someone is logged in or a process holds a shutdown inhibitor. It allows nothing else.

## TLS

`/usr/local/sbin/eco-studio-tls` runs as root before every service start (`ExecStartPre=+`). `eco-studio-tls.timer` also runs it once a day, at a random time within an hour of midnight, and at the next boot if the Pi was off then. It maintains two things in `/var/lib/eco-studio/tls`:

- A local CA: `ca.key` and `ca.crt`, EC P-256, valid for 10 years, subject "ECO Label Studio Local CA".
- A server certificate signed by that CA: `server.key` and `leaf.crt`, plus `server.crt`, which is the leaf followed by the CA certificate. It is valid for 825 days, the maximum Apple devices accept. It covers `eco-printer.local`, `eco-printer`, `localhost`, `127.0.0.1` and every global IPv4 address the Pi has at the time. Those addresses are recorded in `leaf-ips.txt`.

The CA is replaced only when `ca.key` or `ca.crt` is missing or unreadable, when the two don't match, or when the CA has expired or expires within 30 days. Replacing it logs a prominent warning to the journal. The old files are kept as `ca.key.replaced-<ts>` and `ca.crt.replaced-<ts>`. Every device then has to trust the new CA.

The server certificate is re-issued when any of its files are missing, when `server.key` does not match `server.crt`, when it expires within 30 days, when the Pi's IPv4 addresses differ from `leaf-ips.txt`, or when the CA is new. A restart therefore picks up a new IP address. So does the daily timer, which sends `systemctl reload eco-studio` (SIGHUP) when it installs a new certificate and the service is running. The server then re-reads its certificate and key without restarting.

The script never stops the service from starting. If anything fails while a matching `server.crt`/`server.key` pair is on disk, it logs the error, keeps that pair, and exits 0. It exits non-zero only when there is no usable pair.

- Force a re-issue: `sudo rm /var/lib/eco-studio/tls/server.crt && sudo systemctl restart eco-studio`.
- Re-issue if needed and reload without a restart: `sudo systemctl start eco-studio-tls.service`.
- Check the timer: `systemctl list-timers eco-studio-tls.timer` and `journalctl -u eco-studio-tls`.
- If you delete `ca.key` or `ca.crt`, a new CA is created on the next run, and every device has to trust the new CA.

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

## Tests

`deploy/test/run.sh` tests the scripts locally on macOS or Linux, without root and without a Pi. It needs openssl, node, rsync and perl. System tools such as `systemctl`, `runuser` and `chown` are replaced by the fakes in `deploy/test/fakes/`. The health-check patch is tested against a copy of the Pi's real script in `deploy/test/fixtures/eco-printer-health`.
