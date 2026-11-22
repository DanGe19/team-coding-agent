// Reference implementation of the Park Wait Times spec. Never shown to the agent.
const express = require('express');
const path = require('path');

const RIDE_DATA = [
  ['mario-kart', "Mario Kart: Bowser's Challenge", 'Super Nintendo World', 16, 5, 12, 55],
  ['yoshi', "Yoshi's Adventure", 'Super Nintendo World', 24, 4, 8, 70],
  ['mine-cart', 'Mine-Cart Madness', 'Super Nintendo World', 12, 3, 20, 62],
  ['wing-gliders', "Hiccup's Wing Gliders", 'How to Train Your Dragon - Isle of Berk', 20, 3, 55, 80],
  ['dragon-rally', "Dragon Racer's Rally", 'How to Train Your Dragon - Isle of Berk', 24, 4, 48, 88],
  ['fyre-drill', 'Fyre Drill', 'How to Train Your Dragon - Isle of Berk', 16, 4, 62, 90],
  ['stardust', 'Stardust Racers', 'Celestial Park', 24, 3, 30, 40],
  ['carousel', 'Constellation Carousel', 'Celestial Park', 40, 4, 38, 50],
  ['monsters', 'Monsters Unchained: The Frankenstein Experiment', 'Dark Universe', 16, 5, 40, 15],
  ['werewolf', 'Curse of the Werewolf', 'Dark Universe', 20, 3, 32, 10],
  ['ministry', 'Harry Potter and the Battle at the Ministry',
    'The Wizarding World of Harry Potter - Ministry of Magic', 16, 6, 80, 45],
];

function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const sim = {
  time: 0, running: false, tickMs: 1000, spawnPerTick: 3, leaveProbability: 0.1, seed: 1,
  rng: mulberry32(1), rides: [], guests: [], nextGuestId: 1, timer: null, spawnToggle: 0,
};

function makeRides() {
  return RIDE_DATA.map(([id, name, land, capacity, duration, x, y]) => ({
    id, name, land, capacity, duration, x, y,
    status: 'open', queue: [], riding: [], cycleRemaining: 0, waitMinutes: 0, totalRiders: 0,
  }));
}

function reset(seed = 1, leaveProbability = 0.1) {
  stopClock();
  sim.time = 0; sim.running = false; sim.seed = seed; sim.rng = mulberry32(seed);
  sim.leaveProbability = leaveProbability;
  sim.rides = makeRides(); sim.guests = []; sim.nextGuestId = 1; sim.spawnToggle = 0;
  recomputeWaits();
}

function waitOf(r) {
  if (r.status !== 'open') return null;
  return r.cycleRemaining + Math.ceil(r.queue.length / r.capacity) * r.duration;
}
function recomputeWaits() { sim.rides.forEach(r => { r.waitMinutes = waitOf(r); }); }

function addGuests(count, strategy) {
  const created = [];
  for (let i = 0; i < count; i++) {
    const g = { id: sim.nextGuestId++, state: 'wandering', rideId: null, ridesTaken: 0, strategy };
    sim.guests.push(g); created.push(g.id);
  }
  return created;
}

function tick() {
  const byId = Object.fromEntries(sim.guests.map(g => [g.id, g]));
  for (const r of sim.rides) {
    if (r.status !== 'open') continue;
    if (r.cycleRemaining > 0) {
      r.cycleRemaining--;
      if (r.cycleRemaining === 0) {
        for (const id of r.riding) {
          const g = byId[id]; r.totalRiders++; g.ridesTaken++; g.state = 'wandering'; g.rideId = null;
        }
        r.riding = [];
      }
    }
    if (r.cycleRemaining === 0 && r.queue.length > 0) {
      r.riding = r.queue.splice(0, r.capacity);
      r.riding.forEach(id => { byId[id].state = 'riding'; });
      r.cycleRemaining = r.duration;
    }
  }
  recomputeWaits();
  const open = sim.rides.filter(r => r.status === 'open');
  for (const g of sim.guests) {
    if (g.state !== 'wandering') continue;
    if (sim.rng() < sim.leaveProbability) { g.state = 'left'; g.rideId = null; continue; }
    if (!open.length) continue;
    let ride;
    if (g.strategy === 'shortest') {
      ride = open.reduce((best, r) => (waitOf(r) < waitOf(best) ? r : best), open[0]);
    } else {
      ride = open[Math.floor(sim.rng() * open.length)];
    }
    ride.queue.push(g.id); g.state = 'queued'; g.rideId = ride.id;
    ride.waitMinutes = waitOf(ride); // keep 'shortest' choices based on current queues
  }
  sim.time++;
  recomputeWaits();
}

