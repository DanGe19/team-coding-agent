# Experiments

Ablation study: same tasks, different feature flags, several repeats, hidden tests.

```
experiments/
├── run_experiments.py   batch runner (one row per run → results/results.csv)
├── summarize.py         per-(target, setting) means → markdown table
├── hidden_tests/<target>/   tests the agent never sees (ui.test.js / api.test.js), optional
├── runs/                one working copy per run (git-ignored)
└── results/             results.csv, results.jsonl, runner.log (commit these)
```

## Run

```bash
export AWS_BEARER_TOKEN_BEDROCK=...
python experiments/run_experiments.py --targets chat_room --settings baseline team --repeats 3
python experiments/summarize.py
```

Settings: `baseline`, `team`, `vision`, `memory`, `all` (flags in `SETTINGS` inside the runner).
Re-running resumes: finished rows in results.csv are skipped. `--force` redoes them.
`--dry-run` uses the mock LLM to check the pipeline without spending anything.

## Columns in results.csv

| column | meaning |
|---|---|
| visible_passed / _failed | tests shipped with the target (the agent saw them) |
| hidden_passed / _failed | tests from `experiments/hidden_tests/<target>/` |
| total_tokens, cost_usd | from `.waa/usage.json` (cost is an estimate) |
| tool_calls, tool_errors | from `events.jsonl` |
| plan_tasks, review_rounds, review_rejects | team mode only |
| wall_sec | agent run time (excludes evaluation) |

## Adding a hidden test set

Create `experiments/hidden_tests/<target>/` with `ui.test.js` (Playwright, server on :3000)
and/or `api.test.js` (Jest + Supertest, `require('../../index')`). Keep them out of `targets/`.
