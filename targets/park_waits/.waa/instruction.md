# Park Wait Times - Build Instructions

Build a theme-park wait-time simulator with Node.js, Express and plain browser JavaScript (no frontend framework, no build step). Serve `public/` statically so `GET /` returns `public/index.html`. Server in `index.js` on port 3000, `"start": "node index.js"` in `package.json`; `index.js` must export the Express app and only call `listen` when run directly. Keep HTML, CSS and JS in separate files under `public/`.

The park is modelled after a real one: five themed lands, eleven rides. Guests arrive, pick a ride, queue, ride, and pick another ride. The app shows the current estimated wait time of every ride, like the park's official app.

## Simulation model

Time advances in **ticks of one simulated minute**. All state is in memory; restarting the server resets it.

**Rides** (fixed data, below). Each ride has: `id`, `name`, `land`, `capacity` (guests per cycle), `duration` (minutes per cycle), `x`, `y` (map position, 0-100). Runtime fields: `status` (`"open"` or `"closed"`), `queue` (array of guest ids, in arrival order), `riding` (array of guest ids currently on the ride), `cycleRemaining` (minutes left in the current cycle, 0 when idle), `waitMinutes` (see formula), `totalRiders` (cumulative guests who finished riding).

**Guests.** Each guest has `id` (integer from 1), `state` (`"queued" | "riding" | "wandering" | "left"`), `rideId` (current ride or null), `ridesTaken` (integer), `strategy` (`"random"` or `"shortest"`).

**One tick does the following, in this order, for every open ride (in the order of the data list):**
1. If `cycleRemaining > 0`, decrement it. If it reaches 0: everyone in `riding` finishes — add them to `totalRiders`, increment their `ridesTaken`, set them to `wandering` with `rideId = null`, and empty `riding`.
2. If `cycleRemaining == 0` and the queue is not empty: move up to `capacity` guests from the front of the queue into `riding` (state `riding`), and set `cycleRemaining = duration`.

Then for every guest in state `wandering`: with probability `leaveProbability` (default 0.1) the guest leaves the park (`left`, `rideId = null`); otherwise the guest picks a ride among the **open** rides using their strategy (`random`: uniform; `shortest`: the open ride with the smallest wait computed from the queue **as it is at that moment** — guests who joined earlier in the same tick already count — ties broken by data order), joins the back of its queue and becomes `queued`.

Finally `time` (the tick counter, starting at 0) increases by 1 and every ride's `waitMinutes` is recomputed.

**Wait time formula** for an open ride:
`waitMinutes = cycleRemaining + ceil(queueLength / capacity) * duration`
For a closed ride `waitMinutes` is `null`.

**Randomness must be seeded.** `POST /api/reset {"seed": 42}` must make the whole simulation deterministic for that seed (use a simple seeded PRNG such as mulberry32; `Math.random` is not allowed for simulation decisions). Guests created by `POST /api/guests` are assigned ids in order and are placed in state `wandering`, so they choose a ride on the next tick.

**Closing a ride** (`status = "closed"`): guests currently riding finish normally when the cycle ends; guests in its queue immediately become `wandering` (they will pick another ride next tick) and the queue is emptied; `waitMinutes` becomes `null`. Wandering guests never pick a closed ride. Reopening just sets `status = "open"`.

**Automatic clock.** In normal mode the server advances one tick every `tickMs` milliseconds (default 1000) while the simulation is `running`, and auto-spawns `spawnPerTick` guests per tick (default 3, strategy alternates random/shortest). With `?test=1` in the page URL the page must not start the clock; and the server must never advance automatically unless `running` is true. `running` starts as `false`.

## Ride data (use exactly these values)

| id | name | land | capacity | duration | x | y |
|---|---|---|---|---|---|---|
| mario-kart | Mario Kart: Bowser's Challenge | Super Nintendo World | 16 | 5 | 12 | 55 |
| yoshi | Yoshi's Adventure | Super Nintendo World | 24 | 4 | 8 | 70 |
| mine-cart | Mine-Cart Madness | Super Nintendo World | 12 | 3 | 20 | 62 |
| wing-gliders | Hiccup's Wing Gliders | How to Train Your Dragon - Isle of Berk | 20 | 3 | 55 | 80 |
| dragon-rally | Dragon Racer's Rally | How to Train Your Dragon - Isle of Berk | 24 | 4 | 48 | 88 |
| fyre-drill | Fyre Drill | How to Train Your Dragon - Isle of Berk | 16 | 4 | 62 | 90 |
| stardust | Stardust Racers | Celestial Park | 24 | 3 | 30 | 40 |
| carousel | Constellation Carousel | Celestial Park | 40 | 4 | 38 | 50 |
| monsters | Monsters Unchained: The Frankenstein Experiment | Dark Universe | 16 | 5 | 40 | 15 |
| werewolf | Curse of the Werewolf | Dark Universe | 20 | 3 | 32 | 10 |
| ministry | Harry Potter and the Battle at the Ministry | The Wizarding World of Harry Potter - Ministry of Magic | 16 | 6 | 80 | 45 |

