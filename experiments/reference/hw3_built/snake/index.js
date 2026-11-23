const express = require('express');
const path = require('path');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// In-memory leaderboard
let scores = [];
let nextId = 1;

// POST /api/score
app.post('/api/score', (req, res) => {
  const { name, score, length, level } = req.body;

  // Validate name
  if (name === undefined || name === null || typeof name !== 'string') {
    return res.status(400).json({ error: 'name must be a non-empty string' });
  }
  const trimmedName = name.trim();
  if (trimmedName.length === 0) {
    return res.status(400).json({ error: 'name must be a non-empty string' });
  }
  if (trimmedName.length > 20) {
    return res.status(400).json({ error: 'name must be at most 20 characters' });
  }

  // Validate score
  if (score === undefined || score === null || typeof score !== 'number' || !Number.isInteger(score) || score < 0) {
    return res.status(400).json({ error: 'score must be a non-negative integer' });
  }

  // Validate length
  if (length === undefined || length === null || typeof length !== 'number' || !Number.isInteger(length) || length < 1) {
    return res.status(400).json({ error: 'length must be an integer >= 1' });
  }

  // Validate level
  if (level === undefined || level === null || typeof level !== 'number' || !Number.isInteger(level) || level < 1) {
    return res.status(400).json({ error: 'level must be an integer >= 1' });
  }

  const entry = {
    id: nextId++,
    name: trimmedName,
    score,
    length,
    level,
    timestamp: new Date().toISOString(),
  };
  scores.push(entry);
  return res.status(201).json(entry);
});

// GET /api/scores
app.get('/api/scores', (req, res) => {
  const sorted = [...scores].sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    if (b.length !== a.length) return b.length - a.length;
    return new Date(a.timestamp) - new Date(b.timestamp);
  });
  return res.status(200).json(sorted.slice(0, 10));
});

// DELETE /api/scores
app.delete('/api/scores', (req, res) => {
  scores = [];
  return res.status(200).json({ message: 'All scores deleted' });
});

module.exports = app;

if (require.main === module) {
  app.listen(3000, () => {
    console.log('Portal Snake server running on port 3000');
  });
}
