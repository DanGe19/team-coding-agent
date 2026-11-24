// Page logic: poll the server for new events, keep a replay cursor, repaint.
// All numbers come from summarize() in model.js; this file only draws them.
import {
  summarize, splitRuns, describe, who, groupOf, isProblem, tsMs,
  fmtDuration, fmtCost, fmtCount, niceTicks, timeTicks,
} from './model.js';

const POLL_MS = 1000;
const SOURCES_MS = 5000;
const $ = (id) => document.getElementById(id);

const state = {
  online: true,
  roots: [], sources: [], sourcesKey: '', wantedSource: null,
  sourceId: null, offset: 0, fid: '',
  all: [],                  // every event in the selected folder's file
  runs: [], runsKey: '',    // the same events split by run_id
  runChoice: 'latest', runId: null,
  events: [],               // events of the selected run
  rows: [], shown: 0,       // timeline <li> per event, and how many are revealed
  cursor: 0,                // the page shows events[0..cursor]
  follow: true,             // live: the cursor sticks to the end
  playing: false, timer: null,
  openTasks: new Set(), tableView: false,
  summary: null,
};

// ----------------------------------------------------------------- DOM helpers
// Event data is model and tool output. It only ever enters the page as text
// nodes (never innerHTML), so nothing in a run can inject markup.

function build(el, attrs = {}, children = []) {
  for (const [name, value] of Object.entries(attrs)) {
    if (value == null || value === false) continue;
    el.setAttribute(name, value === true ? '' : value);
  }
  el.append(...children.flat(Infinity).filter((c) => c != null && c !== false));
  return el;
}
const h = (tag, attrs, ...children) => build(document.createElement(tag), attrs, children);
const svg = (tag, attrs, ...children) => build(document.createElementNS('http://www.w3.org/2000/svg', tag), attrs, children);

const roleClass = (role) => 'role-' + String(role || '').toLowerCase().replace(/[^a-z0-9_-]/g, '');
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
const icon = (kind, glyph) => h('span', { class: `icon ${kind}`, 'aria-hidden': 'true' }, glyph);

// Repaint a panel only when its inputs changed, so a click or an open
// <details> is not wiped by the once-a-second refresh.
const painted = new WeakMap();
function memo(el, key, paint) {
  if (painted.get(el) === key) return;
  painted.set(el, key);
  paint();
}

function showTip(x, y, ...content) {
  const tip = $('tooltip');
  tip.replaceChildren(...content.flat().filter(Boolean));
  tip.hidden = false;
  const box = tip.getBoundingClientRect();
  tip.style.left = Math.max(8, Math.min(x + 14, window.innerWidth - box.width - 8)) + 'px';
  tip.style.top = (y + 18 + box.height > window.innerHeight ? y - box.height - 10 : y + 18) + 'px';
}
const hideTip = () => { $('tooltip').hidden = true; };

// --------------------------------------------------------------------- server

async function getJSON(url) {
  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) throw Object.assign(new Error(`${url}: HTTP ${res.status}`), { status: res.status });
  return res.json();
}

async function refreshSources() {
  let data;
  try {
    data = await getJSON('/api/sources');
  } catch {
    return;                                   // poll() reports the outage
  }
  state.roots = data.roots;
  state.sources = data.sources;
  const key = JSON.stringify(data.sources.map((s) => [s.id, s.has_events]));
  if (key !== state.sourcesKey) {
    state.sourcesKey = key;
    $('source').replaceChildren(...data.sources.map((s) =>
      h('option', { value: s.id }, s.name + (s.has_events ? '' : ' (no events yet)'))));
  }
  const ids = data.sources.map((s) => s.id);
  if (!ids.includes(state.sourceId)) {        // first load, or the folder being watched is gone
    const next = ids.includes(state.wantedSource) ? state.wantedSource : ids[0] ?? null;
    if (next !== state.sourceId) selectSource(next, false);
  }
  $('source').value = state.sourceId ?? '';
  scheduleRender();
}

function selectSource(id, resetRun = true) {
  state.sourceId = id;
  state.offset = 0;
  state.fid = '';
  if (resetRun) state.runChoice = 'latest';
  clearEvents();
  saveHash();
  wake();
}

