// Pure functions: events in, view state out. No DOM in this file, so it can be
// run from Node as well as from the page. Event shapes: docs/EVENTS.md.

export const ROLE_ORDER = ['agent', 'planner', 'coder', 'reviewer'];

const GROUPS = {
  llm_query: 'llm', llm_response: 'llm',
  tool_call: 'tool', tool_result: 'tool', parse_error: 'tool',
  test_result: 'test',
  team_start: 'team', team_end: 'team', plan_created: 'team',
  task_start: 'team', task_end: 'team', review_verdict: 'team',
  run_start: 'run', run_end: 'run',
};

/** Timeline filter group of an event type. Types this file has never heard of
 *  (screenshot, memory_*, anything added later) land in "other" and still show. */
export function groupOf(type) {
  return GROUPS[type] || 'other';
}

/** True for events a reader scanning for trouble wants to see. */
export function isProblem(ev) {
  const d = ev.data || {};
  return (ev.type === 'tool_result' && !d.ok)
    || ev.type === 'parse_error'
    || (ev.type === 'test_result' && !d.passed)
    || (ev.type === 'review_verdict' && d.verdict === 'REJECT');
}

/** `ts` is local time without a zone; Date.parse reads that form as local time. */
export function tsMs(ev) {
  const t = Date.parse(ev.ts);
  return Number.isNaN(t) ? null : t;
}

/** One folder's file can hold several `waa` invocations; split them by run_id. */
export function splitRuns(events) {
  const runs = new Map();
  for (const ev of events) {
    const id = ev.run_id || '(no run id)';
    if (!runs.has(id)) runs.set(id, { id, events: [], team: false });
    const run = runs.get(id);
    run.events.push(ev);
    if (ev.type === 'team_start') run.team = true;
  }
  return [...runs.values()];
}

