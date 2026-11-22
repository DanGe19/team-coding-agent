"""
TeamOrchestrator: planner -> (coder -> reviewer)* for each task.

Enabled from .waa/config.json:

    "team": {
        "enabled": true,
        "max_review_rounds": 3,      # coder attempts per task before forced acceptance
        "planner_max_turns": 3,
        "coder_max_turns": 40,
        "reviewer_max_turns": 12
    }

Each role is a normal `Agent` with its own system prompt, tool set, history and
log file (.waa/logs/<role>_t<task>_r<round>.log). The three roles never see each
other's conversation; they communicate only through the files on disk and the
short structured messages built in waa/roles.py.

A run summary is written to .waa/team_summary.json and the overall log to
.waa/agent.log (so the "one run per folder" rule from HW3 still holds).
"""
import json
import re
import time
from pathlib import Path
from typing import Any, Dict, List, Optional

from .agent import Agent
from .history import LLMResponse
from .llm import LanguageModel
from .logger import Logger
from .events import EventLog
from . import roles

PLAN_RE = re.compile(r"<plan>\s*(.*?)\s*</plan>", re.DOTALL)
VERDICT_RE = re.compile(r"<verdict>\s*(.*?)\s*</verdict>", re.DOTALL)


class TeamOrchestrator:
    def __init__(self, working_dir: Path, debug: bool = False, llm: Optional[LanguageModel] = None):
        self.working_dir = Path(working_dir)
        self.debug = debug
        self.llm = llm  # shared across roles (one API client; also lets tests inject a mock)

        # Filled in by _load_config()
        self.config: Dict[str, Any] = {}
        self.team_cfg: Dict[str, Any] = {}
        self.instruction: str = ""
        self.logger: Optional[Logger] = None

        self.plan: List[Dict[str, Any]] = []
        self.summary: Dict[str, Any] = {"tasks": []}
        self._last_reviewer_usage: Dict[str, Any] = {}

    # ----------------------------------------------------------------- setup

    def _load_config(self):
        cfg_path = self.working_dir / ".waa" / "config.json"
        if not cfg_path.exists():
            raise FileNotFoundError(f"Config file not found: {cfg_path}")
        self.config = json.loads(cfg_path.read_text(encoding="utf-8"))
        self.team_cfg = self.config.get("team", {}) or {}

        ins_path = self.working_dir / ".waa" / "instruction.md"
        if not ins_path.exists():
            raise FileNotFoundError(f"Instruction file not found: {ins_path}")
        self.instruction = ins_path.read_text(encoding="utf-8")

        log_path = self.working_dir / ".waa" / "agent.log"
        if log_path.exists():
            raise RuntimeError(f"Log file already exists: {log_path}. Remove it to start a new run.")
        self.logger = Logger(log_path, self.debug)
        self.logger.log("Team mode: planner -> coder -> reviewer")
        self.events = EventLog(self.working_dir)

        if self.llm is None:
            # Borrow Agent's factory so bedrock/mock selection stays in one place.
            probe = Agent(self.working_dir)
            probe.config = self.config
            self.llm = probe.initialize_llm()

    def _cfg(self, key: str, default: Any) -> Any:
        return self.team_cfg.get(key, default)

    def _emit(self, type: str, task_id=None, round=None, **data):
        self.events.emit(type, role="orchestrator", task_id=task_id, round=round, data=data)

    def _make_agent(self, role: str, system_prompt: str, instruction: str,
                    tools: Optional[List[str]], max_turns: int, log_name: str,
                    task_id: Optional[int] = None, round_no: Optional[int] = None) -> Agent:
        agent = Agent(
            self.working_dir,
            debug=self.debug,
            role=role,
            system_prompt=system_prompt,
            instruction=instruction,
            allowed_tools=tools,
            max_turns=max_turns,
            log_name=log_name,
            llm=self.llm,
        )
        agent.task_id = task_id
        agent.round = round_no
        return agent

    @staticmethod
    def _last_llm_text(agent: Agent) -> str:
        for entry in reversed(agent.history):
            if isinstance(entry, LLMResponse):
                return entry.response
        return ""

    @staticmethod
    def _parse_json_block(text: str, pattern: re.Pattern) -> Optional[Any]:
        m = pattern.search(text)
        if not m:
            return None
        raw = m.group(1).strip()
        raw = re.sub(r"^```(?:json)?\s*|\s*```$", "", raw, flags=re.DOTALL).strip()
        try:
            return json.loads(raw)
        except json.JSONDecodeError:
            return None

    # ------------------------------------------------------------------ roles

    def run_planner(self) -> List[Dict[str, Any]]:
        self.logger.log("=== PLANNER ===")
        agent = self._make_agent(
            role="planner",
            system_prompt=roles.PLANNER_SYSTEM_PROMPT,
            instruction=self.instruction + "\n\nWrite the <plan> now.",
            tools=roles.PLANNER_TOOLS,
            max_turns=self._cfg("planner_max_turns", 3),
            log_name="planner",
        )
        agent.run()
        self.summary["planner_usage"] = agent.usage_report()

        plan = None
        for entry in reversed(agent.history):
            if isinstance(entry, LLMResponse):
                plan = self._parse_json_block(entry.response, PLAN_RE)
                if plan is not None:
                    break

        if not isinstance(plan, list) or not plan:
            self.logger.log_warning("Planner produced no usable plan; falling back to a single task")
            plan = [{
                "id": 1,
                "title": "Build the whole application",
                "description": "Implement everything described in the project instruction.",
                "acceptance": ["All provided tests pass", "The app matches the instruction"],
            }]

        for i, task in enumerate(plan, start=1):
            task.setdefault("id", i)
            task.setdefault("title", f"Task {i}")
            task.setdefault("description", "")
            task.setdefault("acceptance", [])

        self.logger.log(f"Plan has {len(plan)} task(s): " + "; ".join(f"#{t['id']} {t['title']}" for t in plan))
        self.events.emit("plan_created", role="planner", data={"tasks": plan})
        return plan

    def run_coder(self, task: Dict[str, Any], feedback: Optional[Dict[str, Any]], round_no: int) -> Agent:
        self.logger.log(f"=== CODER task #{task['id']} round {round_no} ===")
        agent = self._make_agent(
            role="coder",
            system_prompt=roles.CODER_SYSTEM_PROMPT,
            instruction=roles.coder_task_message(self.instruction, task, feedback, round_no),
            tools=roles.CODER_TOOLS,
            max_turns=self._cfg("coder_max_turns", 40),
            log_name=f"coder_t{task['id']}_r{round_no}",
            task_id=task["id"], round_no=round_no,
        )
        agent.run()
        return agent

    def run_reviewer(self, task: Dict[str, Any], round_no: int) -> Dict[str, Any]:
        self.logger.log(f"=== REVIEWER task #{task['id']} round {round_no} ===")
        agent = self._make_agent(
            role="reviewer",
            system_prompt=roles.REVIEWER_SYSTEM_PROMPT,
            instruction=roles.reviewer_task_message(self.instruction, task, round_no),
            tools=roles.REVIEWER_TOOLS,
            max_turns=self._cfg("reviewer_max_turns", 12),
            log_name=f"reviewer_t{task['id']}_r{round_no}",
            task_id=task["id"], round_no=round_no,
        )
        agent.run()
        self._last_reviewer_usage = agent.usage_report()

        verdict = None
        for entry in reversed(agent.history):
            if isinstance(entry, LLMResponse):
                verdict = self._parse_json_block(entry.response, VERDICT_RE)
                if verdict is not None:
                    break

        if not isinstance(verdict, dict) or verdict.get("verdict") not in ("APPROVE", "REJECT"):
            self.logger.log_warning("Reviewer gave no usable verdict; treating as APPROVE (no evidence of failure)")
            verdict = {"verdict": "APPROVE", "summary": "No structured verdict returned.", "issues": [],
                       "malformed": True}
        verdict.setdefault("issues", [])
        verdict.setdefault("summary", "")
        self.logger.log(f"Reviewer verdict: {verdict['verdict']} - {verdict['summary']}")
        self.events.emit("review_verdict", role="reviewer", task_id=task["id"], round=round_no,
                         data=verdict)
        return verdict

    # ------------------------------------------------------------------- main

    def run(self) -> Dict[str, Any]:
        self._load_config()
        start = time.time()
        max_rounds = max(1, int(self._cfg("max_review_rounds", 3)))
        self._emit("team_start", config=self.team_cfg)

        self.plan = self.run_planner()
        self.summary["plan"] = self.plan

        for task in self.plan:
            task_record = {"id": task["id"], "title": task["title"], "rounds": [], "final": None}
            self._emit("task_start", task_id=task["id"], title=task["title"],
                       acceptance=task.get("acceptance", []))
            feedback = None
            for round_no in range(1, max_rounds + 1):
                coder = self.run_coder(task, feedback, round_no)
                coder_usage = coder.usage_report()  # snapshot before the reviewer adds calls
                verdict = self.run_reviewer(task, round_no)
                task_record["rounds"].append({
                    "round": round_no,
                    "coder_turns": sum(isinstance(e, LLMResponse) for e in coder.history),
                    "coder_usage": coder_usage,
                    "reviewer_usage": self._last_reviewer_usage,
                    "verdict": verdict["verdict"],
                    "issues": verdict["issues"],
                })
                if verdict["verdict"] == "APPROVE":
                    task_record["final"] = "approved"
                    break
                feedback = verdict
            else:
                task_record["final"] = "forced_after_max_rounds"
                self.logger.log_warning(
                    f"Task #{task['id']} still rejected after {max_rounds} rounds; moving on")
            self.summary["tasks"].append(task_record)
            self._emit("task_end", task_id=task["id"], final=task_record["final"],
                       rounds=len(task_record["rounds"]))
            self._write_summary()

        self.summary["elapsed_sec"] = round(time.time() - start, 1)
        self.summary["usage_by_role"] = self._usage_by_role()
        self.summary["usage_total"] = self.llm.usage.snapshot() if hasattr(self.llm, "usage") else {}
        self._write_summary()
        self._emit("team_end", elapsed_sec=self.summary["elapsed_sec"],
                   usage_by_role=self.summary["usage_by_role"], usage_total=self.summary["usage_total"])
        self.logger.log_termination(
            sum(len(t["rounds"]) for t in self.summary["tasks"]),
            "Team run finished",
        )
        return self.summary

    def _usage_by_role(self) -> Dict[str, Dict[str, Any]]:
        keys = ("calls", "input_tokens", "output_tokens", "total_tokens", "cost_usd")
        out = {r: {k: 0 for k in keys} for r in ("planner", "coder", "reviewer")}

        def add(role, u):
            for k in keys:
                out[role][k] = round(out[role][k] + (u or {}).get(k, 0), 6)

        add("planner", self.summary.get("planner_usage"))
        for t in self.summary["tasks"]:
            for r in t["rounds"]:
                add("coder", r.get("coder_usage"))
                add("reviewer", r.get("reviewer_usage"))
        return out

    def _write_summary(self):
        path = self.working_dir / ".waa" / "team_summary.json"
        path.write_text(json.dumps(self.summary, indent=2), encoding="utf-8")
