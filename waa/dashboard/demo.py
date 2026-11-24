"""
Synthetic team run for dashboard development and demos: no API key, no model.

    python -m waa.dashboard --demo                 # about 90 seconds
    python -m waa.dashboard --demo --demo-speed 5  # faster

Everything goes through the real EventLog, so the stream has the shape of a real
run (docs/EVENTS.md): a planner, three tasks, two review rejections, failing and
passing tests. The content, token counts and prices are invented.
"""
import json
import time
from pathlib import Path
from typing import Any, Dict, List, Optional

from waa.events import EventLog

PRICE_IN, PRICE_OUT = 3.0, 15.0      # $ per million tokens, invented for the demo
USAGE_KEYS = ("calls", "input_tokens", "output_tokens", "total_tokens", "latency_ms", "cost_usd")

CODER_TOOLS = ["fs.write", "fs.read", "fs.edit", "fs.ls", "npm.install", "npm.start",
               "supertest.run", "playwright.run"]
REVIEWER_TOOLS = ["fs.read", "fs.ls", "npm.start", "supertest.run", "playwright.run"]

PLAN = [
    {"id": 1, "title": "REST API for boards and cards",
     "description": "Express server with in-memory boards, columns and cards.",
     "acceptance": ["tests/api.test.js passes", "Cards keep their order after a move"]},
    {"id": 2, "title": "Board page with drag and drop",
     "description": "Static page that renders columns and moves cards between them.",
     "acceptance": ["tests/ui.test.js passes"]},
    {"id": 3, "title": "Card editing and empty states",
     "description": "Rename and delete cards; show a hint in an empty column.",
     "acceptance": ["API and UI tests pass", "Empty columns show a hint"]},
]


# ------------------------------------------------------------- script helpers

def call(tool: str, arguments: Dict[str, Any], result: Optional[Dict[str, Any]] = None,
         error: Optional[str] = None, secs: float = 0.4, out_tokens: int = 90) -> Dict[str, Any]:
    return {"tool": tool, "arguments": arguments, "result": result or {}, "error": error,
            "secs": secs, "out_tokens": out_tokens}


