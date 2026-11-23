# League Standings Tracker - Build Instructions

Build a basketball league standings tracker with Node.js, Express and plain browser JavaScript (no frontend framework, no build step). Serve `public/` statically so `GET /` returns `public/index.html`. Server in `index.js` on port 3000, `"start": "node index.js"` in `package.json`; `index.js` must export the Express app and only call `listen` when run directly. Separate HTML, CSS and JS files under `public/`.

The league has 30 fixed teams in two conferences (East, West) and six divisions. Users record game results and player stat lines; the app computes standings, streaks, averages and an injury report. All data lives in memory; `data/sample_season.json` (provided, read-only) contains a sample season that can be imported.

## Data

**Team** (fixed; load the 30 teams from `data/sample_season.json` → `teams` at startup; they are never created or deleted): `id` (3-letter code, e.g. `"BOS"`), `name`, `conference` (`"East"|"West"`), `division`.

**Game**: `id` (integer from 1), `date` (`YYYY-MM-DD`), `homeTeam`, `awayTeam` (team ids), `homeScore`, `awayScore` (non-negative integers, never equal).

**Player**: `id` (integer from 1), `name` (non-empty, ≤ 60 chars), `teamId`, `position` (`PG|SG|SF|PF|C`), `number` (integer 0–99), `injury`: `{ "status": "healthy"|"day-to-day"|"out", "note": string, "expectedReturn": "YYYY-MM-DD" | null }`. New players start `healthy` with empty note and `null` return date.

**Stat line**: `{ gameId, playerId, points, rebounds, assists }` (non-negative integers). One line per (game, player) — posting a second line for the same pair replaces the first. The player must belong to one of the two teams in that game. A player whose injury status is `out` **at the time of posting** cannot receive a stat line (400).

## Computed values

**Team record** (from games): `w`, `l`, `gp`, `pct` = w / gp rounded to 3 decimals (0 when gp = 0), `home` and `away` as `"W-L"` strings, `pointsFor`, `pointsAgainst`, `diff` = pointsFor − pointsAgainst, `last10` = `"W-L"` over the team's most recent 10 games (fewer if it has played fewer; order games by `date` then `id`), `streak` = `"W3"` / `"L2"` for the current run counting back from the most recent game, or `"-"` with no games.

**Standings** are computed **per conference**: sort by `pct` descending, then `diff` descending, then `id` ascending. `rank` is 1-based within the conference. `gb` (games behind the conference leader) = `((leaderW − w) + (l − leaderL)) / 2`, a number with at most one decimal (leader = 0). `zone`: ranks 1–6 `"playoff"`, 7–10 `"play-in"`, 11–15 `"out"`.

**Player averages** (from stat lines): `gp` (number of stat lines), `ppg`, `rpg`, `apg` each rounded to 1 decimal (0 when gp = 0).

Deleting a game removes its stat lines and updates everything derived.

## RESTful API

JSON everywhere. Validation errors → **400** `{"error": "..."}`; unknown ids → **404** `{"error": "<Team|Game|Player> not found"}`.

