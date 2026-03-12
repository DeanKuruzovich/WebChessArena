'use strict';
// =============================================================================
// game.js — Game state, turn management, spawning, scoring, save/load
// Ported from Main.gd + Global.gd · Enhanced with VFX callbacks
// =============================================================================

const Game = (() => {

  const { isBlack, isWhite, getPieceValue, getMoves, getAllMovesPlayer, ChessEngine } = Engine;

  // Weighted random piece-type sampler — builds a distribution from { type: weight } objects.
  function weightedRandom(weights) {
    const types = Object.keys(weights);
    const total = types.reduce((sum, t) => sum + weights[t], 0);
    let r = Math.random() * total;
    for (const t of types) {
      r -= weights[t];
      if (r <= 0) return t;
    }
    return types[types.length - 1];
  }

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
  let killCount        = 0;
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
    onPieceMove    : null,   // ({wasCapture, isPlayerMove}) — fires for every completed move
    onPromotion    : null,
    onScoreChange  : null,
    onTurnStart    : null,   // fires when it is the player's turn to move
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

  function makeConvertableMap() {
    const map = Array.from({length: 8}, () => new Array(8).fill(false));
    for (const p of pieces) if (p.convertable) map[p.x][p.y] = true;
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
      alpha   : movesUntilFormed > 0 ? FINETUNE.formingAlpha : 1.0,
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
      // Black promotes at y=0 (moves toward y=0), so must spawn at y>=3 (3+ moves away).
      // White promotes at y=7 (moves toward y=7), so must spawn at y<=4 (3+ moves away).
      // Both player and opponent pawns spawn at least 3 moves from their promotion rank.
      const yMin = isBlkType ? 3 : 1;
      const yMax = isBlkType ? 6 : 4;

      // Pawns may only share a file with another pawn of the same color if they are
      // 4+ rows apart. Build the set of files that are already "blocked" by a nearby pawn.
      const blockedFiles = new Set();
      for (const p of pieces) {
        if (p.type.toLowerCase() === 'p' && isBlack(p.type) === isBlkType) {
          // Find candidate rows in this file and check if any would be < 4 away
          for (let cy = yMin; cy <= yMax; cy++) {
            if (Math.abs(cy - p.y) < 4) {
              blockedFiles.add(p.x);
              break;
            }
          }
        }
      }

      // Collect all valid squares
      const candidates = [];
      for (let cx = 0; cx < 8; cx++) {
        for (let cy = yMin; cy <= yMax; cy++) {
          if (board[cx][cy] !== '') continue;
          if (blockedFiles.has(cx)) continue;
          candidates.push([cx, cy]);
        }
      }
      if (candidates.length === 0) return null;
      const pick = candidates[Math.floor(Math.random() * candidates.length)];
      x = pick[0]; y = pick[1];
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
    const type  = weightedRandom(FINETUNE.oppPieceWeights);
    const piece = addPieceRandPos(type, FINETUNE.formingMoves);
    if (!piece) return null;
    // No stars spawn while player is at or above the soft piece cap.
    // Player can still exceed the cap by capturing stars already on the board.
    if (blackPieceCount >= FINETUNE.playerPieceSoftMax) return piece;
    // Star (convertable) probability:
    //   base + eval/divisor (player losing → eval>0 → more stars to help recovery)
    //   scaled by starChanceScaler * starChanceScalerScaler^moveNum (compounds each turn)
    const bp   = Math.max(1, blackPieceCount);
    const rawStarProb = Math.max(
      FINETUNE.starMinProb,
      Math.min(FINETUNE.starMaxProb,
        FINETUNE.starBaseProb
        + lastTurnEngineEval / FINETUNE.evalStarDivisor
      )
    );
    const prob = rawStarProb * FINETUNE.starChanceScaler
      * Math.pow(FINETUNE.starChanceScalerScaler, moveNum);
    if (Math.random() < prob) piece.convertable = true;
    return piece;
  }

  // ---------------------------------------------------------------------------
  // Score helpers
  // ---------------------------------------------------------------------------
  function addScore(delta) {
    score += delta;
    if (score > highScore) highScore = score;
    if (cb.onScoreChange) cb.onScoreChange(score, highScore, moveNum, killCount);
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
    killCount = 0;
    moveNum = 0;
    enPassantTarget = [-1, -1];
    canMovePieces = true;
    lastTurnEngineEval = 0;
    pendingPlayerPiece = null;
    lastPlayerMove = null;
    isInGame = true;
    engine = new ChessEngine();

    // --- Player starting pieces ---
    // Two pieces sampled from playerPieceWeights (0-weight types are excluded).
    // No two Kings allowed. Two Bishops get placed on opposite-colored squares.
    const p1 = weightedRandom(FINETUNE.playerPieceWeights);
    let p2;
    do { p2 = weightedRandom(FINETUNE.playerPieceWeights); }
    while (p1 === 'K' && p2 === 'K');

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

    // --- Opponent starting pieces (mirrored player logic) ---
    // Option A (50%): pawn + queen or rook
    // Option B (50%): 2 from {knight, bishop, king}
    if (Math.random() < 0.5) {
      addPieceRandPos('p', FINETUNE.formingMoves);
      addPieceRandPos(Math.random() < 0.5 ? 'q' : 'r', FINETUNE.formingMoves);
    } else {
      const oppPool = ['n', 'b', 'k'];
      const op1 = oppPool[Math.floor(Math.random() * 3)];
      let op2;
      do { op2 = oppPool[Math.floor(Math.random() * 3)]; }
      while (op1 === 'k' && op2 === 'k');
      const oppPlaced1 = addPieceRandPos(op1, FINETUNE.formingMoves);
      if (op1 === 'b' && op2 === 'b' && oppPlaced1) {
        const tgt = 1 - ((oppPlaced1.x + oppPlaced1.y) % 2);
        let ox2, oy2, att2 = 0;
        do {
          ox2 = Math.floor(Math.random() * 8);
          oy2 = Math.floor(Math.random() * 8);
          att2++;
        } while ((board[ox2][oy2] !== '' || (ox2 + oy2) % 2 !== tgt) && att2 < 64);
        if (board[ox2][oy2] === '') createPiece(ox2, oy2, 'b', FINETUNE.formingMoves);
      } else {
        addPieceRandPos(op2, FINETUNE.formingMoves);
      }
    }

    // --- Debug mode ---
    if (FINETUNE.debugMode) {
      if (FINETUNE.debugBoard) {
        // Load exact position from finetune.debugBoard / debugAwakenessMap
        emptyBoard();
        pieces = [];
        for (let col = 0; col < 8; col++) {
          for (let row = 0; row < 8; row++) {
            const type = FINETUNE.debugBoard[col][row];
            if (type && type !== '') {
              const forming = FINETUNE.debugAwakenessMap
                ? (FINETUNE.debugAwakenessMap[col][row] || 0)
                : 0;
              createPiece(col, row, type, forming);
            }
          }
        }
      } else {
        // Fallback: force one normal, one faded, one star piece
        const debugType = weightedRandom(FINETUNE.oppPieceWeights);
        const debugNormal = addPieceRandPos(debugType, 0);
        const debugFading = addPieceRandPos(debugType, FINETUNE.formingMoves);
        const debugStar   = addPieceRandPos(debugType, 0);
        if (debugStar) debugStar.convertable = true;
      }
    }

    if (cb.onStateChange) cb.onStateChange();
    if (cb.onScoreChange) cb.onScoreChange(score, highScore, moveNum, killCount);
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

    // --- Score & capture callback ---
    if (board[toX][toY] !== '') {
      wasCapture = true;
      if (isBlack(pieceType)) {
        killCount++;
        addScore(Math.round(getPieceValue(board[toX][toY]) * 10 * FINETUNE.scoreScaleFactor));
      }
      fireCapture(toX, toY, board[toX][toY], pieceType);
    }

    // --- En-passant capture ---
    if (isEnPassant && pieceType.toLowerCase() === 'p') {
      const epCapX = toX, epCapY = fromY;
      if (board[epCapX][epCapY] !== '') {
        wasCapture = true;
        if (isBlack(pieceType)) {
          killCount++;
          addScore(Math.round(getPieceValue(board[epCapX][epCapY]) * 10 * FINETUNE.scoreScaleFactor));
        }
        fireCapture(epCapX, epCapY, board[epCapX][epCapY], pieceType);
        const capturedEP = findPiece(epCapX, epCapY);
        if (capturedEP && capturedEP.convertable) {
          pendingPlayerPiece = weightedRandom(FINETUNE.playerPieceWeights);
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
        pendingPlayerPiece = weightedRandom(FINETUNE.playerPieceWeights);
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
        if (toY === 0) addScore(Math.round(15 * FINETUNE.scoreScaleFactor));
        if (cb.onPromotion) cb.onPromotion({ col: toX, row: toY, type: newType });
      }
    }

    // movesUntilFormed is now decremented in postMoveSpawn (after the engine
    // has already moved) so a piece can never activate AND move in the same turn.

    if (cb.onStateChange) cb.onStateChange();
    if (cb.onPieceMove) cb.onPieceMove({ wasCapture, isPlayerMove: isBlack(board[toX][toY]) });

    // --- If the player (black) just moved, schedule engine response ---
    if (isBlack(board[toX][toY])) {
      lastPlayerMove = { from: [fromX, fromY], to: [toX, toY], piece: board[toX][toY] };
      moveNum++;
      if (cb.onScoreChange) cb.onScoreChange(score, highScore, moveNum, killCount);
      canMovePieces = false;

      const boardCopy  = board.map(col => [...col]);
      const awk        = makeAwakenessMap();
      const convMap    = makeConvertableMap();
      const epCopy     = [...enPassantTarget];

      enPassantTarget = [-1, -1];

      const bestMove = engine.getBestMove(boardCopy, awk, convMap, epCopy);

      if (bestMove) {
        setTimeout(() => doEngineMove(bestMove), 500);
      } else {
        // No engine move — recompute eval from current board state
        lastTurnEngineEval = engine.evaluate(board);
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
    // Advance forming pieces now that a full turn has elapsed.
    // Running BEFORE spawns means newly-placed pieces aren't decremented this turn.
    // Running AFTER the engine has already evaluated means the engine always saw
    // movesUntilFormed > 0 and could not have moved these pieces.
    for (const p of pieces) {
      if (p.movesUntilFormed > 0) {
        p.movesUntilFormed--;
        p.alpha = p.movesUntilFormed <= 0 ? 1.0 : FINETUNE.formingAlpha;
      }
    }

    // Pending conversion piece (captured convertable)
    if (pendingPlayerPiece !== null) {
      addPieceRandPos(pendingPlayerPiece, FINETUNE.formingMoves);
      pendingPlayerPiece = null;
    }

    const wp = countPieces(true);
    const bp = countPieces(false);

    // ---------------------------------------------------------------------------
    // Equilibrium spawning:
    //   Player winning (eval < 0)  →  evalFactor > 1  →  more enemies, fewer stars
    //   Player losing  (eval > 0)  →  evalFactor < 1  →  fewer enemies, more stars
    // ---------------------------------------------------------------------------
    const rawFactor = 1.0 - lastTurnEngineEval / FINETUNE.evalSpawnDivisor;
    const evalFactor = Math.max(
      FINETUNE.minSpawnFactor,
      Math.min(FINETUNE.maxSpawnFactor, rawFactor)
    ) * FINETUNE.spawnFactorScaler * Math.pow(FINETUNE.spawnFactorScalerScaler, moveNum)
      * Math.pow(FINETUNE.oppPieceNumberScaleDownFact, wp);

    // Hard cap: no new spawns when already at or above maxOppPieces
    if (wp >= FINETUNE.maxOppPieces) {
      // skip spawning
    } else if (wp === 0) {
      // Board just emptied — re-populate quietly (no bonus, no VFX)
      addRandomOppPiece(bp);
      addRandomOppPiece(bp);
      const extraProb = 0.55 * evalFactor;
      const guaranteed = Math.floor(extraProb);
      for (let i = 0; i < guaranteed; i++) addRandomOppPiece(bp);
      if (Math.random() < extraProb - guaranteed) addRandomOppPiece(bp);
    } else {
      const spawnProb = evalFactor;
      const guaranteed = Math.floor(spawnProb);
      for (let i = 0; i < guaranteed; i++) addRandomOppPiece(bp);
      if (Math.random() < spawnProb - guaranteed) addRandomOppPiece(bp);
    }

    // -------------------------------------------------------------------------
    // "Miracle" spawn: a lifeline for the player when all hope is lost.
    //
    // Triggers when EITHER of the following is true:
    //   A. Player has exactly 1 active piece and it isn't a Queen, OR
    //   B. Player has 3 or fewer active pieces AND is down 4+ material vs opponent
    //
    // Plus ALL of:
    //   - That piece / the single hero cannot already capture any existing ★ pieces
    //   - The opponent is a serious threat:
    //       - more than 2 enemy pieces, OR
    //       - 2+ enemy pieces including at least one queen or rook
    //
    // Effect (with probability FINETUNE.miracleProb):
    //   A new ★ opponent piece spawns on a square that:
    //     - the hero piece can legally move to
    //     - is NOT currently attacked by any enemy piece (safe landing)
    //   Spawns with the normal forming delay so the player sees it coming.
    // -------------------------------------------------------------------------
    const activePieces = pieces.filter(p => isBlack(p.type) && p.movesUntilFormed === 0);
    const enemyPieces  = pieces.filter(p => isWhite(p.type));
    const playerMaterial = activePieces.reduce((s, p) => s + getPieceValue(p.type), 0);
    const enemyMaterial  = enemyPieces.reduce((s, p) => s + getPieceValue(p.type), 0);
    const materialDeficit = enemyMaterial - playerMaterial;

    const singleHero    = activePieces.length === 1 && activePieces[0].type !== 'Q';
    const desperateMode = activePieces.length >= 1 && activePieces.length <= 3 && materialDeficit >= 3;
    const miracleChance = moveNum <= 5 ? FINETUNE.miracleFirstFiveTurns : FINETUNE.miracleProb;

    if (singleHero || desperateMode) {
      // Pick a hero piece to base the miracle square on:
      // single-hero: that piece; desperate: lowest-value active piece
      const hero = singleHero
        ? activePieces[0]
        : activePieces.reduce((a, b) => Engine.getPieceValue(a.type) <= Engine.getPieceValue(b.type) ? a : b);

      // Can the hero already reach a ★ piece this turn?
      const heroMoves = getMoves(hero.x, hero.y, board, enPassantTarget);
      const canAlreadyTakeStar = heroMoves.some(([mx, my]) => {
        const target = pieces.find(p => p.x === mx && p.y === my && !isBlack(p.type));
        return target && target.convertable;
      });

      if (!canAlreadyTakeStar) {
        const isThreatening = enemyPieces.length > 2 ||
          (enemyPieces.length >= 2 &&
           enemyPieces.some(p => p.type === 'q' || p.type === 'r'));

        if (isThreatening && Math.random() < miracleChance) {
          // Collect all squares currently attacked by enemy pieces
          const enemyAttacked = new Set();
          for (const ep of enemyPieces) {
            for (const [mx, my] of getMoves(ep.x, ep.y, board, enPassantTarget)) {
              enemyAttacked.add(`${mx},${my}`);
            }
          }

          // Candidate squares: hero can legally move there, empty, not enemy-attacked
          const candidates = heroMoves.filter(([mx, my]) =>
            board[mx][my] === '' && !enemyAttacked.has(`${mx},${my}`)
          );

          if (candidates.length > 0) {
            const [sx, sy] = candidates[Math.floor(Math.random() * candidates.length)];
            const mType = weightedRandom(FINETUNE.oppPieceWeights);
            const mp = createPiece(sx, sy, mType, FINETUNE.formingMoves);
            if (mp) mp.convertable = true;
          }
        }
      }
    }

    // Game-over check (no black pieces or no legal moves)
    // Runs AFTER all spawning so a newly-placed blocking piece is included.
    // Use the real awakeness map so forming (undeveloped) pieces are correctly
    // treated as unable to move — if the player has no moves right now, game over.
    const blackPieces = countPieces(false);
    const realAwakenessMap = makeAwakenessMap();
    const anyMoveNow = getAllMovesPlayer(board, realAwakenessMap, true, enPassantTarget).length > 0;
    if (blackPieces === 0 || !anyMoveNow) {
      isInGame = false;
      canMovePieces = false;
      save();
      if (cb.onGameOver) cb.onGameOver(score, highScore);
      return;
    }

    canMovePieces = true;
    if (cb.onTurnStart) cb.onTurnStart();
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
    }
    // Always update eval so debug HUD + spawn balancing stay current
    lastTurnEngineEval = engineMove.eval;

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
    killCount = 0;
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
    get killCount()      { return killCount; },
    get moveNum()        { return moveNum; },
    get isInGame()       { return isInGame; },
    get lastPlayerMove() { return lastPlayerMove; },
    get lastTurnEngineEval() { return lastTurnEngineEval; },

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

    // Inject a score bonus from outside (e.g. move-time bonus from main.js)
    addBonusScore(pts) { addScore(pts); },
  };

})();
