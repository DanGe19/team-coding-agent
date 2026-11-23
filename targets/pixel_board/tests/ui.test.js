const { test, expect } = require('@playwright/test');
const BASE = 'http://localhost:3000';
const cell = (page, x, y) => page.locator(`#grid .cell[data-x="${x}"][data-y="${y}"]`);

test.beforeEach(async ({ request }) => { await request.post(`${BASE}/api/reset`); });

test('grid has 256 cells, palette has 8 swatches, initial states', async ({ page }) => {
  await page.goto(BASE);
  await expect(page.locator('#grid .cell')).toHaveCount(256);
  await expect(page.locator('#palette .swatch')).toHaveCount(8);
  await expect(page.locator('#palette .swatch.active')).toHaveAttribute('data-color', '0');
  await expect(page.locator('#tool-paint')).toHaveClass(/active/);
  await expect(page.locator('#btn-undo')).toBeDisabled();
  await expect(page.locator('#btn-redo')).toBeDisabled();
  await expect(page.locator('#history-depth')).toHaveText('0 / 50');
});

test('pick a color, paint a cell, undo with the button', async ({ page }) => {
  await page.goto(BASE);
  await page.locator('#palette .swatch[data-color="2"]').click();
  await cell(page, 5, 6).click();
  await expect(cell(page, 5, 6)).toHaveAttribute('data-color', '2');
  await expect(page.locator('#btn-undo')).toBeEnabled();
  await expect(page.locator('#history-depth')).toHaveText('1 / 50');
  await page.locator('#btn-undo').click();
  await expect(cell(page, 5, 6)).toHaveAttribute('data-color', 'empty');
  await expect(page.locator('#btn-redo')).toBeEnabled();
});

test('save and load a work', async ({ page }) => {
  await page.goto(BASE);
  await page.locator('#palette .swatch[data-color="6"]').click();
  await cell(page, 0, 0).click();
  await page.locator('#save-name').fill('blue dot');
  await page.locator('#btn-save').click();
  await expect(page.locator('#saves .save-row .save-name')).toHaveText(['blue dot']);
  await page.locator('#btn-clear').click();
  await expect(cell(page, 0, 0)).toHaveAttribute('data-color', 'empty');
  await page.locator('#saves .save-row .btn-load').click();
  await expect(cell(page, 0, 0)).toHaveAttribute('data-color', '6');
});
