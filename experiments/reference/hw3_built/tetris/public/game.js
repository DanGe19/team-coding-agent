// Side Tetris - Game Logic
// Pieces enter from left/right edges and slide horizontally toward the center wall.
// Arena: 12 rows x 24 cols. Center wall between col 11 and col 12.
// Left half: cols 0-11, Right half: cols 12-23.

(function () {
  'use strict';

  // ── Seeded PRNG (mulberry32) ──────────────────────────────────────────────
  function mulberry32(seed) {
    return function () {
      seed |= 0;
      seed = seed + 0x6D2B79F5 | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = t + Math.imul(t ^ (t >>> 7), 61 | t) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // ── Tetromino definitions ─────────────────────────────────────────────────
  const PIECES = {
    I: [
      [[0,0],[0,1],[0,2],[0,3]],
      [[0,0],[1,0],[2,0],[3,0]],
      [[0,0],[0,1],[0,2],[0,3]],
      [[0,0],[1,0],[2,0],[3,0]],
    ],
    O: [
      [[0,0],[0,1],[1,0],[1,1]],
      [[0,0],[0,1],[1,0],[1,1]],
      [[0,0],[0,1],[1,0],[1,1]],
      [[0,0],[0,1],[1,0],[1,1]],
    ],
    T: [
      [[0,1],[1,0],[1,1],[1,2]],
      [[0,0],[1,0],[1,1],[2,0]],
      [[1,0],[1,1],[1,2],[2,1]],
      [[0,1],[1,0],[1,1],[2,1]],
    ],
    S: [
      [[0,1],[0,2],[1,0],[1,1]],
      [[0,0],[1,0],[1,1],[2,1]],
      [[0,1],[0,2],[1,0],[1,1]],
      [[0,0],[1,0],[1,1],[2,1]],
    ],
    Z: [
      [[0,0],[0,1],[1,1],[1,2]],
      [[0,1],[1,0],[1,1],[2,0]],
      [[0,0],[0,1],[1,1],[1,2]],
      [[0,1],[1,0],[1,1],[2,0]],
    ],
    J: [
      [[0,0],[1,0],[1,1],[1,2]],
      [[0,0],[0,1],[1,0],[2,0]],
      [[1,0],[1,1],[1,2],[2,2]],
      [[0,1],[1,1],[2,0],[2,1]],
    ],
    L: [
      [[0,2],[1,0],[1,1],[1,2]],
      [[0,0],[1,0],[2,0],[2,1]],
      [[1,0],[1,1],[1,2],[2,0]],
      [[0,0],[0,1],[1,1],[2,1]],
    ],
  };

  const PIECE_TYPES = ['I', 'O', 'T', 'S', 'Z', 'J', 'L'];

  // Scoring table: lines cleared -> base points
  const LINE_SCORES = [0, 100, 300, 500, 800];

  // ── Arena constants ───────────────────────────────────────────────────────
  const ROWS = 12;
  const COLS = 24;
  const LEFT_MAX = 11;   // last col of left half
  const RIGHT_MIN = 12;  // first col of right half

  // ── Game state ────────────────────────────────────────────────────────────
  let settled;    // 2D array [row][col] = type string or null
  let active;     // { type, cells: [[r,c],...], rotState, anchorRow, anchorCol, side }
  let nextType;   // string
  let nextSide;   // 'left' | 'right'
  let pieceCount; // how many pieces have been spawned (0-indexed)
  let score;
  let lines;
  let level;
  let paused;
  let gameOver;
  let rng;
  let bag;        // current 7-bag
  let gravityTimer;
  let testMode;

  // ── Bag randomizer ────────────────────────────────────────────────────────
  function shuffleBag() {
    const b = [...PIECE_TYPES];
    for (let i = b.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [b[i], b[j]] = [b[j], b[i]];
    }
    return b;
  }

  function nextFromBag() {
    if (!bag || bag.length === 0) bag = shuffleBag();
    return bag.shift();
  }

  // ── Piece geometry ────────────────────────────────────────────────────────
  function getCells(type, rotState, anchorRow, anchorCol) {
    const offsets = PIECES[type][rotState];
    return offsets.map(([dr, dc]) => [anchorRow + dr, anchorCol + dc]);
  }

  function bbox(cells) {
    let minR = Infinity, maxR = -Infinity, minC = Infinity, maxC = -Infinity;
    for (const [r, c] of cells) {
      if (r < minR) minR = r;
      if (r > maxR) maxR = r;
      if (c < minC) minC = c;
      if (c > maxC) maxC = c;
    }
    return { minR, maxR, minC, maxC };
  }

  // ── Spawn a piece ─────────────────────────────────────────────────────────
  function spawnPiece(type, side) {
    const rotState = 0;
    const offsets = PIECES[type][rotState];
    const bb = bbox(offsets.map(([r, c]) => [r, c]));

    // Vertically center: bounding box starts at row 4
    const anchorRow = 4 - bb.minR;

    let anchorCol;
    if (side === 'left') {
      anchorCol = 0 - bb.minC;
    } else {
      anchorCol = 23 - bb.maxC;
    }

    const cells = getCells(type, rotState, anchorRow, anchorCol);

    if (!isValidPosition(cells, side)) {
      return null;
    }

    return { type, cells, rotState, anchorRow, anchorCol, side };
  }

  // ── Collision detection ───────────────────────────────────────────────────
  function isValidPosition(cells, side) {
    for (const [r, c] of cells) {
      if (r < 0 || r >= ROWS) return false;
      if (c < 0 || c >= COLS) return false;
      if (side === 'left' && c > LEFT_MAX) return false;
      if (side === 'right' && c < RIGHT_MIN) return false;
      if (settled[r][c] !== null) return false;
    }
    return true;
  }

  // ── Gravity direction ─────────────────────────────────────────────────────
  function gravityDir(side) {
    return side === 'left' ? 1 : -1;
  }

  // ── Line clearing ─────────────────────────────────────────────────────────
  function clearLines(side) {
    const colStart = side === 'left' ? 0 : RIGHT_MIN;
    const colEnd   = side === 'left' ? LEFT_MAX : COLS - 1;

    // Find full columns
    const fullCols = [];
    for (let c = colStart; c <= colEnd; c++) {
      let full = true;
      for (let r = 0; r < ROWS; r++) {
        if (settled[r][c] === null) { full = false; break; }
      }
      if (full) fullCols.push(c);
    }

    if (fullCols.length === 0) return 0;

    // Sort: process from farthest-from-wall inward so shifts don't affect
    // the indices of remaining full columns.
    // Left side: farthest from wall = lowest col. Sort ascending.
    // Right side: farthest from wall = highest col. Sort descending.
    if (side === 'left') {
      fullCols.sort((a, b) => a - b);
    } else {
      fullCols.sort((a, b) => b - a);
    }

    for (const clearCol of fullCols) {
      if (side === 'left') {
        // Shift columns farther from wall (lower col numbers) toward wall (+1)
        for (let c = clearCol; c > colStart; c--) {
          for (let r = 0; r < ROWS; r++) {
            settled[r][c] = settled[r][c - 1];
          }
        }
        for (let r = 0; r < ROWS; r++) {
          settled[r][colStart] = null;
        }
      } else {
        // Shift columns farther from wall (higher col numbers) toward wall (-1)
        for (let c = clearCol; c < colEnd; c++) {
          for (let r = 0; r < ROWS; r++) {
            settled[r][c] = settled[r][c + 1];
          }
        }
        for (let r = 0; r < ROWS; r++) {
          settled[r][colEnd] = null;
        }
      }
    }

    return fullCols.length;
  }

  // ── Settle a piece ────────────────────────────────────────────────────────
  function settlePiece(dropScore) {
    const side = active.side;
    for (const [r, c] of active.cells) {
      settled[r][c] = active.type;
    }
    active = null;

    // Add drop score
    if (dropScore) score += dropScore;

    // Check for line clears
    const cleared = clearLines(side);
    if (cleared > 0) {
      lines += cleared;
      level = 1 + Math.floor(lines / 10);
      score += (LINE_SCORES[Math.min(cleared, 4)] || 0) * level;
      // Restart gravity with new speed
      if (!testMode && !paused) {
        startGravity();
      }
    }

    spawnNext();
  }

  function spawnNext() {
    const type = nextType;
    const side = nextSide;
    pieceCount++;
    nextType = nextFromBag();
    nextSide = (pieceCount % 2 === 0) ? 'left' : 'right';

    const piece = spawnPiece(type, side);
    if (piece === null) {
      gameOver = true;
      active = null;
      stopGravity();
    } else {
      active = piece;
    }
  }

  // ── Public API ────────────────────────────────────────────────────────────
  function reset(seed) {
    if (seed === undefined || seed === null) seed = Date.now();
    rng = mulberry32(seed);
    bag = shuffleBag();

    settled = Array.from({ length: ROWS }, () => Array(COLS).fill(null));
    score = 0;
    lines = 0;
    level = 1;
    paused = false;
    gameOver = false;
    pieceCount = 0;

    // First piece: left side
    nextType = nextFromBag();
    nextSide = 'left';

    const firstType = nextType;
    const firstSide = nextSide;
    pieceCount = 0;
    nextType = nextFromBag();
    nextSide = 'right';

    const piece = spawnPiece(firstType, firstSide);
    if (piece === null) {
      gameOver = true;
      active = null;
    } else {
      active = piece;
    }

    stopGravity();
    if (!testMode) {
      startGravity();
    }
  }

  function getState() {
    return {
      active: active ? {
        type: active.type,
        cells: active.cells.map(([r, c]) => [r, c]),
        side: active.side,
      } : null,
      next: nextType,
      nextSide: nextSide,
      settledCells: countSettled(),
      settledGrid: settled.map(row => row.slice()),
      score,
      lines,
      level,
      paused,
      gameOver,
    };
  }

  function countSettled() {
    let count = 0;
    for (let r = 0; r < ROWS; r++)
      for (let c = 0; c < COLS; c++)
        if (settled[r][c] !== null) count++;
    return count;
  }

  function shift(dir) {
    if (paused || gameOver || !active) return false;
    const newCells = active.cells.map(([r, c]) => [r + dir, c]);
    if (!isValidPosition(newCells, active.side)) return false;
    active.cells = newCells;
    active.anchorRow += dir;
    return true;
  }

  function rotate(dir) {
    if (paused || gameOver || !active) return false;
    const oldState = active.rotState;
    const newState = ((oldState + dir) % 4 + 4) % 4;
    const type = active.type;

    const tryRotate = (dr, dc) => {
      const newCells = getCells(type, newState, active.anchorRow + dr, active.anchorCol + dc);
      if (isValidPosition(newCells, active.side)) {
        active.cells = newCells;
        active.rotState = newState;
        active.anchorRow += dr;
        active.anchorCol += dc;
        return true;
      }
      return false;
    };

    if (tryRotate(0, 0)) return true;
    if (tryRotate(-1, 0)) return true;
    if (tryRotate(1, 0)) return true;
    const wallDc = gravityDir(active.side);
    if (tryRotate(0, wallDc)) return true;

    return false;
  }

  function softDrop() {
    if (paused || gameOver || !active) return false;
    const dc = gravityDir(active.side);
    const newCells = active.cells.map(([r, c]) => [r, c + dc]);
    if (!isValidPosition(newCells, active.side)) return false;
    active.cells = newCells;
    active.anchorCol += dc;
    score += 1;
    return true;
  }

  function hardDrop() {
    if (paused || gameOver || !active) return 0;
    let count = 0;
    const dc = gravityDir(active.side);
    while (true) {
      const newCells = active.cells.map(([r, c]) => [r, c + dc]);
      if (!isValidPosition(newCells, active.side)) break;
      active.cells = newCells;
      active.anchorCol += dc;
      count++;
    }
    const dropScore = count * 2;
    settlePiece(dropScore);
    return count;
  }

  function step() {
    if (paused || gameOver || !active) return false;
    const dc = gravityDir(active.side);
    const newCells = active.cells.map(([r, c]) => [r, c + dc]);
    if (!isValidPosition(newCells, active.side)) {
      settlePiece(0);
      return false;
    }
    active.cells = newCells;
    active.anchorCol += dc;
    return true;
  }

  function togglePause() {
    if (gameOver) return;
    paused = !paused;
    if (paused) {
      stopGravity();
    } else if (!testMode) {
      startGravity();
    }
  }

  // ── setupClear() test hook ────────────────────────────────────────────────
  function setupClear() {
    if (!active) return;

    const side = active.side;
    const dc = gravityDir(side);

    // Compute landing position (where hardDrop would place the piece)
    let landCells = active.cells.map(([r, c]) => [r, c]);
    while (true) {
      const next = landCells.map(([r, c]) => [r, c + dc]);
      let valid = true;
      for (const [r, c] of next) {
        if (r < 0 || r >= ROWS) { valid = false; break; }
        if (c < 0 || c >= COLS) { valid = false; break; }
        if (side === 'left' && c > LEFT_MAX) { valid = false; break; }
        if (side === 'right' && c < RIGHT_MIN) { valid = false; break; }
        if (settled[r][c] !== null) { valid = false; break; }
      }
      if (!valid) break;
      landCells = next;
    }

    // Find the column closest to the wall among landing cells
    let wallCol;
    if (side === 'left') {
      wallCol = Math.max(...landCells.map(([r, c]) => c));
    } else {
      wallCol = Math.min(...landCells.map(([r, c]) => c));
    }

    // Get the rows occupied by landing cells in that column
    const landingRows = new Set(
      landCells.filter(([r, c]) => c === wallCol).map(([r, c]) => r)
    );

    // Fill every other cell in that column with settled cells
    for (let r = 0; r < ROWS; r++) {
      if (!landingRows.has(r)) {
        if (settled[r][wallCol] === null) {
          settled[r][wallCol] = 'X';
        }
      }
    }
  }

  // ── Gravity timer ─────────────────────────────────────────────────────────
  function gravityInterval() {
    return Math.max(120, 800 - (level - 1) * 70);
  }

  function startGravity() {
    stopGravity();
    gravityTimer = setInterval(() => {
      if (!paused && !gameOver) step();
    }, gravityInterval());
  }

  function stopGravity() {
    if (gravityTimer) {
      clearInterval(gravityTimer);
      gravityTimer = null;
    }
  }

  // ── Init ──────────────────────────────────────────────────────────────────
  testMode = new URLSearchParams(window.location.search).get('test') === '1';

  window.__tetris = {
    reset,
    getState,
    shift,
    rotate,
    softDrop,
    hardDrop,
    step,
    togglePause,
    setupClear,
  };

  // Auto-start (not in test mode)
  if (!testMode) {
    reset();
  }

})();