/** Everything the page shows, computed from the events up to the replay cursor. */
export function summarize(events) {
  const s = {
    count: events.length, team: false, finished: false,
    startMs: null, endMs: null, elapsedMs: 0,
    cost: 0, inputTokens: 0, outputTokens: 0, llmCalls: 0,
    toolCalls: 0, toolErrors: 0, parseErrors: 0,
    tests: [], testRuns: 0,
    tasks: [], reviews: 0, rejects: 0,
    roles: [],    // per role: calls, tokens, cost
    calls: [],    // one per model call: when, who, cost, running total
    spans: [],    // one per role run (run_start..run_end): who was active when
    last: null,
  };
  const tests = new Map(), tasks = new Map(), roles = new Map();
  let open = null, sawTeamEnd = false, sawRunEnd = false;

  const taskFor = (id) => {
    if (!tasks.has(id)) {
      const task = { id, title: `Task ${id}`, description: '', acceptance: [], status: 'pending', rounds: 0, verdicts: [] };
      tasks.set(id, task);
      s.tasks.push(task);
    }
    return tasks.get(id);
  };

  for (const ev of events) {
    const d = ev.data || {};
    const ms = tsMs(ev);
    if (ms != null) {
      if (s.startMs == null) s.startMs = ms;
      s.endMs = Math.max(s.endMs ?? ms, ms);
    }
    const t = ms != null && s.startMs != null ? ms - s.startMs : s.elapsedMs;
    s.elapsedMs = Math.max(s.elapsedMs, t);

    switch (ev.type) {
      case 'llm_response': {
        const u = d.usage || {};
        const cost = Number(u.cost_usd) || 0, inTok = Number(u.input_tokens) || 0, outTok = Number(u.output_tokens) || 0;
        s.cost += cost; s.inputTokens += inTok; s.outputTokens += outTok; s.llmCalls += 1;
        if (!roles.has(ev.role)) roles.set(ev.role, { role: ev.role, calls: 0, inputTokens: 0, outputTokens: 0, cost: 0 });
        const r = roles.get(ev.role);
        r.calls += 1; r.inputTokens += inTok; r.outputTokens += outTok; r.cost += cost;
        if (open) { open.calls += 1; open.cost += cost; }
        s.calls.push({ t, role: ev.role, taskId: ev.task_id, round: ev.round, cost, total: s.cost, inTok, outTok });
        break;
      }
      case 'tool_call': s.toolCalls += 1; break;
      case 'tool_result': if (!d.ok) s.toolErrors += 1; break;
      case 'parse_error': s.parseErrors += 1; break;
      case 'test_result': {
        const key = d.test_file || d.tool || 'tests';
        const prev = tests.get(key);
        tests.set(key, { file: key, tool: d.tool, passed: !!d.passed, summary: d.summary || {}, runs: (prev ? prev.runs : 0) + 1 });
        s.testRuns += 1;
        break;
      }
      case 'run_start':
        if (open) open.t1 = t;                      // previous run never reported its end
        open = { role: ev.role, taskId: ev.task_id, round: ev.round, t0: t, t1: null, calls: 0, cost: 0 };
        s.spans.push(open);
        break;
      case 'run_end':
        if (open) { open.t1 = t; open = null; }
        sawRunEnd = true;
        break;
      case 'team_start': s.team = true; break;
      case 'team_end': sawTeamEnd = true; break;
      case 'plan_created':
        for (const p of d.tasks || []) {
          Object.assign(taskFor(p.id), { title: p.title || `Task ${p.id}`, description: p.description || '', acceptance: p.acceptance || [] });
        }
        break;
      case 'task_start': {
        const task = taskFor(ev.task_id);
        task.status = 'active';
        if (d.title) task.title = d.title;
        if (d.acceptance && !task.acceptance.length) task.acceptance = d.acceptance;
        break;
      }
      case 'review_verdict': {
        const task = taskFor(ev.task_id);
        task.verdicts.push({ round: ev.round, verdict: d.verdict, summary: d.summary || '', issues: d.issues || [] });
        task.rounds = Math.max(task.rounds, ev.round || 0);
        s.reviews += 1;
        if (d.verdict === 'REJECT') s.rejects += 1;
        break;
      }
      case 'task_end': {
        const task = taskFor(ev.task_id);
        task.status = d.final === 'approved' ? 'approved' : 'forced';
        if (d.rounds) task.rounds = d.rounds;
        break;
      }
      default: break;
    }
  }

  for (const span of s.spans) {
    if (span.t1 == null) { span.t1 = s.elapsedMs; span.open = true; }
  }
  s.finished = s.team ? sawTeamEnd : sawRunEnd;
  s.tests = [...tests.values()];
  const rank = (role) => { const i = ROLE_ORDER.indexOf(role); return i < 0 ? ROLE_ORDER.length : i; };
  s.roles = [...roles.values()].sort((a, b) => rank(a.role) - rank(b.role));
  s.last = events.length ? events[events.length - 1] : null;
  return s;
}

/** "coder · task 1 · round 2" */
export function who(ev) {
  return [ev.role || '?', ev.task_id != null ? `task ${ev.task_id}` : null, ev.round != null ? `round ${ev.round}` : null]
    .filter(Boolean).join(' · ');
}

function clip(text, max = 140) {
  const str = String(text ?? '').replace(/\s+/g, ' ').trim();
  return str.length > max ? str.slice(0, max - 1) + '…' : str;
}