let pollTimer = null;
let polling = false;

async function poll() {
  polling = true;
  const id = state.sourceId;
  try {
    let more = id != null;
    while (more && id === state.sourceId) {
      const query = new URLSearchParams({ source: id, offset: state.offset, fid: state.fid });
      const res = await getJSON(`/api/events?${query}`);
      if (id !== state.sourceId) break;       // the folder was switched while waiting
      if (res.reset) clearEvents();           // the file was replaced: a fresh run in the same folder
      state.offset = res.offset;
      state.fid = res.fid;
      if (res.events.length) addEvents(res.events);
      more = res.more;
    }
    setOnline(true);
  } catch (err) {
    if (err.status === 404) refreshSources(); // the folder is gone; pick another
    else setOnline(false);
  }
  polling = false;
  pollTimer = setTimeout(poll, id === state.sourceId ? POLL_MS : 0);   // switched folder: load it now
}

function wake() {
  if (polling) return;
  clearTimeout(pollTimer);
  poll();
}

function setOnline(online) {
  if (state.online === online) return;
  state.online = online;
  scheduleRender();
}

// --------------------------------------------------------------- events, runs

function clearEvents() {
  stopPlaying();
  Object.assign(state, { all: [], runs: [], runsKey: '', runId: null, events: [], cursor: 0, follow: true });
  resetTimeline();
  syncRunSelect();
  scheduleRender();
}

function addEvents(events) {
  for (const ev of events) state.all.push(ev);
  state.runs = splitRuns(state.all);
  syncRunSelect();
  showRun(currentRun());
}

function currentRun() {
  const chosen = state.runs.find((r) => r.id === state.runChoice);
  return chosen || state.runs[state.runs.length - 1] || null;    // "latest" = last one in the file
}

function showRun(run) {
  if (!run) return;
  if (run.id !== state.runId) {               // first load, a different pick, or a newer run began
    stopPlaying();
    state.runId = run.id;
    state.follow = true;
    resetTimeline();
  }
  state.events = run.events;
  appendRows();
  if (state.follow) state.cursor = state.events.length;
  scheduleRender();
}

function syncRunSelect() {
  const key = JSON.stringify(state.runs.map((r) => [r.id, r.team]));
  const select = $('run');
  if (key !== state.runsKey) {
    state.runsKey = key;
    select.replaceChildren(
      h('option', { value: 'latest' }, 'Latest'),
      ...[...state.runs].reverse().map((r) =>
        h('option', { value: r.id }, `${r.id} (${r.team ? 'team' : 'single agent'})`)));
  }
  select.value = state.runs.some((r) => r.id === state.runChoice) ? state.runChoice : 'latest';
}

function saveHash() {
  const params = new URLSearchParams({ source: state.sourceId ?? '', run: state.runChoice });
  history.replaceState(null, '', '#' + params);
}

// ------------------------------------------------------------------- timeline

function resetTimeline() {
  $('events').replaceChildren();
  state.rows = [];
  state.shown = 0;
}

function appendRows() {
  const startMs = state.events.length ? tsMs(state.events[0]) : null;
  const fragment = document.createDocumentFragment();
  for (let i = state.rows.length; i < state.events.length; i++) {
    const row = buildRow(state.events[i], startMs);
    row.hidden = true;                        // revealRows() shows it once the cursor passes
    state.rows.push(row);
    fragment.append(row);
  }
  $('events').append(fragment);
}

function statusIcon(ev) {
  const d = ev.data || {};
  if (isProblem(ev)) return icon('bad', '✕ ');
  const good = (ev.type === 'test_result' && d.passed)
    || (ev.type === 'review_verdict' && d.verdict === 'APPROVE')
    || (ev.type === 'task_end' && d.final === 'approved');
  return good ? icon('good', '✓ ') : null;
}

