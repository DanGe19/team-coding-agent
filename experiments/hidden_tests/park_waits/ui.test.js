const { test, expect } = require('@playwright/test');
const BASE = 'http://localhost:3000';

async function setup(request, { count = 0, strategy = 'shortest', ticks = 0 } = {}) {
  await request.post(`${BASE}/api/reset`, { data: { seed: 1, leaveProbability: 0 } });
  if (count) await request.post(`${BASE}/api/guests`, { data: { count, strategy } });
  if (ticks) await request.post(`${BASE}/api/tick`, { data: { n: ticks } });
}
const card = (page, id) => page.locator(`.ride[data-ride="${id}"]`);

test.afterEach(async ({ request }) => { await request.post(`${BASE}/api/clock`, { data: { running: false } }); });

test('lands appear in data order with their color and all rides inside', async ({ page, request }) => {
  await setup(request);
  await page.goto(`${BASE}/?test=1`);
  const lands = page.locator('#board .land');
  await expect(lands).toHaveText([/Super Nintendo World/, /Isle of Berk/, /Celestial Park/, /Dark Universe/, /Ministry of Magic/]);
  await expect(lands.nth(0).locator('.ride')).toHaveCount(3);
  await expect(lands.nth(4).locator('.ride')).toHaveCount(1);
  const color = await lands.nth(2).evaluate(el => getComputedStyle(el).borderLeftColor);
  expect(color.replace(/\s/g, '')).toBe('rgb(31,111,235)');   // #1f6feb
});

test('waits, queue lengths and classes reflect the server after ticks', async ({ page, request }) => {
  await setup(request, { count: 30, ticks: 1 });
  await page.goto(`${BASE}/?test=1`);
  await expect(card(page, 'mine-cart').locator('.wait')).toHaveText('6 min');
  await expect(card(page, 'mine-cart').locator('.queue-len')).toHaveText('13');
  await expect(card(page, 'mine-cart')).toHaveClass(/wait-low/);
  await expect(page.locator('#guest-count')).toHaveText('30');
  await expect(page.locator('#sim-time')).toHaveText('09:01');
});

test('class thresholds at 15 and 45, exactly one wait-* class per card', async ({ page, request }) => {
  await setup(request);
  for (const id of ['yoshi', 'mine-cart', 'wing-gliders', 'dragon-rally', 'fyre-drill', 'stardust', 'carousel', 'monsters', 'werewolf', 'ministry'])
    await request.post(`${BASE}/api/rides/${id}/status`, { data: { status: 'closed' } });
  await request.post(`${BASE}/api/guests`, { data: { count: 48, strategy: 'shortest' } });
  await request.post(`${BASE}/api/tick`, { data: { n: 1 } });        // queue 48 -> ceil(48/16)*5 = 15
  await page.goto(`${BASE}/?test=1`);
  const mk = card(page, 'mario-kart');
  await expect(mk.locator('.wait')).toHaveText('15 min');
  await expect(mk).toHaveClass(/wait-mid/);
  await request.post(`${BASE}/api/guests`, { data: { count: 96, strategy: 'shortest' } });
  await page.locator('#btn-tick').click();                            // boards 16 (cycle 5), queue 32+96=128 -> 5+40 = 45
  await expect(mk.locator('.wait')).toHaveText('45 min');
  await expect(mk).toHaveClass(/wait-high/);
  await page.locator('#btn-tick').click();                            // cycle 4 -> 44
  await expect(mk.locator('.wait')).toHaveText('44 min');
  await expect(mk).toHaveClass(/wait-mid/);
  const cls = await mk.getAttribute('class');
  expect((cls.match(/wait-(low|mid|high|closed)/g) || []).length).toBe(1);
  await expect(card(page, 'yoshi')).toHaveClass(/wait-closed/);
});

test('reset with a seed from the input returns to 09:00 and empties the park', async ({ page, request }) => {
  await setup(request, { count: 30, ticks: 3 });
  await page.goto(`${BASE}/?test=1`);
  await expect(page.locator('#sim-time')).toHaveText('09:03');
  await page.locator('#seed-input').fill('99');
  await page.locator('#btn-reset').click();
  await expect(page.locator('#sim-time')).toHaveText('09:00');
  await expect(page.locator('#guest-count')).toHaveText('0');
  const s = await (await request.get(`${BASE}/api/state`)).json();
  expect(s.seed).toBe(99);
});

test('start button toggles the server clock and its label', async ({ page, request }) => {
  await setup(request);
  await page.goto(`${BASE}/?test=1`);
  await expect(page.locator('#btn-start')).toHaveText('Start');
  await page.locator('#btn-start').click();
  await expect(page.locator('#btn-start')).toHaveText('Pause');
  let s = await (await request.get(`${BASE}/api/state`)).json();
  expect(s.running).toBe(true);
  await page.locator('#btn-start').click();
  await expect(page.locator('#btn-start')).toHaveText('Start');
  s = await (await request.get(`${BASE}/api/state`)).json();
  expect(s.running).toBe(false);
});

test('map view: 11 markers at the right positions, colored, no overlap', async ({ page, request }) => {
  await setup(request, { count: 30, ticks: 1 });
  await page.setViewportSize({ width: 1200, height: 800 });
  await page.goto(`${BASE}/?test=1`);
  await expect(page.locator('#map')).toBeHidden();
  await page.locator('#btn-view').click();
  await expect(page.locator('#map')).toBeVisible();
  await expect(page.locator('#board')).toBeHidden();
  const markers = page.locator('#map .marker');
  await expect(markers).toHaveCount(11);
  const m = page.locator('#map .marker[data-ride="ministry"]');
  await expect(m).toHaveText('6');
  await expect(m).toHaveClass(/wait-low/);
  expect(await m.evaluate(el => [el.style.left, el.style.top])).toEqual(['80%', '45%']);
  const boxes = await markers.evaluateAll(els => els.map(e => { const b = e.getBoundingClientRect(); return [b.left, b.top, b.right, b.bottom]; }));
  for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
    const [a, b] = [boxes[i], boxes[j]];
    const overlap = a[0] < b[2] && b[0] < a[2] && a[1] < b[3] && b[1] < a[3];
    expect(overlap).toBe(false);
  }
  await request.post(`${BASE}/api/rides/ministry/status`, { data: { status: 'closed' } });
  await page.locator('#btn-tick').click();
  await expect(m).toHaveText('–');
  await expect(m).toHaveClass(/wait-closed/);
});

test('time formatting rolls over hours', async ({ page, request }) => {
  await setup(request, { ticks: 125 });
  await page.goto(`${BASE}/?test=1`);
  await expect(page.locator('#sim-time')).toHaveText('11:05');
});
