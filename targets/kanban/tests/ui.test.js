const { test, expect } = require('@playwright/test');

test.beforeEach(async ({ page, request }) => {
  await request.delete('http://localhost:3000/api/cards');
  await page.goto('http://localhost:3000/');
});

test('three columns are shown in order', async ({ page }) => {
  const cols = page.locator('.column');
  await expect(cols).toHaveCount(3);
  await expect(cols.nth(0)).toHaveAttribute('data-column', 'todo');
  await expect(cols.nth(1)).toHaveAttribute('data-column', 'doing');
  await expect(cols.nth(2)).toHaveAttribute('data-column', 'done');
});

test('adding a card through the form shows it in that column', async ({ page }) => {
  const todo = page.locator('.column[data-column="todo"]');
  await todo.locator('.new-card-input').fill('Buy milk');
  await todo.locator('.new-card-btn').click();
  await expect(todo.locator('.card .card-title')).toHaveText(['Buy milk']);
  await expect(todo.locator('.count')).toHaveText('1');
  await expect(todo.locator('.new-card-input')).toHaveValue('');
});

test('the right arrow moves a card to the next column', async ({ page }) => {
  const todo = page.locator('.column[data-column="todo"]');
  await todo.locator('.new-card-input').fill('Ship it');
  await todo.locator('.new-card-btn').click();
  await todo.locator('.card .btn-right').click();
  await expect(page.locator('.column[data-column="doing"] .card .card-title')).toHaveText(['Ship it']);
  await expect(todo.locator('.card')).toHaveCount(0);
});
