#!/usr/bin/env python3
"""
Batch experiment runner for the WAA ablation study.

    python experiments/run_experiments.py \
        --targets chat_room tetris \
        --settings baseline team \
        --repeats 3

For every (target, setting, repeat) it:
  1. copies targets/<target> (clean: no node_modules, no .waa outputs) to
     experiments/runs/<target>__<setting>__r<k>/
  2. patches .waa/config.json with the feature flags of <setting>
  3. runs `waa` there (subprocess, with a timeout)
  4. runs the visible tests and, if experiments/hidden_tests/<target>/ exists,
     the hidden tests the agent never saw
  5. reads .waa/usage.json / events.jsonl / team_summary.json
  6. appends one row to experiments/results/results.csv (+ .jsonl)

Re-running skips rows that already exist (resume after a crash).
Use --dry-run to exercise the pipeline with the mock LLM (no API calls, no tests).

Settings → config patches live in SETTINGS below; add new features there.
"""
import argparse
import csv
import json
import os
import shutil
import signal
import socket
import subprocess
import sys
import time
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List, Optional

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from waa.events import EventLog  # noqa: E402

# --------------------------------------------------------------------- settings

# Each setting is a dict of config patches. Keys with dots are nested
# ("team.enabled" -> config["team"]["enabled"]). Everything not mentioned is
# left as in the target's own config.json.
SETTINGS: Dict[str, Dict[str, Any]] = {
    "baseline": {"team.enabled": False, "vision.enabled": False, "memory.enabled": False},
    "team":     {"team.enabled": True,  "vision.enabled": False, "memory.enabled": False},
    "vision":   {"team.enabled": False, "vision.enabled": True,  "memory.enabled": False},
    "memory":   {"team.enabled": False, "vision.enabled": False, "memory.enabled": True},
    "all":      {"team.enabled": True,  "vision.enabled": True,  "memory.enabled": True},
}

# Files/dirs never copied from a target (outputs of previous runs, deps).
EXCLUDE = {"node_modules", "agent.log", "server.log", "todo.json", "usage.json",
           "events.jsonl", "team_summary.json", "logs", "test-results", "playwright-report"}

CSV_FIELDS = [
    "run_name", "target", "setting", "repeat", "started", "status",
    "wall_sec", "agent_exit_code",
    "visible_passed", "visible_failed", "hidden_passed", "hidden_failed",
    "llm_calls", "input_tokens", "output_tokens", "total_tokens", "cost_usd",
    "tool_calls", "tool_errors", "plan_tasks", "review_rejects", "review_rounds",
    "notes",
]


# ------------------------------------------------------------------ utilities

def set_nested(cfg: Dict[str, Any], dotted: str, value: Any):
    parts = dotted.split(".")
    cur = cfg
    for p in parts[:-1]:
        cur = cur.setdefault(p, {})
        if not isinstance(cur, dict):
            raise ValueError(f"config key {dotted}: {p} is not an object")
    cur[parts[-1]] = value


def copy_target(src: Path, dst: Path):
    if dst.exists():
        shutil.rmtree(dst)

    def ignore(dir_, names):
        return [n for n in names if n in EXCLUDE]

    shutil.copytree(src, dst, ignore=ignore)


def port_open(port: int, host: str = "127.0.0.1") -> bool:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.settimeout(0.3)
        return s.connect_ex((host, port)) == 0


def kill_servers():
    subprocess.run(["pkill", "-f", "node.*index.js"], capture_output=True)
    time.sleep(0.5)


# ---------------------------------------------------------------- test running

def ensure_test_deps(run_dir: Path, need_ui: bool, need_api: bool, log) -> None:
    pkg = run_dir / "package.json"
    if not pkg.exists():
        return
    try:
        p = json.loads(pkg.read_text())
    except Exception:
        return
    dev = p.get("devDependencies", {})
    missing = []
    if need_ui and "@playwright/test" not in dev:
        missing.append("@playwright/test@^1.40.0")
    if need_api and ("jest" not in dev or "supertest" not in dev):
        missing += ["jest@^29.7.0", "supertest@^6.3.3"]
    if missing:
        log(f"installing missing test deps: {missing}")
        subprocess.run(["npm", "install", "--save-dev", *missing], cwd=run_dir,
                       capture_output=True, text=True, timeout=300)
    if need_ui:
        subprocess.run(["npx", "playwright", "install", "chromium"], cwd=run_dir,
                       capture_output=True, text=True, timeout=600)


