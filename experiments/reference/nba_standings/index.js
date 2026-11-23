// Reference implementation of the League Standings Tracker spec. Never shown to the agent.
const express = require('express');
const path = require('path');
const fs = require('fs');

const SAMPLE_PATH = path.join(__dirname, 'data', 'sample_season.json');
const POSITIONS = ['PG', 'SG', 'SF', 'PF', 'C'];
const STATUSES = ['healthy', 'day-to-day', 'out'];
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const db = { teams: [], games: [], players: [], stats: [], nextGame: 1, nextPlayer: 1 };
db.teams = JSON.parse(fs.readFileSync(SAMPLE_PATH, 'utf8')).teams;
const teamIds = () => db.teams.map(t => t.id);

// ----------------------------------------------------------------- computed
function teamRecord(id) {
  const games = db.games.filter(g => g.homeTeam === id || g.awayTeam === id)
    .sort((a, b) => a.date.localeCompare(b.date) || a.id - b.id);
  let w = 0, l = 0, hw = 0, hl = 0, aw = 0, al = 0, pf = 0, pa = 0;
  const results = [];
  for (const g of games) {
    const home = g.homeTeam === id;
    const mine = home ? g.homeScore : g.awayScore, theirs = home ? g.awayScore : g.homeScore;
    pf += mine; pa += theirs;
    const won = mine > theirs;
    results.push(won ? 'W' : 'L');
    if (won) { w++; home ? hw++ : aw++; } else { l++; home ? hl++ : al++; }
  }
  const gp = w + l;
  const last = results.slice(-10);
  let streak = '-';
  if (results.length) {
    const c = results[results.length - 1]; let n = 0;
    for (let i = results.length - 1; i >= 0 && results[i] === c; i--) n++;
    streak = c + n;
  }
  return { w, l, gp, pct: gp ? Math.round((w / gp) * 1000) / 1000 : 0, home: `${hw}-${hl}`, away: `${aw}-${al}`,
           pointsFor: pf, pointsAgainst: pa, diff: pf - pa,
           last10: `${last.filter(r => r === 'W').length}-${last.filter(r => r === 'L').length}`, streak };
}
const teamWithRecord = t => ({ ...t, ...teamRecord(t.id) });

function standings() {
  const out = {};
  for (const conf of ['East', 'West']) {
    const rows = db.teams.filter(t => t.conference === conf).map(teamWithRecord)
      .sort((a, b) => b.pct - a.pct || b.diff - a.diff || a.id.localeCompare(b.id));
    const lead = rows[0];
    out[conf] = rows.map((r, i) => ({
      ...r, rank: i + 1,
      gb: Math.round((((lead.w - r.w) + (r.l - lead.l)) / 2) * 10) / 10,
      zone: i < 6 ? 'playoff' : i < 10 ? 'play-in' : 'out',
    }));
  }
  return out;
}

function playerAverages(pid) {
  const lines = db.stats.filter(s => s.playerId === pid);
  const gp = lines.length;
  const avg = k => gp ? Math.round(lines.reduce((n, s) => n + s[k], 0) / gp * 10) / 10 : 0;
  return { gp, ppg: avg('points'), rpg: avg('rebounds'), apg: avg('assists') };
}
const playerView = p => ({ ...p, ...playerAverages(p.id) });
const sortPlayers = arr => arr.sort((a, b) => b.ppg - a.ppg || a.id - b.id);

// ------------------------------------------------------------------- helpers
const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
const bad = (res, m) => res.status(400).json({ error: m });
const nf = (res, what) => res.status(404).json({ error: `${what} not found` });
const isNonNegInt = v => Number.isInteger(v) && v >= 0;
const findTeam = id => db.teams.find(t => t.id === id);
const findGame = id => db.games.find(g => g.id === Number(id));
const findPlayer = id => db.players.find(p => p.id === Number(id));

function validatePlayerFields(b, partial) {
  if (!partial || b.name !== undefined) {
    if (typeof b.name !== 'string' || !b.name.trim() || b.name.trim().length > 60) return 'name must be 1-60 characters';
  }
  if (!partial || b.teamId !== undefined) { if (!findTeam(b.teamId)) return 'unknown teamId'; }
  if (!partial || b.position !== undefined) { if (!POSITIONS.includes(b.position)) return 'position must be PG, SG, SF, PF or C'; }
  if (!partial || b.number !== undefined) { if (!Number.isInteger(b.number) || b.number < 0 || b.number > 99) return 'number must be 0-99'; }
  return null;
}

// -------------------------------------------------------------------- routes
app.get('/api/teams', (req, res) => res.json(db.teams.map(teamWithRecord)));
app.get('/api/teams/:id', (req, res) => {
  const t = findTeam(req.params.id); if (!t) return nf(res, 'Team');
  const roster = db.players.filter(p => p.teamId === t.id).map(playerView).sort((a, b) => a.number - b.number || a.id - b.id);
  const games = db.games.filter(g => g.homeTeam === t.id || g.awayTeam === t.id)
    .sort((a, b) => b.date.localeCompare(a.date) || b.id - a.id);
  res.json({ ...teamWithRecord(t), roster, games });
});
app.get('/api/standings', (req, res) => res.json(standings()));

