"""
Mock-LLM test for the planner/coder/reviewer team.

Scenario (one shared MockLanguageModel, responses consumed in order):
  planner  : writes a 2-task plan
  task 1
    coder r1   : writes app.js with a bug, terminates
    reviewer r1: reads the file, REJECTs with a concrete issue
    coder r2   : fixes the bug via fs.edit, terminates
    reviewer r2: reads the file, APPROVEs
  task 2
    coder r1   : writes README, terminates
    reviewer r1: APPROVEs

Checks: files on disk, verdict flow, feedback reaching the coder,
per-role log files, and team_summary.json.
"""
import json
import shutil
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

from waa.llm import MockLanguageModel
from waa.team import TeamOrchestrator

PLAN = '''<plan>
[
  {"id": 1, "title": "Server", "description": "Create app.js that exports port 3000.",
   "acceptance": ["app.js exists", "app.js contains 'port = 3000'"]},
  {"id": 2, "title": "Docs", "description": "Create README.md.",
   "acceptance": ["README.md exists"]}
]
</plan>
<terminate>'''

CODER1_R1 = [
    '<tool_call>{"tool": "fs.write", "arguments": {"path": "app.js", "content": "const port = 8080;\\n"}}</tool_call>',
    '<terminate>',
]
REVIEWER1_R1 = [
    '<tool_call>{"tool": "fs.read", "arguments": {"path": "app.js"}}</tool_call>',
    '''<verdict>
{"verdict": "REJECT", "summary": "Wrong port.",
 "issues": [{"severity": "high", "where": "app.js", "what": "port is 8080, spec says 3000",
             "how_to_fix": "change 8080 to 3000"}]}
</verdict>
<terminate>''',
]
CODER1_R2 = [
    '<tool_call>{"tool": "fs.edit", "arguments": {"path": "app.js", "old_text": "8080", "new_text": "3000"}}</tool_call>',
    '<terminate>',
]
REVIEWER1_R2 = [
    '<tool_call>{"tool": "fs.read", "arguments": {"path": "app.js"}}</tool_call>',
    '<verdict>{"verdict": "APPROVE", "summary": "Port is correct.", "issues": []}</verdict>\n<terminate>',
]
CODER2_R1 = [
    '<tool_call>{"tool": "fs.write", "arguments": {"path": "README.md", "content": "# demo\\n"}}</tool_call>',
    '<terminate>',
]
REVIEWER2_R1 = [
    '<tool_call>{"tool": "fs.ls", "arguments": {"path": "."}}</tool_call>',
    '<verdict>{"verdict": "APPROVE", "summary": "README present.", "issues": []}</verdict>\n<terminate>',
]

SCRIPT = [PLAN] + CODER1_R1 + REVIEWER1_R1 + CODER1_R2 + REVIEWER1_R2 + CODER2_R1 + REVIEWER2_R1


