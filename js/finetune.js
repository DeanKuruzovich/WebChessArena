'use strict';
// =============================================================================
// finetune.js — All tunable game-balance parameters in one place.
// Loaded before engine.js so all other modules can reference FINETUNE.
// =============================================================================

const FINETUNE = {

  // ---------------------------------------------------------------------------
  // Opponent piece spawn probabilities (index = current white-piece count on board).
  // These are BASE probabilities, scaled by the eval factor below.
  // ---------------------------------------------------------------------------
  oppSpawnProbs: [1.00, 0.80, 0.60, 0.40, 0.20],

  // ---------------------------------------------------------------------------
  // Piece forming (ghost state before becoming active).
  //   formingMoves  — how many full player turns a newly-spawned opponent piece
  //                   stays locked (can't be moved by the engine).
  //   formingAlpha  — opacity of the ghost piece during that window.
  // The piece's alpha jumps to 1.0 at the END of the forming turn (inside
  // postMoveSpawn), so the player always sees the fully-solid piece at the start
  // of the turn when it first becomes active.
  // ---------------------------------------------------------------------------
  formingMoves      : 2,
  formingAlpha      : 0.40,
  formingFadeInSec  : 0.6,   // seconds the piece takes to fade from formingAlpha → 1.0 once active

  // ---------------------------------------------------------------------------
  // Eval-based equilibrium:
  //   lastTurnEngineEval > 0  →  white (engine) is ahead  →  player is losing
  //   lastTurnEngineEval < 0  →  white (engine) is behind →  player is winning
  //
  // Opponent spawn factor (more enemies when player is winning):
  //   spawnFactor = clamp(1 - eval / evalSpawnDivisor, minSpawnFactor, maxSpawnFactor)
  //   eval=0  → factor 1.0  (normal)
  //   eval=-8 → factor 2.0  (player winning  → flood with enemies)
  //   eval=+8 → factor 0.0  → clamped to min (player losing → give breathing room)
  // ---------------------------------------------------------------------------
  evalSpawnDivisor     : 6,
  minSpawnFactor       : 0.05,
  maxSpawnFactor       : 2,
  spawnFactorBiasPerTurn: 0.96,  // multiplied into the raw spawn factor each turn (before clamping)
  

  // ---------------------------------------------------------------------------
  // Star (convertable piece) probability:
  //   prob = clamp(starBaseProb + eval/evalStarDivisor - (blackPieces-1)*starPieceScale,
  //                starMinProb, starMaxProb)
  //   eval > 0 (player losing)  → more stars spawned (helps player recover)
  //   eval < 0 (player winning) → fewer stars spawned (player doesn't need help)
  // ---------------------------------------------------------------------------
  starBaseProb   : 0.28,
  evalStarDivisor: 8,
  starPieceScale : 0.1,   // subtract this per extra black piece (1 piece = base, 5 = base-4*scale)
  starMinProb    : 0.3,
  starMaxProb    : 0.90,

  // Soft max player pieces: no new star pieces spawn while the player has this many or more pieces.
  // Player can still exceed this by capturing stars that were already on the board at 4 pieces.
  playerPieceSoftMax: 5,

  // ---------------------------------------------------------------------------
  // Opponent piece type weights.
  // A random piece type is sampled proportional to these weights.
  // Queens are kept very rare.
  // ---------------------------------------------------------------------------
  oppPieceWeights: {
    p: 12.0,   // pawns  — most common
    n: 2.5,   // knights
    b: 2.5,   // bishops
    r: 2.0,   // rooks
    q: 0.3,   // queens  ← very rare
    k: 0.8,   // kings
  },

  // ---------------------------------------------------------------------------
  // Player starting piece weights (used for initial set selection).
  // (Higher = more likely to appear in the starting hand.)
  // ---------------------------------------------------------------------------
  playerPieceWeights: {
    P: 4.0,
    N: 2.0,
    B: 1.8,
    R: 1.5,
    Q: 0.6,
    K: 1,
  },

  // ---------------------------------------------------------------------------
  // Global score scale factor — multiplies every point award (captures,
  // time bonus, promotion).  Result is always Math.round'd to keep integer scores.
  // ---------------------------------------------------------------------------
  scoreScaleFactor: 1,

  // ---------------------------------------------------------------------------
  // Move-time score bonus (piecewise-linear between anchors).
  //   Only awarded when the move captures a piece.
  //   < fastSec  →  fastBonus  (+10 for under 1 sec)
  //   = midSec   →  midBonus   (+5  for 5 sec)
  //   > slowSec  →  slowBonus  (+1  for 30+ sec)
  // ---------------------------------------------------------------------------
  moveTimeBonus: {
    fastSec  : 1.5,
    fastBonus: 10,
    midSec   : 5.0,
    midBonus : 5,
    slowSec  : 10,
    slowBonus: 1,
  },

  // ---------------------------------------------------------------------------
  // Combo: reset combo counter if player spends more than this many seconds
  // on a single move.
  // ---------------------------------------------------------------------------
  comboTimeoutSec: 2.5,

  // ---------------------------------------------------------------------------
  // "Miracle" spawn: when the player has exactly ONE piece and it is not a Queen,
  // this is the probability that a convertable piece spawns on one of its
  // attack squares each turn.
  // ---------------------------------------------------------------------------
  miracleProb: 0.25,

  // ---------------------------------------------------------------------------
  // Debug HUD toggle:
  //   1 / true  -> show engine eval in corner
  //   0 / false -> hide debug eval
  // ---------------------------------------------------------------------------
  debugShowEngineEval: 0,

  // ---------------------------------------------------------------------------
  // Debug mode:
  //   true  -> on start/restart, always spawn 3 test pieces:
  //              • a normal opponent piece  (fully solid, not convertable)
  //              • a faded opponent piece   (still forming)
  //              • a star opponent piece    (convertable)
  //   false -> normal gameplay, no forced pieces
  // ---------------------------------------------------------------------------
  debugMode: false,

  // ---------------------------------------------------------------------------
  // Debug rank override (only applied when debugMode is true).
  // Set to 'CM', 'FM', 'IM', or 'GM' to force that rank in the title.
  // Set to '' to show no rank.
  // ---------------------------------------------------------------------------
  debugRank: 'CM',

  // ---------------------------------------------------------------------------
  // Debug board: when debugMode is true AND non-null, initBoard() loads this
  // exact position instead of generating a random one.
  // Format: board[col][row], col 0-7 left->right, row 0-7 top->bottom.
  // Uppercase = black (player), lowercase = white (AI), '' = empty.
  // Set to null to use normal random board generation.
  // ---------------------------------------------------------------------------
  
   debugBoard: [
    ['', '', '', '', '', '', '', ''],  
    ['', '', '', '', '', '', '', ''],
    ['', '', 'R', '', '', '', '', ''],
    ['', '', '', '', '', '', '', ''],
    ['n', '', '', '', 'q', '', '', ''],
    ['', 'p', 'k', '', '', '', '', ''],
    ['', '', '', 'P', '', '', '', ''],
    ['', '', '', '', '', '', '', '']
  ],

  // ---------------------------------------------------------------------------
  // Debug awakeness map: paired with debugBoard.
  // Format: map[col][row] = movesUntilFormed (0 = active, >0 = forming).
  // Only used when debugMode is true and debugBoard is non-null.
  // Set to null to treat all pieces as fully active.
  // ---------------------------------------------------------------------------
  debugAwakenessMap: null,
  
  debugAwakenessMap: [
    [0,0,0,0,0,0,0,0],
    [0,0,0,0,0,0,0,0],
    [0,0,0,0,0,0,0,0],
    [0,0,0,0,0,0,0,0],
    [0,0,0,0,2,0,0,0], 
    [0,0,0,0,0,0,0,0],
    [0,0,0,2,0,0,0,0],
    [0,0,0,0,0,0,0,0]
  ]

};