Land colors: Super Nintendo World `#e4002b`, How to Train Your Dragon - Isle of Berk `#f28c00`, Celestial Park `#1f6feb`, Dark Universe `#4b2a5a`, The Wizarding World of Harry Potter - Ministry of Magic `#1b1f3b`.

## RESTful API

JSON everywhere. Validation errors → **400** `{"error": "..."}`; unknown ride id → **404** `{"error": "Ride not found"}`.

- `GET /api/state` → `{ time, running, tickMs, spawnPerTick, leaveProbability, seed, rides: [ride...], guests: { total, queued, riding, wandering, left } }`. Each ride includes all fixed and runtime fields; `queue` and `riding` are arrays of ids; also include `queueLength`.
- `GET /api/rides` → array of rides (same objects as above).
- `GET /api/rides/:id` → one ride.
- `POST /api/reset` body `{ "seed": <integer, optional, default 1>, "leaveProbability": <number 0..1, optional, default 0.1> }` → resets time, guests and rides (all open, empty), stops the clock, sets the seed and leave probability. Returns the state (200). 400 if a value is invalid.
- `POST /api/tick` body `{ "n": <integer 1..1000, optional, default 1> }` → advances n ticks. Returns the state. 400 if n is invalid.
- `POST /api/guests` body `{ "count": <integer 1..500>, "strategy": "random"|"shortest" (optional, default "random") }` → creates guests. Returns `{ created: [ids...], total }` with **201**. 400 if invalid.
- `POST /api/rides/:id/status` body `{ "status": "open"|"closed" }` → returns the ride. 400 for other values.
- `POST /api/clock` body `{ "running": boolean, "tickMs": <integer 100..10000, optional>, "spawnPerTick": <integer 0..50, optional> }` → starts/stops the automatic clock. Returns the state.
- `GET /api/guests/:id` → one guest; 404 `{"error": "Guest not found"}`.

## Frontend requirements (the UI tests rely on these ids and classes)

Header: `#sim-time` shows the simulated time as `HH:MM` starting from `09:00` (time 0 = 09:00, time 90 = 10:30). `#guest-count` shows the number of guests currently in the park (queued + riding + wandering). Controls: `#btn-start` (toggle running, label "Start" or "Pause"), `#btn-tick` (advance one tick), `#btn-add-guests` (add 50 random-strategy guests), `#btn-reset` (reset with seed from `#seed-input`), `#btn-view` (toggle between board and map view).

**Board view** (`#board`, default): one section per land, in the data order of first appearance, with `class="land"` and `data-land="<land name>"`, a heading with the land name, and a colored left border in the land color. Inside, one card per ride with `class="ride"` and `data-ride="<id>"`: the name in `.ride-name`, the wait in `.wait` as `"<n> min"` (or `"Closed"`), the queue length in `.queue-len`, and a status pill `.status` with text `open` / `closed`. The card gets exactly one of the classes `wait-low` (< 15 min), `wait-mid` (15-44), `wait-high` (>= 45), `wait-closed`. Each card has a button `.btn-toggle` that closes/opens the ride.

**Map view** (`#map`, hidden until toggled): a 100x100 coordinate area rendered as a positioned box (at least 600px wide on desktop). One marker per ride with `class="marker"`, `data-ride="<id>"`, positioned at `left: x%`, `top: y%`, showing the wait minutes (or "–" when closed), colored by the same low/mid/high/closed classes. Markers must not overlap each other. A legend shows the four colors.

The page fetches `/api/state` on load and after every button press, and while running it polls every `tickMs`. Must look clean and modern and work at 800px width.

## Tests

Visible tests: `tests/api.test.js` (Jest + Supertest) and `tests/ui.test.js` (Playwright, server on port 3000, opens `/?test=1`). Do not modify them. Hidden tests check the same specification more thoroughly — including determinism with a seed, the tick order, and ride closing — so follow the spec exactly.
