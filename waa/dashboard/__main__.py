"""CLI entry point: python -m waa.dashboard [folders ...] [--port N] [--open] [--demo]"""
import argparse
import shutil
import sys
import tempfile
import threading
import webbrowser
from pathlib import Path

from .server import make_server


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(
        prog="python -m waa.dashboard",
        description="Mission control: live view and replay of WAA runs, read from .waa/events.jsonl.")
    ap.add_argument("paths", nargs="*",
                    help="a working dir (e.g. targets/kanban) or a folder to search for recorded runs "
                         "(e.g. experiments/runs). Default: the current directory.")
    ap.add_argument("--port", type=int, default=8765)
    ap.add_argument("--host", default="127.0.0.1", help="default 127.0.0.1 (this machine only)")
    ap.add_argument("--open", action="store_true", help="open the page in the default browser")
    ap.add_argument("--demo", action="store_true",
                    help="play a synthetic team run, to try the live view without an API key")
    ap.add_argument("--demo-speed", type=float, default=1.0, help="2 = twice as fast (default 1)")
    args = ap.parse_args(argv)

    roots = [Path(p) for p in args.paths]
    demo_dir = None
    if args.demo:
        demo_dir = Path(tempfile.mkdtemp(prefix="waa-demo-"))
        (demo_dir / ".waa").mkdir()
        roots.insert(0, demo_dir)
    elif not roots:
        roots = [Path(".")]
    for root in roots:
        if not root.is_dir():
            print(f"Not a folder: {root}", file=sys.stderr)
            return 1

    try:
        server = make_server(roots, args.host, args.port)
    except OSError as e:
        print(f"Cannot listen on {args.host}:{args.port} ({e}). Try another --port.", file=sys.stderr)
        return 1

    url = f"http://{args.host}:{server.server_address[1]}/"
    print(f"Mission control: {url}   (Ctrl+C to stop)", flush=True)
    print("Watching: " + ", ".join(str(r) for r in roots), flush=True)
    if demo_dir:
        from .demo import play
        threading.Thread(target=play, args=(demo_dir, max(args.demo_speed, 0.1)), daemon=True).start()
    if args.open:
        webbrowser.open(url)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print()
    finally:
        server.server_close()
        if demo_dir:
            shutil.rmtree(demo_dir, ignore_errors=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
