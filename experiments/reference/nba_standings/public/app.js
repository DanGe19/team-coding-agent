const $ = s => document.querySelector(s);
let teams = [], sortState = {};
const api = (m, u, b) => fetch(u, { method: m, headers: { 'Content-Type': 'application/json' }, body: b ? JSON.stringify(b) : undefined })
  .then(async r => ({ ok: r.ok, status: r.status, body: r.status === 204 ? null : await r.json() }));
const fmtPct = p => (p === 1 ? '1.000' : p.toFixed(3).replace(/^0/, ''));
const fmtDiff = d => (d > 0 ? '+' + d : String(d));
const fmtGb = (g, rank) => (rank === 1 ? '-' : String(g));

// ---------------------------------------------------------------- tabs
const views = { standings: '#view-standings', players: '#view-players', injuries: '#view-injuries' };
function show(name) {
  Object.entries(views).forEach(([k, sel]) => { $(sel).hidden = k !== name; $(`#tab-${k}`).classList.toggle('active', k === name); });
  if (name === 'standings') loadStandings(); if (name === 'players') loadPlayers(); if (name === 'injuries') loadInjuries();
}
['standings', 'players', 'injuries'].forEach(k => { $(`#tab-${k}`).onclick = () => show(k); });

// ----------------------------------------------------------- standings
const COLS = [['rank', '#'], ['team', 'Team'], ['w', 'W'], ['l', 'L'], ['pct', 'PCT'], ['gb', 'GB'], ['home', 'Home'], ['away', 'Away'], ['l10', 'L10'], ['streak', 'Streak'], ['diff', 'Diff']];
const NUMERIC = new Set(['rank', 'w', 'l', 'pct', 'gb', 'diff']);
let standingsData = null;

async function loadStandings() {
  standingsData = (await api('GET', '/api/standings')).body;
  renderStandings('east', standingsData.East); renderStandings('west', standingsData.West);
}
function renderStandings(conf, rows) {
  const table = $(`#standings-${conf}`);
  table.querySelector('thead').innerHTML = '<tr>' + COLS.map(([f, label]) => `<th data-sort="${f}">${label}</th>`).join('') + '</tr>';
  table.querySelectorAll('th').forEach(th => { th.onclick = () => sortTable(conf, th.dataset.sort); });
  const st = sortState[conf];
  let list = [...rows];
  if (st) {
    const dir = st.dir;
    list.sort((a, b) => {
      const va = st.field === 'team' ? a.name : a[st.field === 'l10' ? 'last10' : st.field];
      const vb = st.field === 'team' ? b.name : b[st.field === 'l10' ? 'last10' : st.field];
      const c = typeof va === 'number' ? va - vb : String(va).localeCompare(String(vb));
      return dir === 'asc' ? c : -c;
    });
  }
  const tbody = table.querySelector('tbody'); tbody.innerHTML = '';
  list.forEach(r => {
    const tr = document.createElement('tr');
    tr.className = `team-row zone-${r.zone.replace('-', '')}` + (r.rank === 6 ? ' sep-6' : r.rank === 10 ? ' sep-10' : '');
    tr.dataset.team = r.id;
    tr.innerHTML = `<td class="rank">${r.rank}</td><td class="team"></td><td class="w">${r.w}</td><td class="l">${r.l}</td>
      <td class="pct">${fmtPct(r.pct)}</td><td class="gb">${fmtGb(r.gb, r.rank)}</td><td class="home">${r.home}</td><td class="away">${r.away}</td>
      <td class="l10">${r.last10}</td><td class="streak">${r.streak}</td><td class="diff">${fmtDiff(r.diff)}</td>`;
    tr.querySelector('.team').textContent = r.name;
    tr.onclick = () => openTeam(r.id);
    tbody.appendChild(tr);
  });
}
function sortTable(conf, field) {
  const prev = sortState[conf];
  const first = NUMERIC.has(field) ? 'desc' : 'asc';
  sortState[conf] = prev && prev.field === field ? { field, dir: prev.dir === 'asc' ? 'desc' : 'asc' } : { field, dir: first };
  renderStandings(conf, standingsData[conf === 'east' ? 'East' : 'West']);
}

async function openTeam(id) {
  const t = (await api('GET', `/api/teams/${id}`)).body;
  const panel = $('#team-panel'); panel.hidden = false;
  panel.querySelector('.team-name').textContent = t.name;
  panel.querySelector('.team-record').textContent = `${t.w}-${t.l}`;
  const tb = panel.querySelector('.roster tbody'); tb.innerHTML = '';
  t.roster.forEach(p => {
    const tr = document.createElement('tr'); tr.className = 'player-row'; tr.dataset.player = p.id;
    tr.innerHTML = `<td class="number">${p.number}</td><td class="name"></td><td class="position">${p.position}</td><td class="ppg">${p.ppg.toFixed(1)}</td><td class="rpg">${p.rpg.toFixed(1)}</td><td class="apg">${p.apg.toFixed(1)}</td><td class="injury"></td>`;
    tr.querySelector('.name').textContent = p.name;
    const inj = tr.querySelector('.injury');
    if (p.injury.status === 'out') { inj.innerHTML = '<span class="badge-out">OUT</span> '; inj.append(p.injury.note); }
    else if (p.injury.status === 'day-to-day') { inj.innerHTML = '<span class="badge-dtd">DTD</span> '; inj.append(p.injury.note); }
    tb.appendChild(tr);
  });
  const ul = panel.querySelector('.games'); ul.innerHTML = '';
  t.games.forEach(g => {
    const li = document.createElement('li'); li.className = 'game-row';
    const home = g.homeTeam === id, mine = home ? g.homeScore : g.awayScore, theirs = home ? g.awayScore : g.homeScore;
    li.textContent = `${g.date} ${home ? 'vs' : '@'} ${home ? g.awayTeam : g.homeTeam} ${mine > theirs ? 'W' : 'L'} ${mine}-${theirs}`;
    ul.appendChild(li);
  });
}

