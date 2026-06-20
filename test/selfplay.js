/* Node self-play / correctness harness for the Blokus engine.
 * Loads the DOM-free core (constants, pieces, rules, state, ai) with a window
 * shim and runs assertions + AI self-play. Run:  node test/selfplay.js        */
'use strict';
global.window = global;                 // files attach to window.BK
const path = require('path');
['constants', 'pieces', 'rules', 'state', 'ai', 'analysis'].forEach(function (f) {
  require(path.join(__dirname, '..', 'js', f + '.js'));
});
const BK = global.BK;
const N = BK.BOARD_SIZE;

let failures = 0;
function ok(cond, msg) {
  if (cond) { console.log('  ✓ ' + msg); }
  else { console.log('  ✗ ' + msg); failures++; }
}
function eq(a, b, msg) { ok(a === b, msg + '  (got ' + a + ', want ' + b + ')'); }

// ---- 1. piece geometry -----------------------------------------------------
console.log('\n[1] ピース定義');
eq(BK.PIECE_COUNT, 21, '21ピース');
eq(BK.TOTAL_CELLS, 89, '合計89マス');
eq(BK.PIECES[BK.MONO_INDEX].size, 1, 'モノミノはサイズ1');

const EXPECT_ORI = {
  I1: 1, I2: 2, V3: 4, I3: 2, O4: 1, T4: 4, L4: 8, S4: 4, I4: 2,
  F5: 8, T5: 4, U5: 4, V5: 4, W5: 4, X5: 1, Z5: 4, P5: 8, N5: 8, Y5: 8, L5: 8, I5: 2,
};
let oriOk = true;
BK.PIECES.forEach(function (p) {
  if (p.orientations.length !== EXPECT_ORI[p.id]) {
    oriOk = false;
    console.log('    ! ' + p.id + ' orientations=' + p.orientations.length + ' expected ' + EXPECT_ORI[p.id]);
  }
});
ok(oriOk, '全ピースの向き数が正準値と一致');

// rotate/flip transition tables are valid indices
let transOk = true;
BK.PIECES.forEach(function (p) {
  p.orientations.forEach(function (o) {
    if (typeof o.rotateTo !== 'number' || typeof o.flipTo !== 'number') transOk = false;
  });
});
ok(transOk, '回転/反転の遷移表が有効');

// ---- 2. independent rule validator (cross-checks BK.isLegal) ---------------
function validateScratch(board, color, cells, isFirst) {
  let coversCorner = false, edge = false, corner = false;
  const corn = BK.CORNERS[color];
  for (const i of cells) {
    if (i < 0 || i >= BK.CELLS) return false;
    if (board[i] !== BK.EMPTY) return false;
    const r = (i / N) | 0, c = i % N;
    if (r === corn[0] && c === corn[1]) coversCorner = true;
    for (const [dr, dc] of BK.ORTHO) {
      const rr = r + dr, cc = c + dc;
      if (rr >= 0 && cc >= 0 && rr < N && cc < N && board[rr * N + cc] === color) edge = true;
    }
    for (const [dr, dc] of BK.DIAG) {
      const rr = r + dr, cc = c + dc;
      if (rr >= 0 && cc >= 0 && rr < N && cc < N && board[rr * N + cc] === color) corner = true;
    }
  }
  if (isFirst) return coversCorner;
  return !edge && corner;
}

console.log('\n[2] ルール検証');
let g = BK.createGame({ humanLevel: 'advanced', seats: [
  { isHuman: false, difficulty: 'advanced', name: 'P0' },
  { isHuman: false, difficulty: 'advanced', name: 'P1' },
  { isHuman: false, difficulty: 'advanced', name: 'P2' },
  { isHuman: false, difficulty: 'advanced', name: 'P3' },
]});

const firstMoves = BK.generateMoves(g.board, 0, g.players[0].remaining, true, BK.CORNERS[0]);
ok(firstMoves.length > 0, '初手の合法手が存在する');
const cornerIdx = BK.CORNERS[0][0] * N + BK.CORNERS[0][1];
ok(firstMoves.every(function (m) { return m.cells.indexOf(cornerIdx) !== -1; }), '初手は全て角を覆う');

// place a first piece, then cross-check second-move generation
g = BK.applyMove(g, firstMoves.find(function (m) { return m.size === 2; }) || firstMoves[0]);
// it's now player 1; force back to player 0's perspective for a second-move test:
const secondMoves = BK.generateMoves(g.board, 0, g.players[0].remaining, false, BK.CORNERS[0]);
ok(secondMoves.length > 0, '2手目の合法手が存在する');
ok(secondMoves.every(function (m) { return validateScratch(g.board, 0, m.cells, false); }),
   '生成された2手目は全て独立検証でも合法（角接続・辺非接触）');

