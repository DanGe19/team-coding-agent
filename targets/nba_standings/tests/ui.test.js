const { test, expect } = require('@playwright/test');
const BASE = 'http://localhost:3000';

test.beforeEach(async ({ request }) => { await request.post(`${BASE}/api/reset`); });

test('standings tables render 15 rows each after importing the sample season', async ({ page }) => {
  await page.goto(BASE);
  await page.locator('#btn-import').click();
  await expect(page.locator('#standings-east tbody .team-row')).toHaveCount(15);
  await expect(page.locator('#standings-west tbody .team-row')).toHaveCount(15);
  const first = page.locator('#standings-west tbody .team-row').first();
  await expect(first).toHaveAttribute('data-team', 'POR');
  await expect(first.locator('.w')).toHaveText('8');
  await expect(first.locator('.gb')).toHaveText('-');
  await expect(first).toHaveClass(/zone-playoff/);
});

test('adding a game through the form updates the standings', async ({ page }) => {
  await page.goto(BASE);
  await page.locator('#home-team').selectOption('BOS');
  await page.locator('#away-team').selectOption('NYK');
  await page.locator('#home-score').fill('120');
  await page.locator('#away-score').fill('99');
  await page.locator('#game-date').fill('2026-11-05');
  await page.locator('#btn-add-game').click();
  const bos = page.locator('#standings-east tbody .team-row[data-team="BOS"]');
  await expect(bos.locator('.rank')).toHaveText('1');
  await expect(bos.locator('.w')).toHaveText('1');
  await expect(bos.locator('.diff')).toHaveText('+21');
  await expect(bos.locator('.pct')).toHaveText('1.000');
});

test('injuries tab shows the sample injuries, out first', async ({ page, request }) => {
  await request.post(`${BASE}/api/import-sample`);
  await page.goto(BASE);
  await page.locator('#tab-injuries').click();
  await expect(page.locator('#view-injuries')).toBeVisible();
  await expect(page.locator('#view-standings')).toBeHidden();
  const rows = page.locator('#injuries-table tbody .injury-row');
  await expect(rows).toHaveCount(3);
  await expect(rows.nth(0).locator('.status')).toHaveText('out');
  await expect(rows.nth(2).locator('.status')).toHaveText('day-to-day');
});