def run_playwright(run_dir: Path, test_files: List[str], timeout: int, log, tag: str = "") -> Dict[str, int]:
    out = {"passed": 0, "failed": 0}
    if not test_files:
        return out
    report = run_dir / ".waa" / f"pw_report{tag}.json"
    env = dict(os.environ, PLAYWRIGHT_JSON_OUTPUT_NAME=str(report))
    cmd = ["npx", "playwright", "test", *test_files, "--reporter=json"]
    try:
        subprocess.run(cmd, cwd=run_dir, capture_output=True, text=True, timeout=timeout, env=env)
        data = json.loads(report.read_text()) if report.exists() else {}
        stats = data.get("stats", {})
        out["passed"] = int(stats.get("expected", 0))
        out["failed"] = int(stats.get("unexpected", 0)) + int(stats.get("flaky", 0))
    except Exception as e:
        log(f"playwright failed: {e}")
        out["failed"] = -1
    return out


def run_jest(run_dir: Path, test_files: List[str], timeout: int, log, tag: str = "") -> Dict[str, int]:
    out = {"passed": 0, "failed": 0}
    if not test_files:
        return out
    report = run_dir / ".waa" / f"jest_report{tag}.json"
    cmd = ["npx", "jest", *test_files, "--json", f"--outputFile={report}", "--forceExit"]
    try:
        subprocess.run(cmd, cwd=run_dir, capture_output=True, text=True, timeout=timeout)
        data = json.loads(report.read_text()) if report.exists() else {}
        out["passed"] = int(data.get("numPassedTests", 0))
        out["failed"] = int(data.get("numFailedTests", 0))
    except Exception as e:
        log(f"jest failed: {e}")
        out["failed"] = -1
    return out


def start_server(run_dir: Path, log) -> Optional[subprocess.Popen]:
    if not (run_dir / "index.js").exists():
        log("no index.js; cannot start server")
        return None
    kill_servers()
    proc = subprocess.Popen(["node", "index.js"], cwd=run_dir,
                            stdout=open(run_dir / ".waa" / "eval_server.log", "a"),
                            stderr=subprocess.STDOUT, preexec_fn=os.setsid)
    for _ in range(40):
        if port_open(3000):
            return proc
        if proc.poll() is not None:
            log("server exited early")
            return None
        time.sleep(0.5)
    log("server did not open port 3000")
    return proc


def stop_server(proc: Optional[subprocess.Popen]):
    if proc and proc.poll() is None:
        try:
            os.killpg(os.getpgid(proc.pid), signal.SIGTERM)
        except Exception:
            pass
    kill_servers()


