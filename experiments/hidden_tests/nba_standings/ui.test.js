const { test, expect } = require('@playwright/test');
const BASE = 'http://localhost:3000';
const rowOf = (page, conf, id) => page.locator(`#standings-${conf} tbody .team-row[data-team="${id}"]`);

test.beforeEach(async ({ request }) => { await request.post(`${BASE}/api/reset`); await request.post(`${BASE}/api/import-sample`); });

test('row cells are formatted per spec and zones are distinct', async ({ page }) => {
  await page.goto(BASE);
  const ind = rowOf(page, 'east', 'IND');
  await expect(ind.locator('.rank')).toHaveText('2');
  await expect(ind.locator('.pct')).toHaveText('.600');
  await expect(ind.locator('.gb')).toHaveText('0.5');
  await expect(ind.locator('.diff')).toHaveText('+43');
  await expect(ind.locator('.l10')).toHaveText('6-4');
  await expect(rowOf(page, 'east', 'CLE').locator('.diff')).toHaveText('0');
  await expect(rowOf(page, 'east', 'CHI').locator('.streak')).toHaveText('L6');
  await expect(rowOf(page, 'east', 'TOR')).toHaveClass(/zone-playin/);
  await expect(rowOf(page, 'east', 'CLE')).toHaveClass(/zone-out/);
  const bg = async id => rowOf(page, 'east', id).evaluate(el => getComputedStyle(el).backgroundColor);
  expect(await bg('PHI')).not.toBe(await bg('TOR'));
  expect(await bg('TOR')).not.toBe(await bg('CLE'));
  const cls = await rowOf(page, 'east', 'PHI').getAttribute('class');
  expect((cls.match(/zone-(playoff|playin|out)/g) || []).length).toBe(1);
});

test('clicking a numeric header sorts descending, again ascending', async ({ page }) => {
  await page.goto(BASE);
  const table = page.locator('#standings-west');
  await table.locator('th[data-sort="diff"]').click();
  await expect(table.locator('tbody .team-row').first()).toHaveAttribute('data-team', 'POR');   // +72
  await table.locator('th[data-sort="diff"]').click();
  await expect(table.locator('tbody .team-row').first()).toHaveAttribute('data-team', 'LAL');   // -46
  await table.locator('th[data-sort="l"]').click();
  await expect(table.locator('tbody .team-row').first().locator('.l')).toHaveText('7');
});

test('team panel shows record, roster with injury badges and games', async ({ page }) => {
  await page.goto(BASE);
  await rowOf(page, 'east', 'BKN').click();
  const panel = page.locator('#team-panel');
  await expect(panel).toBeVisible();
  await expect(panel.locator('.team-name')).toHaveText('Brooklyn Nets');
  await expect(panel.locator('.team-record')).toHaveText('5-4');
  await expect(panel.locator('.player-row')).toHaveCount(3);
  const out = panel.locator('.player-row[data-player="5"]');
  await expect(out.locator('.badge-out')).toBeVisible();
  await expect(out.locator('.injury')).toContainText('Sprained ankle');
  await expect(out.locator('.ppg')).toHaveText('0.0');
  await expect(panel.locator('.game-row')).toHaveCount(9);
});

test('game form shows server validation error and does not change standings', async ({ page }) => {
  await page.goto(BASE);
  await page.locator('#home-team').selectOption('BOS');
  await page.locator('#away-team').selectOption('BOS');
  await page.locator('#home-score').fill('100'); await page.locator('#away-score').fill('90');
  await page.locator('#game-date').fill('2026-11-30');
  await page.locator('#btn-add-game').click();
  await expect(page.locator('#game-error')).not.toHaveText('');
  await expect(rowOf(page, 'east', 'BOS').locator('.w')).toHaveText('3');
});

test('players view: filters and injury editor', async ({ page, request }) => {
  await page.goto(BASE);
  await page.locator('#tab-players').click();
  const rows = page.locator('#players-table tbody .player-row');
  await expect(rows).toHaveCount(90);
  await expect(rows.first().locator('.name')).toHaveText('Nico Bishop');
  await page.locator('#filter-position').selectOption('C');
  await expect(rows).toHaveCount(30);
  await page.locator('#filter-team').selectOption('BOS');
  await expect(rows).toHaveCount(1);
  await page.locator('#filter-position').selectOption('');
  await expect(rows).toHaveCount(3);
  const r1 = page.locator('#players-table tbody .player-row[data-player="1"]');
  await r1.locator('.btn-injury').click();
  await r1.locator('select.injury-status').selectOption('out');
  await r1.locator('input.injury-note').fill('Wrist');
  await r1.locator('button.injury-save').click();
  await expect(r1.locator('.status')).toHaveText('out');
  const p = await (await request.get(`${BASE}/api/players?team=BOS&status=out`)).json();
  expect(p.map(x => x.id)).toEqual([1]);
});

test('add player via form, then it appears with 0.0 averages', async ({ page }) => {
  await page.goto(BASE);
  await page.locator('#tab-players').click();
  await page.locator('#p-name').fill('New Rookie');
  await page.locator('#p-team').selectOption('MIA');
  await page.locator('#p-position').selectOption('SG');
  await page.locator('#p-number').fill('44');
  await page.locator('#btn-add-player').click();
  const row = page.locator('#players-table tbody .player-row[data-player="91"]');
  await expect(row.locator('.name')).toHaveText('New Rookie');
  await expect(row.locator('.ppg')).toHaveText('0.0');
  await expect(row.locator('.gp')).toHaveText('0');
});

test('injuries empty state after reset; tabs are exclusive', async ({ page, request }) => {
  await request.post(`${BASE}/api/reset`);
  await page.goto(BASE);
  await page.locator('#tab-injuries').click();
  await expect(page.locator('#injuries-empty')).toBeVisible();
  await expect(page.locator('#injuries-empty')).toHaveText('No injuries reported');
  await expect(page.locator('#injuries-table tbody .injury-row')).toHaveCount(0);
  await page.locator('#tab-players').click();
  await expect(page.locator('#view-players')).toBeVisible();
  await expect(page.locator('#view-injuries')).toBeHidden();
  await expect(page.locator('#view-standings')).toBeHidden();
});
