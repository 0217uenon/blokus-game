/* Node correctness harness for the "次の一手"（詰めブロックス）puzzle engine.
 * Loads the DOM-free core + puzzle engine/store with a window shim and asserts
 * generation, ranking, legality, grading bands, determinism, and note output.
 * Run:  node test/puzzle.js                                                    */
'use strict';
global.window = global;
const path = require('path');
['constants', 'pieces', 'rules', 'state', 'ai', 'puzzle-engine', 'puzzle-store'].forEach(function (f) {
  require(path.join(__dirname, '..', 'js', f + '.js'));
});
const BK = global.BK;
const N = BK.BOARD_SIZE;

let failures = 0;
function ok(cond, msg) { if (cond) console.log('  ✓ ' + msg); else { console.log('  ✗ ' + msg); failures++; } }
function eq(a, b, msg) { ok(a === b, msg + '  (got ' + a + ', want ' + b + ')'); }

// independent legality check (cross-checks BK.isLegal), copied from selfplay.js
function validScratch(board, color, cells) {
  let edge = false, corner = false;
  for (const i of cells) {
    if (i < 0 || i >= BK.CELLS || board[i] !== BK.EMPTY) return false;
    const r = (i / N) | 0, c = i % N;
    for (const [dr, dc] of BK.ORTHO) {
      const rr = r + dr, cc = c + dc;
      if (rr >= 0 && cc >= 0 && rr < N && cc < N && board[rr * N + cc] === color) edge = true;
    }
    for (const [dr, dc] of BK.DIAG) {
      const rr = r + dr, cc = c + dc;
      if (rr >= 0 && cc >= 0 && rr < N && cc < N && board[rr * N + cc] === color) corner = true;
    }
  }
  return !edge && corner;
}

