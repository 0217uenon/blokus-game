/* ui.js — game controller: setup screen, turn loop, human input, AI turns,
 * level-based assist, scoreboard, and end screen. */
(function (BK) {
  'use strict';

  var N = BK.BOARD_SIZE;
  var UI = {};
  BK.UI = UI;

  var el = {};            // DOM refs
  var renderer = null;
  var game = null;
  var sel = { piece: null, ori: 0, hover: null, armed: false };
  var busy = false;       // true while AI thinking / processing (locks human input)
  var savedThisGame = false;  // guard: write the reflection record once per game
  // Touch uses a two-stage place (arm preview -> confirm). This flag records the
  // most recent input modality per-interaction so the synthesized click after a
  // touch can be ignored without disturbing real mouse use on hybrid devices.
  var lastInputWasTouch = false;

  var sleep = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };

  UI.init = function (refs) {
    el = refs;
    renderer = BK.createRenderer(el.board);
    wireSetup();
    wireControls();
    wireBoard();
  };

  // ---- setup ----------------------------------------------------------------

  function wireSetup() {
    fillDifficultySelect(el.selHuman, 'advanced');
    fillDifficultySelect(el.selOpp1, 'beginner');
    fillDifficultySelect(el.selOpp2, 'intermediate');
    fillDifficultySelect(el.selOpp3, 'expert');
    el.btnStart.addEventListener('click', startGame);
    el.btnRestart.addEventListener('click', function () { show('setup'); });
  }

  function fillDifficultySelect(select, def) {
    select.innerHTML = '';
    BK.DIFFICULTIES.forEach(function (d) {
      var o = document.createElement('option');
      o.value = d.key; o.textContent = d.label;
      if (d.key === def) o.selected = true;
      select.appendChild(o);
    });
  }

  function startGame() {
    var config = {
      humanLevel: el.selHuman.value,
      seats: [
        { isHuman: true, name: 'あなた（' + BK.COLORS[0].name + '）' },
        { isHuman: false, difficulty: el.selOpp1.value, name: '相手1（' + BK.COLORS[1].name + '）' },
        { isHuman: false, difficulty: el.selOpp2.value, name: '相手2（' + BK.COLORS[2].name + '）' },
        { isHuman: false, difficulty: el.selOpp3.value, name: '相手3（' + BK.COLORS[3].name + '）' },
      ],
    };
    game = BK.createGame(config);
    sel = { piece: null, ori: 0, hover: null, armed: false };
    savedThisGame = false;
    show('game');
    redraw();
    loop();
  }

  // ---- main turn loop -------------------------------------------------------

  async function loop() {
    while (game.status === 'playing') {
      var id = game.current;
      var player = game.players[id];
      updateStatus();

      if (player.isHuman) {
        var moves = BK.AI.legalMoves(game, id);
        if (moves.length === 0) {
          toast('置ける手がありません。「パス」を押してください。');
          el.btnPass.disabled = false;
          busy = false;
          renderTray();
          redraw();
          return; // wait for human to click パス (doPass continues the loop)
        }
        busy = false;
        el.btnPass.disabled = true;
        renderTray();
        redraw();
        return; // wait for human placement (placeSelected continues the loop)
      }

      // AI seat
      busy = true;
      el.btnPass.disabled = true;
      renderTray();
      updateStatus(true);
      await sleep(180); // let "考え中" paint
      var move = await BK.AI.selectMove(game, id, player.difficulty);
      if (move === null) {
        game = BK.passPlayer(game);
      } else {
        game = BK.applyMove(game, move);
      }
      redraw();
      await sleep(220);
    }
    busy = false;
    showEnd();
  }

  function doPass() {
    if (!game || game.status !== 'playing' || game.current < 0) return;
    if (game.players[game.current].isHuman === false) return;
    el.btnPass.disabled = true;
    game = BK.passPlayer(game);
    redraw();
    loop();
  }

  function placeSelected() {
    if (busy || game.status !== 'playing' || sel.piece === null || !sel.hover) return false;
    var id = game.current;
    if (id < 0 || !game.players[id].isHuman) return false;
    var abs = originCells(sel.piece, sel.ori, sel.hover.r, sel.hover.c);
    var corner = BK.CORNERS[id];
    if (!BK.isLegal(game.board, id, abs, !game.players[id].hasPlayed, corner[0], corner[1])) return false;
    var cells = abs.map(function (rc) { return rc[0] * N + rc[1]; });
    var move = { pieceIndex: sel.piece, orientationIndex: sel.ori, cells: cells, size: abs.length };
    game = BK.applyMove(game, move);
    sel = { piece: null, ori: 0, hover: null, armed: false };
    updateActionBar();
    redraw();
    loop();
    return true;
  }

  // ---- human input ----------------------------------------------------------

  function wireControls() {
    el.btnRotate.addEventListener('click', function () { transform('rotateTo'); });
    el.btnFlip.addEventListener('click', function () { transform('flipTo'); });
    el.btnPass.addEventListener('click', doPass);
    el.btnDeselect.addEventListener('click', clearSelection);
    el.btnConfirm.addEventListener('click', confirmPlacement);
    el.btnNudgeUp.addEventListener('click', function () { nudge(-1, 0); });
    el.btnNudgeDown.addEventListener('click', function () { nudge(1, 0); });
    el.btnNudgeLeft.addEventListener('click', function () { nudge(0, -1); });
    el.btnNudgeRight.addEventListener('click', function () { nudge(0, 1); });
    el.btnExport.addEventListener('click', function () {
      BK.Store.download('blokus-上達ノート.md', BK.Store.toMarkdown());
    });
    el.btnClear.addEventListener('click', function () {
      if (window.confirm('これまでの上達ノート（記録）をすべて消去しますか？')) {
        BK.Store.clear();
        renderHistory();
      }
    });
    document.addEventListener('keydown', function (e) {
      if (!game || game.status !== 'playing' || busy) return;
      if (e.key === 'r' || e.key === 'R') { transform('rotateTo'); }
      else if (e.key === 'f' || e.key === 'F') { transform('flipTo'); }
      else if (e.key === 'Escape') { clearSelection(); }
    });
  }

  // Clear the held piece and any armed ghost (deselect / Esc).
  function clearSelection() {
    sel.piece = null; sel.hover = null; sel.armed = false;
    renderTray(); redraw();
  }

  function transform(which) {
    if (sel.piece === null) return;
    var ori = BK.PIECES[sel.piece].orientations[sel.ori];
    var to = ori[which];
    if (to != null) { sel.ori = to; renderTray(); redraw(); }
  }

  // Move the armed ghost one cell (touch fine-positioning on small screens).
  // If no ghost is armed yet, start from the board center.
  function nudge(dr, dc) {
    if (busy || !game || game.status !== 'playing' || game.current < 0) return;
    if (!game.players[game.current].isHuman || sel.piece === null) return;
    var base = sel.hover || { r: (N >> 1), c: (N >> 1) };
    var r = Math.max(0, Math.min(N - 1, base.r + dr));
    var c = Math.max(0, Math.min(N - 1, base.c + dc));
    sel.hover = { r: r, c: c };
    sel.armed = true;
    renderTray();
    redraw();
  }

  // Commit the armed ghost (確定 button / second tap path).
  function confirmPlacement() {
    if (busy || !game || game.status !== 'playing' || game.current < 0) return;
    if (!game.players[game.current].isHuman || sel.piece === null || !sel.hover) return;
    if (!placeSelected()) { toast('ここには置けません'); updateActionBar(); redraw(); }
  }

  function wireBoard() {
    // ---- mouse / pen: hover tracks the ghost, click commits (unchanged) ----
    el.board.addEventListener('mousemove', function (e) {
      lastInputWasTouch = false;
      if (busy || sel.piece === null || game.status !== 'playing') return;
      var cell = renderer.pixelToCell(e.clientX, e.clientY);
      if (!cell) { sel.hover = null; redraw(); return; }
      if (!sel.hover || sel.hover.r !== cell.r || sel.hover.c !== cell.c) {
        sel.hover = cell; redraw();
      }
    });
    el.board.addEventListener('mouseleave', function () {
      if (lastInputWasTouch) return;   // keep the armed ghost after a touch tap
      sel.hover = null; redraw();
    });
    el.board.addEventListener('click', function (e) {
      if (lastInputWasTouch) return;   // ignore the synthesized click after a tap
      if (busy || game.status !== 'playing') return;
      var cell = renderer.pixelToCell(e.clientX, e.clientY);
      if (!cell) return;
      sel.hover = cell;
      if (!placeSelected()) { redraw(); }
    });

    // ---- touch: two-stage place. First tap arms a ghost (preview only);
    //      tapping the same origin again (or 確定) commits. ----
    el.board.addEventListener('touchstart', function (e) {
      lastInputWasTouch = true;
      if (busy || sel.piece === null || !game || game.status !== 'playing') return;
      if (e.touches.length !== 1) return;            // two fingers -> let pinch-zoom through
      var t = e.touches[0];
      var cell = renderer.pixelToCell(t.clientX, t.clientY);
      if (!cell) return;                             // tap outside the board: ignore
      if (sel.armed && sel.hover && sel.hover.r === cell.r && sel.hover.c === cell.c) {
        if (!placeSelected()) { toast('ここには置けません'); updateActionBar(); redraw(); }
      } else {
        sel.hover = cell; sel.armed = true;
        updateActionBar(); redraw();
      }
    }, { passive: true });
    el.board.addEventListener('touchend', function (e) {
      if (e.cancelable) e.preventDefault();          // suppress the synthesized mouse/click
    }, { passive: false });
  }

  function selectPiece(pi) {
    if (busy || game.status !== 'playing' || game.current < 0) return;
    if (!game.players[game.current].isHuman) return;
    sel.piece = (sel.piece === pi) ? null : pi;
    sel.ori = 0;
    sel.hover = null;       // a freshly (re)selected piece starts unplaced/unarmed
    sel.armed = false;
    renderTray();
    redraw();
  }

  // ---- geometry helper ------------------------------------------------------

  function originCells(pieceIndex, oriIndex, r0, c0) {
    var cells = BK.PIECES[pieceIndex].orientations[oriIndex].cells;
    return cells.map(function (rc) { return [rc[0] + r0, rc[1] + c0]; });
  }

  // ---- placement preview ----------------------------------------------------
  // Only the piece currently held under the cursor (green=valid / gray=invalid).
  // No proactive "where to place" hints — the human plays unassisted.

  function computeOverlay() {
    var o = {};
    if (game.status !== 'playing' || game.current < 0) return o;  // game over: no overlay
    var id = game.current;
    var player = game.players[id];
    if (!player.isHuman) return o;
    if (sel.piece !== null && sel.hover) {
      var abs = originCells(sel.piece, sel.ori, sel.hover.r, sel.hover.c);
      var corner = BK.CORNERS[id];
      o.previewCells = abs;
      o.previewColor = id;
      o.previewLegal = BK.isLegal(game.board, id, abs, !player.hasPlayed, corner[0], corner[1]);
      o.previewArmed = sel.armed;   // touch: ghost is waiting for confirm -> emphasize
    }
    return o;
  }

  // ---- rendering / status ---------------------------------------------------

  function redraw() { renderer.draw(game, computeOverlay()); }

  function renderTray() {
    var id = game.current;
    var player = game.players[id];
    if (player.isHuman) {
      el.tray.style.visibility = 'visible';
      var rem = player.remaining.filter(Boolean).length;
      if (el.trayTitle) el.trayTitle.textContent = 'あなたのピース（残り ' + rem + ' ／ 全21種）';
      BK.renderTray(el.tray, player, sel.piece, sel.ori, selectPiece);
      el.controls.style.visibility = 'visible';
      if (el.actionBar) el.actionBar.style.visibility = 'visible';
    } else {
      el.tray.style.visibility = 'hidden';
      el.controls.style.visibility = 'hidden';
      if (el.actionBar) el.actionBar.style.visibility = 'hidden';
    }
    updateActionBar();
  }

  // Enable/disable the 確定 button and tint it by legality of the armed ghost.
  function updateActionBar() {
    if (!el.btnConfirm) return;
    var canConfirm = !busy && game && game.status === 'playing' && game.current >= 0
      && game.players[game.current].isHuman
      && sel.piece !== null && sel.hover && sel.armed;
    el.btnConfirm.disabled = !canConfirm;
    if (canConfirm) {
      var legal = !!computeOverlay().previewLegal;
      el.btnConfirm.classList.toggle('legal', legal);
      el.btnConfirm.classList.toggle('illegal', !legal);
    } else {
      el.btnConfirm.classList.remove('legal', 'illegal');
    }
  }

  function updateStatus(thinking) {
    var id = game.current;
    var p = game.players[id];
    var color = BK.COLORS[id];
    el.turnBanner.textContent = (p.isHuman ? 'あなたの番' : p.name + 'の番')
      + '（' + color.name + '）' + (thinking ? '　考え中…' : '');
    el.turnBanner.style.borderColor = color.fill;

    el.scoreboard.innerHTML = '';
    game.players.forEach(function (pl) {
      var row = document.createElement('div');
      row.className = 'score-row' + (pl.id === id ? ' active' : '') + (pl.finished ? ' finished' : '');
      var sw = document.createElement('span');
      sw.className = 'swatch'; sw.style.background = BK.COLORS[pl.id].fill;
      var label = pl.isHuman ? 'あなた' : pl.name.split('（')[0];
      var diff = pl.isHuman ? ('棋力:' + BK.difficultyLabel(game.humanLevel)) : BK.difficultyLabel(pl.difficulty);
      var info = document.createElement('span');
      info.className = 'score-info';
      info.innerHTML = '<b>' + BK.COLORS[pl.id].name + '</b> ' + label
        + ' <small>[' + diff + ']</small><br>'
        + '残り ' + BK.remainingCells(pl) + 'マス／得点 ' + BK.scoreOf(pl)
        + (pl.finished ? '（終了）' : '');
      row.appendChild(sw); row.appendChild(info);
      el.scoreboard.appendChild(row);
    });
  }

  var toastTimer = null;
  function toast(msg) {
    el.toast.textContent = msg;
    el.toast.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.toast.classList.remove('show'); }, 2600);
  }

  // ---- end screen -----------------------------------------------------------

  function showEnd() {
    var rows = BK.ranking(game);
    el.finalList.innerHTML = '';
    rows.forEach(function (row) {
      var div = document.createElement('div');
      div.className = 'final-row' + (row.rank === 1 ? ' winner' : '');
      var sw = '<span class="swatch" style="background:' + BK.COLORS[row.id].fill + '"></span>';
      var who = row.isHuman ? 'あなた' : (BK.COLORS[row.id].name + 'プレイヤー');
      var diff = row.isHuman ? '' : '（' + BK.difficultyLabel(row.difficulty) + '）';
      div.innerHTML = '<span class="rank">' + row.rank + '位</span>' + sw
        + '<span>' + who + diff + '</span>'
        + '<span class="pts">' + row.score + '点（残り' + row.left + 'マス）</span>';
      el.finalList.appendChild(div);
    });
    var top = rows[0];
    el.winnerText.textContent = top.isHuman
      ? '🎉 あなたの勝ちです！'
      : (BK.COLORS[top.id].name + 'プレイヤーの勝ちです');

    // generate + persist the reflection (once per completed game)
    var record = BK.analyzeGame(game);
    if (!savedThisGame) { BK.Store.save(record); savedThisGame = true; }
    renderReflection(record);
    renderHistory();
    show('end');
  }

  function ul(items) {
    return '<ul class="ref-list">' + items.map(function (x) {
      return '<li>' + escapeHtml(x) + '</li>';
    }).join('') + '</ul>';
  }

  function renderReflection(r) {
    var html = '<p class="ref-summary">結果 <b>' + r.rank + '位</b>'
      + '（得点 ' + r.score + ' ／ 配置 ' + r.placedPieces + '/21 ／ 残り ' + r.remainingCells + 'マス）</p>'
      + '<h3 class="ref-good">良かった点</h3>' + ul(r.strengths)
      + '<h3 class="ref-bad">改善点</h3>' + ul(r.weaknesses)
      + '<h3 class="ref-tip">次回の戦略</h3>' + ul(r.tips);
    el.reflection.innerHTML = html;
  }

  function renderHistory() {
    var s = BK.Store.summary();
    if (!s.games) {
      el.historySummary.textContent = 'まだ記録はありません。1ゲーム完走するごとに、ここに反省と戦略が蓄積されます。';
      el.historyList.innerHTML = '';
      return;
    }
    el.historySummary.textContent = 'これまで ' + s.games + ' 戦を記録（1位 ' + s.wins + ' 回）／平均得点 '
      + s.avgScore + ' ／平均配置 ' + s.avgPlaced + '/21。';
    var all = BK.Store.load().slice().reverse();
    el.historyList.innerHTML = all.map(function (r) {
      var takeaway = r.weaknesses && r.weaknesses.length ? r.weaknesses[0] : '—';
      return '<div class="hist-row"><span>' + escapeHtml(r.dateStr) + '</span>'
        + '<span>' + r.rank + '位・' + r.score + '点</span>'
        + '<small>' + escapeHtml(takeaway) + '</small></div>';
    }).join('');
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  // ---- screen switch --------------------------------------------------------

  function show(which) {
    el.screenSetup.classList.toggle('hidden', which !== 'setup');
    el.screenGame.classList.toggle('hidden', which !== 'game');
    el.screenEnd.classList.toggle('hidden', which !== 'end');
  }
})(window.BK);
