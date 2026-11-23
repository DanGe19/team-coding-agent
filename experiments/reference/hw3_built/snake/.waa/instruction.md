# Portal Snake - Build Instructions

Build **Portal Snake**, a single-player browser game with a server-side leaderboard, using Node.js, Express and plain browser JavaScript (no frontend framework, no build step).

Portal Snake is classic Snake with two twists:

1. **The walls are portals.** A snake that leaves the arena on one edge re-enters on the opposite edge. The only way to die is to run into your own body or into a rock.
2. **Golden apples and rocks.** Every 5th apple eaten spawns a short-lived golden apple worth 5 points, and also drops a permanent rock on the arena, so the game gets harder the longer you survive.

There are provided tests in `tests/api.test.js` (Jest + Supertest) and `tests/ui.test.js` (Playwright). They define exactly what must work. Read both before writing code, do not modify them, and run them as you go. `jest.config.js` is provided and must not be modified; do not add a `"jest"` key to `package.json`.

## Game rules

### Arena
- A grid of **20 rows x 20 columns**. Coordinates are `[row, col]`, row 0 at the top, col 0 at the left.
- Moving off any edge wraps to the opposite edge (row -1 becomes 19, col 20 becomes 0, and so on). There are no wall collisions.

### Snake
- The snake is an ordered list of cells, head first. A new game starts with a snake of **length 4** in the middle of the arena, lying horizontally with the head at `[10, 10]` and the body extending to the left (`[10, 9]`, `[10, 8]`, `[10, 7]`), moving **right**.
- Each tick the snake moves one cell in its current direction: a new head cell is added and, unless it just ate, the tail cell is removed.
- `setDirection(dir)` with `dir` one of `'up' | 'down' | 'left' | 'right'` sets the direction used by the **next** tick. A direction that is the exact opposite of the current movement direction is ignored (return `false`); any other direction is accepted (return `true`). Only the last accepted direction before a tick counts.
- The game is over when the new head cell is occupied by the snake's own body (the tail cell that is about to be removed does not count) or by a rock. On game over the snake stops; `gameOver` becomes `true`.

### Food
- Exactly one **apple** is on the arena at all times, on a cell not occupied by the snake or a rock. Eating it (moving the head onto it) scores **1 point**, grows the snake by one cell, and places a new apple.
- After every **5th apple** eaten (5, 10, 15, ...): place one **golden apple** on a free cell, and place one **rock** on a free cell that is at least 3 cells (Manhattan distance) away from the head. The golden apple is worth **5 points**, grows the snake by one, and disappears if not eaten within **40 ticks**. At most one golden apple exists at a time. Rocks are permanent for the rest of the game.
- All random placement uses a seeded PRNG (mulberry32) so that `reset(seed)` reproduces the same apple positions. `reset()` without a seed uses `Date.now()`.

### Speed and level
- `level = 1 + floor(applesEaten / 5)`. The automatic tick interval is `max(60, 160 - (level - 1) * 15)` milliseconds.
- With `?test=1` in the URL there is **no automatic ticking at all**; the game only advances through `step()`.

### Controls
- Arrow keys or WASD set the direction. Space or P toggles pause. R restarts. On-screen buttons: Start (`#start-btn`), Pause, Restart.
- While paused or after game over, `step()` returns `false` and changes nothing, and `setDirection()` returns `false`.

## Common interface (used by the tests)

Serve `public/` statically so `GET /` returns `public/index.html`. Run the server on port 3000. In `index.js`, export the app with `module.exports = app;` and only call `app.listen(3000)` inside `if (require.main === module) { ... }` (otherwise the API tests fail with EADDRINUSE while the dev server is running). Set `"start": "node index.js"` in `package.json`.

Expose these methods on `window.__snake`:

- `reset(seed)`: start a new game. Optional integer seed for reproducible food placement.
- `getState()`: return an **independent copy** of the state (changing the returned object must not change the game):

```js
{
  snake: [[10, 10], [10, 9], [10, 8], [10, 7]],  // head first
  direction: 'right',
  apple: [r, c],
  golden: [r, c] | null,
  goldenTicksLeft: 0,
  rocks: [[r, c], ...],
  score: 0,
  applesEaten: 0,
  length: 4,
  level: 1,
  paused: false,
  gameOver: false
}
```

