/* rules.js — placement legality, anchor cells, and legal-move generation.
 * Pure functions operating on a flat Int8Array board (EMPTY or color id). */
(function (BK) {
  'use strict';

  var N = BK.BOARD_SIZE;
  var EMPTY = BK.EMPTY;

  /* Is placing `absCells` (array of [r,c]) legal for `color`?
   * isFirst: this is the player's first piece (must cover its start corner). */
  function isLegal(board, color, absCells, isFirst, cornerR, cornerC) {
    var i, r, c, touchesCorner = false, coversStart = false;
    // bounds + emptiness
    for (i = 0; i < absCells.length; i++) {
      r = absCells[i][0]; c = absCells[i][1];
      if (r < 0 || c < 0 || r >= N || c >= N) return false;
      if (board[r * N + c] !== EMPTY) return false;
      if (isFirst && r === cornerR && c === cornerC) coversStart = true;
    }
    if (isFirst) return coversStart;
    // no same-color edge contact; require >=1 same-color corner contact
    for (i = 0; i < absCells.length; i++) {
      r = absCells[i][0]; c = absCells[i][1];
      if (r > 0     && board[(r - 1) * N + c] === color) return false;
      if (r < N - 1 && board[(r + 1) * N + c] === color) return false;
      if (c > 0     && board[r * N + (c - 1)] === color) return false;
      if (c < N - 1 && board[r * N + (c + 1)] === color) return false;
      if (!touchesCorner) {
        if (r > 0     && c > 0     && board[(r - 1) * N + (c - 1)] === color) touchesCorner = true;
        else if (r > 0     && c < N - 1 && board[(r - 1) * N + (c + 1)] === color) touchesCorner = true;
        else if (r < N - 1 && c > 0     && board[(r + 1) * N + (c - 1)] === color) touchesCorner = true;
        else if (r < N - 1 && c < N - 1 && board[(r + 1) * N + (c + 1)] === color) touchesCorner = true;
      }
    }
    return touchesCorner;
  }
  BK.isLegal = isLegal;

  /* Anchor cells for `color`: empty cells diagonally adjacent to one of the
   * color's cells and NOT orthogonally adjacent to any. Every legal (non-first)
   * placement must cover at least one anchor, so anchors drive move generation. */
  function computeAnchors(board, color) {
    var anchors = [];
    for (var r = 0; r < N; r++) {
      for (var c = 0; c < N; c++) {
        if (board[r * N + c] !== EMPTY) continue;
        // reject if orthogonally adjacent to own color
        if (r > 0     && board[(r - 1) * N + c] === color) continue;
        if (r < N - 1 && board[(r + 1) * N + c] === color) continue;
        if (c > 0     && board[r * N + (c - 1)] === color) continue;
        if (c < N - 1 && board[r * N + (c + 1)] === color) continue;
        // accept if diagonally adjacent to own color
        var diag =
          (r > 0     && c > 0     && board[(r - 1) * N + (c - 1)] === color) ||
          (r > 0     && c < N - 1 && board[(r - 1) * N + (c + 1)] === color) ||
          (r < N - 1 && c > 0     && board[(r + 1) * N + (c - 1)] === color) ||
          (r < N - 1 && c < N - 1 && board[(r + 1) * N + (c + 1)] === color);
        if (diag) anchors.push([r, c]);
      }
    }
    return anchors;
  }
  BK.computeAnchors = computeAnchors;

  BK.countAnchors = function (board, color) { return computeAnchors(board, color).length; };

  /* Generate all legal moves for a player.
   * Returns [{pieceIndex, orientationIndex, cells:[idx...], size}].
   * options.pieceFilter(pieceIndex)->bool lets callers (AI rollouts) restrict
   * which remaining pieces to enumerate for speed. */
  function generateMoves(board, color, remaining, isFirst, corner, options) {
    options = options || {};
    var pieceFilter = options.pieceFilter || null;
    var moves = [];
    var seen = new Set();
    var cornerR = corner[0], cornerC = corner[1];
    var anchors = isFirst
      ? (board[cornerR * N + cornerC] === EMPTY ? [[cornerR, cornerC]] : [])
      : computeAnchors(board, color);
    if (anchors.length === 0) return moves;

    for (var pi = 0; pi < BK.PIECES.length; pi++) {
      if (!remaining[pi]) continue;
      if (pieceFilter && !pieceFilter(pi)) continue;
      var piece = BK.PIECES[pi];
      for (var oi = 0; oi < piece.orientations.length; oi++) {
        var ori = piece.orientations[oi];
        var cells = ori.cells;
        for (var ai = 0; ai < anchors.length; ai++) {
          var aR = anchors[ai][0], aC = anchors[ai][1];
          // align each cell of the piece onto the anchor
          for (var ci = 0; ci < cells.length; ci++) {
            var r0 = aR - cells[ci][0];
            var c0 = aC - cells[ci][1];
            var abs = BK.absCells(ori, r0, c0);
            if (!isLegal(board, color, abs, isFirst, cornerR, cornerC)) continue;
            // dedupe by piece + sorted cell indices
            var idxs = new Array(abs.length);
            for (var k = 0; k < abs.length; k++) idxs[k] = abs[k][0] * N + abs[k][1];
            idxs.sort(function (a, b) { return a - b; });
            var key = pi + '#' + idxs.join(',');
            if (seen.has(key)) continue;
            seen.add(key);
            moves.push({ pieceIndex: pi, orientationIndex: oi, cells: idxs, size: piece.size });
          }
        }
      }
    }
    return moves;
  }
  BK.generateMoves = generateMoves;

  /* Fast existence check: does the player have ANY legal move? (cheaper than
   * generating them all — used to decide pass/finish). */
  BK.hasAnyMove = function (board, color, remaining, isFirst, corner) {
    var cornerR = corner[0], cornerC = corner[1];
    var anchors = isFirst
      ? (board[cornerR * N + cornerC] === EMPTY ? [[cornerR, cornerC]] : [])
      : computeAnchors(board, color);
    if (anchors.length === 0) return false;
    for (var pi = 0; pi < BK.PIECES.length; pi++) {
      if (!remaining[pi]) continue;
      var piece = BK.PIECES[pi];
      for (var oi = 0; oi < piece.orientations.length; oi++) {
        var cells = piece.orientations[oi].cells;
        for (var ai = 0; ai < anchors.length; ai++) {
          var aR = anchors[ai][0], aC = anchors[ai][1];
          for (var ci = 0; ci < cells.length; ci++) {
            var abs = BK.absCells(piece.orientations[oi], aR - cells[ci][0], aC - cells[ci][1]);
            if (isLegal(board, color, abs, isFirst, cornerR, cornerC)) return true;
          }
        }
      }
    }
    return false;
  };
})(window.BK);
