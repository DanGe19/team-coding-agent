# Team notes (EN.601.727 final project)

Team: Kaicheng Cao, Weichao Huang, Jung Yoon, Jingyang Chen

This repo starts from Jingyang's Assignment 3 solution (WAA, the Web-App Agent;
report and logs in docs/hw3/, apps it built in experiments/reference/hw3_built/) and grows into the
final project: planner/coder/reviewer team, vision loop, long-term memory, dashboard.

## Setup

```bash
bash scripts/setup.sh              # venv, python deps, playwright chromium
source .venv/bin/activate
export AWS_BEARER_TOKEN_BEDROCK=...
```

Node.js 18+ and npm are required. `bash scripts/validate_reference.sh <task>` runs every
visible and hidden test of a new task against its reference solution (API + UI).

## Tests (HW3 Parts 1 & 2)

| File | Tests | Status |
|---|---|---|
| tests/test_fs_mock_agent.py | 26 | pass |
| tests/test_todo_mock_agent.py | 18 | pass |
| tests/test_server_mock_agent.py | 8 | pass (runs npm install) |
| tests/test_testing_tools.py | 10 | pass (installs Playwright) |
| tests/test_team_mock.py | 4 | pass (team mode, mock LLM) |
| tests/test_events.py | 3 | pass (event stream) |
| tests/test_dashboard.py | 6 | pass (dashboard server, no browser) |

Run one with `python tests/<file>.py`.

## Integration contract

All features talk through the event stream `.waa/events.jsonl`.
Read **docs/EVENTS.md** before writing code for the dashboard, memory or vision.
`python -m waa.events <target>` prints a readable timeline of a run.

## Dashboard (mission control)

Watch a run live. The dashboard does not start by itself: it runs in its own terminal, next to `waa`.

```bash
mkdir -p experiments/runs && cp -R targets/kanban experiments/runs/kanban-live   # working copy (why: below)
python -m waa.dashboard experiments/runs/kanban-live --open    # terminal 1: opens http://127.0.0.1:8765/
waa --working-dir experiments/runs/kanban-live --team          # terminal 2: needs AWS_BEARER_TOKEN_BEDROCK
```
Give the dashboard the same folder as `waa --working-dir`. The page waits for the first event, then
updates every second. Work in a copy, not in `targets/<task>`: `waa` builds the app inside its working
dir, and `run_experiments.py` copies everything in `targets/<task>` except logs, usage files and
`node_modules` into each experiment run, so leftover app files would give later runs a head start.
`experiments/runs/` is gitignored.

Other ways to start it:

```bash
python -m waa.dashboard experiments/runs   # every recorded run below a folder, in the Folder dropdown
python -m waa.dashboard                    # the same, searching the current directory
python -m waa.dashboard --demo --open      # synthetic team run, no API key needed
```
`--port` changes the port and `--help` lists every option. While `run_experiments.py` is running, each
new run appears in the Folder dropdown within a few seconds; pick it there, because the page stays on
the folder it is showing.

Replay needs no extra step. Every `waa` run records itself by appending each event to
`.waa/events.jsonl` as it happens, and the page is drawn from that file alone: the live view reads it
as it grows, and Play or the scrubber redraws from the same events up to a chosen point. Any folder
that still has its `events.jsonl` can be replayed later, on any machine. Event types the page does not
know yet (`screenshot`, `memory_*`) appear in the timeline as plain rows.

Code: `waa/dashboard/` (`server.py` serves and tails, `static/model.js` turns events into numbers,
`static/app.js` draws them, `demo.py` writes the synthetic run). No extra dependencies, no build step,
and no changes to the agent: the server tails the file from its own process.

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
