const request = require('supertest');
const app = require('../../index');

const reset = (seed = 1, leaveProbability = 0.1) => request(app).post('/api/reset').send({ seed, leaveProbability });
const tick = (n = 1) => request(app).post('/api/tick').send({ n });
const guests = (count, strategy) => request(app).post('/api/guests').send({ count, strategy });
const state = () => request(app).get('/api/state').then(r => r.body);
const byId = s => Object.fromEntries(s.rides.map(r => [r.id, r]));
const sleep = ms => new Promise(r => setTimeout(r, ms));

beforeEach(async () => { await reset(1, 0); });
afterAll(async () => { await request(app).post('/api/clock').send({ running: false }); });

describe('Park API (hidden): deterministic scenario, 30 "shortest" guests, no leaving', () => {
  test('tick 1: shortest strategy fills by live wait with data-order ties', async () => {
    await guests(30, 'shortest');
    const r = byId((await tick()).body);
    const q = Object.fromEntries(Object.values(r).map(x => [x.id, x.queueLength]));
    expect(q).toEqual({ 'mario-kart': 1, yoshi: 1, 'mine-cart': 13, 'wing-gliders': 8, 'dragon-rally': 1, 'fyre-drill': 1,
      stardust: 1, carousel: 1, monsters: 1, werewolf: 1, ministry: 1 });
    expect(r['mine-cart'].waitMinutes).toBe(6);       // ceil(13/12)*3
    expect(r['wing-gliders'].waitMinutes).toBe(3);
    expect(r['ministry'].waitMinutes).toBe(6);
  });

  test('tick 2: boarding up to capacity, cycle starts, wait includes cycleRemaining', async () => {
    await guests(30, 'shortest'); await tick();
    const s = (await tick()).body; const r = byId(s);
    expect(s.guests).toEqual({ total: 30, queued: 1, riding: 29, wandering: 0, left: 0 });
    expect(r['mine-cart']).toMatchObject({ queueLength: 1, cycleRemaining: 3, waitMinutes: 6 });
    expect(r['mine-cart'].riding).toHaveLength(12);
    expect(r['wing-gliders']).toMatchObject({ queueLength: 0, cycleRemaining: 3, waitMinutes: 3 });
    expect(r['ministry']).toMatchObject({ cycleRemaining: 6, waitMinutes: 6 });
  });

  test('tick 3-4: cycles count down, nobody boards while a cycle runs', async () => {
    await guests(30, 'shortest'); await tick(2);
    const r = byId((await tick(2)).body);
    expect(r['mine-cart']).toMatchObject({ queueLength: 1, cycleRemaining: 1, waitMinutes: 4 });
    expect(r['stardust'].cycleRemaining).toBe(1);
    expect(r['ministry'].cycleRemaining).toBe(4);
  });

  test('tick 5: riders finish, re-queue by shortest, totals and guest records update', async () => {
    await guests(30, 'shortest'); await tick(4);
    const s = (await tick()).body; const r = byId(s);
    expect(s.time).toBe(5);
    expect(r['mine-cart'].totalRiders).toBe(12);
    expect(r['wing-gliders'].totalRiders).toBe(8);
    expect(r['stardust'].totalRiders).toBe(1);
    expect(r['wing-gliders'].queueLength).toBe(13);
    expect(r['mine-cart']).toMatchObject({ queueLength: 1, cycleRemaining: 3 });
    expect(s.guests).toEqual({ total: 30, queued: 22, riding: 8, wandering: 0, left: 0 });
    expect((await request(app).get('/api/guests/3')).body).toMatchObject({ state: 'queued', rideId: 'wing-gliders', ridesTaken: 1 });
    expect((await request(app).get('/api/guests/23')).body).toMatchObject({ state: 'riding', rideId: 'mine-cart', ridesTaken: 0 });
    expect((await request(app).get('/api/guests/999')).status).toBe(404);
  });
});

