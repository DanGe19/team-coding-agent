const request = require('supertest');
const app = require('../../index');

beforeEach(async () => { await request(app).delete('/api/cards'); });

const add = (title, column) => request(app).post('/api/cards').send(column ? { title, column } : { title });
const ids = list => list.map(c => c.id);

describe('Kanban API (hidden)', () => {
  test('ids increase and positions are appended per column', async () => {
    const a = (await add('a')).body, b = (await add('b')).body, c = (await add('c', 'doing')).body;
    expect([a.id, b.id, c.id]).toEqual([1, 2, 3]);
    expect([a.position, b.position, c.position]).toEqual([0, 1, 0]);
  });

  test('GET /api/cards is flat and ordered todo, doing, done then position', async () => {
    await add('d1', 'done'); await add('t1'); await add('g1', 'doing'); await add('t2');
    const res = await request(app).get('/api/cards');
    expect(res.status).toBe(200);
    expect(res.body.map(c => c.title)).toEqual(['t1', 't2', 'g1', 'd1']);
  });

  test('validation: long title, bad column, missing title, non-string title', async () => {
    expect((await add('x'.repeat(101))).status).toBe(400);
    expect((await add('ok', 'archive')).status).toBe(400);
    expect((await request(app).post('/api/cards').send({})).status).toBe(400);
    expect((await request(app).post('/api/cards').send({ title: 42 })).status).toBe(400);
    expect((await add('x'.repeat(100))).status).toBe(201);
  });

  test('moving a card renumbers both columns', async () => {
    const a = (await add('a')).body, b = (await add('b')).body, c = (await add('c')).body;
    await add('x', 'doing');
    const moved = (await request(app).patch(`/api/cards/${a.id}`).send({ column: 'doing' })).body;
    expect(moved).toMatchObject({ column: 'doing', position: 1 });
    const board = (await request(app).get('/api/board')).body;
    expect(board.todo.map(k => [k.id, k.position])).toEqual([[b.id, 0], [c.id, 1]]);
    expect(board.doing.map(k => k.position)).toEqual([0, 1]);
  });

  test('position reorders within a column and is clamped', async () => {
    const a = (await add('a')).body; await add('b'); const c = (await add('c')).body;
    await request(app).patch(`/api/cards/${c.id}`).send({ position: 0 });
    let board = (await request(app).get('/api/board')).body;
    expect(board.todo.map(k => k.title)).toEqual(['c', 'a', 'b']);
    await request(app).patch(`/api/cards/${a.id}`).send({ position: 99 });
    board = (await request(app).get('/api/board')).body;
    expect(board.todo.map(k => k.title)).toEqual(['c', 'b', 'a']);
    expect(board.todo.map(k => k.position)).toEqual([0, 1, 2]);
  });

  test('column + position together, and title edit keeps column', async () => {
    await add('g1', 'doing'); await add('g2', 'doing');
    const t = (await add('t')).body;
    const r = await request(app).patch(`/api/cards/${t.id}`).send({ column: 'doing', position: 0 });
    expect(r.status).toBe(200);
    expect((await request(app).get('/api/board')).body.doing.map(k => k.title)).toEqual(['t', 'g1', 'g2']);
    const e = await request(app).patch(`/api/cards/${t.id}`).send({ title: 'renamed' });
    expect(e.body).toMatchObject({ title: 'renamed', column: 'doing' });
  });

  test('PATCH validation and 404s', async () => {
    const a = (await add('a')).body;
    expect((await request(app).patch(`/api/cards/${a.id}`).send({ title: '' })).status).toBe(400);
    expect((await request(app).patch(`/api/cards/${a.id}`).send({ column: 'nope' })).status).toBe(400);
    expect((await request(app).patch(`/api/cards/${a.id}`).send({ position: 'first' })).status).toBe(400);
    expect((await request(app).patch('/api/cards/999').send({ title: 'x' })).status).toBe(404);
    expect((await request(app).get('/api/board')).body.todo[0].title).toBe('a');
  });

  test('delete renumbers remaining cards; ids are not reused', async () => {
    const a = (await add('a')).body; const b = (await add('b')).body; const c = (await add('c')).body;
    await request(app).delete(`/api/cards/${b.id}`);
    const board = (await request(app).get('/api/board')).body;
    expect(board.todo.map(k => [k.id, k.position])).toEqual([[a.id, 0], [c.id, 1]]);
    expect((await add('d')).body.id).toBe(c.id + 1);
  });
});
