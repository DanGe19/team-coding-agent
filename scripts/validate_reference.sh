#!/usr/bin/env bash
# Run visible + hidden tests against the reference solution of a new task.
#   bash scripts/validate_reference.sh kanban|park_waits|nba_standings|pixel_board
set -uo pipefail
cd "$(dirname "$0")/.."
TASK="${1:?task name}"
REF="experiments/reference/$TASK"; TGT="targets/$TASK"; HID="experiments/hidden_tests/$TASK"
[ -d "$REF" ] || { echo "no reference for $TASK"; exit 1; }
cd "$REF"
[ -d node_modules ] || npm install --silent
npm ls --depth=0 2>/dev/null | grep -q '@playwright/test' || npm install --silent --save-dev @playwright/test@^1.40.0 jest@^29.7.0 supertest@^6.3.3
[ -d data ] || { [ -d "../../../$TGT/data" ] && cp -r "../../../$TGT/data" data; }
rm -rf tests && mkdir -p tests/hidden
cp "../../../$TGT/tests/"*.js tests/ 2>/dev/null
cp "../../$(basename "$HID" | sed 's#^#hidden_tests/#')"/*.js tests/hidden/ 2>/dev/null
[ -f playwright.config.js ] || cat > playwright.config.js <<'PW'
module.exports = { testDir: './tests', testMatch: '**/ui.test.js', timeout: 30000, workers: 1,
  reporter: 'list', use: { baseURL: 'http://localhost:3000' } };
PW
[ -f jest.config.js ] || echo "module.exports = { testEnvironment: 'node', testMatch: ['**/tests/**/api.test.js'] };" > jest.config.js
pkill -f "node index.js" 2>/dev/null; sleep 0.5
node index.js > /tmp/ref_server.log 2>&1 & SRV=$!
for i in $(seq 1 30); do curl -s http://localhost:3000/ >/dev/null && break; sleep 0.3; done
echo "== API tests (visible + hidden)"; npx jest tests 2>&1 | grep -E "Tests:|✕|●.*›" 
echo "== UI tests (visible + hidden)"; npx playwright test tests 2>&1 | grep -E "passed|failed|✘|Error:" | head -20
kill $SRV 2>/dev/null; pkill -f "node index.js" 2>/dev/null
echo "server log: /tmp/ref_server.log"
