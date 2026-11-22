const request = require('supertest');
const app = require('../index');

beforeEach(async () => { await request(app).delete('/api/cards'); });

describe('Kanban API (visible)', () => {
  test('board starts empty with three columns', async () => {
    const res = await request(app).get('/api/board');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ todo: [], doing: [], done: [] });
  });

  test('POST /api/cards creates a card in todo by default', async () => {
    const res = await request(app).post('/api/cards').send({ title: 'First' });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ id: 1, title: 'First', column: 'todo', position: 0 });
    expect(typeof res.body.createdAt).toBe('string');
  });

  test('POST rejects an empty title', async () => {
    const res = await request(app).post('/api/cards').send({ title: '   ' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBeDefined();
  });

  test('PATCH moves a card to another column', async () => {
    const { body: card } = await request(app).post('/api/cards').send({ title: 'Move me' });
    const res = await request(app).patch(`/api/cards/${card.id}`).send({ column: 'doing' });
    expect(res.status).toBe(200);
    expect(res.body.column).toBe('doing');
    const board = (await request(app).get('/api/board')).body;
    expect(board.todo).toHaveLength(0);
    expect(board.doing.map(c => c.id)).toEqual([card.id]);
  });

  test('DELETE removes a card and unknown ids give 404', async () => {
    const { body: card } = await request(app).post('/api/cards').send({ title: 'Bye' });
    expect((await request(app).delete(`/api/cards/${card.id}`)).status).toBe(204);
    expect((await request(app).delete(`/api/cards/${card.id}`)).status).toBe(404);
  });
});
