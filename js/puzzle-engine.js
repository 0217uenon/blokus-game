/* puzzle-engine.js — "次の一手"（詰めブロックス）engine.
 *
 * Pure, DOM-free logic for the single-best-move puzzle mode. It (1) generates a
 * realistic mid-game position where it is 青(seat 0) to move, (2) ranks every
 * legal move with a level-scaled lookahead ("how many plies to read"), (3)
 * freezes that ranking so grading is deterministic, and (4) grades the player's
 * chosen move into a band + a truthful Japanese explanation / improvement note.
 *
 * Shares ONE position evaluation with the in-game AI via BK.AI.evalPosition /
 * BK.AI.WEIGHTS (single source of truth). Loads as a classic <script> attaching
 * to window.BK, and runs under Node (window shim) so test/puzzle.js can verify it.
 *
 * Reading depth per level (decided for this mode; surfaced in the UI + notes):
 *   初級   beginner     : 自分の1手だけ（相手は読まない / 1-ply）
 *   中級   intermediate : 自分1手＋相手1手（2手先）
 *   上級   advanced     : 自分1手＋相手3人の1巡（約4手先）
 *   超上級 expert       : 自分1手＋モンテカルロ2〜3巡（8〜12手先の平均）
 */
(function (BK) {
  'use strict';

  var N = BK.BOARD_SIZE;
  var EMPTY = BK.EMPTY;
  var CENTER = (N - 1) / 2;
  var Puzzle = {};
  BK.Puzzle = Puzzle;

  var now = function () { return (typeof performance !== 'undefined' ? performance.now() : Date.now()); };
  var yieldTick = function () { return new Promise(function (r) { setTimeout(r, 0); }); };

  // ---- per-level tuning ------------------------------------------------------
  // placedRange = how many pieces 青 has ALREADY placed when the puzzle starts
  // (so puzzles are never the trivial first move). minMoves = reject positions
  // with fewer legal choices. topK = candidates deep-scored for the answer.
  // sharp = required value gap (best − median) for a position to be "pointed".
  // mc = Monte-Carlo rollouts per candidate (expert only). replyPieces = largest
  // remaining pieces considered per opponent reply (speed).
  var LEVELS = {
    beginner: {
      key: 'beginner', label: '初級', plies: 1,
      readLabel: '自分の1手だけ（相手は読みません）',
      placedRange: [1, 3], minMoves: 8, topK: 18, sharp: 1.0, mc: 0,
      playout: 'intermediate', replyPieces: 6,
    },
    intermediate: {
      key: 'intermediate', label: '中級', plies: 2,
      readLabel: '自分1手＋相手1手（2手先）',
      placedRange: [3, 6], minMoves: 10, topK: 20, sharp: 1.8, mc: 0,
      playout: 'intermediate', replyPieces: 6,
    },
    advanced: {
      key: 'advanced', label: '上級', plies: 4,
      readLabel: '自分1手＋相手3人の1巡（約4手先）',
      placedRange: [6, 11], minMoves: 12, topK: 22, sharp: 4.0, mc: 0,
      playout: 'advanced', replyPieces: 5,
    },
    expert: {
      key: 'expert', label: '超上級', plies: 12,
      readLabel: '自分1手＋モンテカルロ2〜3巡（8〜12手先の平均）',
      placedRange: [10, 16], minMoves: 12, topK: 16, sharp: 4.5, mc: 22,
      playout: 'advanced', replyPieces: 5,
    },
  };
  Puzzle.LEVELS = LEVELS;
  Puzzle.levelInfo = function (key) { return LEVELS[key] || LEVELS.beginner; };

  var ROLL_PLIES = 9;          // expert rollout depth (plies after my move)
  var GEN_MAX_ATTEMPTS = 14;   // position-generation retries to find a sharp one
  var GEN_BUDGET_MS = 4000;    // hard cap on a single Puzzle.generate call

  function randInt(lo, hi) { return lo + ((Math.random() * (hi - lo + 1)) | 0); }

  // ---- low-level board helpers (mutable scratch, like ai.js rollouts) --------

  function applyCells(board, cells, color) { for (var i = 0; i < cells.length; i++) board[cells[i]] = color; }
  function clearCells(board, cells) { for (var i = 0; i < cells.length; i++) board[cells[i]] = EMPTY; }

  function advance(finished, fromId) {
    for (var step = 1; step <= 4; step++) {
      var cand = (fromId + step) % 4;
      if (!finished[cand]) return cand;
    }
    return -1;
  }

  function minCenterDist(cells) {
    var best = Infinity;
    for (var i = 0; i < cells.length; i++) {
      var r = (cells[i] / N) | 0, c = cells[i] % N;
      var d = Math.abs(r - CENTER) + Math.abs(c - CENTER);
      if (d < best) best = d;
    }
    return best;
  }

  function oppAnchorTotal(board) {
    return BK.countAnchors(board, 1) + BK.countAnchors(board, 2) + BK.countAnchors(board, 3);
  }

  // filter restricting move generation to the largest `keep` remaining pieces
  function topPiecesFilter(remaining, keep) {
    var sizes = [];
    for (var pi = 0; pi < BK.PIECE_COUNT; pi++) if (remaining[pi]) sizes.push(BK.PIECES[pi].size);
    if (!sizes.length) return function () { return true; };
    sizes.sort(function (a, b) { return b - a; });
    var minSize = sizes[Math.min(keep, sizes.length) - 1];
    return function (pi) { return BK.PIECES[pi].size >= minSize; };
  }

  // greedy "best reply" for one opponent on a scratch board; returns a move or
  // null (must pass). Restricted to big pieces for speed; uses the shared eval.
  function bestReply(board, color, remaining, hasPlayed, placedCount, keep) {
    var corner = BK.CORNERS[color];
    var isFirst = !hasPlayed;
    var moves = BK.generateMoves(board, color, remaining, isFirst, corner,
      { pieceFilter: topPiecesFilter(remaining, keep) });
    if (!moves.length) {
      moves = BK.generateMoves(board, color, remaining, isFirst, corner);
      if (!moves.length) return null;
    }
    var best = null, bestVal = -Infinity;
    var w = BK.AI.WEIGHTS.advanced;
    for (var i = 0; i < moves.length; i++) {
      applyCells(board, moves[i].cells, color);
      var v = BK.AI.evalPosition(board, color, w, placedCount + 1) + Math.random() * 0.001;
      clearCells(board, moves[i].cells);
      if (v > bestVal) { bestVal = v; best = moves[i]; }
    }
    return best;
  }

  // one truncated greedy rollout (expert). Plays `plies` half-moves of greedy
  // big-piece policy on the caller-prepared mutable state, then returns the
  // shared eval from 青's perspective.
  function rollout(level, board, remaining, hasPlayed, finished, placed, myPlaced) {
    var L = LEVELS[level];
    var cur = advance(finished, 0);
    var plies = 0;
    while (cur !== -1 && plies < ROLL_PLIES) {
      if (finished[cur]) { cur = advance(finished, cur); continue; }
      var mv = bestReply(board, cur, remaining[cur], hasPlayed[cur], placed[cur], L.replyPieces);
      if (mv === null) { finished[cur] = true; }
      else {
        applyCells(board, mv.cells, cur);
        remaining[cur][mv.pieceIndex] = false;
        hasPlayed[cur] = true; placed[cur]++;
      }
      plies++;
      cur = advance(finished, cur);
    }
    return BK.AI.evalPosition(board, 0, BK.AI.WEIGHTS.expert, myPlaced);
  }

  // ---- level-scaled lookahead score for ONE candidate move -------------------
  // Returns 青's evaluation after the move + the level's opponent reading.
  function deepScore(snap, level, move) {
    var L = LEVELS[level];
    var board = Int8Array.from(snap.board);
    applyCells(board, move.cells, 0);
    var myPlaced = snap.placed[0] + 1;

    if (level === 'beginner') {
      // 1-ply, opponents ignored (intermediate weights have opp = 0)
      return BK.AI.evalPosition(board, 0, BK.AI.WEIGHTS.intermediate, myPlaced);
    }

    var remaining = snap.remaining.map(function (a) { return a.slice(); });
    remaining[0][move.pieceIndex] = false;
    var hasPlayed = snap.hasPlayed.slice(); hasPlayed[0] = true;
    var finished = snap.finished.slice();
    var placed = snap.placed.slice(); placed[0]++;

    if (level === 'intermediate') {
      var opp = advance(finished, 0);
      if (opp !== -1) {
        var mv = bestReply(board, opp, remaining[opp], hasPlayed[opp], placed[opp], L.replyPieces);
        if (mv) {
          applyCells(board, mv.cells, opp);
          remaining[opp][mv.pieceIndex] = false;
          hasPlayed[opp] = true; placed[opp]++;
        }
      }
      return BK.AI.evalPosition(board, 0, BK.AI.WEIGHTS.advanced, myPlaced);
    }

    if (level === 'advanced') {
      var cur = advance(finished, 0), steps = 0;
      while (cur !== -1 && steps < 3) {
        var rm = bestReply(board, cur, remaining[cur], hasPlayed[cur], placed[cur], L.replyPieces);
        if (rm) { applyCells(board, rm.cells, cur); remaining[cur][rm.pieceIndex] = false; hasPlayed[cur] = true; placed[cur]++; }
        else { finished[cur] = true; }
        cur = advance(finished, cur); steps++;
      }
      return BK.AI.evalPosition(board, 0, BK.AI.WEIGHTS.advanced, myPlaced);
    }

    // expert: Monte-Carlo — average eval over mc independent greedy rollouts
    var sum = 0;
    for (var k = 0; k < L.mc; k++) {
      var b = Int8Array.from(board);
      var rem = remaining.map(function (a) { return a.slice(); });
      var hp = hasPlayed.slice(), fin = finished.slice(), pl = placed.slice();
      sum += rollout(level, b, rem, hp, fin, pl, myPlaced);
    }
    return sum / L.mc;
  }

  // 1-ply prior used to pre-rank candidates before the (costly) deep pass.
  function prior(snap, move) {
    var board = Int8Array.from(snap.board);
    applyCells(board, move.cells, 0);
    return BK.AI.evalPosition(board, 0, BK.AI.WEIGHTS.advanced, snap.placed[0] + 1);
  }

  function cellsKey(cells) {
    var s = cells.slice(); s.sort(function (a, b) { return a - b; });
    return s.join(',');
  }

  // Pre-rank ALL legal moves by a cheap 1-ply prior, then DEEP-score only the
  // top-K candidates. The authoritative ranking is the deep-scored set ONLY —
  // every `value` is on the same level-appropriate scale, so `best` is always a
  // verified move and the grading spread is single-scale (no prior/deep mixing).
  // Async so the UI stays responsive (yields periodically). Returns
  // { ranked: [deep-scored, value-desc], totalLegal }.
  async function rankMoves(snap, level, moves) {
    var L = LEVELS[level];
    var scored = moves.map(function (m) {
      return { move: m, cells: m.cells.slice(), key: cellsKey(m.cells),
        size: m.size, pieceIndex: m.pieceIndex, orientationIndex: m.orientationIndex,
        prior: prior(snap, m), value: 0, deep: false };
    });
    scored.sort(function (a, b) { return b.prior - a.prior; });
    var candidates = scored.slice(0, Math.min(L.topK, scored.length));

    var lastYield = now();
    for (var i = 0; i < candidates.length; i++) {
      candidates[i].value = deepScore(snap, level, candidates[i].move);
      candidates[i].deep = true;
      if (now() - lastYield > 25) { await yieldTick(); lastYield = now(); }
    }
    candidates.sort(function (a, b) { return b.value - a.value; });
    var n = candidates.length;
    candidates.forEach(function (s, i) {
      s.rank = i + 1;
      s.percentile = n > 1 ? 1 - i / (n - 1) : 1;
    });
    return { ranked: candidates, totalLegal: moves.length };
  }

  function valueStats(ranked) {
    var best = ranked[0].value, worst = ranked[ranked.length - 1].value;
    var median = ranked[(ranked.length / 2) | 0].value;
    return { best: best, worst: worst, median: median };
  }

  // ---- position generation ---------------------------------------------------
  // Play a quick AI game until it is 青's turn with `target` pieces already
  // placed and at least one legal move. Returns a frozen "snap", or null.
  async function buildPosition(level) {
    var L = LEVELS[level];
    var target = randInt(L.placedRange[0], L.placedRange[1]);
    var seats = [0, 1, 2, 3].map(function (i) {
      return { isHuman: false, difficulty: L.playout, name: 'P' + i };
    });
    var state = BK.createGame({ humanLevel: 'advanced', seats: seats });
    var guard = 0;
    while (state.status === 'playing' && guard++ < 400) {
      var id = state.current;
      if (id === 0 && state.players[0].placedCount === target) {
        if (BK.hasAnyMove(state.board, 0, state.players[0].remaining, !state.players[0].hasPlayed, BK.CORNERS[0])) {
          return snapshot(state);
        }
        return null; // 青 must pass here — unusable, regenerate
      }
      var mv = await BK.AI.selectMove(state, id, seats[id].difficulty);
      state = (mv === null) ? BK.passPlayer(state) : BK.applyMove(state, mv);
    }
    return null;
  }

  // Freeze everything the solver/grader needs from a live GameState (青 to move).
  function snapshot(state) {
    return {
      board: Int8Array.from(state.board),
      remaining: state.players.map(function (p) { return p.remaining.slice(); }),
      hasPlayed: state.players.map(function (p) { return p.hasPlayed; }),
      finished: state.players.map(function (p) { return p.finished; }),
      placed: state.players.map(function (p) { return p.placedCount; }),
      moveNumberOverall: state.history.length + 1,
    };
  }

  /* Generate one puzzle for `level`. Async (the expert solver yields). Resolves
   * to a frozen puzzle object, or null if no usable position was found. */
  Puzzle.generate = async function (level) {
    if (!LEVELS[level]) level = 'beginner';
    var L = LEVELS[level];
    var deadline = now() + GEN_BUDGET_MS;
    var fallback = null;

    for (var attempt = 0; attempt < GEN_MAX_ATTEMPTS && now() < deadline; attempt++) {
      var snap = await buildPosition(level);
      if (!snap) continue;
      var moves = BK.generateMoves(snap.board, 0, snap.remaining[0], !snap.hasPlayed[0], BK.CORNERS[0]);
      if (moves.length < L.minMoves) continue;

      var rankResult = await rankMoves(snap, level, moves);
      var ranked = rankResult.ranked;
      var stats = valueStats(ranked);
      var gap = stats.best - stats.median;

      var puzzle = makePuzzle(snap, level, ranked, rankResult.totalLegal, stats, gap);
      if (gap >= L.sharp) return puzzle;
      if (!fallback || gap > fallback.gap) fallback = puzzle;
    }
    return fallback; // best-effort: the sharpest position we found (may be null)
  };

  function makePuzzle(snap, level, ranked, totalLegal, stats, gap) {
    var L = LEVELS[level];
    return {
      level: level,
      levelInfo: L,
      snap: snap,
      board: snap.board,                 // 青 to move
      remaining: snap.remaining[0],       // seat-0 bool array (for the tray)
      ranked: ranked,                     // deep-scored top-K only (authoritative)
      totalLegal: totalLegal,             // count of ALL legal moves (for display)
      best: ranked[0],
      stats: stats,
      gap: gap,
      gradeCache: {},                     // cellsKey -> deep value (on-demand grades)
      summary: {
        myMoveNumber: snap.placed[0] + 1,
        overallMoveNumber: snap.moveNumberOverall,
        anchors: BK.countAnchors(snap.board, 0),
        oppAnchors: oppAnchorTotal(snap.board),
        legalMoves: totalLegal,
        remainingPieces: snap.remaining[0].filter(Boolean).length,
      },
    };
  }

  // ---- move description + component deltas (for explanations) -----------------

  function centroid(cells) {
    var sr = 0, sc = 0;
    for (var i = 0; i < cells.length; i++) { sr += (cells[i] / N) | 0; sc += cells[i] % N; }
    return { r: sr / cells.length, c: sc / cells.length };
  }

  function regionLabel(cells) {
    var g = centroid(cells);
    var v = g.r < N / 3 ? '上' : (g.r < 2 * N / 3 ? '中段' : '下');
    var h = g.c < N / 3 ? '左' : (g.c < 2 * N / 3 ? '中央' : '右');
    if (v === '中段' && h === '中央') return '中央';
    return v + h;
  }

  Puzzle.describeMove = function (move) {
    var name = BK.PIECES[move.pieceIndex].id;
    return name + '（' + move.size + 'マス）を盤の' + regionLabel(move.cells) + '付近へ';
  };

  // Truthful before/after deltas a single 青 move produces, used to explain WHY.
  function moveComponents(snap, move) {
    var before = snap.board;
    var after = Int8Array.from(before);
    applyCells(after, move.cells, 0);
    return {
      size: move.size,
      ownBefore: BK.countAnchors(before, 0),
      ownAfter: BK.countAnchors(after, 0),
      oppBefore: oppAnchorTotal(before),
      oppAfter: oppAnchorTotal(after),
      center: minCenterDist(move.cells),
      region: regionLabel(move.cells),
      pieceId: BK.PIECES[move.pieceIndex].id,
    };
  }

  // ---- grading bands ---------------------------------------------------------

  var BANDS = [
    { key: 'best',  mark: '★', label: '正解（最善手）', tone: 'best' },
    { key: 'great', mark: '◎', label: 'ほぼ最善',       tone: 'great' },
    { key: 'good',  mark: '○', label: '好手',           tone: 'good' },
    { key: 'ok',    mark: '△', label: 'まずまず',       tone: 'ok' },
    { key: 'soft',  mark: '▲', label: '緩手',           tone: 'soft' },
    { key: 'bad',   mark: '✕', label: '疑問手',         tone: 'bad' },
  ];
  function bandByKey(k) { for (var i = 0; i < BANDS.length; i++) if (BANDS[i].key === k) return BANDS[i]; return BANDS[BANDS.length - 1]; }

  function bandFor(isBest, s) {
    if (isBest) return bandByKey('best');
    if (s >= 0.85) return bandByKey('great');
    if (s >= 0.68) return bandByKey('good');
    if (s >= 0.45) return bandByKey('ok');
    if (s >= 0.22) return bandByKey('soft');
    return bandByKey('bad');
  }

  /* Grade `userMove` (cells already absolute flat indices) against the frozen
   * ranking. Deterministic: if the move was deep-scored at generation time we
   * reuse that value, otherwise we deep-score it now at the same depth so the
   * comparison is fair. Returns a rich record for the UI + the lesson note. */
  Puzzle.grade = function (puzzle, userMove) {
    var key = cellsKey(userMove.cells);
    var entry = null;
    for (var i = 0; i < puzzle.ranked.length; i++) {
      if (puzzle.ranked[i].key === key) { entry = puzzle.ranked[i]; break; }
    }
    // Moves inside the ranking are already deep-scored. A move OUTSIDE the
    // deep-scored candidate set is scored on demand at the SAME depth (so the
    // comparison is single-scale) and cached, so re-grading the same move stays
    // deterministic even for the expert Monte-Carlo solver.
    var userValue, userRank;
    if (entry) {
      userValue = entry.value;
      userRank = entry.rank;
    } else if (puzzle.gradeCache[key] != null) {
      userValue = puzzle.gradeCache[key];
      userRank = null;
    } else {
      userValue = deepScore(puzzle.snap, puzzle.level, userMove);
      puzzle.gradeCache[key] = userValue;
      userRank = null;
    }

    var best = puzzle.best, stats = puzzle.stats;
    var span = stats.best - stats.worst;
    var s = span > 1e-9 ? (userValue - stats.worst) / span : 1;
    s = Math.max(0, Math.min(1, s));
    var isBest = userValue >= stats.best - 1e-6;
    var band = bandFor(isBest, s);
    var points = isBest ? 100 : Math.round(s * 100);

    var userC = moveComponents(puzzle.snap, userMove);
    var bestC = moveComponents(puzzle.snap, best.move);

    return {
      level: puzzle.level,
      band: band,
      points: points,
      score01: s,
      isBest: isBest,
      userRank: userRank,
      totalMoves: puzzle.ranked.length,
      userMove: { pieceIndex: userMove.pieceIndex, cells: userMove.cells.slice(), size: userMove.size },
      bestMove: { pieceIndex: best.move.pieceIndex, cells: best.move.cells.slice(), size: best.move.size },
      userComponents: userC,
      bestComponents: bestC,
      summary: puzzle.summary,
      readLabel: puzzle.levelInfo.readLabel,
      explanation: buildExplanation(puzzle, userMove, userC, best, bestC, band, isBest, userRank),
    };
  };

  // ---- explanation / improvement note (pure Japanese, all facts true) --------

  function signed(n) { return (n >= 0 ? '+' : '') + n; }

  function buildExplanation(puzzle, userMove, userC, best, bestC, band, isBest, userRank) {
    var sm = puzzle.summary;
    var position = '盤面：あなたの' + sm.myMoveNumber + '手目（全体の' + sm.overallMoveNumber
      + '手目）。展開先の角は ' + sm.anchors + ' 箇所、相手3人の角は計 ' + sm.oppAnchors
      + ' 箇所、合法手は ' + sm.legalMoves + ' 通り。';

    var yourMove = 'あなたの手：' + Puzzle.describeMove({ pieceIndex: userMove.pieceIndex, size: userMove.size, cells: userMove.cells })
      + '。自色の置きマス +' + userC.size + '、'
      + '次に置ける角 ' + userC.ownBefore + '→' + userC.ownAfter
      + '、相手の角 ' + userC.oppBefore + '→' + userC.oppAfter + '。';

    var bestMove = '最善手：' + Puzzle.describeMove({ pieceIndex: best.move.pieceIndex, size: best.move.size, cells: best.move.cells })
      + '。自色の置きマス +' + bestC.size + '、'
      + '次に置ける角 ' + bestC.ownBefore + '→' + bestC.ownAfter
      + '、相手の角 ' + bestC.oppBefore + '→' + bestC.oppAfter + '。';

    // why the best move is best (true component statements)
    var why = [];
    var ownGain = bestC.ownAfter - bestC.ownBefore;
    if (ownGain > 0) why.push('この手で「次に置ける角」を ' + ownGain + ' 箇所つくり、以降の展開力を高めています。');
    var oppCut = bestC.oppBefore - bestC.oppAfter;
    if (oppCut > 0) why.push('同時に相手の角を ' + oppCut + ' 箇所ふさぎ、相手の手数を削っています。');
    if (bestC.size >= 5) why.push('大型（' + bestC.size + 'マス）ピースを使い、失点（残りマス）を大きく減らしています。');
    if (bestC.center <= 6) why.push('盤の中央寄り（' + bestC.region + '）へ伸ばし、接続点の多い好位置を取っています。');
    if (!why.length) why.push('限られた選択肢の中で、自色の面積と展開先のバランスが最も良い手です。');

    // improvement: how the user's move fell short, component by component
    var improvement = [];
    if (isBest) {
      improvement.push('最善手と一致しています。読み筋の通りで申し分ありません。');
    } else {
      if (userC.size < bestC.size) {
        improvement.push('使ったピースが小さめ（あなた ' + userC.size + 'マス / 最善 ' + bestC.size
          + 'マス）。大型ピースほど置き場所が限られるので、置けるうちに先に使うと失点を減らせます。');
      }
      var userOwnGain = userC.ownAfter - userC.ownBefore;
      if (userOwnGain < ownGain) {
        improvement.push('展開先（角）の増やし方が最善より少なめ（あなた ' + signed(userOwnGain)
          + ' / 最善 ' + signed(ownGain) + '）。1手ごとに新しい角を増やすと、打てる手数が伸びます。');
      }
      var userOppCut = userC.oppBefore - userC.oppAfter;
      if (oppCut > 0 && userOppCut < oppCut) {
        improvement.push('相手の妨害ができていません（あなたが塞いだ相手の角 ' + Math.max(0, userOppCut)
          + ' / 最善 ' + oppCut + '）。自分の展開と相手の妨害を同時に満たす手を狙いましょう。');
      }
      if (userC.center > bestC.center + 3) {
        improvement.push('最善手より盤の端寄りです。中央方向は接続点が多く、展開と妨害の両面で有利になります。');
      }
      if (improvement.length === 0) {
        improvement.push('悪い手ではありませんが、総合評価はわずかに最善に届きませんでした（読み：' + puzzle.levelInfo.readLabel + '）。');
      }
    }

    return { position: position, yourMove: yourMove, bestMove: bestMove, why: why, improvement: improvement };
  }

  Puzzle.BANDS = BANDS;
})(window.BK);
