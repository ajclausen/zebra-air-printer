#!/usr/bin/env node
/**
 * End-to-end check of the web app against the real Label Studio server
 * (fake printer). Start both first:
 *
 *   npm run dev -w server                         # http://localhost:5174
 *   cd web && npx vite --port 5173                # proxies /api to :5174
 *   node scripts/verify-real-server.mjs [http://localhost:5173] [admin-password]
 *
 * Checks: print from the designer, save to the library, reopen it, the print
 * shows in history and reprints, and the admin console logs in and shows the
 * overview. Exits non-zero on the first failure.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const base = process.argv[2] ?? 'http://localhost:5173';
const password = process.argv[3] ?? 'label-studio-dev';
const outDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../screenshots');
fs.mkdirSync(outDir, { recursive: true });

function check(condition, message) {
  if (!condition) throw new Error(`FAILED: ${message}`);
  console.log(`ok  ${message}`);
}

const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  page.on('pageerror', (e) => console.error('pageerror:', e.message));
  await page.addInitScript(() => {
    if (!sessionStorage.getItem('verify')) {
      localStorage.clear();
      sessionStorage.setItem('verify', '1');
    }
  });

  // --- Print from the designer ------------------------------------------------
  await page.goto(base + '/');
  await page.getByTestId('start-blank').click();
  await page.getByTestId('element-heading').click();
  const stamp = `Real server ${Date.now().toString(36)}`;
  await page.keyboard.type(stamp);
  await page.keyboard.press('Escape');
  await page.getByTestId('element-qrcode').click();
  await page.waitForTimeout(500);

  await page.getByTestId('print-button').click();
  await page.getByRole('dialog').waitFor();
  await page.getByLabel('Your name').fill('Verifier');
  const printResponse = page.waitForResponse((r) => r.url().endsWith('/api/print') && r.request().method() === 'POST');
  await page.getByTestId('confirm-print').click();
  const printed = await printResponse;
  check(printed.status() === 200, `POST /api/print returned ${printed.status()}`);
  const printBody = await printed.json();
  check(printBody.historyId && printBody.jobIds.length === 1, `print created history ${printBody.historyId} with job ${printBody.jobIds}`);
  await page.getByText(/Sent 1 label to the printer/).waitFor();

  // --- Save to the library and reopen ------------------------------------------
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+s' : 'Control+s');
  await page.getByTestId('save-name').fill(stamp);
  const saveResponse = page.waitForResponse((r) => r.url().endsWith('/api/designs') && r.request().method() === 'POST');
  await page.getByTestId('save-confirm').click();
  const saved = await saveResponse;
  check(saved.status() === 201 || saved.status() === 200, `POST /api/designs returned ${saved.status()}`);
  const design = await saved.json();
  check(typeof design.thumbnail === 'string' && design.thumbnail.startsWith('data:image/png'), 'saved design has a PNG thumbnail');

  await page.evaluate(() => window.__eco?.editor.getState().startBlank());
  await page.getByTestId('tab-library').click();
  await page.getByRole('button', { name: stamp }).first().click();
  await page.waitForFunction((name) => window.__eco?.editor.getState().meta.name === name, stamp);
  const reopened = await page.evaluate(() => window.__eco.editor.getState().doc.elements.length);
  check(reopened === 2, `reopened design from the library with ${reopened} elements`);

  // --- History and reprint -----------------------------------------------------
  await page.getByTestId('tab-history').click();
  const row = page.getByRole('list', { name: 'Recent prints' }).getByRole('listitem').filter({ hasText: 'Verifier' }).first();
  await row.waitFor();
  check(true, 'print appears in the history panel');
  const reprintResponse = page.waitForResponse((r) => /\/api\/history\/[^/]+\/reprint$/.test(r.url()));
  await page.screenshot({ path: '/tmp/verify-history.png' });
  await row.getByRole('button', { name: /Reprint/ }).click();
  const reprint = await reprintResponse;
  check(reprint.status() === 200, `reprint returned ${reprint.status()}`);
  await page.screenshot({ path: path.join(outDir, 'real-server-designer.png') });

  // --- Admin: first-run setup or login, then overview --------------------------
  await page.goto(base + '/admin');
  await page.waitForTimeout(800);
  const setup = page.getByRole('heading', { name: /Set an admin password|Create/i });
  if (await setup.isVisible().catch(() => false)) {
    const fields = page.locator('input[type=password]');
    await fields.nth(0).fill(password);
    await fields.nth(1).fill(password);
  } else {
    await page.locator('input[type=password]').first().fill(password);
  }
  await page.keyboard.press('Enter');
  await page.getByText(/Zebra ZP 450/).first().waitFor({ timeout: 15000 });
  check(true, 'admin console logged in and shows the printer');
  await page.getByText(/lprint/).first().waitFor();
  check(true, 'admin overview lists services');
  await page.waitForTimeout(1200);
  await page.screenshot({ path: path.join(outDir, 'real-server-admin-overview.png') });
  console.log('All checks passed.');
} finally {
  await browser.close();
}
