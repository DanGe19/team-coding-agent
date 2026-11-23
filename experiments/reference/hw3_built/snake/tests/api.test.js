// Leaderboard API tests for Portal Snake (Jest + Supertest).
const request = require('supertest');
const app = require('../index.js');

const entry = { name: 'Ada', score: 42, length: 20, level: 4 };

beforeEach(async () => {
  await request(app).delete('/api/scores').expect(200);
});

test('GET / serves the game page', async () => {
  const response = await request(app).get('/').expect(200);
  expect(response.text).toContain('<canvas');
});

test('POST stores a valid score and returns id, timestamp and the fields', async () => {
  const response = await request(app).post('/api/score').send(entry).expect(201);
  expect(typeof response.body.id).toBe('number');
  expect(new Date(response.body.timestamp).toISOString()).toBe(response.body.timestamp);
  expect(response.body).toMatchObject(entry);
});

test('GET returns an array containing a posted entry', async () => {
  const posted = await request(app).post('/api/score').send(entry).expect(201);
  const response = await request(app).get('/api/scores').expect(200);
  expect(Array.isArray(response.body)).toBe(true);
  expect(response.body).toEqual(expect.arrayContaining([
    expect.objectContaining({ id: posted.body.id, name: 'Ada', score: 42 }),
  ]));
});

test('POST rejects a missing name', async () => {
  const response = await request(app).post('/api/score')
    .send({ score: 42, length: 20, level: 4 }).expect(400);
  expect(response.body).toHaveProperty('error');
});

test('POST rejects a blank name and an over-long name', async () => {
  await request(app).post('/api/score').send({ ...entry, name: '   ' }).expect(400);
  await request(app).post('/api/score').send({ ...entry, name: 'x'.repeat(21) }).expect(400);
});

test('POST rejects a negative score and a non-integer score', async () => {
  await request(app).post('/api/score').send({ ...entry, score: -1 }).expect(400);
  await request(app).post('/api/score').send({ ...entry, score: 1.5 }).expect(400);
  await request(app).post('/api/score').send({ ...entry, score: 'ten' }).expect(400);
});

test('GET places a higher score before a lower score', async () => {
  const low = await request(app).post('/api/score')
    .send({ name: 'Lin', score: 3, length: 7, level: 1 }).expect(201);
  const high = await request(app).post('/api/score').send(entry).expect(201);
  const response = await request(app).get('/api/scores').expect(200);
  const lowIndex = response.body.findIndex(item => item.id === low.body.id);
  const highIndex = response.body.findIndex(item => item.id === high.body.id);
  expect(lowIndex).toBeGreaterThanOrEqual(0);
  expect(highIndex).toBeGreaterThanOrEqual(0);
  expect(highIndex).toBeLessThan(lowIndex);
});

test('GET returns at most ten entries', async () => {
  for (let i = 0; i < 12; i++) {
    await request(app).post('/api/score')
      .send({ name: `P${i}`, score: i, length: 4 + i, level: 1 }).expect(201);
  }
  const response = await request(app).get('/api/scores').expect(200);
  expect(response.body.length).toBe(10);
  expect(response.body[0].score).toBe(11);
});

test('DELETE removes stored scores', async () => {
  await request(app).post('/api/score').send(entry).expect(201);
  const del = await request(app).delete('/api/scores').expect(200);
  expect(del.body).toHaveProperty('message');
  const response = await request(app).get('/api/scores').expect(200);
  expect(response.body).toEqual([]);
});