function buildRow(ev, startMs) {
  const ms = tsMs(ev);
  const tags = [ev.task_id != null ? `T${ev.task_id}` : null, ev.round != null ? `R${ev.round}` : null]
    .filter(Boolean).join(' ');
  const head = h('button', { class: 'ev-head', type: 'button', 'aria-expanded': 'false' },
    h('span', { class: 'ev-time', title: ev.ts }, ms != null && startMs != null ? fmtDuration(ms - startMs) : ''),
    h('span', { class: 'ev-who' }, h('i', { class: `dot ${roleClass(ev.role)}` }), ev.role || '?',
      tags ? h('small', {}, ' ' + tags) : null),
    h('code', { class: 'ev-type' }, ev.type),
    h('span', { class: 'ev-text' }, statusIcon(ev), describe(ev)));
  const row = h('li', { class: 'ev', 'data-group': groupOf(ev.type), 'data-problem': isProblem(ev) }, head);
  head.addEventListener('click', () => {
    let detail = row.querySelector('.ev-detail');
    if (detail) detail.hidden = !detail.hidden;
    else row.append(detail = h('pre', { class: 'ev-detail' }, JSON.stringify(ev, null, 2)));   // built on first open
    head.setAttribute('aria-expanded', String(!detail.hidden));
  });
  return row;
}

function revealRows() {
  if (state.cursor === state.shown) return;
  const list = $('events');
  const pinned = list.scrollHeight - list.scrollTop - list.clientHeight < 48;
  const grew = state.cursor > state.shown;
  const from = Math.min(state.shown, state.cursor);
  const to = Math.min(Math.max(state.shown, state.cursor), state.rows.length);
  for (let i = from; i < to; i++) state.rows[i].hidden = i >= state.cursor;
  state.shown = state.cursor;
  // Follow the newest event unless the reader has scrolled up to look at something.
  if (pinned || !grew) list.scrollTop = list.scrollHeight;
}

// --------------------------------------------------------------------- replay

function stopPlaying() {
  state.playing = false;
  clearTimeout(state.timer);
}

function play() {
  if (state.cursor >= state.events.length) state.cursor = 0;    // at the end: start over
  state.playing = true;
  state.follow = false;
  step();
}

function step() {
  if (!state.playing) return;
  const events = state.events;
  if (state.cursor >= events.length) {        // caught up with the run: back to live
    state.playing = false;
    state.follow = true;
    return scheduleRender();
  }
  const speed = Number($('speed').value) || 1;
  let delay = 16;
  state.cursor += 1;
  // Reveal events that are less than a frame apart together; cap long waits
  // (a slow model call) so replay never sits idle.
  while (state.cursor < events.length) {
    const gap = ((tsMs(events[state.cursor]) ?? 0) - (tsMs(events[state.cursor - 1]) ?? 0)) / speed;
    if (gap >= 16) { delay = Math.min(gap, 1500); break; }
    state.cursor += 1;
  }
  scheduleRender();
  state.timer = setTimeout(step, delay);
}

function seek(position) {
  stopPlaying();
  state.cursor = Math.max(0, Math.min(position, state.events.length));
  state.follow = state.cursor >= state.events.length;
  scheduleRender();
}

// --------------------------------------------------------------------- render

let queued = false;
function scheduleRender() {
  if (queued) return;
  queued = true;
  requestAnimationFrame(() => { queued = false; render(); });
}

function render() {
  const s = summarize(state.events.slice(0, state.cursor));
  state.summary = s;
  renderEmpty();
  renderStatus(s);
  renderReplay(s);
  renderKpis(s);
  revealRows();
  renderPlan(s);
  renderTests(s);
  renderCost(s);
}

function renderEmpty() {
  const empty = $('empty');
  const hasEvents = state.events.length > 0;
  $('dash').hidden = !hasEvents;
  empty.hidden = hasEvents;
  if (hasEvents) return;
  if (!state.sources.length) {
    empty.replaceChildren(
      h('p', {}, 'No recorded runs found under ', h('code', {}, state.roots.join(', ') || '.'), '.'),
      h('p', {}, 'Start a run in another terminal (', h('code', {}, 'waa --working-dir targets/kanban'),
        '), or restart this server with ', h('code', {}, '--demo'), ' to watch a synthetic one.'));
  } else {
    const source = state.sources.find((x) => x.id === state.sourceId);
    empty.replaceChildren(h('p', {}, 'Waiting for the first event in ', h('code', {}, source ? source.name : '?'), '…'));
  }
}

