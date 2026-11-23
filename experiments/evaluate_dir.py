#!/usr/bin/env python3
"""
Score an app the agent built (visible + hidden tests), without running the agent.

    python experiments/evaluate_dir.py targets/kanban            # task name = folder name
    python experiments/evaluate_dir.py experiments/runs/x kanban # explicit task name

Prints pass/fail counts and the names of failing hidden tests.
"""
import json, subprocess, sys
from pathlib import Path
ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "experiments"))
from run_experiments import evaluate, collect_metrics  # noqa: E402


def main():
    if len(sys.argv) < 2:
        print(__doc__); sys.exit(1)
    run_dir = Path(sys.argv[1]).resolve()
    task = sys.argv[2] if len(sys.argv) > 2 else run_dir.name
    hidden = ROOT / "experiments" / "hidden_tests" / task
    res = evaluate(run_dir, hidden if hidden.exists() else None, 300, print)
    print(json.dumps(res, indent=2))
    # list failing hidden tests from the reports evaluate() left behind
    for name in ("pw_report_visible.json", "pw_report_hidden.json", "jest_report_visible.json", "jest_report_hidden.json"):
        p = run_dir / ".waa" / name
        if not p.exists():
            continue
        data = json.loads(p.read_text())
        if name.startswith("pw"):
            def walk(suite, acc):
                for s in suite.get("suites", []): walk(s, acc)
                for sp in suite.get("specs", []):
                    for t in sp.get("tests", []):
                        if t.get("status") not in ("expected", "skipped"):
                            acc.append(f"[ui] {sp.get('file')} › {sp.get('title')}")
            acc = []; [walk(s, acc) for s in data.get("suites", [])]
        else:
            acc = [f"[api] {Path(r['name']).name} › {a['fullName']}" for r in data.get("testResults", [])
                   for a in r.get("assertionResults", []) if a.get("status") != "passed"]
        for line in acc: print("FAIL", line)
    m = collect_metrics(run_dir)
    print(f"agent usage: calls={m['llm_calls']} tokens={m['total_tokens']} cost~${m['cost_usd']} rejects={m['review_rejects']}/{m['review_rounds']}")


if __name__ == "__main__":
    main()
