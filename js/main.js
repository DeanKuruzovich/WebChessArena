'use strict';
// =============================================================================
// main.js — Canvas renderer, drag-and-drop input, UI, Block Blast VFX
// =============================================================================

(async () => {

  // ---------------------------------------------------------------------------
  // Canvas setup — DPR-aware for crisp Retina/HiDPI rendering
  // ---------------------------------------------------------------------------
  const canvas  = document.getElementById('board');
  const ctx     = canvas.getContext('2d');
  const DPR = Math.min(window.devicePixelRatio || 1, 3);
  const CANVAS_LOGICAL = 560;
  canvas.width  = Math.round(CANVAS_LOGICAL * DPR);
  canvas.height = Math.round(CANVAS_LOGICAL * DPR);
  ctx.scale(DPR, DPR);

  // ---------------------------------------------------------------------------
  // Asset loading
  // ---------------------------------------------------------------------------
  function loadImage(src) {
    return new Promise(res => {
      const img = new Image();
      img.onload  = () => res(img);
      img.onerror = () => res(null);
      img.src = src;
    });
  }

  const boardImg    = await loadImage('Assets/Chess kit (Community).png');
  const spriteImg    = await loadImage('Assets/Chess_Pieces_Sprite.svg');
  const sparkleImg   = await loadImage('Assets/star.svg');
  const cloudoverImg = await loadImage('Assets/cloudover1.png');

  // Audio
  function loadAudio(src) {
    const a = new Audio(src);
    a.preload = 'auto';
    return a;
  }
  const sndCapture = loadAudio('Assets/sounds/capture.mp3');
  const sndMove    = loadAudio('Assets/sounds/move-self.mp3');
  let soundVolume = 0.65;
  function playSound(snd) {
    try { const s = snd.cloneNode(); s.volume = soundVolume; s.play().catch(()=>{}); } catch(e) {}
  }

  // Sprite sheet: 270×90, 6 cols × 2 rows, each cell 45×45
  // Sprite row 0 = white-looking pieces, row 1 = black-looking pieces
  // Column order: K=0  Q=1  B=2  N=3  R=4  P=5
  const SPRITE_CELL = 45;
  const SPRITE_COLS = { k:0, q:1, b:2, n:3, r:4, p:5,
                        K:0, Q:1, B:2, N:3, R:4, P:5 };
  // playerPieceRow: 1 = player pieces look black (default), 0 = player pieces look white
  let playerPieceRow = 1;

  function getSpriteRow(type) {
    // UPPERCASE = player pieces, lowercase = AI pieces
    return (type === type.toUpperCase()) ? playerPieceRow : (1 - playerPieceRow);
  }

  function drawPieceSprite(type, dx, dy, dw, dh) {
    if (!spriteImg) return;
    const col = SPRITE_COLS[type];
    if (col === undefined) return;
    const sx = col * SPRITE_CELL;
    const sy = getSpriteRow(type) * SPRITE_CELL;
    ctx.drawImage(spriteImg, sx, sy, SPRITE_CELL, SPRITE_CELL, dx, dy, dw, dh);
  }

  // ---------------------------------------------------------------------------
  // Board geometry (matches original: 43px margin, 280px/square in a 2321px image)
  // ---------------------------------------------------------------------------
  const MARGIN_FRAC  = 43  / 2321;
  const SQUARE_FRAC  = 280 / 2321;
  const MARGIN       = CANVAS_LOGICAL * MARGIN_FRAC;
  const SQUARE       = CANVAS_LOGICAL * SQUARE_FRAC;

  function boardToCanvas(col, row) {
    return [MARGIN + col * SQUARE + SQUARE / 2,
            MARGIN + row * SQUARE + SQUARE / 2];
  }

  function canvasToBoard(cx, cy) {
    return [Math.floor((cx - MARGIN) / SQUARE),
            Math.floor((cy - MARGIN) / SQUARE)];
  }

  // ---------------------------------------------------------------------------
  // Drag state
  // ---------------------------------------------------------------------------
  let dragging  = null;
  let highlighted = [];
  let shiftHeld   = false;

  // ---------------------------------------------------------------------------
  // Animation timing
  // ---------------------------------------------------------------------------
  const ANIM_MS  = 450;
  let   lastTs   = 0;

  // ---------------------------------------------------------------------------
  // Score count-up display
  // ---------------------------------------------------------------------------
  let displayScore = 0;
  let targetScore  = 0;
  const scoreEl    = document.getElementById('scoreLabel');
  const highEl     = document.getElementById('highScoreLabel');
  const moveEl     = document.getElementById('moveLabel'); // may be null

  function updateScoreDisplay(dtSec) {
    if (displayScore === targetScore) return;
    // Count up at a speed proportional to the gap (min 4 pts/sec), max 8× per sec
    const gap  = targetScore - displayScore;
    const step = Math.max(1, Math.abs(gap) * Math.min(dtSec * 10, 1));
    displayScore = gap > 0
      ? Math.min(targetScore, displayScore + step)
      : Math.max(targetScore, displayScore - step);
    scoreEl.textContent = Math.floor(displayScore).toLocaleString();
  }

  // ---------------------------------------------------------------------------
  // Clock
  // ---------------------------------------------------------------------------
  let clockSeconds = 0;
  let clockRunning = false;
  let showClock    = false;
  const clockEl    = document.getElementById('clockLabel');

  function formatClock(secs) {
    const m = Math.floor(secs / 60);
    const s = Math.floor(secs % 60);
    return `${m}:${String(s).padStart(2, '0')}`;
  }

  function updateClock(dtSec) {
    if (!clockRunning) return;
    clockSeconds += dtSec;
    if (showClock) clockEl.textContent = formatClock(clockSeconds);
  }

  function resetClock() {
    clockSeconds = 0;
    clockRunning = true;
    if (showClock) clockEl.textContent = '0:00';
  }

  // ===========================================================================
  // VFX SYSTEMS — Block Blast-style juice
  // ===========================================================================

  // --- Color palettes per quality tier ---
  const TIER_COLORS = {
    brilliant: { primary: '#00FFFF', secondary: '#FFFFFF', glow: 'rgba(0,255,255,0.4)' },
    great:     { primary: '#FFD700', secondary: '#FFA500', glow: 'rgba(255,215,0,0.4)' },
    good:      { primary: '#66FF66', secondary: '#33CC33', glow: 'rgba(102,255,102,0.3)' },
    nice:      { primary: '#6699FF', secondary: '#3366CC', glow: 'rgba(102,153,255,0.3)' },
  };

  const CAPTURE_COLORS = ['#FF6B6B', '#FFD93D', '#6BCB77', '#4D96FF', '#FF922B', '#CC5DE8'];

  // --- 1. PARTICLES ---
  const particles = [];

  function spawnParticles(cx, cy, count, colors, opts = {}) {
    const speed   = opts.speed   || 180;
    const sizeMin = opts.sizeMin || 3;
    const sizeMax = opts.sizeMax || 7;
    const gravity = opts.gravity ?? 100;
    const decay   = opts.decay   || 0.7;
    for (let i = 0; i < count; i++) {
      const angle = Math.random() * Math.PI * 2;
      const vel   = (0.5 + Math.random() * 0.5) * speed;
      particles.push({
        x: cx, y: cy,
        vx: Math.cos(angle) * vel,
        vy: Math.sin(angle) * vel - (opts.upBias || 30),
        size: sizeMin + Math.random() * (sizeMax - sizeMin),
        color: Array.isArray(colors) ? colors[Math.floor(Math.random() * colors.length)] : colors,
        life: 1.0,
        decay: decay + Math.random() * 0.3,
        gravity,
        rotation: Math.random() * Math.PI * 2,
        rotSpeed: (Math.random() - 0.5) * 8,
        shape: opts.shape || (Math.random() > 0.5 ? 'square' : 'circle'),
      });
    }
  }

  function updateParticles(dtSec) {
    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];
      p.life -= p.decay * dtSec;
      if (p.life <= 0) { particles.splice(i, 1); continue; }
      p.vy += p.gravity * dtSec;
      p.x  += p.vx * dtSec;
      p.y  += p.vy * dtSec;
      p.rotation += p.rotSpeed * dtSec;
    }
  }

  function drawParticles() {
    for (const p of particles) {
      ctx.save();
      ctx.globalAlpha = Math.max(0, p.life);
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rotation);
      ctx.fillStyle = p.color;
      const s = p.size * (0.5 + 0.5 * p.life);
      if (p.shape === 'circle') {
        ctx.beginPath();
        ctx.arc(0, 0, s / 2, 0, Math.PI * 2);
        ctx.fill();
      } else {
        ctx.fillRect(-s / 2, -s / 2, s, s);
      }
      ctx.restore();
    }
  }

  // --- 2. FLOATING TEXT ---
  const floatingTexts = [];

  function spawnFloatingText(cx, cy, text, color, size = 18) {
    floatingTexts.push({
      x: cx, y: cy, startY: cy,
      text, color, size,
      life: 1.0,
      duration: 1.2,
      t: 0,
    });
  }

  function updateFloatingTexts(dtSec) {
    for (let i = floatingTexts.length - 1; i >= 0; i--) {
      const ft = floatingTexts[i];
      ft.t += dtSec;
      const progress = ft.t / ft.duration;
      if (progress >= 1) { floatingTexts.splice(i, 1); continue; }
      ft.life = 1 - progress;
      ft.y = ft.startY - 45 * Math.pow(progress, 0.4);
    }
  }

  function drawFloatingTexts() {
    for (const ft of floatingTexts) {
      ctx.save();
      ctx.globalAlpha = Math.min(1, ft.life * 2);
      const isPointsText = /^\+\d+\s+points$/i.test(ft.text);
      ctx.font = isPointsText
        ? `${ft.size}px "Times New Roman", Times, serif`
        : `bold ${ft.size}px "Segoe UI", Arial, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = ft.color;
      ctx.fillText(ft.text, ft.x, ft.y);
      ctx.restore();
    }
  }

  // --- 3. SCREEN SHAKE ---
  let shakeAmount = 0;
  const SHAKE_DECAY = 12;

  function triggerShake(amount) {
    shakeAmount = Math.max(shakeAmount, amount);
  }

  function updateShake(dtSec) {
    shakeAmount *= Math.exp(-SHAKE_DECAY * dtSec);
    if (shakeAmount < 0.3) shakeAmount = 0;
  }

  function getShakeOffset() {
    if (shakeAmount <= 0) return [0, 0];
    return [
      (Math.random() - 0.5) * 2 * shakeAmount,
      (Math.random() - 0.5) * 2 * shakeAmount,
    ];
  }

  // --- 4. SCREEN FLASH ---
  let flashAlpha = 0;
  let flashColor = '#FFFFFF';

  function triggerFlash(color = '#FFFFFF', alpha = 0.35) {
    flashColor = color;
    flashAlpha = Math.max(flashAlpha, alpha);
  }

  function updateFlash(dtSec) {
    flashAlpha -= dtSec * 2.5;
    if (flashAlpha < 0) flashAlpha = 0;
  }

  function drawFlash() {
    if (flashAlpha <= 0) return;
    ctx.save();
    ctx.globalAlpha = flashAlpha;
    ctx.fillStyle = flashColor;
    ctx.fillRect(0, 0, CANVAS_LOGICAL, CANVAS_LOGICAL);
    ctx.restore();
  }

  // --- 5. SHOCKWAVES ---
  const shockwaves = [];

  function spawnShockwave(cx, cy, maxRadius = 80, color = '#FFD700') {
    shockwaves.push({
      x: cx, y: cy,
      radius: 0, maxRadius,
      color, life: 1.0,
      duration: 0.5,
      t: 0,
    });
  }

  function updateShockwaves(dtSec) {
    for (let i = shockwaves.length - 1; i >= 0; i--) {
      const sw = shockwaves[i];
      sw.t += dtSec;
      const progress = sw.t / sw.duration;
      if (progress >= 1) { shockwaves.splice(i, 1); continue; }
      sw.radius = sw.maxRadius * Math.pow(progress, 0.5);
      sw.life = 1 - progress;
    }
  }

  function drawShockwaves() {
    for (const sw of shockwaves) {
      ctx.save();
      ctx.globalAlpha = sw.life * 0.6;
      ctx.strokeStyle = sw.color;
      ctx.lineWidth = 3 * sw.life;
      ctx.beginPath();
      ctx.arc(sw.x, sw.y, sw.radius, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }
  }

  // --- 6. SPLASH TEXT (bouncy center text for move quality) ---
  const splashTexts = [];

  function spawnSplashText(text, color, size = 38) {
    // Remove any existing splash so they don't stack
    splashTexts.length = 0;
    splashTexts.push({
      text, color, size,
      scale: 0,
      y: CANVAS_LOGICAL * 0.32,
      growDur: 0.18,
      holdDur: 1.2,
      shrinkDur: 0.25,
      t: 0,
      totalDur: 0.18 + 1.2 + 0.25,
    });
  }

  function elasticOut(t) {
    if (t === 0 || t === 1) return t;
    return Math.pow(2, -10 * t) * Math.sin((t - 0.075) * (2 * Math.PI) / 0.3) + 1;
  }

  // ---------------------------------------------------------------------------
  // Promotion choice menu (shown when player holds Shift and promotes a pawn)
  // ---------------------------------------------------------------------------
  const PROMO_PIECES = ['Q', 'R', 'B', 'N'];
  let promotionMenu  = null; // { fromCol, fromRow, toCol, toRow, isEP, slots }

  function roundRect(rc, x, y, w, h, r) {
    rc.beginPath();
    rc.moveTo(x + r, y);
    rc.lineTo(x + w - r, y);
    rc.arcTo(x + w, y,     x + w, y + r,     r);
    rc.lineTo(x + w, y + h - r);
    rc.arcTo(x + w, y + h, x + w - r, y + h, r);
    rc.lineTo(x + r, y + h);
    rc.arcTo(x,      y + h, x,       y + h - r, r);
    rc.lineTo(x,     y + r);
    rc.arcTo(x,      y,     x + r,   y,         r);
    rc.closePath();
  }

  function showPromotionMenu(fromCol, fromRow, toCol, toRow, isEP) {
    const slotSize = Math.round(SQUARE * 1.05);
    const padding  = 5;
    const menuW    = slotSize + padding * 2;
    const menuH    = slotSize * 4 + padding * 5;
    const [bx, by] = boardToCanvas(toCol, toRow);
    let menuX = bx - menuW / 2;
    let menuY = by - padding;
    menuX = Math.max(4, Math.min(CANVAS_LOGICAL - menuW - 4, menuX));
    menuY = Math.max(4, Math.min(CANVAS_LOGICAL - menuH - 4, menuY));
    promotionMenu = {
      fromCol, fromRow, toCol, toRow, isEP,
      x: menuX, y: menuY, w: menuW, h: menuH,
      hoveredIdx: -1,
      slots: PROMO_PIECES.map((type, i) => ({
        type,
        x: menuX + padding,
        y: menuY + padding + i * (slotSize + padding),
        w: slotSize, h: slotSize,
      })),
    };
  }

  function drawPromotionMenu() {
    if (!promotionMenu) return;
    const m = promotionMenu;
    ctx.save();
    // Backdrop
    ctx.fillStyle = 'rgba(15, 15, 30, 0.94)';
    ctx.strokeStyle = '#FFD700';
    ctx.lineWidth = 2;
    roundRect(ctx, m.x, m.y, m.w, m.h, 9);
    ctx.fill();
    ctx.stroke();
    // Slots
    for (let i = 0; i < m.slots.length; i++) {
      const slot = m.slots[i];
      const hovered = (m.hoveredIdx === i);
      ctx.fillStyle = hovered ? 'rgba(255,215,0,0.22)' : 'rgba(255,255,255,0.06)';
      roundRect(ctx, slot.x, slot.y, slot.w, slot.h, 6);
      ctx.fill();
      drawPieceSprite(slot.type, slot.x + 3, slot.y + 3, slot.w - 6, slot.h - 6);
    }
    // Title label
    ctx.font = 'bold 11px "Segoe UI", Arial, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillStyle = 'rgba(255,255,255,0.5)';
    ctx.fillText('PROMOTE', m.x + m.w / 2, m.y + 2);
    ctx.restore();
  }

  function updateSplashTexts(dtSec) {
    for (let i = splashTexts.length - 1; i >= 0; i--) {
      const st = splashTexts[i];
      st.t += dtSec;
      if (st.t >= st.totalDur) { splashTexts.splice(i, 1); continue; }

      if (st.t < st.growDur) {
        // Elastic bounce-in
        st.scale = elasticOut(st.t / st.growDur);
      } else if (st.t < st.growDur + st.holdDur) {
        // Gentle pulse
        const holdT = (st.t - st.growDur) / st.holdDur;
        st.scale = 1.0 + 0.04 * Math.sin(holdT * Math.PI * 4);
      } else {
        // Shrink out
        const p = (st.t - st.growDur - st.holdDur) / st.shrinkDur;
        st.scale = 1.0 - p;
      }
    }
  }

  function drawSplashTexts() {
    for (const st of splashTexts) {
      if (st.scale <= 0) continue;
      ctx.save();
      ctx.translate(CANVAS_LOGICAL / 2, st.y);
      ctx.scale(st.scale, st.scale);
      ctx.font = `900 ${st.size}px "Segoe UI", Impact, Arial, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      // Glow
      ctx.shadowColor = st.color;
      ctx.shadowBlur = 20;
      // Outline
      ctx.strokeStyle = 'rgba(0,0,0,0.7)';
      ctx.lineWidth = 4;
      ctx.strokeText(st.text, 0, 0);
      // Fill
      ctx.fillStyle = st.color;
      ctx.fillText(st.text, 0, 0);
      ctx.restore();
    }
  }

  // --- 7. COMBO SYSTEM ---
  let comboCount = 0;
  let comboTimer = 0;
  // comboTimeoutSec comes from FINETUNE.comboTimeoutSec

  let comboDisplay = { count: 0, life: 0, scale: 0, t: 0 };

  function incrementCombo() {
    comboCount++;
    comboTimer = FINETUNE.comboTimeoutSec;
    if (comboCount >= 2) {
      comboDisplay = { count: comboCount, life: 2.5, scale: 0, t: 0 };
    }
  }

  function resetCombo() {
    comboCount = 0;
    comboTimer = 0;
    comboDisplay = { count: 0, life: 0, scale: 0, t: 0 };
  }

  function updateCombo(dtSec) {
    if (comboTimer > 0) {
      comboTimer -= dtSec;
      if (comboTimer <= 0) {
        comboCount = 0;
        comboTimer = 0;
        comboDisplay = { count: 0, life: 0, scale: 0, t: 0 };
      }
    }
    if (comboDisplay.life > 0) {
      comboDisplay.t += dtSec;
      if (comboDisplay.t < 0.15) {
        comboDisplay.scale = elasticOut(comboDisplay.t / 0.15);
      } else {
        comboDisplay.scale = 1.0;
      }
      comboDisplay.life -= dtSec;
    }
  }

  function drawCombo() {
    if (comboDisplay.life <= 0 || comboDisplay.count < 2) return;
    ctx.save();
    const alpha = Math.min(1, comboDisplay.life);
    ctx.globalAlpha = alpha;
    ctx.translate(CANVAS_LOGICAL / 2, CANVAS_LOGICAL * 0.52);
    ctx.scale(comboDisplay.scale, comboDisplay.scale);
    ctx.font = `900 28px "Segoe UI", Impact, Arial, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    // Rainbow color cycling
    const hue = (Date.now() / 5) % 360;
    ctx.fillStyle = `hsl(${hue}, 100%, 65%)`;
    ctx.shadowColor = `hsl(${hue}, 100%, 50%)`;
    ctx.shadowBlur = 12;
    ctx.strokeStyle = 'rgba(0,0,0,0.6)';
    ctx.lineWidth = 3;
    ctx.strokeText(`COMBO \u00D7${comboDisplay.count}`, 0, 0);
    ctx.fillText(`COMBO \u00D7${comboDisplay.count}`, 0, 0);
    ctx.restore();
  }

  function drawDebugEval() {
    if (!FINETUNE.debugShowEngineEval) return;
    const evalValue = typeof Game.lastTurnEngineEval === 'number' ? Game.lastTurnEngineEval : 0;
    const sign = evalValue > 0 ? '+' : '';
    const text = `Eval: ${sign}${evalValue.toFixed(2)}`;
    ctx.save();
    ctx.globalAlpha = 0.92;
    ctx.fillStyle = 'rgba(0,0,0,0.68)';
    ctx.fillRect(8, 8, 132, 28);
    ctx.font = 'bold 16px "Times New Roman", Times, serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#FFFFFF';
    ctx.fillText(text, 14, 22);
    ctx.restore();
  }

  // ---------------------------------------------------------------------------
  // Lifetime stats (persisted across sessions)
  // ---------------------------------------------------------------------------
  const STATS_KEY = 'chessArena_lifetimeStats';
  let lifetimeStats = { totalKills: 0, maxScore: 0, totalPoints: 0, gamesPlayed: 0 };
  try {
    const _raw = localStorage.getItem(STATS_KEY);
    if (_raw) lifetimeStats = Object.assign(lifetimeStats, JSON.parse(_raw));
  } catch (e) {}

  function saveLifetimeStats() {
    try { localStorage.setItem(STATS_KEY, JSON.stringify(lifetimeStats)); } catch (e) {}
  }

  function getPlayerRank() {
    if (FINETUNE.debugMode && typeof FINETUNE.debugRank === 'string') return FINETUNE.debugRank;
    const pts  = lifetimeStats.totalPoints;
    const best = lifetimeStats.maxScore;
    if (pts >= 100000 || best >= 10000) return 'GM';
    if (pts >= 50000  || best >= 3000)  return 'IM';
    if (pts >= 25000  || best >= 1000)  return 'FM';
    if (pts >= 10000  || best >= 500)   return 'CM';
    return '';
  }

  function updateRankBadge() {
    const el   = document.getElementById('rankTitle');
    const rank = getPlayerRank();
    if (!el) return;
    if (!rank) { el.innerHTML = ''; return; }
    const cls = 'rank-' + rank.toLowerCase();
    el.innerHTML = `<span class="rank-label">Rank:</span><span class="rank-value ${cls}">${rank}</span>`;
  }
  updateRankBadge();

  function openStatsPanel() {
    document.getElementById('statGames').textContent     = lifetimeStats.gamesPlayed.toLocaleString();
    document.getElementById('statKills').textContent     = lifetimeStats.totalKills.toLocaleString();
    document.getElementById('statMax').textContent       = Math.floor(lifetimeStats.maxScore).toLocaleString();
    document.getElementById('statTotal').textContent     = Math.floor(lifetimeStats.totalPoints).toLocaleString();
    const rankEl  = document.getElementById('statRankLabel');
    const curRank  = getPlayerRank();
    rankEl.className = curRank ? 'rank-' + curRank.toLowerCase() : '';
    rankEl.textContent = curRank;
    document.getElementById('statsPanel').classList.remove('hidden');
  }

  // ---------------------------------------------------------------------------
  // UI settings persistence (dark mode, volume, clock, piece colour)
  // ---------------------------------------------------------------------------
  const UI_SETTINGS_KEY = 'chessArena_uiSettings';

  function saveUISettings() {
    try {
      localStorage.setItem(UI_SETTINGS_KEY, JSON.stringify({
        volume       : soundVolume,
        darkMode     : document.body.classList.contains('dark'),
        showClock,
        playerPieceRow,
      }));
    } catch (e) {}
  }

  function loadUISettings() {
    try {
      const raw = localStorage.getItem(UI_SETTINGS_KEY);
      if (!raw) return;
      const s = JSON.parse(raw);
      if (s.volume != null) {
        soundVolume = s.volume;
        document.getElementById('volumeSlider').value = s.volume;
      }
      if (s.darkMode) {
        document.body.classList.add('dark');
        document.documentElement.classList.add('dark');
        document.getElementById('darkModeCheck').checked = true;
      }
      if (s.showClock) {
        showClock = true;
        document.getElementById('showClockCheck').checked = true;
        const clockBlock = document.getElementById('clock-block');
        clockEl.textContent = formatClock(clockSeconds);
        if (clockBlock) clockBlock.classList.remove('hidden');
      }
      if (s.playerPieceRow != null) {
        playerPieceRow = s.playerPieceRow;
        document.querySelectorAll('.swatch').forEach(b => {
          b.classList.toggle('active', parseInt(b.dataset.row, 10) === playerPieceRow);
        });
        updateRulesEnemyColor();
      }
    } catch (e) {}
  }

  // ===========================================================================
  // Register Game callbacks
  // ===========================================================================
  Game.setCallbacks({
    onStateChange : () => { /* redrawn every frame */ },

    onGameOver: (score, hs) => {
      // Accumulate lifetime stats
      lifetimeStats.gamesPlayed++;
      lifetimeStats.totalKills  += Game.killCount;
      lifetimeStats.totalPoints += score;
      if (score > lifetimeStats.maxScore) lifetimeStats.maxScore = score;
      saveLifetimeStats();
      updateRankBadge();

      document.getElementById('goScore').textContent     = `Score: ${Math.floor(score)}`;
      document.getElementById('goHighScore').textContent = `Best: ${Math.floor(hs)}`;
      document.getElementById('gameOverPanel').classList.remove('hidden');
    },

    onCapture: (info) => {
      playSound(sndCapture);
      const [cx, cy] = boardToCanvas(info.col, info.row);
      // Particle burst
      const colors = info.isPlayerCapture
        ? CAPTURE_COLORS
        : ['#888', '#aaa', '#666'];
      spawnParticles(cx, cy, 18 + Math.floor(info.value * 3), colors, {
        speed: 130 + info.value * 15,
        sizeMin: 2, sizeMax: 6,
        gravity: 90,
      });
      // Shockwave
      spawnShockwave(cx, cy, 40 + info.value * 6, info.isPlayerCapture ? '#FFD93D' : '#888');
      // Floating score text — merge in any pending time-bonus so only one label appears
      if (info.isPlayerCapture) {
        // Award the time bonus now that we know a capture happened.
        if (pendingMoveBonus > 0) Game.addBonusScore(pendingMoveBonus);
        const pts = Math.round(info.value * 10 * FINETUNE.scoreScaleFactor) + pendingMoveBonus;
        pendingMoveBonus = 0;
        if (pts > 9) {
          spawnFloatingText(cx, cy - 10, `+${pts} points`, '#111111', 16 + Math.min(info.value * 2, 10));
        }
      }
      // Combo
      if (info.isPlayerCapture) {
        incrementCombo();
      }
    },

    onPieceMove: ({ wasCapture, isPlayerMove }) => {
      if (!wasCapture) {
        playSound(sndMove);
        if (isPlayerMove) resetCombo();
      }
    },

    onPromotion: (info) => {
      const [cx, cy] = boardToCanvas(info.col, info.row);
      const PIECE_NAMES = { Q: 'QUEEN!', R: 'ROOK!', B: 'BISHOP!', N: 'KNIGHT!' };
      const label = PIECE_NAMES[info.type] || 'PROMOTED!';
      spawnParticles(cx, cy, 30, ['#FFD700', '#FFF', '#FF6B6B', '#CC5DE8'], {
        speed: 200, sizeMin: 3, sizeMax: 8, gravity: 60, upBias: 60,
      });
      spawnShockwave(cx, cy, 90, '#FFD700');
      spawnFloatingText(cx, cy - 15, label, '#FFD700', 22);
      triggerFlash('#FFD700', 0.2);
    },

    onMoveQuality: () => {
      // move-quality banners disabled — score bonuses still applied in game.js
    },

    onTurnStart: () => {
      // Record when it becomes the player's turn so move-time bonus can be computed
      moveStartTime = performance.now();
    },

    onScoreChange: (score, hs, moves, kills) => {
      // If game reset, snap score to 0 immediately instead of counting down
      if (score === 0) {
        displayScore = 0;
        targetScore  = 0;
        scoreEl.textContent = '0';
      } else {
        targetScore = score;
        // Pop the score element
        scoreEl.classList.remove('score-pop');
        void scoreEl.offsetWidth; // reflow to restart animation
        scoreEl.classList.add('score-pop');
      }
      // High score and moves update immediately
      if (hs > lifetimeStats.maxScore) {
        lifetimeStats.maxScore = hs;
        updateRankBadge();  // unlock rank as soon as threshold is crossed mid-game
      }
      highEl.textContent = Math.floor(lifetimeStats.maxScore).toLocaleString();
      if (moveEl) moveEl.textContent = `Moves: ${moves}`;
    },
  });

  // Move-start time: reset each time it becomes the player's turn (via onTurnStart callback)
  let moveStartTime    = performance.now();
  let pendingMoveBonus = 0; // absorbed into capture text if a capture happens same move

  // ---------------------------------------------------------------------------
  // Load save or fresh start
  // ---------------------------------------------------------------------------
  // Always start a fresh board on page load so spawn count and state are
  // always clean (matching Restart behaviour). Game.load() is called first
  // solely to restore the persisted high score before initBoard() runs.
  Game.load();
  Game.initBoard();
  resetClock();

  // ---------------------------------------------------------------------------
  // Easing
  // ---------------------------------------------------------------------------
  function easeInOut(t) { return t < 0.5 ? 2*t*t : -1+(4-2*t)*t; }

  // ---------------------------------------------------------------------------
  // Draw helpers
  // ---------------------------------------------------------------------------
  function drawFallbackBoard() {
    for (let c = 0; c < 8; c++) {
      for (let r = 0; r < 8; r++) {
        ctx.fillStyle = (c + r) % 2 === 0 ? '#F0D9B5' : '#B58863';
        ctx.fillRect(MARGIN + c * SQUARE, MARGIN + r * SQUARE, SQUARE, SQUARE);
      }
    }
  }

  function drawHighlights() {
    ctx.save();
    ctx.fillStyle = 'rgba(255, 220, 40, 0.40)';
    for (const [c, r] of highlighted) {
      if (c >= 0 && c < 8 && r >= 0 && r < 8) {
        ctx.fillRect(MARGIN + c * SQUARE, MARGIN + r * SQUARE, SQUARE, SQUARE);
      }
    }
    ctx.restore();
  }

  function drawPieces(skipPiece) {
    const now = Date.now();
    for (const p of Game.pieces) {
      if (p === skipPiece) continue;
      if (SPRITE_COLS[p.type] === undefined) continue;

      let cx, cy;
      if (p.animating && p.animT < 1) {
        const t = easeInOut(p.animT);
        const [fx, fy] = boardToCanvas(p.animFromX, p.animFromY);
        const [tx, ty] = boardToCanvas(p.animToX,   p.animToY);
        cx = fx + (tx - fx) * t;
        cy = fy + (ty - fy) * t;
      } else {
        [cx, cy] = boardToCanvas(p.x, p.y);
      }

      const sz = SQUARE * 0.95;
      ctx.save();
      ctx.globalAlpha = p.alpha;
      drawPieceSprite(p.type, cx - sz / 2, cy - sz / 2, sz, sz);

      // Cloud overlay on forming (fading-in) pieces
      // Normalized so cloud is 100% opacity at formingAlpha and fades to 0 at full opacity
      if (p.alpha < 1 && cloudoverImg) {
        ctx.globalAlpha = Math.min(1, (1 - p.alpha) / (1 - FINETUNE.formingAlpha));
        ctx.drawImage(cloudoverImg, cx - SQUARE / 2, cy - SQUARE / 2, SQUARE, SQUARE);
      }

      // Sparkle indicator on convertable pieces — top-right corner badge
      if (p.convertable) {
        const pulse = 0.5 + 0.3 * Math.sin(now / 300);
        ctx.globalAlpha =  pulse;
        if (sparkleImg) {
          // Place star at the top-right corner of the piece, slightly inset
          const spSz = sz * 0.72;
          ctx.drawImage(sparkleImg, cx + sz * 0.2-43, cy - sz * 0.65+8, spSz*1.4, spSz*1.4);
        } else {
          ctx.globalAlpha = 0.9;
          ctx.fillStyle = '#FFD700';
          ctx.shadowColor = '#FFD700';
          ctx.shadowBlur = 8;
          ctx.beginPath();
          ctx.arc(cx + sz * 0.38, cy - sz * 0.38, sz * 0.18, 0, Math.PI * 2);
          ctx.fill();
          ctx.shadowBlur = 0;
        }
      }
      ctx.restore();
    }
  }

  // Draw captured pieces that are fading out while attacker slides toward them
  function drawDyingPieces() {
    for (const p of Game.dyingPieces) {
      if (SPRITE_COLS[p.type] === undefined) continue;
      const [cx, cy] = boardToCanvas(p.x, p.y);
      const sz = SQUARE * 0.95;
      ctx.save();
      ctx.globalAlpha = Math.max(0, p.dyingAlpha);
      drawPieceSprite(p.type, cx - sz / 2, cy - sz / 2, sz, sz);
      ctx.restore();
    }
  }

  function drawDragged() {
    if (!dragging) return;
    const sz = SQUARE * 1.02;
    ctx.save();
    ctx.globalAlpha = 0.92;
    drawPieceSprite(dragging.piece.type, dragging.curX - sz / 2, dragging.curY - sz / 2, sz, sz);
    ctx.restore();
  }

  // ---------------------------------------------------------------------------
  // Main render loop
  // ---------------------------------------------------------------------------
  function render(ts) {
    const dt    = Math.min(ts - lastTs, 50); // cap delta to prevent huge jumps
    const dtSec = dt / 1000;
    lastTs = ts;

    // Advance piece animations
    for (const p of Game.pieces) {
      if (p.animating && p.animT < 1) {
        p.animT = Math.min(1, p.animT + dt / ANIM_MS);
        if (p.animT >= 1) p.animating = false;
      }
    }

    // Fade out dying (captured) pieces — decay over ANIM_MS duration
    for (let i = Game.dyingPieces.length - 1; i >= 0; i--) {
      const dp = Game.dyingPieces[i];
      dp.dyingAlpha -= dtSec * (1.0 / (ANIM_MS / 1000));
      if (dp.dyingAlpha <= 0) Game.dyingPieces.splice(i, 1);
    }

    // Update all VFX systems
    updateParticles(dtSec);
    updateFloatingTexts(dtSec);
    updateShake(dtSec);
    updateFlash(dtSec);
    updateShockwaves(dtSec);
    updateSplashTexts(dtSec);
    updateCombo(dtSec);
    updateScoreDisplay(dtSec);
    updateClock(dtSec);

    // --- Apply screen shake transform ---
    const [sx, sy] = getShakeOffset();
    ctx.save();
    ctx.translate(sx, sy);

    // Clear (slightly oversized to cover shake)
    ctx.clearRect(-10, -10, CANVAS_LOGICAL + 20, CANVAS_LOGICAL + 20);

    // Board
    if (boardImg) {
      ctx.drawImage(boardImg, 0, 0, CANVAS_LOGICAL, CANVAS_LOGICAL);
    } else {
      drawFallbackBoard();
    }

    // Move highlights
    drawHighlights();

    // Shockwaves (behind pieces)
    drawShockwaves();

    // Dying (captured) pieces fade behind the incoming attacker
    drawDyingPieces();

    // Pieces (skip dragged piece)
    drawPieces(dragging ? dragging.piece : null);

    // Dragged piece on top
    drawDragged();

    // Promotion menu (above pieces, below particles/text)
    drawPromotionMenu();

    // Particles (above pieces)
    drawParticles();

    // Floating text
    drawFloatingTexts();

    // Screen flash overlay
    drawFlash();

    // Splash text (topmost layer)
    drawSplashTexts();

    // Combo display
    drawCombo();

    // Debug eval HUD
    drawDebugEval();

    ctx.restore(); // end shake transform

    requestAnimationFrame(render);
  }

  requestAnimationFrame(render);

  // ---------------------------------------------------------------------------
  // Input helpers — scale screen coords → canvas logical coords
  // ---------------------------------------------------------------------------
  function getCanvasXY(e) {
    const rect   = canvas.getBoundingClientRect();
    const scaleX = CANVAS_LOGICAL / rect.width;
    const scaleY = CANVAS_LOGICAL / rect.height;
    const src    = e.touches ? e.touches[0] : (e.changedTouches ? e.changedTouches[0] : e);
    return [(src.clientX - rect.left) * scaleX,
            (src.clientY - rect.top)  * scaleY];
  }

  // ---------------------------------------------------------------------------
  // Mouse / Touch events
  // ---------------------------------------------------------------------------
  function onPointerDown(e) {
    e.preventDefault();
    shiftHeld = !!(e.shiftKey);

    // Intercept promotion-menu clicks before anything else
    if (promotionMenu) {
      const [cx, cy] = getCanvasXY(e);
      for (const slot of promotionMenu.slots) {
        if (cx >= slot.x && cx <= slot.x + slot.w &&
            cy >= slot.y && cy <= slot.y + slot.h) {
          const { fromCol, fromRow, toCol, toRow, isEP } = promotionMenu;
          promotionMenu = null;
          Game.onPieceMovedWithPromotion(fromCol, fromRow, toCol, toRow, isEP, slot.type);
          const mp = Game.pieces.find(p => p.x === toCol && p.y === toRow);
          if (mp) { mp.animT = 1; mp.animating = false; }
          return;
        }
      }
      promotionMenu = null; // click outside = cancel
      return;
    }

    if (!Game.canMovePieces) return;

    const [cx, cy]   = getCanvasXY(e);
    const [col, row] = canvasToBoard(cx, cy);
    if (col < 0 || col > 7 || row < 0 || row > 7) return;

    const piece = Game.pieces.find(p => p.x === col && p.y === row);
    if (!piece)                              return;
    if (!Game.isBlack(piece.type))           return;
    if (piece.movesUntilFormed > 0)          return;

    dragging = { piece, startX: col, startY: row, curX: cx, curY: cy };
    highlighted = Game.getMoves(col, row);
  }

  function onPointerMove(e) {
    e.preventDefault();
    if (!dragging) return;
    const [cx, cy] = getCanvasXY(e);
    dragging.curX = cx;
    dragging.curY = cy;
  }

  function onPointerUp(e) {
    e.preventDefault();
    if (!dragging) return;

    const [cx, cy] = [dragging.curX, dragging.curY];
    const { piece, startX, startY } = dragging;
    dragging    = null;
    highlighted = [];

    const [toCol, toRow] = canvasToBoard(cx, cy);
    if (toCol < 0 || toCol > 7 || toRow < 0 || toRow > 7) return;
    if (toCol === startX && toRow === startY) return;

    if (!Game.isValidMove(startX, startY, toCol, toRow)) return;

    // --- Move-time score bonus (piecewise-linear) ---
    const elapsedSec = (performance.now() - moveStartTime) / 1000;
    const tb = FINETUNE.moveTimeBonus;
    let timeBonus;
    if (elapsedSec <= tb.fastSec) {
      timeBonus = tb.fastBonus;
    } else if (elapsedSec <= tb.midSec) {
      timeBonus = tb.fastBonus + (tb.midBonus - tb.fastBonus) * (elapsedSec - tb.fastSec) / (tb.midSec - tb.fastSec);
    } else if (elapsedSec <= tb.slowSec) {
      timeBonus = tb.midBonus + (tb.slowBonus - tb.midBonus) * (elapsedSec - tb.midSec) / (tb.slowSec - tb.midSec);
    } else {
      timeBonus = tb.slowBonus;
    }
    timeBonus = Math.round(timeBonus);

    // Reset combo if move was too slow
    if (elapsedSec >= FINETUNE.comboTimeoutSec) {
      comboCount = 0;
      comboTimer = 0;
      comboDisplay = { count: 0, life: 0, scale: 0, t: 0 };
    }

    // Detect en passant
    const isEP = piece.type.toLowerCase() === 'p' &&
                 toCol !== startX &&
                 Game.board[toCol][toRow] === '';

    // Shift-held on a black pawn reaching row 0 → show promotion picker
    if (piece.type === 'P' && toRow === 0 && shiftHeld) {
      showPromotionMenu(startX, startY, toCol, toRow, isEP);
      return; // wait for menu selection
    }

    // Time bonus is only awarded when the move captures a piece.
    // Store it so onCapture can consume it; discard silently if no capture occurs.
    const scaledTimeBonus = Math.round(timeBonus * FINETUNE.scoreScaleFactor);
    const [bonusX, bonusY] = boardToCanvas(toCol, toRow);
    pendingMoveBonus = scaledTimeBonus;

    Game.onPieceMoved(startX, startY, toCol, toRow, isEP);
    // If a capture fired, onCapture already consumed and awarded pendingMoveBonus.
    // If no capture, discard silently — no points for just moving.
    pendingMoveBonus = 0;
    // Cancel slide animation — piece was already dragged visually to destination
    const movedPiece = Game.pieces.find(p => p.x === toCol && p.y === toRow);
    if (movedPiece) { movedPiece.animT = 1; movedPiece.animating = false; }
  }

  canvas.addEventListener('mousedown',  onPointerDown);
  canvas.addEventListener('mousemove',  onPointerMove);
  canvas.addEventListener('mouseup',    onPointerUp);
  canvas.addEventListener('touchstart', onPointerDown, { passive: false });
  canvas.addEventListener('touchmove',  onPointerMove, { passive: false });
  canvas.addEventListener('touchend',   onPointerUp,   { passive: false });

  canvas.addEventListener('mouseleave', () => {
    if (dragging) {
      dragging    = null;
      highlighted = [];
    }
  });

  // Track hover over promotion menu for highlight
  canvas.addEventListener('mousemove', (e) => {
    if (!promotionMenu) return;
    const [cx, cy] = getCanvasXY(e);
    promotionMenu.hoveredIdx = promotionMenu.slots.findIndex(
      s => cx >= s.x && cx <= s.x + s.w && cy >= s.y && cy <= s.y + s.h
    );
  });

  // ---------------------------------------------------------------------------
  // UI button wiring
  // ---------------------------------------------------------------------------
  document.getElementById('menuBtn').addEventListener('click', () => {
    document.getElementById('settingsPanel').classList.remove('hidden');
  });

  document.getElementById('closeMenuBtn').addEventListener('click', () => {
    document.getElementById('settingsPanel').classList.add('hidden');
  });

  // Click outside the settings panel (on the dark overlay) = resume
  document.getElementById('settingsPanel').addEventListener('click', (e) => {
    if (e.target === e.currentTarget)
      document.getElementById('settingsPanel').classList.add('hidden');
  });

  // Help / Rules
  document.getElementById('helpBtn').addEventListener('click', () => {
    document.getElementById('helpPanel').classList.remove('hidden');
  });
  document.getElementById('closeHelpBtn').addEventListener('click', () => {
    document.getElementById('helpPanel').classList.add('hidden');
  });
  document.getElementById('helpPanel').addEventListener('click', (e) => {
    if (e.target === e.currentTarget)
      document.getElementById('helpPanel').classList.add('hidden');
  });

  // Volume slider
  document.getElementById('volumeSlider').addEventListener('input', (e) => {
    soundVolume = parseFloat(e.target.value);
    saveUISettings();
  });

  // Dark mode toggle
  document.getElementById('darkModeCheck').addEventListener('change', (e) => {
    const on = e.target.checked;
    document.body.classList.toggle('dark', on);
    document.documentElement.classList.toggle('dark', on);
    saveUISettings();
  });

  // Clock toggle in settings
  document.getElementById('showClockCheck').addEventListener('change', (e) => {
    showClock = e.target.checked;
    const clockBlock = document.getElementById('clock-block');
    if (showClock) {
      clockEl.textContent = formatClock(clockSeconds);
      if (clockBlock) clockBlock.classList.remove('hidden');
    } else {
      if (clockBlock) clockBlock.classList.add('hidden');
    }
    saveUISettings();
  });

  // Piece colour toggle (black or white appearance for player)
  function updateRulesEnemyColor() {
    const enemyColor = playerPieceRow === 0 ? 'black' : 'white';
    document.querySelectorAll('.rules-enemy-color').forEach(el => { el.textContent = enemyColor; });
  }

  document.querySelectorAll('.swatch').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.swatch').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      playerPieceRow = parseInt(btn.dataset.row, 10);
      updateRulesEnemyColor();
      saveUISettings();
    });
  });

  // Restore saved UI settings
  loadUISettings();

  document.getElementById('statsBtn').addEventListener('click', () => {
    document.getElementById('settingsPanel').classList.add('hidden');
    openStatsPanel();
  });
  document.getElementById('closeStatsBtn').addEventListener('click', () => {
    document.getElementById('statsPanel').classList.add('hidden');
  });
  document.getElementById('statsPanel').addEventListener('click', (e) => {
    if (e.target === e.currentTarget)
      document.getElementById('statsPanel').classList.add('hidden');
  });

  document.getElementById('creditsBtn').addEventListener('click', () => {
    document.getElementById('creditsPanel').classList.remove('hidden');
  });
  document.getElementById('closeCreditsBtn').addEventListener('click', () => {
    document.getElementById('creditsPanel').classList.add('hidden');
  });

  document.getElementById('restartFromGameOver').addEventListener('click', () => {
    document.getElementById('gameOverPanel').classList.add('hidden');
    Game.resetGame();
    resetClock();
  });

  document.getElementById('restartFromMenu').addEventListener('click', () => {
    document.getElementById('settingsPanel').classList.add('hidden');
    Game.resetGame();
    resetClock();
  });

  // ---------------------------------------------------------------------------
  // Responsive sizing — keep canvas square and as large as viewport allows
  // ---------------------------------------------------------------------------
  function resize() {
    const maxPx   = Math.min(window.innerWidth, window.innerHeight - 130, 600);
    canvas.style.width  = maxPx + 'px';
    canvas.style.height = maxPx + 'px';
  }
  window.addEventListener('resize', resize);
  resize();

})();
