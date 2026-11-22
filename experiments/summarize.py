#!/usr/bin/env python3
"""
Aggregate experiments/results/results.csv into a per-(target, setting) table.

    python experiments/summarize.py                 # markdown table to stdout
    python experiments/summarize.py --csv out.csv   # also write summary csv
"""
import argparse
import csv
import statistics
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
NUM = ["wall_sec", "visible_passed", "visible_failed", "hidden_passed", "hidden_failed",
       "total_tokens", "cost_usd", "tool_calls", "tool_errors", "review_rejects", "review_rounds"]


def load(path: Path):
    with open(path, newline="") as f:
        return [r for r in csv.DictReader(f) if r.get("status") == "done"]


def f(x):
    try:
        return float(x)
    except (TypeError, ValueError):
        return 0.0


def summarize(rows):
    groups = defaultdict(list)
    for r in rows:
        groups[(r["target"], r["setting"])].append(r)
    out = []
    for (target, setting), rs in sorted(groups.items()):
        rec = {"target": target, "setting": setting, "n": len(rs)}
        vp = [f(r["visible_passed"]) for r in rs]
        vf = [f(r["visible_failed"]) for r in rs]
        hp = [f(r["hidden_passed"]) for r in rs]
        hf = [f(r["hidden_failed"]) for r in rs]
        rec["visible_pass_rate"] = sum(vp) / max(1, sum(vp) + sum(vf))
        rec["hidden_pass_rate"] = sum(hp) / max(1, sum(hp) + sum(hf))
        for k in ("total_tokens", "cost_usd", "wall_sec", "tool_calls", "tool_errors", "review_rejects"):
            vals = [f(r[k]) for r in rs]
            rec[k + "_mean"] = statistics.mean(vals)
            rec[k + "_sd"] = statistics.pstdev(vals) if len(vals) > 1 else 0.0
        out.append(rec)
    return out


def markdown(recs):
    head = ["target", "setting", "n", "visible pass", "hidden pass", "tokens (mean±sd)", "cost $ (mean)",
            "time s (mean)", "tool errs", "rejects"]
    lines = ["| " + " | ".join(head) + " |", "|" + "---|" * len(head)]
    for r in recs:
        lines.append("| " + " | ".join([
            r["target"], r["setting"], str(r["n"]),
            f"{r['visible_pass_rate']:.0%}", f"{r['hidden_pass_rate']:.0%}",
            f"{r['total_tokens_mean']:.0f}±{r['total_tokens_sd']:.0f}",
            f"{r['cost_usd_mean']:.3f}", f"{r['wall_sec_mean']:.0f}",
            f"{r['tool_errors_mean']:.1f}", f"{r['review_rejects_mean']:.1f}",
        ]) + " |")
    return "\n".join(lines)


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("--results", default=str(ROOT / "experiments" / "results" / "results.csv"))
    ap.add_argument("--csv", default=None)
    args = ap.parse_args(argv)
    rows = load(Path(args.results))
    recs = summarize(rows)
    print(markdown(recs))
    if args.csv:
        with open(args.csv, "w", newline="") as fh:
            w = csv.DictWriter(fh, fieldnames=list(recs[0].keys()) if recs else ["target"])
            w.writeheader()
            w.writerows(recs)
    return recs


if __name__ == "__main__":
    main()
