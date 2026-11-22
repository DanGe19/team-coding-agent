const LAND_COLORS = {
  'Super Nintendo World': '#e4002b', 'How to Train Your Dragon - Isle of Berk': '#f28c00',
  'Celestial Park': '#1f6feb', 'Dark Universe': '#4b2a5a',
  'The Wizarding World of Harry Potter - Ministry of Magic': '#1b1f3b',
};
const TEST = new URLSearchParams(location.search).get('test') === '1';
let state = null, pollTimer = null;
const $ = s => document.querySelector(s);

async function api(method, url, body) {
  const r = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  return r.json();
}
async function refresh() { state = await api('GET', '/api/state'); render(); }

function waitClass(r) {
  if (r.status !== 'open' || r.waitMinutes === null) return 'wait-closed';
  return r.waitMinutes < 15 ? 'wait-low' : r.waitMinutes < 45 ? 'wait-mid' : 'wait-high';
}
function hhmm(t) { const m = 9 * 60 + t; return String(Math.floor(m / 60) % 24).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0'); }

function render() {
  $('#sim-time').textContent = hhmm(state.time);
  const g = state.guests; $('#guest-count').textContent = g.queued + g.riding + g.wandering;
  $('#btn-start').textContent = state.running ? 'Pause' : 'Start';

  const board = $('#board'); board.innerHTML = '';
  const lands = [];
  state.rides.forEach(r => { if (!lands.includes(r.land)) lands.push(r.land); });
  lands.forEach(land => {
    const sec = document.createElement('section'); sec.className = 'land'; sec.dataset.land = land;
    sec.style.setProperty('--land', LAND_COLORS[land] || '#333');
    sec.innerHTML = `<h2></h2><div class="rides"></div>`; sec.querySelector('h2').textContent = land;
    state.rides.filter(r => r.land === land).forEach(r => {
      const card = document.createElement('article'); card.className = `ride ${waitClass(r)}`; card.dataset.ride = r.id;
      card.innerHTML = `<div class="ride-name"></div><div class="wait"></div>
        <div class="meta"><span>Queue: <span class="queue-len"></span></span><span class="status"></span></div>
        <button class="btn-toggle"></button>`;
      card.querySelector('.ride-name').textContent = r.name;
      card.querySelector('.wait').textContent = r.status === 'open' ? `${r.waitMinutes} min` : 'Closed';
      card.querySelector('.queue-len').textContent = r.queueLength;
      card.querySelector('.status').textContent = r.status;
      const b = card.querySelector('.btn-toggle'); b.textContent = r.status === 'open' ? 'Close ride' : 'Open ride';
      b.onclick = () => api('POST', `/api/rides/${r.id}/status`, { status: r.status === 'open' ? 'closed' : 'open' }).then(refresh);
      sec.querySelector('.rides').appendChild(card);
    });
    board.appendChild(sec);
  });

  const area = $('#map-area'); area.innerHTML = '';
  state.rides.forEach(r => {
    const m = document.createElement('div'); m.className = `marker ${waitClass(r)}`; m.dataset.ride = r.id;
    m.style.left = r.x + '%'; m.style.top = r.y + '%'; m.title = r.name;
    m.textContent = r.status === 'open' ? r.waitMinutes : '–';
    area.appendChild(m);
  });
}

function schedulePoll() {
  clearInterval(pollTimer);
  if (state && state.running && !TEST) pollTimer = setInterval(refresh, state.tickMs);
}

$('#btn-start').onclick = async () => { await api('POST', '/api/clock', { running: !state.running }); await refresh(); schedulePoll(); };
$('#btn-tick').onclick = () => api('POST', '/api/tick', { n: 1 }).then(refresh);
$('#btn-add-guests').onclick = () => api('POST', '/api/guests', { count: 50, strategy: 'random' }).then(refresh);
$('#btn-reset').onclick = () => api('POST', '/api/reset', { seed: Number($('#seed-input').value) || 1 }).then(refresh).then(schedulePoll);
$('#btn-view').onclick = () => { const showMap = $('#map').hidden; $('#map').hidden = !showMap; $('#board').hidden = showMap; $('#btn-view').textContent = showMap ? 'Board' : 'Map'; };
refresh().then(schedulePoll);
