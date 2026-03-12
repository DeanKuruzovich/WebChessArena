'use strict';
// =============================================================================
// finetune.js — All tunable game-balance parameters in one place.
// Loaded before engine.js so all other modules can reference FINETUNE.
// =============================================================================

const FINETUNE = {


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
  evalSpawnDivisor     : 8,
  minSpawnFactor       : 0.3,
  maxSpawnFactor       : 2.2,
  //^- based on position

  //v- based on # moves played

  spawnFactorScalerScaler: 1.01,  // multiplies spawnFactorScaler every turn (compounds over time)
  
  //independent -v
  spawnFactorScaler      : .9,   // base multiplier on the final clamped spawn factor
  
  //based on number of pieces -v
  oppPieceNumberScaleDownFact: 0.8,
  maxOppPieces               : 6,


  // ---------------------------------------------------------------------------
  // Star (convertable piece) probability:
  //   prob = clamp(starBaseProb + eval/evalStarDivisor - (blackPieces-1)*starPieceScale,
  //                starMinProb, starMaxProb)
  //   eval > 0 (player losing)  → more stars spawned (helps player recover)
  //   eval < 0 (player winning) → fewer stars spawned (player doesn't need help)
  // ---------------------------------------------------------------------------
  starBaseProb   : 0.40,
  evalStarDivisor: 8,
  starMinProb    : 0.25,
  starMaxProb    : 0.90,
  //^- based on position

  //independent -v
  starChanceScaler: 1.1,   // base multiplier on the clamped star probability
  
  //v- based on # moves played
  starChanceScalerScaler: 0.99,  // multiplies starChanceScaler every turn (stars get rarer over time)

  //based on number of pieces -v
  playerPieceSoftMax: 5,
  

  // Engine bonus value for starred (convertable) pieces.
  // Added to a piece's value in the engine's evaluation, making it protect starred pieces harder.
  starValueBonus: 2.2,

  // ---------------------------------------------------------------------------
  // Opponent piece type weights.
  // A random piece type is sampled proportional to these weights.
  // Queens are kept very rare.
  // ---------------------------------------------------------------------------
  oppPieceWeights: {
    p: 15.0,   // pawns  — most common
    n: 2.5,   // knights
    b: 2.5,   // bishops
    r: 2.0,   // rooks
    q: 0.3,   // queens  
    k: 0.8,   // kings
  },

 playerPieceWeights: {
    P: 3.5,
    N: 2,
    B: 2,
    R: 2,
    Q: 1,
    K: 1.8,
  },

  // ---------------------------------------------------------------------------
  // Global score scale factor — multiplies every point award (captures,
  // time bonus, promotion).  Result is always Math.round'd to keep integer scores.
  // ---------------------------------------------------------------------------
  scoreScaleFactor: 1.5,

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
  miracleFirstFiveTurns: 0.5,  // miracle probability override for the first 5 turns

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
    ['', '', '', 'p', '', '', '', ''],
    ['', '', '', '', '', '', '', ''],
    ['', '', 'Q', 'Q', 'Q', 'Q', '', ''],
    ['', '', 'Q', 'Q', 'Q', 'Q', 'Q', ''],
    ['', '', '', '', '', '', '', ''],
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
