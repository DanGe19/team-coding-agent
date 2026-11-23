const request = require('supertest');
const app = require('../index');

beforeEach(async () => { await request(app).post('/api/reset'); });

describe('Standings API (visible)', () => {
  test('30 teams exist with empty records after reset', async () => {
    const res = await request(app).get('/api/teams');
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(30);
    const bos = res.body.find(t => t.id === 'BOS');
    expect(bos).toMatchObject({ name: 'Boston Celtics', conference: 'East', division: 'Atlantic', w: 0, l: 0, pct: 0, streak: '-', last10: '0-0' });
  });

  test('posting a game updates both records and the standings', async () => {
    const g = await request(app).post('/api/games').send({ date: '2026-11-01', homeTeam: 'BOS', awayTeam: 'NYK', homeScore: 110, awayScore: 102 });
    expect(g.status).toBe(201);
    expect(g.body.id).toBe(1);
    const east = (await request(app).get('/api/standings')).body.East;
    expect(east[0]).toMatchObject({ id: 'BOS', w: 1, l: 0, pct: 1, gb: 0, rank: 1, zone: 'playoff', home: '1-0', streak: 'W1', diff: 8 });
    const nyk = east.find(r => r.id === 'NYK');
    expect(nyk).toMatchObject({ w: 0, l: 1, rank: 15, zone: 'out', away: '0-1', streak: 'L1', gb: 1 });
  });

  test('game validation: tie, same team, bad date', async () => {
    const base = { date: '2026-11-01', homeTeam: 'BOS', awayTeam: 'NYK', homeScore: 100, awayScore: 100 };
    expect((await request(app).post('/api/games').send(base)).status).toBe(400);
    expect((await request(app).post('/api/games').send({ ...base, awayScore: 99, awayTeam: 'BOS' })).status).toBe(400);
    expect((await request(app).post('/api/games').send({ ...base, awayScore: 99, date: '11/01/2026' })).status).toBe(400);
  });

  test('players: create, averages from stat lines, injured-out players cannot get stats', async () => {
    const p = (await request(app).post('/api/players').send({ name: 'Test Guard', teamId: 'BOS', position: 'PG', number: 7 })).body;
    expect(p).toMatchObject({ id: 1, injury: { status: 'healthy', note: '', expectedReturn: null }, gp: 0, ppg: 0 });
    const g = (await request(app).post('/api/games').send({ date: '2026-11-01', homeTeam: 'BOS', awayTeam: 'NYK', homeScore: 110, awayScore: 102 })).body;
    expect((await request(app).post(`/api/games/${g.id}/stats`).send({ playerId: p.id, points: 21, rebounds: 4, assists: 9 })).status).toBe(201);
    expect((await request(app).get('/api/players')).body[0]).toMatchObject({ gp: 1, ppg: 21, rpg: 4, apg: 9 });
    await request(app).patch(`/api/players/${p.id}`).send({ injury: { status: 'out', note: 'Ankle' } });
    const g2 = (await request(app).post('/api/games').send({ date: '2026-11-02', homeTeam: 'NYK', awayTeam: 'BOS', homeScore: 90, awayScore: 95 })).body;
    expect((await request(app).post(`/api/games/${g2.id}/stats`).send({ playerId: p.id, points: 10, rebounds: 1, assists: 1 })).status).toBe(400);
  });

  test('import-sample loads the season', async () => {
    const res = await request(app).post('/api/import-sample');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ teams: 30, players: 90, games: 140, stats: 822 });
    const west = (await request(app).get('/api/standings')).body.West;
    expect(west[0]).toMatchObject({ id: 'POR', w: 8, l: 1 });
  });
});
