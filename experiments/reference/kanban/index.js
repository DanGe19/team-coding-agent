// Reference implementation of the Kanban spec (used only to validate the tests
// and as a base for planting bugs). The agent never sees this file.
const express = require('express');
const path = require('path');

const COLUMNS = ['todo', 'doing', 'done'];
const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

let cards = [];
let nextId = 1;

const bad = (res, msg) => res.status(400).json({ error: msg });
const byCol = col => cards.filter(c => c.column === col).sort((a, b) => a.position - b.position);
const renumber = col => byCol(col).forEach((c, i) => { c.position = i; });
const validTitle = t => typeof t === 'string' && t.trim().length > 0 && t.trim().length <= 100;

app.get('/api/board', (req, res) => {
  res.json(Object.fromEntries(COLUMNS.map(c => [c, byCol(c)])));
});

app.get('/api/cards', (req, res) => {
  res.json(COLUMNS.flatMap(byCol));
});

app.post('/api/cards', (req, res) => {
  const { title, column = 'todo' } = req.body || {};
  if (!validTitle(title)) return bad(res, 'title must be a non-empty string of at most 100 characters');
  if (!COLUMNS.includes(column)) return bad(res, 'column must be one of todo, doing, done');
  const card = { id: nextId++, title: title.trim(), column, position: byCol(column).length,
                 createdAt: new Date().toISOString() };
  cards.push(card);
  res.status(201).json(card);
});

app.patch('/api/cards/:id', (req, res) => {
  const card = cards.find(c => c.id === Number(req.params.id));
  if (!card) return res.status(404).json({ error: 'Card not found' });
  const { title, column, position } = req.body || {};
  if (title !== undefined && !validTitle(title)) return bad(res, 'invalid title');
  if (column !== undefined && !COLUMNS.includes(column)) return bad(res, 'invalid column');
  if (position !== undefined && !Number.isInteger(position)) return bad(res, 'position must be an integer');

  if (title !== undefined) card.title = title.trim();
  if (column !== undefined && column !== card.column) {
    const from = card.column;
    card.column = column;
    card.position = byCol(column).length; // end of target (card already counted) -> fix below
    renumber(from);
    renumber(column);
  }
  if (position !== undefined) {
    const list = byCol(card.column).filter(c => c.id !== card.id);
    const idx = Math.max(0, Math.min(position, list.length));
    list.splice(idx, 0, card);
    list.forEach((c, i) => { c.position = i; });
  }
  res.json(card);
});

app.delete('/api/cards/:id', (req, res) => {
  const idx = cards.findIndex(c => c.id === Number(req.params.id));
  if (idx < 0) return res.status(404).json({ error: 'Card not found' });
  const [removed] = cards.splice(idx, 1);
  renumber(removed.column);
  res.status(204).end();
});

app.delete('/api/cards', (req, res) => { cards = []; nextId = 1; res.status(204).end(); });

if (require.main === module) app.listen(3000, () => console.log('kanban on :3000'));
module.exports = app;
