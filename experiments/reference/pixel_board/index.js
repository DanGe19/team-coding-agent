// Reference implementation of the Pixel Board spec. Never shown to the agent.
const express = require('express');
const path = require('path');

const W = 16, H = 16, N = W * H, LIMIT = 50;
const PALETTE = ['#000000', '#ffffff', '#e4002b', '#f28c00', '#ffd400', '#2bb673', '#1f6feb', '#8e44ad'];

const st = { cells: Array(N).fill(null), undo: [], redo: [], saves: [], nextSave: 1 };

const validColor = c => c === null || (Number.isInteger(c) && c >= 0 && c < PALETTE.length);
const validCoord = (v, max) => Number.isInteger(v) && v >= 0 && v < max;
const validCells = a => Array.isArray(a) && a.length === N && a.every(validColor);

function boardState() {
  return { width: W, height: H, palette: PALETTE, cells: [...st.cells],
           canUndo: st.undo.length > 0, canRedo: st.redo.length > 0,
           undoDepth: st.undo.length, redoDepth: st.redo.length, historyLimit: LIMIT };
}

// Apply `fn` to a copy; commit only if something changed.
function applyOp(type, fn) {
  const next = [...st.cells];
  fn(next);
  let changed = 0;
  for (let i = 0; i < N; i++) if (next[i] !== st.cells[i]) changed++;
  if (changed) {
    st.undo.push(st.cells);
    if (st.undo.length > LIMIT) st.undo.shift();
    st.redo = [];
    st.cells = next;
  }
  return { changed: changed > 0, type, cellsChanged: changed, board: boardState() };
}

function floodFill(cells, x, y, color) {
  const target = cells[y * W + x];
  if (target === color) return;
  const stack = [[x, y]];
  while (stack.length) {
    const [cx, cy] = stack.pop();
    if (cx < 0 || cy < 0 || cx >= W || cy >= H) continue;
    const i = cy * W + cx;
    if (cells[i] !== target) continue;
    cells[i] = color;
    stack.push([cx + 1, cy], [cx - 1, cy], [cx, cy + 1], [cx, cy - 1]);
  }
}

const app = express();
app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(__dirname, 'public')));
const bad = (res, m) => res.status(400).json({ error: m });

app.get('/api/board', (req, res) => res.json(boardState()));

app.post('/api/ops', (req, res) => {
  const b = req.body || {};
  const { type, x, y, color } = b;
  switch (type) {
    case 'paint':
      if (!validCoord(x, W) || !validCoord(y, H)) return bad(res, 'x and y must be 0..15');
      if (!validColor(color)) return bad(res, 'color must be 0..7 or null');
      return res.json(applyOp(type, c => { c[y * W + x] = color; }));
    case 'fill':
      if (!validCoord(x, W) || !validCoord(y, H)) return bad(res, 'x and y must be 0..15');
      if (!validColor(color)) return bad(res, 'color must be 0..7 or null');
      return res.json(applyOp(type, c => floodFill(c, x, y, color)));
    case 'row':
      if (!validCoord(y, H)) return bad(res, 'y must be 0..15');
      if (!validColor(color)) return bad(res, 'color must be 0..7 or null');
      return res.json(applyOp(type, c => { for (let i = 0; i < W; i++) c[y * W + i] = color; }));
    case 'col':
      if (!validCoord(x, W)) return bad(res, 'x must be 0..15');
      if (!validColor(color)) return bad(res, 'color must be 0..7 or null');
      return res.json(applyOp(type, c => { for (let j = 0; j < H; j++) c[j * W + x] = color; }));
    case 'clear':
      return res.json(applyOp(type, c => c.fill(null)));
    case 'import':
      if (!validCells(b.cells)) return bad(res, 'cells must be an array of 256 values in 0..7 or null');
      return res.json(applyOp(type, c => { for (let i = 0; i < N; i++) c[i] = b.cells[i]; }));
    default:
      return bad(res, 'unknown op type');
  }
});

app.post('/api/undo', (req, res) => {
  if (!st.undo.length) return res.json({ changed: false, board: boardState() });
  st.redo.push(st.cells); st.cells = st.undo.pop();
  res.json({ changed: true, board: boardState() });
});
app.post('/api/redo', (req, res) => {
  if (!st.redo.length) return res.json({ changed: false, board: boardState() });
  st.undo.push(st.cells); st.cells = st.redo.pop();
  res.json({ changed: true, board: boardState() });
});
app.post('/api/reset', (req, res) => { st.cells = Array(N).fill(null); st.undo = []; st.redo = []; res.json(boardState()); });

app.get('/api/saves', (req, res) => res.json([...st.saves].reverse().map(({ cells, ...s }) => s)));
app.post('/api/saves', (req, res) => {
  const name = (req.body || {}).name;
  if (typeof name !== 'string' || !name.trim() || name.trim().length > 40) return bad(res, 'name must be 1-40 characters');
  if (st.saves.some(s => s.name === name.trim())) return bad(res, 'a save with that name already exists');
  const save = { id: st.nextSave++, name: name.trim(), createdAt: new Date().toISOString(), cells: [...st.cells] };
  st.saves.push(save);
  res.status(201).json(save);
});
const findSave = (req, res) => { const s = st.saves.find(x => x.id === Number(req.params.id)); if (!s) res.status(404).json({ error: 'Save not found' }); return s; };
app.get('/api/saves/:id', (req, res) => { const s = findSave(req, res); if (s) res.json(s); });
app.post('/api/saves/:id/load', (req, res) => { const s = findSave(req, res); if (s) res.json(applyOp('load', c => { for (let i = 0; i < N; i++) c[i] = s.cells[i]; })); });
app.delete('/api/saves/:id', (req, res) => { const s = findSave(req, res); if (s) { st.saves = st.saves.filter(x => x !== s); res.status(204).end(); } });
app.get('/api/export', (req, res) => res.json({ width: W, height: H, palette: PALETTE, cells: [...st.cells] }));

if (require.main === module) app.listen(3000, () => console.log('pixel board on :3000'));
module.exports = app;
