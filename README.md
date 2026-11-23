# Team Coding Agent

**EN.601.727 Machine Programming — Final Project (Fall 2026)**
Kaicheng Cao · Weichao Huang · Jung Yoon · Jingyang Chen

A web-app coding agent that **plans, sees, remembers, and reports**. We extend WAA (the
single-agent Web-App Agent from Assignment 3) with four switchable features and measure
each one separately against executable tests:

| feature | owner | status |
|---|---|---|
| **Team mode** — planner / coder / reviewer; the reviewer can reject work | Jingyang | implemented, under evaluation |
| **Vision loop** — screenshot the app, fix visual defects | Weichao | planned |
| **Long-term memory** — lessons stored after each run, retrieved for new tasks | Kaicheng | planned |
| **Mission control** — live dashboard of agent actions, cost and tests; replay | Jung | planned |

Everything plugs into one **event stream** (`.waa/events.jsonl`, see [docs/EVENTS.md](docs/EVENTS.md)),
so the features integrate without touching each other's code.

## Repository map

```
waa/                 the agent (HW3 core + team.py, roles.py, events.py, usage tracking)
targets/             benchmark tasks: chat_room, tetris, snake (HW3) + kanban, park_waits,
                     nba_standings, pixel_board (new, with hidden tests)  → targets/README.md
experiments/         run_experiments.py (baseline vs features, repeats, hidden tests),
                     summarize.py, evaluate_dir.py, hidden_tests/, reference/, results/
docs/                EVENTS.md (integration contract), hw3/ (original assignment, report, logs)
scripts/             setup.sh, validate_reference.sh
tests/               unit tests (mock LLM): HW3 tools, team mode, events, experiment pipeline
```

## Quick start

```bash
bash scripts/setup.sh && source .venv/bin/activate
export AWS_BEARER_TOKEN_BEDROCK=...

waa --working-dir targets/kanban                 # baseline (HW3 single agent)
waa --working-dir targets/kanban --team --debug  # planner / coder / reviewer
python -m waa.events targets/kanban              # readable timeline of the run

python experiments/run_experiments.py --targets kanban --settings baseline team --repeats 3
python experiments/summarize.py
```

More detail in [TEAM_NOTES.md](TEAM_NOTES.md).

## Results so far

See `experiments/results/results.csv` (one row per run) and `python experiments/summarize.py`.

| target | setting | n | hidden pass | cost $ (mean) | time s (mean) |
|---|---|---|---|---|---|
| kanban | baseline | 3 | 100% | 1.52 | 90 |
| kanban | team | 3 | 100% | 2.67 | 297 |

kanban turned out to be at the ceiling for both settings; the harder tasks (pixel_board,
park_waits, nba_standings) are being run next.
