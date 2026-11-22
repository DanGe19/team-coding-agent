import argparse
import json
from pathlib import Path

from .agent import Agent


def main():
    argparser = argparse.ArgumentParser(
        prog="waa",
        description="Web-App Agent - An LLM-powered agent for building web applications"
    )
    argparser.add_argument(
        "-w",
        "--working-dir",
        type=str,
        default=".",
        help="Working directory containing .waa configuration"
    )
    argparser.add_argument(
        "--debug",
        action="store_true",
        help="Enable debug mode"
    )
    argparser.add_argument(
        "--team",
        action="store_true",
        help="Force team mode (planner/coder/reviewer) regardless of config"
    )
    args = argparser.parse_args()

    working_dir = Path(args.working_dir)

    team_enabled = args.team
    config_path = working_dir / ".waa" / "config.json"
    if not team_enabled and config_path.exists():
        with open(config_path) as f:
            team_enabled = bool(json.load(f).get("team", {}).get("enabled", False))

    if team_enabled:
        from .team import TeamOrchestrator
        TeamOrchestrator(working_dir, debug=args.debug).run()
    else:
        agent = Agent(working_dir, debug=args.debug)
        agent.run()


if __name__ == "__main__":
    main()