/** One line of plain text for an event: the timeline row and the "now" line. */
export function describe(ev) {
  const d = ev.data || {};
  switch (ev.type) {
    case 'llm_query':
      return `Asking the model (turn ${d.turn ?? '?'}, ${d.message_count ?? '?'} messages)`;
    case 'llm_response': {
      const u = d.usage || {};
      const kind = d.is_tool_call ? 'a tool call' : d.is_termination ? 'done' : 'a message';
      const bits = [];
      if (u.output_tokens != null) bits.push(`${fmtCount(u.output_tokens)} tokens out`);
      if (u.latency_ms) bits.push(`${(u.latency_ms / 1000).toFixed(1)}s`);
      if (u.cost_usd) bits.push(fmtCost(u.cost_usd));
      return `Model replied with ${kind}` + (bits.length ? ` (${bits.join(', ')})` : '');
    }
    case 'tool_call': return `${d.tool} ${clip(JSON.stringify(d.arguments ?? {}), 110)}`;
    case 'tool_result': return d.ok ? `${d.tool} ok` : `${d.tool} failed: ${clip(d.error)}`;
    case 'test_result': {
      const sum = d.summary || {};
      return `${d.test_file || d.tool}: ${d.passed ? 'passed' : 'failed'} (${sum.passed ?? 0} passed, ${sum.failed ?? 0} failed)`;
    }
    case 'parse_error': return `Malformed tool call: ${clip(d.error)}`;
    case 'review_verdict': {
      const n = (d.issues || []).length;
      return `${d.verdict === 'REJECT' ? 'Rejected' : 'Approved'}: ${clip(d.summary)}` + (n ? ` (${n} issue${n === 1 ? '' : 's'})` : '');
    }
    case 'plan_created': {
      const list = d.tasks || [];
      return `Plan with ${list.length} task${list.length === 1 ? '' : 's'}: ` + clip(list.map((p) => `#${p.id} ${p.title}`).join('; '), 160);
    }
    case 'task_start': return `Task started: ${clip(d.title)}`;
    case 'task_end':
      return (d.final === 'approved' ? 'Task approved' : 'Task still rejected, moving on')
        + ` after ${d.rounds ?? '?'} round${d.rounds === 1 ? '' : 's'}`;
    case 'run_start': return `Started (up to ${d.max_turns ?? '?'} turns, ${(d.tools || []).length} tools)`;
    case 'run_end': {
      const u = d.usage || {};
      return `Ended after ${d.turns ?? '?'} turn${d.turns === 1 ? '' : 's'}` + (u.total_tokens != null ? `, ${fmtCount(u.total_tokens)} tokens, ${fmtCost(u.cost_usd)}` : '');
    }
    case 'team_start': return 'Team run started';
    case 'team_end': {
      const u = d.usage_total || {};
      return `Team run finished in ${fmtDuration((d.elapsed_sec || 0) * 1000)}` + (u.cost_usd != null ? `, ${fmtCost(u.cost_usd)}` : '');
    }
    default: return clip(JSON.stringify(d), 160);
  }
}

// ------------------------------------------------------------------ formatting

export function fmtDuration(ms) {
  const total = Math.max(0, Math.round(ms / 1000));
  const h = Math.floor(total / 3600), m = Math.floor((total % 3600) / 60), sec = total % 60;
  const ss = String(sec).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}

export function fmtCost(value) {
  const v = Number(value) || 0;
  if (v === 0) return '$0.00';
  return '$' + v.toFixed(v >= 1 ? 2 : v >= 0.01 ? 3 : 4);
}

export function fmtCount(value) {
  const n = Number(value) || 0;
  if (n < 10000) return n.toLocaleString('en-US');
  if (n < 1e6) return (n / 1e3).toFixed(n < 1e5 ? 1 : 0) + 'K';
  return (n / 1e6).toFixed(2) + 'M';
}

// ---------------------------------------------------------------------- scales

/** Clean axis ticks from 0 up to at least `max`: { top, ticks }. */
export function niceTicks(max, target = 4) {
  const span = max > 0 ? max : 1;
  const raw = span / target;
  const pow = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * pow).find((v) => v >= raw - 1e-12);
  const count = Math.ceil(span / step - 1e-9);
  const ticks = [];
  for (let i = 0; i <= count; i++) ticks.push(+(i * step).toPrecision(12));
  return { top: ticks[ticks.length - 1], ticks };
}

const TIME_STEPS = [1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 900, 1800, 3600, 7200];

/** Tick positions in ms for an elapsed-time axis ending at `maxMs`. */
export function timeTicks(maxMs, target = 5) {
  const seconds = maxMs / 1000;
  const step = TIME_STEPS.find((v) => seconds / v <= target) || Math.ceil(seconds / target / 3600) * 3600;
  const ticks = [];
  for (let v = 0; v <= seconds + 1e-9; v += step) ticks.push(v * 1000);
  return ticks;
}