- `GET /api/teams` → 30 teams, each with its record fields merged in (`w`, `l`, `gp`, `pct`, `home`, `away`, `diff`, `last10`, `streak`).
- `GET /api/teams/:id` → one team with record, plus `roster` (players with averages merged in, sorted by `number`) and `games` (its games, newest first).
- `GET /api/standings` → `{ "East": [row...], "West": [row...] }`, each row = team + record + `rank`, `gb`, `zone`, in standings order.
- `GET /api/games` (optional `?team=BOS`) → games sorted by `date` desc then `id` desc.
- `POST /api/games` body `{ date, homeTeam, awayTeam, homeScore, awayScore }` → **201** with the game. 400 if the date is not `YYYY-MM-DD`, teams are unknown or equal, scores invalid or tied.
- `DELETE /api/games/:id` → **204**.
- `GET /api/players` (optional `?team=BOS`, `?position=PG`, `?status=out`) → players with averages, sorted by `ppg` desc then `id` asc.
- `POST /api/players` body `{ name, teamId, position, number }` → **201**.
- `PATCH /api/players/:id` body may contain `name`, `teamId`, `position`, `number`, `injury` (full object or partial: missing fields keep their value; `status` must be valid; `expectedReturn` must be a date or null) → **200** updated player with averages.
- `DELETE /api/players/:id` → **204** (also deletes the player's stat lines).
- `GET /api/games/:id/stats` → stat lines of that game, each with `playerName` and `teamId`.
- `POST /api/games/:id/stats` body `{ playerId, points, rebounds, assists }` → **201** with the stat line. 400 if numbers invalid, the player is not on either team, or the player is `out`. 404 if game or player unknown.
- `GET /api/injuries` → players whose status is not `healthy`, sorted `out` first then `day-to-day`, then by `teamId`, then `name`; each with `teamName`.
- `POST /api/import-sample` → clears games/players/stats, loads everything from `data/sample_season.json` (players keep the ids and injury data from the file; games and stats are inserted in file order so ids match the file) → `{ teams, players, games, stats }` counts, **200**.
- `POST /api/reset` → clears games, players and stats (teams remain) → **204**.

## Frontend requirements (UI tests rely on these ids and classes)

Top bar: buttons `#btn-import` (import sample season), `#btn-reset`; tabs `#tab-standings`, `#tab-players`, `#tab-injuries` that switch between `#view-standings`, `#view-players`, `#view-injuries` (only one visible).

**Standings view**: two tables `#standings-east` and `#standings-west` with a caption (conference name) and columns in this order: `#`, Team, W, L, PCT, GB, Home, Away, L10, Streak, Diff. Each row is `tr.team-row` with `data-team="<id>"`, cells have classes `rank`, `team`, `w`, `l`, `pct` (3 decimals, e.g. `.667`), `gb` (`-` for the leader, otherwise like `2.5`), `home`, `away`, `l10`, `streak`, `diff` (with sign, e.g. `+12`, `-5`, `0`). Each row has exactly one of `zone-playoff`, `zone-playin`, `zone-out`, and the three zones are visually distinct (background tint); draw a visible separator line below rank 6 and below rank 10. Column headers `th[data-sort="<field>"]` are clickable: clicking sorts that table by the field (descending first for numeric fields, click again to toggle). Below the tables, a form `#game-form` with selects `#home-team`, `#away-team`, inputs `#home-score`, `#away-score`, `#game-date` and a submit button `#btn-add-game`; on success the standings re-render; on 400 show the server message in `#game-error`.

Clicking a team row opens `#team-panel` showing `.team-name`, `.team-record` (`"W-L"`), a roster table with `tr.player-row[data-player]` (cells `.number`, `.name`, `.position`, `.ppg`, `.rpg`, `.apg`, `.injury`), and the team's games list `.game-row`. Injured players show a badge `.badge-out` or `.badge-dtd` in the injury cell with the note.

**Players view**: filter controls `#filter-team` (select, all teams), `#filter-position` (All/PG/SG/SF/PF/C), `#filter-status`; a table `#players-table` with `tr.player-row[data-player]` (cells `.name`, `.team`, `.position`, `.gp`, `.ppg`, `.rpg`, `.apg`, `.status`) sorted by ppg desc. A form `#player-form` (`#p-name`, `#p-team`, `#p-position`, `#p-number`, `#btn-add-player`). Each row has `.btn-injury` that opens an inline editor (`select.injury-status`, `input.injury-note`, `input.injury-return`, `button.injury-save`) that PATCHes the player.

**Injuries view**: `#injuries-table` with `tr.injury-row[data-player]` (cells `.name`, `.team`, `.position`, `.status`, `.note`, `.return`), `out` rows before `day-to-day` rows; an empty state `#injuries-empty` with text "No injuries reported" when there are none.

The page fetches from the API on load and after every change. Design: clean, modern, sports-site feel; readable at 800px width.

## Tests

Visible tests: `tests/api.test.js` (Jest + Supertest) and `tests/ui.test.js` (Playwright, server on port 3000). Do not modify them or `data/sample_season.json`. Hidden tests check the same specification more thoroughly — standings math on the sample season, tie-breaks, streaks, last-10, GB, injuries and deletions — so follow the spec exactly.
