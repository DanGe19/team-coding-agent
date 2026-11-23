const request = require('supertest');
const app = require('../../index');

const post = (url, body) => request(app).post(url).send(body);
const game = (date, home, away, hs, as) => post('/api/games', { date, homeTeam: home, awayTeam: away, homeScore: hs, awayScore: as });
const standings = () => request(app).get('/api/standings').then(r => r.body);
const row = (conf, id) => standings().then(s => s[conf].find(r => r.id === id));

beforeEach(async () => { await request(app).post('/api/reset'); });

describe('Standings API (hidden): sample season math', () => {
  beforeEach(async () => { await post('/api/import-sample'); });

  test('East order, GB and zones match the expected table', async () => {
    const east = (await standings()).East;
    expect(east.map(r => r.id)).toEqual(['PHI', 'IND', 'ATL', 'MIL', 'BKN', 'CHA', 'TOR', 'ORL', 'NYK', 'BOS', 'CLE', 'WAS', 'DET', 'MIA', 'CHI']);
    expect(east.map(r => r.gb)).toEqual([0, 0.5, 0.5, 0.5, 1, 1.5, 2, 2, 2.5, 3, 3, 3, 3, 3.5, 4]);
    expect(east.map(r => r.zone)).toEqual([...Array(6).fill('playoff'), ...Array(4).fill('play-in'), ...Array(5).fill('out')]);
    expect(east.map(r => r.rank)).toEqual([...Array(15).keys()].map(i => i + 1));
  });

  test('tie-breaks: equal pct by diff (IND>ATL>MIL), equal diff by id (CLE before WAS)', async () => {
    const east = (await standings()).East;
    const byId = Object.fromEntries(east.map(r => [r.id, r]));
    expect([byId.IND.pct, byId.ATL.pct, byId.MIL.pct]).toEqual([0.6, 0.6, 0.6]);
    expect([byId.IND.diff, byId.ATL.diff, byId.MIL.diff]).toEqual([43, 30, 8]);
    expect([byId.CLE.pct, byId.WAS.pct, byId.CLE.diff, byId.WAS.diff]).toEqual([0.333, 0.333, 0, 0]);
    expect(byId.CLE.rank).toBe(11); expect(byId.WAS.rank).toBe(12);
  });

  test('West: records, home/away splits, last10, streaks', async () => {
    const west = (await standings()).West;
    expect(west.slice(0, 3).map(r => r.id)).toEqual(['POR', 'DEN', 'PHX']);
    const byId = Object.fromEntries(west.map(r => [r.id, r]));
    expect(byId.POR).toMatchObject({ w: 8, l: 1, pct: 0.889, diff: 72, home: '3-0', away: '5-1', last10: '8-1', streak: 'W3' });
    expect(byId.PHX).toMatchObject({ w: 7, l: 2, streak: 'W6', gb: 1 });
    expect(byId.NOP).toMatchObject({ w: 5, l: 4, streak: 'W5', rank: 8, zone: 'play-in' });
    expect(byId.LAL).toMatchObject({ w: 2, l: 7, gb: 6, rank: 15, zone: 'out', streak: 'L3' });
    expect(byId.GSW).toMatchObject({ rank: 10, zone: 'play-in', home: '4-2', away: '0-3' });
    expect(byId.MEM).toMatchObject({ rank: 11, zone: 'out' });
  });

  test('player averages and ordering; players keep file ids and injuries', async () => {
    const players = (await request(app).get('/api/players')).body;
    expect(players).toHaveLength(90);
    expect(players[0]).toMatchObject({ name: 'Nico Bishop', ppg: 25.9 });
    expect(players[1].ppg).toBe(23.6); expect(players[2].ppg).toBe(23.6);
    expect(players[1].id).toBeLessThan(players[2].id);
    const p1 = players.find(p => p.id === 1);
    expect(p1).toMatchObject({ name: 'Andre Hayes', teamId: 'BOS', position: 'PG', gp: 9, ppg: 16.6, rpg: 6.0, apg: 4.3 });
    const p5 = players.find(p => p.id === 5);
    expect(p5).toMatchObject({ injury: { status: 'out', note: 'Sprained ankle', expectedReturn: '2026-12-15' }, gp: 0, ppg: 0 });
    const out = (await request(app).get('/api/players?status=out')).body;
    expect(out.map(p => p.id).sort()).toEqual([5, 71]);
    const atlSF = (await request(app).get('/api/players?team=ATL&position=SF')).body;
    expect(atlSF.map(p => p.id)).toEqual([32]);
  });

  test('team detail: roster sorted by number, games newest first', async () => {
    const t = (await request(app).get('/api/teams/BOS')).body;
    expect(t).toMatchObject({ w: 3, l: 6, streak: 'W1', home: '3-3', away: '0-3' });
    expect(t.roster).toHaveLength(3);
    const nums = t.roster.map(p => p.number);
    expect(nums).toEqual([...nums].sort((a, b) => a - b));
    expect(t.games).toHaveLength(9);
    for (let i = 1; i < t.games.length; i++) expect(t.games[i - 1].date >= t.games[i].date).toBe(true);
    expect((await request(app).get('/api/teams/XXX')).status).toBe(404);
  });

  test('injury report ordering and reset', async () => {
    const inj = (await request(app).get('/api/injuries')).body;
    expect(inj.map(p => [p.id, p.injury.status])).toEqual([[5, 'out'], [71, 'out'], [32, 'day-to-day']]);
    expect(inj[0].teamName).toBe('Brooklyn Nets');
    expect((await post('/api/reset')).status).toBe(204);
    expect((await request(app).get('/api/players')).body).toHaveLength(0);
    expect((await request(app).get('/api/teams')).body).toHaveLength(30);
    const s = await standings();
    expect(s.East.every(r => r.gp === 0 && r.gb === 0)).toBe(true);
  });
});

