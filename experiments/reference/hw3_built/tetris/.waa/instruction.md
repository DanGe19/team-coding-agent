# Tetris Variant - Build Instructions

<!-- STUDENTS: Fill in the three STUDENT SECTIONs. Leave the provided sections unchanged. -->

## Current Milestone (STUDENT SECTION)

<!-- Which milestone the agent should work on now. Earlier tests must keep passing. -->

Milestone 3: Leaderboard. Make `tests/m3_leaderboard/api.test.js` and `tests/m3_leaderboard/ui.test.js` pass while `tests/m1_core/ui.test.js` and `tests/m2_rules/ui.test.js` keep passing.

**Milestones 1 and 2 are already done and working.** The project contains `index.js`, `public/index.html`, `public/style.css`, `public/game.js` and `public/render.js`; all 13 M1 tests and all 6 M2 tests pass. Start by reading the existing files (`fs.tree`, then `fs.read` on `index.js`, `public/index.html`, `public/game.js`, `public/render.js`) and **extend them**; do not rewrite the game logic. Keep the 50 ms `setInterval` UI-update fallback in `render.js` (headless Chromium does not fire `requestAnimationFrame` reliably).

Two things to do in this milestone besides the leaderboard:

1. **Fix a bug in `clearLines()` in `public/game.js`.** It currently processes full columns starting from the one closest to the wall, but each clear shifts the outer columns toward the wall, which changes the indices of the remaining full columns, so a second full column can be left uncleared. Process full columns starting from the one **farthest from the wall** (ascending col on the left half, descending col on the right half), or re-scan for full columns after every shift. Verify with a quick mental test: two adjacent full columns on one half must both disappear in one settle.
2. **Do not run `npm.init` again** (it overwrites `package.json`). Use `supertest.init` to add Jest and Supertest, then run `supertest.run test_file=tests/m3_leaderboard/api.test.js`. Do not add a `"jest"` key to `package.json`; `jest.config.js` is provided and already ignores the Playwright files.

Run all four test files before terminating.

## My Variant (STUDENT SECTION)

<!-- Your game's rules: arena shape and size, where pieces enter, which way they fall, what a line is, what happens after a clear, the randomizer, controls, scoring, and speed. Say what's different from classic Tetris. Add more detail as you release later milestones. -->

**Name: Side Tetris.** Pieces enter from the left or right edge and slide horizontally toward a solid wall in the middle of the arena. This differs from classic Tetris in **entry point**, **gravity direction**, and **what a line is** (a full column on one half instead of a full row).

### Arena
- A rectangular grid of **12 rows x 24 columns**. Coordinates are `[row, col]`, with row 0 at the top and col 0 at the far left.
- A solid **center wall** sits between col 11 and col 12. It is not a cell; pieces can never cross it. The left half is cols 0-11, the right half is cols 12-23.
- The two halves are independent: a piece on the left half only interacts with settled cells on the left half, and the same for the right.

### Entry and gravity
- Pieces **alternate sides**: the 1st piece enters from the left edge, the 2nd from the right edge, the 3rd from the left, and so on. `getState()` includes `side: 'left' | 'right'` for the active piece.
- A piece enters flush against its outer edge (its leftmost cell at col 0 on the left side, its rightmost cell at col 23 on the right side), vertically centered: its bounding box starts at row 4.
- **Gravity is horizontal, toward the wall**: pieces on the left half move +1 col per tick (rightward); pieces on the right half move -1 col per tick (leftward).
- The piece settles when the next gravity step would overlap the wall or a settled cell.