function autoTick() {
  if (sim.spawnPerTick > 0) {
    addGuests(sim.spawnPerTick, sim.spawnToggle++ % 2 ? 'shortest' : 'random');
  }
  tick();
}
function startClock() { stopClock(); sim.timer = setInterval(autoTick, sim.tickMs); sim.timer.unref?.(); }
function stopClock() { if (sim.timer) clearInterval(sim.timer); sim.timer = null; }

function rideView(r) {
  return { ...r, queueLength: r.queue.length, waitMinutes: waitOf(r) };
}
function stateView() {
  const counts = { total: sim.guests.length, queued: 0, riding: 0, wandering: 0, left: 0 };
  sim.guests.forEach(g => { counts[g.state]++; });
  return {
    time: sim.time, running: sim.running, tickMs: sim.tickMs, spawnPerTick: sim.spawnPerTick,
    leaveProbability: sim.leaveProbability, seed: sim.seed, rides: sim.rides.map(rideView), guests: counts,
  };
}

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
const bad = (res, m) => res.status(400).json({ error: m });
const findRide = (req, res) => {
  const r = sim.rides.find(x => x.id === req.params.id);
  if (!r) res.status(404).json({ error: 'Ride not found' });
  return r;
};
const isInt = (v, lo, hi) => Number.isInteger(v) && v >= lo && v <= hi;

app.get('/api/state', (req, res) => res.json(stateView()));
app.get('/api/rides', (req, res) => res.json(sim.rides.map(rideView)));
app.get('/api/rides/:id', (req, res) => { const r = findRide(req, res); if (r) res.json(rideView(r)); });
app.get('/api/guests/:id', (req, res) => {
  const g = sim.guests.find(x => x.id === Number(req.params.id));
  g ? res.json(g) : res.status(404).json({ error: 'Guest not found' });
});
app.post('/api/reset', (req, res) => {
  const { seed, leaveProbability } = req.body || {};
  if (seed !== undefined && !Number.isInteger(seed)) return bad(res, 'seed must be an integer');
  if (leaveProbability !== undefined && !(typeof leaveProbability === 'number' && leaveProbability >= 0 && leaveProbability <= 1))
    return bad(res, 'leaveProbability must be a number 0..1');
  reset(seed === undefined ? 1 : seed, leaveProbability === undefined ? 0.1 : leaveProbability);
  res.json(stateView());
});
app.post('/api/tick', (req, res) => {
  const n = (req.body || {}).n;
  if (n !== undefined && !isInt(n, 1, 1000)) return bad(res, 'n must be an integer 1..1000');
  for (let i = 0; i < (n === undefined ? 1 : n); i++) tick();
  res.json(stateView());
});
app.post('/api/guests', (req, res) => {
  const { count, strategy = 'random' } = req.body || {};
  if (!isInt(count, 1, 500)) return bad(res, 'count must be an integer 1..500');
  if (!['random', 'shortest'].includes(strategy)) return bad(res, 'strategy must be random or shortest');
  const created = addGuests(count, strategy);
  res.status(201).json({ created, total: sim.guests.length });
});
app.post('/api/rides/:id/status', (req, res) => {
  const r = findRide(req, res); if (!r) return;
  const { status } = req.body || {};
  if (!['open', 'closed'].includes(status)) return bad(res, 'status must be open or closed');
  if (status === 'closed' && r.status === 'open') {
    const byId = Object.fromEntries(sim.guests.map(g => [g.id, g]));
    r.queue.forEach(id => { byId[id].state = 'wandering'; byId[id].rideId = null; });
    r.queue = [];
  }
  r.status = status;
  recomputeWaits();
  res.json(rideView(r));
});
app.post('/api/clock', (req, res) => {
  const { running, tickMs, spawnPerTick } = req.body || {};
  if (typeof running !== 'boolean') return bad(res, 'running must be a boolean');
  if (tickMs !== undefined && !isInt(tickMs, 100, 10000)) return bad(res, 'tickMs must be 100..10000');
  if (spawnPerTick !== undefined && !isInt(spawnPerTick, 0, 50)) return bad(res, 'spawnPerTick must be 0..50');
  if (tickMs !== undefined) sim.tickMs = tickMs;
  if (spawnPerTick !== undefined) sim.spawnPerTick = spawnPerTick;
  sim.running = running;
  running ? startClock() : stopClock();
  res.json(stateView());
});

reset(1);
if (require.main === module) app.listen(3000, () => console.log('park on :3000'));
module.exports = app;
