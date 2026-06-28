/* puzzle-store.js — accumulate one "次の一手" session (a handful of graded
 * puzzles) and render/persist it. Mirrors store.js: a session-summary Markdown
 * is auto-saved into lessons/ via the dev server (POST /api/save-reflection),
 * and silently falls back to a manual download on file:// or GitHub Pages.
 * Also keeps a light cross-session tally in localStorage. */
(function (BK) {
  'use strict';

  var KEY = 'blokus_puzzle_v1';
  var PS = {};
  BK.PuzzleStore = PS;

  // ---- in-memory session -----------------------------------------------------

  PS.newSession = function (level, plannedCount) {
    return {
      level: level,
      levelLabel: BK.Puzzle.levelInfo(level).label,
      readLabel: BK.Puzzle.levelInfo(level).readLabel,
      plannedCount: plannedCount,
      ts: Date.now(),
      dateStr: new Date().toLocaleString('ja-JP'),
      records: [],   // one grade record per solved puzzle
    };
  };

  PS.add = function (session, record) {
    session.records.push(record);
    return session;
  };

  PS.sessionStats = function (session) {
    var rs = session.records;
    if (!rs.length) return { count: 0, total: 0, avg: 0, best: 0 };
    var total = rs.reduce(function (s, r) { return s + r.points; }, 0);
    var best = rs.filter(function (r) { return r.isBest; }).length;
    return {
      count: rs.length,
      total: total,
      avg: Math.round(total / rs.length),
      best: best,
    };
  };

  // Aggregate the most common improvement themes across the session (for 総評).
  PS.sessionThemes = function (session) {
    var counts = { small: 0, anchors: 0, block: 0, edge: 0 };
    session.records.forEach(function (r) {
      if (r.isBest) return;
      var uc = r.userComponents, bc = r.bestComponents;
      if (uc.size < bc.size) counts.small++;
      if ((uc.ownAfter - uc.ownBefore) < (bc.ownAfter - bc.ownBefore)) counts.anchors++;
      if ((bc.oppBefore - bc.oppAfter) > 0 && (uc.oppBefore - uc.oppAfter) < (bc.oppBefore - bc.oppAfter)) counts.block++;
      if (uc.center > bc.center + 3) counts.edge++;
    });
    var themes = [];
    if (counts.anchors >= 2) themes.push('「次に置ける角づくり」が最善より弱い傾向。1手ごとに角を増やす意識を。');
    if (counts.small >= 2) themes.push('大型ピースを後回しにしがち。置けるうちに大きいピースから使う。');
    if (counts.block >= 2) themes.push('相手の妨害（相手の角を塞ぐ手）を見落としがち。攻防一体の手を狙う。');
    if (counts.edge >= 2) themes.push('端寄りに置く場面が目立つ。中央方向は接続点が多く有利。');
    if (!themes.length) themes.push('大きな傾向的弱点はありません。さらに上のレベルや、より深い読みに挑戦しましょう。');
    return themes;
  };

  // ---- markdown --------------------------------------------------------------

  function li(items) { return items.map(function (x) { return '- ' + x; }).join('\n'); }

  PS.toMarkdown = function (session) {
    var st = PS.sessionStats(session);
    var out = '# 詰めブロックス（次の一手）セッション — ' + session.dateStr + '\n\n';
    out += '- レベル: ' + session.levelLabel + '（読み: ' + session.readLabel + '）\n';
    out += '- 出題数: ' + st.count + ' 問 ／ 合計 ' + st.total + ' 点 ／ 平均 ' + st.avg
      + ' 点 ／ 最善一致 ' + st.best + ' 問\n\n';

    session.records.forEach(function (r, i) {
      var e = r.explanation;
      out += '## 第' + (i + 1) + '問　' + r.band.mark + ' ' + r.band.label
        + '（' + r.points + '点）\n';
      out += '- ' + e.position + '\n';
      out += '- ' + e.yourMove + '\n';
      out += '- ' + e.bestMove + '\n';
      out += '\n**この最善手が良い理由**\n' + li(e.why) + '\n\n';
      out += '**あなたの手の改善点**\n' + li(e.improvement) + '\n\n';
    });

    out += '## 総評（このセッションの傾向）\n' + li(PS.sessionThemes(session)) + '\n';
    return out;
  };

  // ---- cross-session tally (localStorage) ------------------------------------

  PS.loadHistory = function () {
    try { return JSON.parse(localStorage.getItem(KEY)) || []; }
    catch (e) { return []; }
  };

  PS.saveHistory = function (session) {
    var st = PS.sessionStats(session);
    var all = PS.loadHistory();
    all.push({
      ts: session.ts, dateStr: session.dateStr, level: session.level,
      levelLabel: session.levelLabel, count: st.count, avg: st.avg, best: st.best,
    });
    try { localStorage.setItem(KEY, JSON.stringify(all)); } catch (e) { /* quota */ }
    return all;
  };

  PS.historySummary = function () {
    var all = PS.loadHistory();
    if (!all.length) return { sessions: 0 };
    var puzzles = all.reduce(function (s, r) { return s + r.count; }, 0);
    var avg = Math.round(all.reduce(function (s, r) { return s + r.avg * r.count; }, 0) / Math.max(1, puzzles));
    return { sessions: all.length, puzzles: puzzles, avg: avg };
  };

  PS.clearHistory = function () { try { localStorage.removeItem(KEY); } catch (e) { /* ignore */ } };

  // ---- save / download (mirrors store.js) ------------------------------------

  function stamp(ts) {
    var d = new Date(ts);
    var pad = function (n) { return (n < 10 ? '0' : '') + n; };
    return d.getFullYear() + pad(d.getMonth() + 1) + pad(d.getDate())
      + '-' + pad(d.getHours()) + pad(d.getMinutes()) + pad(d.getSeconds());
  }

  PS.filenameFor = function (session) { return '次の一手-' + stamp(session.ts) + '.md'; };

  // Best-effort autosave into the dev server's lessons/ folder. No-op on file://
  // and GitHub Pages (static, no backend) — same policy as store.js. Resolves to
  // the server response { ok, path } or null.
  PS.autosaveToLessons = function (session) {
    try {
      if (location.protocol === 'file:' || /(^|\.)github\.io$/i.test(location.hostname)) {
        return Promise.resolve(null);
      }
      return fetch('/api/save-reflection', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filename: PS.filenameFor(session), markdown: PS.toMarkdown(session) }),
      }).then(function (res) { return res.ok ? res.json() : null; })
        .catch(function () { return null; });
    } catch (e) { return Promise.resolve(null); }
  };

  PS.download = function (filename, text) {
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