### Controls (sideways = vertical, because gravity is horizontal)
- `shift(-1)` moves the piece **up** one row; `shift(1)` moves it **down** one row. Both return `false` (and do nothing) if the move would leave the arena or overlap a settled cell.
- `rotate(1)` is clockwise, `rotate(-1)` counter-clockwise, using the standard tetromino rotation states (SRS-style). If the rotated piece would overlap an edge, the wall, or settled cells, try nudging it one row up, then one row down, then one column toward the wall; if nothing fits, do not rotate and return `false`. A rotation that needed no nudge must be exactly undone by the inverse rotation.
- `softDrop()` moves one column toward the wall. `hardDrop()` moves as far as possible toward the wall, settles the piece, and returns the number of columns moved.
- `step()` is one gravity tick: move one column toward the wall, or settle if blocked.
- Keyboard: ArrowUp / ArrowDown = shift up / down. ArrowLeft / ArrowRight = soft drop, but only the arrow that points toward the wall from the active side has an effect (ArrowRight on the left side, ArrowLeft on the right side). Z = rotate counter-clockwise, X = rotate clockwise. Space = hard drop. P = pause / resume. R = restart. There are also on-screen Start, Pause and Restart buttons.

### Lines and clearing (Milestone 2)
- A **line is a full column on one half**: all 12 cells of a single column in the left half (or in the right half) are settled.
- Lines are checked right after a piece settles. Every full column on that piece's half clears at once; several can clear from one piece (up to 4).
- **After a clear, the cleared column is removed and every column on the same half that is farther from the wall shifts one column toward the wall.** Columns between the cleared column and the wall do not move. (This is the classic "rows above fall down" rule rotated by 90 degrees, so stacks stay compact against the wall.) The other half is never affected.
- Clearing lines is the only way settled cells leave the arena. `settledCells` must always equal the real number of settled cells.

### Scoring, levels and speed (Milestone 2)
- Clearing 1 / 2 / 3 / 4 columns with one piece scores **100 / 300 / 500 / 800** points, multiplied by the current level. Clearing several columns at once therefore scores more than clearing them one at a time.
- Soft drop scores 1 point per column moved; hard drop scores 2 points per column moved (so a hard drop with a clear always scores more than the same hard drop without a clear).
- `level` starts at 1 and increases by 1 for every 10 lines cleared (`level = 1 + floor(lines / 10)`).
- Automatic gravity interval is `max(120, 800 - (level - 1) * 70)` milliseconds, so the game speeds up with each level. With `?test=1` in the URL there is no automatic gravity at all.
- `score`, `lines` and `level` are part of `getState()` and are shown live in `#score`, `#lines` and `#level`, whose text content is exactly the number (labels live in separate elements).

### Pause, game over, start and restart (Milestone 2)
- `togglePause()` (and the P key, and the on-screen Pause button) flips `paused`. While paused, automatic gravity stops, `#paused` is visible, and `shift`, `rotate`, `softDrop` and `step` return `false` while `hardDrop` returns `0`, with no change to the state at all.
- Game over happens when a new piece cannot be placed at its entry position without overlapping settled cells. Then `gameOver` becomes `true`, `active` becomes `null`, automatic gravity stops, `#game-over` becomes visible, and all piece actions are blocked exactly as when paused.
- `#start-btn` (the Start button) always starts a **fresh** game: it calls `reset()` with a new seed (or the seed from the URL if given), so score and lines go back to 0, the arena is empty, `paused` and `gameOver` are false, `#paused` and `#game-over` are hidden, and automatic gravity runs unless `?test=1` is set. The Restart button and the R key do the same thing. Resume is the same as un-pausing.
- `#paused` and `#game-over` are hidden (`display: none`) whenever they do not apply, so Playwright treats them as hidden.

### `setupClear()` test hook (Milestone 2)
- Compute where the current active piece would land after a `hardDrop()` (same half, same rows, slid toward the wall until blocked).
- Take the landing cells that are in the **column closest to the wall** among the landing cells. Fill every other cell of that column on the same half with settled cells, leaving exactly those landing cells empty. Do not touch any other column, so the drop path is unchanged and the piece still lands in the same place.
- Update `settledCells` to reflect the added cells. Do not change `score`, `lines`, `level`, `next`, or the active piece.
- After `setupClear()`, the next `hardDrop()` completes that column and clears at least one line.