// a deliberately illegal edge-adjacent placement must be rejected
const adj = firstMoves[0].cells[0];                 // a cell occupied by color 0
const ar = (adj / N | 0), ac = adj % N;
const edgeCell = (ac + 1 < N) ? [[ar, ac + 1]] : [[ar + 1, ac]];
ok(!BK.isLegal(g.board, 0, edgeCell, false, BK.CORNERS[0][0], BK.CORNERS[0][1]),
   '自色と辺で接する配置は却下される');

// ---- 3. full self-play game integrity --------------------------------------
async function playGame(diffs, budget) {
  BK.TIME_BUDGET.expert = budget;
  let game = BK.createGame({ humanLevel: 'advanced', seats: diffs.map(function (d, i) {
    return { isHuman: false, difficulty: d, name: 'P' + i };
  })});
  let guard = 0;
  while (game.status === 'playing' && guard++ < 500) {
    const id = game.current;
    const mv = await BK.AI.selectMove(game, id, game.players[id].difficulty);
    game = (mv === null) ? BK.passPlayer(game) : BK.applyMove(game, mv);
  }
  return { game, guard };
}

(async function () {
  console.log('\n[3] フル対局の整合性（中級×4）');
  const { game, guard } = await playGame(['intermediate', 'intermediate', 'intermediate', 'intermediate'], 100);
  eq(game.status, 'over', '対局が正常終了する');
  ok(guard < 500, '無限ループにならない');
  // board integrity: occupied cells == sum of placed cells
  let occ = 0; for (let i = 0; i < BK.CELLS; i++) if (game.board[i] !== BK.EMPTY) occ++;
  let placedCells = 0;
  game.players.forEach(function (p) { placedCells += (89 - BK.remainingCells(p)); });
  eq(occ, placedCells, '盤上の占有マス数=各色の配置マス合計（重なりなし）');
  ok(occ <= 89 * 4, '占有マスが上限以内');
  const rank = BK.ranking(game);
  eq(rank.length, 4, 'ランキングは4人分');
  ok(rank[0].rank === 1, '1位が決まる');
  console.log('    最終得点: ' + rank.map(function (r) { return r.name + '=' + r.score; }).join(', '));

  // ---- 4. tier strength ordering ------------------------------------------
  console.log('\n[4] 難易度の強さ序列（上級 vs 初級×3, 6戦）');
  let advWins = 0, GAMES = 6;
  for (let n = 0; n < GAMES; n++) {
    const r = await playGame(['advanced', 'beginner', 'beginner', 'beginner'], 80);
    const rk = BK.ranking(r.game);
    if (rk[0].id === 0) advWins++;
  }
  ok(advWins >= 4, '上級が初級に対し優勢（' + advWins + '/' + GAMES + '勝）');

  console.log('\n[4b] 超上級が実行でき合法に対局完了（予算150ms, 1戦）');
  const ex = await playGame(['expert', 'beginner', 'beginner', 'beginner'], 150);
  eq(ex.game.status, 'over', '超上級を含む対局が完了する');
  const exRank = BK.ranking(ex.game);
  console.log('    超上級の順位: ' + exRank.find(function (r) { return r.id === 0; }).rank + '位');

  // ---- 5. post-game reflection (analysis.js) ------------------------------
  console.log('\n[5] 振り返り生成（analysis.js）');
  let analysisOk = true;
  for (const diffs of [
    ['advanced', 'beginner', 'beginner', 'beginner'],
    ['beginner', 'expert', 'advanced', 'intermediate'],
    ['intermediate', 'intermediate', 'intermediate', 'intermediate'],
  ]) {
    const r = await playGame(diffs, 60);
    let rec;
    try { rec = BK.analyzeGame(r.game); }
    catch (e) { analysisOk = false; console.log('    ! analyzeGame threw: ' + e.message); continue; }
    if (!rec || !Array.isArray(rec.strengths) || !rec.strengths.length) analysisOk = false;
    if (!Array.isArray(rec.weaknesses) || !rec.weaknesses.length) analysisOk = false;
    if (!Array.isArray(rec.tips) || !rec.tips.length) analysisOk = false;
    if (typeof rec.score !== 'number' || rec.rank < 1 || rec.rank > 4) analysisOk = false;
    if (rec.placedPieces < 0 || rec.placedPieces > 21) analysisOk = false;
  }
  ok(analysisOk, '3シナリオで振り返り(強み/弱み/戦略)が例外なく生成される');
  const demo = BK.analyzeGame((await playGame(['intermediate', 'beginner', 'beginner', 'beginner'], 60)).game);
  console.log('    例: ' + demo.rank + '位 / 配置' + demo.placedPieces + ' / 強み' + demo.strengths.length
    + '・弱み' + demo.weaknesses.length + '・戦略' + demo.tips.length + '件');

  console.log('\n' + (failures === 0 ? '✅ 全テスト合格' : '❌ ' + failures + '件の失敗'));
  process.exit(failures === 0 ? 0 : 1);
})();
