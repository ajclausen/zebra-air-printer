# @eco/web

The Label Studio front end: the designer at `/` and the admin console at `/admin`. Vite, React 19, Tailwind v4, Radix primitives, Fabric.js for the canvas, and bwip-js for barcodes. The API contract is `@eco/shared` (`shared/src/index.ts`).

## Development

```sh
npm install                       # at the repo root
npm run dev:mock -w web           # http://localhost:5173 with the in-memory mock API
npm run dev -w server             # real server on :5174 (fake printer), then:
npm run dev -w web                # http://localhost:5173, proxies /api and /ca.crt to :5174
```

The mock (`web/mock/`, enabled by `VITE_MOCK_API=1`) implements every route in the contract plus two control routes: `POST /api/__mock/reset` and `POST /api/__mock/printer {state, reasons, message}` to simulate printer problems. Set `MOCK_ADMIN_PASSWORD` to start with the admin password configured.

## Scripts

- `build`: production bundle in `web/dist` (builds `shared` first)
- `test`: vitest unit tests for the pure modules
- `typecheck`
- `e2e`: Playwright smoke test against the mock (starts its own dev server on :5190)
- `node scripts/render-print-samples.mjs [url]`: renders every built-in template through the print pipeline into `screenshots/print-samples/` and fails if any image is not 812 x 1218 pure black and white
- `node scripts/screenshots.mjs [url]`: designer screenshots into `screenshots/`
- `node scripts/verify-real-server.mjs [url] [admin-password]`: end-to-end check against the real server

## Layout

- `src/doc/`: the document model (`types.ts`, format version and `migrate.ts`), element factories, pure edits (`operations.ts`), `{{variables}}`, batch expansion (sequence and CSV), fonts
- `src/render/`: print pipeline. `bitmap.ts` (threshold, Floyd-Steinberg, rotation, final 812 x 1218 check) is pure; `objects.ts` turns elements into Fabric objects for both the editor and the print renderer; `print.ts` renders labels 1:1 offscreen and encodes PNGs; `barcode.ts` draws symbols at whole-dot module sizes
- `src/designer/`: editor store (undo, autosave), canvas controller (Fabric sync, snapping, text editing), panels, properties, dialogs, the phone flow
- `src/admin/`: admin console
- `src/templates/`: built-in templates and label symbols
- `src/lib/api/`: typed client and TanStack Query hooks

## How printing works

The editor document uses printer dots (812 x 1218 portrait, 1218 x 812 landscape). To print, each label is drawn 1:1 on an offscreen Fabric `StaticCanvas` with variables substituted, barcodes are regenerated from the substituted data at integer module sizes and placed on whole dots (quarter-turn rotation happens inside the bitmap, never by resampling), the result is thresholded at 50% luminance, landscape labels are rotated 90 degrees clockwise, and each label is sent as an 812 x 1218 PNG. The preview dialog shows these exact bitmaps.

Documents carry `formatVersion`. When the format changes, bump `DOCUMENT_FORMAT_VERSION` and add an upgrade step in `src/doc/migrate.ts`.
