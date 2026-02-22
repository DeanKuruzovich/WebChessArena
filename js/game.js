'use strict';
// =============================================================================
// game.js — Game state, turn management, spawning, scoring, save/load
// Ported 1-to-1 from Main.gd + Global.gd
// =============================================================================

const Game = (() => {

  const { isBlack, isWhite, getPieceValue, getMoves, getAllMovesPlayer, ChessEngine } = Engine;

  // White-piece spawn distribution (lowercase = white AI pieces)
  // Mirrors normalPieceDistribution in Main.gd
  const PIECE_DIST = ['p','p','p','p','p','p','k','q','r','r','n','n','n','b','b','b'];

  // ---------------------------------------------------------------------------
  // Mutable state
  // ---------------------------------------------------------------------------
  let board    = [];   // board[x][y] = piece string | ''
  let pieces   = [];   // Array of piece objects (see createPiece)
  let enPassantTarget  = [-1, -1];
  let canMovePieces    = true;
  let score            = 0;
  let highScore        = 0;
  let moveNum          = 0;
  let isInGame         = false;
  let lastTurnEngineEval = 0;
  let pendingPlayerPiece = null;  // type string (uppercase black) to spawn after engine moves
  let engine           = null;

  // Callbacks set by main.js
  const cb = {
    onStateChange : null,   // ()
    onGameOver    : null,   // (score, highScore)
    onGreatMove   : null,   // ()
    onGoodMove    : null,   // ()
    onScoreChange : null,   // (score, highScore, moveNum)
  };

  // ---------------------------------------------------------------------------
  // Board helpers
  // ---------------------------------------------------------------------------
  function emptyBoard() {
    board = Array.from({length: 8}, () => new Array(8).fill(''));
  }

  function findPiece(x, y) {
    return pieces.find(p => p.x === x && p.y === y) || null;
  }

  function removePieceAt(x, y) {
    board[x][y] = '';
    pieces = pieces.filter(p => !(p.x === x && p.y === y));
  }

  // countPieces mirrors Main.gd:
  //   countPieces(true)  → count white (AI) pieces
  //   countPieces(false) → count black (player) pieces
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
    if (board[x][y] !== '') return null; // Safety: don't double-place
    const piece = {
      x, y, type, movesUntilFormed, convertable,
      // Visual state (used by main.js renderer)
      alpha   : movesUntilFormed > 0 ? 1.0 / (movesUntilFormed + 1) : 1.0,
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
      // Black pawns spawn at y 0-1; white pawns at y 6-7 (push immediately)
      const yMin = isBlkType ? 0 : 6;
      const yMax = isBlkType ? 1 : 7;
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

    if (board[x][y] !== '') return null; // Board full (shouldn't happen normally)
    return createPiece(x, y, type, movesUntilFormed);
  }

  function addRandomOppPiece(blackPieceCount = 5) {
    const type = PIECE_DIST[Math.floor(Math.random() * PIECE_DIST.length)]; // lowercase = white
    const piece = addPieceRandPos(type, 3);
    if (!piece) return null;
    // Chance to make convertable (higher when player has fewer pieces)
    const rand = Math.floor(Math.random() * 21);
    if ((blackPieceCount === 4 && rand === 0) ||
        (blackPieceCount === 3 && rand < 3)   ||
        (blackPieceCount < 3  && rand < 6)) {
      piece.convertable = true;
    }
    return piece;
  }

  // ---------------------------------------------------------------------------
  // Update score helpers
  // ---------------------------------------------------------------------------
  function addScore(delta) {
    score += delta;
    if (score > highScore) highScore = score;
    if (cb.onScoreChange) cb.onScoreChange(score, highScore, moveNum);
  }

  // ---------------------------------------------------------------------------
  // initBoard — fresh game (mirrors Main.gd _ready when !isInGame)
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
    isInGame = true;
    engine = new ChessEngine();

    // 1 black pawn at (5, 6)
    createPiece(5, 6, 'P', 0);

    // 1 extra black piece (random from distribution, uppercase = black)
    const extraBlackType = PIECE_DIST[Math.floor(Math.random() * PIECE_DIST.length)].toUpperCase();
    addPieceRandPos(extraBlackType, 0);

    // 3 white opponent pieces (movesUntilFormed=3 inside addRandomOppPiece)
    addRandomOppPiece();
    addRandomOppPiece();
    addRandomOppPiece();

    if (cb.onStateChange) cb.onStateChange();
    save();
  }

  // ---------------------------------------------------------------------------
  // onPieceMoved — central move handler (mirrors Main.gd _piece_moved)
  // Called for BOTH player and engine moves.
  // ---------------------------------------------------------------------------
  function onPieceMoved(fromX, fromY, toX, toY, isEnPassant = false) {
    const pieceType = board[fromX][fromY];
    if (pieceType === '') return;
    if (!findPiece(fromX, fromY)) return;

    // --- Score: black capturing white ---
    if (board[toX][toY] !== '' && isBlack(pieceType)) {
      addScore(getPieceValue(board[toX][toY]) * 10);
    }

    // --- En-passant capture ---
    if (isEnPassant && pieceType.toLowerCase() === 'p') {
      const epCapX = toX, epCapY = fromY;
      if (board[epCapX][epCapY] !== '') {
        if (isBlack(pieceType)) {
          addScore(getPieceValue(board[epCapX][epCapY]) * 10);
        }
        const capturedEP = findPiece(epCapX, epCapY);
        if (capturedEP && capturedEP.convertable) {
          pendingPlayerPiece = capturedEP.type.toUpperCase();
        }
        removePieceAt(epCapX, epCapY);
      }
    }

    // --- Update en-passant target ---
    // Only update EP target on a 2-square pawn push; do NOT clear it here
    // (clearing happens explicitly at end of player turn in the block below)
    if (pieceType.toLowerCase() === 'p' && Math.abs(toY - fromY) === 2) {
      enPassantTarget = [fromX, Math.floor((fromY + toY) / 2)];
    }

    // --- Normal capture ---
    if (board[toX][toY] !== '') {
      const capturedNormal = findPiece(toX, toY);
      if (capturedNormal && capturedNormal.convertable) {
        pendingPlayerPiece = capturedNormal.type.toUpperCase();
      }
      removePieceAt(toX, toY);
    }

    // --- Move the piece ---
    const movingPiece = findPiece(fromX, fromY);
    if (movingPiece) {
      // Set up smooth animation for renderer
      movingPiece.animating = true;
      movingPiece.animFromX = fromX;
      movingPiece.animFromY = fromY;
      movingPiece.animToX   = toX;
      movingPiece.animToY   = toY;
      movingPiece.animT     = 0;
      // Update logical position immediately
      board[fromX][fromY] = '';
      board[toX][toY]     = pieceType;
      movingPiece.x = toX;
      movingPiece.y = toY;
    }

    // --- Pawn promotion ---
    if (board[toX][toY].toUpperCase() === 'P' && (toY === 0 || toY === 7)) {
      const promPiece = findPiece(toX, toY);
      if (promPiece) {
        const newType = isBlack(pieceType) ? 'Q' : 'q';
        promPiece.type  = newType;
        board[toX][toY] = newType;
        if (toY === 0) addScore(15); // Black promotes
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

    // --- If the player (black) just moved, schedule engine response ---
    if (isBlack(board[toX][toY])) {
      moveNum++;
      if (cb.onScoreChange) cb.onScoreChange(score, highScore, moveNum);
      canMovePieces = false;

      // Run engine synchronously in a Worker-friendly way
      // (getBestMove is ~depth-3, fast enough on main thread with setTimeout deferral)
      const boardCopy  = board.map(col => [...col]);
      const awk        = makeAwakenessMap();
      const epCopy     = [...enPassantTarget];

      // Clear EP target now (engine already got a copy)
      enPassantTarget = [-1, -1];

      const bestMove = engine.getBestMove(boardCopy, awk, epCopy);

      if (bestMove) {
        setTimeout(() => doEngineMove(bestMove), 500);
      } else {
        // Engine has no moves — player wins? (Unusual but handle gracefully)
        canMovePieces = true;
      }
    }
  }

  // ---------------------------------------------------------------------------
  // doEngineMove — plays the engine's chosen move, spawns pieces, checks game over
  // Mirrors Main.gd _do_engine_move
  // ---------------------------------------------------------------------------
  function doEngineMove(engineMove) {
    // --- Score great/good moves (eval swing favorable for player) ---
    const swing = engineMove.eval - lastTurnEngineEval;
    if (swing < 0) {
      addScore(-swing);
      if (swing < -6 && cb.onGreatMove) cb.onGreatMove();
      else if (swing < -3 && cb.onGoodMove) cb.onGoodMove();
      lastTurnEngineEval = engineMove.eval;
    }

    // --- Update EP target if engine pushed pawn 2 squares ---
    if (engineMove.isTwoSquarePawn) {
      enPassantTarget = [engineMove.from[0], Math.floor((engineMove.from[1] + engineMove.to[1]) / 2)];
    }

    // --- Execute engine move (goes through same onPieceMoved pipeline) ---
    onPieceMoved(
      engineMove.from[0], engineMove.from[1],
      engineMove.to[0],   engineMove.to[1],
      engineMove.isEnPassant
    );

    // --- Post-move: spawning, game-over (deferred by 0ms so animation starts) ---
    setTimeout(() => {
      // Spawn pending player piece from convertable capture
      if (pendingPlayerPiece !== null) {
        addPieceRandPos(pendingPlayerPiece, 2);
        pendingPlayerPiece = null;
      }

      // Game-over check
      const blackPieces = countPieces(false); // false → count black player pieces
      const awk = makeAwakenessMap();
      if (blackPieces === 0 || getAllMovesPlayer(board, awk, true, enPassantTarget).length === 0) {
        isInGame = false;
        canMovePieces = false;
        save();
        if (cb.onGameOver) cb.onGameOver(score, highScore);
        return;
      }

      // Spawn more white pieces to maintain pressure (mirrors Main.gd thresholds)
      const wp = countPieces(true);  // count white pieces
      const bp = countPieces(false); // count black pieces
      if (wp < 5 && Math.random() * 3 < 0.5) addRandomOppPiece(bp);
      if (wp < 4 && Math.random() * 3 < 0.5) addRandomOppPiece(bp);
      if (wp < 3 && Math.random() * 3 < 0.5) addRandomOppPiece(bp);
      if (wp < 2)                             addRandomOppPiece(bp);

      canMovePieces = true;
      if (cb.onStateChange) cb.onStateChange();
      save();
    }, 0);
  }

  // ---------------------------------------------------------------------------
  // isValidMove — validates a player drag (delegates to getMoves)
  // ---------------------------------------------------------------------------
  function isValidMove(fromX, fromY, toX, toY) {
    const moves = getMoves(fromX, fromY, board, enPassantTarget);
    return moves.some(m => m[0] === toX && m[1] === toY);
  }

  // ---------------------------------------------------------------------------
  // Save / Load (localStorage, same schema as Data/Save.json)
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
  // resetGame — clear state, start fresh
  // ---------------------------------------------------------------------------
  function resetGame() {
    isInGame = false;
    emptyBoard();
    pieces = [];
    enPassantTarget = [-1, -1];
    canMovePieces = true;
    pendingPlayerPiece = null;
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
    // State accessors (read-only from outside)
    get board()          { return board; },
    get pieces()         { return pieces; },
    get enPassantTarget(){ return enPassantTarget; },
    get canMovePieces()  { return canMovePieces; },
    get score()          { return score; },
    get highScore()      { return highScore; },
    get moveNum()        { return moveNum; },
    get isInGame()       { return isInGame; },

    // Engine helpers (needed by renderer)
    getMoves(x, y)   { return getMoves(x, y, board, enPassantTarget); },
    isValidMove,
    isBlack,
    isWhite,

    // Lifecycle
    initBoard,
    load,
    save,
    resetGame,
    onPieceMoved,

    // Callback registration
    setCallbacks(callbacks) {
      Object.assign(cb, callbacks);
    },
  };

})();