function ago(ms) {
  const sec = Math.max(0, Math.round((Date.now() - ms) / 1000));
  return sec < 2 ? 'just now' : sec < 90 ? `${sec}s ago` : `${fmtDuration(sec * 1000)} ago`;
}

function renderStatus(s) {
  const el = $('status');
  if (!state.online) {
    return el.replaceChildren(icon('bad', '✕ '), h('strong', {}, 'Disconnected'), '. The dashboard server is not responding.');
  }
  if (!s.last) return el.replaceChildren();
  const now = `${who(s.last)}: ${describe(s.last)}`;
  if (state.cursor < state.events.length) {
    el.replaceChildren(h('strong', {}, state.playing ? 'Replaying' : 'Paused'), ` at ${now}`);
  } else if (s.finished) {
    el.replaceChildren(icon('good', '✓ '), h('strong', {}, 'Finished'), ` after ${fmtDuration(s.elapsedMs)}`);
  } else {
    el.replaceChildren(icon('live', '● '), h('strong', {}, 'Running'), `, last event ${ago(s.endMs)}. ${now}`);
  }
  el.title = el.textContent;
}

function renderReplay(s) {
  const total = state.events.length;
  const first = total ? tsMs(state.events[0]) : null;
  const last = total ? tsMs(state.events[total - 1]) : null;
  $('scrub').max = total;
  $('scrub').value = state.cursor;
  $('play').textContent = state.playing ? 'Pause' : 'Play';
  $('play').disabled = total === 0;
  $('live').disabled = state.follow;
  $('position').textContent = total
    ? `Event ${state.cursor} of ${total}, ${fmtDuration(s.elapsedMs)} of ${fmtDuration((last ?? 0) - (first ?? 0))}`
    : '';
  $('event-count').textContent = total ? `(${state.cursor})` : '';
}

function renderKpis(s) {
  const passing = s.tests.filter((t) => t.passed).length;
  const tiles = [
    ['Elapsed', fmtDuration(s.elapsedMs), s.startMs != null ? `started ${new Date(s.startMs).toLocaleTimeString()}` : ''],
    ['Cost', fmtCost(s.cost), 'estimated from tokens'],
    ['Tokens', fmtCount(s.inputTokens + s.outputTokens), `${fmtCount(s.inputTokens)} in, ${fmtCount(s.outputTokens)} out`],
    ['Model calls', fmtCount(s.llmCalls), `in ${plural(s.spans.length, 'agent run')}`],
    ['Tool calls', fmtCount(s.toolCalls), `${s.toolErrors} failed` + (s.parseErrors ? `, ${s.parseErrors} malformed` : '')],
    ['Test files passing', s.tests.length ? `${passing} of ${s.tests.length}` : '–',
      s.tests.length ? plural(s.testRuns, 'test run') : 'none run yet'],
  ];
  if (s.team) tiles.push(['Review rejections', String(s.rejects), `of ${plural(s.reviews, 'review')}`]);
  memo($('kpis'), JSON.stringify(tiles), () => {
    $('kpis').replaceChildren(...tiles.map(([label, value, sub]) => h('div', { class: 'tile' },
      h('div', { class: 'tile-label' }, label),
      h('div', { class: 'tile-value' }, value),
      h('div', { class: 'tile-sub' }, sub))));
  });
}

// ---------------------------------------------------------------- plan, tests

const TASK_STATUS = {
  pending: ['', '○', 'Waiting'],
  active: ['live', '●', 'In progress'],
  approved: ['good', '✓', 'Approved'],
  forced: ['bad', '✕', 'Not approved'],
};

function issueItem(issue) {
  if (issue == null || typeof issue !== 'object') return h('li', {}, String(issue));
  const where = [issue.severity, issue.where].filter(Boolean).join(', ');
  return h('li', {}, where ? `${where}: ` : '', issue.what || '', issue.how_to_fix ? ` Fix: ${issue.how_to_fix}` : '');
}

