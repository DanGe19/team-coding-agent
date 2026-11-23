# Team notes (EN.601.727 final project)

Team: Kaicheng Cao, Weichao Huang, Jung Yoon, Jingyang Chen

This repo starts from Jingyang's Assignment 3 solution (WAA, the Web-App Agent;
report and logs in docs/hw3/, apps it built in experiments/reference/hw3_built/) and grows into the
final project: planner/coder/reviewer team, vision loop, long-term memory, dashboard.

## Setup

```bash
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
pip install -e .
```

Node.js 18+ and npm are also required.

## Tests (HW3 Parts 1 & 2)

| File | Tests | Status |
|---|---|---|
| tests/test_fs_mock_agent.py | 26 | pass |
| tests/test_todo_mock_agent.py | 18 | pass |
| tests/test_server_mock_agent.py | 8 | pass (runs npm install) |
| tests/test_testing_tools.py | 10 | pass (installs Playwright) |
| tests/test_team_mock.py | 4 | pass (team mode, mock LLM) |
| tests/test_events.py | 3 | pass (event stream) |

Run one with `python tests/<file>.py`.

## Integration contract

All features talk through the event stream `.waa/events.jsonl`.
Read **docs/EVENTS.md** before writing code for the dashboard, memory or vision.
`python -m waa.events <target>` prints a readable timeline of a run.

## Team mode (planner / coder / reviewer)

```bash
waa --working-dir targets/chat_room --team --debug
# or set "team": {"enabled": true} in .waa/config.json
```
Outputs: `.waa/logs/<role>_t<task>_r<round>.log`, `.waa/team_summary.json`, `.waa/usage.json`.

## Benchmark tasks

| target | source | visible tests | hidden tests |
|---|---|---|---|
| chat_room | HW3 | tests/ | — (todo) |
| tetris | HW3 | tests/m1_core, m2_rules, m3_leaderboard | — (todo) |
| snake | HW3 (Jingyang's custom task, "Portal Snake") | tests/ | — (todo) |
| kanban | new | 5 api + 3 ui | 8 api + 7 ui in experiments/hidden_tests/kanban |
| park_waits | new | 5 api + 3 ui | 10 api + 7 ui in experiments/hidden_tests/park_waits |
| nba_standings | new | 5 api + 3 ui | 12 api + 7 ui in experiments/hidden_tests/nba_standings |
| pixel_board | new | 5 api + 3 ui | 8 api + 7 ui in experiments/hidden_tests/pixel_board |

What each new task stresses: kanban = CRUD + ordering invariants; park_waits = tick-based
state machine + map/visual layout; nba_standings = derived statistics + tie-break rules;
pixel_board = undo/redo history + flood fill + pixel geometry.

Reference solutions for new tasks live in `experiments/reference/` (never shown to the agent).

## Running the agent

```bash
export AWS_BEARER_TOKEN_BEDROCK=...
waa --working-dir targets/chat_room --debug
```
