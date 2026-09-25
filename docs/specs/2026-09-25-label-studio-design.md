# ECO Label Studio — design

A web label designer and printer console that runs on `eco-printer` (Raspberry Pi 5, Debian 13) next to the existing AirPrint relay. Anyone on the office network opens `https://eco-printer.local`, designs or picks a label, and prints it on the Zebra ZP 450. AirPrint keeps working unchanged.

## Goals

- The landing page is the designer. A first-time user can print a custom label in under a minute without instructions.
- Free-form 4x6 canvas (portrait or landscape) with text, barcodes/QR codes, icons, images, and shapes. What is on screen is exactly what prints.
- A shared office library of saved designs and templates, plus built-in starter templates.
- Templates with fill-in fields, and batch printing (sequences and CSV).
- An admin page (password protected) to see and control the printer, queue, services, and system health.
- HTTPS on 443 with a local CA; port 80 redirects to HTTPS.
- Self-healing like the rest of the Pi: systemd restarts with backoff, health check integration.

## Non-goals

- Label sizes other than 4x6 (the printer only ever holds 4x6 stock).
- User accounts. The designer is open to everyone on the network; only the admin page has a password.
- Printing without a browser (server-side rendering). The server can reprint stored images from history, which covers "print it again".
- Replacing LPrint or AirPrint.

## Existing system (do not break)

- LPrint 1.3.1 (patched, held) serves IPP/IPPS on port 8000. Printer URI: `ipp://127.0.0.1:8000/ipp/print/Zebra_ZP_450`. Its local unix-socket admin path is broken in this build; always use TCP.
- LPrint accepts `image/png`, `image/pwg-raster`, `image/urf`, `application/vnd.zebra-zpl`.
- `/usr/local/sbin/eco-printer-health` runs every minute (systemd timer) and writes counters to `/run/eco-printer-health/{network,lprint,advertise}` as `"FAILS NEXT_EPOCH BACKOFF"`.
- Printer is direct thermal, 203 dpi, 4x6 labels = 812 x 1218 dots.

## Architecture

```
Browser (React + Fabric.js)                       Pi
  design on canvas ──render 812x1218 1-bit PNG──▶ eco-studio (Node 24, Fastify)
                                                    ├─ SQLite: designs, history, settings, admin
                                                    ├─ /var/lib/eco-studio/prints/*.png
                                                    └─ IPP over TCP ──▶ LPrint :8000 ──USB──▶ ZP 450
AirPrint clients ─────────────────────────────────────────────────────▶ LPrint :8000
```

Monorepo with npm workspaces:

- `shared/` — TypeScript API contract and constants (`shared/src/index.ts`). Both sides import `@eco/shared`. Changes to the contract go here first.
- `server/` — Fastify app, IPP client, SQLite storage, admin/system endpoints, TLS.
- `web/` — Vite + React + TypeScript + Tailwind + shadcn/ui. Fabric.js editor, bwip-js barcodes, Lucide icons, bundled fonts. Built to static files the server serves.
- `deploy/` — Pi provisioning and deployment scripts, systemd units, polkit rule.

## Rendering and print pipeline

1. The editor document is a Fabric.js canvas at printer resolution: portrait 812 x 1218 or landscape 1218 x 812 logical pixels (1 px = 1 printer dot). The view is zoomed with CSS/viewport transforms, never by resizing the document.
2. On print, the web app renders the document at 1:1 to an offscreen canvas and replaces `{{variables}}`, counters, and dates per label.
3. Conversion to 1-bit: images are converted with the user's chosen mode (threshold or Floyd-Steinberg dither) when inserted; the whole label gets a final threshold at 50% luminance so every pixel is pure black or white. The preview dialog shows this exact bitmap.
4. Landscape labels are rotated 90 degrees clockwise so every image sent is 812 x 1218 portrait.
5. `POST /api/print` with PNG data URLs. The server validates dimensions and PNG signature, stores the images under `/var/lib/eco-studio/prints/<historyId>/<n>.png`, and submits one IPP Print-Job per image (`document-format=image/png`, `copies`, `job-name`, `requesting-user-name=label-studio`, `media=na_index-4x6_4x6in`, `print-scaling=none`, `print-color-mode=bi-level`).
6. Jobs submitted with `requesting-user-name=label-studio` show as source `studio` in the queue; everything else is `airprint`.

