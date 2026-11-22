"""Pipeline check for experiments/run_experiments.py using the mock LLM (no API, no browsers)."""
import csv, shutil, subprocess, sys, tempfile, unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "experiments"))
from summarize import load, summarize  # noqa: E402


class TestDryRun(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp(prefix="exp_"))

    def tearDown(self):
        shutil.rmtree(self.tmp, ignore_errors=True)

    def test_pipeline(self):
        args = [sys.executable, str(ROOT / "experiments" / "run_experiments.py"),
                "--targets", "chat_room", "--settings", "baseline", "team", "--repeats", "2", "--dry-run",
                "--runs-dir", str(self.tmp / "runs"), "--results-dir", str(self.tmp / "results")]
        out = subprocess.run(args, capture_output=True, text=True, timeout=600)
        self.assertEqual(out.returncode, 0, out.stderr)

        rows = load(self.tmp / "results" / "results.csv")
        self.assertEqual(len(rows), 4)
        self.assertEqual({r["setting"] for r in rows}, {"baseline", "team"})
        team = [r for r in rows if r["setting"] == "team"][0]
        self.assertGreater(int(team["plan_tasks"]), 0)         # planner ran
        self.assertGreater(int(team["total_tokens"]), 0)        # usage collected
        run_dir = self.tmp / "runs" / "chat_room__team__r1"
        self.assertTrue((run_dir / ".waa" / "events.jsonl").exists())
        self.assertFalse((run_dir / "node_modules").exists())   # clean copy
        self.assertTrue((ROOT / "targets" / "chat_room" / ".waa" / "instruction.md").exists())

        # resume: nothing re-run
        out2 = subprocess.run(args, capture_output=True, text=True, timeout=600)
        self.assertIn("4 already done", out2.stdout)
        self.assertEqual(len(load(self.tmp / "results" / "results.csv")), 4)

        recs = summarize(rows)
        self.assertEqual([(r["target"], r["setting"], r["n"]) for r in recs],
                         [("chat_room", "baseline", 2), ("chat_room", "team", 2)])


if __name__ == "__main__":
    unittest.main()
