# Reference solutions

One known-good implementation per benchmark task. Two uses:

1. **Validate the tests.** Visible and hidden tests must pass against the reference
   (API tests verified in CI-less fashion: `npm install && npx jest`; UI tests need a browser).
2. **Plant bugs.** The bug benchmark (functional + visual) is built by copying a
   reference app and breaking one thing per copy.

The agent must never see this folder: it lives outside `targets/`.

Validate kanban API tests:
```bash
cd experiments/reference/kanban && npm install
mkdir -p tests/hidden
cp ../../../targets/kanban/tests/api.test.js tests/
cp ../../hidden_tests/kanban/api.test.js tests/hidden/
npx jest tests            # expect 13 passed
# UI: node index.js &  then  npx playwright test ../../../targets/kanban/tests/ui.test.js ...
```

Validate park_waits the same way (`cd experiments/reference/park_waits`, copy the two
api.test.js files, `npx jest tests` → expect 15 passed).