function taskNode(task) {
  const [kind, glyph, label] = TASK_STATUS[task.status] || TASK_STATUS.pending;
  const node = h('details', { class: 'task', open: state.openTasks.has(task.id) },
    h('summary', {},
      h('span', { class: 'task-title' }, `${task.id}. ${task.title}`),
      h('span', { class: 'badge' }, icon(kind, glyph), label),
      task.verdicts.map((v) => h('span', { class: 'badge' },
        v.verdict === 'REJECT' ? icon('bad', '✕') : icon('good', '✓'),
        `Round ${v.round} ${v.verdict === 'REJECT' ? 'rejected' : 'approved'}`))),
    h('div', { class: 'task-body' },
      task.acceptance.length ? ['Acceptance', h('ul', {}, task.acceptance.map((a) => h('li', {}, String(a))))] : null,
      task.verdicts.map((v) => [
        h('div', {}, `Round ${v.round} review: ${v.summary}`),
        v.issues.length ? h('ul', {}, v.issues.map(issueItem)) : null,
      ]),
      !task.acceptance.length && !task.verdicts.length ? 'No details yet.' : null));
  node.addEventListener('toggle', () => {
    if (node.open) state.openTasks.add(task.id); else state.openTasks.delete(task.id);
  });
  return node;
}

function renderPlan(s) {
  const el = $('plan');
  memo(el, JSON.stringify([s.team, s.tasks]), () => {
    if (!s.team) el.replaceChildren(h('p', { class: 'hint' }, 'Single-agent run: no planner or reviewer.'));
    else if (!s.tasks.length) el.replaceChildren(h('p', { class: 'hint' }, 'The planner has not produced a plan yet.'));
    else el.replaceChildren(...s.tasks.map(taskNode));
  });
}

function renderTests(s) {
  const el = $('tests');
  memo(el, JSON.stringify(s.tests), () => {
    if (!s.tests.length) return el.replaceChildren(h('p', { class: 'hint' }, 'No tests have been run yet.'));
    el.replaceChildren(...s.tests.map((t) => h('div', { class: 'test' },
      h('span', {}, t.passed ? icon('good', '✓ ') : icon('bad', '✕ '), t.passed ? 'Passed' : 'Failed'),
      h('code', { title: t.file }, t.file),
      h('span', { class: 'counts' },
        `${t.summary.passed ?? 0} passed, ${t.summary.failed ?? 0} failed, ${plural(t.runs, 'run')}`))));
  });
}

// ----------------------------------------------------------------- cost chart

const callWho = (c) => who({ role: c.role, task_id: c.taskId, round: c.round });

function tickLabel(value, step) {
  if (value === 0) return '$0';
  let digits = 0;
  while (digits < 5 && Math.abs(step * 10 ** digits - Math.round(step * 10 ** digits)) > 1e-9) digits += 1;
  return '$' + value.toFixed(digits === 1 ? 2 : digits);
}

