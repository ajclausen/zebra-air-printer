#!/usr/bin/env node
/**
 * Render every built-in template to the exact bitmap the printer receives and
 * check it is print-ready (812 x 1218, pure black and white).
 *
 * Usage (from web/, with the dev server running):
 *   node scripts/render-print-samples.mjs [baseUrl] [--only=id1,id2]
 *
 * baseUrl defaults to http://localhost:5180. PNGs go to
 * web/screenshots/print-samples/<id>.png. Landscape templates come back rotated
 * 90 degrees clockwise, as they are sent to the printer.
 *
 * Exits 1 when any template fails to render or produces a bitmap that is the
 * wrong size or not pure black and white.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const EXPECTED_WIDTH = 812;
const EXPECTED_HEIGHT = 1218;

const scriptDir = dirname(fileURLToPath(import.meta.url));
const outDir = join(scriptDir, '..', 'screenshots', 'print-samples');

function parseArgs(argv) {
  let baseUrl = 'http://localhost:5180';
  let only = null;
  for (const arg of argv) {
    if (arg.startsWith('--only=')) only = new Set(arg.slice('--only='.length).split(',').filter(Boolean));
    else if (!arg.startsWith('--')) baseUrl = arg;
  }
  return { baseUrl: baseUrl.replace(/\/$/, ''), only };
}

/** Default values for every field the template declares. */
function defaultValues(doc) {
  return Object.fromEntries((doc.fields ?? []).map((f) => [f.key, f.defaultValue ?? '']));
}

function printTable(rows) {
  const headers = ['id', 'size', 'pure B/W', 'black %', 'status'];
  const cells = rows.map((r) => [r.id, r.size, r.pure, r.black, r.status]);
  const widths = headers.map((h, i) => Math.max(h.length, ...cells.map((c) => c[i].length)));
  const line = (values) => values.map((v, i) => v.padEnd(widths[i])).join('  ');
  console.log(line(headers));
  console.log(widths.map((w) => '-'.repeat(w)).join('  '));
  for (const c of cells) console.log(line(c));
}

async function main() {
  const { baseUrl, only } = parseArgs(process.argv.slice(2));
  await mkdir(outDir, { recursive: true });

  const browser = await chromium.launch();
  const rows = [];
  let failures = 0;
  try {
    const page = await browser.newPage();
    page.on('pageerror', (error) => console.error(`[page error] ${error.message}`));
    // Start from a clean editor so an autosaved document cannot interfere.
    await page.addInitScript(() => localStorage.clear());
    await page.goto(baseUrl, { waitUntil: 'load' });
    await page.waitForFunction(() => Boolean(window.__eco?.templates && window.__eco?.renderSample), null, { timeout: 30_000 });

    const templates = await page.evaluate(() => window.__eco.templates());
    for (const template of templates) {
      if (only && !only.has(template.id)) continue;
      const instance = { values: defaultValues(template.doc), counter: '1' };
      let result;
      try {
        result = await page.evaluate(([doc, inst]) => window.__eco.renderSample(doc, inst), [template.doc, instance]);
      } catch (error) {
        failures++;
        const reason = String(error.message ?? error).split('\n')[0];
        rows.push({ id: template.id, size: '-', pure: '-', black: '-', status: `ERROR ${reason}` });
        continue;
      }

      const file = join(outDir, `${template.id}.png`);
      await writeFile(file, Buffer.from(result.dataUrl.split(',')[1], 'base64'));

      const sizeOk = result.width === EXPECTED_WIDTH && result.height === EXPECTED_HEIGHT;
      const ok = sizeOk && result.pureMonochrome;
      if (!ok) failures++;
      rows.push({
        id: template.id,
        size: `${result.width} x ${result.height}`,
        pure: result.pureMonochrome ? 'yes' : 'no',
        black: `${(result.blackRatio * 100).toFixed(1)}`,
        status: ok ? 'ok' : sizeOk ? 'FAIL not pure B/W' : 'FAIL wrong size',
      });
    }
  } finally {
    await browser.close();
  }

  if (rows.length === 0) {
    console.error('No templates rendered.');
    process.exit(1);
  }
  printTable(rows);
  console.log(`\n${rows.length} template(s) written to ${relative(process.cwd(), outDir) || outDir}`);
  if (failures > 0) {
    console.error(`${failures} template(s) failed.`);
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
