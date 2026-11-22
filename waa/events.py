"""
Structured event stream — the shared interface between WAA features.

Every agent run appends one JSON object per line to `.waa/events.jsonl`.
Other features never parse agent.log; they consume this file (or subscribe live).

    from waa.events import EventLog
    log = EventLog(working_dir)            # opens/creates .waa/events.jsonl
    log.emit("tool_call", role="coder", task_id=2, round=1,
             data={"tool": "fs.write", "arguments": {...}})
    log.subscribe(callback)                # live: callback(event_dict) on every emit

Event shape (see docs/EVENTS.md for the full list of types):

    {
      "seq": 17,                      # 1-based, unique within the file
      "ts": "2026-11-22T15:30:01.123",# ISO local time
      "run_id": "20261122-153000",    # same for every event of one `waa` invocation
      "role": "coder",                # "agent" (plain WAA) | "planner" | "coder" | "reviewer" | "orchestrator"
      "task_id": 2,                   # null in plain mode / planner
      "round": 1,                     # review round, null if n/a
      "type": "tool_call",
      "data": { ... type-specific ... }
    }
"""
import json
import threading
from datetime import datetime
from pathlib import Path
from typing import Any, Callable, Dict, List, Optional

EVENT_TYPES = [
    # lifecycle
    "run_start", "run_end",            # one agent run (any role)
    "team_start", "team_end",          # whole orchestrated run
    "plan_created",                    # planner output
    "task_start", "task_end",          # per task (orchestrator)
    # agent loop
    "llm_query", "llm_response",
    "tool_call", "tool_result",
    "test_result",                     # derived from supertest.run / playwright.run results
    "parse_error",                     # malformed tool call from the LLM
    # team
    "review_verdict",                  # reviewer decision
    # extension points for other features
    "screenshot",                      # vision: {"path": ..., "url": ...}
    "visual_check",                    # vision: model's judgement of a screenshot
    "memory_retrieved",                # memory: lessons injected into a prompt
    "memory_stored",                   # memory: lessons written after a run
    "usage",                           # tokens/cost snapshot
    "note",                            # free-form, for anything else
]


