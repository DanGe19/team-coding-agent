// UI tests for Portal Snake (Playwright). The server must be running on port 3000.
const { test, expect } = require('@playwright/test');

// Tests share the server's in-memory leaderboard.
test.describe.configure({ mode: 'serial' });

const methods = ['reset', 'getState', 'setDirection', 'step', 'togglePause', 'setupEat'];

const key = cell => JSON.stringify(cell);

test.beforeEach(async ({ page, request }) => {
  expect((await request.delete('/api/scores')).status()).toBe(200);
  expect((await request.post('/api/score', {
    data: { name: 'Ada', score: 42, length: 20, level: 4 },
  })).status()).toBe(201);
  await page.goto('/?test=1');
  await expect.poll(() => page.evaluate(() => typeof window.__snake?.reset)).toBe('function');
  await page.evaluate(() => window.__snake.reset(42));
});

async function state(page) {
  return page.evaluate(() => window.__snake.getState());
}

async function expectCounters(page, s) {
  for (const field of ['score', 'length', 'level']) {
    await expect(page.locator(`#${field}`)).toBeVisible();
    await expect.poll(() => page.locator(`#${field}`).textContent()).toBe(String(s[field]));
  }
}

// Eat the apple n times using the setupEat hook.
async function eat(page, n) {
  return page.evaluate(n => {
    const game = window.__snake;
    for (let i = 0; i < n; i++) {
      game.setupEat();
      game.step();
    }
    return game.getState();
  }, n);
}

// Drive the snake into its own body: grow once, then turn right-down-left-up.
async function crash(page) {
  return page.evaluate(() => {
    const game = window.__snake;
    game.setupEat();
    game.step();
    for (const dir of ['down', 'left', 'up']) {
      game.setDirection(dir);
      game.step();
    }
    return game.getState();
  });
}

test('the board is visible and the interface is available', async ({ page }) => {
  await expect(page.locator('#board')).toBeVisible();
  await expect(page.locator('#board canvas')).toBeVisible();
  for (const method of methods) {
    await expect.poll(() => page.evaluate(name => typeof window.__snake[name], method)).toBe('function');
  }
});

test('reset produces the starting snake, an apple on a free cell, and an empty arena', async ({ page }) => {
  const s = await state(page);
  expect(s.snake).toEqual([[10, 10], [10, 9], [10, 8], [10, 7]]);
  expect(s.direction).toBe('right');
  expect(s.length).toBe(4);
  expect(s.score).toBe(0);
  expect(s.applesEaten).toBe(0);
  expect(s.level).toBe(1);
  expect(s.paused).toBe(false);
  expect(s.gameOver).toBe(false);
  expect(s.rocks).toEqual([]);
  expect(s.golden).toBeNull();
  expect(Array.isArray(s.apple)).toBe(true);
  expect(s.apple[0]).toBeGreaterThanOrEqual(0);
  expect(s.apple[0]).toBeLessThan(20);
  expect(s.apple[1]).toBeGreaterThanOrEqual(0);
  expect(s.apple[1]).toBeLessThan(20);
  expect(s.snake.map(key)).not.toContain(key(s.apple));
});

test('the same seed reproduces apple positions and different seeds differ', async ({ page }) => {
  const positions = await page.evaluate(() => {
    const game = window.__snake;
    const run = seed => {
      game.reset(seed);
      const out = [];
      for (let i = 0; i < 6; i++) { out.push(game.getState().apple); game.setupEat(); game.step(); }
      return out;
    };
    return { a1: run(7), a2: run(7), b: run(99) };
  });
  expect(positions.a2).toEqual(positions.a1);
  expect(positions.b).not.toEqual(positions.a1);
});

test('getState returns an independent copy', async ({ page }) => {
  const { before, after } = await page.evaluate(() => {
    const game = window.__snake;
    const copy = s => JSON.parse(JSON.stringify(s));
    const s = game.getState();
    const before = copy(s);
    s.snake[0][0] = 99;
    s.snake.push([1, 1]);
    s.apple = [0, 0];
    s.rocks.push([2, 2]);
    s.score = 1000;
    s.gameOver = true;
    return { before, after: copy(game.getState()) };
  });
  expect(after).toEqual(before);
});

test('a step moves the head one cell and keeps the length', async ({ page }) => {
  const moved = await page.evaluate(() => window.__snake.step());
  expect(moved).toBe(true);
  const s = await state(page);
  expect(s.snake[0]).toEqual([10, 11]);
  expect(s.snake).toHaveLength(4);
  expect(s.snake.map(key)).not.toContain(key([10, 7]));
});

test('opposite directions are ignored and other directions are accepted', async ({ page }) => {
  const result = await page.evaluate(() => {
    const game = window.__snake;
    const rejected = game.setDirection('left');
    const accepted = game.setDirection('down');
    game.step();
    return { rejected, accepted, head: game.getState().snake[0], direction: game.getState().direction };
  });
  expect(result.rejected).toBe(false);
  expect(result.accepted).toBe(true);
  expect(result.head).toEqual([11, 10]);
  expect(result.direction).toBe('down');
});

test('the edges are portals: leaving the top re-enters at the bottom without dying', async ({ page }) => {
  const s = await page.evaluate(() => {
    const game = window.__snake;
    game.setDirection('up');
    for (let i = 0; i < 11; i++) game.step();
    return game.getState();
  });
  expect(s.gameOver).toBe(false);
  expect(s.snake[0]).toEqual([19, 10]);
});

