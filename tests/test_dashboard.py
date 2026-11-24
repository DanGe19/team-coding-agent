"""Dashboard server: folder discovery, tailing events.jsonl, HTTP API, demo stream (no browser needed)."""
import json, shutil, sys, tempfile, threading, unittest, urllib.error, urllib.parse, urllib.request
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent.parent))

from waa.dashboard import server as dashboard
from waa.dashboard.demo import play
from waa.dashboard.server import discover, events_path, make_server, read_events
from waa.events import EventLog, EVENT_TYPES


def write_lines(path: Path, run_id: str, count: int, mode: str = "w"):
    with open(path, mode, encoding="utf-8") as f:
        for i in range(1, count + 1):
            f.write(json.dumps({"seq": i, "run_id": run_id, "type": "note", "data": {"i": i}}) + "\n")


class TestDashboard(unittest.TestCase):
    def setUp(self):
        EventLog.reset_instances()
        self.root = Path(tempfile.mkdtemp(prefix="test_dashboard_")).resolve()
        self.run = self.root / "runs" / "kanban__team__r1"
        (self.run / ".waa").mkdir(parents=True)
        self.path = events_path(self.run)

    def tearDown(self):
        shutil.rmtree(self.root, ignore_errors=True)

    def test_discover(self):
        write_lines(self.path, "A", 2)
        idle = self.root / "targets" / "kanban"                 # a working dir that has not run yet
        (idle / ".waa").mkdir(parents=True)
        for decoy in (self.root / "node_modules" / "pkg", self.run / "app" / "nested"):
            (decoy / ".waa").mkdir(parents=True)
            write_lines(events_path(decoy), "X", 1)

        found = discover([self.root])
        self.assertEqual([s["path"] for s in found], [self.run])        # only folders with a recorded run
        self.assertTrue(found[0]["name"].endswith("runs/kanban__team__r1"))
        self.assertTrue(found[0]["has_events"])

        explicit = discover([idle, self.root])                  # a named working dir is listed before its first event
        self.assertEqual({s["path"] for s in explicit}, {idle, self.run})
        self.assertFalse(next(s for s in explicit if s["path"] == idle)["has_events"])
        self.assertEqual(len({s["id"] for s in explicit}), 2)

    def test_tail_returns_only_complete_lines(self):
        write_lines(self.path, "A", 3)
        first = read_events(self.path)
        self.assertEqual([e["seq"] for e in first["events"]], [1, 2, 3])
        self.assertEqual(first["offset"], self.path.stat().st_size)
        self.assertFalse(first["reset"] or first["more"])

        with open(self.path, "a") as f:                         # the agent is halfway through writing a line
            f.write('{"seq": 4, "run_id": "A", "ty')
        partial = read_events(self.path, first["offset"], first["fid"])
        self.assertEqual((partial["events"], partial["offset"], partial["more"]), ([], first["offset"], False))

        with open(self.path, "a") as f:
            f.write('pe": "note", "data": {}}\nnot json\n')
        rest = read_events(self.path, first["offset"], first["fid"])
        self.assertEqual([e["seq"] for e in rest["events"]], [4])   # the bad line is skipped, not fatal
        self.assertEqual(rest["offset"], self.path.stat().st_size)
        self.assertFalse(rest["reset"])

    def test_replaced_file_resets(self):
        write_lines(self.path, "A", 5)
        old = read_events(self.path)
        for count in (2, 9):                                    # a new run, smaller or larger than the old offset
            write_lines(self.path, "B", count)
            new = read_events(self.path, old["offset"], old["fid"])
            self.assertTrue(new["reset"])
            self.assertEqual([e["run_id"] for e in new["events"]], ["B"] * count)
        self.path.unlink()
        gone = read_events(self.path, old["offset"], old["fid"])
        self.assertEqual((gone["events"], gone["offset"], gone["reset"]), ([], 0, True))
        self.assertFalse(read_events(self.path)["reset"])       # nothing was shown yet, nothing to clear

    def test_large_files_arrive_in_chunks(self):
        write_lines(self.path, "A", 40)
        original, dashboard.MAX_CHUNK = dashboard.MAX_CHUNK, 64     # smaller than one line
        try:
            seen, state, calls = [], {"offset": 0, "fid": "", "more": True}, 0
            while state["more"]:
                state = read_events(self.path, state["offset"], state["fid"])
                seen += [e["seq"] for e in state["events"]]
                calls += 1
                self.assertLess(calls, 100)
        finally:
            dashboard.MAX_CHUNK = original
        self.assertEqual(seen, list(range(1, 41)))              # nothing lost, nothing repeated
        self.assertGreater(calls, 2)

    def test_http_api(self):
        write_lines(self.path, "A", 3)
        server = make_server([self.root], port=0)
        threading.Thread(target=server.serve_forever, daemon=True).start()
        base = f"http://127.0.0.1:{server.server_address[1]}"

        def get(path):
            try:
                with urllib.request.urlopen(base + path, timeout=5) as res:
                    return res.status, res.headers.get_content_type(), res.read()
            except urllib.error.HTTPError as e:
                return e.code, e.headers.get_content_type(), e.read()

        try:
            status, ctype, body = get("/api/sources")
            sources = json.loads(body)["sources"]
            self.assertEqual((status, ctype, len(sources)), (200, "application/json", 1))
            self.assertNotIn("path", sources[0])
            source = urllib.parse.quote(sources[0]["id"], safe="")

            first = json.loads(get(f"/api/events?source={source}&offset=0")[2])
            self.assertEqual(len(first["events"]), 3)
            write_lines(self.path, "A", 2, mode="a")
            later = json.loads(get(f"/api/events?source={source}&offset={first['offset']}&fid={first['fid']}")[2])
            self.assertEqual((len(later["events"]), later["reset"]), (2, False))   # only what is new

            self.assertEqual(get("/api/events?source=nope")[0], 404)
            self.assertEqual(get(f"/api/events?source={source}&offset=abc")[0], 400)

            status, ctype, body = get("/")
            self.assertEqual((status, ctype), (200, "text/html"))
            self.assertIn(b"Mission control", body)
            for name in ("app.js", "model.js", "style.css"):
                self.assertEqual(get(f"/static/{name}")[0], 200)
            for path in ("/static/../server.py", "/static/server.py", "/static/", "/nothing"):
                self.assertEqual(get(path)[0], 404)             # only the whitelisted page files are served
        finally:
            server.shutdown()
            server.server_close()

    def test_demo_stream_matches_the_contract(self):
        play(self.run, speed=0)
        events = EventLog.read(self.run)
        self.assertTrue(all(e["type"] in EVENT_TYPES for e in events))
        self.assertEqual((events[0]["type"], events[-1]["type"]), ("team_start", "team_end"))
        self.assertEqual([e["seq"] for e in events], list(range(1, len(events) + 1)))
        verdicts = [e["data"]["verdict"] for e in events if e["type"] == "review_verdict"]
        self.assertEqual(verdicts, ["REJECT", "APPROVE", "APPROVE", "REJECT", "APPROVE"])
        self.assertTrue(any(e["type"] == "test_result" and not e["data"]["passed"] for e in events))
        self.assertTrue(any(e["type"] == "tool_result" and not e["data"]["ok"] for e in events))
        # the running total the page adds up equals what the run reports at the end
        spent = sum(e["data"]["usage"]["cost_usd"] for e in events if e["type"] == "llm_response")
        self.assertAlmostEqual(spent, events[-1]["data"]["usage_total"]["cost_usd"], places=6)
        self.assertEqual(read_events(self.path)["events"], events)


if __name__ == "__main__":
    unittest.main()
