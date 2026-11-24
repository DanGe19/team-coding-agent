"""
Mission control: a local web dashboard for WAA runs.

    python -m waa.dashboard                   # every folder with a recorded run under the current dir
    python -m waa.dashboard targets/kanban    # one folder (can be started before the run)
    python -m waa.dashboard --demo            # synthetic run, to see live mode without an API key

The page reads `.waa/events.jsonl` (docs/EVENTS.md) and nothing else.

Live view works by tailing that file by byte offset, not by EventLog.subscribe():
subscribers only fire inside the process that emits, and the dashboard runs in a
separate process from `waa`. Replay is the same data read from offset 0.

HTTP API (all GET, JSON):
    /api/sources                          folders that can be watched
    /api/events?source=ID&offset=N&fid=F  events appended after byte N of that folder's file
"""
import hashlib
import json
import os
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional
from urllib.parse import parse_qs, urlsplit

STATIC_DIR = Path(__file__).parent / "static"
STATIC_FILES = {
    "index.html": "text/html; charset=utf-8",
    "style.css": "text/css; charset=utf-8",
    "app.js": "text/javascript; charset=utf-8",
    "model.js": "text/javascript; charset=utf-8",
}

SKIP_DIRS = {"node_modules", "__pycache__"}
MAX_DEPTH = 4                    # repo root -> experiments/reference/hw3_built/<target>
MAX_CHUNK = 2 * 1024 * 1024      # bytes of events returned per request


def events_path(working_dir: Path) -> Path:
    return Path(working_dir) / ".waa" / "events.jsonl"


# ------------------------------------------------------------------ discovery

def _scan(folder: Path, depth: int, out: List[Path]):
    if events_path(folder).is_file():
        out.append(folder)
        return                   # below a run folder is the generated app, not more runs
    if depth >= MAX_DEPTH:
        return
    try:
        children = sorted(e.path for e in os.scandir(folder)
                          if e.is_dir(follow_symlinks=False)
                          and not e.name.startswith(".") and e.name not in SKIP_DIRS)
    except OSError:
        return
    for child in children:
        _scan(Path(child), depth + 1, out)


def discover(roots: Iterable[Path]) -> List[Dict[str, Any]]:
    """Folders to offer in the page. A root that is itself a working dir (has `.waa/`)
    is listed even before its first event; any other root is searched for recorded runs."""
    cwd = Path.cwd().resolve()
    sources: Dict[str, Dict[str, Any]] = {}
    for root in roots:
        root = Path(root).resolve()
        if (root / ".waa").is_dir():
            found = [root]
        else:
            found = []
            _scan(root, 0, found)
        for folder in found:
            try:                                     # inside the current dir: the path you would type
                sid = folder.relative_to(cwd).as_posix()
                name = folder.name if sid == "." else sid
            except ValueError:                       # elsewhere: keep the label short, the id unique
                sid = folder.as_posix()
                name = (Path(root.name) / folder.relative_to(root)).as_posix()
            try:
                st = events_path(folder).stat()
                size, mtime = st.st_size, st.st_mtime
            except OSError:
                size, mtime = 0, 0.0
            sources.setdefault(sid, {"id": sid, "name": name, "path": folder,
                                     "has_events": size > 0, "size": size, "mtime": mtime})
    sources = list(sources.values())
    sources.sort(key=lambda s: (-s["mtime"], s["name"]))    # most recently active first
    return sources


# -------------------------------------------------------------------- tailing

def read_events(path: Path, offset: int = 0, fid: str = "") -> Dict[str, Any]:
    """Events appended to `path` after byte `offset`.

    Only complete lines are consumed, so a line the agent is still writing is
    returned by a later call instead of being dropped. `fid` fingerprints the
    file's first line; when it no longer matches (the folder was wiped and a new
    run started) reading restarts from 0 and `reset` tells the page to clear.
    """
    out: Dict[str, Any] = {"events": [], "offset": 0, "fid": "", "reset": False, "more": False}
    try:
        f = open(path, "rb")
    except OSError:
        out["reset"] = offset > 0
        return out
    with f:
        size = os.fstat(f.fileno()).st_size
        first = f.readline()
        current = hashlib.md5(first).hexdigest()[:12] if first.endswith(b"\n") else ""
        if offset and (offset > size or fid != current):
            offset, out["reset"] = 0, True
        f.seek(offset)
        chunk = f.read(MAX_CHUNK)
        if len(chunk) == MAX_CHUNK and b"\n" not in chunk:
            chunk += f.readline()            # one line longer than a whole chunk
        end = chunk.rfind(b"\n") + 1
        for line in chunk[:end].splitlines():
            try:
                event = json.loads(line)
            except ValueError:
                continue
            if isinstance(event, dict):
                out["events"].append(event)
        out.update(offset=offset + end, fid=current, more=len(chunk) >= MAX_CHUNK)
    return out


# ----------------------------------------------------------------------- HTTP

class Handler(BaseHTTPRequestHandler):
    server_version = "waa-dashboard"

    def log_message(self, format, *args):    # keep the terminal quiet; the page polls every second
        pass

    def do_GET(self):
        url = urlsplit(self.path)
        query = parse_qs(url.query)
        try:
            if url.path == "/":
                self._static("index.html")
            elif url.path.startswith("/static/"):
                self._static(url.path[len("/static/"):])
            elif url.path == "/api/sources":
                self._sources()
            elif url.path == "/api/events":
                self._events(query)
            else:
                self._json({"error": "not found"}, 404)
        except (BrokenPipeError, ConnectionResetError):
            pass                             # the browser tab went away mid-response

    def _sources(self):
        sources = self.server.refresh()
        self._json({
            "roots": [str(r) for r in self.server.roots],
            "sources": [{k: v for k, v in s.items() if k != "path"} for s in sources],
        })

    def _events(self, query: Dict[str, List[str]]):
        source = self.server.lookup(query.get("source", [""])[0])
        if source is None:
            return self._json({"error": "unknown source"}, 404)
        try:
            offset = max(0, int(query.get("offset", ["0"])[0]))
        except ValueError:
            return self._json({"error": "offset must be an integer"}, 400)
        self._json(read_events(events_path(source["path"]), offset, query.get("fid", [""])[0]))

    def _static(self, name: str):
        ctype = STATIC_FILES.get(name)       # whitelist: nothing else on disk is reachable
        if ctype is None:
            return self._json({"error": "not found"}, 404)
        self._send(200, ctype, (STATIC_DIR / name).read_bytes())

    def _json(self, obj: Any, status: int = 200):
        self._send(status, "application/json; charset=utf-8",
                   json.dumps(obj, ensure_ascii=False).encode("utf-8"))

    def _send(self, status: int, ctype: str, body: bytes):
        self.send_response(status)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)


class DashboardServer(ThreadingHTTPServer):
    daemon_threads = True

    def __init__(self, address, roots: Iterable[Path]):
        super().__init__(address, Handler)
        self.roots = [Path(r) for r in roots]
        self._sources: Dict[str, Dict[str, Any]] = {}

    def refresh(self) -> List[Dict[str, Any]]:
        sources = discover(self.roots)
        self._sources = {s["id"]: s for s in sources}
        return sources

    def lookup(self, source_id: str) -> Optional[Dict[str, Any]]:
        """Resolve an id from the page. Ids only ever map to discovered folders,
        so a request cannot name an arbitrary path."""
        if source_id not in self._sources:
            self.refresh()
        return self._sources.get(source_id)


def make_server(roots: Iterable[Path], host: str = "127.0.0.1", port: int = 8765) -> DashboardServer:
    return DashboardServer((host, port), roots)
