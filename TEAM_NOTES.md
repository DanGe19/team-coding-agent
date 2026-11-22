# Team notes (EN.601.727 final project)

Team: Kaicheng Cao, Weichao Huang, Jung Yoon, Jingyang Chen

This repo starts from Assignment 3 (WAA, the Web-App Agent) and will grow into the
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

## Running the agent

```bash
export AWS_BEARER_TOKEN_BEDROCK=...
waa --working-dir targets/chat_room --debug
```
