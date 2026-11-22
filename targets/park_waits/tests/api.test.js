const request = require('supertest');
const app = require('../index');

const reset = (seed = 1, leaveProbability = 0.1) => request(app).post('/api/reset').send({ seed, leaveProbability });
const tick = (n = 1) => request(app).post('/api/tick').send({ n });
const guests = (count, strategy) => request(app).post('/api/guests').send({ count, strategy });
const ride = id => request(app).get(`/api/rides/${id}`).then(r => r.body);

beforeEach(async () => { await reset(1, 0); });

describe('Park API (visible)', () => {
  test('state after reset: time 0, 11 open rides, no guests', async () => {
    const res = await request(app).get('/api/state');
    expect(res.status).toBe(200);
    expect(res.body.time).toBe(0);
    expect(res.body.running).toBe(false);
    expect(res.body.rides).toHaveLength(11);
    expect(res.body.rides.every(r => r.status === 'open' && r.waitMinutes === 0 && r.queueLength === 0)).toBe(true);
    expect(res.body.guests).toEqual({ total: 0, queued: 0, riding: 0, wandering: 0, left: 0 });
  });

  test('ride data matches the spec', async () => {
    const r = await ride('ministry');
    expect(r).toMatchObject({ name: 'Harry Potter and the Battle at the Ministry', capacity: 16, duration: 6, x: 80, y: 45 });
    expect((await request(app).get('/api/rides/nope')).status).toBe(404);
  });

  test('a single guest queues and the wait equals one cycle', async () => {
    const created = await guests(1, 'shortest');
    expect(created.status).toBe(201);
    expect(created.body.created).toEqual([1]);
    await tick();
    const r = await ride('mario-kart');
    expect(r.queueLength).toBe(1);
    expect(r.waitMinutes).toBe(5);
    expect((await request(app).get('/api/guests/1')).body).toMatchObject({ state: 'queued', rideId: 'mario-kart' });
  });

  test('closing a ride makes its wait null and 400 on bad status', async () => {
    const res = await request(app).post('/api/rides/stardust/status').send({ status: 'closed' });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('closed');
    expect(res.body.waitMinutes).toBeNull();
    expect((await request(app).post('/api/rides/stardust/status').send({ status: 'broken' })).status).toBe(400);
  });

  test('validation on tick and guests', async () => {
    expect((await tick(0)).status).toBe(400);
    expect((await guests(0)).status).toBe(400);
    expect((await guests(5, 'vip')).status).toBe(400);
    expect((await tick(3)).body.time).toBe(3);
  });
});
