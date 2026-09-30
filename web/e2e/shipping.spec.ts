import { expect, test } from '@playwright/test';

/**
 * A minimal carrier-style PDF: a Letter page with instruction "text" on top,
 * a full-width fold rule, and a landscape 5.6" x 3.9" label below whose
 * tracking barcode is on its right end. Units are points (72 per inch).
 */
function carrierPdf(): Buffer {
  const rects: string[] = [];
  const rect = (x: number, y: number, w: number, h: number) => rects.push(`${x} ${y} ${w} ${h} re f`);
  // Instructions: rows of short dashes across most of the top half.
  for (let row = 0; row < 10; row++) for (let x = 60; x < 550; x += 9) rect(x, 700 - row * 12, 6, 4);
  // Fold rule.
  rect(30, 400, 552, 3);
  // Label: text on the left, a 2D-code block in the middle, barcode bars on the right.
  const label = { x: 40, y: 60, w: 403, h: 281 };
  for (let row = 0; row < 8; row++) for (let x = label.x; x < label.x + 120; x += 9) rect(x, label.y + label.h - 10 - row * 14, 6, 5);
  rect(label.x + 180, label.y + 100, 60, 60);
  for (let i = 0, y = label.y; y < label.y + label.h; i++) {
    const thick = 1 + (i % 3);
    rect(label.x + 300, y, 103, thick);
    y += thick + 1 + (i % 2);
  }
  const content = `0 g\n${rects.join('\n')}\n`;
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << >> >>',
    `<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}endstream`,
  ];
  let pdf = '%PDF-1.4\n';
  const offsets: number[] = [];
  objects.forEach((body, i) => {
    offsets.push(Buffer.byteLength(pdf));
    pdf += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = Buffer.byteLength(pdf);
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}`;
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(pdf, 'latin1');
}

test('print a shipping label from a carrier PDF: cropped, upright, 812x1218 black and white', async ({ page }) => {
  await page.request.post('/api/__mock/reset');
  await page.goto('/');
  await page.getByRole('button', { name: 'More print options' }).click();
  await page.getByRole('menuitem', { name: 'Print shipping label…' }).click();
  await page.getByTestId('shipping-file-input').setInputFiles({ name: 'FedEx Shipping Label.pdf', mimeType: 'application/pdf', buffer: carrierPdf() });
  await expect(page.getByTestId('shipping-label-preview')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole('status')).toHaveCount(0); // no "couldn't find a label" notice

  const requestPromise = page.waitForRequest((req) => req.url().endsWith('/api/print') && req.method() === 'POST');
  await page.getByTestId('shipping-print').click();
  const body = (await requestPromise).postDataJSON() as { images: string[]; name: string; source: string; copies: number };
  expect(body.name).toBe('FedEx Shipping Label');
  expect(body.source).toBe('import');
  expect(body.images).toHaveLength(1);

  const stats = await page.evaluate(async (src) => {
    const img = new Image();
    img.src = src;
    await img.decode();
    const canvas = document.createElement('canvas');
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    const ctx = canvas.getContext('2d')!;
    ctx.drawImage(img, 0, 0);
    const { data, width, height } = ctx.getImageData(0, 0, canvas.width, canvas.height);
    let impure = 0;
    let top = 0;
    let bottom = 0;
    let topRowInk = 0;
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const p = (y * width + x) * 4;
        const [r, g, b, a] = [data[p], data[p + 1], data[p + 2], data[p + 3]];
        if (a !== 255 || !((r === 0 && g === 0 && b === 0) || (r === 255 && g === 255 && b === 255))) impure++;
        if (r !== 0) continue;
        if (y < height / 4) top++;
        if (y >= (height * 3) / 4) bottom++;
      }
    }
    // The 5.6" x 3.9" label prints 1:1, so it doesn't reach the label's top edge.
    for (let x = 0; x < width; x++) if (data[x * 4] === 0) topRowInk++;
    return { width, height, impure, top, bottom, topRowInk };
  }, body.images[0]!);

  expect(stats).toMatchObject({ width: 812, height: 1218, impure: 0, topRowInk: 0 });
  // The barcode end of the label is turned to the bottom.
  expect(stats.bottom).toBeGreaterThan(stats.top * 1.5);
});
