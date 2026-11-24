# Event stream: the shared interface between features

Every `waa` run appends events to **`.waa/events.jsonl`** (one JSON object per line).
This file is the contract between the four features. Build against it; do not parse `agent.log`.

| Feature | Uses the stream how |
|---|---|
| Team (Jingyang) | writes `plan_created`, `task_*`, `review_verdict`; every role tags its events with `role`, `task_id`, `round` |
| Dashboard (Jung) | `python -m waa.dashboard` tails the file from its own process for the live view and replay (`subscribe(cb)` only fires inside the emitting process) |
| Memory (Kaicheng) | reads a finished run (`review_verdict`, `test_result`, `tool_result` with `ok:false`) to extract lessons; writes `memory_retrieved` / `memory_stored` |
| Vision (Weichao) | writes `screenshot` / `visual_check` from the new tool |

Quick look at any folder: `python -m waa.events targets/chat_room` (add `--follow` to tail live).

## Event shape

```json
{
  "seq": 24,
  "ts": "2026-11-22T15:29:43.449",
  "run_id": "20261122-152943",
  "role": "reviewer",
  "task_id": 1,
  "round": 1,
  "type": "review_verdict",
  "data": { "verdict": "REJECT", "summary": "Wrong port.", "issues": [ ... ] }
}
```

- `seq` unique and increasing within the file; `run_id` identical for all events of one `waa` invocation.
- `role`: `agent` (plain HW3 mode) | `planner` | `coder` | `reviewer` | `orchestrator`.
- `task_id` / `round` are `null` outside team mode.
- `data` is type-specific (below). Long strings are truncated at 20k chars.

## Event types

### Lifecycle
| type | emitted by | data |
|---|---|---|
| `team_start` | orchestrator | `config` |
| `team_end` | orchestrator | `elapsed_sec`, `usage_by_role`, `usage_total` |
| `plan_created` | planner | `tasks: [{id, title, description, acceptance[]}]` |
| `task_start` | orchestrator | `title`, `acceptance[]` |
| `task_end` | orchestrator | `final: "approved" \| "forced_after_max_rounds"`, `rounds` |
| `run_start` | any role | `max_turns`, `tools[]` |
| `run_end` | any role | `turns`, `terminated`, `usage {calls, input_tokens, output_tokens, total_tokens, cost_usd}` |

### Agent loop
| type | data |
|---|---|
| `llm_query` | `turn`, `message_count` |
| `llm_response` | `turn`, `text`, `is_tool_call`, `is_termination`, `usage {input_tokens, output_tokens, latency_ms, cost_usd}` |
| `tool_call` | `tool`, `arguments` |
| `tool_result` | `tool`, `ok`, `error`, `result` (bulky fields replaced by `<name>_len`) |
| `test_result` | `tool` (`supertest.run` / `playwright.run`), `test_file`, `passed`, `summary {passed, failed, ...}` |
| `parse_error` | `error` |

### Team
| type | data |
|---|---|
| `review_verdict` | `verdict: "APPROVE" \| "REJECT"`, `summary`, `issues: [{severity, where, what, how_to_fix}]` |

### Extension points (not emitted yet; reserved for your features)
| type | intended data |
|---|---|
| `screenshot` | `path`, `url`, `viewport` |
| `visual_check` | `path`, `verdict`, `issues[]` |
| `memory_retrieved` | `query`, `lessons[]` |
| `memory_stored` | `lessons[]` |
| `usage` | any usage snapshot |
| `note` | anything |

Need a new type? Add it to `EVENT_TYPES` in `waa/events.py` and to this table in the same PR.

## Emitting from your code

```python
from waa.events import EventLog
log = EventLog(working_dir)                  # one shared instance per folder
log.emit("screenshot", role="coder", task_id=2, round=1,
         data={"path": ".waa/shots/t2_r1_home.png", "url": "http://localhost:3000/"})
```

Inside an `Agent` subclass or tool that has access to the agent, `agent.emit("screenshot", path=..., url=...)`
fills in role/task/round for you.

## Reading

```python
from waa.events import EventLog
events = EventLog.read("targets/chat_room")                       # all
verdicts = EventLog.read("targets/chat_room", types=["review_verdict"])
one_run = EventLog.read("targets/chat_room", run_id="20261122-152943")
```

## Other files you can rely on
- `.waa/usage.json` — one entry per agent run: tokens, estimated cost, turns, role.
- `.waa/team_summary.json` — plan, per-task rounds and verdicts, `usage_by_role`.
- `.waa/logs/<role>_t<task>_r<round>.log` — human-readable transcript per role run.
