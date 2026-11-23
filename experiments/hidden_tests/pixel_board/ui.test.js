const { test, expect } = require('@playwright/test');
const BASE = 'http://localhost:3000';
const cell = (page, x, y) => page.locator(`#grid .cell[data-x="${x}"][data-y="${y}"]`);

test.beforeEach(async ({ request }) => {
  await request.post(`${BASE}/api/reset`);
  const saves = await (await request.get(`${BASE}/api/saves`)).json();
  for (const s of saves) await request.delete(`${BASE}/api/saves/${s.id}`);
});

test('cells are equal squares with no gaps, in row-major order', async ({ page }) => {
  await page.setViewportSize({ width: 1200, height: 900 });
  await page.goto(BASE);
  const boxes = await page.locator('#grid .cell').evaluateAll(els => els.map(e => { const b = e.getBoundingClientRect(); return [b.x, b.y, b.width, b.height]; }));
  expect(boxes).toHaveLength(256);
  const [, , w, h] = boxes[0];
  expect(Math.abs(w - h)).toBeLessThan(0.5);
  expect(w).toBeGreaterThanOrEqual(20);
  for (const [, , bw, bh] of boxes) { expect(Math.abs(bw - w)).toBeLessThan(0.5); expect(Math.abs(bh - h)).toBeLessThan(0.5); }
  expect(Math.abs(boxes[1][0] - (boxes[0][0] + w))).toBeLessThan(0.5);    // next cell starts exactly where this ends
  expect(Math.abs(boxes[16][1] - (boxes[0][1] + h))).toBeLessThan(0.5);   // next row directly below
  expect(Math.abs(boxes[16][0] - boxes[0][0])).toBeLessThan(0.5);
  const gridWidth = await page.locator('#grid').evaluate(e => e.getBoundingClientRect().width);
  expect(gridWidth).toBeGreaterThanOrEqual(320);
});

test('fill tool, row tool and col tool through the UI', async ({ page, request }) => {
  await page.goto(BASE);
  await page.locator('#palette .swatch[data-color="3"]').click();
  await page.locator('#tool-row').click();
  await expect(page.locator('#tool-row')).toHaveClass(/active/);
  await expect(page.locator('#tool-paint')).not.toHaveClass(/active/);
  await cell(page, 4, 8).click();                                  // row 8 orange
  await expect(cell(page, 15, 8)).toHaveAttribute('data-color', '3');
  await page.locator('#palette .swatch[data-color="5"]').click();
  await page.locator('#tool-fill').click();
  await cell(page, 0, 0).click();                                  // fills top half
  await expect(cell(page, 15, 7)).toHaveAttribute('data-color', '5');
  await expect(cell(page, 0, 9)).toHaveAttribute('data-color', 'empty');
  await page.locator('#tool-col').click();
  await page.locator('#eraser').click();
  await expect(page.locator('#eraser')).toHaveClass(/active/);
  await expect(page.locator('#palette .swatch.active')).toHaveCount(0);
  await cell(page, 2, 2).click();                                  // erase column 2
  await expect(cell(page, 2, 8)).toHaveAttribute('data-color', 'empty');
  await expect(cell(page, 3, 8)).toHaveAttribute('data-color', '3');
  const b = await (await request.get(`${BASE}/api/board`)).json();
  expect(b.undoDepth).toBe(3);
  await expect(page.locator('#history-depth')).toHaveText('3 / 50');
});

test('keyboard shortcuts: digits, e, ctrl+z, ctrl+y', async ({ page }) => {
  await page.goto(BASE);
  await page.locator('#grid').hover();
  await page.keyboard.press('7');
  await expect(page.locator('#palette .swatch.active')).toHaveAttribute('data-color', '6');
  await cell(page, 1, 1).click();
  await expect(cell(page, 1, 1)).toHaveAttribute('data-color', '6');
  await page.keyboard.press('Control+z');
  await expect(cell(page, 1, 1)).toHaveAttribute('data-color', 'empty');
  await page.keyboard.press('Control+y');
  await expect(cell(page, 1, 1)).toHaveAttribute('data-color', '6');
  await page.keyboard.press('e');
  await expect(page.locator('#eraser')).toHaveClass(/active/);
  await cell(page, 1, 1).click();
  await expect(cell(page, 1, 1)).toHaveAttribute('data-color', 'empty');
});

test('undo/redo buttons track canUndo/canRedo; painting after undo disables redo', async ({ page }) => {
  await page.goto(BASE);
  await cell(page, 0, 0).click(); await cell(page, 1, 0).click();
  await page.locator('#btn-undo').click();
  await expect(page.locator('#btn-redo')).toBeEnabled();
  await expect(page.locator('#history-depth')).toHaveText('1 / 50');
  await cell(page, 9, 9).click();
  await expect(page.locator('#btn-redo')).toBeDisabled();
  await expect(page.locator('#history-depth')).toHaveText('2 / 50');
  await page.locator('#btn-undo').click(); await page.locator('#btn-undo').click();
  await expect(page.locator('#btn-undo')).toBeDisabled();
  await expect(page.locator('#history-depth')).toHaveText('0 / 50');
});

test('painting the same color twice does not add history', async ({ page }) => {
  await page.goto(BASE);
  await cell(page, 3, 3).click(); await cell(page, 3, 3).click();
  await expect(page.locator('#history-depth')).toHaveText('1 / 50');
});

test('save errors, delete, and load is undoable', async ({ page }) => {
  await page.goto(BASE);
  await page.locator('#btn-save').click();
  await expect(page.locator('#save-error')).not.toHaveText('');
  await cell(page, 0, 0).click();
  await page.locator('#save-name').fill('dot'); await page.locator('#btn-save').click();
  await page.locator('#save-name').fill('dot'); await page.locator('#btn-save').click();
  await expect(page.locator('#save-error')).not.toHaveText('');
  await expect(page.locator('#saves .save-row')).toHaveCount(1);
  await page.locator('#btn-clear').click();
  await page.locator('#saves .save-row .btn-load').click();
  await expect(cell(page, 0, 0)).toHaveAttribute('data-color', '0');
  await page.locator('#btn-undo').click();
  await expect(cell(page, 0, 0)).toHaveAttribute('data-color', 'empty');
  await page.locator('#saves .save-row .btn-delete').click();
  await expect(page.locator('#saves .save-row')).toHaveCount(0);
});

test('export shows JSON and import round-trips; coords on hover; cell colors match palette', async ({ page }) => {
  await page.goto(BASE);
  await page.locator('#palette .swatch[data-color="2"]').click();
  await cell(page, 7, 7).click();
  await page.locator('#btn-export').click();
  await expect(page.locator('#export-output')).toHaveValue(/"cells"/);
  const json = JSON.parse(await page.locator('#export-output').inputValue());
  expect(json.cells[7 * 16 + 7]).toBe(2);
  expect(json.width).toBe(16);
  await page.locator('#btn-clear').click();
  await page.locator('#import-input').fill(JSON.stringify({ cells: json.cells }));
  await page.locator('#btn-import').click();
  await expect(cell(page, 7, 7)).toHaveAttribute('data-color', '2');
  const bg = await cell(page, 7, 7).evaluate(e => getComputedStyle(e).backgroundColor);
  expect(bg.replace(/\s/g, '')).toBe('rgb(228,0,43)');
  await page.locator('#import-input').fill('not json');
  await page.locator('#btn-import').click();
  await expect(page.locator('#import-error')).not.toHaveText('');
  await cell(page, 12, 3).hover();
  await expect(page.locator('#coords')).toHaveText('12, 3');
});
