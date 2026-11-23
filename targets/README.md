# Benchmark tasks

Each folder is one task the agent must build from scratch. A task folder contains:

- `.waa/instruction.md` — the spec the agent reads (what to build, exact API, UI ids/classes)
- `.waa/config.json` — model, turn limit, protected files, feature flags
- `tests/` — **visible** tests (the agent can read and run them)

**Hidden** tests for the new tasks live in `experiments/hidden_tests/<task>/` and are run by
`experiments/run_experiments.py` after the agent finishes. A known-good **reference solution**
for each new task is in `experiments/reference/<task>/` (never shown to the agent); every visible
and hidden API test passes against it.

| task | origin | what it stresses | visible | hidden |
|---|---|---|---|---|
| chat_room | HW3 | basic Express + Handlebars app, REST + UI | api + ui | — |
| tetris | HW3 (3 milestones) | game logic behind a fixed `window.__tetris` interface | ui per milestone | — |
| kanban | new | CRUD with ordering invariants (renumbering, clamping) | 5 api + 3 ui | 8 api + 7 ui |
| park_waits | new | tick-based simulation, seeded randomness, map layout | 5 api + 3 ui | 10 api + 7 ui |
| nba_standings | new | derived statistics, tie-break rules, deletions roll back | 5 api + 3 ui | 12 api + 7 ui |
| pixel_board | new | undo/redo history, flood fill, pixel geometry | 5 api + 3 ui | 8 api + 7 ui |

## kanban — three-column board

A small Trello: fixed columns `todo / doing / done`, cards with `position` inside a column.
Add, move left/right (to the end of the target column), move up/down, edit, delete.
The trap is keeping `position` values gap-free after every move/delete and clamping
out-of-range positions. UI uses buttons (no drag and drop) so tests are deterministic.

## park_waits — theme-park wait times

Modelled on a real park: 5 lands, 11 rides with capacity, cycle duration and map coordinates.
Time advances in one-minute ticks; guests arrive, pick a ride (random or shortest wait), queue,
ride, and either pick again or leave. Wait = remaining cycle + ⌈queue / capacity⌉ × duration.
Everything is seeded (`POST /api/reset {seed}`) and the clock can be driven manually, so the
hidden tests contain a hand-verified 30-guest scenario with exact queue lengths at ticks 1, 2
and 5. Two views: a **board** grouped by land (green/yellow/red by wait) and a **map** with one
marker per ride at `(x%, y%)` — the map is the part meant for the vision feature (overlap,
wrong colours, markers outside the area are invisible to tests).

## nba_standings — league standings tracker

30 fixed real teams in two conferences; users record game results, players, per-game stat
lines and injuries. The app derives everything: W-L, pct, games behind, home/away, last 10,
streak, playoff / play-in / out zones, player averages. Sorting is pct → point diff → id.
A deterministic sample season (140 games, 90 fictional players, 822 stat lines, 3 injuries)
is shipped in `data/sample_season.json` and can be imported with one click; the hidden tests
assert the full East table, GB values and zones for it. Expected values were computed by an
independent Python implementation (`experiments/tools/gen_nba_sample.py`) and match the JS
reference.

## pixel_board — pixel editor with undo/redo

16×16 grid, 8-colour palette plus eraser, tools paint / flood fill / row / column / clear,
import/export JSON, named saves. All state and history live on the server. Rules that are easy
to get wrong: no-op operations are not recorded; a new operation after undo clears redo; the
undo stack is capped at 50; loading a save or importing is itself an undoable step; flood fill
is 4-neighbour only. The UI test also checks that cells are equal squares with no gaps.

## Writing a new task

1. Copy a task folder; write `instruction.md` with exact ids/classes and a full API spec.
2. Write the reference solution first (`experiments/reference/<task>/`), then visible and hidden
   tests against it. If a number in a test comes from a computation, derive it a second way
   (by hand or in Python) before trusting it.
3. Keep visible tests to the basics; put the spec's corners in the hidden set.
4. Add a row to the table above and to `TEAM_NOTES.md`.