// Cumulative cost as a stepped line (it only moves when a model call returns),
// with a strip underneath showing which role was running when.
function costChart(s, width) {
  const M = { top: 12, right: 58, bottom: 20, left: 46 };
  const plotH = 130, stripGap = 10, stripH = 8;
  const height = M.top + plotH + stripGap + stripH + M.bottom;
  const left = M.left, right = width - M.right, base = M.top + plotH, stripY = base + stripGap;
  const maxT = Math.max(s.elapsedMs, 1000);
  const axis = niceTicks(s.cost > 0 ? s.cost : 0.01, 3);
  const px = (n) => Math.round(n * 10) / 10;
  const x = (t) => px(left + (Math.min(t, maxT) / maxT) * (right - left));
  const y = (v) => px(base - (v / axis.top) * plotH);

  const root = svg('svg', {
    viewBox: `0 0 ${width} ${height}`, height, role: 'img', tabindex: 0,
    'aria-label': `Cumulative estimated cost: ${fmtCost(s.cost)} after ${fmtDuration(s.elapsedMs)}. `
      + 'Left and right arrow keys step through model calls.',
  });

  for (const v of axis.ticks) {
    root.append(
      svg('line', { class: v === 0 ? 'baseline' : 'gridline', x1: left, x2: right, y1: y(v), y2: y(v) }),
      svg('text', { x: left - 8, y: y(v) + 4, 'text-anchor': 'end' }, tickLabel(v, axis.ticks[1])));
  }
  for (const t of timeTicks(maxT)) {
    root.append(svg('text', { x: x(t), y: stripY + stripH + 15, 'text-anchor': 'middle' }, fmtDuration(t)));
  }

  let line = `M${x(0)},${y(0)}`;
  for (const c of s.calls) line += `H${x(c.t)}V${y(c.total)}`;
  line += `H${right}`;
  root.append(
    svg('path', { class: 'total-area', d: `${line}V${base}H${left}Z` }),
    svg('path', { class: 'total-line', d: line }),
    svg('circle', { class: 'end-dot', cx: right, cy: y(s.cost), r: 5 }),
    svg('text', { class: 'end-label', x: right + 10, y: y(s.cost) + 4 }, fmtCost(s.cost)));

  for (const span of s.spans) {
    const xa = x(span.t0), xb = Math.max(x(span.t1), xa + 2);
    const w = Math.max(2, xb - xa - 2);                         // 2px of surface between neighbours
    const hit = svg('rect', { class: 'span-hit', x: xa, y: stripY - 8, width: Math.max(xb - xa, 6), height: stripH + 16 });
    hit.addEventListener('pointermove', (e) => showTip(e.clientX, e.clientY,
      h('strong', {}, fmtCost(span.cost)),
      h('div', {}, h('span', { class: `key ${roleClass(span.role)}` }), callWho(span)),
      `${fmtDuration(span.t0)} to ${fmtDuration(span.t1)}, ${plural(span.calls, 'model call')}`
        + (span.open ? ', still running' : '')));
    hit.addEventListener('pointerleave', hideTip);
    root.append(hit, svg('rect', { class: `span ${roleClass(span.role)}`, x: xa, y: stripY, width: px(w), height: stripH, rx: Math.min(4, w / 2) }));
  }

  // Hover layer: the pointer only has to be near a call's x, never on the line.
  const cross = svg('line', { class: 'crosshair', y1: M.top, y2: base, visibility: 'hidden' });
  const dot = svg('circle', { class: 'cross-dot', r: 5, visibility: 'hidden' });
  const overlay = svg('rect', { x: left, y: M.top, width: right - left, height: plotH, fill: 'transparent' });
  let index = -1;
  const point = (i, clientX, clientY) => {
    index = i;
    const c = s.calls[i];
    for (const [el, attrs] of [[cross, { x1: x(c.t), x2: x(c.t) }], [dot, { cx: x(c.t), cy: y(c.total) }]]) {
      for (const [name, value] of Object.entries(attrs)) el.setAttribute(name, value);
      el.setAttribute('visibility', 'visible');
    }
    if (clientX == null) {                                      // keyboard: anchor the tooltip to the point
      const box = root.getBoundingClientRect();
      clientX = box.left + x(c.t) * (box.width / width);
      clientY = box.top + y(c.total) * (box.height / height);
    }
    showTip(clientX, clientY,
      h('strong', {}, fmtCost(c.total)), `total at ${fmtDuration(c.t)}`,
      h('div', {}, h('span', { class: `key ${roleClass(c.role)}` }),
        `${callWho(c)}: +${fmtCost(c.cost)}, ${fmtCount(c.inTok)} in, ${fmtCount(c.outTok)} out`));
  };
  const clear = () => {
    index = -1;
    cross.setAttribute('visibility', 'hidden');
    dot.setAttribute('visibility', 'hidden');
    hideTip();
  };
  overlay.addEventListener('pointermove', (e) => {
    const box = root.getBoundingClientRect();
    const at = (e.clientX - box.left) * (width / box.width);
    let best = 0;
    for (let i = 1; i < s.calls.length; i++) {
      if (Math.abs(x(s.calls[i].t) - at) < Math.abs(x(s.calls[best].t) - at)) best = i;
    }
    point(best, e.clientX, e.clientY);
  });
  overlay.addEventListener('pointerleave', clear);
  root.addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    e.preventDefault();
    const next = index < 0 ? s.calls.length - 1 : index + (e.key === 'ArrowRight' ? 1 : -1);
    point(Math.max(0, Math.min(s.calls.length - 1, next)));
  });
  root.addEventListener('blur', clear);
  root.append(cross, dot, overlay);
  return root;
}

