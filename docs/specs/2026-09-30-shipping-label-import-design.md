# Shipping label import — design

Print carrier shipping labels (FedEx first) from the PDF the carrier hands out. The Studio finds the 4x6 label on the page, drops everything else (fold line, instructions, legal text), and prints just the label on the ZP 450.

## Problem

FedEx's "print label" PDF is a US Letter page (`/Rotate 270`). The label, rotated 90 degrees, fills one half of the page. The other half has upside-down instructions, separated by a thick full-width fold rule. Printing the page as-is on 4x6 stock shrinks the label to about half size, and the barcodes stop scanning.

Measured on a real FedEx Ground PDF rendered at 203 dpi (1726 x 2233 dots): the fold rule sits at y 1130–1135, and the label's ink bounding box is 1142 x 791 dots (5.6" x 3.9"). Rotated to portrait, it fits the 812 x 1218 label at 1:1. The label is vector text plus barcode images at 206 ppi, so rendering at 203 dpi loses nothing.

## Goals

- Pick or drop a carrier PDF (or PNG/JPEG) in the Studio, see the cropped label as it will print, and print it. No manual cropping in the common case.
- Barcodes print at native resolution with no scaling or dithering when the label is 4x6 or smaller.
- Multi-page PDFs (multi-package shipments) print one label per page in one job.
- Works from the desktop designer and the phone view.

## Non-goals

- AirPrint / macOS print dialog support. That would need LPrint to advertise Letter and a C patch to crop rasterized pages. It could be a separate project later.
- A manual crop editor. The fallback is "fit whole page" plus Rotate 180°.
- Carrier-specific templates or parsing of label contents (tracking numbers, addresses).
- Server changes. The contract already has `PrintRequest.source: 'import'` and `HistorySource 'import'`, and the server stores and reprints them.

## User flow

Entry points:

1. Designer: **Print shipping label…** in the Print button's dropdown (`web/src/designer/TopBar.tsx`), below "Print with options…". Always enabled, since it does not depend on the canvas.
2. Designer: dropping a PDF anywhere on the workspace opens the dialog with that file. `Workspace.tsx` currently accepts only `image/*` drops and routes them to the image dialog. PDFs go to the new dialog, and images keep their current behavior.
3. Phone view (`MobileApp.tsx`): a **Shipping label** button on the home screen opens the same flow, full-screen.

Dialog:

- Empty state: a drop zone with a "Choose file" button (`accept="application/pdf,image/png,image/jpeg"`).
- After a file loads, the dialog shows:
  - A large preview of the first label exactly as it will print (812 x 1218, 1-bit).
  - A small thumbnail of the source page with the crop box drawn on it.
  - Page navigation ("Label 2 of 3") when the PDF has more than one page.
  - **Rotate 180°**, which applies to all labels in the file.
  - Copies, which defaults to the Studio's default copies.
  - **Print**.
- If a page had no 4x6 label to find, the dialog shows a notice on that page: "Couldn't find a 4x6 label on this page. Printing the whole page scaled to fit." The user can still print.
- Print uses the existing print pipeline: the one-time "printed by" prompt and toast progress. It calls `api.print({ name, images, copies, printedBy, source: 'import', designId: null })`. `name` is the file name without its extension. Printing does not touch the designer's canvas or undo history.

## Processing

A new module, `web/src/import/`. The pure logic works on `Bitmap` (`web/src/render/bitmap.ts`) so it runs in Vitest without a DOM.

1. **Load.**
   - PDF: lazy-import `pdfjs-dist` (and its worker) on first use, so the main bundle does not grow. Render each page at 100 dpi for detection, with the page's own `/Rotate` applied. pdf.js fetches the standard 14 fonts (carrier PDFs often don't embed Helvetica/Courier) and its wasm decoders from `/pdfjs/`. A Vite plugin serves them from `node_modules` in dev and copies them to `dist/pdfjs/` in the build.
   - PNG/JPEG: one page. Its dpi is guessed from its shape: a Letter or A4 page gives the dpi. Any other shape has an unknown dpi and is cropped to its ink.