class EventLog:
    _instances: Dict[str, "EventLog"] = {}
    _lock = threading.Lock()

    def __new__(cls, working_dir: Path, run_id: Optional[str] = None):
        # One EventLog per working directory, so every role in a team run shares
        # the same file, seq counter and subscribers.
        key = str(Path(working_dir).resolve())
        with cls._lock:
            inst = cls._instances.get(key)
            if inst is None:
                inst = super().__new__(cls)
                inst._init(Path(working_dir), run_id)
                cls._instances[key] = inst
            elif run_id:
                inst.run_id = run_id
            return inst

    def _init(self, working_dir: Path, run_id: Optional[str]):
        self.working_dir = working_dir
        self.path = working_dir / ".waa" / "events.jsonl"
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.run_id = run_id or datetime.now().strftime("%Y%m%d-%H%M%S")
        self.seq = self._count_existing()
        self._subscribers: List[Callable[[Dict[str, Any]], None]] = []
        self._file_lock = threading.Lock()

    def _count_existing(self) -> int:
        if not self.path.exists():
            return 0
        with open(self.path, "rb") as f:
            return sum(1 for _ in f)

    # ------------------------------------------------------------------ write

    def emit(self, type: str, *, role: str = "agent", task_id: Optional[int] = None,
             round: Optional[int] = None, data: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
        if type not in EVENT_TYPES:
            raise ValueError(f"Unknown event type '{type}'. Add it to waa.events.EVENT_TYPES first.")
        with self._file_lock:
            self.seq += 1
            event = {
                "seq": self.seq,
                "ts": datetime.now().isoformat(timespec="milliseconds"),
                "run_id": self.run_id,
                "role": role,
                "task_id": task_id,
                "round": round,
                "type": type,
                "data": _jsonable(data or {}),
            }
            with open(self.path, "a", encoding="utf-8") as f:
                f.write(json.dumps(event, ensure_ascii=False) + "\n")
        for cb in list(self._subscribers):
            try:
                cb(event)
            except Exception:
                pass  # a broken subscriber must never break the agent
        return event

    def subscribe(self, callback: Callable[[Dict[str, Any]], None]):
        self._subscribers.append(callback)

    def unsubscribe(self, callback: Callable[[Dict[str, Any]], None]):
        if callback in self._subscribers:
            self._subscribers.remove(callback)

    # ------------------------------------------------------------------- read

    @staticmethod
    def read(working_dir: Path, run_id: Optional[str] = None,
             types: Optional[List[str]] = None) -> List[Dict[str, Any]]:
        """Load events from a folder (optionally one run / some types). For replay and analysis."""
        path = Path(working_dir) / ".waa" / "events.jsonl"
        if not path.exists():
            return []
        out = []
        with open(path, encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                try:
                    ev = json.loads(line)
                except json.JSONDecodeError:
                    continue
                if run_id and ev.get("run_id") != run_id:
                    continue
                if types and ev.get("type") not in types:
                    continue
                out.append(ev)
        return out

    @classmethod
    def reset_instances(cls):
        """For tests."""
        with cls._lock:
            cls._instances.clear()


def _jsonable(obj: Any, max_str: int = 20000) -> Any:
    """Make sure data is JSON-serialisable and not absurdly large."""
    if isinstance(obj, dict):
        return {str(k): _jsonable(v, max_str) for k, v in obj.items()}
    if isinstance(obj, (list, tuple)):
        return [_jsonable(v, max_str) for v in obj]
    if isinstance(obj, str):
        return obj if len(obj) <= max_str else obj[:max_str] + f"...<truncated {len(obj) - max_str} chars>"
    if isinstance(obj, (int, float, bool)) or obj is None:
        return obj
    return str(obj)


# ----------------------------------------------------------------------------- CLI
# python -m waa.events targets/chat_room            # readable timeline
# python -m waa.events targets/chat_room --follow   # live tail (for dashboard dev)

def _format(ev: Dict[str, Any]) -> str:
    d = ev.get("data", {})
    who = ev["role"] + (f" t{ev['task_id']}" if ev.get("task_id") else "") + (f" r{ev['round']}" if ev.get("round") else "")
    t = ev["type"]
    if t == "tool_call":
        detail = d.get("tool", "") + " " + json.dumps(d.get("arguments", {}))[:80]
    elif t == "tool_result":
        detail = f"{d.get('tool')} {'ok' if d.get('ok') else 'FAIL: ' + str(d.get('error'))[:80]}"
    elif t == "llm_response":
        detail = ("tool_call" if d.get("is_tool_call") else "terminate" if d.get("is_termination") else "message") \
                 + f" ({d.get('usage', {}).get('output_tokens', '?')} out tok)"
    elif t == "test_result":
        detail = f"{d.get('test_file')} {'PASS' if d.get('passed') else 'FAIL'} {d.get('summary')}"
    elif t == "review_verdict":
        detail = f"{d.get('verdict')} - {d.get('summary', '')[:80]} ({len(d.get('issues', []))} issues)"
    elif t == "plan_created":
        detail = "; ".join(f"#{x.get('id')} {x.get('title')}" for x in d.get("tasks", []))
    elif t in ("run_end", "team_end"):
        u = d.get("usage") or d.get("usage_total") or {}
        detail = f"tokens={u.get('total_tokens')} cost~${u.get('cost_usd')}"
    else:
        detail = json.dumps(d)[:100]
    return f"{ev['ts'][11:23]} #{ev['seq']:<4} {who:<16} {t:<15} {detail}"


if __name__ == "__main__":
    import sys, time
    if len(sys.argv) < 2:
        print(__doc__); sys.exit(1)
    wd = Path(sys.argv[1])
    follow = "--follow" in sys.argv
    seen = 0
    while True:
        evs = EventLog.read(wd)
        for ev in evs[seen:]:
            print(_format(ev))
        seen = len(evs)
        if not follow:
            break
        time.sleep(1)
