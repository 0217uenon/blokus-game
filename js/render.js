/* render.js — Canvas drawing for the board + a DOM piece tray. */
(function (BK) {
  'use strict';

  var N = BK.BOARD_SIZE;
  var BOARD_PX = 640;

  BK.createRenderer = function (canvas) {
    canvas.width = BOARD_PX;
    canvas.height = BOARD_PX;
    var ctx = canvas.getContext('2d');
    var cell = BOARD_PX / N;

    function cellRect(r, c) { return [c * cell, r * cell, cell, cell]; }

    function fillCell(r, c, color) {
      ctx.fillStyle = color;
      ctx.fillRect(c * cell + 1, r * cell + 1, cell - 2, cell - 2);
    }

    function drawGrid() {
      ctx.fillStyle = '#f8fafc';
      ctx.fillRect(0, 0, BOARD_PX, BOARD_PX);
      ctx.strokeStyle = '#e2e8f0';
      ctx.lineWidth = 1;
      for (var i = 0; i <= N; i++) {
        var p = i * cell;
        ctx.beginPath(); ctx.moveTo(p, 0); ctx.lineTo(p, BOARD_PX); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(0, p); ctx.lineTo(BOARD_PX, p); ctx.stroke();
      }
    }

    function drawCorners(board) {
      for (var k = 0; k < BK.NUM_PLAYERS; k++) {
        var rc = BK.CORNERS[k];
        if (board[rc[0] * N + rc[1]] !== BK.EMPTY) continue;
        ctx.fillStyle = BK.COLORS[k].soft;
        ctx.fillRect(rc[1] * cell + 1, rc[0] * cell + 1, cell - 2, cell - 2);
        ctx.strokeStyle = BK.COLORS[k].fill;
        ctx.lineWidth = 2;
        ctx.strokeRect(rc[1] * cell + 2, rc[0] * cell + 2, cell - 4, cell - 4);
      }
    }

    function drawPieces(board) {
      for (var r = 0; r < N; r++) {
        for (var c = 0; c < N; c++) {
          var v = board[r * N + c];
          if (v !== BK.EMPTY) fillCell(r, c, BK.COLORS[v].fill);
        }
      }
    }

    // `armed` (touch two-stage place): the ghost is positioned and waiting for
    // confirmation — draw it more solidly so it reads as "ready" on small screens.
    function drawPreview(absCells, colorId, legal, armed) {
      var fill = legal ? BK.COLORS[colorId].fill : '#9ca3af';
      ctx.globalAlpha = legal ? (armed ? 0.9 : 0.75) : (armed ? 0.6 : 0.45);
      for (var i = 0; i < absCells.length; i++) {
        var r = absCells[i][0], c = absCells[i][1];
        if (r < 0 || c < 0 || r >= N || c >= N) continue;
        ctx.fillStyle = fill;
        ctx.fillRect(c * cell + 1, r * cell + 1, cell - 2, cell - 2);
      }
      ctx.globalAlpha = 1;
      ctx.strokeStyle = legal ? '#15803d' : '#ef4444';
      ctx.lineWidth = armed ? 3 : 2;
      for (i = 0; i < absCells.length; i++) {
        var rr = absCells[i][0], cc = absCells[i][1];
        if (rr < 0 || cc < 0 || rr >= N || cc >= N) continue;
        ctx.strokeRect(cc * cell + 1, rr * cell + 1, cell - 2, cell - 2);
      }
    }

    // Optional highlight layer (used by the puzzle's reveal screen to mark the
    // "best move" / "your move"). Each h = { cells:[flatIdx...], fill?, stroke?,
    // alpha?, lineWidth?, dashed? }. Additive — the game never passes highlights.
    function drawHighlight(h) {
      var cells = h.cells || [], i, r, c;
      if (h.fill) {
        ctx.globalAlpha = (h.alpha != null ? h.alpha : 0.5);
        ctx.fillStyle = h.fill;
        for (i = 0; i < cells.length; i++) {
          r = (cells[i] / N) | 0; c = cells[i] % N;
          ctx.fillRect(c * cell + 1, r * cell + 1, cell - 2, cell - 2);
        }
        ctx.globalAlpha = 1;
      }
      if (h.stroke) {
        ctx.strokeStyle = h.stroke;
        ctx.lineWidth = h.lineWidth || 3;
        if (h.dashed) ctx.setLineDash([5, 4]);
        for (i = 0; i < cells.length; i++) {
          r = (cells[i] / N) | 0; c = cells[i] % N;
          ctx.strokeRect(c * cell + 1.5, r * cell + 1.5, cell - 3, cell - 3);
        }
        if (h.dashed) ctx.setLineDash([]);
      }
    }

    function draw(state, overlay) {
      overlay = overlay || {};
      drawGrid();
      drawCorners(state.board);
      drawPieces(state.board);
      if (overlay.highlights && overlay.highlights.length) {
        for (var i = 0; i < overlay.highlights.length; i++) drawHighlight(overlay.highlights[i]);
      }
      if (overlay.previewCells && overlay.previewCells.length) {
        drawPreview(overlay.previewCells, overlay.previewColor, overlay.previewLegal, overlay.previewArmed);
      }
    }

    function pixelToCell(clientX, clientY) {
      var rect = canvas.getBoundingClientRect();
      var x = (clientX - rect.left) * (BOARD_PX / rect.width);
      var y = (clientY - rect.top) * (BOARD_PX / rect.height);
      var c = Math.floor(x / cell), r = Math.floor(y / cell);
      if (r < 0 || c < 0 || r >= N || c >= N) return null;
      return { r: r, c: c };
    }

    return { draw: draw, pixelToCell: pixelToCell };
  };

  /* Render the current human player's remaining pieces as clickable tiles. */
  BK.renderTray = function (container, player, selectedPieceIndex, selectedOri, onSelect) {
    container.innerHTML = '';
    var color = BK.COLORS[player.id];
    for (var pi = 0; pi < BK.PIECE_COUNT; pi++) {
      if (!player.remaining[pi]) continue;
      var piece = BK.PIECES[pi];
      var tile = document.createElement('button');
      tile.className = 'piece-tile' + (pi === selectedPieceIndex ? ' selected' : '');
      tile.title = piece.id + '（' + piece.size + 'マス）';
      var cv = document.createElement('canvas');
      var TILE = 56, pad = 4;
      cv.width = TILE; cv.height = TILE;
      // when selected, show the chosen orientation; otherwise the base shape
      var ori = (pi === selectedPieceIndex) ? piece.orientations[selectedOri] : piece.orientations[0];
      drawPieceTile(cv.getContext('2d'), ori, color.fill, TILE, pad);
      tile.appendChild(cv);
      (function (idx) { tile.addEventListener('click', function () { onSelect(idx); }); })(pi);
      container.appendChild(tile);
    }
  };

  function drawPieceTile(ctx, ori, fill, TILE, pad) {
    var inner = TILE - pad * 2;
    var u = Math.floor(inner / Math.max(ori.h, ori.w));
    var offX = pad + (inner - u * ori.w) / 2;
    var offY = pad + (inner - u * ori.h) / 2;
    ctx.clearRect(0, 0, TILE, TILE);
    ctx.fillStyle = fill;
    ctx.strokeStyle = 'rgba(255,255,255,0.7)';
    ctx.lineWidth = 1;
    for (var i = 0; i < ori.cells.length; i++) {
      var r = ori.cells[i][0], c = ori.cells[i][1];
      ctx.fillRect(offX + c * u, offY + r * u, u - 1, u - 1);
      ctx.strokeRect(offX + c * u + 0.5, offY + r * u + 0.5, u - 1, u - 1);
    }
  }
})(window.BK);