test('setupEat makes the next step eat the apple, score and grow', async ({ page }) => {
  const before = await state(page);
  const s = await eat(page, 1);
  expect(s.score).toBe(before.score + 1);
  expect(s.applesEaten).toBe(before.applesEaten + 1);
  expect(s.length).toBe(before.length + 1);
  expect(s.snake).toHaveLength(before.length + 1);
  expect(key(s.apple)).not.toBe(key(before.apple));
  expect(s.snake.map(key)).not.toContain(key(s.apple));
  await expectCounters(page, s);
});

test('the fifth apple spawns a golden apple and a rock, and raises the level', async ({ page }) => {
  const s = await eat(page, 5);
  expect(s.applesEaten).toBe(5);
  expect(s.score).toBe(5);
  expect(s.level).toBe(2);
  expect(s.golden).not.toBeNull();
  expect(s.goldenTicksLeft).toBeGreaterThan(0);
  expect(s.rocks).toHaveLength(1);
  const occupied = new Set(s.snake.map(key));
  expect(occupied.has(key(s.golden))).toBe(false);
  expect(occupied.has(key(s.rocks[0]))).toBe(false);
  expect(key(s.rocks[0])).not.toBe(key(s.apple));
  // The golden apple counts down and eventually disappears.
  const later = await page.evaluate(() => {
    const game = window.__snake;
    game.step();
    const one = game.getState();
    for (let i = 0; i < 60 && game.getState().golden && !game.getState().gameOver; i++) game.step();
    return { afterOne: one.goldenTicksLeft, eatenAtOnce: one.golden === null, golden: game.getState().golden, gameOver: game.getState().gameOver };
  });
  if (!later.eatenAtOnce) expect(later.afterOne).toBe(s.goldenTicksLeft - 1);
  if (!later.gameOver) expect(later.golden).toBeNull();
  await expectCounters(page, await state(page));
});

test('pause blocks movement and shows #paused; resume restores play', async ({ page }) => {
  await expect(page.locator('#paused')).toBeHidden();
  const paused = await page.evaluate(() => {
    const game = window.__snake;
    game.togglePause();
    const before = game.getState();
    const stepped = game.step();
    const turned = game.setDirection('down');
    return { stepped, turned, before, after: game.getState() };
  });
  expect(paused.before.paused).toBe(true);
  expect(paused.stepped).toBe(false);
  expect(paused.turned).toBe(false);
  expect(paused.after).toEqual(paused.before);
  await expect(page.locator('#paused')).toBeVisible();
  const resumed = await page.evaluate(() => {
    window.__snake.togglePause();
    return { paused: window.__snake.getState().paused, stepped: window.__snake.step() };
  });
  expect(resumed.paused).toBe(false);
  expect(resumed.stepped).toBe(true);
  await expect(page.locator('#paused')).toBeHidden();
});

test('running into the body ends the game, shows #game-over and blocks actions', async ({ page }) => {
  await expect(page.locator('#game-over')).toBeHidden();
  const s = await crash(page);
  expect(s.gameOver).toBe(true);
  await expect(page.locator('#game-over')).toBeVisible();
  const blocked = await page.evaluate(() => {
    const game = window.__snake;
    const before = game.getState();
    const stepped = game.step();
    const turned = game.setDirection('right');
    return { stepped, turned, before, after: game.getState() };
  });
  expect(blocked.stepped).toBe(false);
  expect(blocked.turned).toBe(false);
  expect(blocked.after).toEqual(blocked.before);
});

test('test mode disables automatic movement', async ({ page }) => {
  const before = await state(page);
  await page.waitForTimeout(1500);
  const after = await state(page);
  expect(after.snake).toEqual(before.snake);
});

test('the leaderboard displays an entry posted through the API', async ({ page }) => {
  const leaderboard = page.locator('#leaderboard');
  await expect(leaderboard).toBeVisible();
  const row = leaderboard.locator('li').filter({ has: page.locator('.lb-name', { hasText: /^Ada$/ }) });
  await expect(row.locator('.lb-name')).toBeVisible();
  await expect(row.locator('.lb-score')).toHaveText('42');
});

test('game over allows submitting a name that appears without reloading', async ({ page }) => {
  await eat(page, 2);
  const s = await crash(page);
  expect(s.gameOver).toBe(true);
  const form = page.locator('#score-form');
  await expect(form).toBeVisible();
  await form.locator('input[name="name"]').fill('Grace');
  await page.evaluate(() => { window.__snakeMarker = 'same-document'; });
  await form.locator('button[type="submit"]').click();
  const row = page.locator('#leaderboard li').filter({ has: page.locator('.lb-name', { hasText: /^Grace$/ }) });
  await expect(row).toBeVisible();
  await expect(row.locator('.lb-score')).toHaveText(String(s.score));
  expect(await page.evaluate(() => window.__snakeMarker)).toBe('same-document');
});

test('the start button starts a fresh game after game over', async ({ page }) => {
  await eat(page, 5);
  await crash(page);
  await page.locator('#start-btn').click();
  await expect.poll(() => page.evaluate(() => {
    const s = window.__snake.getState();
    return { score: s.score, length: s.length, level: s.level, rocks: s.rocks.length, gameOver: s.gameOver, paused: s.paused };
  })).toEqual({ score: 0, length: 4, level: 1, rocks: 0, gameOver: false, paused: false });
  await expect(page.locator('#game-over')).toBeHidden();
  await expect(page.locator('#paused')).toBeHidden();
  await expectCounters(page, await state(page));
});