Barcodes render through bwip-js to a canvas at integer module widths in printer dots (no scaling after rendering), so bars land on whole dots and scan reliably.

## Web app

### Designer (landing page, `/`)

Layout: top bar, left panel, canvas, right properties panel. Must also work on a tablet; on phones it degrades to template fill-in and printing.

- **Top bar:** studio name, design name (inline editable), undo/redo, orientation toggle, zoom, Save, Save as template, Preview, and a primary Print button with copies. A printer status pill (Ready / Printing / Needs attention with message) comes from `GET /api/printer`, polled every 5s.
- **Left panel tabs:**
  - *Templates:* built-in starters plus library templates, grouped by category, searchable. Clicking opens a copy.
  - *Library:* saved designs, searchable, with thumbnails, recent first; open, duplicate, delete.
  - *Elements:* Text, Heading, Barcode, QR code, Icon (searchable Lucide set), Image (upload, drag-and-drop, or paste), Rectangle, Rounded rectangle, Ellipse, Line, Date/time, Counter, Field (variable).
  - *History:* recent prints with previews; one-click reprint.
- **Canvas:** 4x6 label on a neutral background, with guides and snapping (edges, centers, other objects), keyboard nudging, multi-select, group/ungroup, align/distribute, bring forward/back, lock, duplicate, copy/paste, delete, and inline text editing.
- **Properties panel** (context-sensitive):
  - Text: font family (bundled set: a clean sans, condensed sans, serif, mono, a bold display face, and a handwriting face), size, weight, italic, alignment, line height, letter spacing, auto-fit to box, invert (white on black), and uppercase.
  - Barcode/QR: symbology (Code 128, Code 39, EAN-13, UPC-A, QR, DataMatrix, PDF417), data (may contain variables), human-readable text toggle, module size in dots.
  - Image: threshold/dither mode, threshold level, invert, and crop.
  - Shapes: fill (none/black), stroke width, corner radius.
  - Position/size in inches (or mm, user toggle) and rotation, for every element.
- **Variables:** any text or barcode data may contain `{{Name}}`. Built-ins: `{{date}}`, `{{time}}`, `{{counter}}`. At print time a dialog collects values for custom fields.
- **Batch print:** a sequence (start, end, step, zero-pad, prefix/suffix, drives `{{counter}}`) or CSV import (columns map to fields by header name; preview of the first rows). This produces one image per row or number, up to 200 per job.
- **Autosave:** the working document persists to localStorage so a refresh never loses work. Saving to the library is explicit.
- **Printed-by name:** optional, asked once, and remembered in localStorage.

### Built-in templates

These ship in the web bundle as code-defined documents with categories:

- Shipping: address label, return label, "Fragile / Handle with care"
- Inventory: asset tag (QR + number), bin label (large number + barcode), sheet of 6 small tags
- Signage: big sign (auto-fit text), "Do not touch", "Out of order", arrow sign
- Office: name badge, file box label, "Reserved"
- Parking: parking permit (large permit number + plate + expiry field), vehicle notice
- Food/dates: "Opened on {{date}}" label

### Admin (`/admin`)

First visit sets the password; after that, login is required.

- **Overview:** printer state with plain-language message, queue with cancel, test print, and services (lprint, avahi-daemon, eco-studio) with status and restart buttons. Also health-check counters, CPU temperature, memory, disk, Wi-Fi SSID and signal, uptime, and addresses.
- **Printer:** darkness and speed controls, with a test print after changing them.
- **Library:** all designs including deleted ones; restore, permanently delete, change category, and mark as template.
- **History:** full print history with thumbnails; reprint and delete.
- **Logs:** tail of lprint / eco-studio / eco-printer-health journals.
- **Settings:** studio name, history retention, default copies, change password, download CA certificate (with instructions for macOS/iOS/Windows), and reboot the Pi (with confirmation).

## Server