def evaluate(run_dir: Path, hidden_src: Optional[Path], timeout: int, log) -> Dict[str, int]:
    """Run visible tests (under tests/) and hidden tests (copied to tests/hidden/)."""
    res = {"visible_passed": 0, "visible_failed": 0, "hidden_passed": 0, "hidden_failed": 0}
    tests_dir = run_dir / "tests"
    if hidden_src and hidden_src.exists():
        dst = tests_dir / "hidden"
        if dst.exists():
            shutil.rmtree(dst)
        shutil.copytree(hidden_src, dst)

    def collect(base: Path, exclude_hidden: bool):
        ui, api = [], []
        if not base.exists():
            return ui, api
        for p in base.rglob("*.test.js"):
            rel = p.relative_to(run_dir)
            if exclude_hidden and "hidden" in rel.parts:
                continue
            (ui if p.name == "ui.test.js" else api).append(str(rel))
        return ui, api

    vis_ui, vis_api = collect(tests_dir, exclude_hidden=True)
    hid_ui, hid_api = collect(tests_dir / "hidden", exclude_hidden=False) if hidden_src else ([], [])

    ensure_test_deps(run_dir, bool(vis_ui or hid_ui), bool(vis_api or hid_api), log)

    server = start_server(run_dir, log) if (vis_ui or hid_ui) else None
    try:
        v_ui = run_playwright(run_dir, vis_ui, timeout, log, "_visible")
        h_ui = run_playwright(run_dir, hid_ui, timeout, log, "_hidden")
    finally:
        stop_server(server)
    v_api = run_jest(run_dir, vis_api, timeout, log, "_visible")
    h_api = run_jest(run_dir, hid_api, timeout, log, "_hidden")

    res["visible_passed"] = v_ui["passed"] + v_api["passed"]
    res["visible_failed"] = v_ui["failed"] + v_api["failed"]
    res["hidden_passed"] = h_ui["passed"] + h_api["passed"]
    res["hidden_failed"] = h_ui["failed"] + h_api["failed"]
    return res


# ------------------------------------------------------------- metrics reading

def collect_metrics(run_dir: Path) -> Dict[str, Any]:
    m: Dict[str, Any] = {"llm_calls": 0, "input_tokens": 0, "output_tokens": 0, "total_tokens": 0,
                         "cost_usd": 0.0, "tool_calls": 0, "tool_errors": 0, "plan_tasks": 0,
                         "review_rejects": 0, "review_rounds": 0}
    usage_path = run_dir / ".waa" / "usage.json"
    if usage_path.exists():
        try:
            for u in json.loads(usage_path.read_text()):
                for k in ("input_tokens", "output_tokens", "total_tokens", "cost_usd"):
                    m[k] += u.get(k, 0)
                m["llm_calls"] += u.get("calls", 0)
        except Exception:
            pass
    m["cost_usd"] = round(m["cost_usd"], 6)

    for ev in EventLog.read(run_dir):
        t = ev["type"]
        if t == "tool_call":
            m["tool_calls"] += 1
        elif t == "tool_result" and not ev["data"].get("ok"):
            m["tool_errors"] += 1
        elif t == "plan_created":
            m["plan_tasks"] = len(ev["data"].get("tasks", []))
        elif t == "review_verdict":
            m["review_rounds"] += 1
            if ev["data"].get("verdict") == "REJECT":
                m["review_rejects"] += 1
    return m


# ------------------------------------------------------------------- one run

def run_one(target: str, setting: str, repeat: int, args, log) -> Dict[str, Any]:
    run_name = f"{target}__{setting}__r{repeat}"
    src = ROOT / "targets" / target
    run_dir = Path(args.runs_dir) / run_name
    hidden = Path(args.hidden_dir) / target

    row: Dict[str, Any] = {k: "" for k in CSV_FIELDS}
    row.update(run_name=run_name, target=target, setting=setting, repeat=repeat,
               started=datetime.now().isoformat(timespec="seconds"), status="running", notes="")

    log(f"=== {run_name} ===")
    copy_target(src, run_dir)

    cfg_path = run_dir / ".waa" / "config.json"
    cfg = json.loads(cfg_path.read_text())
    for k, v in SETTINGS[setting].items():
        set_nested(cfg, k, v)
    if args.dry_run:
        cfg["llm_type"] = "mock"
        cfg["max_turns"] = 3
        cfg.setdefault("team", {}).update({"coder_max_turns": 3, "reviewer_max_turns": 3})
    if args.model:
        cfg["model"] = args.model
    cfg_path.write_text(json.dumps(cfg, indent=2))

    kill_servers()
    t0 = time.time()
    try:
        proc = subprocess.run(
            [sys.executable, "-m", "waa.cli", "--working-dir", str(run_dir)],
            cwd=ROOT, capture_output=True, text=True, timeout=args.agent_timeout)
        row["agent_exit_code"] = proc.returncode
        (run_dir / ".waa" / "runner_stdout.log").write_text(proc.stdout + "\n--- stderr ---\n" + proc.stderr)
        if proc.returncode != 0:
            row["notes"] += f"agent exit {proc.returncode}; "
    except subprocess.TimeoutExpired:
        row["agent_exit_code"] = -1
        row["notes"] += "agent timeout; "
    row["wall_sec"] = round(time.time() - t0, 1)
    kill_servers()

    row.update(collect_metrics(run_dir))

    if not args.dry_run and not args.no_tests:
        try:
            row.update(evaluate(run_dir, hidden if hidden.exists() else None, args.test_timeout, log))
        except Exception as e:
            row["notes"] += f"eval error: {e}; "
    row["status"] = "done"
    log(f"  -> visible {row['visible_passed']}/{row['visible_failed']} hidden {row['hidden_passed']}/{row['hidden_failed']} "
        f"tokens={row['total_tokens']} cost~${row['cost_usd']} rejects={row['review_rejects']} {row['wall_sec']}s")
    return row


