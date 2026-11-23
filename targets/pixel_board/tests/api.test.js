const request = require('supertest');
const app = require('../index');

const op = body => request(app).post('/api/ops').send(body);
const idx = (x, y) => y * 16 + x;

beforeEach(async () => { await request(app).post('/api/reset'); });

describe('Pixel Board API (visible)', () => {
  test('empty board state', async () => {
    const res = await request(app).get('/api/board');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ width: 16, height: 16, canUndo: false, canRedo: false, undoDepth: 0, redoDepth: 0, historyLimit: 50 });
    expect(res.body.cells).toHaveLength(256);
    expect(res.body.cells.every(c => c === null)).toBe(true);
    expect(res.body.palette[2]).toBe('#e4002b');
  });

  test('paint then undo then redo', async () => {
    let r = await op({ type: 'paint', x: 3, y: 4, color: 2 });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ changed: true, type: 'paint', cellsChanged: 1 });
    expect(r.body.board.cells[idx(3, 4)]).toBe(2);
    expect(r.body.board).toMatchObject({ canUndo: true, canRedo: false, undoDepth: 1 });
    r = await request(app).post('/api/undo');
    expect(r.body.changed).toBe(true);
    expect(r.body.board.cells[idx(3, 4)]).toBeNull();
    expect(r.body.board).toMatchObject({ canUndo: false, canRedo: true, redoDepth: 1 });
    r = await request(app).post('/api/redo');
    expect(r.body.board.cells[idx(3, 4)]).toBe(2);
  });

  test('row, col and clear', async () => {
    await op({ type: 'row', y: 0, color: 5 });
    let b = (await op({ type: 'col', x: 0, color: 6 })).body.board;
    expect(b.cells.slice(1, 16).every(c => c === 5)).toBe(true);
    expect(b.cells[0]).toBe(6);
    expect(b.cells[idx(0, 15)]).toBe(6);
    b = (await op({ type: 'clear' })).body.board;
    expect(b.cells.every(c => c === null)).toBe(true);
    expect(b.undoDepth).toBe(3);
  });

  test('validation', async () => {
    expect((await op({ type: 'paint', x: 16, y: 0, color: 1 })).status).toBe(400);
    expect((await op({ type: 'paint', x: 0, y: 0, color: 8 })).status).toBe(400);
    expect((await op({ type: 'spray', x: 0, y: 0, color: 1 })).status).toBe(400);
    expect((await op({ type: 'import', cells: [1, 2, 3] })).status).toBe(400);
  });

  test('saves: create, list, load, delete', async () => {
    await op({ type: 'paint', x: 1, y: 1, color: 7 });
    const s = await request(app).post('/api/saves').send({ name: 'first' });
    expect(s.status).toBe(201);
    expect(s.body).toMatchObject({ id: expect.any(Number), name: 'first' });
    expect(s.body.cells[idx(1, 1)]).toBe(7);
    await op({ type: 'clear' });
    const loaded = await request(app).post(`/api/saves/${s.body.id}/load`);
    expect(loaded.body).toMatchObject({ changed: true, type: 'load' });
    expect(loaded.body.board.cells[idx(1, 1)]).toBe(7);
    const list = (await request(app).get('/api/saves')).body;
    expect(list.find(x => x.id === s.body.id)).toMatchObject({ name: 'first' });
    expect((await request(app).delete(`/api/saves/${s.body.id}`)).status).toBe(204);
    expect((await request(app).get(`/api/saves/${s.body.id}`)).status).toBe(404);
  });
});
