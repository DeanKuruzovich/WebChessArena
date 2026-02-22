'use strict';
// =============================================================================
// main.js — Canvas renderer, drag-and-drop input, UI, visual effects
// =============================================================================

(async () => {

  // ---------------------------------------------------------------------------
  // Canvas setup — DPR-aware for crisp Retina/HiDPI rendering
  // ---------------------------------------------------------------------------
  const canvas  = document.getElementById('board');
  const ctx     = canvas.getContext('2d');
  const DPR = Math.min(window.devicePixelRatio || 1, 3);
  const CANVAS_LOGICAL = 560; // logical coordinate space (never changes)
  // Buffer is DPR× the logical size → 1:1 native pixels on retina screens
  canvas.width  = Math.round(CANVAS_LOGICAL * DPR);
  canvas.height = Math.round(CANVAS_LOGICAL * DPR);
  // Scale all draw calls so coordinates stay in the logical 560× space
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

  // Board image
  const boardImg = await loadImage('Chess Arena/Chess kit (Community).png');

  // Piece images (UPPERCASE = black/player, lowercase = white/AI)
  const PIECE_IMG_MAP = {
    'P': 'black_pawn',   'Q': 'black_queen',  'K': 'black_king',
    'R': 'black_rook',   'N': 'black_knight', 'B': 'black_bishop',
    'p': 'white_pawn',   'q': 'white_queen',  'k': 'white_king',
    'r': 'white_rook',   'n': 'white_knight', 'b': 'white_bishop',
  };

  const pieceImgs = {};
  await Promise.all(
    Object.entries(PIECE_IMG_MAP).map(async ([key, name]) => {
      pieceImgs[key] = await loadImage(`Chess Arena/PieceTextures/${name}.png`);
    })
  );

  const sparkleImg = await loadImage('Chess Arena/Sparkle.png');

  // ---------------------------------------------------------------------------
  // Board geometry (matches original: 43px margin, 280px/square in a 2321px image)
  // ---------------------------------------------------------------------------
  const MARGIN_FRAC  = 43  / 2321;
  const SQUARE_FRAC  = 280 / 2321;
  const MARGIN       = CANVAS_LOGICAL * MARGIN_FRAC;   // ≈ 10.4 px
  const SQUARE       = CANVAS_LOGICAL * SQUARE_FRAC;   // ≈ 67.5 px

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
  let dragging = null;          // { piece, startX, startY, curX, curY }
  let highlighted = [];         // [[col, row], ...]

  // ---------------------------------------------------------------------------
  // Animation timing
  // ---------------------------------------------------------------------------
  const ANIM_MS  = 450;
  let   lastTs   = 0;

  // ---------------------------------------------------------------------------
  // Visual effects state
  // ---------------------------------------------------------------------------
  let effects = [];  // { type, t, maxT, data }

  function addEffect(type, maxT, data = {}) {
    effects.push({ type, t: 0, maxT, data });
  }

  // ---------------------------------------------------------------------------
  // Register Game callbacks
  // ---------------------------------------------------------------------------
  Game.setCallbacks({
    onStateChange : () => { /* redrawn every frame */ },
    onGameOver    : (score, hs) => {
      document.getElementById('goScore').textContent     = `Score: ${Math.floor(score)}`;
      document.getElementById('goHighScore').textContent = `High Score: ${Math.floor(hs)}`;
      document.getElementById('gameOverPanel').classList.remove('hidden');
    },
    onGreatMove: () => {
      document.getElementById('banner').textContent = 'GREAT MOVE!';
      document.getElementById('banner').className   = 'banner great visible';
      addEffect('greatMove', 2200);
      clearTimeout(window._bannerTimer);
      window._bannerTimer = setTimeout(() => {
        document.getElementById('banner').classList.remove('visible');
      }, 2200);
    },
    onGoodMove: () => {
      document.getElementById('banner').textContent = 'Good Move!';
      document.getElementById('banner').className   = 'banner good visible';
      clearTimeout(window._bannerTimer);
      window._bannerTimer = setTimeout(() => {
        document.getElementById('banner').classList.remove('visible');
      }, 1500);
    },
    onScoreChange: (score, hs, moveNum) => {
      document.getElementById('scoreLabel').textContent    = `Score: ${Math.floor(score)}`;
      document.getElementById('highScoreLabel').textContent= `High: ${Math.floor(hs)}`;
      document.getElementById('moveLabel').textContent     = `Moves: ${moveNum}`;
    },
  });

  // ---------------------------------------------------------------------------
  // Load save or fresh start
  // ---------------------------------------------------------------------------
  const loaded = Game.load();
  if (!loaded) {
    Game.initBoard();
  } else {
    // Sync score labels from loaded state
    document.getElementById('highScoreLabel').textContent = `High: ${Math.floor(Game.highScore)}`;
    document.getElementById('scoreLabel').textContent     = `Score: ${Math.floor(Game.score)}`;
    document.getElementById('moveLabel').textContent      = `Moves: ${Game.moveNum}`;
  }

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
      const img = pieceImgs[p.type];
      if (!img) continue;

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
      ctx.drawImage(img, cx - sz / 2, cy - sz / 2, sz, sz);

      // Sparkle indicator on convertable pieces
      if (p.convertable) {
        ctx.globalAlpha = p.alpha * (0.55 + 0.45 * Math.sin(now / 380));
        if (sparkleImg) {
          const spSz = sz * 0.42;
          ctx.drawImage(sparkleImg, cx + sz * 0.22, cy - sz * 0.55, spSz, spSz);
        } else {
          // Fallback: yellow dot
          ctx.globalAlpha = 0.85;
          ctx.fillStyle = '#FFD700';
          ctx.beginPath();
          ctx.arc(cx + sz * 0.35, cy - sz * 0.35, sz * 0.12, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      ctx.restore();
    }
  }

  function drawDragged() {
    if (!dragging) return;
    const img = pieceImgs[dragging.piece.type];
    if (!img) return;
    const sz = SQUARE * 1.02;
    ctx.save();
    ctx.globalAlpha = 0.92;
    ctx.drawImage(img, dragging.curX - sz / 2, dragging.curY - sz / 2, sz, sz);
    ctx.restore();
  }

  // Great-move ripple effect drawn over board (CSS-based gravity wave)
  function updateEffects(dt) {
    effects = effects.filter(e => {
      e.t += dt;
      return e.t < e.maxT;
    });
  }

  // ---------------------------------------------------------------------------
  // Main render loop
  // ---------------------------------------------------------------------------
  function render(ts) {
    const dt = ts - lastTs;
    lastTs = ts;

    // Advance piece animations
    for (const p of Game.pieces) {
      if (p.animating && p.animT < 1) {
        p.animT = Math.min(1, p.animT + dt / ANIM_MS);
        if (p.animT >= 1) p.animating = false;
      }
    }

    updateEffects(dt);

    // Clear
    ctx.clearRect(0, 0, CANVAS_LOGICAL, CANVAS_LOGICAL);

    // Board
    if (boardImg) {
      ctx.drawImage(boardImg, 0, 0, CANVAS_LOGICAL, CANVAS_LOGICAL);
    } else {
      drawFallbackBoard();
    }

    // Move highlights
    drawHighlights();

    // Pieces (skip dragged piece)
    drawPieces(dragging ? dragging.piece : null);

    // Dragged piece on top
    drawDragged();

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
    if (!Game.canMovePieces) return;

    const [cx, cy]   = getCanvasXY(e);
    const [col, row] = canvasToBoard(cx, cy);
    if (col < 0 || col > 7 || row < 0 || row > 7) return;

    const piece = Game.pieces.find(p => p.x === col && p.y === row);
    if (!piece)                              return; // empty square
    if (!Game.isBlack(piece.type))           return; // white piece (AI)
    if (piece.movesUntilFormed > 0)          return; // still forming

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
    if (toCol === startX && toRow === startY) return; // dropped on same square

    if (!Game.isValidMove(startX, startY, toCol, toRow)) return;

    // Detect en passant: pawn moving diagonally to empty square
    const ep = Game.enPassantTarget;
    const isEP = piece.type.toLowerCase() === 'p' &&
                 toCol !== startX &&
                 Game.board[toCol][toRow] === '';

    Game.onPieceMoved(startX, startY, toCol, toRow, isEP);
  }

  canvas.addEventListener('mousedown',  onPointerDown);
  canvas.addEventListener('mousemove',  onPointerMove);
  canvas.addEventListener('mouseup',    onPointerUp);
  canvas.addEventListener('touchstart', onPointerDown, { passive: false });
  canvas.addEventListener('touchmove',  onPointerMove, { passive: false });
  canvas.addEventListener('touchend',   onPointerUp,   { passive: false });

  // Cancel drag on leave
  canvas.addEventListener('mouseleave', () => {
    if (dragging) {
      dragging    = null;
      highlighted = [];
    }
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

  document.getElementById('restartFromGameOver').addEventListener('click', () => {
    document.getElementById('gameOverPanel').classList.add('hidden');
    Game.resetGame();
  });

  document.getElementById('restartFromMenu').addEventListener('click', () => {
    document.getElementById('settingsPanel').classList.add('hidden');
    Game.resetGame();
  });

  // ---------------------------------------------------------------------------
  // Responsive sizing — keep canvas square and as large as viewport allows
  // ---------------------------------------------------------------------------
  function resize() {
    const maxPx   = Math.min(window.innerWidth, window.innerHeight - 100, 600);
    canvas.style.width  = maxPx + 'px';
    canvas.style.height = maxPx + 'px';
  }
  window.addEventListener('resize', resize);
  resize();

})();
