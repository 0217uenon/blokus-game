/* store.js — accumulate post-game reflections across sessions (localStorage)
 * and export them as a Markdown "上達ノート" the user can keep as context. */
(function (BK) {
  'use strict';

  var KEY = 'blokus_reflections_v1';
  var Store = {};
  BK.Store = Store;

  Store.load = function () {
    try { return JSON.parse(localStorage.getItem(KEY)) || []; }
    catch (e) { return []; }
  };

  Store.save = function (record) {
    var all = Store.load();
    all.push(record);
    try { localStorage.setItem(KEY, JSON.stringify(all)); } catch (e) { /* quota: ignore */ }
    return all;
  };

  Store.clear = function () {
    try { localStorage.removeItem(KEY); } catch (e) { /* ignore */ }
  };

  // aggregate stats over all recorded games
  Store.summary = function () {
    var all = Store.load();
    if (!all.length) return { games: 0 };
    var wins = all.filter(function (r) { return r.rank === 1; }).length;
    var avgScore = all.reduce(function (s, r) { return s + r.score; }, 0) / all.length;
    var avgPlaced = all.reduce(function (s, r) { return s + r.placedPieces; }, 0) / all.length;
    return { games: all.length, wins: wins, avgScore: Math.round(avgScore * 10) / 10,
      avgPlaced: Math.round(avgPlaced * 10) / 10 };
  };

  Store.toMarkdown = function (list) {
    list = list || Store.load();
    var s = BK.Store.summary();
    var out = '# ブロックス 上達ノート\n\n';
    if (s.games) {
      out += '- 記録対局数: ' + s.games + '戦（1位 ' + s.wins + '回）\n';
      out += '- 平均得点: ' + s.avgScore + ' ／ 平均配置数: ' + s.avgPlaced + '/21\n\n';
    }
    list.forEach(function (r, i) {
      out += '## 第' + (i + 1) + '戦  ' + r.dateStr + '\n';
      out += '- 結果: ' + r.rank + '位（得点 ' + r.score + '、配置 ' + r.placedPieces + '/21、残り ' + r.remainingCells + 'マス）\n';
      out += '- あなたの棋力設定: ' + BK.difficultyLabel(r.humanLevel) + '\n';
      out += '- 対戦相手: ' + r.opponents.map(function (o) {
        return o.color + '(' + BK.difficultyLabel(o.difficulty) + ')=' + o.score + '点';
      }).join('、') + '\n\n';
      out += '**良かった点**\n' + r.strengths.map(function (x) { return '- ' + x; }).join('\n') + '\n\n';
      out += '**改善点**\n' + r.weaknesses.map(function (x) { return '- ' + x; }).join('\n') + '\n\n';
      out += '**次回の戦略**\n' + r.tips.map(function (x) { return '- ' + x; }).join('\n') + '\n\n';
    });
    return out;
  };

  Store.download = function (filename, text) {
    var blob = new Blob([text], { type: 'text/markdown;charset=utf-8' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 0);
  };
})(window.BK);