def write(path: str, size: int) -> Dict[str, Any]:
    return call("fs.write", {"path": path, "content": f"<{size} characters of code>"},
                {"path": path, "bytes": size}, out_tokens=size // 4)


def run_tests(tool: str, test_file: str, passed: int, failed: int) -> Dict[str, Any]:
    total_key = "tests" if tool == "supertest.run" else "total"
    summary = {total_key: passed + failed, "passed": passed, "failed": failed}
    step = call(tool, {"test_file": test_file},
                {"passed": failed == 0, "summary": summary, "test_file": test_file, "stdout_len": 1840},
                secs=2.5)
    step["test"] = {"tool": tool, "test_file": test_file, "passed": failed == 0, "summary": summary}
    return step


API, UI = ("supertest.run", "tests/api.test.js"), ("playwright.run", "tests/ui.test.js")


class _Sim:
    def __init__(self, working_dir: Path, speed: float):
        self.log = EventLog(working_dir)
        self.speed = speed
        self.by_role: Dict[str, Dict[str, float]] = {}

    def wait(self, seconds: float):
        if self.speed > 0:
            time.sleep(seconds / self.speed)

    def emit(self, type: str, role: str = "orchestrator", task_id=None, round=None, **data):
        self.log.emit(type, role=role, task_id=task_id, round=round, data=data)

    def agent_run(self, role: str, steps: List[Dict[str, Any]], tools: List[str],
                  task_id=None, round_no=None, final_text: str = "<terminate>"):
        """One role's run: run_start, one model turn per step, a closing turn, run_end."""
        tag = {"role": role, "task_id": task_id, "round": round_no}
        usage = dict.fromkeys(USAGE_KEYS, 0)
        self.emit("run_start", max_turns=40, tools=tools, **tag)
        for turn, step in enumerate(steps + [None], start=1):
            self.emit("llm_query", turn=turn, message_count=2 * turn, **tag)
            latency = 1.1 + 0.35 * (turn % 3)
            self.wait(latency)
            in_tok = 3200 + 1400 * turn
            if step is None:
                text, out_tok = final_text, max(12, len(final_text) // 4)
            else:
                text = "<tool_call>" + json.dumps({"tool": step["tool"], "arguments": step["arguments"]}) + "</tool_call>"
                out_tok = step["out_tokens"]
            cost = round(in_tok / 1e6 * PRICE_IN + out_tok / 1e6 * PRICE_OUT, 6)
            self.emit("llm_response", turn=turn, text=text, is_tool_call=step is not None,
                      is_termination=step is None and final_text == "<terminate>",
                      usage={"input_tokens": in_tok, "output_tokens": out_tok,
                             "latency_ms": round(latency * 1000, 1), "cost_usd": cost}, **tag)
            for key, value in (("calls", 1), ("input_tokens", in_tok), ("output_tokens", out_tok),
                               ("total_tokens", in_tok + out_tok), ("latency_ms", latency * 1000),
                               ("cost_usd", cost)):
                usage[key] = round(usage[key] + value, 6)
            if step is None:
                break
            self.emit("tool_call", tool=step["tool"], arguments=step["arguments"], **tag)
            self.wait(step["secs"])
            self.emit("tool_result", tool=step["tool"], ok=step["error"] is None,
                      error=step["error"], result=step["result"], **tag)
            if "test" in step:
                self.emit("test_result", **step["test"], **tag)
        turns = len(steps) + 1
        self.emit("run_end", turns=turns, terminated=True,
                  usage={"model": "demo", "cost_is_estimate": True, **usage,
                         "role": role, "log": role, "turns": turns, "terminated": True}, **tag)
        totals = self.by_role.setdefault(role, dict.fromkeys(USAGE_KEYS, 0))
        for key in USAGE_KEYS:
            totals[key] = round(totals[key] + usage[key], 6)

    def review(self, task_id: int, round_no: int, steps: List[Dict[str, Any]], verdict: str,
               summary: str, issues: Optional[List[Dict[str, str]]] = None):
        body = {"verdict": verdict, "summary": summary, "issues": issues or []}
        self.agent_run("reviewer", steps, REVIEWER_TOOLS, task_id, round_no, final_text=json.dumps(body))
        self.emit("review_verdict", role="reviewer", task_id=task_id, round=round_no, **body)

    def code(self, task_id: int, round_no: int, steps: List[Dict[str, Any]]):
        self.agent_run("coder", steps, CODER_TOOLS, task_id, round_no)


# ----------------------------------------------------------------- the script

def play(working_dir: Path, speed: float = 1.0) -> None:
    """Write one synthetic team run into `working_dir`. `speed` 0 means no pauses."""
    sim = _Sim(Path(working_dir), speed)
    started = time.time()
    sim.emit("team_start", config={"enabled": True, "max_review_rounds": 3, "demo": True})
    sim.emit("note", text="Synthetic demo run from waa.dashboard.demo. Not real agent output.")

    sim.agent_run("planner", [], [], final_text=json.dumps({"tasks": PLAN}))
    sim.emit("plan_created", role="planner", tasks=PLAN)

    def task(n: int, rounds):
        sim.emit("task_start", task_id=n, title=PLAN[n - 1]["title"], acceptance=PLAN[n - 1]["acceptance"])
        for round_no, do_round in enumerate(rounds, start=1):
            do_round(round_no)
        sim.emit("task_end", task_id=n, final="approved", rounds=len(rounds))

    # Task 1: rejected once for a card-ordering bug, then approved.
    def t1_r1(r):
        sim.code(1, r, [write("package.json", 420), write("server.js", 5200),
                        call("npm.install", {}, {"installed": True, "stdout_len": 2210}, secs=3.0),
                        call("npm.start", {}, {"port": 3000, "pid": 4242}, secs=1.0),
                        run_tests(*API, passed=3, failed=2)])
        sim.review(1, r, [call("fs.read", {"path": "server.js"}, {"path": "server.js", "content_len": 5200}),
                          run_tests(*API, passed=3, failed=2)],
                   "REJECT", "Moving a card does not keep the order of the target column.",
                   [{"severity": "major", "where": "server.js: POST /api/cards/:id/move",
                     "what": "The card is appended instead of inserted at `position`.",
                     "how_to_fix": "Splice the card into the target column at the requested index."},
                    {"severity": "minor", "where": "server.js: DELETE /api/cards/:id",
                     "what": "Deleting a missing card returns 200.",
                     "how_to_fix": "Return 404 when the id is unknown."}])

    def t1_r2(r):
        sim.code(1, r, [call("fs.edit", {"path": "server.js", "old_string": "column.cards.push(card)",
                                         "new_string": "column.cards.splice(position, 0, card)"},
                             {"path": "server.js", "replacements": 1}),
                        run_tests(*API, passed=5, failed=0)])
        sim.review(1, r, [run_tests(*API, passed=5, failed=0)], "APPROVE", "All API tests pass; ordering is correct.")

    # Task 2: approved first time, with one failed tool call along the way.
    def t2_r1(r):
        sim.code(2, r, [write("public/index.html", 1800), write("public/app.js", 6400),
                        call("fs.edit", {"path": "public/app.js", "old_string": "ondrop=", "new_string": "ondrop ="},
                             error="old_string not found in public/app.js"),
                        call("fs.read", {"path": "public/app.js"}, {"path": "public/app.js", "content_len": 6400}),
                        call("fs.edit", {"path": "public/app.js", "old_string": "el.ondrop =", "new_string": "el.addEventListener('drop',"},
                             {"path": "public/app.js", "replacements": 1}),
                        run_tests(*UI, passed=3, failed=0)])
        sim.review(2, r, [run_tests(*UI, passed=3, failed=0),
                          call("fs.read", {"path": "public/app.js"}, {"path": "public/app.js", "content_len": 6410})],
                   "APPROVE", "Drag and drop works and the UI tests pass.")

    # Task 3: rejected once for a missing empty-state hint.
    def t3_r1(r):
        sim.code(3, r, [call("fs.edit", {"path": "server.js", "old_string": "// routes", "new_string": "// routes + PATCH"},
                             {"path": "server.js", "replacements": 1}, out_tokens=700),
                        write("public/app.js", 7900),
                        run_tests(*API, passed=5, failed=0), run_tests(*UI, passed=2, failed=1)])
        sim.review(3, r, [run_tests(*UI, passed=2, failed=1)],
                   "REJECT", "An empty column shows nothing instead of a hint.",
                   [{"severity": "major", "where": "public/app.js: renderColumn",
                     "what": "No placeholder is rendered when a column has zero cards.",
                     "how_to_fix": "Render a `.empty-hint` element when `cards.length === 0`."}])

    def t3_r2(r):
        sim.code(3, r, [call("fs.edit", {"path": "public/app.js", "old_string": "cards.forEach(", "new_string": "if (!cards.length) hint(col); cards.forEach("},
                             {"path": "public/app.js", "replacements": 1}),
                        run_tests(*UI, passed=3, failed=0)])
        sim.review(3, r, [run_tests(*API, passed=5, failed=0), run_tests(*UI, passed=3, failed=0)],
                   "APPROVE", "Editing works and empty columns show a hint.")

    task(1, [t1_r1, t1_r2])
    task(2, [t2_r1])
    task(3, [t3_r1, t3_r2])

    keys = ("calls", "input_tokens", "output_tokens", "total_tokens", "cost_usd")
    by_role = {role: {k: usage[k] for k in keys} for role, usage in sim.by_role.items()}
    total = {k: round(sum(u[k] for u in by_role.values()), 6) for k in keys}
    sim.emit("team_end", elapsed_sec=round(time.time() - started, 1), usage_by_role=by_role,
             usage_total={"model": "demo", "cost_is_estimate": True, **total})
