# Kanban Board - Build Instructions

Build a single-user Kanban board (like a very small Trello) with Node.js, Express and plain browser JavaScript (no frontend framework, no build step). Serve `public/` statically so `GET /` returns `public/index.html`. Put the server in `index.js`, listening on port 3000, and set `"start": "node index.js"` in `package.json`. Keep HTML, CSS and JS in separate files under `public/`.

## What the board does

- The board has **three fixed columns**: `todo`, `doing`, `done` (in that order, left to right).
- A **card** has an `id` (integer, unique, increasing from 1), a `title` (non-empty string, at most 100 characters), a `column` (one of the three names) and a `position` (integer, 0-based order inside its column) and `createdAt` (ISO timestamp).
- The user can: add a card to a column, move a card to another column (it goes to the **end** of the target column), move a card up/down inside its column, edit a card's title, and delete a card.
- Cards live in memory only. Restarting the server clears them.
- When a card is moved or deleted, the `position` values of the affected columns are renumbered so each column is always `0, 1, 2, ...` with no gaps.

## Frontend requirements (the UI tests rely on these ids and classes)

- Each column is an element with `class="column"` and `data-column="todo" | "doing" | "done"`. Inside it, a heading showing the column name and a count badge with `class="count"` (number of cards in the column).
- Each card is an element with `class="card"` and `data-id="<id>"`. It shows the title in an element with `class="card-title"`.
- Each card has buttons: `class="btn-left"` (move to previous column), `class="btn-right"` (move to next column), `class="btn-up"`, `class="btn-down"`, `class="btn-edit"`, `class="btn-delete"`. Buttons that make no sense (left on `todo`, right on `done`, up on the first card, down on the last) are `disabled`.
- Below each column there is a form with an input `class="new-card-input"` and a submit button `class="new-card-btn"`. Submitting adds a card to that column and clears the input. Empty titles are ignored.
- Editing: clicking `btn-edit` turns the title into an input `class="edit-input"` with the current title; pressing Enter saves, Escape cancels.
- The page loads existing cards on start and re-renders from the server after every change (no page reload). A manual refresh button `id="refresh"` reloads the board.
- Design: clean, modern, light theme, columns side by side, cards with subtle shadow. Must stay usable at 800px width.

## RESTful API

All request and response bodies are JSON. Validation errors return **400** with `{"error": "<message>"}`. Unknown card ids return **404** with `{"error": "Card not found"}`.

### GET /api/board
Returns all cards grouped by column, each list sorted by `position`:
```json
{ "todo": [card, ...], "doing": [...], "done": [...] }
```

### GET /api/cards
Returns a flat array of all cards sorted by column order (todo, doing, done) then position.

### POST /api/cards
Body: `{"title": "Write tests", "column": "todo"}`. `column` is optional and defaults to `"todo"`.
Returns **201** with the created card. The card is appended at the end of the column.
400 if `title` is missing, empty/whitespace, longer than 100 characters, or `column` is not one of the three names.

### PATCH /api/cards/:id
Body may contain any of: `"title"` (same validation as POST), `"column"` (move to the end of that column), `"position"` (integer; reorder within the current column, clamped to the valid range). If both `column` and `position` are given, move to that column and then to that position.
Returns **200** with the updated card. 400 for invalid values, 404 for unknown id.

### DELETE /api/cards/:id
Returns **204**. 404 for unknown id.

### DELETE /api/cards
Deletes all cards (for tests). Returns **204**.

## Tests

Visible tests are in `tests/api.test.js` (Jest + Supertest; it `require`s `../index`, so `index.js` must export the Express app and only call `listen` when run directly) and `tests/ui.test.js` (Playwright, needs the server on port 3000). Run them as you build and do not modify them. There are additional hidden tests that check the same specification more thoroughly, so follow the spec exactly, not just the visible tests.
