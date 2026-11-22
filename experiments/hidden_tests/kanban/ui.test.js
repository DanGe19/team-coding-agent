const { test, expect } = require('@playwright/test');
const BASE = 'http://localhost:3000';

async function seed(request, cards) {
  await request.delete(`${BASE}/api/cards`);
  for (const [title, column] of cards) await request.post(`${BASE}/api/cards`, { data: { title, column } });
}
const col = (page, name) => page.locator(`.column[data-column="${name}"]`);

test.beforeEach(async ({ request }) => { await request.delete(`${BASE}/api/cards`); });

test('existing cards load on start with correct counts', async ({ page, request }) => {
  await seed(request, [['a', 'todo'], ['b', 'todo'], ['c', 'done']]);
  await page.goto(BASE);
  await expect(col(page, 'todo').locator('.card')).toHaveCount(2);
  await expect(col(page, 'todo').locator('.count')).toHaveText('2');
  await expect(col(page, 'doing').locator('.count')).toHaveText('0');
  await expect(col(page, 'done').locator('.card .card-title')).toHaveText(['c']);
});

test('edge buttons are disabled: left in todo, right in done, up on first, down on last', async ({ page, request }) => {
  await seed(request, [['a', 'todo'], ['b', 'todo'], ['z', 'done']]);
  await page.goto(BASE);
  const todoCards = col(page, 'todo').locator('.card');
  await expect(todoCards.nth(0).locator('.btn-left')).toBeDisabled();
  await expect(todoCards.nth(0).locator('.btn-up')).toBeDisabled();
  await expect(todoCards.nth(0).locator('.btn-down')).toBeEnabled();
  await expect(todoCards.nth(1).locator('.btn-down')).toBeDisabled();
  await expect(todoCards.nth(1).locator('.btn-up')).toBeEnabled();
  await expect(col(page, 'done').locator('.card .btn-right')).toBeDisabled();
});

test('up/down reorder within a column and persist on the server', async ({ page, request }) => {
  await seed(request, [['a', 'todo'], ['b', 'todo'], ['c', 'todo']]);
  await page.goto(BASE);
  await col(page, 'todo').locator('.card', { hasText: 'c' }).locator('.btn-up').click();
  await expect(col(page, 'todo').locator('.card .card-title')).toHaveText(['a', 'c', 'b']);
  const board = await (await request.get(`${BASE}/api/board`)).json();
  expect(board.todo.map(k => k.title)).toEqual(['a', 'c', 'b']);
});

test('left arrow moves back and the card lands at the end of the target column', async ({ page, request }) => {
  await seed(request, [['t1', 'todo'], ['g1', 'doing']]);
  await page.goto(BASE);
  await col(page, 'doing').locator('.card .btn-left').click();
  await expect(col(page, 'todo').locator('.card .card-title')).toHaveText(['t1', 'g1']);
});

test('editing a title with Enter saves, Escape cancels', async ({ page, request }) => {
  await seed(request, [['old', 'todo']]);
  await page.goto(BASE);
  const card = col(page, 'todo').locator('.card').first();
  await card.locator('.btn-edit').click();
  const input = card.locator('.edit-input');
  await expect(input).toHaveValue('old');
  await input.fill('new');
  await input.press('Enter');
  await expect(col(page, 'todo').locator('.card .card-title')).toHaveText(['new']);
  await col(page, 'todo').locator('.card').first().locator('.btn-edit').click();
  await col(page, 'todo').locator('.edit-input').fill('ignored');
  await col(page, 'todo').locator('.edit-input').press('Escape');
  await expect(col(page, 'todo').locator('.card .card-title')).toHaveText(['new']);
  const board = await (await request.get(`${BASE}/api/board`)).json();
  expect(board.todo[0].title).toBe('new');
});

test('delete removes the card and updates the count; empty titles are ignored', async ({ page, request }) => {
  await seed(request, [['a', 'todo'], ['b', 'todo']]);
  await page.goto(BASE);
  await col(page, 'todo').locator('.card', { hasText: 'a' }).locator('.btn-delete').click();
  await expect(col(page, 'todo').locator('.card .card-title')).toHaveText(['b']);
  await expect(col(page, 'todo').locator('.count')).toHaveText('1');
  await col(page, 'todo').locator('.new-card-input').fill('   ');
  await col(page, 'todo').locator('.new-card-btn').click();
  await expect(col(page, 'todo').locator('.card')).toHaveCount(1);
});

test('refresh button picks up changes made through the API', async ({ page, request }) => {
  await page.goto(BASE);
  await request.post(`${BASE}/api/cards`, { data: { title: 'from api', column: 'doing' } });
  await page.locator('#refresh').click();
  await expect(col(page, 'doing').locator('.card .card-title')).toHaveText(['from api']);
});
