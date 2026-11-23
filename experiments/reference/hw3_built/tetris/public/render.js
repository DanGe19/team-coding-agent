// Side Tetris - Rendering and Keyboard Handling

(function () {
  'use strict';

  const ROWS = 12;
  const COLS = 24;
  const CELL = 28;
  const LEFT_MAX = 11;
  const RIGHT_MIN = 12;

  // Pastel colors per piece type
  const COLORS = {
    I: '#B5EAD7',
    O: '#FFF1B5',
    T: '#E2D5F8',
    S: '#D4F0C0',
    Z: '#FFD6E0',
    J: '#C7E6FF',
    L: '#FFDAC1',
    X: '#D0C0E0', // placeholder for setupClear cells
  };

  // Slightly darker settled colors
  const SETTLED_COLORS = {
    I: '#7DD4B8',
    O: '#F0D870',
    T: '#C4A8F0',
    S: '#A8D890',
    Z: '#F0A0B8',
    J: '#88C4F0',
    L: '#F0B090',
    X: '#A090C0',
  };

  const GRID_COLOR = '#E8D8C8';
  const WALL_COLOR = '#C9B6F2';
  const BG_COLOR = '#FFF8F0';
  const GHOST_COLOR = 'rgba(180,160,220,0.25)';

  let canvas, ctx;
  let nextCanvas, nextCtx;

  // Track the last submitted entry id for highlighting
  let lastSubmittedId = null;

  function init() {
    canvas = document.getElementById('board-canvas');
    if (!canvas) return;
    ctx = canvas.getContext('2d');
    canvas.width = COLS * CELL;
    canvas.height = ROWS * CELL;

    nextCanvas = document.getElementById('next-canvas');
    if (nextCanvas) {
      nextCtx = nextCanvas.getContext('2d');
      nextCanvas.width = 6 * CELL;
      nextCanvas.height = 6 * CELL;
    }

    setupKeyboard();
    setupScoreForm();
    requestAnimationFrame(loop);
    // Fallback interval for headless/test environments where rAF may not fire
    setInterval(() => {
      if (window.__tetris) updateUI(window.__tetris.getState());
    }, 50);

    // Load leaderboard on page load
    fetchLeaderboard();
  }

  function loop() {
    draw();
    requestAnimationFrame(loop);
  }

  function draw() {
    if (!window.__tetris) return;
    const state = window.__tetris.getState();
    drawBoard(state);
    drawNext(state);
    updateUI(state);
  }

  function drawBoard(state) {
    if (!ctx) return;
    const W = COLS * CELL;
    const H = ROWS * CELL;

    // Background
    ctx.fillStyle = BG_COLOR;
    ctx.fillRect(0, 0, W, H);

    // Grid lines
    ctx.strokeStyle = GRID_COLOR;
    ctx.lineWidth = 0.5;
    for (let r = 0; r <= ROWS; r++) {
      ctx.beginPath();
      ctx.moveTo(0, r * CELL);
      ctx.lineTo(W, r * CELL);
      ctx.stroke();
    }
    for (let c = 0; c <= COLS; c++) {
      if (c === LEFT_MAX + 1) continue; // skip wall position
      ctx.beginPath();
      ctx.moveTo(c * CELL, 0);
      ctx.lineTo(c * CELL, H);
      ctx.stroke();
    }

    // Center wall
    ctx.fillStyle = WALL_COLOR;
    ctx.fillRect((LEFT_MAX + 1) * CELL - 3, 0, 6, H);

    // Settled cells (using settledGrid from state)
    if (state.settledGrid) {
      for (let r = 0; r < ROWS; r++) {
        for (let c = 0; c < COLS; c++) {
          const type = state.settledGrid[r][c];
          if (type !== null) {
            const color = SETTLED_COLORS[type] || '#AAA';
            drawCell(ctx, r, c, color);
          }
        }
      }
    }

    // Draw ghost piece
    if (state.active && state.settledGrid) {
      const ghost = computeGhost(state.active, state.settledGrid);
      if (ghost) {
        for (const [r, c] of ghost) {
          ctx.fillStyle = GHOST_COLOR;
          ctx.beginPath();
          if (ctx.roundRect) {
            ctx.roundRect(c * CELL + 1, r * CELL + 1, CELL - 2, CELL - 2, 4);
          } else {
            ctx.rect(c * CELL + 1, r * CELL + 1, CELL - 2, CELL - 2);
          }
          ctx.fill();
        }
      }
    }

    // Active piece
    if (state.active) {
      const color = COLORS[state.active.type] || '#CCC';
      for (const [r, c] of state.active.cells) {
        drawCell(ctx, r, c, color);
      }
    }

    // Game over overlay (dim the board)
    if (state.gameOver) {
      ctx.fillStyle = 'rgba(0,0,0,0.35)';
      ctx.fillRect(0, 0, W, H);
    }
  }

  function drawCell(context, r, c, color) {
    context.fillStyle = color;
    context.beginPath();
    if (context.roundRect) {
      context.roundRect(c * CELL + 1, r * CELL + 1, CELL - 2, CELL - 2, 4);
    } else {
      context.rect(c * CELL + 1, r * CELL + 1, CELL - 2, CELL - 2);
    }
    context.fill();
  }

  function computeGhost(active, settledGrid) {
    if (!active) return null;
    const side = active.side;
    const dc = side === 'left' ? 1 : -1;
    let cells = active.cells.map(([r, c]) => [r, c]);
    while (true) {
      const next = cells.map(([r, c]) => [r, c + dc]);
      if (!isValidGhost(next, side, settledGrid)) break;
      cells = next;
    }
    // Only show ghost if it's different from active
    const activeKey = active.cells.map(([r,c]) => `${r},${c}`).sort().join('|');
    const ghostKey = cells.map(([r,c]) => `${r},${c}`).sort().join('|');
    if (activeKey === ghostKey) return null;
    return cells;
  }

  function isValidGhost(cells, side, settledGrid) {
    for (const [r, c] of cells) {
      if (r < 0 || r >= ROWS) return false;
      if (c < 0 || c >= COLS) return false;
      if (side === 'left' && c > LEFT_MAX) return false;
      if (side === 'right' && c < RIGHT_MIN) return false;
      if (settledGrid && settledGrid[r][c] !== null) return false;
    }
    return true;
  }

  function drawNext(state) {
    if (!nextCtx) return;
    const W = nextCanvas.width;
    const H = nextCanvas.height;
    nextCtx.fillStyle = BG_COLOR;
    nextCtx.fillRect(0, 0, W, H);

    if (!state.next) return;
    const type = state.next;
    const offsets = getRotState0(type);
    const bb = bboxOffsets(offsets);
    const pieceW = bb.maxC - bb.minC + 1;
    const pieceH = bb.maxR - bb.minR + 1;
    const startC = Math.floor((6 - pieceW) / 2) - bb.minC;
    const startR = Math.floor((6 - pieceH) / 2) - bb.minR;

    const color = COLORS[type] || '#CCC';
    for (const [dr, dc] of offsets) {
      const r = startR + dr;
      const c = startC + dc;
      drawCell(nextCtx, r, c, color);
    }

    // Arrow showing which side
    const side = state.nextSide;
    nextCtx.fillStyle = '#9B8EC4';
    nextCtx.font = 'bold 13px Nunito, sans-serif';
    nextCtx.textAlign = 'center';
    nextCtx.fillText(side === 'left' ? '← Left' : 'Right →', W / 2, H - 6);
  }

  function getRotState0(type) {
    const PIECES_ROT0 = {
      I: [[0,0],[0,1],[0,2],[0,3]],
      O: [[0,0],[0,1],[1,0],[1,1]],
      T: [[0,1],[1,0],[1,1],[1,2]],
      S: [[0,1],[0,2],[1,0],[1,1]],
      Z: [[0,0],[0,1],[1,1],[1,2]],
      J: [[0,0],[1,0],[1,1],[1,2]],
      L: [[0,2],[1,0],[1,1],[1,2]],
    };
    return PIECES_ROT0[type] || [];
  }

  function bboxOffsets(offsets) {
    let minR = Infinity, maxR = -Infinity, minC = Infinity, maxC = -Infinity;
    for (const [r, c] of offsets) {
      if (r < minR) minR = r;
      if (r > maxR) maxR = r;
      if (c < minC) minC = c;
      if (c > maxC) maxC = c;
    }
    return { minR, maxR, minC, maxC };
  }

  function updateUI(state) {
    const scoreEl = document.getElementById('score');
    const linesEl = document.getElementById('lines');
    const levelEl = document.getElementById('level');
    const pausedEl = document.getElementById('paused');
    const gameOverEl = document.getElementById('game-over');
    const finalScoreEl = document.getElementById('final-score');

    if (scoreEl) scoreEl.textContent = state.score;
    if (linesEl) linesEl.textContent = state.lines;
    if (levelEl) levelEl.textContent = state.level;
    if (pausedEl) pausedEl.style.display = state.paused ? 'flex' : 'none';
    if (gameOverEl) gameOverEl.style.display = state.gameOver ? 'flex' : 'none';
    if (finalScoreEl && state.gameOver) finalScoreEl.textContent = state.score;
  }

  // ── Leaderboard ───────────────────────────────────────────────────────────
  function fetchLeaderboard() {
    fetch('/api/scores')
      .then(r => r.json())
      .then(entries => renderLeaderboard(entries))
      .catch(() => {});
  }

  function renderLeaderboard(entries) {
    const ol = document.getElementById('leaderboard');
    const noScores = document.getElementById('no-scores');
    if (!ol) return;

    // Clear existing entries
    while (ol.firstChild) ol.removeChild(ol.firstChild);

    if (!entries || entries.length === 0) {
      if (noScores) noScores.style.display = '';
      return;
    }

    if (noScores) noScores.style.display = 'none';

    for (const entry of entries) {
      const li = document.createElement('li');

      const nameSpan = document.createElement('span');
      nameSpan.className = 'lb-name';
      nameSpan.textContent = entry.name;

      const scoreSpan = document.createElement('span');
      scoreSpan.className = 'lb-score';
      scoreSpan.textContent = entry.score;

      li.appendChild(nameSpan);
      li.appendChild(scoreSpan);

      // Highlight the just-submitted entry
      if (lastSubmittedId !== null && entry.id === lastSubmittedId) {
        li.style.background = '#B5EAD7';
      }

      ol.appendChild(li);
    }
  }

  // ── Score form ────────────────────────────────────────────────────────────
  function setupScoreForm() {
    const form = document.getElementById('score-form');
    if (!form) return;

    const nameInput = form.querySelector('input[name="name"]');
    const saveStatus = document.getElementById('save-status');

    // Prefill from localStorage
    if (nameInput) {
      const savedName = localStorage.getItem('tetris_player_name');
      if (savedName) nameInput.value = savedName;
    }

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (!window.__tetris) return;

      const state = window.__tetris.getState();
      const name = nameInput ? nameInput.value : '';

      // Save name to localStorage
      if (nameInput && nameInput.value) {
        localStorage.setItem('tetris_player_name', nameInput.value);
      }

      // Clear previous status
      if (saveStatus) saveStatus.textContent = '';

      try {
        const response = await fetch('/api/score', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name,
            score: state.score,
            lines: state.lines,
            level: state.level,
          }),
        });

        const data = await response.json();

        if (!response.ok) {
          if (saveStatus) saveStatus.textContent = data.error || 'Error saving score';
          return;
        }

        // Success: disable form, show Saved!, refresh leaderboard
        lastSubmittedId = data.id;
        if (form) {
          const submitBtn = form.querySelector('button[type="submit"]');
          if (submitBtn) submitBtn.disabled = true;
          if (nameInput) nameInput.disabled = true;
        }
        if (saveStatus) saveStatus.textContent = 'Saved!';

        // Refresh leaderboard without reloading
        fetchLeaderboard();
      } catch (err) {
        if (saveStatus) saveStatus.textContent = 'Network error';
      }
    });
  }

  function setupKeyboard() {
    document.addEventListener('keydown', (e) => {
      if (!window.__tetris) return;
      const state = window.__tetris.getState();
      switch (e.key) {
        case 'ArrowUp':
          e.preventDefault();
          window.__tetris.shift(-1);
          break;
        case 'ArrowDown':
          e.preventDefault();
          window.__tetris.shift(1);
          break;
        case 'ArrowRight':
          e.preventDefault();
          if (state.active && state.active.side === 'left') {
            window.__tetris.softDrop();
          }
          break;
        case 'ArrowLeft':
          e.preventDefault();
          if (state.active && state.active.side === 'right') {
            window.__tetris.softDrop();
          }
          break;
        case 'z':
        case 'Z':
          window.__tetris.rotate(-1);
          break;
        case 'x':
        case 'X':
          window.__tetris.rotate(1);
          break;
        case ' ':
          e.preventDefault();
          window.__tetris.hardDrop();
          break;
        case 'p':
        case 'P':
          window.__tetris.togglePause();
          break;
        case 'r':
        case 'R':
          window.__tetris.reset();
          break;
      }
    });
  }

  // Button handlers
  document.addEventListener('DOMContentLoaded', () => {
    const startBtn = document.getElementById('start-btn');
    const pauseBtn = document.getElementById('pause-btn');
    const restartBtn = document.getElementById('restart-btn');
    const restartOverlayBtn = document.getElementById('restart-overlay-btn');
    const resumeBtn = document.getElementById('resume-btn');

    if (startBtn) startBtn.addEventListener('click', () => {
      if (window.__tetris) {
        lastSubmittedId = null;
        resetScoreForm();
        window.__tetris.reset();
      }
    });
    if (pauseBtn) pauseBtn.addEventListener('click', () => window.__tetris && window.__tetris.togglePause());
    if (restartBtn) restartBtn.addEventListener('click', () => {
      if (window.__tetris) {
        lastSubmittedId = null;
        resetScoreForm();
        window.__tetris.reset();
      }
    });
    if (restartOverlayBtn) restartOverlayBtn.addEventListener('click', () => {
      if (window.__tetris) {
        lastSubmittedId = null;
        resetScoreForm();
        window.__tetris.reset();
      }
    });
    if (resumeBtn) resumeBtn.addEventListener('click', () => window.__tetris && window.__tetris.togglePause());

    init();
  });

  function resetScoreForm() {
    const form = document.getElementById('score-form');
    const saveStatus = document.getElementById('save-status');
    if (!form) return;
    const nameInput = form.querySelector('input[name="name"]');
    const submitBtn = form.querySelector('button[type="submit"]');
    if (nameInput) nameInput.disabled = false;
    if (submitBtn) submitBtn.disabled = false;
    if (saveStatus) saveStatus.textContent = '';
    // Restore saved name
    if (nameInput) {
      const savedName = localStorage.getItem('tetris_player_name');
      if (savedName) nameInput.value = savedName;
      else nameInput.value = '';
    }
  }

})();
