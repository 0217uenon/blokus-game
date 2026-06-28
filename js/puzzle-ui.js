/* puzzle-ui.js — controller for 詰めブロックス（次の一手）.
 * Setup (level + count) → solve (pick ONE move) → reveal (grade + 解説/改善点)
 * → repeat → session summary saved to lessons/. Reuses BK.createRenderer /
 * BK.renderTray and mirrors ui.js's two-path input (mouse click commits; touch
 * arms then confirms). The board is always 青(seat 0) to move. */
(function (BK) {
  'use strict';

  var N = BK.BOARD_SIZE;
  var PUI = {};
  BK.PuzzleUI = PUI;

  var el = {};
  var renderer = null;

  var level = 'beginner';
  var levelInfo = null;
  var count = 6;
  var session = null;
  var puzzle = null;
  var puzzleIndex = 0;
  var view = null;                 // { board, players:[{id:0,remaining}], isFirst }
  var sel = { piece: null, ori: 0, hover: null, armed: false };
  var mode = 'solve';              // 'solve' | 'reveal'
  var busy = true;                 // locks input while generating / after answer
  var lastInputWasTouch = false;

  // tone -> swatch color for the end-screen list
  var TONE_COLOR = { best: '#eab308', great: '#16a34a', good: '#16a34a', ok: '#eab308', soft: '#f97316', bad: '#dc2626' };

  PUI.init = function (refs) {
    el = refs;
    renderer = BK.createRenderer(el.board);
    levelInfo = BK.Puzzle.levelInfo(level);
    wireSetup();
    wirePlay();
    wireEnd();
    show('setup');
    refreshHistory();
  };

  // ---- setup ----------------------------------------------------------------

  function wireSetup() {
    // level cards (built from the engine so labels/read-depth never drift)
    ['beginner', 'intermediate', 'advanced', 'expert'].forEach(function (key) {
      var L = BK.Puzzle.levelInfo(key);
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'level-card' + (key === level ? ' selected' : '');
      btn.setAttribute('data-level', key);
      btn.innerHTML = '<span class="lc-name">' + escapeHtml(L.label) + '</span>'
        + '<span class="lc-read">読み: ' + escapeHtml(L.readLabel) + '</span>';
      btn.addEventListener('click', function () { level = key; levelInfo = L; markSelectedLevel(); });
      el.levelCards.appendChild(btn);
    });
    // count options
    [3, 6, 10].forEach(function (n) {
      var o = document.createElement('option');
      o.value = String(n); o.textContent = n + ' 問';
      if (n === count) o.selected = true;
      el.countSelect.appendChild(o);
    });
    el.btnStart.addEventListener('click', startSession);
    el.btnClear.addEventListener('click', function () {
      if (window.confirm('詰めブロックスの記録（成績）をすべて消去しますか？')) {
        BK.PuzzleStore.clearHistory();
        refreshHistory();
      }
    });
  }

  function markSelectedLevel() {
    var cards = el.levelCards.querySelectorAll('.level-card');
    for (var i = 0; i < cards.length; i++) {
      cards[i].classList.toggle('selected', cards[i].getAttribute('data-level') === level);
    }
  }

  function refreshHistory() {
    var h = BK.PuzzleStore.historySummary();
    if (!h.sessions) {
      el.histSummary.textContent = 'まだ記録はありません。1セッション終えるごとに、ここに成績が蓄積されます。';
    } else {
      el.histSummary.textContent = 'これまで ' + h.sessions + ' セッション（計 ' + h.puzzles
        + ' 問）／平均 ' + h.avg + ' 点。';
    }
  }

  // ---- session / puzzle flow ------------------------------------------------

  function startSession() {
    level = level || 'beginner';
    levelInfo = BK.Puzzle.levelInfo(level);
    count = parseInt(el.countSelect.value, 10) || 6;
    session = BK.PuzzleStore.newSession(level, count);
    puzzleIndex = 0;
    show('play');
    loadPuzzle();
  }

  async function loadPuzzle() {
    busy = true;
    mode = 'solve';
    sel = { piece: null, ori: 0, hover: null, armed: false };
    el.legend.classList.add('hidden');
    setMode('solve');
    el.banner.textContent = '問題を作成中…';
    el.banner.style.borderColor = BK.COLORS[0].fill;
    el.info.innerHTML = '<div class="pi-progress">第 ' + (puzzleIndex + 1) + ' / ' + count + ' 問</div>'
      + '<div class="pi-read">' + escapeHtml(levelInfo.label) + '｜読み: ' + escapeHtml(levelInfo.readLabel) + '</div>';

    var p = null;
    try {
      for (var i = 0; i < 4 && !p; i++) { p = await BK.Puzzle.generate(level); }
    } catch (e) {
      toast('エラーが発生しました。設定画面に戻ります。');
      busy = false;
      show('setup');
      return;
    }
    if (!p) {
      toast('問題を作成できませんでした。レベルを下げてお試しください。');
      busy = false;
      if (session.records.length) { endSession(); } else { show('setup'); }
      return;
    }
    puzzle = p;
    levelInfo = p.levelInfo;
    view = {
      board: Int8Array.from(p.board),
      players: [{ id: 0, remaining: p.remaining }],
      isFirst: !p.snap.hasPlayed[0],
    };
    el.banner.textContent = '青の手番 — 最善の1手を選んで「解答する」';
    busy = false;
    renderTray();
    updateInfo();
    redraw();
  }

  function nextPuzzle() {
    if (busy) return;
    puzzleIndex++;
    if (puzzleIndex >= count) { endSession(); return; }
    loadPuzzle();
  }

  function endSession() {
    show('end');
    renderEnd();
    BK.PuzzleStore.saveHistory(session);
    el.saveStatus.textContent = '保存中…';
    BK.PuzzleStore.autosaveToLessons(session).then(function (res) {
      if (res && res.ok) {
        el.saveStatus.textContent = 'このセッションの要約を ' + res.path + ' に保存しました。';
      } else {
        el.saveStatus.textContent = 'サーバー保存は無効です（GitHub Pages / file:// など）。「ノートを書き出す」で .md を保存できます。';
      }
    });
    refreshHistory();
  }

  // ---- solving: input (mirrors ui.js two-path model) ------------------------

  function wirePlay() {
    el.btnRotate.addEventListener('click', function () { transform('rotateTo'); });
    el.btnFlip.addEventListener('click', function () { transform('flipTo'); });
    el.btnDeselect.addEventListener('click', clearSelection);
    el.btnAnswer.addEventListener('click', function () {
      if (!submitAnswer()) { updateActionBar(); redraw(); }
    });
    el.btnNudgeUp.addEventListener('click', function () { nudge(-1, 0); });
    el.btnNudgeDown.addEventListener('click', function () { nudge(1, 0); });
    el.btnNudgeLeft.addEventListener('click', function () { nudge(0, -1); });
    el.btnNudgeRight.addEventListener('click', function () { nudge(0, 1); });
    el.btnNext.addEventListener('click', nextPuzzle);
    el.btnQuit.addEventListener('click', function () { if (!busy) endSession(); });

    document.addEventListener('keydown', function (e) {
      if (busy) return;
      if (mode === 'reveal') {
        if (e.key === 'Enter') { e.preventDefault(); nextPuzzle(); }
        return;
      }
      if (e.key === 'r' || e.key === 'R') { transform('rotateTo'); }
      else if (e.key === 'f' || e.key === 'F') { transform('flipTo'); }
      else if (e.key === 'Escape') { clearSelection(); }
      else if (e.key === 'Enter') { e.preventDefault(); if (sel.armed) submitAnswer(); }
    });

    wireBoard();
  }

  function wireBoard() {
    // mouse / pen: hover tracks the ghost; click commits (= submit answer)
    el.board.addEventListener('mousemove', function (e) {
      lastInputWasTouch = false;
      if (busy || mode !== 'solve' || sel.piece === null) return;
      var cell = renderer.pixelToCell(e.clientX, e.clientY);
      if (!cell) { sel.hover = null; sel.armed = false; redraw(); updateActionBar(); return; }
      if (!sel.hover || sel.hover.r !== cell.r || sel.hover.c !== cell.c) {
        sel.hover = cell; redraw();
      }
    });
    el.board.addEventListener('mouseleave', function () {
      if (lastInputWasTouch) return;
      if (mode !== 'solve') return;
      sel.hover = null; sel.armed = false; redraw(); updateActionBar();
    });
    el.board.addEventListener('click', function (e) {
      if (lastInputWasTouch) return;
      if (busy || mode !== 'solve' || sel.piece === null) return;
      var cell = renderer.pixelToCell(e.clientX, e.clientY);
      if (!cell) return;
      sel.hover = cell; sel.armed = true;
      if (!submitAnswer()) { redraw(); updateActionBar(); }
    });

    // touch: two-stage. First tap arms a ghost; tapping the same origin again
    // (or 解答する) commits.
    el.board.addEventListener('touchstart', function (e) {
      lastInputWasTouch = true;
      if (busy || mode !== 'solve' || sel.piece === null) return;
      if (e.touches.length !== 1) return;
      var t = e.touches[0];
      var cell = renderer.pixelToCell(t.clientX, t.clientY);
      if (!cell) return;
      if (sel.armed && sel.hover && sel.hover.r === cell.r && sel.hover.c === cell.c) {
        if (!submitAnswer()) { updateActionBar(); redraw(); }
      } else {
        sel.hover = cell; sel.armed = true;
        updateActionBar(); redraw();
      }
    }, { passive: true });
    el.board.addEventListener('touchend', function (e) {
      if (e.cancelable) e.preventDefault();
    }, { passive: false });
  }

  function selectPiece(pi) {
    if (busy || mode !== 'solve') return;
    sel.piece = (sel.piece === pi) ? null : pi;
    sel.ori = 0; sel.hover = null; sel.armed = false;
    renderTray(); redraw();
  }

  function transform(which) {
    if (busy || mode !== 'solve' || sel.piece === null) return;
    var ori = BK.PIECES[sel.piece].orientations[sel.ori];
    var to = ori[which];
    if (to != null) { sel.ori = to; renderTray(); redraw(); }
  }

  function clearSelection() {
    if (mode !== 'solve') return;
    sel.piece = null; sel.hover = null; sel.armed = false;
    renderTray(); redraw();
  }

  function nudge(dr, dc) {
    if (busy || mode !== 'solve' || sel.piece === null) return;
    var base = sel.hover || { r: (N >> 1), c: (N >> 1) };
    var r = Math.max(0, Math.min(N - 1, base.r + dr));
    var c = Math.max(0, Math.min(N - 1, base.c + dc));
    sel.hover = { r: r, c: c }; sel.armed = true;
    renderTray(); redraw();
  }

  function originCells(pieceIndex, oriIndex, r0, c0) {
    var cells = BK.PIECES[pieceIndex].orientations[oriIndex].cells;
    return cells.map(function (rc) { return [rc[0] + r0, rc[1] + c0]; });
  }

  // commit the current selection as the answer to grade
  function submitAnswer() {
    if (busy || mode !== 'solve' || sel.piece === null || !sel.hover) return false;
    var abs = originCells(sel.piece, sel.ori, sel.hover.r, sel.hover.c);
    var corner = BK.CORNERS[0];
    if (!BK.isLegal(view.board, 0, abs, view.isFirst, corner[0], corner[1])) {
      toast('ここには置けません'); return false;
    }
    var cells = abs.map(function (rc) { return rc[0] * N + rc[1]; }).sort(function (a, b) { return a - b; });
    var move = { pieceIndex: sel.piece, orientationIndex: sel.ori, cells: cells, size: abs.length };
    busy = true;
    var grade = BK.Puzzle.grade(puzzle, move);
    BK.PuzzleStore.add(session, grade);
    showReveal(grade);
    return true;
  }

  // ---- reveal / grading view ------------------------------------------------

  function showReveal(grade) {
    mode = 'reveal';
    setMode('reveal');
    // draw board with the player's move applied + best/your highlights
    var rb = Int8Array.from(puzzle.board);
    var i;
    for (i = 0; i < grade.userMove.cells.length; i++) rb[grade.userMove.cells[i]] = 0;
    var highlights = [{ cells: grade.bestMove.cells, stroke: '#d97706', fill: '#f59e0b', alpha: 0.30, dashed: true, lineWidth: 3 }];
    if (!grade.isBest) highlights.push({ cells: grade.userMove.cells, stroke: '#1d4ed8', lineWidth: 3 });
    renderer.draw({ board: rb }, { highlights: highlights });
    el.legend.classList.remove('hidden');
    el.banner.textContent = grade.isBest ? '正解！ あなたの手＝最善手' : '解答 — 金の点線が最善手、青枠があなたの手';
    el.banner.style.borderColor = grade.isBest ? BK.COLORS[1].fill : BK.COLORS[0].fill;

    renderGrade(grade);
    renderExplain(grade);
    updateInfo();
    el.btnNext.textContent = (puzzleIndex + 1 < count) ? '次の問題' : '結果を見る';
    busy = false;
  }

  function renderGrade(grade) {
    var b = grade.band;
    el.grade.className = 'grade-badge tone-' + b.tone;
    el.grade.innerHTML = '<span class="gb-mark">' + escapeHtml(b.mark) + '</span>'
      + '<span class="gb-label">' + escapeHtml(b.label) + '</span>'
      + '<span class="gb-points"><b>' + grade.points + '</b> 点'
      + (grade.userRank ? '（上位' + grade.totalMoves + '手中 ' + grade.userRank + '位）' : '') + '</span>';
  }

  function renderExplain(grade) {
    var e = grade.explanation;
    el.explain.innerHTML =
      '<p class="ex-line">' + escapeHtml(e.position) + '</p>'
      + '<p class="ex-line ex-you">' + escapeHtml(e.yourMove) + '</p>'
      + '<p class="ex-line ex-best">' + escapeHtml(e.bestMove) + '</p>'
      + '<h4 class="ex-why">この最善手が良い理由</h4>' + ul(e.why)
      + '<h4 class="ex-imp">あなたの手の改善点</h4>' + ul(e.improvement);
  }

  // ---- shared rendering -----------------------------------------------------

  function setMode(m) {
    var revealing = (m === 'reveal');
    el.solve.classList.toggle('hidden', revealing);
    el.reveal.classList.toggle('hidden', !revealing);
    el.screenPlay.classList.toggle('revealing', revealing);
  }

  function redraw() {
    if (!puzzle || mode !== 'solve') return;
    renderer.draw(view, computeOverlay());
  }

  function computeOverlay() {
    var o = {};
    if (mode !== 'solve' || sel.piece === null || !sel.hover) return o;
    var abs = originCells(sel.piece, sel.ori, sel.hover.r, sel.hover.c);
    var corner = BK.CORNERS[0];
    o.previewCells = abs;
    o.previewColor = 0;
    o.previewLegal = BK.isLegal(view.board, 0, abs, view.isFirst, corner[0], corner[1]);
    o.previewArmed = sel.armed;
    return o;
  }

  function renderTray() {
    if (!puzzle) return;
    var rem = puzzle.remaining.filter(Boolean).length;
    el.trayTitle.textContent = 'あなたのピース（残り ' + rem + ' 種）';
    BK.renderTray(el.tray, view.players[0], sel.piece, sel.ori, selectPiece);
    updateActionBar();
  }

  function updateActionBar() {
    if (!el.btnAnswer) return;
    var canAnswer = !busy && mode === 'solve' && sel.piece !== null && sel.hover && sel.armed;
    el.btnAnswer.disabled = !canAnswer;
    if (canAnswer) {
      var legal = !!computeOverlay().previewLegal;
      el.btnAnswer.classList.toggle('legal', legal);
      el.btnAnswer.classList.toggle('illegal', !legal);
    } else {
      el.btnAnswer.classList.remove('legal', 'illegal');
    }
  }

  function updateInfo() {
    if (!puzzle) return;
    var st = BK.PuzzleStore.sessionStats(session);
    var s = puzzle.summary;
    el.info.innerHTML =
      '<div class="pi-progress">第 ' + (puzzleIndex + 1) + ' / ' + count + ' 問</div>'
      + '<div class="pi-read">' + escapeHtml(levelInfo.label) + '｜読み: ' + escapeHtml(levelInfo.readLabel) + '</div>'
      + '<div class="pi-row"><span>あなたの' + s.myMoveNumber + '手目（全体' + s.overallMoveNumber + '手目）</span>'
      + '<span>合法手 ' + s.legalMoves + ' 通り</span></div>'
      + '<div class="pi-row"><span>展開先の角 ' + s.anchors + '／相手の角 ' + s.oppAnchors + '</span>'
      + '<span>残りピース ' + s.remainingPieces + '</span></div>'
      + '<div class="pi-row pi-score"><span>セッション得点</span><span><b>' + st.total + '</b> 点（平均 ' + st.avg + '）</span></div>';
  }

  // ---- end screen -----------------------------------------------------------

  function wireEnd() {
    el.btnExport.addEventListener('click', function () {
      BK.PuzzleStore.download(BK.PuzzleStore.filenameFor(session), BK.PuzzleStore.toMarkdown(session));
    });
    el.btnAgain.addEventListener('click', function () { show('setup'); refreshHistory(); });
  }

  function renderEnd() {
    var st = BK.PuzzleStore.sessionStats(session);
    el.endSummary.textContent = '全 ' + st.count + ' 問 ／ 合計 ' + st.total + ' 点（平均 ' + st.avg
      + '）／ ★最善一致 ' + st.best + ' 問';
    el.endList.innerHTML = session.records.map(function (r, i) {
      var color = TONE_COLOR[r.band.tone] || '#94a3b8';
      return '<div class="final-row">'
        + '<span class="puz-q">第' + (i + 1) + '問</span>'
        + '<span class="swatch" style="background:' + color + '"></span>'
        + '<span class="puz-band">' + escapeHtml(r.band.mark) + ' ' + escapeHtml(r.band.label) + '</span>'
        + '<span class="puz-pts">' + r.points + '点</span></div>';
    }).join('');
    el.endThemes.innerHTML = '<h3 class="ref-bad">改善テーマ</h3>' + ul(BK.PuzzleStore.sessionThemes(session));
  }

  // ---- helpers --------------------------------------------------------------

  var toastTimer = null;
  function toast(msg) {
    el.toast.textContent = msg;
    el.toast.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.toast.classList.remove('show'); }, 2600);
  }

  function ul(items) {
    return '<ul class="ref-list">' + items.map(function (x) {
      return '<li>' + escapeHtml(x) + '</li>';
    }).join('') + '</ul>';
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function show(which) {
    el.screenSetup.classList.toggle('hidden', which !== 'setup');
    el.screenPlay.classList.toggle('hidden', which !== 'play');
    el.screenEnd.classList.toggle('hidden', which !== 'end');
  }
})(window.BK);
