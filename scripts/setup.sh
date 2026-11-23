#!/usr/bin/env bash
# One-time setup on a dev machine (macOS/Linux). Run from the repo root:  bash scripts/setup.sh
set -euo pipefail
cd "$(dirname "$0")/.."
command -v node >/dev/null || { echo "Node.js 18+ is required"; exit 1; }
[ -d .venv ] || python3 -m venv .venv
# shellcheck disable=SC1091
source .venv/bin/activate
pip install -q -r requirements.txt
pip install -q -e .
echo "Python deps OK ($(python --version))"
# Browsers are installed per project by the scripts that run UI tests (version must match the project's Playwright).
echo
echo "Next:  source .venv/bin/activate && export AWS_BEARER_TOKEN_BEDROCK=..."
