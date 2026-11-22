"""Event stream: written by plain agent and team mode, readable, live-subscribable."""
import json, shutil, sys, tempfile, unittest
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent.parent))

from waa.agent import Agent
from waa.events import EventLog, EVENT_TYPES
from waa.llm import MockLanguageModel
from waa.team import TeamOrchestrator
from tests.test_team_mock import SCRIPT


class TestEvents(unittest.TestCase):
    def setUp(self):
        EventLog.reset_instances()
        self.dir = Path(tempfile.mkdtemp(prefix="test_events_"))
        (self.dir / ".waa").mkdir()
        (self.dir / ".waa" / "instruction.md").write_text("demo")

    def tearDown(self):
        shutil.rmtree(self.dir, ignore_errors=True)

    def test_plain_agent_emits(self):
        (self.dir / ".waa" / "config.json").write_text(json.dumps({
            "llm_type": "mock", "max_turns": 5, "allowed_tools": ["fs.write"],
            "mock_responses": ['<tool_call>{"tool": "fs.write", "arguments": {"path": "a.txt", "content": "x"}}</tool_call>',
                               '<tool_call>{"tool": "nope", "arguments": {}}</tool_call>',
                               '<terminate>']}))
        seen = []
        EventLog(self.dir).subscribe(seen.append)
        Agent(self.dir).run()

        types = [e["type"] for e in EventLog.read(self.dir)]
        self.assertEqual(types[0], "run_start")
        self.assertEqual(types[-1], "run_end")
        self.assertIn("tool_call", types)
        self.assertEqual(types.count("llm_response"), 3)
        self.assertTrue(all(t in EVENT_TYPES for t in types))
        # live subscriber saw the same events
        self.assertEqual(len(seen), len(types))
        # unknown tool shows up as a failed tool_result
        fails = [e for e in seen if e["type"] == "tool_result" and not e["data"]["ok"]]
        self.assertEqual(fails[0]["data"]["tool"], "nope")
        # every event is tagged role=agent, no task
        self.assertTrue(all(e["role"] == "agent" and e["task_id"] is None for e in seen))

    def test_team_events_are_tagged(self):
        (self.dir / ".waa" / "config.json").write_text(json.dumps({"llm_type": "mock", "team": {"enabled": True}}))
        TeamOrchestrator(self.dir, llm=MockLanguageModel(responses=SCRIPT)).run()
        evs = EventLog.read(self.dir)
        self.assertEqual(evs[0]["type"], "team_start")
        self.assertEqual(evs[-1]["type"], "team_end")
        verdicts = EventLog.read(self.dir, types=["review_verdict"])
        self.assertEqual([v["data"]["verdict"] for v in verdicts], ["REJECT", "APPROVE", "APPROVE"])
        self.assertEqual([(v["task_id"], v["round"]) for v in verdicts], [(1, 1), (1, 2), (2, 1)])
        roles = {e["role"] for e in evs}
        self.assertEqual(roles, {"orchestrator", "planner", "coder", "reviewer"})
        self.assertEqual(len({e["run_id"] for e in evs}), 1)
        self.assertEqual([e["seq"] for e in evs], list(range(1, len(evs) + 1)))

    def test_unknown_type_rejected(self):
        with self.assertRaises(ValueError):
            EventLog(self.dir).emit("not_a_type")


if __name__ == "__main__":
    unittest.main()
