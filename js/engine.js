'use strict';
// =============================================================================
// engine.js — Chess AI: move generation + alpha-beta minimax (depth 3)
// Ported 1-to-1 from Engine.gd + Global.gd
//
// Piece encoding:
//   Black (human player) = UPPERCASE:  P Q K R N B
//   White (AI engine)    = lowercase:  p q k r n b
// =============================================================================

const Engine = (() => {

  const MAX_DEPTH = 3;

  const PIECE_VALUES = { p: 1.5, r: 4.79, n: 2.40, b: 3.20, q: 9.29, k: 3.0 };

  // ---------------------------------------------------------------------------
  // Helpers (mirrors Global.gd)
  // ---------------------------------------------------------------------------

  function isBlack(s) { return s !== '' && s === s.toUpperCase(); }
  function isWhite(s) { return s !== '' && s !== s.toUpperCase(); }

  function getPieceValue(piece) {
    return PIECE_VALUES[piece.toLowerCase()] !== undefined
      ? PIECE_VALUES[piece.toLowerCase()]
      : 4.0;
  }

  // ---------------------------------------------------------------------------
  // Move-legality helper
  // ---------------------------------------------------------------------------

  function simpleMoveCheck(ox, oy, nx, ny, board) {
    if (nx < 0 || nx > 7 || ny < 0 || ny > 7) return false;
    const t = board[nx][ny];
    if (t === '') return true;
    return isBlack(board[ox][oy]) !== isBlack(t);
  }

  // ---------------------------------------------------------------------------
  // Piece-specific move generators (mirrors Engine.gd)
  // Each returns Array of [col, row]
  // ---------------------------------------------------------------------------

  function rookMoves(x, y, board) {
    const out = [];
    for (const [dx, dy] of [[1,0],[-1,0],[0,1],[0,-1]]) {
      for (let i = 1; i < 8; i++) {
        const nx = x + dx * i, ny = y + dy * i;
        if (!simpleMoveCheck(x, y, nx, ny, board)) break;
        out.push([nx, ny]);
        if (board[nx][ny] !== '') break;
      }
    }
    return out;
  }

  function bishopMoves(x, y, board) {
    const out = [];
    for (const [dx, dy] of [[1,1],[-1,1],[1,-1],[-1,-1]]) {
      for (let i = 1; i < 8; i++) {
        const nx = x + dx * i, ny = y + dy * i;
        if (!simpleMoveCheck(x, y, nx, ny, board)) break;
        out.push([nx, ny]);
        if (board[nx][ny] !== '') break;
      }
    }
    return out;
  }

  function knightMoves(x, y, board) {
    const out = [];
    for (const [dx, dy] of [[2,1],[1,2],[-2,1],[-1,2],[2,-1],[1,-2],[-2,-1],[-1,-2]]) {
      const nx = x + dx, ny = y + dy;
      if (simpleMoveCheck(x, y, nx, ny, board)) out.push([nx, ny]);
    }
    return out;
  }

  function kingMoves(x, y, board) {
    const out = [];
    for (const [dx, dy] of [[1,1],[1,0],[1,-1],[0,1],[0,-1],[-1,1],[-1,0],[-1,-1]]) {
      const nx = x + dx, ny = y + dy;
      if (simpleMoveCheck(x, y, nx, ny, board)) out.push([nx, ny]);
    }
    return out;
  }

  function pawnMoves(x, y, board, epTarget) {
    const out = [];
    const isBlk = isBlack(board[x][y]);
    const dir = isBlk ? -1 : 1;   // black moves toward y=0, white toward y=7
    const ny = y + dir;
    if (ny < 0 || ny > 7) return out;

    // Forward one square
    if (board[x][ny] === '') {
      out.push([x, ny]);
      // Forward two from starting ranks (pieces spawn on edge rows too)
      const can2 = isBlk ? (y === 6 || y === 7) : (y === 0 || y === 1);
      const ny2 = y + dir * 2;
      if (can2 && ny2 >= 0 && ny2 <= 7 && board[x][ny2] === '') out.push([x, ny2]);
    }

    // Diagonal captures
    if (x < 7 && board[x+1][ny] !== '' && isBlack(board[x+1][ny]) !== isBlk) out.push([x+1, ny]);
    if (x > 0 && board[x-1][ny] !== '' && isBlack(board[x-1][ny]) !== isBlk) out.push([x-1, ny]);

    // En passant
    if (epTarget && epTarget[0] !== -1 && ny === epTarget[1]) {
      const ecx = epTarget[0];
      if (x + 1 === ecx || x - 1 === ecx) {
        const epPiece = board[ecx][y];
        if (epPiece !== '' && epPiece.toLowerCase() === 'p' && isBlack(epPiece) !== isBlk) {
          out.push([ecx, ny]);
        }
      }
    }

    return out;
  }

  // Public: get all legal destination squares for the piece at (x, y)
  function getMoves(x, y, board, epTarget) {
    if (!epTarget) epTarget = [-1, -1];
    const p = board[x][y];
    const t = p.toLowerCase();
    if (t === 'p') return pawnMoves(x, y, board, epTarget);
    if (t === 'r') return rookMoves(x, y, board);
    if (t === 'n') return knightMoves(x, y, board);
    if (t === 'b') return bishopMoves(x, y, board);
    if (t === 'q') return [...rookMoves(x, y, board), ...bishopMoves(x, y, board)];
    return kingMoves(x, y, board);  // k
  }

  // Public: all moves for one side (used for game-over check)
  // isBlackSide=true → black player moves, isBlackSide=false → white AI moves
  function getAllMovesPlayer(board, awakenessMap, isBlackSide, epTarget) {
    if (!epTarget) epTarget = [-1, -1];
    const out = [];
    for (let i = 0; i < 8; i++) {
      for (let j = 0; j < 8; j++) {
        const p = board[i][j];
        if (p !== '' && isBlack(p) === isBlackSide && awakenessMap[i][j] <= 0) {
          const targets = getMoves(i, j, board, epTarget);
          for (const t of targets) out.push([i, j, t[0], t[1]]);
        }
      }
    }
    return out;
  }

  // ---------------------------------------------------------------------------
  // ChessEngine — alpha-beta minimax (mirrors Engine.gd exactly)
  // White = engine/maximizer, Black = player/minimizer
  // Eval = whitePoints − blackPoints
  // ---------------------------------------------------------------------------

  class ChessEngine {

    constructor() {
      this._mat = 0;
      this._undoStrs = [];
    }

    // -----------------------------------------------------------------------
    // Public: returns best move for white {from:[x,y], to:[x,y], eval, isEnPassant, isTwoSquarePawn}
    // or null if no moves available
    // -----------------------------------------------------------------------
    getBestMove(board, awakenessMap, epTarget) {
      if (!epTarget) epTarget = [-1, -1];
      this._mat = this._computeMaterial(board);
      this._undoStrs = [];

      // Generate root moves (white = engine side)
      const rootMoves = [];
      for (let i = 0; i < 8; i++) {
        for (let j = 0; j < 8; j++) {
          const p = board[i][j];
          if (p !== '' && isWhite(p) && awakenessMap[i][j] <= 0) {
            const targets = getMoves(i, j, board, epTarget);
            for (const t of targets) {
              const mv = {
                from: [i, j], to: [t[0], t[1]], eval: 0,
                isEnPassant: false, isTwoSquarePawn: false
              };
              if (p.toLowerCase() === 'p') {
                if (t[0] !== i && board[t[0]][t[1]] === '') mv.isEnPassant = true;
                if (Math.abs(t[1] - j) === 2)              mv.isTwoSquarePawn = true;
              }
              rootMoves.push(mv);
            }
          }
        }
      }

      if (rootMoves.length === 0) return null;

      // Sort: captures first (better pruning)
      rootMoves.sort((a, b) => {
        const aCap = board[a.to[0]][a.to[1]] !== '' || a.isEnPassant;
        const bCap = board[b.to[0]][b.to[1]] !== '' || b.isEnPassant;
        if (aCap && !bCap) return -1;
        if (!aCap && bCap) return 1;
        if (aCap && bCap) {
          return getPieceValue(board[b.to[0]][b.to[1]]) - getPieceValue(board[a.to[0]][a.to[1]]);
        }
        return 0;
      });

      let bestMove = null;
      let bestVal = -Infinity;

      for (const mv of rootMoves) {
        const undo = this._makeMoveFast(mv.from[0], mv.from[1], mv.to[0], mv.to[1], mv.isEnPassant, board, awakenessMap);
        const nextEp = mv.isTwoSquarePawn
          ? [mv.from[0], Math.floor((mv.from[1] + mv.to[1]) / 2)]
          : [-1, -1];
        const val = this._alphaBeta(board, awakenessMap, 1, MAX_DEPTH, -Infinity, Infinity, false, nextEp);
        this._unmakeMoveFast(undo, board, awakenessMap);
        mv.eval = val;
        if (val > bestVal || (val === bestVal && Math.random() < 0.33)) {
          bestVal = val;
          bestMove = mv;
        }
      }

      return bestMove;
    }

    // -----------------------------------------------------------------------
    // Alpha-beta inner search — uses raw flat arrays (no Move allocations)
    // Raw format: [fx, fy, tx, ty, flags, ...] groups of 5
    // flags: bit0 = en-passant, bit1 = two-square pawn push
    // isEngine = true means white to move (maximizer)
    // -----------------------------------------------------------------------
    _alphaBeta(board, awk, depth, maxD, alpha, beta, isEngine, epTarget) {
      if (depth >= maxD) return this._mat;

      const raw = this._genMovesRaw(board, awk, isEngine, depth, epTarget);
      const count = Math.floor(raw.length / 5);

      if (count === 0) return isEngine ? -100.0 : 100.0;

      this._orderMovesRaw(raw, count, board);

      if (isEngine) {
        let maxEval = -Infinity;
        for (let idx = 0; idx < count; idx++) {
          const b = idx * 5;
          const isEP  = (raw[b+4] & 1) !== 0;
          const is2sq = (raw[b+4] & 2) !== 0;
          const undo = this._makeMoveFast(raw[b], raw[b+1], raw[b+2], raw[b+3], isEP, board, awk);
          const nextEp = is2sq ? [raw[b], Math.floor((raw[b+1] + raw[b+3]) / 2)] : [-1, -1];
          const val = this._alphaBeta(board, awk, depth + 1, maxD, alpha, beta, false, nextEp);
          this._unmakeMoveFast(undo, board, awk);
          if (val > maxEval) maxEval = val;
          if (val > alpha)   alpha   = val;
          if (beta <= alpha) break;
        }
        return maxEval;
      } else {
        let minEval = Infinity;
        for (let idx = 0; idx < count; idx++) {
          const b = idx * 5;
          const isEP  = (raw[b+4] & 1) !== 0;
          const is2sq = (raw[b+4] & 2) !== 0;
          const undo = this._makeMoveFast(raw[b], raw[b+1], raw[b+2], raw[b+3], isEP, board, awk);
          const nextEp = is2sq ? [raw[b], Math.floor((raw[b+1] + raw[b+3]) / 2)] : [-1, -1];
          const val = this._alphaBeta(board, awk, depth + 1, maxD, alpha, beta, true, nextEp);
          this._unmakeMoveFast(undo, board, awk);
          if (val < minEval) minEval = val;
          if (val < beta)    beta    = val;
          if (beta <= alpha) break;
        }
        return minEval;
      }
    }

    // -----------------------------------------------------------------------
    // Raw move generation (inner search — no alloc-heavy objects)
    // -----------------------------------------------------------------------
    _genMovesRaw(board, awk, isEngine, depth, epTarget) {
      const raw = [];
      for (let i = 0; i < 8; i++) {
        for (let j = 0; j < 8; j++) {
          const p = board[i][j];
          if (p === '') continue;
          const pIsWhite = isWhite(p);
          if (isEngine !== pIsWhite) continue;
          if (awk[i][j] > depth)    continue;
          const targets = getMoves(i, j, board, epTarget);
          const isPawn = p.toLowerCase() === 'p';
          for (const t of targets) {
            let fl = 0;
            if (isPawn) {
              if (t[0] !== i && board[t[0]][t[1]] === '') fl |= 1; // en passant
              if (Math.abs(t[1] - j) === 2)               fl |= 2; // two-square
            }
            raw.push(i, j, t[0], t[1], fl);
          }
        }
      }
      return raw;
    }

    // In-place: swap captures to front
    _orderMovesRaw(raw, count, board) {
      let front = 0;
      for (let idx = 0; idx < count; idx++) {
        const b = idx * 5;
        if (board[raw[b+2]][raw[b+3]] !== '' || (raw[b+4] & 1) !== 0) {
          if (idx !== front) {
            const fb = front * 5;
            for (let k = 0; k < 5; k++) {
              const tmp = raw[fb+k]; raw[fb+k] = raw[b+k]; raw[b+k] = tmp;
            }
          }
          front++;
        }
      }
    }

    // -----------------------------------------------------------------------
    // Fast make/unmake with incremental material accounting
    // Returns undo token: [fx, fy, tx, ty, fa, ta, epx, epy]
    // -----------------------------------------------------------------------
    _makeMoveFast(fx, fy, tx, ty, isEP, board, awk) {
      const fromPiece = board[fx][fy];
      const toPiece   = board[tx][ty];
      const fa = awk[fx][fy];
      const ta = awk[tx][ty];
      let epCap = '';
      let epx = -1, epy = -1;

      // Normal capture material
      if (toPiece !== '') {
        const v = getPieceValue(toPiece);
        if (isBlack(toPiece)) this._mat += v; else this._mat -= v;
      }

      // En-passant capture
      if (isEP) {
        epx = tx; epy = fy;
        epCap = board[tx][fy];
        if (epCap !== '') {
          const v = getPieceValue(epCap);
          if (isBlack(epCap)) this._mat += v; else this._mat -= v;
        }
        board[tx][fy] = '';
      }

      // Promotion
      let placed;
      if (fromPiece.toUpperCase() === 'P' && (ty === 0 || ty === 7)) {
        placed = isBlack(fromPiece) ? 'Q' : 'q';
        const pv = getPieceValue(fromPiece);
        const qv = getPieceValue(placed);
        if (isBlack(fromPiece)) { this._mat += pv; this._mat -= qv; }
        else                    { this._mat -= pv; this._mat += qv; }
      } else {
        placed = fromPiece;
      }

      board[tx][ty] = placed;
      board[fx][fy] = '';
      awk[tx][ty] = fa;
      awk[fx][fy] = 0;

      this._undoStrs.push([fromPiece, toPiece, epCap]);
      return [fx, fy, tx, ty, fa, ta, epx, epy];
    }

    _unmakeMoveFast(undo, board, awk) {
      const strs = this._undoStrs.pop();
      const [fromPiece, toPiece, epCap] = strs;
      const [fx, fy, tx, ty, fa, ta, epx, epy] = undo;

      // Undo promotion material
      if (fromPiece.toUpperCase() === 'P' && (ty === 0 || ty === 7)) {
        const placed = board[tx][ty];
        const pv = getPieceValue(fromPiece);
        const qv = getPieceValue(placed);
        if (isBlack(fromPiece)) { this._mat -= pv; this._mat += qv; }
        else                    { this._mat += pv; this._mat -= qv; }
      }

      board[fx][fy] = fromPiece;
      board[tx][ty] = toPiece;
      awk[fx][fy] = fa;
      awk[tx][ty] = ta;

      // Undo capture material
      if (toPiece !== '') {
        const v = getPieceValue(toPiece);
        if (isBlack(toPiece)) this._mat -= v; else this._mat += v;
      }

      // Undo en-passant
      if (epx !== -1) {
        board[epx][epy] = epCap;
        if (epCap !== '') {
          const v = getPieceValue(epCap);
          if (isBlack(epCap)) this._mat -= v; else this._mat += v;
        }
      }
    }

    _computeMaterial(board) {
      let w = 0, b = 0;
      for (let i = 0; i < 8; i++)
        for (let j = 0; j < 8; j++) {
          const p = board[i][j];
          if (p !== '') {
            const v = getPieceValue(p);
            if (isBlack(p)) b += v; else w += v;
          }
        }
      return w - b;
    }

    // Public: compute current material eval (white − black) for display
    evaluate(board) {
      return this._computeMaterial(board);
    }

    // Build 8×8 awake map from pieces array
    makeAwakenessMap(pieces) {
      const map = Array.from({length: 8}, () => new Array(8).fill(0));
      for (const p of pieces) map[p.x][p.y] = p.movesUntilFormed;
      return map;
    }
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------
  return { isBlack, isWhite, getPieceValue, getMoves, getAllMovesPlayer, ChessEngine };

})();
