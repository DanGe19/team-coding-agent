# Pixel Board - Build Instructions

Build a pixel-art editor with undo/redo, using Node.js, Express and plain browser JavaScript (no frontend framework, no build step, no `<canvas>` — the grid is made of DOM elements). Serve `public/` statically so `GET /` returns `public/index.html`. Server in `index.js` on port 3000, `"start": "node index.js"` in `package.json`; `index.js` must export the Express app and only call `listen` when run directly. Separate HTML, CSS and JS under `public/`.

The board state and its history live **on the server** (in memory). The browser is a thin client: every action is an API call, and the page re-renders from the server's response.

## Model

- The board is **16 × 16**. Cell `(x, y)` has `x` from 0 (left) to 15, `y` from 0 (top) to 15. Cells are stored as a flat array `cells` of length 256, index `y * 16 + x`. A cell holds a **palette index** `0..7` or `null` (empty).
- Fixed palette (index → color): `0 #000000`, `1 #ffffff`, `2 #e4002b`, `3 #f28c00`, `4 #ffd400`, `5 #2bb673`, `6 #1f6feb`, `7 #8e44ad`.
- **Operations** (each successful, state-changing operation is one history step):
  - `paint` `{x, y, color}` — set one cell. `color` is `0..7` or `null` (eraser).
  - `fill` `{x, y, color}` — flood fill: starting at `(x, y)`, change every cell connected to it through **4-neighbours (up/down/left/right, not diagonals)** that has the **same value as the start cell** (including `null`) to `color`.
  - `row` `{y, color}` — set all 16 cells of row `y`.
  - `col` `{x, color}` — set all 16 cells of column `x`.
  - `clear` — set every cell to `null`.
  - `import` `{cells}` — replace the whole board (array of 256 values, each `0..7` or `null`).
  - `load` (from a saved work, see below) — replace the whole board.
- An operation that **changes nothing** (e.g. painting a cell with the color it already has, filling a region with its own color, clearing an empty board) is **not** recorded in history and returns `changed: false`.
- **History**: an undo stack and a redo stack of full board snapshots. Each new recorded operation pushes the previous board onto the undo stack and **empties the redo stack**. The undo stack holds at most **50** entries; when full, the oldest is dropped. `undo` pops the undo stack (pushing the current board onto redo); `redo` does the reverse. Undo/redo on an empty stack changes nothing and returns `changed: false` (status 200, not an error).
- **Saved works**: named copies of the board. `id` integer from 1, `name` (1–40 chars, unique, case-sensitive), `cells`, `createdAt`. Loading a saved work is a normal `load` operation (recorded in history, so it can be undone). Deleting a saved work never touches the board or history.

## RESTful API

JSON everywhere. Validation errors → **400** `{"error": "..."}`; unknown save id → **404** `{"error": "Save not found"}`.

Board responses always have this shape (call it **BoardState**):
```json
{ "width": 16, "height": 16, "palette": ["#000000", ...8 entries...],
  "cells": [ ... 256 values ... ],
  "canUndo": true, "canRedo": false, "undoDepth": 3, "redoDepth": 0, "historyLimit": 50 }
```

- `GET /api/board` → BoardState.
- `POST /api/ops` body `{ "type": "paint"|"fill"|"row"|"col"|"clear"|"import", ...fields }` → `{ "changed": boolean, "type": string, "cellsChanged": integer, "board": BoardState }` with **200**. 400 for an unknown type, out-of-range coordinates, invalid color or invalid `cells`.
- `POST /api/undo`, `POST /api/redo` → `{ "changed": boolean, "board": BoardState }`.
- `POST /api/reset` → empties the board **and both history stacks** (saves are kept) → BoardState.
- `GET /api/saves` → array of `{ id, name, createdAt }` (no cells), newest first.
- `POST /api/saves` body `{ "name" }` → **201** `{ id, name, createdAt, cells }`. 400 if name invalid or already used.
- `GET /api/saves/:id` → the save with its `cells`.
- `POST /api/saves/:id/load` → same shape as `/api/ops` (type `"load"`).
- `DELETE /api/saves/:id` → **204**.
- `GET /api/export` → `{ "width": 16, "height": 16, "palette": [...], "cells": [...] }` (what the Export button shows).

## Frontend requirements (UI tests rely on these ids and classes)

- `#grid`: a 16 × 16 grid of `div.cell` elements in row-major order, each with `data-x`, `data-y`, and `data-color` (`"0".."7"` or `"empty"`). Painted cells show the palette color as background; empty cells show a light checkerboard. **Cells must be perfect squares, all the same size, with no gaps between them**, and the grid must be at least 320 px wide on desktop. Clicking a cell applies the current tool with the current color.
- Palette: `#palette` with eight `button.swatch[data-color="0".."7"]` (background = the color) and `#eraser`. Exactly one of these nine has class `active` at any time; initially swatch `0`.
- Tools: `#tool-paint`, `#tool-fill`, `#tool-row`, `#tool-col`; exactly one has class `active`; initially paint. (Row/col tools apply to the clicked cell's row/column.)
- `#btn-undo`, `#btn-redo` are `disabled` exactly when `canUndo` / `canRedo` is false. `#btn-clear` clears the board. `#history-depth` shows `"<undoDepth> / 50"`.
- Keyboard: `Ctrl+Z` (or `Cmd+Z`) = undo, `Ctrl+Y` or `Ctrl+Shift+Z` = redo, `e` = eraser, `1`–`8` = swatch 0–7.
- Saves: input `#save-name`, button `#btn-save`; list `#saves` with `div.save-row[data-id]` containing `.save-name`, `button.btn-load`, `button.btn-delete`. Saving with an empty or duplicate name shows the server's error in `#save-error`.
- Export/import: `#btn-export` fills `textarea#export-output` with the JSON of `/api/export` (pretty-printed); `textarea#import-input` + `#btn-import` sends an `import` operation with the parsed `cells`; parse/validation errors go to `#import-error`.
- Hovering a cell shows its coordinates in `#coords` as `"x, y"`.
- Design: dark UI around a bright grid, clear active states, usable at 800 px width.

## Tests

Visible tests: `tests/api.test.js` (Jest + Supertest) and `tests/ui.test.js` (Playwright, server on port 3000). Do not modify them. Hidden tests cover the rest of the spec — flood-fill semantics, the no-op rule, redo invalidation, the 50-step cap, saves/load/import in history, cell geometry — so follow the spec exactly.
