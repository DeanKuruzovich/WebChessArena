'use strict';
// =============================================================================
// game.js — Game state, turn management, spawning, scoring, save/load
// Ported from Main.gd + Global.gd · Enhanced with VFX callbacks
// =============================================================================

const Game = (() => {

  const { isBlack, isWhite, getPieceValue, getMoves, getAllMovesPlayer, ChessEngine } = Engine;

  // White-piece spawn distribution (lowercase = white AI pieces)
  const PIECE_DIST = ['p','p','p','p','p','p','k','q','r','r','n','n','n','b','b','b'];

  // Probability to spawn a new opponent piece based on current white-piece count.
  // Index = current white-piece count (capped at array length - 1).
  // 5 slots so it’s easy to fine-tune each level:
  //  index 0 = 0 pieces on board, index 1 = 1 piece, … index 4 = 4+ pieces
  const OPP_SPAWN_PROBS = [1.00, 0.80, 0.60, 0.40, 0.20];

  // Move-quality tiers (eval swing thresholds, negative = good for player)
  const QUALITY_TIERS = [
    { name: 'brilliant', threshold: -9,   label: 'BRILLIANT!' },
    { name: 'great',     threshold: -6,   label: 'GREAT MOVE!' },
    { name: 'good',      threshold: -3,   label: 'GOOD MOVE!' },
    { name: 'nice',      threshold: -1.5, label: 'NICE!' },
  ];

  // ---------------------------------------------------------------------------
  // Mutable state
  // ---------------------------------------------------------------------------
  let board    = [];
  let pieces   = [];
  let dyingPieces = [];   // captured pieces kept for fade-out animation (visual only)
  let enPassantTarget  = [-1, -1];
  let canMovePieces    = true;
  let score            = 0;
  let highScore        = 0;
  let moveNum          = 0;
  let isInGame         = false;
  let lastTurnEngineEval = 0;
  let pendingPlayerPiece = null;
  let engine           = null;
  let lastPlayerMove   = null;  // { from:[x,y], to:[x,y], piece:type }

  // Callbacks set by main.js
  const cb = {
    onStateChange  : null,
    onGameOver     : null,
    onMoveQuality  : null,
    onCapture      : null,
    onPieceMove    : null,   // ({wasCapture}) — fires for every completed move
    onPromotion    : null,
    onScoreChange  : null,
    onClearBoard   : null,   // (bonusScore) — all opponent pieces wiped
  };

  // ---------------------------------------------------------------------------
  // Board helpers
  // ---------------------------------------------------------------------------
  function emptyBoard() {
    board = Array.from({length: 8}, () => new Array(8).fill(''));
    dyingPieces = [];
  }

  function findPiece(x, y) {
    return pieces.find(p => p.x === x && p.y === y) || null;
  }

  function removePieceAt(x, y) {
    board[x][y] = '';
    // Move to dyingPieces so renderer can fade it out while attacker slides in
    const dying = pieces.find(p => p.x === x && p.y === y);
    if (dying) {
      dying.dyingAlpha = dying.alpha; // start fade from current opacity
      dyingPieces.push(dying);
    }
    pieces = pieces.filter(p => !(p.x === x && p.y === y));
  }

  function countPieces(isWhiteSide) {
    let n = 0;
    for (let i = 0; i < 8; i++)
      for (let j = 0; j < 8; j++)
        if (board[i][j] !== '' && isBlack(board[i][j]) !== isWhiteSide) n++;
    return n;
  }

  function makeAwakenessMap() {
    const map = Array.from({length: 8}, () => new Array(8).fill(0));
    for (const p of pieces) map[p.x][p.y] = p.movesUntilFormed;
    return map;
  }

  // ---------------------------------------------------------------------------
  // Piece creation
  // ---------------------------------------------------------------------------
  function createPiece(x, y, type, movesUntilFormed = 0, convertable = false) {
    if (x < 0 || x > 7 || y < 0 || y > 7) return null;
    if (board[x][y] !== '') return null;
    const piece = {
      x, y, type, movesUntilFormed, convertable,
      alpha   : movesUntilFormed > 0 ? 1.0 / (movesUntilFormed*3 + 1) : 1.0,
      animating: false,
      animFromX: x, animFromY: y,
      animToX  : x, animToY  : y,
      animT    : 1.0,
    };
    pieces.push(piece);
    board[x][y] = type;
    return piece;
  }

  function addPieceRandPos(type, movesUntilFormed) {
    let x, y, attempts = 0;
    const isP = type.toUpperCase() === 'P';
    const isBlkType = isBlack(type);

    if (isP) {
      // Black promotes at y=0 (moves toward y=0), so don't spawn at 0 or 1.
      // White promotes at y=7 (moves toward y=7), so don't spawn at 6 or 7.
      const yMin = isBlkType ? 2 : 1;
      const yMax = isBlkType ? 6 : 5;
      do {
        x = Math.floor(Math.random() * 8);
        y = yMin + Math.floor(Math.random() * (yMax - yMin + 1));
        attempts++;
      } while (board[x][y] !== '' && attempts < 64);
    } else {
      do {
        x = Math.floor(Math.random() * 8);
        y = Math.floor(Math.random() * 8);
        attempts++;
      } while (board[x][y] !== '' && attempts < 64);
    }

    if (board[x][y] !== '') return null;
    return createPiece(x, y, type, movesUntilFormed);
  }

  function addRandomOppPiece(blackPieceCount = 5) {
    const type = PIECE_DIST[Math.floor(Math.random() * PIECE_DIST.length)];
    const piece = addPieceRandPos(type, 2);
    if (!piece) return null;
    // Star probability: linear inverse 0.75 (1 player piece) → 0 (5+ pieces)
    const bp = Math.max(1, blackPieceCount);
    const threshold = Math.max(0, 0.75 * (1 - (bp - 1) / 4));
    if (Math.random() < threshold) piece.convertable = true;
    return piece;
  }

  // ---------------------------------------------------------------------------
  // Score helpers
  // ---------------------------------------------------------------------------
  function addScore(delta) {
    score += delta;
    if (score > highScore) highScore = score;
    if (cb.onScoreChange) cb.onScoreChange(score, highScore, moveNum);
  }

  // ---------------------------------------------------------------------------
  // fireCapture — notify VFX layer of a capture event
  // ---------------------------------------------------------------------------
  function fireCapture(col, row, capturedType, capturerType) {
    if (!cb.onCapture) return;
    cb.onCapture({
      col, row,
      value: getPieceValue(capturedType),
      capturedType,
      capturerType,
      isPlayerCapture: isBlack(capturerType),
    });
  }

  // ---------------------------------------------------------------------------
  // initBoard — fresh game
  // ---------------------------------------------------------------------------
  function initBoard() {
    emptyBoard();
    pieces = [];
    score = 0;
    moveNum = 0;
    enPassantTarget = [-1, -1];
    canMovePieces = true;
    lastTurnEngineEval = 0;
    pendingPlayerPiece = null;
    lastPlayerMove = null;
    isInGame = true;
    engine = new ChessEngine();

    // --- Player starting pieces ---
    // Option A (50%): Pawn + Queen or Rook
    // Option B (50%): 2 pieces from {Knight, Bishop, King} — no 2 Kings;
    //                 if both Bishops, place them on opposite-colored squares
    if (Math.random() < 0.5) {
      // Option A
      addPieceRandPos('P', 0);
      addPieceRandPos(Math.random() < 0.5 ? 'Q' : 'R', 0);
    } else {
      // Option B
      const pool = ['N', 'B', 'K'];
      const p1 = pool[Math.floor(Math.random() * 3)];
      let p2;
      do {
        p2 = pool[Math.floor(Math.random() * 3)];
      } while (p1 === 'K' && p2 === 'K');  // no 2 Kings

      const placed1 = addPieceRandPos(p1, 0);

      if (p1 === 'B' && p2 === 'B' && placed1) {
        // Force opposite-color square for the second bishop
        const targetParity = 1 - ((placed1.x + placed1.y) % 2);
        let ox, oy, att = 0;
        do {
          ox = Math.floor(Math.random() * 8);
          oy = Math.floor(Math.random() * 8);
          att++;
        } while ((board[ox][oy] !== '' || (ox + oy) % 2 !== targetParity) && att < 64);
        if (board[ox][oy] === '') createPiece(ox, oy, 'B', 0);
      } else {
        addPieceRandPos(p2, 0);
      }
    }

    // --- Opponent starting pieces (mirrored player logic) ---
    // Option A (50%): pawn + queen or rook
    // Option B (50%): 2 from {knight, bishop, king}
    if (Math.random() < 0.5) {
      addPieceRandPos('p', 2);
      addPieceRandPos(Math.random() < 0.5 ? 'q' : 'r', 2);
    } else {
      const oppPool = ['n', 'b', 'k'];
      const op1 = oppPool[Math.floor(Math.random() * 3)];
      let op2;
      do { op2 = oppPool[Math.floor(Math.random() * 3)]; }
      while (op1 === 'k' && op2 === 'k');
      const oppPlaced1 = addPieceRandPos(op1, 2);
      if (op1 === 'b' && op2 === 'b' && oppPlaced1) {
        const tgt = 1 - ((oppPlaced1.x + oppPlaced1.y) % 2);
        let ox2, oy2, att2 = 0;
        do {
          ox2 = Math.floor(Math.random() * 8);
          oy2 = Math.floor(Math.random() * 8);
          att2++;
        } while ((board[ox2][oy2] !== '' || (ox2 + oy2) % 2 !== tgt) && att2 < 64);
        if (board[ox2][oy2] === '') createPiece(ox2, oy2, 'b', 2);
      } else {
        addPieceRandPos(op2, 2);
      }
    }

    if (cb.onStateChange) cb.onStateChange();
    if (cb.onScoreChange) cb.onScoreChange(score, highScore, moveNum);
    save();
  }

  // ---------------------------------------------------------------------------
  // onPieceMoved — central move handler (player AND engine)
  // ---------------------------------------------------------------------------
  function onPieceMoved(fromX, fromY, toX, toY, isEnPassant = false, promotionType = null) {
    const pieceType = board[fromX][fromY];
    if (pieceType === '') return;
    if (!findPiece(fromX, fromY)) return;

    // Track whether any capture happens this move
    let wasCapture = false;

    // --- Score & capture callback: black capturing white ---
    if (board[toX][toY] !== '' && isBlack(pieceType)) {
      wasCapture = true;
      addScore(getPieceValue(board[toX][toY]) * 10);
      fireCapture(toX, toY, board[toX][toY], pieceType);
    }

    // --- En-passant capture ---
    if (isEnPassant && pieceType.toLowerCase() === 'p') {
      const epCapX = toX, epCapY = fromY;
      if (board[epCapX][epCapY] !== '') {
        if (isBlack(pieceType)) {
          addScore(getPieceValue(board[epCapX][epCapY]) * 10);
          fireCapture(epCapX, epCapY, board[epCapX][epCapY], pieceType);
          wasCapture = true;
        }
        const capturedEP = findPiece(epCapX, epCapY);
        if (capturedEP && capturedEP.convertable) {
          pendingPlayerPiece = capturedEP.type.toUpperCase();
        }
        removePieceAt(epCapX, epCapY);
      }
    }

    // --- Update en-passant target ---
    if (pieceType.toLowerCase() === 'p' && Math.abs(toY - fromY) === 2) {
      enPassantTarget = [fromX, Math.floor((fromY + toY) / 2)];
    }

    // --- Normal capture ---
    if (board[toX][toY] !== '') {
      wasCapture = true;
      const capturedNormal = findPiece(toX, toY);
      if (capturedNormal && capturedNormal.convertable) {
        pendingPlayerPiece = capturedNormal.type.toUpperCase();
      }
      removePieceAt(toX, toY);
    }

    // --- Move the piece ---
    const movingPiece = findPiece(fromX, fromY);
    if (movingPiece) {
      movingPiece.animating = true;
      movingPiece.animFromX = fromX;
      movingPiece.animFromY = fromY;
      movingPiece.animToX   = toX;
      movingPiece.animToY   = toY;
      movingPiece.animT     = 0;
      board[fromX][fromY] = '';
      board[toX][toY]     = pieceType;
      movingPiece.x = toX;
      movingPiece.y = toY;
    }

    // --- Pawn promotion ---
    if (board[toX][toY].toUpperCase() === 'P' && (toY === 0 || toY === 7)) {
      const promPiece = findPiece(toX, toY);
      if (promPiece) {
        const chosenType = isBlack(pieceType) ? (promotionType || 'Q') : 'q';
        const newType = isBlack(pieceType) ? chosenType : 'q';
        promPiece.type  = newType;
        board[toX][toY] = newType;
        if (toY === 0) addScore(15);
        if (cb.onPromotion) cb.onPromotion({ col: toX, row: toY, type: newType });
      }
    }

    // --- Decrement movesUntilFormed for every piece ---
    for (const p of pieces) {
      if (p.movesUntilFormed > 0) {
        p.movesUntilFormed--;
        p.alpha = p.movesUntilFormed <= 0 ? 1.0 : 1.0 / (p.movesUntilFormed + 1);
      }
    }

    if (cb.onStateChange) cb.onStateChange();
    if (cb.onPieceMove) cb.onPieceMove({ wasCapture });

    // --- If the player (black) just moved, schedule engine response ---
    if (isBlack(board[toX][toY])) {
      lastPlayerMove = { from: [fromX, fromY], to: [toX, toY], piece: board[toX][toY] };
      moveNum++;
      if (cb.onScoreChange) cb.onScoreChange(score, highScore, moveNum);
      canMovePieces = false;

      const boardCopy  = board.map(col => [...col]);
      const awk        = makeAwakenessMap();
      const epCopy     = [...enPassantTarget];

      enPassantTarget = [-1, -1];

      const bestMove = engine.getBestMove(boardCopy, awk, epCopy);

      if (bestMove) {
        setTimeout(() => doEngineMove(bestMove), 500);
      } else {
        // getBestMove returns null both when no white pieces exist AND when all
        // white pieces are still forming (movesUntilFormed > 0). Only award the
        // "cleared" bonus if white pieces are truly absent from the board.
        const reallyCleared = boardCopy.every(col => col.every(c => c === '' || isBlack(c)));
        setTimeout(() => postMoveSpawn(reallyCleared), 500);
      }
    }
  }

  // ---------------------------------------------------------------------------
  // postMoveSpawn — spawn new opponent pieces + check game-over
  // Called after every engine turn (or immediately when no engine move exists)
  // ---------------------------------------------------------------------------
  function postMoveSpawn(clearedBoard = false) {
    // Pending conversion piece (captured convertable)
    if (pendingPlayerPiece !== null) {
      addPieceRandPos(pendingPlayerPiece, 2);
      pendingPlayerPiece = null;
    }

    // Game-over check (no black pieces or no legal moves)
    const blackPieces = countPieces(false);
    const awk = makeAwakenessMap();
    if (blackPieces === 0 || getAllMovesPlayer(board, awk, true, enPassantTarget).length === 0) {
      isInGame = false;
      canMovePieces = false;
      save();
      if (cb.onGameOver) cb.onGameOver(score, highScore);
      return;
    }

    const wp = countPieces(true);
    const bp = countPieces(false);

    if (clearedBoard || wp === 0) {
      // All opponent pieces cleared — give bonus and guaranteed fresh wave
      const bonus = 100;
      addScore(bonus);
      if (cb.onClearBoard) cb.onClearBoard(bonus);
      // Spawn a proper fresh wave (2-3 pieces)
      addRandomOppPiece(bp);
      addRandomOppPiece(bp);
      if (Math.random() < 0.6) addRandomOppPiece(bp);
    } else {
      // Spawn rate = OPP_SPAWN_PROBS × evalFactor.
      // evalFactor is inversely proportional to how badly the player is doing:
      // lastTurnEngineEval > 0 → white ahead (bad for player) → fewer spawns.
      const evalFactor = Math.max(0.1, Math.min(1.0, 1.0 - lastTurnEngineEval / 10));
      const idx = Math.min(wp, OPP_SPAWN_PROBS.length - 1);
      if (Math.random() < OPP_SPAWN_PROBS[idx] * evalFactor) addRandomOppPiece(bp);
    }

    canMovePieces = true;
    if (cb.onStateChange) cb.onStateChange();
    save();
  }

  // ---------------------------------------------------------------------------
  // doEngineMove — plays the engine's chosen move, spawns pieces, checks game over
  // ---------------------------------------------------------------------------
  function doEngineMove(engineMove) {
    // --- 4-tier move quality (eval swing favorable for player) ---
    const swing = engineMove.eval - lastTurnEngineEval;
    if (swing < 0) {
      addScore(-swing);
      for (const tier of QUALITY_TIERS) {
        if (swing < tier.threshold) {
          if (cb.onMoveQuality) cb.onMoveQuality(tier, swing);
          break;
        }
      }
      lastTurnEngineEval = engineMove.eval;
    }

    // --- Update EP target if engine pushed pawn 2 squares ---
    if (engineMove.isTwoSquarePawn) {
      enPassantTarget = [engineMove.from[0], Math.floor((engineMove.from[1] + engineMove.to[1]) / 2)];
    }

    // --- Execute engine move ---
    onPieceMoved(
      engineMove.from[0], engineMove.from[1],
      engineMove.to[0],   engineMove.to[1],
      engineMove.isEnPassant
    );

    // --- Post-move: spawning, game-over (delayed so capture animation plays first) ---
    setTimeout(() => postMoveSpawn(false), 560);
  }

  // ---------------------------------------------------------------------------
  // isValidMove
  // ---------------------------------------------------------------------------
  function isValidMove(fromX, fromY, toX, toY) {
    const moves = getMoves(fromX, fromY, board, enPassantTarget);
    return moves.some(m => m[0] === toX && m[1] === toY);
  }

  // ---------------------------------------------------------------------------
  // Save / Load
  // ---------------------------------------------------------------------------
  function save() {
    const piecesData = pieces.map(p => ({
      posX: p.x, posY: p.y, type: p.type,
      movesUntilFormed: p.movesUntilFormed,
      convertable: p.convertable,
    }));
    try {
      localStorage.setItem('chessArena_save', JSON.stringify({
        highScore, Pieces: piecesData, InGame: isInGame,
      }));
    } catch (e) { /* storage unavailable */ }
  }

  function load() {
    try {
      const raw = localStorage.getItem('chessArena_save');
      if (!raw) return false;
      const data = JSON.parse(raw);
      highScore = data.highScore || 0;
      isInGame  = data.InGame   || false;

      if (isInGame && data.Pieces && data.Pieces.length > 0) {
        emptyBoard();
        pieces = [];
        engine = new ChessEngine();
        enPassantTarget = [-1, -1];
        for (const pd of data.Pieces) {
          createPiece(
            parseInt(pd.posX), parseInt(pd.posY),
            pd.type, parseInt(pd.movesUntilFormed), !!pd.convertable
          );
        }
        return true;
      }
    } catch (e) { /* corrupted save */ }
    return false;
  }

  // ---------------------------------------------------------------------------
  // resetGame
  // ---------------------------------------------------------------------------
  function resetGame() {
    isInGame = false;
    emptyBoard();
    pieces = [];
    enPassantTarget = [-1, -1];
    canMovePieces = true;
    pendingPlayerPiece = null;
    lastPlayerMove = null;
    score = 0;
    moveNum = 0;
    lastTurnEngineEval = 0;
    save();
    initBoard();
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------
  return {
    get board()          { return board; },
    get pieces()         { return pieces; },
    get dyingPieces()    { return dyingPieces; },
    get enPassantTarget(){ return enPassantTarget; },
    get canMovePieces()  { return canMovePieces; },
    get score()          { return score; },
    get highScore()      { return highScore; },
    get moveNum()        { return moveNum; },
    get isInGame()       { return isInGame; },
    get lastPlayerMove() { return lastPlayerMove; },

    getMoves(x, y)   { return getMoves(x, y, board, enPassantTarget); },
    isValidMove,
    isBlack,
    isWhite,

    initBoard,
    load,
    save,
    resetGame,
    onPieceMoved,
    // Exposed so main.js can call with promotion choice
    onPieceMovedWithPromotion(fx, fy, tx, ty, ep, promoType) {
      return onPieceMoved(fx, fy, tx, ty, ep, promoType);
    },

    setCallbacks(callbacks) {
      Object.assign(cb, callbacks);
    },
  };

})();
