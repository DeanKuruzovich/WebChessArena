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
  evalSpawnDivisor: 8,
  minSpawnFactor  : 0.10,
  maxSpawnFactor  : 2.20,

  // ---------------------------------------------------------------------------
  // Star (convertable piece) probability:
  //   prob = clamp(starBaseProb + eval/evalStarDivisor - (blackPieces-1)*starPieceScale,
  //                starMinProb, starMaxProb)
  //   eval > 0 (player losing)  → more stars spawned (helps player recover)
  //   eval < 0 (player winning) → fewer stars spawned (player doesn't need help)
  // ---------------------------------------------------------------------------
  starBaseProb   : 0.28,
  evalStarDivisor: 8,
  starPieceScale : 0.05,   // subtract this per extra black piece (1 piece = base, 5 = base-4*scale)
  starMinProb    : 0.0,
  starMaxProb    : 0.90,

  // ---------------------------------------------------------------------------
  // Opponent piece type weights.
  // A random piece type is sampled proportional to these weights.
  // Queens are kept very rare.
  // ---------------------------------------------------------------------------
  oppPieceWeights: {
    p: 6.0,   // pawns  — most common
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
    B: 2.0,
    R: 2.0,
    Q: 1.0,
    K: 1.0,
  },

  // ---------------------------------------------------------------------------
  // Move-time score bonus (piecewise-linear between anchors).
  //   < fastSec  →  fastBonus  (+10 for under 1 sec)
  //   = midSec   →  midBonus   (+5  for 5 sec)
  //   > slowSec  →  slowBonus  (+1  for 30+ sec)
  // ---------------------------------------------------------------------------
  moveTimeBonus: {
    fastSec  : 1.0,
    fastBonus: 10,
    midSec   : 5.0,
    midBonus : 5,
    slowSec  : 30.0,
    slowBonus: 1,
  },

  // ---------------------------------------------------------------------------
  // Combo: reset combo counter if player spends more than this many seconds
  // on a single move.
  // ---------------------------------------------------------------------------
  comboTimeoutSec: 8,

  // ---------------------------------------------------------------------------
  // "Miracle" spawn: when the player has exactly ONE piece and it is not a Queen,
  // this is the probability that a convertable piece spawns on one of its
  // attack squares each turn.
  // ---------------------------------------------------------------------------
  miracleProb: 0.45,

};