class TestTeamMock(unittest.TestCase):
    def setUp(self):
        self.dir = Path(tempfile.mkdtemp(prefix="test_team_"))
        (self.dir / ".waa").mkdir()
        (self.dir / ".waa" / "config.json").write_text(json.dumps({
            "llm_type": "mock",
            "max_turns": 10,
            "team": {"enabled": True, "max_review_rounds": 3,
                     "planner_max_turns": 2, "coder_max_turns": 6, "reviewer_max_turns": 6},
        }))
        (self.dir / ".waa" / "instruction.md").write_text("Build a demo app on port 3000.")

    def tearDown(self):
        shutil.rmtree(self.dir, ignore_errors=True)

    def test_full_loop(self):
        llm = MockLanguageModel(responses=SCRIPT)
        orch = TeamOrchestrator(self.dir, llm=llm)
        summary = orch.run()

        # All scripted responses were consumed exactly once.
        self.assertEqual(llm.call_count, len(SCRIPT))

        # Files reflect the fix made after the rejection.
        self.assertEqual((self.dir / "app.js").read_text(), "const port = 3000;\n")
        self.assertTrue((self.dir / "README.md").exists())

        # Verdict flow: task 1 took two rounds (REJECT then APPROVE), task 2 one.
        t1, t2 = summary["tasks"]
        self.assertEqual([r["verdict"] for r in t1["rounds"]], ["REJECT", "APPROVE"])
        self.assertEqual(t1["final"], "approved")
        self.assertEqual([r["verdict"] for r in t2["rounds"]], ["APPROVE"])
        self.assertEqual(t1["rounds"][0]["issues"][0]["where"], "app.js")

        # Reviewer feedback reached the coder in round 2.
        coder_r2_log = (self.dir / ".waa" / "logs" / "coder_t1_r2.log").read_text()
        self.assertIn("Reviewer feedback", coder_r2_log)
        self.assertIn("8080", coder_r2_log)

        # One log per role run, plus the overall log and summary.
        logs = sorted(p.name for p in (self.dir / ".waa" / "logs").iterdir())
        self.assertEqual(logs, [
            "coder_t1_r1.log", "coder_t1_r2.log", "coder_t2_r1.log",
            "planner.log",
            "reviewer_t1_r1.log", "reviewer_t1_r2.log", "reviewer_t2_r1.log",
        ])
        self.assertTrue((self.dir / ".waa" / "agent.log").exists())
        saved = json.loads((self.dir / ".waa" / "team_summary.json").read_text())
        self.assertEqual(len(saved["plan"]), 2)

        # Usage accounting: 1 planner call, 3 coder runs x 2, 3 reviewer runs x 2.
        by_role = saved["usage_by_role"]
        self.assertEqual(by_role["planner"]["calls"], 1)
        self.assertEqual(by_role["coder"]["calls"], 6)
        self.assertEqual(by_role["reviewer"]["calls"], 6)
        self.assertEqual(saved["usage_total"]["calls"], 13)
        usage_entries = json.loads((self.dir / ".waa" / "usage.json").read_text())
        self.assertEqual(len(usage_entries), 7)  # one per role run
        self.assertGreater(usage_entries[0]["input_tokens"], 0)

    def test_reviewer_cannot_write(self):
        """Even if the reviewer tries fs.write, the tool is not registered for it."""
        script = [PLAN,
                  *CODER1_R1,
                  '<tool_call>{"tool": "fs.write", "arguments": {"path": "hack.js", "content": "x"}}</tool_call>',
                  '<verdict>{"verdict": "APPROVE", "summary": "", "issues": []}</verdict>\n<terminate>',
                  *CODER2_R1, *REVIEWER2_R1]
        TeamOrchestrator(self.dir, llm=MockLanguageModel(responses=script)).run()
        self.assertFalse((self.dir / "hack.js").exists())
        self.assertIn("Unknown tool 'fs.write'",
                      (self.dir / ".waa" / "logs" / "reviewer_t1_r1.log").read_text())

    def test_forced_acceptance_after_max_rounds(self):
        (self.dir / ".waa" / "config.json").write_text(json.dumps({
            "llm_type": "mock", "team": {"enabled": True, "max_review_rounds": 2}}))
        reject = ['<verdict>{"verdict": "REJECT", "summary": "no", "issues": []}</verdict>\n<terminate>']
        script = [PLAN, *CODER1_R1, *reject, *CODER1_R2, *reject, *CODER2_R1, *REVIEWER2_R1]
        summary = TeamOrchestrator(self.dir, llm=MockLanguageModel(responses=script)).run()
        self.assertEqual(summary["tasks"][0]["final"], "forced_after_max_rounds")
        self.assertEqual(len(summary["tasks"][0]["rounds"]), 2)

    def test_plain_agent_unchanged(self):
        """team.enabled=false must not touch the HW3 path (regression guard)."""
        from waa.agent import Agent
        (self.dir / ".waa" / "config.json").write_text(json.dumps({
            "llm_type": "mock", "max_turns": 3, "allowed_tools": ["fs.write"],
            "team": {"enabled": False},
            "mock_responses": ['<tool_call>{"tool": "fs.write", "arguments": {"path": "a.txt", "content": "hi"}}</tool_call>',
                               '<terminate>']}))
        Agent(self.dir).run()
        self.assertEqual((self.dir / "a.txt").read_text(), "hi")
        self.assertFalse((self.dir / ".waa" / "logs").exists())


if __name__ == "__main__":
    unittest.main()