$('#game-form').onsubmit = async e => {
  e.preventDefault(); $('#game-error').textContent = '';
  const r = await api('POST', '/api/games', { date: $('#game-date').value, homeTeam: $('#home-team').value, awayTeam: $('#away-team').value,
    homeScore: Number($('#home-score').value), awayScore: Number($('#away-score').value) });
  if (!r.ok) { $('#game-error').textContent = r.body.error; return; }
  $('#home-score').value = ''; $('#away-score').value = ''; loadStandings();
};

// ------------------------------------------------------------- players
async function loadPlayers() {
  const q = new URLSearchParams();
  if ($('#filter-team').value) q.set('team', $('#filter-team').value);
  if ($('#filter-position').value) q.set('position', $('#filter-position').value);
  if ($('#filter-status').value) q.set('status', $('#filter-status').value);
  const players = (await api('GET', '/api/players?' + q)).body;
  const tb = $('#players-table tbody'); tb.innerHTML = '';
  players.forEach(p => {
    const tr = document.createElement('tr'); tr.className = 'player-row'; tr.dataset.player = p.id;
    tr.innerHTML = `<td class="name"></td><td class="team">${p.teamId}</td><td class="position">${p.position}</td><td class="gp">${p.gp}</td>
      <td class="ppg">${p.ppg.toFixed(1)}</td><td class="rpg">${p.rpg.toFixed(1)}</td><td class="apg">${p.apg.toFixed(1)}</td><td class="status">${p.injury.status}</td><td><button class="btn-injury">Injury</button></td>`;
    tr.querySelector('.name').textContent = p.name;
    tr.querySelector('.btn-injury').onclick = () => {
      const cell = tr.querySelector('.status');
      cell.innerHTML = `<div class="injury-editor"><select class="injury-status"><option>healthy</option><option>day-to-day</option><option>out</option></select>
        <input class="injury-note" placeholder="note"><input class="injury-return" type="date"><button class="injury-save">Save</button></div>`;
      cell.querySelector('.injury-status').value = p.injury.status; cell.querySelector('.injury-note').value = p.injury.note;
      cell.querySelector('.injury-return').value = p.injury.expectedReturn || '';
      cell.querySelector('.injury-save').onclick = async () => {
        await api('PATCH', `/api/players/${p.id}`, { injury: { status: cell.querySelector('.injury-status').value,
          note: cell.querySelector('.injury-note').value, expectedReturn: cell.querySelector('.injury-return').value || null } });
        loadPlayers();
      };
    };
    tb.appendChild(tr);
  });
}
['#filter-team', '#filter-position', '#filter-status'].forEach(s => { $(s).onchange = loadPlayers; });
$('#player-form').onsubmit = async e => {
  e.preventDefault(); $('#player-error').textContent = '';
  const r = await api('POST', '/api/players', { name: $('#p-name').value, teamId: $('#p-team').value, position: $('#p-position').value, number: Number($('#p-number').value) });
  if (!r.ok) { $('#player-error').textContent = r.body.error; return; }
  $('#p-name').value = ''; $('#p-number').value = ''; loadPlayers();
};

// ------------------------------------------------------------ injuries
async function loadInjuries() {
  const rows = (await api('GET', '/api/injuries')).body;
  const tb = $('#injuries-table tbody'); tb.innerHTML = '';
  $('#injuries-empty').hidden = rows.length > 0; $('#injuries-table').hidden = rows.length === 0;
  rows.forEach(p => {
    const tr = document.createElement('tr'); tr.className = 'injury-row'; tr.dataset.player = p.id;
    tr.innerHTML = `<td class="name"></td><td class="team">${p.teamName}</td><td class="position">${p.position}</td><td class="status">${p.injury.status}</td><td class="note"></td><td class="return">${p.injury.expectedReturn || '-'}</td>`;
    tr.querySelector('.name').textContent = p.name; tr.querySelector('.note').textContent = p.injury.note;
    tb.appendChild(tr);
  });
}

// --------------------------------------------------------------- init
$('#btn-import').onclick = async () => { await api('POST', '/api/import-sample'); refreshAll(); };
$('#btn-reset').onclick = async () => { await api('POST', '/api/reset'); $('#team-panel').hidden = true; refreshAll(); };
function refreshAll() { loadStandings(); if (!$('#view-players').hidden) loadPlayers(); if (!$('#view-injuries').hidden) loadInjuries(); }
(async () => {
  teams = (await api('GET', '/api/teams')).body;
  const opts = teams.map(t => `<option value="${t.id}">${t.name}</option>`).join('');
  $('#home-team').innerHTML = opts; $('#away-team').innerHTML = opts; $('#p-team').innerHTML = opts;
  $('#filter-team').innerHTML += opts;
  $('#away-team').selectedIndex = 1;
  loadStandings();
})();
