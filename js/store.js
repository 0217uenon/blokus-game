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

  // Standalone Markdown for a SINGLE game's reflection (used by lessons/ autosave).
  Store.recordToMarkdown = function (r) {
    var out = '# ブロックス 振り返り — ' + r.dateStr + '\n\n';
    out += '- 結果: ' + r.rank + '位（得点 ' + r.score + '、配置 ' + r.placedPieces + '/21、残り ' + r.remainingCells + 'マス）\n';
    out += '- あなたの棋力設定: ' + BK.difficultyLabel(r.humanLevel) + '\n';
    out += '- 対戦相手: ' + r.opponents.map(function (o) {
      return o.color + '(' + BK.difficultyLabel(o.difficulty) + ')=' + o.score + '点';
    }).join('、') + '\n\n';
    out += '## 良かった点\n' + r.strengths.map(function (x) { return '- ' + x; }).join('\n') + '\n\n';
    out += '## 改善点\n' + r.weaknesses.map(function (x) { return '- ' + x; }).join('\n') + '\n\n';
    out += '## 次回の戦略\n' + r.tips.map(function (x) { return '- ' + x; }).join('\n') + '\n';
    return out;
  };

  // Best-effort autosave of one game's reflection into the dev server's lessons/
  // folder. No-op unless served from localhost (only the Node server in
  // test/serve.js can write to disk). Resolves to the server response or null.
  Store.autosaveToLessons = function (record) {
    try {
      // Only attempt when there could be a local Node backend: skip file:// (no
      // server) and the GitHub Pages deployment (static, no backend). This still
      // fires for localhost AND LAN-IP access to the dev server, so a phone
      // playing through the PC's server saves onto the PC's lessons/ folder.
      if (location.protocol === 'file:' || /(^|\.)github\.io$/i.test(location.hostname)) {
        return Promise.resolve(null);
      }
      var d = new Date(record.ts);
      var pad = function (n) { return (n < 10 ? '0' : '') + n; };
      var stamp = d.getFullYear() + pad(d.getMonth() + 1) + pad(d.getDate())
        + '-' + pad(d.getHours()) + pad(d.getMinutes()) + pad(d.getSeconds());
      var filename = '振り返り-' + stamp + '.md';
      return fetch('/api/save-reflection', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filename: filename, markdown: Store.recordToMarkdown(record) }),
      }).then(function (res) { return res.ok ? res.json() : null; })
        .catch(function () { return null; });
    } catch (e) { return Promise.resolve(null); }
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
