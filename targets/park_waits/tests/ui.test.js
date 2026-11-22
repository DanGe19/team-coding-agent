const { test, expect } = require('@playwright/test');
const BASE = 'http://localhost:3000';

test.beforeEach(async ({ request }) => {
  await request.post(`${BASE}/api/reset`, { data: { seed: 1, leaveProbability: 0 } });
});

test('header shows 09:00 and five lands with eleven rides', async ({ page }) => {
  await page.goto(`${BASE}/?test=1`);
  await expect(page.locator('#sim-time')).toHaveText('09:00');
  await expect(page.locator('#guest-count')).toHaveText('0');
  await expect(page.locator('#board .land')).toHaveCount(5);
  await expect(page.locator('#board .ride')).toHaveCount(11);
  await expect(page.locator('.land').first()).toHaveAttribute('data-land', 'Super Nintendo World');
});

test('add guests + tick updates waits, classes and the clock', async ({ page }) => {
  await page.goto(`${BASE}/?test=1`);
  await page.locator('#btn-add-guests').click();
  await expect(page.locator('#guest-count')).toHaveText('50');
  await page.locator('#btn-tick').click();
  await expect(page.locator('#sim-time')).toHaveText('09:01');
  const anyLow = page.locator('.ride.wait-low');
  await expect(anyLow.first()).toBeVisible();
  await expect(page.locator('.ride[data-ride="mario-kart"] .wait')).toContainText('min');
});

test('toggle closes a ride and the card shows Closed', async ({ page }) => {
  await page.goto(`${BASE}/?test=1`);
  const card = page.locator('.ride[data-ride="carousel"]');
  await card.locator('.btn-toggle').click();
  await expect(card.locator('.wait')).toHaveText('Closed');
  await expect(card.locator('.status')).toHaveText('closed');
  await expect(card).toHaveClass(/wait-closed/);
});