- Fastify on Node 24. HTTPS on 443 and HTTP on 80, which redirects everything except `/ca.crt` (served on both so devices can fetch it before trusting). Binding the low ports uses `AmbientCapabilities=CAP_NET_BIND_SERVICE`.
- Storage: `node:sqlite` at `/var/lib/eco-studio/studio.db` (WAL mode). Tables: `designs`, `history`, `settings`, `admin` (scrypt password hash), and `sessions`. Migrations are versioned via `PRAGMA user_version`.
- Print images are stored on disk and pruned on startup and daily according to `historyRetentionDays`.
- IPP client: small hand-written IPP/1.1 encoder and decoder (Print-Job, Get-Printer-Attributes, Get-Jobs, Cancel-Job, Set-Printer-Attributes) over HTTP to LPrint. It has unit tests against captured byte fixtures and a fake IPP server.
- Admin sessions: 32-byte random token in the `eco_admin` cookie, stored hashed, with a 30-day sliding expiry. Login is rate limited to 5 attempts per minute per IP.
- System info comes from `/proc`, `os`, `systemctl show`, `nmcli`, and `/sys/class/thermal`. Service restarts and reboot run `systemctl restart <unit>` / `systemctl reboot` as the unprivileged `eco-studio` user, authorized by a polkit rule scoped to user `eco-studio` and the three units plus reboot. Logs are read with `journalctl` (the user is in the `systemd-journal` group).
- Validation: every body is schema-validated (Fastify JSON schema or zod) and errors use the `ApiError` shape.
- Configuration comes from env vars with defaults: `ECO_DATA_DIR`, `ECO_PRINTER_URI`, `ECO_HTTP_PORT`, `ECO_HTTPS_PORT`, `ECO_TLS_DIR`, and `ECO_STATIC_DIR`. In dev it runs HTTP only on port 5174 with a fake printer (`ECO_PRINTER_URI=fake`), which logs jobs and writes the PNGs to disk.

## TLS

`deploy/eco-studio-tls` (run as `ExecStartPre`) maintains a local CA and leaf certificate in `/var/lib/eco-studio/tls`:

- The CA is 10 years, EC P-256, CN "ECO Label Studio Local CA", and is created once.
- The leaf is 825 days (Apple's limit for trusted server certificates), with SANs `eco-printer.local`, `eco-printer`, `localhost`, and the current IPv4 addresses. It is re-issued when it is within 30 days of expiry or when the address set changes.
- Users trust the CA once (downloaded from `/ca.crt`). Leaf rotation never needs re-trust. Browsers that don't trust it get the normal warning and can proceed.

## Deployment

- Node 24 LTS from the NodeSource apt repo on the Pi.
- `deploy/deploy.sh` (run on the Mac): builds, rsyncs `server/dist`, `web/dist`, `shared/dist`, and package manifests to `/opt/eco-studio/releases/<timestamp>`. It then runs `npm ci --omit=dev` on the Pi (pure-JS deps only), flips `/opt/eco-studio/current`, restarts the service, and waits for `/api/health`. It rolls back to the previous release if health fails.
- `deploy/provision.sh` (idempotent, run once and on changes): installs Node, creates the `eco-studio` system user (groups `systemd-journal`), installs the systemd unit, polkit rule, and TLS script, and adds the studio check to `eco-printer-health`.
- `eco-studio.service`: `Restart=always`, `RestartSec=2s`, `RestartSteps=8`, `RestartMaxDelaySec=5min`, `StartLimitIntervalSec=0`, `StateDirectory=eco-studio`, and hardening (`ProtectSystem=strict`, `ProtectHome=yes`, `PrivateTmp=yes`, `ReadWritePaths=/var/lib/eco-studio`).
- The health check gets a fourth check (`studio`): `curl -fsk https://127.0.0.1/api/health`. It restarts eco-studio with the same backoff pattern.

## Testing

- Server: vitest unit tests for the IPP codec, image validation, storage, retention pruning, and auth; API tests with `fastify.inject` against a fake IPP server.
- Web: vitest for the pure pieces (variable substitution, sequence/CSV expansion, 1-bit conversion, rotation, and document migration). A Playwright smoke test loads the designer, adds text, and captures the print request against the dev server.
- On-device: deploy, print a test label and a template, verify with the LPrint log (`raster data is 812x1218`), and do a physical check.
