/* analysis.js — post-game reflection. Pure functions that read the finished
 * GameState (+ move history) and produce a Japanese review: strengths,
 * weaknesses, and improvement strategy, tailored to the human's declared level.
 * Runs fully offline (no API). The human is always player 0. */
(function (BK) {
  'use strict';

  var N = BK.BOARD_SIZE;
  var CENTER = (N - 1) / 2;

  function minCenterDist(cells) {
    var best = Infinity;
    for (var i = 0; i < cells.length; i++) {
      var r = (cells[i] / N) | 0, c = cells[i] % N;
      var d = Math.abs(r - CENTER) + Math.abs(c - CENTER);
      if (d < best) best = d;
    }
    return best;
  }

  // replay the move history to recover the human's per-move trajectory
  function replay(game) {
    var board = new Int8Array(BK.CELLS).fill(BK.EMPTY);
    var human = [];
    game.history.forEach(function (h) {
      for (var i = 0; i < h.move.cells.length; i++) board[h.move.cells[i]] = h.player;
      if (h.player === 0) {
        human.push({
          n: human.length + 1,                 // human's move number (1-based)
          size: h.move.size,
          pieceIndex: h.move.pieceIndex,
          anchors: BK.computeAnchors(board, 0).length,
          minCenter: minCenterDist(h.move.cells),
        });
      }
    });
    return human;
  }

  BK.analyzeGame = function (game) {
    var rank = BK.ranking(game);
    var me = game.players[0];
    var myRow = rank.filter(function (r) { return r.id === 0; })[0];
    var hm = replay(game);

    var placedPieces = hm.length;
    var remainingCells = BK.remainingCells(me);
    var allPlaced = placedPieces === BK.PIECE_COUNT;

    var bigEarly = hm.slice(0, 8).filter(function (m) { return m.size >= 5; }).length;
    var smallEarly = hm.slice(0, 5).filter(function (m) { return m.size <= 2; }).length;
    var mobilityPeak = hm.reduce(function (a, m) { return Math.max(a, m.anchors); }, 0);
    var mobilityEnd = hm.length ? hm[hm.length - 1].anchors : 0;

    var collapseMove = null;
    for (var i = 0; i < hm.length; i++) {
      if (hm[i].anchors === 0 && i < BK.PIECE_COUNT - 3) { collapseMove = hm[i].n; break; }
    }
    var centerMove = null;
    for (var j = 0; j < hm.length; j++) {
      if (hm[j].minCenter <= 6) { centerMove = hm[j].n; break; }
    }
    var monoMove = null;
    for (var k = 0; k < hm.length; k++) {
      if (hm[k].pieceIndex === BK.MONO_INDEX) { monoMove = hm[k].n; break; }
    }

    var bigLeft = [], bigLeftCells = 0;
    for (var pi = 0; pi < BK.PIECE_COUNT; pi++) {
      if (me.remaining[pi] && BK.PIECES[pi].size >= 4) {
        bigLeft.push(BK.PIECES[pi].id + '(' + BK.PIECES[pi].size + 'マス)');
        bigLeftCells += BK.PIECES[pi].size;
      }
    }

    // ---- build review text ----
    var strengths = [], weaknesses = [];

    if (allPlaced) strengths.push('全21ピースを置き切りました（配置ボーナス獲得）。展開力が非常に高いです。');
    else if (remainingCells <= 8) strengths.push('残り' + remainingCells + 'マスまで置き切れており、終盤までよく展開できています。');

    if (bigEarly >= 4) strengths.push('序盤8手のうち' + bigEarly + '手で大型(5マス)ピースを使えており、効率的な立ち上がりです。');
    else if (bigEarly <= 1) weaknesses.push('序盤に大型(5マス)ピースをあまり使えていません。最初の5〜6手は大きいピースから置くと有利です。');

    if (smallEarly >= 2) weaknesses.push('序盤5手で小型(1〜2マス)ピースを' + smallEarly + '個使っています。小型は終盤の調整用に温存しましょう。');

    if (collapseMove !== null) weaknesses.push('あなたの' + collapseMove + '手目付近で「次に置ける角」が尽き、早めに詰まってしまいました。1手ごとに新しい角を2つ以上作る意識を持ちましょう。');
    else if (mobilityEnd <= 2 && !allPlaced) weaknesses.push('終盤に展開先(角)が少なくなっていました。早めに広い方向・中央へ伸ばすと長く打てます。');
    else if (mobilityPeak >= 10) strengths.push('中盤にかけて多くの展開先(角)を確保できていました（最大' + mobilityPeak + '箇所）。');

    if (centerMove !== null && centerMove <= 4) strengths.push(centerMove + '手目で中央付近へ進出できており、盤の主導権を取れています。');
    else if (centerMove === null) weaknesses.push('自分の角周辺にとどまり、中央へ出られていません。中央は接続点が多く、展開・妨害の両面で有利です。');

    if (allPlaced && me.lastPieceIndex === BK.MONO_INDEX) strengths.push('最後を1マスピースで締め、+ボーナスを獲得できました。理想的な手仕舞いです。');
    else if (monoMove !== null && monoMove <= placedPieces - 3) weaknesses.push('1マスピースを早め(' + monoMove + '手目)に使っています。最後に置くと+5点ボーナスなので、終盤まで温存しましょう。');

    if (bigLeft.length) weaknesses.push('大型ピースが未使用で残りました：' + bigLeft.join('、') + '（計' + bigLeftCells + 'マスの失点）。大型ほど置き場所が限られるので早めに使うのが鉄則です。');

    if (myRow.rank === 1) strengths.push('結果は堂々の1位。');
    else if (myRow.rank === 4) weaknesses.push('結果は4位。まずは「序盤の大型展開」と「角づくり」を最優先で意識してみましょう。');

    if (!strengths.length) strengths.push('最後まで完走できました。まずは1ゲーム通して打ち切れたことが第一歩です。');
    if (!weaknesses.length) weaknesses.push('大きな失敗はありません。さらに上を目指すなら、相手の妨害と終盤の詰めを磨きましょう。');

    var tips = buildTips(game.humanLevel, { collapseMove: collapseMove, bigEarly: bigEarly, centerMove: centerMove });

    return {
      ts: Date.now(),
      dateStr: new Date().toLocaleString('ja-JP'),
      humanLevel: game.humanLevel,
      rank: myRow.rank,
      score: myRow.score,
      placedPieces: placedPieces,
      remainingCells: remainingCells,
      allPlaced: allPlaced,
      opponents: rank.filter(function (r) { return r.id !== 0; }).map(function (r) {
        return { color: BK.COLORS[r.id].name, difficulty: r.difficulty, score: r.score, rank: r.rank };
      }),
      strengths: strengths,
      weaknesses: weaknesses,
      tips: tips,
      metrics: { bigEarly: bigEarly, smallEarly: smallEarly, mobilityPeak: mobilityPeak,
        mobilityEnd: mobilityEnd, collapseMove: collapseMove, centerMove: centerMove, bigLeftCells: bigLeftCells },
    };
  };

  function buildTips(level, m) {
    var base = [
      '大型(5マス)ピースから先に置き、小型は終盤の調整用に残す。',
      '1手ごとに「次に置ける角(斜めの接続点)」を増やす。角の数＝打てる手数。',
      '序盤は中央へ向けて展開し、盤の主導権を取る。',
      '相手の展開先(角)を自分のピースで塞ぐと、相手の手数を削れる。',
      '1マスピースは最後に置く(最後が1マスなら合計+20点)。',
    ];
    var beginner = [
      'まずは「自分の色と辺でくっつけない・角で必ずつなぐ」を徹底する。',
      '迷ったら中央方向へ伸ばすと、置ける場所が自然に増える。',
    ];
    var advanced = [
      'F・Y・N・Z・W など扱いにくい形は、狭い隙間用に温存する選択も。',
      '終盤は残りマス(=失点)の最小化を意識し、パリティや詰めを計算する。',
      '「自分の展開」と「相手の妨害」を同時に満たす手(共有の角を取る)を優先する。',
    ];
    var tips = base.slice();
    if (level === 'beginner' || level === 'intermediate') tips = tips.concat(beginner);
    if (level === 'advanced' || level === 'expert') tips = tips.concat(advanced);
    return tips;
  }
})(window.BK);