describe('Standings API (hidden): incremental behaviour', () => {
  test('streak, last10 and GB evolve correctly; deleting a game rolls back', async () => {
    // BOS: W, W, L, W  (by date; ids out of order on purpose)
    await game('2026-11-03', 'BOS', 'NYK', 100, 90);   // id1 W
    await game('2026-11-01', 'BOS', 'PHI', 100, 90);   // id2 W
    await game('2026-11-04', 'MIA', 'BOS', 100, 90);   // id3 L (away)
    await game('2026-11-02', 'BOS', 'TOR', 99, 100);   // id4 L (home)  -> order by date: W(2) L(4) W(1) L(3)
    let bos = await row('East', 'BOS');
    expect(bos).toMatchObject({ w: 2, l: 2, pct: 0.5, streak: 'L1', last10: '2-2', home: '2-1', away: '0-1', diff: 9 });
    await game('2026-11-05', 'BOS', 'CHI', 120, 100);
    await game('2026-11-06', 'BOS', 'CHI', 120, 100);
    bos = await row('East', 'BOS');
    expect(bos.streak).toBe('W2');
    expect((await request(app).delete('/api/games/6')).status).toBe(204);
    bos = await row('East', 'BOS');
    expect(bos).toMatchObject({ w: 3, l: 2, streak: 'W1' });
    expect((await request(app).delete('/api/games/6')).status).toBe(404);
  });

  test('last10 only counts the most recent ten games', async () => {
    for (let d = 1; d <= 12; d++) await game(`2026-11-${String(d).padStart(2, '0')}`, 'LAL', 'LAC', d <= 2 ? 90 : 100, 95);
    const lal = await row('West', 'LAL');
    expect(lal).toMatchObject({ w: 10, l: 2, last10: '10-0', streak: 'W10', gp: 12 });
    const lac = await row('West', 'LAC');
    expect(lac).toMatchObject({ w: 2, l: 10, last10: '0-10', streak: 'L10', gb: 8 });
  });

  test('GB with uneven games played and conference isolation', async () => {
    await game('2026-11-01', 'DEN', 'UTA', 100, 90);
    await game('2026-11-02', 'DEN', 'UTA', 100, 90);
    await game('2026-11-03', 'DEN', 'UTA', 100, 90);   // DEN 3-0, UTA 0-3
    await game('2026-11-04', 'LAL', 'BOS', 100, 90);   // LAL 1-0 (west), BOS 0-1 (east)
    const s = await standings();
    const w = Object.fromEntries(s.West.map(r => [r.id, r]));
    expect(w.DEN).toMatchObject({ rank: 1, gb: 0 });
    expect(w.LAL).toMatchObject({ rank: 2, gb: 1 });      // ((3-1)+(0-0))/2
    expect(w.UTA).toMatchObject({ gb: 3 });               // ((3-0)+(3-0))/2
    const e = Object.fromEntries(s.East.map(r => [r.id, r]));
    expect(e.BOS).toMatchObject({ rank: 15, gb: 0.5 });   // leader 0-0: ((0-0)+(1-0))/2
    expect(s.East.find(r => r.id === 'LAL')).toBeUndefined();
  });

  test('stat lines: replace on repeat, wrong team, player deletion cleans up', async () => {
    const g = (await game('2026-11-01', 'BOS', 'NYK', 100, 90)).body;
    const a = (await post('/api/players', { name: 'A', teamId: 'BOS', position: 'C', number: 1 })).body;
    const b = (await post('/api/players', { name: 'B', teamId: 'MIA', position: 'C', number: 2 })).body;
    expect((await post(`/api/games/${g.id}/stats`, { playerId: b.id, points: 1, rebounds: 1, assists: 1 })).status).toBe(400);
    expect((await post(`/api/games/${g.id}/stats`, { playerId: 99, points: 1, rebounds: 1, assists: 1 })).status).toBe(404);
    expect((await post(`/api/games/99/stats`, { playerId: a.id, points: 1, rebounds: 1, assists: 1 })).status).toBe(404);
    expect((await post(`/api/games/${g.id}/stats`, { playerId: a.id, points: -1, rebounds: 1, assists: 1 })).status).toBe(400);
    await post(`/api/games/${g.id}/stats`, { playerId: a.id, points: 10, rebounds: 2, assists: 3 });
    await post(`/api/games/${g.id}/stats`, { playerId: a.id, points: 30, rebounds: 2, assists: 3 });
    const lines = (await request(app).get(`/api/games/${g.id}/stats`)).body;
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ points: 30, playerName: 'A', teamId: 'BOS' });
    expect((await request(app).get('/api/players?team=BOS')).body[0].ppg).toBe(30);
    expect((await request(app).delete(`/api/players/${a.id}`)).status).toBe(204);
    expect((await request(app).get(`/api/games/${g.id}/stats`)).body).toHaveLength(0);
    await request(app).delete(`/api/games/${g.id}`);
    expect((await request(app).get(`/api/games/${g.id}/stats`)).status).toBe(404);
  });

  test('player validation and partial injury PATCH', async () => {
    expect((await post('/api/players', { name: '', teamId: 'BOS', position: 'PG', number: 1 })).status).toBe(400);
    expect((await post('/api/players', { name: 'x', teamId: 'ZZZ', position: 'PG', number: 1 })).status).toBe(400);
    expect((await post('/api/players', { name: 'x', teamId: 'BOS', position: 'G', number: 1 })).status).toBe(400);
    expect((await post('/api/players', { name: 'x', teamId: 'BOS', position: 'PG', number: 100 })).status).toBe(400);
    const p = (await post('/api/players', { name: 'x', teamId: 'BOS', position: 'PG', number: 99 })).body;
    expect((await request(app).patch(`/api/players/${p.id}`).send({ injury: { status: 'hurt' } })).status).toBe(400);
    expect((await request(app).patch(`/api/players/${p.id}`).send({ injury: { status: 'out', expectedReturn: 'soon' } })).status).toBe(400);
    let r = await request(app).patch(`/api/players/${p.id}`).send({ injury: { status: 'day-to-day', note: 'Knee' } });
    expect(r.body.injury).toEqual({ status: 'day-to-day', note: 'Knee', expectedReturn: null });
    r = await request(app).patch(`/api/players/${p.id}`).send({ injury: { expectedReturn: '2026-12-01' }, number: 23 });
    expect(r.body.injury).toEqual({ status: 'day-to-day', note: 'Knee', expectedReturn: '2026-12-01' });
    expect(r.body.number).toBe(23);
    expect((await request(app).patch('/api/players/999').send({ number: 1 })).status).toBe(404);
    expect((await request(app).get('/api/injuries')).body.map(x => x.id)).toEqual([p.id]);
  });

  test('games list filter and order', async () => {
    await game('2026-11-02', 'BOS', 'NYK', 100, 90);
    await game('2026-11-01', 'BOS', 'MIA', 100, 90);
    await game('2026-11-02', 'LAL', 'LAC', 100, 90);
    const all = (await request(app).get('/api/games')).body;
    expect(all.map(g => g.id)).toEqual([3, 1, 2]);
    const bos = (await request(app).get('/api/games?team=BOS')).body;
    expect(bos.map(g => g.id)).toEqual([1, 2]);
  });
});
