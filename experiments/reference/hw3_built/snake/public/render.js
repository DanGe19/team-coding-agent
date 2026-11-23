// Portal Snake - Rendering, DOM, Keyboard, Leaderboard

(function () {
  'use strict';

  const ROWS = 20;
  const COLS = 20;
  const CELL = 24;
  const W = COLS * CELL;
  const H = ROWS * CELL;

  // Colors
  const COLOR_BG = '#FFF8F0';
  const COLOR_GRID = 'rgba(200,190,220,0.25)';
  const COLOR_PORTAL_EDGE = '#C9B6F2';
  const COLOR_SNAKE_BODY = '#B5EAD7';
  const COLOR_SNAKE_HEAD = '#8DD6BE';
  const COLOR_APPLE = '#FFD6E0';
  const COLOR_GOLDEN = '#FFF1B5';
  const COLOR_GOLDEN_OUTLINE = '#E8C547';
  const COLOR_ROCK = '#D9CFC7';
  const COLOR_EYE = '#3A2A2A';

  let canvas, ctx;
  let goldenPulse = 0;
  let animFrame = null;
  let tickInterval = null;
  let domInterval = null;
  let testMode = false;

  function init() {
    testMode = new URLSearchParams(window.location.search).get('test') === '1';

    canvas = document.querySelector('#board canvas');
    if (!canvas) {
      canvas = document.createElement('canvas');
      document.getElementById('board').appendChild(canvas);
    }
    canvas.width = W;
    canvas.height = H;
    ctx = canvas.getContext('2d');

    // Keyboard
    document.addEventListener('keydown', onKey);

    // Buttons
    document.getElementById('start-btn').addEventListener('click', startGame);
    const pauseBtn = document.getElementById('pause-btn');
    if (pauseBtn) pauseBtn.addEventListener('click', () => window.__snake.togglePause());
    const restartBtn = document.getElementById('restart-btn');
    if (restartBtn) restartBtn.addEventListener('click', startGame);
    const restartOverBtn = document.getElementById('restart-over-btn');
    if (restartOverBtn) restartOverBtn.addEventListener('click', startGame);

    // Score form
    const form = document.getElementById('score-form');
    if (form) form.addEventListener('submit', onScoreSubmit);

    // Load leaderboard
    loadLeaderboard();

    // DOM update interval (50ms) for headless Chromium compatibility
    domInterval = setInterval(updateDOM, 50);

    // Start animation loop
    requestAnimationFrame(renderLoop);

    // Start game
    startGame();
  }

  function startGame() {
    window.__snake.reset();
    // Reset score form
    const form = document.getElementById('score-form');
    if (form) {
      form.reset();
      form.style.pointerEvents = '';
      const btn = form.querySelector('button[type="submit"]');
      if (btn) btn.disabled = false;
      const saved = form.querySelector('.saved-msg');
      if (saved) saved.remove();
      const errEl = form.querySelector('.form-error');
      if (errEl) errEl.textContent = '';
    }
    if (!testMode) {
      startTicking();
    }
    updateDOM();
    draw();
  }

  function startTicking() {
    stopTicking();
    const s = window.__snake.getState();
    const level = s.level;
    const interval = Math.max(60, 160 - (level - 1) * 15);
    tickInterval = setInterval(() => {
      const moved = window.__snake.step();
      const st = window.__snake.getState();
      // Adjust speed if level changed
      const newLevel = st.level;
      if (newLevel !== level) {
        startTicking();
      }
      if (st.gameOver) {
        stopTicking();
      }
      updateDOM();
      draw();
    }, interval);
  }

  function stopTicking() {
    if (tickInterval) {
      clearInterval(tickInterval);
      tickInterval = null;
    }
  }

  function onKey(e) {
    const game = window.__snake;
    const keyMap = {
      ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right',
      w: 'up', s: 'down', a: 'left', d: 'right',
      W: 'up', S: 'down', A: 'left', D: 'right',
    };
    if (keyMap[e.key]) {
      e.preventDefault();
      game.setDirection(keyMap[e.key]);
    } else if (e.key === ' ' || e.key === 'p' || e.key === 'P') {
      e.preventDefault();
      game.togglePause();
      updateDOM();
    } else if (e.key === 'r' || e.key === 'R') {
      e.preventDefault();
      startGame();
    }
  }

  function updateDOM() {
    const s = window.__snake.getState();

    // Update counters
    const scoreEl = document.getElementById('score');
    const lengthEl = document.getElementById('length');
    const levelEl = document.getElementById('level');
    if (scoreEl) scoreEl.textContent = String(s.score);
    if (lengthEl) lengthEl.textContent = String(s.length);
    if (levelEl) levelEl.textContent = String(s.level);

    // Paused overlay
    const pausedEl = document.getElementById('paused');
    if (pausedEl) pausedEl.style.display = s.paused ? 'flex' : 'none';

    // Game over overlay
    const gameOverEl = document.getElementById('game-over');
    if (gameOverEl) gameOverEl.style.display = s.gameOver ? 'flex' : 'none';

    // Update final score in game over card
    const finalScoreEl = document.getElementById('final-score');
    if (finalScoreEl) finalScoreEl.textContent = String(s.score);

    // Update speed if not test mode
    if (!testMode && tickInterval) {
      // Speed is managed by startTicking, level changes restart it
    }
  }

  function renderLoop(ts) {
    goldenPulse = (Math.sin(ts / 300) + 1) / 2;
    draw();
    animFrame = requestAnimationFrame(renderLoop);
  }

  function draw() {
    if (!ctx) return;
    const s = window.__snake.getState();

    ctx.clearRect(0, 0, W, H);

    // Background
    ctx.fillStyle = COLOR_BG;
    ctx.fillRect(0, 0, W, H);

    // Grid
    ctx.strokeStyle = COLOR_GRID;
    ctx.lineWidth = 0.5;
    for (let r = 0; r <= ROWS; r++) {
      ctx.beginPath();
      ctx.moveTo(0, r * CELL);
      ctx.lineTo(W, r * CELL);
      ctx.stroke();
    }
    for (let c = 0; c <= COLS; c++) {
      ctx.beginPath();
      ctx.moveTo(c * CELL, 0);
      ctx.lineTo(c * CELL, H);
      ctx.stroke();
    }

    // Portal edges (dashed lavender)
    ctx.strokeStyle = COLOR_PORTAL_EDGE;
    ctx.lineWidth = 2;
    ctx.setLineDash([6, 4]);
    // Top
    ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(W, 0); ctx.stroke();
    // Bottom
    ctx.beginPath(); ctx.moveTo(0, H); ctx.lineTo(W, H); ctx.stroke();
    // Left
    ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(0, H); ctx.stroke();
    // Right
    ctx.beginPath(); ctx.moveTo(W, 0); ctx.lineTo(W, H); ctx.stroke();
    ctx.setLineDash([]);

    // Rocks
    ctx.fillStyle = COLOR_ROCK;
    for (const rock of s.rocks) {
      const x = rock[1] * CELL + 2;
      const y = rock[0] * CELL + 2;
      const sz = CELL - 4;
      roundRect(ctx, x, y, sz, sz, 5);
      ctx.fill();
    }

    // Apple
    if (s.apple) {
      ctx.fillStyle = COLOR_APPLE;
      ctx.beginPath();
      const ax = s.apple[1] * CELL + CELL / 2;
      const ay = s.apple[0] * CELL + CELL / 2;
      ctx.arc(ax, ay, CELL / 2 - 2, 0, Math.PI * 2);
      ctx.fill();
    }

    // Golden apple
    if (s.golden) {
      const gx = s.golden[1] * CELL + CELL / 2;
      const gy = s.golden[0] * CELL + CELL / 2;
      const pulseR = (CELL / 2 - 2) + goldenPulse * 2;
      ctx.fillStyle = COLOR_GOLDEN;
      ctx.beginPath();
      ctx.arc(gx, gy, pulseR, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = COLOR_GOLDEN_OUTLINE;
      ctx.lineWidth = 2;
      ctx.stroke();
    }

    // Snake body (draw from tail to head so head is on top)
    for (let i = s.snake.length - 1; i >= 0; i--) {
      const cell = s.snake[i];
      const x = cell[1] * CELL + 1;
      const y = cell[0] * CELL + 1;
      const sz = CELL - 2;
      if (i === 0) {
        ctx.fillStyle = COLOR_SNAKE_HEAD;
      } else {
        ctx.fillStyle = COLOR_SNAKE_BODY;
      }
      roundRect(ctx, x, y, sz, sz, 6);
      ctx.fill();
    }

    // Eyes on head
    if (s.snake.length > 0) {
      drawEyes(s.snake[0], s.direction);
    }
  }

  function drawEyes(head, dir) {
    const cx = head[1] * CELL + CELL / 2;
    const cy = head[0] * CELL + CELL / 2;
    const eyeR = 2;
    const eyeOffset = 5;
    const eyeDist = 4;

    let e1, e2;
    if (dir === 'right') {
      e1 = [cx + eyeOffset, cy - eyeDist];
      e2 = [cx + eyeOffset, cy + eyeDist];
    } else if (dir === 'left') {
      e1 = [cx - eyeOffset, cy - eyeDist];
      e2 = [cx - eyeOffset, cy + eyeDist];
    } else if (dir === 'up') {
      e1 = [cx - eyeDist, cy - eyeOffset];
      e2 = [cx + eyeDist, cy - eyeOffset];
    } else {
      e1 = [cx - eyeDist, cy + eyeOffset];
      e2 = [cx + eyeDist, cy + eyeOffset];
    }

    ctx.fillStyle = COLOR_EYE;
    ctx.beginPath();
    ctx.arc(e1[0], e1[1], eyeR, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(e2[0], e2[1], eyeR, 0, Math.PI * 2);
    ctx.fill();
  }

  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r);
    ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
  }

  // Leaderboard
  async function loadLeaderboard() {
    try {
      const res = await fetch('/api/scores');
      const data = await res.json();
      renderLeaderboard(data);
    } catch (e) {
      console.error('Failed to load leaderboard', e);
    }
  }

  function renderLeaderboard(entries) {
    const ol = document.getElementById('leaderboard');
    if (!ol) return;
    ol.innerHTML = '';
    entries.forEach((entry) => {
      const li = document.createElement('li');
      const nameSpan = document.createElement('span');
      nameSpan.className = 'lb-name';
      nameSpan.textContent = entry.name;
      const scoreSpan = document.createElement('span');
      scoreSpan.className = 'lb-score';
      scoreSpan.textContent = String(entry.score);
      li.appendChild(nameSpan);
      li.appendChild(scoreSpan);
      ol.appendChild(li);
    });
  }

  async function onScoreSubmit(e) {
    e.preventDefault();
    const form = e.target;
    const errEl = form.querySelector('.form-error');
    if (errEl) errEl.textContent = '';

    const nameInput = form.querySelector('input[name="name"]');
    const name = nameInput ? nameInput.value : '';
    const s = window.__snake.getState();

    try {
      const res = await fetch('/api/score', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name,
          score: s.score,
          length: s.length,
          level: s.level,
        }),
      });
      if (!res.ok) {
        const data = await res.json();
        if (errEl) errEl.textContent = data.error || 'Error saving score';
        return;
      }
      // Success
      const submitBtn = form.querySelector('button[type="submit"]');
      if (submitBtn) submitBtn.disabled = true;
      form.style.pointerEvents = 'none';
      // Show saved message
      let savedMsg = form.querySelector('.saved-msg');
      if (!savedMsg) {
        savedMsg = document.createElement('p');
        savedMsg.className = 'saved-msg';
        form.appendChild(savedMsg);
      }
      savedMsg.textContent = 'Saved!';
      // Refresh leaderboard
      await loadLeaderboard();
    } catch (err) {
      if (errEl) errEl.textContent = 'Network error';
    }
  }

  // Initialize when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
