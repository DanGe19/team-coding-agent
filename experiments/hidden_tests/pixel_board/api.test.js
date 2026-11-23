const request = require('supertest');
const app = require('../../index');

const op = body => request(app).post('/api/ops').send(body);
const undo = () => request(app).post('/api/undo');
const redo = () => request(app).post('/api/redo');
const board = () => request(app).get('/api/board').then(r => r.body);
const idx = (x, y) => y * 16 + x;

beforeEach(async () => { await request(app).post('/api/reset'); });

describe('Pixel Board API (hidden)', () => {
  test('flood fill uses 4-neighbours, respects walls, fills null regions', async () => {
    // Wall: row 8 fully colored 1 -> fill at (0,0) with 3 colors top half only.
    await op({ type: 'row', y: 8, color: 1 });
    const r = await op({ type: 'fill', x: 0, y: 0, color: 3 });
    expect(r.body.cellsChanged).toBe(128);
    const c = r.body.board.cells;
    expect(c[idx(15, 7)]).toBe(3); expect(c[idx(0, 9)]).toBeNull(); expect(c[idx(5, 8)]).toBe(1);
    // Diagonal-only connection must NOT leak: cells (1,0) and (0,1) colored 1 isolate (0,0).
    await request(app).post('/api/reset');
    await op({ type: 'paint', x: 1, y: 0, color: 1 }); await op({ type: 'paint', x: 0, y: 1, color: 1 });
    const r2 = await op({ type: 'fill', x: 0, y: 0, color: 4 });
    expect(r2.body.cellsChanged).toBe(1);
    expect(r2.body.board.cells[idx(1, 1)]).toBeNull();
    // Fill replaces only the start cell's value (color 1 region), not everything.
    const r3 = await op({ type: 'fill', x: 1, y: 0, color: 5 });
    expect(r3.body.cellsChanged).toBe(1);   // (1,0) and (0,1) touch only diagonally
  });

  test('no-op operations are not recorded', async () => {
    await op({ type: 'paint', x: 0, y: 0, color: 2 });
    let r = await op({ type: 'paint', x: 0, y: 0, color: 2 });
    expect(r.body).toMatchObject({ changed: false, cellsChanged: 0 });
    expect(r.body.board.undoDepth).toBe(1);
    r = await op({ type: 'fill', x: 0, y: 0, color: 2 });
    expect(r.body.changed).toBe(false);
    await request(app).post('/api/reset');
    r = await op({ type: 'clear' });
    expect(r.body.changed).toBe(false);
    expect((await board()).undoDepth).toBe(0);
    r = await op({ type: 'import', cells: Array(256).fill(null) });
    expect(r.body.changed).toBe(false);
  });

  test('a new operation after undo clears the redo stack', async () => {
    await op({ type: 'paint', x: 0, y: 0, color: 1 });
    await op({ type: 'paint', x: 1, y: 0, color: 2 });
    await op({ type: 'paint', x: 2, y: 0, color: 3 });
    await undo(); await undo();
    expect(await board()).toMatchObject({ undoDepth: 1, redoDepth: 2 });
    await op({ type: 'paint', x: 5, y: 5, color: 7 });
    const b = await board();
    expect(b).toMatchObject({ undoDepth: 2, redoDepth: 0, canRedo: false });
    expect((await redo()).body.changed).toBe(false);
    expect(b.cells[idx(1, 0)]).toBeNull();
    expect(b.cells[idx(5, 5)]).toBe(7);
  });

  test('undo on empty stack is a harmless no-op; full undo/redo round trip restores every state', async () => {
    expect((await undo()).body).toMatchObject({ changed: false });
    const states = [];
    for (let i = 0; i < 5; i++) { await op({ type: 'paint', x: i, y: i, color: i }); states.push((await board()).cells); }
    for (let i = 4; i >= 1; i--) { await undo(); expect((await board()).cells).toEqual(states[i - 1]); }
    await undo();
    expect((await board()).cells.every(c => c === null)).toBe(true);
    expect((await undo()).body.changed).toBe(false);
    for (let i = 0; i < 5; i++) { await redo(); expect((await board()).cells).toEqual(states[i]); }
    expect((await redo()).body.changed).toBe(false);
  });

  test('history is capped at 50: oldest steps are dropped', async () => {
    for (let i = 0; i < 55; i++) await op({ type: 'paint', x: i % 16, y: Math.floor(i / 16), color: (i % 7) + 1 });
    let b = await board();
    expect(b).toMatchObject({ undoDepth: 50, canUndo: true });
    for (let i = 0; i < 50; i++) await undo();
    b = await board();
    expect(b).toMatchObject({ undoDepth: 0, canUndo: false, redoDepth: 50 });
    // Board now equals the state after the first 5 paints (steps 0-4 can no longer be undone).
    const painted = b.cells.map((c, i) => (c === null ? null : i)).filter(i => i !== null);
    expect(painted).toEqual([0, 1, 2, 3, 4]);
    expect((await undo()).body.changed).toBe(false);
  });

  test('import and load are history steps; reset clears history but keeps saves', async () => {
    const cells = Array(256).fill(null); cells[idx(2, 3)] = 4; cells[idx(15, 15)] = 0;
    let r = await op({ type: 'import', cells });
    expect(r.body).toMatchObject({ changed: true, type: 'import', cellsChanged: 2 });
    const s = (await request(app).post('/api/saves').send({ name: 'two dots' })).body;
    await op({ type: 'clear' });
    r = await request(app).post(`/api/saves/${s.id}/load`);
    expect(r.body).toMatchObject({ type: 'load', cellsChanged: 2 });
    expect((await board()).undoDepth).toBe(3);
    await undo();
    expect((await board()).cells.every(c => c === null)).toBe(true);
    const after = (await request(app).post('/api/reset')).body;
    expect(after).toMatchObject({ undoDepth: 0, redoDepth: 0 });
    expect((await request(app).get('/api/saves')).body.map(x => x.name)).toContain('two dots');
    expect((await request(app).get(`/api/saves/${s.id}`)).body.cells[idx(2, 3)]).toBe(4);
    await request(app).delete(`/api/saves/${s.id}`);
  });

  test('saves: validation, uniqueness, order, delete does not touch the board', async () => {
    expect((await request(app).post('/api/saves').send({ name: '' })).status).toBe(400);
    expect((await request(app).post('/api/saves').send({ name: 'x'.repeat(41) })).status).toBe(400);
    const a = (await request(app).post('/api/saves').send({ name: 'A' })).body;
    expect((await request(app).post('/api/saves').send({ name: 'A' })).status).toBe(400);
    const b = (await request(app).post('/api/saves').send({ name: 'a' })).body;   // case-sensitive: allowed
    const list = (await request(app).get('/api/saves')).body;
    expect(list.slice(0, 2).map(x => x.id)).toEqual([b.id, a.id]);
    expect(list[0].cells).toBeUndefined();
    await op({ type: 'paint', x: 0, y: 0, color: 1 });
    await request(app).delete(`/api/saves/${a.id}`);
    expect((await board())).toMatchObject({ undoDepth: 1 });
    expect((await request(app).post(`/api/saves/${a.id}/load`)).status).toBe(404);
    expect((await request(app).delete(`/api/saves/${a.id}`)).status).toBe(404);
    await request(app).delete(`/api/saves/${b.id}`);
  });

  test('export mirrors the board; eraser via null; row/col validation', async () => {
    await op({ type: 'row', y: 15, color: 7 });
    await op({ type: 'paint', x: 0, y: 15, color: null });
    const e = (await request(app).get('/api/export')).body;
    expect(e).toMatchObject({ width: 16, height: 16 });
    expect(e.cells[idx(0, 15)]).toBeNull(); expect(e.cells[idx(1, 15)]).toBe(7);
    expect(e.palette).toHaveLength(8);
    expect((await op({ type: 'row', y: 16, color: 1 })).status).toBe(400);
    expect((await op({ type: 'col', x: -1, color: 1 })).status).toBe(400);
    expect((await op({ type: 'paint', x: 1.5, y: 0, color: 1 })).status).toBe(400);
    expect((await op({ type: 'paint', x: 0, y: 0, color: '2' })).status).toBe(400);
    const badCells = Array(256).fill(null); badCells[0] = 9;
    expect((await op({ type: 'import', cells: badCells })).status).toBe(400);
  });
});