app.get('/api/games', (req, res) => {
  let games = db.games;
  if (req.query.team) games = games.filter(g => g.homeTeam === req.query.team || g.awayTeam === req.query.team);
  res.json([...games].sort((a, b) => b.date.localeCompare(a.date) || b.id - a.id));
});
app.post('/api/games', (req, res) => {
  const { date, homeTeam, awayTeam, homeScore, awayScore } = req.body || {};
  if (typeof date !== 'string' || !DATE_RE.test(date) || isNaN(Date.parse(date))) return bad(res, 'date must be YYYY-MM-DD');
  if (!findTeam(homeTeam) || !findTeam(awayTeam)) return bad(res, 'unknown team');
  if (homeTeam === awayTeam) return bad(res, 'a team cannot play itself');
  if (!isNonNegInt(homeScore) || !isNonNegInt(awayScore)) return bad(res, 'scores must be non-negative integers');
  if (homeScore === awayScore) return bad(res, 'games cannot end tied');
  const game = { id: db.nextGame++, date, homeTeam, awayTeam, homeScore, awayScore };
  db.games.push(game);
  res.status(201).json(game);
});
app.delete('/api/games/:id', (req, res) => {
  const g = findGame(req.params.id); if (!g) return nf(res, 'Game');
  db.games = db.games.filter(x => x !== g);
  db.stats = db.stats.filter(s => s.gameId !== g.id);
  res.status(204).end();
});

app.get('/api/players', (req, res) => {
  let ps = db.players;
  if (req.query.team) ps = ps.filter(p => p.teamId === req.query.team);
  if (req.query.position) ps = ps.filter(p => p.position === req.query.position);
  if (req.query.status) ps = ps.filter(p => p.injury.status === req.query.status);
  res.json(sortPlayers(ps.map(playerView)));
});
app.post('/api/players', (req, res) => {
  const b = req.body || {};
  const err = validatePlayerFields(b, false); if (err) return bad(res, err);
  const p = { id: db.nextPlayer++, name: b.name.trim(), teamId: b.teamId, position: b.position, number: b.number,
              injury: { status: 'healthy', note: '', expectedReturn: null } };
  db.players.push(p);
  res.status(201).json(playerView(p));
});
app.patch('/api/players/:id', (req, res) => {
  const p = findPlayer(req.params.id); if (!p) return nf(res, 'Player');
  const b = req.body || {};
  const err = validatePlayerFields(b, true); if (err) return bad(res, err);
  if (b.injury !== undefined) {
    if (typeof b.injury !== 'object' || b.injury === null) return bad(res, 'injury must be an object');
    const inj = { ...p.injury, ...b.injury };
    if (!STATUSES.includes(inj.status)) return bad(res, 'injury.status must be healthy, day-to-day or out');
    if (typeof inj.note !== 'string') return bad(res, 'injury.note must be a string');
    if (inj.expectedReturn !== null && (typeof inj.expectedReturn !== 'string' || !DATE_RE.test(inj.expectedReturn)))
      return bad(res, 'injury.expectedReturn must be YYYY-MM-DD or null');
    p.injury = inj;
  }
  if (b.name !== undefined) p.name = b.name.trim();
  if (b.teamId !== undefined) p.teamId = b.teamId;
  if (b.position !== undefined) p.position = b.position;
  if (b.number !== undefined) p.number = b.number;
  res.json(playerView(p));
});
app.delete('/api/players/:id', (req, res) => {
  const p = findPlayer(req.params.id); if (!p) return nf(res, 'Player');
  db.players = db.players.filter(x => x !== p);
  db.stats = db.stats.filter(s => s.playerId !== p.id);
  res.status(204).end();
});

app.get('/api/games/:id/stats', (req, res) => {
  const g = findGame(req.params.id); if (!g) return nf(res, 'Game');
  res.json(db.stats.filter(s => s.gameId === g.id).map(s => {
    const p = findPlayer(s.playerId);
    return { ...s, playerName: p ? p.name : null, teamId: p ? p.teamId : null };
  }));
});
app.post('/api/games/:id/stats', (req, res) => {
  const g = findGame(req.params.id); if (!g) return nf(res, 'Game');
  const { playerId, points, rebounds, assists } = req.body || {};
  const p = findPlayer(playerId); if (!p) return nf(res, 'Player');
  if (![points, rebounds, assists].every(isNonNegInt)) return bad(res, 'points, rebounds and assists must be non-negative integers');
  if (p.teamId !== g.homeTeam && p.teamId !== g.awayTeam) return bad(res, 'player is not on either team in this game');
  if (p.injury.status === 'out') return bad(res, 'player is out injured');
  db.stats = db.stats.filter(s => !(s.gameId === g.id && s.playerId === p.id));
  const line = { gameId: g.id, playerId: p.id, points, rebounds, assists };
  db.stats.push(line);
  res.status(201).json(line);
});

app.get('/api/injuries', (req, res) => {
  const order = { out: 0, 'day-to-day': 1 };
  const rows = db.players.filter(p => p.injury.status !== 'healthy')
    .sort((a, b) => order[a.injury.status] - order[b.injury.status] || a.teamId.localeCompare(b.teamId) || a.name.localeCompare(b.name))
    .map(p => ({ ...playerView(p), teamName: findTeam(p.teamId).name }));
  res.json(rows);
});

function resetData() { db.games = []; db.players = []; db.stats = []; db.nextGame = 1; db.nextPlayer = 1; }
app.post('/api/reset', (req, res) => { resetData(); res.status(204).end(); });
app.post('/api/import-sample', (req, res) => {
  resetData();
  const data = JSON.parse(fs.readFileSync(SAMPLE_PATH, 'utf8'));
  db.players = data.players.map(p => ({ ...p, injury: { ...p.injury } }));
  db.nextPlayer = Math.max(0, ...db.players.map(p => p.id)) + 1;
  db.games = data.games.map(g => ({ ...g }));
  db.nextGame = Math.max(0, ...db.games.map(g => g.id)) + 1;
  db.stats = data.stats.map(s => ({ ...s }));
  res.json({ teams: db.teams.length, players: db.players.length, games: db.games.length, stats: db.stats.length });
});

if (require.main === module) app.listen(3000, () => console.log('standings on :3000'));
module.exports = app;
