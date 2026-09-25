import { expect, test, type Page } from '@playwright/test';

async function freshDesigner(page: Page) {
  await page.request.post('/api/__mock/reset');
  await page.addInitScript(() => {
    if (!sessionStorage.getItem('eco.e2e')) {
      localStorage.clear();
      sessionStorage.setItem('eco.e2e', '1');
    }
  });
  await page.goto('/');
  await expect(page.getByTestId('empty-state')).toBeVisible();
}

/** Decode a PNG data URL in the browser and report its size and colours. */
async function inspectPng(page: Page, dataUrl: string) {
  return page.evaluate(async (src) => {
    const img = new Image();
    img.src = src;
    await img.decode();
    const canvas = document.createElement('canvas');
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    const ctx = canvas.getContext('2d')!;
    ctx.drawImage(img, 0, 0);
    const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
    let black = 0;
    let impure = 0;
    for (let p = 0; p < data.length; p += 4) {
      const [r, g, b, a] = [data[p], data[p + 1], data[p + 2], data[p + 3]];
      if (a !== 255 || !((r === 0 && g === 0 && b === 0) || (r === 255 && g === 255 && b === 255))) impure++;
      else if (r === 0) black++;
    }
    return { width: canvas.width, height: canvas.height, black, impure };
  }, dataUrl);
}

test('add text, print, and send one 812x1218 black-and-white PNG', async ({ page }) => {
  await freshDesigner(page);

  await page.getByTestId('start-blank').click();
  await page.getByTestId('element-text').click();
  await page.keyboard.type('Hello from the smoke test');
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('properties-panel')).toContainText('Hello from the smoke test');

  // First print asks for the (optional) printer name once, then prints.
  await page.getByTestId('print-button').click();
  await expect(page.getByRole('dialog')).toBeVisible();
  const requestPromise = page.waitForRequest((req) => req.url().endsWith('/api/print') && req.method() === 'POST');
  await page.getByTestId('confirm-print').click();
  const request = await requestPromise;
  const response = await request.response();
  expect(response?.status()).toBe(200);

  const body = request.postDataJSON() as { images: string[]; copies: number; name: string };
  expect(body.images).toHaveLength(1);
  expect(body.copies).toBe(1);
  expect(body.images[0]).toMatch(/^data:image\/png;base64,/);

  const png = await inspectPng(page, body.images[0]!);
  expect(png).toMatchObject({ width: 812, height: 1218, impure: 0 });
  expect(png.black).toBeGreaterThan(500);

  await expect(page.getByText(/Sent 1 label to the printer/)).toBeVisible();
});

test('landscape label prints rotated to portrait and batch sequence makes one image per number', async ({ page }) => {
  await freshDesigner(page);
  await page.getByTestId('start-blank').click();
  await page.getByRole('radio', { name: /Landscape/ }).first().click();
  await page.getByTestId('element-counter').click();

  await page.getByTestId('print-button').click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await dialog.getByRole('textbox', { name: 'To', exact: true }).fill('3');
  const requestPromise = page.waitForRequest((req) => req.url().endsWith('/api/print') && req.method() === 'POST');
  await page.getByTestId('confirm-print').click();
  const body = (await requestPromise).postDataJSON() as { images: string[] };
  expect(body.images).toHaveLength(3);
  for (const image of body.images) {
    expect(await inspectPng(page, image)).toMatchObject({ width: 812, height: 1218, impure: 0 });
  }
});