// The same data as the chart, as rows: the non-visual way to read every value.
function costTable(s) {
  const head = ['Time', 'Who', 'In', 'Out', 'Cost', 'Total'];
  return h('table', {},
    h('thead', {}, h('tr', {}, head.map((name, i) => h('th', { class: i >= 2 ? 'num' : null }, name)))),
    h('tbody', {}, s.calls.map((c) => h('tr', {},
      h('td', {}, fmtDuration(c.t)), h('td', {}, callWho(c)),
      h('td', { class: 'num' }, fmtCount(c.inTok)), h('td', { class: 'num' }, fmtCount(c.outTok)),
      h('td', { class: 'num' }, fmtCost(c.cost)), h('td', { class: 'num' }, fmtCost(c.total))))));
}

function renderCost(s) {
  const chart = $('cost-chart'), table = $('cost-table'), roles = $('roles');
  chart.hidden = state.tableView;
  table.hidden = !state.tableView;
  $('cost-view').textContent = state.tableView ? 'Chart' : 'Table';
  const data = JSON.stringify([s.calls.length, s.elapsedMs, s.spans.length, s.cost]);

  if (state.tableView) {
    memo(table, data, () => table.replaceChildren(
      s.calls.length ? costTable(s) : h('p', { class: 'hint' }, 'No model calls yet.')));
  } else {
    const width = Math.max(280, Math.floor(chart.clientWidth));
    memo(chart, `${data}|${width}`, () => {
      hideTip();
      chart.replaceChildren(s.calls.length ? costChart(s, width) : h('p', { class: 'hint' }, 'No model calls yet.'));
    });
  }

  // Per-role totals. This list is also the legend for the strip under the chart.
  const most = Math.max(...s.roles.map((r) => r.cost), 0);
  memo(roles, JSON.stringify(s.roles), () => roles.replaceChildren(...s.roles.map((r) =>
    h('div', { class: `role-row ${roleClass(r.role)}` },
      h('span', {}, h('i', { class: 'dot' }), r.role),
      h('div', { class: 'bar' }, h('div', { class: 'bar-fill', style: `width:${most ? (r.cost / most) * 100 : 0}%` })),
      h('span', { class: 'figure' }, h('strong', {}, fmtCost(r.cost)), `, ${plural(r.calls, 'call')}`)))));
}

// ----------------------------------------------------------------------- wire

$('source').addEventListener('change', (e) => selectSource(e.target.value));
$('run').addEventListener('change', (e) => {
  state.runChoice = e.target.value;
  saveHash();
  showRun(currentRun());
});
$('play').addEventListener('click', () => {
  if (state.playing) stopPlaying(); else play();
  scheduleRender();
});
$('scrub').addEventListener('input', (e) => seek(Number(e.target.value)));
$('live').addEventListener('click', () => seek(state.events.length));
$('cost-view').addEventListener('click', () => {
  state.tableView = !state.tableView;
  scheduleRender();
});
$('filters').addEventListener('change', (e) => {
  const list = $('events');
  if (e.target.id === 'only-problems') list.classList.toggle('only-problems', e.target.checked);
  else if (e.target.dataset.group) list.classList.toggle(`hide-${e.target.dataset.group}`, !e.target.checked);
});
new ResizeObserver(scheduleRender).observe($('cost-chart'));

const wanted = new URLSearchParams(location.hash.slice(1));
state.wantedSource = wanted.get('source');
state.runChoice = wanted.get('run') || 'latest';

refreshSources().finally(wake);               // wake() never starts a second poll loop
setInterval(refreshSources, SOURCES_MS);
setInterval(() => { if (state.summary) renderStatus(state.summary); }, 1000);   // keeps "last event Ns ago" ticking
