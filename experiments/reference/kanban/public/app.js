const COLUMNS = ['todo', 'doing', 'done'];
const boardEl = document.getElementById('board');

async function api(method, url, body) {
  const res = await fetch(url, { method, headers: { 'Content-Type': 'application/json' },
                                 body: body ? JSON.stringify(body) : undefined });
  if (res.status === 204) return null;
  return res.json();
}

async function load() {
  const board = await api('GET', '/api/board');
  render(board);
}

function render(board) {
  boardEl.innerHTML = '';
  COLUMNS.forEach((name, ci) => {
    const list = board[name] || [];
    const col = document.createElement('section');
    col.className = 'column'; col.dataset.column = name;
    col.innerHTML = `<h2>${name}<span class="count">${list.length}</span></h2>`;
    list.forEach((card, i) => col.appendChild(renderCard(card, i, list.length, ci)));
    const form = document.createElement('form'); form.className = 'new-card';
    form.innerHTML = `<input class="new-card-input" placeholder="New card"><button class="new-card-btn" type="submit">Add</button>`;
    form.addEventListener('submit', async e => {
      e.preventDefault();
      const input = form.querySelector('.new-card-input');
      const title = input.value.trim();
      if (!title) return;
      await api('POST', '/api/cards', { title, column: name });
      input.value = '';
      load();
    });
    col.appendChild(form);
    boardEl.appendChild(col);
  });
}

function renderCard(card, i, n, ci) {
  const el = document.createElement('article');
  el.className = 'card'; el.dataset.id = card.id;
  el.innerHTML = `<span class="card-title"></span>
    <div class="actions">
      <button class="btn-left" title="Move left">&larr;</button>
      <button class="btn-up" title="Move up">&uarr;</button>
      <button class="btn-down" title="Move down">&darr;</button>
      <button class="btn-right" title="Move right">&rarr;</button>
      <button class="btn-edit" title="Edit">Edit</button>
      <button class="btn-delete" title="Delete">Delete</button>
    </div>`;
  el.querySelector('.card-title').textContent = card.title;
  const q = s => el.querySelector(s);
  q('.btn-left').disabled = ci === 0;
  q('.btn-right').disabled = ci === COLUMNS.length - 1;
  q('.btn-up').disabled = i === 0;
  q('.btn-down').disabled = i === n - 1;
  const patch = body => api('PATCH', `/api/cards/${card.id}`, body).then(load);
  q('.btn-left').onclick = () => patch({ column: COLUMNS[ci - 1] });
  q('.btn-right').onclick = () => patch({ column: COLUMNS[ci + 1] });
  q('.btn-up').onclick = () => patch({ position: i - 1 });
  q('.btn-down').onclick = () => patch({ position: i + 1 });
  q('.btn-delete').onclick = () => api('DELETE', `/api/cards/${card.id}`).then(load);
  q('.btn-edit').onclick = () => {
    const title = q('.card-title');
    const input = document.createElement('input');
    input.className = 'edit-input'; input.value = card.title;
    title.replaceWith(input); input.focus();
    input.addEventListener('keydown', e => {
      if (e.key === 'Enter') { const t = input.value.trim(); t ? patch({ title: t }) : load(); }
      if (e.key === 'Escape') load();
    });
  };
  return el;
}

document.getElementById('refresh').onclick = load;
load();