- `setDirection(dir)`: as described above; returns whether the direction was accepted.
- `step()`: one tick. Returns `true` if the snake moved, `false` if the game is paused or over.
- `togglePause()`: flips `paused`.
- `setupEat()`: **test hook**. Moves the apple to the cell directly in front of the head (following the current direction, with wrapping), so that the next `step()` eats it. Does nothing else.

### Page elements
- A visible `#board` containing a `<canvas>` that draws the arena, snake, apple, golden apple and rocks.
- `#score`, `#length` and `#level` whose text content is exactly the number (labels in separate elements).
- `#paused`, visible only while paused; `#game-over`, visible only when the game is over (use `display: none` otherwise).
- `#start-btn` starts a fresh game (score 0, length 4, no rocks) with automatic ticking outside test mode.
- `#score-form` inside the `#game-over` card, with `<input name="name">` and `<button type="submit">`. Submitting posts `{ name, score, length, level }` to the server with `fetch` and refreshes the leaderboard **without reloading the page** (`event.preventDefault()`). Show an inline error (never `alert()`) if the server rejects it; after success disable the form and show "Saved!".
- `#leaderboard` is an `<ol>` filled from `GET /api/scores` on page load and after each submission. Each entry is an `<li>` with its own `<span class="lb-name">` and `<span class="lb-score">` (score text exactly the number). Build rows with `createElement` / `textContent`.

## Leaderboard API

Keep scores in memory only (an array in `index.js`); no files or databases.

### POST /api/score
Request: `{ "name": "Ada", "score": 42, "length": 20, "level": 4 }`.
Validation: `name` must be a non-empty string (trimmed, at most 20 characters); `score`, `length` and `level` must be integers with `score >= 0`, `length >= 1`, `level >= 1`. Invalid input gets **400** with `{ "error": "<message>" }`.
Response **201** with the stored entry plus a unique incrementing integer `id` and an ISO 8601 `timestamp`:
`{ "id": 1, "name": "Ada", "score": 42, "length": 20, "level": 4, "timestamp": "..." }`

### GET /api/scores
Response **200** with an array of entries sorted by `score` descending, ties by `length` descending, then earlier `timestamp` first. Return at most the top 10.

### DELETE /api/scores
Removes all entries. Response **200** with `{ "message": "All scores deleted" }`.

## Look and feel

- Macaron pastel theme on a soft cream background (#FFF8F0), dark warm gray text (#5A4A4A), rounded corners, Nunito or Quicksand from Google Fonts with a sans-serif fallback.
- The board is a 20 x 20 canvas (about 24 px per cell) with a faint grid. Draw the four edges as dashed lavender (#C9B6F2) lines to hint that they are portals.
- Snake: mint (#B5EAD7) body with a slightly darker head (#8DD6BE) and two small dark eyes on the head facing the direction of travel. Apple: baby pink (#FFD6E0) circle. Golden apple: pale yellow (#FFF1B5) circle with a thin gold (#E8C547) outline that pulses while it is on the board. Rocks: warm gray (#D9CFC7) rounded squares.
- Title "Portal Snake" above the board. To the right: a stats panel (Score / Length / Level), the Start / Pause / Restart buttons, a short controls hint, and the Leaderboard panel with rank numbers, bold names and right-aligned scores.
- `#paused` is a rounded lavender card over the board reading "Paused". `#game-over` is a rounded pink card over the board with "Game Over", the final score, the `#score-form` and a Restart button; dim the board behind it.
- Keep the layout centered and readable on a laptop screen without scrolling. No `alert()` dialogs anywhere.
- Files: `index.js` (Express + leaderboard API), `public/index.html`, `public/style.css`, `public/game.js` (game logic and `window.__snake`, no DOM code), `public/render.js` (canvas drawing, DOM updates, keyboard, leaderboard fetch/submit). Update the DOM counters and overlays from a 50 ms `setInterval` as well as `requestAnimationFrame`, because headless Chromium does not fire `requestAnimationFrame` reliably.

## Suggested workflow

1. Read `tests/api.test.js` and `tests/ui.test.js`. Add TODO items.
2. `npm.init`, then write `index.js` with the API and `module.exports`. Run `npm.init` only once; it overwrites `package.json`.
3. `npm.start`, `supertest.init`, then `supertest.run` until the API tests pass.
4. Write `public/game.js` first (pure logic), then `public/index.html`, `public/style.css`, `public/render.js`.
5. `playwright.init`, then `playwright.run` until the UI tests pass. Read failures carefully; fix the code, not the tests.
6. `npm.stop`, then terminate.