2. **Grayscale ink mask**: luminance below 128 counts as ink.
3. **Already a label?** If the page is within 3% of 4x6 in either orientation, the crop is the whole page.
4. **Find the label block.**
   - Remove rules. A rule is a run of ink rows (or columns) where at least 75% of the page width (or height) is ink, and no thicker than 0.1". The 75% is above 6/8.5, so a label's own 6" border on a Letter page is not a rule. Rules separate blocks and are never part of one.
   - Split the page recursively, each time at its widest blank band (at least 0.1"; a band containing a rule always wins). Every region along the way is a candidate block, so the whole label is a candidate as well as its pieces.
   - Score each block by ink pixel count. Among blocks whose bounding box fits in 4x6 in either orientation (812 x 1218 or 1218 x 812, with 2% slack), choose the one with the most ink.
   - If no block fits, crop to the page's overall ink bounding box and flag the page as a fallback.
   - Pad the crop by 0.02" (clamped to the page). The label is centered on the 4x6 afterwards, so no more margin is needed.
5. **Orientation.**
   - Portrait crops stay as they are. Landscape crops rotate 90 degrees.
   - Direction: compare ink density in the outer 25% at each short end of the crop. Rotate so the denser end ends up at the bottom, since carriers put the tracking barcode there.
   - Rotate 180° in the dialog flips the result.
6. **Final render.**
   - PDF: map the crop rectangle back to PDF viewport coordinates. Render just that region with pdf.js so text and vectors stay sharp: at 203 dpi if the crop fits 812 x 1218 after rotation, otherwise at the largest scale that fits. Then rotate.
   - Images: crop, rotate, and resample to fit when needed.
   - Center the result on a white 812 x 1218 canvas and hard-threshold it (`threshold()`, level 128, no dithering).
   - Output a PNG data URL that meets the `PrintRequest.images` contract: exactly 812 x 1218, portrait, only `#000000`/`#FFFFFF`.
7. **Limits.**
   - Max 200 pages, per `MAX_LABELS_PER_JOB`.
   - Password-protected or corrupt PDFs show "This PDF can't be opened" and nothing prints.
   - Files over 20 MB are rejected before they are parsed.

Module layout:

- `import/detect.ts`: pure. Takes an ink mask and returns `{ crop: Rect, fallback: boolean }`, plus the orientation helper.
- `import/pdf.ts`: pdf.js loading and page/region rendering. This file holds the only DOM and pdf.js code.
- `import/prepare.ts`: turns a file into prepared labels (`{ dataUrl, sourceThumb, crop, fallback }[]`) and exposes the rotate-180 toggle.
- `designer/dialogs/ShippingLabelDialog.tsx`: the desktop dialog.
- The mobile screen lives in `MobileApp.tsx`. It reuses `prepare.ts` and the preview component.

## Error handling

- Unsupported file type: a toast, "Choose a PDF, PNG, or JPEG."
- A load or render failure shows an inline error in the dialog with the pdf.js message. Print stays disabled.
- Print errors use the existing toast path in `usePrintJob`.

## Testing

- Unit (Vitest, `import/detect.test.ts`), on synthetic bitmaps:
  - A FedEx-style Letter page: a label block with barcode-dense bars, a full-width fold rule, and a sparse text block. The label block is found and the rule is excluded.
  - A page that is already 4x6 (portrait and landscape) is taken whole.
  - Orientation: the dense end goes to the bottom for both rotation directions.
  - A block larger than 4x6 gives the fallback flag.
  - A blank page gives the fallback flag and no crash.
- E2E (Playwright, `e2e/shipping.spec.ts`): a synthetic carrier PDF built in the test goes through the dialog. The print request has `source: 'import'`, the file name, and one 812 x 1218 pure black-and-white image, with the barcode end turned to the bottom.
- The real FedEx PDF is not committed (it has names, addresses, and phone numbers). It is used only for a manual check.
- Manual check on the Pi:
  - Import the FedEx PDF in desktop Chrome/Safari and on an iPhone.
  - Confirm the preview matches the label.
  - Print it on the ZP 450.
  - Confirm the tracking barcode and the 2D code scan with a phone.
  - Confirm the history entry shows source "import" and reprints correctly.
