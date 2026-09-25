# @eco/server

Fastify API for ECO Label Studio. It stores designs and print history in SQLite, sends labels to LPrint over IPP, and serves the built web app. The API contract is in `shared/src/index.ts`.

## Development

```sh
npm install                 # at the repo root
npm run build -w shared
npm run dev -w server       # http://localhost:5174, fake printer, data in server/data
```

The fake printer (`ECO_PRINTER_URI=fake`) keeps an in-memory queue with one held AirPrint job, "prints" each job over a few seconds, and writes what it receives to `$ECO_DATA_DIR/fake-printer/` (`job-<id>.png` or `.zpl`). Set `ECO_FAKE_PRINTER_REASONS=media-empty-error` (comma separated) to simulate a printer problem.

The Vite dev server on `http://localhost:5173` may proxy `/api` here. Its origin is allowed for state-changing requests outside production; add others with `ECO_ALLOWED_ORIGINS`.

To try the production setup locally, create certificates with the deploy script and use high ports:

```sh
ECO_TLS_DIR=/tmp/eco/tls ECO_TLS_OWNER=$(id -un) bash deploy/eco-studio-tls
NODE_ENV=production ECO_DATA_DIR=/tmp/eco ECO_PRINTER_URI=fake \
  ECO_HTTP_PORT=18080 ECO_HTTPS_PORT=18443 node server/dist/main.js
```

## Scripts

- `npm run build`: compile to `dist/` (entry `dist/main.js`)
- `npm test`: vitest (uses `shared/src` directly, no build needed)
- `npm run typecheck`

## Configuration

| Variable | Production default | Development default |
| --- | --- | --- |
| `ECO_DATA_DIR` | `/var/lib/eco-studio` | `./data` |
| `ECO_PRINTER_URI` | `ipp://127.0.0.1:8000/ipp/print/Zebra_ZP_450` | `fake` |
| `ECO_HTTP_PORT` | `80` | `5174` |
| `ECO_HTTPS_PORT` | `443` | `443` |
| `ECO_TLS_DIR` | `$ECO_DATA_DIR/tls` | `$ECO_DATA_DIR/tls` |
| `ECO_STATIC_DIR` | unset (API only) | unset |
| `ECO_HEALTH_DIR` | `/run/eco-printer-health` | same |
| `ECO_ALLOWED_ORIGINS` | none | `http://localhost:5173`, `http://127.0.0.1:5173` |
| `ECO_HOST` | `::` (falls back to `0.0.0.0` without IPv6) | same |

Production means `NODE_ENV=production`. If `server.key` and `server.crt` exist in `ECO_TLS_DIR`, the app serves HTTPS on `ECO_HTTPS_PORT` and a redirect on `ECO_HTTP_PORT` (which still answers `/ca.crt` and `/api/health`). Otherwise it serves plain HTTP on `ECO_HTTP_PORT`. `SIGHUP` reloads the certificate; `SIGTERM` shuts down cleanly.

## Layout

- `src/ipp/`: IPP/1.1 codec and client
- `src/printer/`: printer interface, LPrint and fake implementations, status mapping, status cache, ZPL test label
- `src/images/`: PNG validation and the 203 dpi grayscale re-encode
- `src/db/`: SQLite schema, migrations, repositories
- `src/services/`: print pipeline and retention pruning
- `src/auth/`: password hashing, sessions, rate limiting
- `src/system/`: system info, service control, journal access
- `src/routes/`, `src/http/`: HTTP routes, schemas, guards
- `src/app.ts`: builds the Fastify app (used by tests with `inject`)
- `src/server.ts`, `src/main.ts`: listeners, TLS, redirect, signals

## Notes

- Label PNGs are re-encoded as 8-bit grayscale, thresholded at 50% luminance, with a pHYs chunk of 7993 px/m on both axes. That is 203.02 dpi, which PAPPL reads as 203 whether libpng rounds or truncates; 7992 px/m could come out as 202 and make PAPPL scale the label.
- Printer status is cached for 2 seconds, and the cache is cleared after printing, canceling, or changing settings.
- Studio jobs use `requesting-user-name=label-studio`; the queue marks them `studio` and everything else `airprint`.
- Test prints go through the ZPL path and are not recorded in history (`historyId` is `""`).