describe('Park API (hidden): closing, seeds, clock, validation', () => {
  test('closing a ride empties its queue into wandering; riders finish; wanderers avoid it', async () => {
    await guests(30, 'shortest'); await tick(2);          // mine-cart: 12 riding, 1 queued
    const closed = (await request(app).post('/api/rides/mine-cart/status').send({ status: 'closed' })).body;
    expect(closed).toMatchObject({ status: 'closed', queueLength: 0, waitMinutes: null });
    expect(closed.riding).toHaveLength(12);
    let s = await state();
    expect(s.guests.wandering).toBe(1);
    s = (await tick()).body;                                // wanderer picks another open ride
    expect(byId(s)['mine-cart'].queueLength).toBe(0);
    expect(s.guests.wandering).toBe(0);
    s = (await tick(2)).body;                               // cycle ends at tick 5 even though closed? no: closed rides do not tick
    expect(byId(s)['mine-cart'].riding).toHaveLength(12);
    const reopened = (await request(app).post('/api/rides/mine-cart/status').send({ status: 'open' })).body;
    expect(reopened.status).toBe('open');
    expect(reopened.waitMinutes).toBe(reopened.cycleRemaining);
  });

  test('same seed → identical run; different seed → different run', async () => {
    const run = async seed => {
      await reset(seed, 0.1); await guests(200, 'random'); await tick(25);
      const s = await state();
      return JSON.stringify([s.rides.map(r => [r.queueLength, r.riding.length, r.totalRiders]), s.guests]);
    };
    const a = await run(7), b = await run(7), c = await run(8);
    expect(a).toBe(b);
    expect(a).not.toBe(c);
  });

  test('random guests all end up queued after one tick when nobody leaves', async () => {
    await guests(100, 'random');
    const s = (await tick()).body;
    expect(s.guests).toMatchObject({ queued: 100, left: 0 });
    expect(s.rides.reduce((n, r) => n + r.queueLength, 0)).toBe(100);
    s.rides.forEach(r => expect(r.waitMinutes).toBe(Math.ceil(r.queueLength / r.capacity) * r.duration));
  });

  test('leaveProbability 1 makes every wanderer leave', async () => {
    await reset(3, 1); await guests(20, 'random');
    const s = (await tick()).body;
    expect(s.guests).toEqual({ total: 20, queued: 0, riding: 0, wandering: 0, left: 20 });
  });

  test('clock runs by itself and stops; spawnPerTick 0 adds nobody', async () => {
    const started = await request(app).post('/api/clock').send({ running: true, tickMs: 100, spawnPerTick: 0 });
    expect(started.status).toBe(200);
    expect(started.body.running).toBe(true);
    await sleep(650);
    const stopped = (await request(app).post('/api/clock').send({ running: false })).body;
    expect(stopped.time).toBeGreaterThanOrEqual(4);
    expect(stopped.guests.total).toBe(0);
    const t = stopped.time;
    await sleep(300);
    expect((await state()).time).toBe(t);
    expect((await request(app).post('/api/reset').send({ seed: 1 })).body.running).toBe(false);
  });

  test('validation details', async () => {
    expect((await request(app).post('/api/reset').send({ seed: 'x' })).status).toBe(400);
    expect((await request(app).post('/api/reset').send({ leaveProbability: 2 })).status).toBe(400);
    expect((await tick(1001)).status).toBe(400);
    expect((await request(app).post('/api/tick').send({ n: 2.5 })).status).toBe(400);
    expect((await guests(501)).status).toBe(400);
    expect((await request(app).post('/api/clock').send({ running: 'yes' })).status).toBe(400);
    expect((await request(app).post('/api/clock').send({ running: false, tickMs: 50 })).status).toBe(400);
    expect((await request(app).post('/api/rides/ghost/status').send({ status: 'closed' })).status).toBe(404);
    const r = await request(app).post('/api/tick').send({});
    expect(r.body.time).toBe(1);
    expect((await request(app).get('/api/rides')).body.map(x => x.id)).toEqual([
      'mario-kart', 'yoshi', 'mine-cart', 'wing-gliders', 'dragon-rally', 'fyre-drill',
      'stardust', 'carousel', 'monsters', 'werewolf', 'ministry']);
  });
});