### Leaderboard (Milestone 3)
- **Server (`index.js`)**: add `app.use(express.json())`. Keep scores in an in-memory array; no files or databases. Export the app with `module.exports = app;` and only call `app.listen(3000)` inside `if (require.main === module) { ... }`, otherwise the API tests fail with EADDRINUSE while the dev server is running.
- `POST /api/score` takes `{ name, score, lines, level }`. Validation: `name` must be a non-empty string (trimmed, at most 20 characters); `score`, `lines` and `level` must be integers >= 0 (`level` >= 1). Anything else gets **400** with `{ "error": "<reason>" }`. A valid entry gets a unique incrementing integer `id` and an ISO 8601 `timestamp`, and is returned with **201**.
- `GET /api/scores` returns entries sorted by `score` descending; ties are broken by `lines` descending, then by earlier `timestamp` first. Return at most the top 10.
- `DELETE /api/scores` clears the list and returns **200** with `{ "message": "All scores deleted" }`.
- **Page**: `#leaderboard` is an `<ol>` in the side panel under a "Leaderboard" heading. On page load, and again after every successful submission, fetch `GET /api/scores` and rebuild the list: each entry is an `<li>` containing `<span class="lb-name">` and `<span class="lb-score">` (the score text is exactly the number). Build the rows with `document.createElement` / `textContent`, never with `innerHTML` from user input. Show "No scores yet" (outside the `<ol>`) when the list is empty.
- **Submission**: `#score-form` lives inside the `#game-over` card, so it is visible exactly when the game is over. It has `<input name="name" maxlength="20" placeholder="Your name">` and `<button type="submit">Save score</button>`. On submit, call `event.preventDefault()`, post the final `score`, `lines` and `level` from `getState()` with the typed name via `fetch`, then refresh the leaderboard **without reloading the page**. After a successful post, disable the form and show a small "Saved!" note; show an inline error (never `alert()`) if the server rejects the submission. Reset the form whenever a new game starts.
- Remember the last used name in `localStorage` and prefill the input.

### Randomizer
- Use a **7-bag** randomizer (shuffle all seven shapes I, O, T, S, Z, J, L; deal them out; repeat), driven by a small seeded PRNG (mulberry32) so the same seed always gives the same piece sequence. `reset()` without a seed uses `Date.now()`.
- The next piece and the side it will enter from are shown in the `#next` preview.

## Look and Feel (STUDENT SECTION)

<!-- Theme, colors, fonts, layout, animations, and effects. -->

