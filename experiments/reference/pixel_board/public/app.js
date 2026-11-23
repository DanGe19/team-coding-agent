const $ = s => document.querySelector(s);
let board = null, color = 0, tool = 'paint';
const api = (m, u, b) => fetch(u, { method: m, headers: { 'Content-Type': 'application/json' }, body: b ? JSON.stringify(b) : undefined })
  .then(async r => ({ ok: r.ok, status: r.status, body: r.status === 204 ? null : await r.json() }));

function setBoard(b) { board = b; render(); }
async function refresh() { setBoard((await api('GET', '/api/board')).body); }

function buildGrid() {
  const g = $('#grid');
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
    const c = document.createElement('div'); c.className = 'cell'; c.dataset.x = x; c.dataset.y = y; c.dataset.color = 'empty';
    c.onclick = () => act(x, y);
    c.onmouseenter = () => { $('#coords').textContent = `${x}, ${y}`; };
    g.appendChild(c);
  }
}
function buildPalette() {
  const p = $('#palette');
  board.palette.forEach((hex, i) => {
    const b = document.createElement('button'); b.className = 'swatch' + (i === 0 ? ' active' : ''); b.dataset.color = i; b.style.background = hex; b.title = hex;
    b.onclick = () => pick(i); p.appendChild(b);
  });
  const e = document.createElement('button'); e.id = 'eraser'; e.textContent = 'Eraser'; e.onclick = () => pick(null); p.appendChild(e);
}
function pick(c) { color = c; document.querySelectorAll('#palette .swatch, #eraser').forEach(el => el.classList.remove('active'));
  (c === null ? $('#eraser') : $(`#palette .swatch[data-color="${c}"]`)).classList.add('active'); }
function setTool(t) { tool = t; document.querySelectorAll('.tool').forEach(el => el.classList.toggle('active', el.id === `tool-${t}`)); }

function render() {
  const cells = $('#grid').children;
  board.cells.forEach((v, i) => {
    const el = cells[i]; el.dataset.color = v === null ? 'empty' : String(v);
    el.style.background = v === null ? '' : board.palette[v];
  });
  $('#btn-undo').disabled = !board.canUndo; $('#btn-redo').disabled = !board.canRedo;
  $('#history-depth').textContent = `${board.undoDepth} / ${board.historyLimit}`;
}

async function op(body) { const r = await api('POST', '/api/ops', body); if (r.ok) setBoard(r.body.board); return r; }
function act(x, y) {
  if (tool === 'paint') return op({ type: 'paint', x, y, color });
  if (tool === 'fill') return op({ type: 'fill', x, y, color });
  if (tool === 'row') return op({ type: 'row', y, color });
  if (tool === 'col') return op({ type: 'col', x, color });
}
const undo = async () => setBoard((await api('POST', '/api/undo')).body.board);
const redo = async () => setBoard((await api('POST', '/api/redo')).body.board);
$('#btn-undo').onclick = undo; $('#btn-redo').onclick = redo; $('#btn-clear').onclick = () => op({ type: 'clear' });
['paint', 'fill', 'row', 'col'].forEach(t => { $(`#tool-${t}`).onclick = () => setTool(t); });

document.addEventListener('keydown', e => {
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
  const mod = e.ctrlKey || e.metaKey;
  if (mod && e.key.toLowerCase() === 'z' && !e.shiftKey) { e.preventDefault(); undo(); }
  else if ((mod && e.key.toLowerCase() === 'y') || (mod && e.shiftKey && e.key.toLowerCase() === 'z')) { e.preventDefault(); redo(); }
  else if (e.key === 'e') pick(null);
  else if (/^[1-8]$/.test(e.key)) pick(Number(e.key) - 1);
});

async function loadSaves() {
  const saves = (await api('GET', '/api/saves')).body;
  const list = $('#saves'); list.innerHTML = '';
  saves.forEach(s => {
    const row = document.createElement('div'); row.className = 'save-row'; row.dataset.id = s.id;
    row.innerHTML = `<span class="save-name"></span><button class="btn-load">Load</button><button class="btn-delete">Delete</button>`;
    row.querySelector('.save-name').textContent = s.name;
    row.querySelector('.btn-load').onclick = async () => { const r = await api('POST', `/api/saves/${s.id}/load`); setBoard(r.body.board); };
    row.querySelector('.btn-delete').onclick = async () => { await api('DELETE', `/api/saves/${s.id}`); loadSaves(); };
    list.appendChild(row);
  });
}
$('#btn-save').onclick = async () => {
  $('#save-error').textContent = '';
  const r = await api('POST', '/api/saves', { name: $('#save-name').value });
  if (!r.ok) { $('#save-error').textContent = r.body.error; return; }
  $('#save-name').value = ''; loadSaves();
};
$('#btn-export').onclick = async () => { $('#export-output').value = JSON.stringify((await api('GET', '/api/export')).body, null, 2); };
$('#btn-import').onclick = async () => {
  $('#import-error').textContent = '';
  let parsed; try { parsed = JSON.parse($('#import-input').value); } catch { $('#import-error').textContent = 'Invalid JSON'; return; }
  const r = await op({ type: 'import', cells: parsed && parsed.cells });
  if (!r.ok) $('#import-error').textContent = r.body.error;
};

(async () => { buildGrid(); await refresh(); buildPalette(); loadSaves(); })();
