/* ai.js — four difficulty tiers sharing one legal-move generator.
 *   初級  beginner     : size-weighted random (no positioning, no blocking)
 *   中級  intermediate : greedy 1-ply (own size + mobility, ignores opponents)
 *   上級  advanced     : greedy 1-ply (mobility + opponent blocking + centrality)
 *   超上級 expert       : flat Monte-Carlo over top-K moves, truncated greedy
 *                        rollouts, time-boxed (~1.8s) and async (UI stays live).
 * Public game state is immutable; rollouts use a fast mutable scratch board. */
(function (BK) {
  'use strict';

  var N = BK.BOARD_SIZE;
  var EMPTY = BK.EMPTY;
  var CENTER = (N - 1) / 2;
  var AI = {};
  BK.AI = AI;

  var yieldTick = function () { return new Promise(function (r) { setTimeout(r, 0); }); };
  var now = function () { return (typeof performance !== 'undefined' ? performance.now() : Date.now()); };

  // anchors-per-color in a single board pass
  function mobilityAll(board) {
    var counts = [0, 0, 0, 0];
    for (var r = 0; r < N; r++) {
      for (var c = 0; c < N; c++) {
        var i = r * N + c;
        if (board[i] !== EMPTY) continue;
        var up = r > 0, dn = r < N - 1, lf = c > 0, rt = c < N - 1;
        var ortho = 0; // bitmask of colors orthogonally adjacent
        if (up && board[i - N] !== EMPTY) ortho |= (1 << board[i - N]);
        if (dn && board[i + N] !== EMPTY) ortho |= (1 << board[i + N]);
        if (lf && board[i - 1] !== EMPTY) ortho |= (1 << board[i - 1]);
        if (rt && board[i + 1] !== EMPTY) ortho |= (1 << board[i + 1]);
        var diag = 0;
        if (up && lf && board[i - N - 1] !== EMPTY) diag |= (1 << board[i - N - 1]);
        if (up && rt && board[i - N + 1] !== EMPTY) diag |= (1 << board[i - N + 1]);
        if (dn && lf && board[i + N - 1] !== EMPTY) diag |= (1 << board[i + N - 1]);
        if (dn && rt && board[i + N + 1] !== EMPTY) diag |= (1 << board[i + N + 1]);
        for (var k = 0; k < 4; k++) {
          if ((diag & (1 << k)) && !(ortho & (1 << k))) counts[k]++;
        }
      }
    }
    return counts;
  }

  // placed-cell counts for all colors + centrality sum for `me`, one pass.
  function scanPlaced(board, me) {
    var placed = [0, 0, 0, 0];
    var central = 0;
    for (var r = 0; r < N; r++) {
      for (var c = 0; c < N; c++) {
        var v = board[r * N + c];
        if (v === EMPTY) continue;
        placed[v]++;
        if (v === me) {
          var d = (Math.abs(r - CENTER) + Math.abs(c - CENTER)) / (2 * CENTER);
          central += (1 - d);
        }
      }
    }
    return { placed: placed, central: central };
  }

  var WEIGHTS = {
    intermediate: { placed: 4.0, mob: 1.2, opp: 0.0, center: 0.5 },
    advanced:     { placed: 4.0, mob: 1.6, opp: 0.7, center: 0.6 },
    expert:       { placed: 4.0, mob: 1.6, opp: 0.8, center: 0.5 },
  };

  function evalPosition(board, me, w, myPlacedPieces) {
    var mob = mobilityAll(board);
    var sp = scanPlaced(board, me);
    var oppMob = 0;
    for (var k = 0; k < 4; k++) if (k !== me) oppMob += mob[k];
    var early = Math.max(0, (10 - myPlacedPieces) / 10);
    return w.placed * sp.placed[me]
      + w.mob * mob[me]
      - w.opp * oppMob
      + w.center * sp.central * early;
  }

  // ---- shared helpers -------------------------------------------------------

  function legalMoves(state, id) {
    var p = state.players[id];
    return BK.generateMoves(state.board, id, p.remaining, !p.hasPlayed, BK.CORNERS[id]);
  }

  function applyCells(board, cells, color) { for (var i = 0; i < cells.length; i++) board[cells[i]] = color; }
  function clearCells(board, cells) { for (var i = 0; i < cells.length; i++) board[cells[i]] = EMPTY; }

  // ---- tier: beginner -------------------------------------------------------

  function pickBeginner(moves) {
    // weight by piece size so it isn't utterly random, but no positioning sense
    var total = 0, i;
    for (i = 0; i < moves.length; i++) total += moves[i].size;
    var t = Math.random() * total;
    for (i = 0; i < moves.length; i++) { t -= moves[i].size; if (t <= 0) return moves[i]; }
    return moves[moves.length - 1];
  }

  // ---- tiers: intermediate / advanced (greedy 1-ply) ------------------------

  function pickGreedy(state, id, moves, w) {
    var board = Int8Array.from(state.board);
    var placedPieces = state.players[id].placedCount;
    // cap candidates for speed: prefer larger pieces
    var cand = moves;
    if (cand.length > 220) {
      cand = moves.slice().sort(function (a, b) { return b.size - a.size; }).slice(0, 220);
    }
    var best = null, bestVal = -Infinity;
    for (var i = 0; i < cand.length; i++) {
      var m = cand[i];
      applyCells(board, m.cells, id);
      var v = evalPosition(board, id, w, placedPieces + 1) + Math.random() * 0.001;
      clearCells(board, m.cells);
      if (v > bestVal) { bestVal = v; best = m; }
    }
    return best;
  }

  // ---- tier: expert (flat Monte-Carlo) --------------------------------------

  var ROLL_PLIES = 12;   // lookahead depth (plies) per truncated rollout
  var ROLL_PIECES = 6;   // largest-N remaining pieces considered in rollouts
  var TOP_K = 14;        // root candidates kept

  // greedy rollout policy for one mover; returns a move or null (must pass)
  function rolloutMove(board, color, remaining, isFirst) {
    // restrict to the largest few remaining pieces for speed + strong play
    var sizes = [];
    for (var pi = 0; pi < BK.PIECE_COUNT; pi++) if (remaining[pi]) sizes.push(BK.PIECES[pi].size);
    sizes.sort(function (a, b) { return b - a; });
    var minSize = sizes.length ? sizes[Math.min(ROLL_PIECES, sizes.length) - 1] : 1;
    var filter = function (pi) { return BK.PIECES[pi].size >= minSize; };
    var moves = BK.generateMoves(board, color, remaining, isFirst, BK.CORNERS[color], { pieceFilter: filter });
    if (moves.length === 0) {
      moves = BK.generateMoves(board, color, remaining, isFirst, BK.CORNERS[color]);
      if (moves.length === 0) return null;
    }
    if (Math.random() < 0.1) return moves[(Math.random() * moves.length) | 0]; // exploration
    var maxSize = 0, i;
    for (i = 0; i < moves.length; i++) if (moves[i].size > maxSize) maxSize = moves[i].size;
    var top = [];
    for (i = 0; i < moves.length; i++) if (moves[i].size === maxSize) top.push(moves[i]);
    return top[(Math.random() * top.length) | 0];
  }

  // one truncated rollout starting after `me` placed `rootMove`; returns score
  // from me's perspective.
  function rollout(state, me, rootMove) {
    var board = Int8Array.from(state.board);
    applyCells(board, rootMove.cells, me);
    var remaining = state.players.map(function (p) { return p.remaining.slice(); });
    var hasPlayed = state.players.map(function (p) { return p.hasPlayed; });
    var finished = state.players.map(function (p) { return p.finished; });
    remaining[me][rootMove.pieceIndex] = false;
    hasPlayed[me] = true;
    var myPlacedPieces = state.players[me].placedCount + 1;

    var cur = advance(finished, me);
    var plies = 0;
    while (cur !== -1 && plies < ROLL_PLIES) {
      if (finished[cur]) { cur = advance(finished, cur); continue; }
      var mv = rolloutMove(board, cur, remaining[cur], !hasPlayed[cur]);
      if (mv === null) {
        finished[cur] = true;
      } else {
        applyCells(board, mv.cells, cur);
        remaining[cur][mv.pieceIndex] = false;
        hasPlayed[cur] = true;
      }
      plies++;
      cur = advance(finished, cur);
    }
    return evalPosition(board, me, WEIGHTS.expert, myPlacedPieces);
  }

  function advance(finished, fromId) {
    for (var step = 1; step <= 4; step++) {
      var cand = (fromId + step) % 4;
      if (!finished[cand]) return cand;
    }
    return -1;
  }

  async function pickExpert(state, id, moves, budgetMs) {
    // rank by advanced 1-ply eval, keep top-K as MC roots
    var board = Int8Array.from(state.board);
    var placedPieces = state.players[id].placedCount;
    var scored = moves.map(function (m) {
      applyCells(board, m.cells, id);
      var v = evalPosition(board, id, WEIGHTS.advanced, placedPieces + 1);
      clearCells(board, m.cells);
      return { move: m, prior: v };
    });
    scored.sort(function (a, b) { return b.prior - a.prior; });
    var roots = scored.slice(0, Math.min(TOP_K, scored.length)).map(function (s) {
      return { move: s.move, sum: 0, n: 0, prior: s.prior };
    });
    if (roots.length === 1) return roots[0].move;

    var deadline = now() + budgetMs;
    var lastYield = now();
    var ri = 0;
    while (now() < deadline) {
      var root = roots[ri % roots.length];
      root.sum += rollout(state, id, root.move);
      root.n++;
      ri++;
      if (now() - lastYield > 25) { await yieldTick(); lastYield = now(); }
    }
    var best = roots[0], bestMean = -Infinity;
    for (var i = 0; i < roots.length; i++) {
      var mean = roots[i].n ? roots[i].sum / roots[i].n : roots[i].prior;
      if (mean > bestMean) { bestMean = mean; best = roots[i]; }
    }
    return best.move;
  }

  // ---- public entry ---------------------------------------------------------

  /* Returns a Promise resolving to a move, or null when the player must pass. */
  AI.selectMove = async function (state, id, difficulty) {
    var moves = legalMoves(state, id);
    if (moves.length === 0) return null;
    switch (difficulty) {
      case 'beginner':
        return pickBeginner(moves);
      case 'intermediate':
        return pickGreedy(state, id, moves, WEIGHTS.intermediate);
      case 'advanced':
        return pickGreedy(state, id, moves, WEIGHTS.advanced);
      case 'expert':
        return await pickExpert(state, id, moves, BK.TIME_BUDGET.expert);
      default:
        return pickGreedy(state, id, moves, WEIGHTS.advanced);
    }
  };

  AI.legalMoves = legalMoves;

  // Exposed for the "次の一手"（詰めブロックス）puzzle engine so it shares ONE
  // position evaluation + weight table with the in-game AI (single source of
  // truth). Additive only — existing callers are unaffected.
  AI.evalPosition = evalPosition;   // (board, me, weights, myPlacedPieces) -> number
  AI.WEIGHTS = WEIGHTS;             // { intermediate, advanced, expert }
})(window.BK);