(async function () {
  const LEVELS = ['beginner', 'intermediate', 'advanced', 'expert'];

  for (const level of LEVELS) {
    const L = BK.Puzzle.levelInfo(level);
    console.log('\n[' + L.label + '] 出題（読み: ' + L.readLabel + '）');

    const t0 = Date.now();
    let puzzle = null;
    for (let tryN = 0; tryN < 3 && !puzzle; tryN++) puzzle = await BK.Puzzle.generate(level);
    const ms = Date.now() - t0;
    ok(!!puzzle, '局面を生成できる');
    if (!puzzle) continue;
    console.log('    生成 ' + ms + 'ms / 合法手 ' + puzzle.ranked.length
      + ' / 鋭さ(best-median)=' + puzzle.gap.toFixed(2)
      + ' / あなたの' + puzzle.summary.myMoveNumber + '手目');

    // ranking integrity
    let sorted = true, allLegal = true;
    for (let i = 1; i < puzzle.ranked.length; i++) {
      if (puzzle.ranked[i].value > puzzle.ranked[i - 1].value + 1e-9) sorted = false;
    }
    for (const r of puzzle.ranked) {
      if (!validScratch(puzzle.board, 0, r.cells)) allLegal = false;
      if (!BK.isLegal(puzzle.board, 0, r.cells.map(function (i) { return [(i / N) | 0, i % N]; }),
        false, BK.CORNERS[0][0], BK.CORNERS[0][1])) allLegal = false;
    }
    ok(sorted, 'ランキングは評価値の降順');
    ok(allLegal, '全候補手が独立検証でも合法（BK.isLegalとも一致）');
    ok(puzzle.best === puzzle.ranked[0], '最善手はランキング先頭');
    ok(puzzle.ranked.every(function (r) { return r.deep === true; }),
      'ランキングは全て深い読みで評価済み（priorの混在なし）');
    ok(puzzle.totalLegal >= L.minMoves, '全合法手が最低数(' + L.minMoves + ')以上');
    ok(puzzle.summary.legalMoves === puzzle.totalLegal, 'summary.legalMovesは全合法手数');
    ok(puzzle.ranked.length === Math.min(L.topK, puzzle.totalLegal),
      'ランキング長は深評価した上位topK（=min(topK, 全合法手)）');

    // grading: best move -> 100/正解
    const gBest = BK.Puzzle.grade(puzzle, puzzle.best.move);
    eq(gBest.points, 100, '最善手の採点は100点');
    ok(gBest.isBest && gBest.band.key === 'best', '最善手は★正解判定');

    // grading: worst-ranked move -> not best, fewer points
    const worst = puzzle.ranked[puzzle.ranked.length - 1];
    const gWorst = BK.Puzzle.grade(puzzle, worst.move);
    ok(!gWorst.isBest, '最下位手は最善ではない');
    ok(gWorst.points <= gBest.points, '最下位手の点 ≤ 最善手の点');

    // grading a move OUTSIDE the deep-scored candidate set (on-demand deepScore
    // + cache). Pick a legal move whose key isn't in `ranked`.
    const allMoves = BK.generateMoves(puzzle.board, 0, puzzle.snap.remaining[0],
      !puzzle.snap.hasPlayed[0], BK.CORNERS[0]);
    const keyOf = (m) => m.cells.slice().sort((a, b) => a - b).join(',');
    const rankedKeys = new Set(puzzle.ranked.map((r) => keyOf(r)));
    const outside = allMoves.find((m) => !rankedKeys.has(keyOf(m)));
    let graded = true, gradedDet = true;
    if (outside) {
      try {
        const g1 = BK.Puzzle.grade(puzzle, outside);
        const g2 = BK.Puzzle.grade(puzzle, outside);
        if (g1.points !== g2.points) gradedDet = false;
      } catch (e) { graded = false; console.log('    ! grade(outside) threw: ' + e.message); }
    }
    ok(graded, '候補外の手も例外なく採点できる（オンデマンド深評価）');
    ok(gradedDet, '候補外の手の再採点も決定的（キャッシュ）');

    // determinism: same move graded twice -> identical points
    const a = BK.Puzzle.grade(puzzle, worst.move).points;
    const b = BK.Puzzle.grade(puzzle, worst.move).points;
    eq(a, b, '同じ手の採点は決定的（凍結済み）');

    // explanation shape
    const e = gWorst.explanation;
    ok(e && e.position && e.yourMove && e.bestMove && Array.isArray(e.why) && Array.isArray(e.improvement)
      && e.why.length > 0 && e.improvement.length > 0, '解説（局面/あなたの手/最善手/理由/改善点）が揃う');
  }

  // session note (markdown) builds without throwing and contains key headers
  console.log('\n[ノート] セッション要約 Markdown');
  let mdOk = true, md = '';
  try {
    const session = BK.PuzzleStore.newSession('advanced', 3);
    for (let i = 0; i < 3; i++) {
      const p = await BK.Puzzle.generate('advanced');
      if (!p) continue;
      // alternate between a strong and a weak answer to exercise both paths
      const pick = (i % 2 === 0) ? p.best.move : p.ranked[p.ranked.length - 1].move;
      BK.PuzzleStore.add(session, BK.Puzzle.grade(p, pick));
    }
    md = BK.PuzzleStore.toMarkdown(session);
  } catch (err) { mdOk = false; console.log('    ! md threw: ' + err.message); }
  ok(mdOk, 'セッションMarkdownが例外なく生成される');
  ok(md.indexOf('# 詰めブロックス') === 0, '見出しが正しい');
  ok(/## 第1問/.test(md) && /## 総評/.test(md), '各問＋総評セクションを含む');
  ok(/次の一手-\d{8}-\d{6}\.md/.test(BK.PuzzleStore.filenameFor(BK.PuzzleStore.newSession('beginner', 1))),
    'lessons/ 保存ファイル名が規約どおり');

  console.log('\n' + (failures === 0 ? '✅ 全テスト合格' : '❌ ' + failures + '件の失敗'));
  process.exit(failures === 0 ? 0 : 1);
})();