# ---------------------------------------------------------------------- main

def existing_runs(csv_path: Path) -> set:
    if not csv_path.exists():
        return set()
    with open(csv_path, newline="") as f:
        return {r["run_name"] for r in csv.DictReader(f) if r.get("status") == "done"}


def append_row(results_dir: Path, row: Dict[str, Any]):
    results_dir.mkdir(parents=True, exist_ok=True)
    csv_path = results_dir / "results.csv"
    new = not csv_path.exists()
    with open(csv_path, "a", newline="") as f:
        w = csv.DictWriter(f, fieldnames=CSV_FIELDS)
        if new:
            w.writeheader()
        w.writerow({k: row.get(k, "") for k in CSV_FIELDS})
    with open(results_dir / "results.jsonl", "a") as f:
        f.write(json.dumps(row) + "\n")


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--targets", nargs="+", required=True, help="folder names under targets/")
    ap.add_argument("--settings", nargs="+", default=["baseline", "team"], choices=list(SETTINGS))
    ap.add_argument("--repeats", type=int, default=3)
    ap.add_argument("--runs-dir", default=str(ROOT / "experiments" / "runs"))
    ap.add_argument("--results-dir", default=str(ROOT / "experiments" / "results"))
    ap.add_argument("--hidden-dir", default=str(ROOT / "experiments" / "hidden_tests"))
    ap.add_argument("--agent-timeout", type=int, default=3600, help="seconds per agent run")
    ap.add_argument("--test-timeout", type=int, default=300)
    ap.add_argument("--model", default=None, help="override model id")
    ap.add_argument("--dry-run", action="store_true", help="mock LLM, no tests; checks the pipeline")
    ap.add_argument("--no-tests", action="store_true", help="skip test evaluation")
    ap.add_argument("--force", action="store_true", help="redo runs already in results.csv")
    args = ap.parse_args(argv)

    results_dir = Path(args.results_dir)
    done = set() if args.force else existing_runs(results_dir / "results.csv")
    log_path = results_dir / "runner.log"
    results_dir.mkdir(parents=True, exist_ok=True)

    def log(msg: str):
        line = f"[{datetime.now().strftime('%H:%M:%S')}] {msg}"
        print(line, flush=True)
        with open(log_path, "a") as f:
            f.write(line + "\n")

    if not args.dry_run and not os.getenv("AWS_BEARER_TOKEN_BEDROCK"):
        log("WARNING: AWS_BEARER_TOKEN_BEDROCK is not set; real runs will fail")

    plan = [(t, s, r) for t in args.targets for s in args.settings for r in range(1, args.repeats + 1)]
    log(f"{len(plan)} runs planned, {sum(f'{t}__{s}__r{r}' in done for t, s, r in plan)} already done")
    for target, setting, repeat in plan:
        name = f"{target}__{setting}__r{repeat}"
        if name in done:
            continue
        if not (ROOT / "targets" / target).exists():
            log(f"skip {name}: targets/{target} not found")
            continue
        row = run_one(target, setting, repeat, args, log)
        append_row(results_dir, row)
    log("all done")


if __name__ == "__main__":
    main()