- Macaron pastel theme on a soft cream background (#FFF8F0), dark warm gray text (#5A4A4A), rounded corners, clean rounded sans-serif font (Nunito or Quicksand, loaded from Google Fonts with a sans-serif fallback). Keep the existing M1 look; only add what M2 needs.
- The board is a wide `<canvas>` inside a visible `#board` element, drawn as 12 x 24 cells (about 28 px each) with a thin pastel grid. The center wall is drawn as a thick lavender (#C9B6F2) vertical bar between col 11 and col 12.
- Each tetromino has its own pastel color: I mint (#B5EAD7), O pale yellow (#FFF1B5), T lavender (#E2D5F8), S pistachio (#D4F0C0), Z baby pink (#FFD6E0), J sky blue (#C7E6FF), L peach (#FFDAC1). Settled cells use a slightly darker shade of the same color.
- Show a faint "ghost" outline where the active piece would land after a hard drop.
- When a column clears, briefly flash it white (about 150 ms) before the shift, using a short CSS/canvas animation that never blocks the game logic (the state must update immediately; only the drawing is delayed).
- Above the board: the title "Side Tetris". To the right of the board: a panel with the `#next` preview (plus an arrow showing which side it enters from), a stats block with three rows "Score", "Lines", "Level" whose values are in `<span id="score">`, `<span id="lines">`, `<span id="level">`, and the Start (`#start-btn`), Pause and Restart buttons.
- `#paused` is a rounded lavender card over the board reading "Paused", shown only while paused. `#game-over` is a rounded pink card over the board reading "Game Over" with the final score and a Restart button, shown only when the game is over; the board is dimmed behind it.
- Keep the layout centered and readable on a laptop screen without scrolling. No alert() dialogs anywhere.
- Leaderboard panel: same rounded pastel card style as the stats panel, placed under the buttons. Rank numbers from the `<ol>`, name in bold on the left, score right-aligned; highlight the entry just submitted (e.g. a mint background) until the next game starts.
- The game-over card now shows "Game Over", the final score, the `#score-form` (name input + Save score button), and the Restart button.
- Files: `index.js` (Express, serves `public/` statically), `public/index.html`, `public/style.css`, `public/game.js` (game logic and `window.__tetris`), `public/render.js` (canvas drawing, DOM updates and keyboard handling). Keep game logic free of DOM code.

## What Counts as a Tetris — Milestone 1 (do not modify)

Build a single-player Tetris variant in the browser. It must differ from classic Tetris in at least one of: arena shape, entry point, gravity direction, what a line is, or what happens after a clear. A new visual theme isn't enough.

1. The arena is finite and made of cells. Its shape and size are up to you.
2. Pieces are tetrominoes (four cells joined edge to edge). Use all seven shapes: I, O, T, S, Z, J and L.
3. One piece is active at a time. It enters at a place you choose, and the player can always see the next piece.
4. Gravity moves the active piece one cell at a time. Its direction can be fixed, chosen per piece, or depend on position. Gravity gets faster as the game goes on, which you'll add in Milestone 2.
5. The player can move the piece sideways (across gravity), rotate it, soft drop it one cell, and hard drop it all the way. My Variant defines the controls.
6. The active piece never overlaps the arena's edge or settled cells.
7. When the piece can't move any further, it settles and the next piece enters.

## Common Interface — Milestone 1 (do not modify)

Use Node.js, Express, and plain browser JavaScript, with no frontend framework or build step. Serve `public/` statically so that `GET /` returns `public/index.html`. Set `"start": "node index.js"` in `package.json`, and run the server on port 3000.

Expose these methods on `window.__tetris`:

- `reset(seed)`: start a new game with an empty arena. The optional integer seed makes the piece sequence repeatable.
- `getState()`: return a copy of the game state (below).
- `shift(dir)`: move sideways, `-1` one way and `1` the other. Return whether it moved.
- `rotate(dir)`: `1` clockwise, `-1` counter-clockwise. Return whether it rotated.
- `softDrop()`: move one cell along gravity. Return whether it moved.
- `hardDrop()`: move as far as possible and settle. Return the number of cells moved.
- `step()`: one gravity tick. Move one cell, or settle if blocked. Return whether it moved.

`getState()` returns at least:

```js
{
  active: { type: 'T', cells: [[a, b], /* three more cells */] } | null,
  next: 'S',
  settledCells: 0   // number of settled cells in the arena
}
```

Coordinates use your variant's own system, such as `[row, col]` or `[ring, sector]`, in any order. Extra fields are fine. Changing the returned copy must not change the game.

The M1 tests also expect a few things that Milestone 2 completes:
- `togglePause()` and `setupClear()` exist (they can do nothing for now)
- `getState()` includes `lines: 0`, `paused: false` and `gameOver: false`
- when a new piece can't enter, `gameOver` becomes `true` and `active` becomes `null`

With `?test=1` in the URL, turn off automatic gravity. The tests advance the game through the methods above. Show the arena and active piece in a visible `#board`, along with a next-piece preview.

The tests are in `tests/m1_core/ui.test.js`. Run them with `playwright.run test_file=tests/m1_core/ui.test.js` while the server is running. Don't modify the provided tests. Put extra tests in `tests/extra/`. Playwright test files must be named `ui.test.js`, so use subfolders for more than one.

## What Counts as a Tetris — Milestone 2 (do not modify)

8. Your variant defines what a line is: a row, a ring, a half-row, and so on. When every cell of a line is filled, the line clears and its cells are removed. Remaining cells may shift, depending on your rules. Clearing lines is the only way cells leave the arena.
9. Clearing lines earns points, and clearing several lines with one piece earns more than clearing them one at a time. Gravity gets faster as the game goes on (rule 4).
10. The game ends when a new piece can't enter the arena. Show a game-over message and stop the pieces.
11. The player can start, pause, resume and restart. Nothing moves while paused. Show the score, lines cleared, level, and next piece.

## Common Interface — Milestone 2 (do not modify)

Keep the Milestone 1 interface. `getState()` now also has:

- `score`: points, starting at 0
- `lines`: lines cleared, starting at 0
- `level`: the current level, starting at 1
- `paused`: whether the game is paused
- `gameOver`: whether the game is over. `active` is `null` when it is.

`togglePause()` pauses or resumes the game. Give it a key too. While the game is paused or over, piece actions change nothing: `shift`, `rotate`, `softDrop` and `step` return `false`, and `hardDrop` returns `0`.

`setupClear()` is a test hook. It arranges the settled cells, and the active piece if needed, so that the next `hardDrop()` completes at least one line. One way to do this: work out where the piece will land, then fill the line that runs across gravity through the piece's farthest landing cells, leaving those cells empty. The piece never has to pass through that line.

The page also needs:

- `#score`, `#lines` and `#level`, whose text is exactly the number (put labels in separate elements)
- a visible `#next` preview
- `#start-btn`, which starts a fresh game, with automatic gravity outside test mode
- `#paused`, visible only while paused
- `#game-over`, visible only when the game is over

The tests are in `tests/m2_rules/ui.test.js`. Run them with `playwright.run test_file=tests/m2_rules/ui.test.js` while the server is running. Don't modify the provided tests, and keep the Milestone 1 tests passing.

## Leaderboard — Milestone 3 (do not modify)

- When the game ends, ask the player for a name and save their final score, lines and level to a leaderboard on the server. Keep it in memory only.
- The server rejects invalid submissions, such as a missing name or a negative score.
- The leaderboard shows the best scores first, and it updates right after a submission without reloading the page.

## Common Interface — Milestone 3 (do not modify)

In `index.js`, export the app with `module.exports = app`, and only call `listen` when `require.main === module`. Don't add a `"jest"` key to `package.json`, because `jest.config.js` is provided.

### POST /api/score

Request:
```json
{ "name": "Ada", "score": 1200, "lines": 12, "level": 2 }
```
Response **201 Created** with the stored entry, a unique `id`, and an ISO 8601 `timestamp`:
```json
{ "id": 1, "name": "Ada", "score": 1200, "lines": 12, "level": 2, "timestamp": "2026-10-01T12:00:00.000Z" }
```
Invalid input gets **400 Bad Request** with `{ "error": "<message>" }`.

### GET /api/scores

Response **200 OK** with an array of entries:
```json
[{ "id": 1, "name": "Ada", "score": 1200, "lines": 12, "level": 2, "timestamp": "2026-10-01T12:00:00.000Z" }]
```

### DELETE /api/scores

Removes all entries. Response **200 OK** with `{ "message": "All scores deleted" }`.

### Page

- `#leaderboard` is an `ol` or `ul` filled from `GET /api/scores`. Each entry is an `li` with its own `span.lb-name` and `span.lb-score`. Don't use `::before` or `::after` for their text.
- `#score-form` appears at game over, with an `input[name="name"]` and a `button[type="submit"]`. Submitting it posts the final score, lines and level, then refreshes the leaderboard without reloading the page.

The tests are in `tests/m3_leaderboard/`. Run `supertest.run test_file=tests/m3_leaderboard/api.test.js`, and with the server running, `playwright.run test_file=tests/m3_leaderboard/ui.test.js`. Don't modify the provided tests, and keep the earlier tests passing.
