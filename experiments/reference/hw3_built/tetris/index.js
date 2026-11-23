const express = require('express');
const path = require('path');

const app = express();
const PORT = 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ── In-memory leaderboard ─────────────────────────────────────────────────
let scores = [];
let nextId = 1;

// POST /api/score - submit a score
app.post('/api/score', (req, res) => {
  const { name, score, lines, level } = req.body || {};

  // Validate name
  if (typeof name !== 'string' || name.trim().length === 0) {
    return res.status(400).json({ error: 'name must be a non-empty string' });
  }
  const trimmedName = name.trim().slice(0, 20);

  // Validate score
  if (!Number.isInteger(score) || score < 0) {
    return res.status(400).json({ error: 'score must be an integer >= 0' });
  }

  // Validate lines
  if (!Number.isInteger(lines) || lines < 0) {
    return res.status(400).json({ error: 'lines must be an integer >= 0' });
  }

  // Validate level
  if (!Number.isInteger(level) || level < 1) {
    return res.status(400).json({ error: 'level must be an integer >= 1' });
  }

  const entry = {
    id: nextId++,
    name: trimmedName,
    score,
    lines,
    level,
    timestamp: new Date().toISOString(),
  };

  scores.push(entry);
  return res.status(201).json(entry);
});

// GET /api/scores - get top 10 scores
app.get('/api/scores', (req, res) => {
  const sorted = [...scores].sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    if (b.lines !== a.lines) return b.lines - a.lines;
    return new Date(a.timestamp) - new Date(b.timestamp);
  });
  return res.status(200).json(sorted.slice(0, 10));
});

// DELETE /api/scores - clear all scores
app.delete('/api/scores', (req, res) => {
  scores = [];
  return res.status(200).json({ message: 'All scores deleted' });
});

module.exports = app;

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`Side Tetris server running on http://localhost:${PORT}`);
  });
}
