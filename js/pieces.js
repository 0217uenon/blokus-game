/* pieces.js — the 21 Blokus polyominoes + precomputed orientations.
 * Geometry verified against the canonical Blokus spec (89 cells / player). */
(function (BK) {
  'use strict';

  // Base shapes as (row,col) cells in a minimal grid. Labels use the standard
  // polyomino letter/number names. Order roughly by size for nice tray layout.
  var BASE = [
    { id: 'I1', size: 1, cells: [[0, 0]] },
    { id: 'I2', size: 2, cells: [[0, 0], [0, 1]] },
    { id: 'V3', size: 3, cells: [[0, 0], [1, 0], [1, 1]] },
    { id: 'I3', size: 3, cells: [[0, 0], [0, 1], [0, 2]] },
    { id: 'O4', size: 4, cells: [[0, 0], [0, 1], [1, 0], [1, 1]] },
    { id: 'T4', size: 4, cells: [[0, 0], [0, 1], [0, 2], [1, 1]] },
    { id: 'L4', size: 4, cells: [[0, 0], [1, 0], [2, 0], [2, 1]] },
    { id: 'S4', size: 4, cells: [[0, 1], [0, 2], [1, 0], [1, 1]] },
    { id: 'I4', size: 4, cells: [[0, 0], [0, 1], [0, 2], [0, 3]] },
    { id: 'F5', size: 5, cells: [[0, 1], [0, 2], [1, 0], [1, 1], [2, 1]] },
    { id: 'T5', size: 5, cells: [[0, 0], [0, 1], [0, 2], [1, 1], [2, 1]] },
    { id: 'U5', size: 5, cells: [[0, 0], [0, 2], [1, 0], [1, 1], [1, 2]] },
    { id: 'V5', size: 5, cells: [[0, 0], [1, 0], [2, 0], [2, 1], [2, 2]] },
    { id: 'W5', size: 5, cells: [[0, 0], [1, 0], [1, 1], [2, 1], [2, 2]] },
    { id: 'X5', size: 5, cells: [[0, 1], [1, 0], [1, 1], [1, 2], [2, 1]] },
    { id: 'Z5', size: 5, cells: [[0, 0], [0, 1], [1, 1], [2, 1], [2, 2]] },
    { id: 'P5', size: 5, cells: [[0, 0], [0, 1], [1, 0], [1, 1], [2, 0]] },
    { id: 'N5', size: 5, cells: [[0, 1], [1, 1], [2, 0], [2, 1], [3, 0]] },
    { id: 'Y5', size: 5, cells: [[0, 1], [1, 0], [1, 1], [2, 1], [3, 1]] },
    { id: 'L5', size: 5, cells: [[0, 0], [1, 0], [2, 0], [3, 0], [3, 1]] },
    { id: 'I5', size: 5, cells: [[0, 0], [0, 1], [0, 2], [0, 3], [0, 4]] },
  ];

  function normalize(cells) {
    var minR = Infinity, minC = Infinity, i;
    for (i = 0; i < cells.length; i++) {
      if (cells[i][0] < minR) minR = cells[i][0];
      if (cells[i][1] < minC) minC = cells[i][1];
    }
    var out = cells.map(function (rc) { return [rc[0] - minR, rc[1] - minC]; });
    out.sort(function (a, b) { return (a[0] - b[0]) || (a[1] - b[1]); });
    return out;
  }
  function keyOf(cells) {
    return cells.map(function (rc) { return rc[0] + ',' + rc[1]; }).join(';');
  }
  function rotateCW(cells) { return cells.map(function (rc) { return [rc[1], -rc[0]]; }); }
  function reflect(cells) { return cells.map(function (rc) { return [rc[0], -rc[1]]; }); }

  // Distinct orientations under the dihedral group (rotation + reflection).
  function buildOrientations(baseCells) {
    var seen = new Map();
    for (var refl = 0; refl < 2; refl++) {
      var work = refl ? reflect(baseCells) : baseCells.slice();
      for (var rot = 0; rot < 4; rot++) {
        var norm = normalize(work);
        var k = keyOf(norm);
        if (!seen.has(k)) seen.set(k, norm);
        work = rotateCW(work);
      }
    }
    return Array.from(seen.values());
  }

  BK.PIECES = BASE.map(function (p, index) {
    var oris = buildOrientations(p.cells).map(function (cells) {
      var h = 0, w = 0;
      for (var i = 0; i < cells.length; i++) {
        if (cells[i][0] + 1 > h) h = cells[i][0] + 1;
        if (cells[i][1] + 1 > w) w = cells[i][1] + 1;
      }
      return { cells: cells, h: h, w: w, key: keyOf(cells) };
    });
    // transition tables for the 回転 / 反転 buttons
    var keyToIndex = new Map();
    oris.forEach(function (o, i) { keyToIndex.set(o.key, i); });
    oris.forEach(function (o) {
      o.rotateTo = keyToIndex.get(keyOf(normalize(rotateCW(o.cells))));
      o.flipTo = keyToIndex.get(keyOf(normalize(reflect(o.cells))));
    });
    return { id: p.id, index: index, size: p.size, orientations: oris };
  });

  BK.PIECE_COUNT = BK.PIECES.length;                 // 21
  BK.MONO_INDEX = 0;                                  // I1 is the monomino
  BK.TOTAL_CELLS = BK.PIECES.reduce(function (s, p) { return s + p.size; }, 0); // 89

  // absolute board cells for an oriented piece whose bounding-box origin is (r0,c0)
  BK.absCells = function (orientation, r0, c0) {
    var cells = orientation.cells, out = new Array(cells.length);
    for (var i = 0; i < cells.length; i++) {
      out[i] = [cells[i][0] + r0, cells[i][1] + c0];
    }
    return out;
  };
})(window.BK);
