#!/usr/bin/env node
/**
 * Capture designer screenshots against a running dev server with the mock API.
 *
 *   cd web && VITE_MOCK_API=1 npx vite --port 5180 &
 *   node scripts/screenshots.mjs [http://localhost:5180]
 *
 * Writes PNGs to web/screenshots/.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const base = process.argv[2] ?? 'http://localhost:5180';
const outDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../screenshots');
fs.mkdirSync(outDir, { recursive: true });
const shot = (page, name) => page.screenshot({ path: path.join(outDir, `${name}.png`) });

const CSV = 'Recipient,Street,City,Reference\nAda Lovelace,12 Analytical Row,"London, KY 40741",PO-1001\nGrace Hopper,7 Compiler Court,"Arlington, VA 22201",PO-1002\nKatherine Johnson,3 Orbit Lane,"Hampton, VA 23666",PO-1003\nAlan Turing,1 Bletchley Park,"Wilmslow, WA 98001",PO-1004\n';

const browser = await chromium.launch();
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
  const page = await context.newPage();
  page.on('pageerror', (e) => console.error('pageerror:', e.message));
  await page.request.post(`${base}/api/__mock/reset`);
  await page.addInitScript(() => {
    if (!sessionStorage.getItem('shots')) {
      localStorage.clear();
      sessionStorage.setItem('shots', '1');
    }
  });

  // 1. Empty state (first visit).
  await page.goto(base + '/');
  await page.getByTestId('empty-state').waitFor();
  await page.waitForTimeout(2500); // template previews
  await shot(page, 'designer-empty');

  // 2. A filled template.
  await page.getByTestId('template-shipping-address').click();
  await page.waitForTimeout(1500);
  await shot(page, 'designer-template');

  // 3. Properties panel with a text element selected, Elements panel open.
  await page.getByTestId('tab-elements').click();
  await page.evaluate(() => {
    const editor = window.__eco.editor.getState();
    const text = editor.doc.elements.find((e) => e.type === 'text' && e.text.includes('Recipient'));
    editor.setSelection([text.id]);
  });
  await page.waitForTimeout(600);
  await shot(page, 'designer-properties');

  // 4. Print dialog with fields.
  await page.keyboard.press('Escape');
  await page.getByTestId('print-button').click();
  await page.getByRole('dialog').waitFor();
  await page.waitForTimeout(400);
  await shot(page, 'print-dialog');

  // 5. Batch dialog with a CSV mapped to fields.
  await page.getByRole('radio', { name: /From CSV/ }).click();
  await page.locator('input[type=file][accept*=csv]').setInputFiles({ name: 'badges.csv', mimeType: 'text/csv', buffer: Buffer.from(CSV) });
  await page.waitForTimeout(400);
  await shot(page, 'batch-csv-dialog');
  await page.getByRole('button', { name: /Preview all 4/ }).click();
  await page.getByTestId('preview-image').nth(3).waitFor();
  await page.waitForTimeout(300);
  await shot(page, 'preview-batch');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(200);
  await page.getByRole('radio', { name: /Numbered/ }).click();
  await page.waitForTimeout(200);
  await shot(page, 'batch-sequence-dialog');
  await page.keyboard.press('Escape');

  // 6. Preview of the exact bitmap.
  await page.waitForTimeout(300);
  await page.getByRole('button', { name: /Preview/ }).first().click();
  await page.getByTestId('preview-image').first().waitFor();
  await page.waitForTimeout(300);
  await shot(page, 'preview');
  await page.keyboard.press('Escape');

  // 7. Tablet width.
  await page.setViewportSize({ width: 1024, height: 768 });
  await page.waitForTimeout(600);
  await shot(page, 'designer-tablet');

  // 8. Phone: pick, fill, print flow.
  const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true });
  const p = await phone.newPage();
  await p.goto(base + '/');
  await p.waitForTimeout(3000);
  await shot(p, 'phone-choose');
  await p.getByRole('button', { name: /Address label/ }).first().click();
  await p.waitForTimeout(1500);
  await shot(p, 'phone-fill');
} finally {
  await browser.close();
}
console.log(`Screenshots written to ${outDir}`);
