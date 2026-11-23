// Portal Snake - Game Logic
// Exposes window.__snake

(function () {
  'use strict';

  // --- Mulberry32 PRNG ---
  function mulberry32(seed) {
    return function () {
      seed |= 0;
      seed = seed + 0x6D2B79F5 | 0;
      var t = Math.imul(seed ^ seed >>> 15, 1 | seed);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }

  const ROWS = 20;
  const COLS = 20;
  const GOLDEN_TICKS = 40;

  // Game state
  let snake = [];
  let direction = 'right';
  let pendingDirection = 'right';
  let apple = null;
  let golden = null;
  let goldenTicksLeft = 0;
  let rocks = [];
  let score = 0;
  let applesEaten = 0;
  let paused = false;
  let gameOver = false;
  let rng = null;

  function wrap(r, c) {
    return [(r + ROWS) % ROWS, (c + COLS) % COLS];
  }

  function cellKey(cell) {
    return cell[0] * 100 + cell[1];
  }

  function cellsEqual(a, b) {
    return a[0] === b[0] && a[1] === b[1];
  }

  function randomFreeCell(excludeSet) {
    // Build list of free cells
    const free = [];
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        const k = r * 100 + c;
        if (!excludeSet.has(k)) {
          free.push([r, c]);
        }
      }
    }
    if (free.length === 0) return null;
    const idx = Math.floor(rng() * free.length);
    return free[idx];
  }

  function occupiedSet(includeGolden) {
    const s = new Set();
    for (const cell of snake) s.add(cellKey(cell));
    for (const cell of rocks) s.add(cellKey(cell));
    if (includeGolden && golden) s.add(cellKey(golden));
    return s;
  }

  function placeApple() {
    const occ = occupiedSet(true);
    if (apple) occ.add(cellKey(apple)); // don't place on current apple position (it will be replaced)
    // Actually we want to place on a free cell (not snake, not rocks, not golden)
    const occ2 = occupiedSet(true);
    apple = randomFreeCell(occ2);
  }

  function reset(seed) {
    if (seed === undefined || seed === null) {
      seed = Date.now();
    }
    rng = mulberry32(seed);

    snake = [[10, 10], [10, 9], [10, 8], [10, 7]];
    direction = 'right';
    pendingDirection = 'right';
    golden = null;
    goldenTicksLeft = 0;
    rocks = [];
    score = 0;
    applesEaten = 0;
    paused = false;
    gameOver = false;

    // Place initial apple
    const occ = new Set();
    for (const cell of snake) occ.add(cellKey(cell));
    apple = randomFreeCell(occ);
  }

  function getState() {
    return {
      snake: snake.map(c => [c[0], c[1]]),
      direction: direction,
      apple: apple ? [apple[0], apple[1]] : null,
      golden: golden ? [golden[0], golden[1]] : null,
      goldenTicksLeft: goldenTicksLeft,
      rocks: rocks.map(c => [c[0], c[1]]),
      score: score,
      applesEaten: applesEaten,
      length: snake.length,
      level: 1 + Math.floor(applesEaten / 5),
      paused: paused,
      gameOver: gameOver,
    };
  }

  function setDirection(dir) {
    if (paused || gameOver) return false;
    const opposites = { up: 'down', down: 'up', left: 'right', right: 'left' };
    if (opposites[dir] === direction) return false;
    pendingDirection = dir;
    return true;
  }

  function nextHead(dir) {
    const head = snake[0];
    let r = head[0], c = head[1];
    if (dir === 'up') r--;
    else if (dir === 'down') r++;
    else if (dir === 'left') c--;
    else if (dir === 'right') c++;
    return wrap(r, c);
  }

  function step() {
    if (paused || gameOver) return false;

    direction = pendingDirection;
    const head = nextHead(direction);

    // Check collision with rocks
    for (const rock of rocks) {
      if (cellsEqual(head, rock)) {
        gameOver = true;
        return true;
      }
    }

    // Determine if eating
    const eatingApple = apple && cellsEqual(head, apple);
    const eatingGolden = golden && cellsEqual(head, golden);
    const eating = eatingApple || eatingGolden;

    // Check collision with body (tail will be removed unless eating)
    const bodyToCheck = eating ? snake : snake.slice(0, snake.length - 1);
    for (const cell of bodyToCheck) {
      if (cellsEqual(head, cell)) {
        gameOver = true;
        return true;
      }
    }

    // Move snake
    snake.unshift(head);
    if (!eating) {
      snake.pop();
    }

    // Handle golden apple countdown
    if (golden && !eatingGolden) {
      goldenTicksLeft--;
      if (goldenTicksLeft <= 0) {
        golden = null;
        goldenTicksLeft = 0;
      }
    }

    // Handle eating
    if (eatingApple) {
      score += 1;
      applesEaten += 1;

      // Every 5th apple: spawn golden apple and rock
      if (applesEaten % 5 === 0) {
        // Place golden apple
        const occ = occupiedSet(false);
        // Don't place on current apple position (we'll place new apple after)
        golden = randomFreeCell(occ);
        goldenTicksLeft = GOLDEN_TICKS;

        // Place rock: must be at least 3 Manhattan distance from head
        const head2 = snake[0];
        const occ2 = occupiedSet(true);
        // Also exclude apple position
        if (apple) occ2.add(cellKey(apple));
        const candidates = [];
        for (let r = 0; r < ROWS; r++) {
          for (let c = 0; c < COLS; c++) {
            const k = r * 100 + c;
            if (!occ2.has(k)) {
              const dist = Math.abs(r - head2[0]) + Math.abs(c - head2[1]);
              if (dist >= 3) {
                candidates.push([r, c]);
              }
            }
          }
        }
        if (candidates.length > 0) {
          const idx = Math.floor(rng() * candidates.length);
          rocks.push(candidates[idx]);
        }
      }

      // Place new apple
      const occ3 = occupiedSet(true);
      apple = randomFreeCell(occ3);
    }

    if (eatingGolden) {
      score += 5;
      golden = null;
      goldenTicksLeft = 0;
    }

    return true;
  }

  function togglePause() {
    if (gameOver) return;
    paused = !paused;
  }

  function setupEat() {
    // Move apple to cell directly in front of head
    const head = nextHead(direction);
    apple = [head[0], head[1]];
  }

  // Expose interface
  window.__snake = {
    reset,
    getState,
    setDirection,
    step,
    togglePause,
    setupEat,
  };

})();
