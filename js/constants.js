/* constants.js — board/color/difficulty constants and small grid helpers.
 * Attaches to the global BK namespace so files load as classic <script>s
 * (works by simply opening index.html, no build step / no module CORS issues). */
window.BK = window.BK || {};
(function (BK) {
  'use strict';

  BK.BOARD_SIZE = 20;            // 20 x 20 = 400 cells
  BK.CELLS = BK.BOARD_SIZE * BK.BOARD_SIZE;
  BK.EMPTY = -1;
  BK.NUM_PLAYERS = 4;

  // Player / color definitions. id == player index == board cell value.
  // Corners are the start cells each player's first piece must cover.
  BK.COLORS = [
    { id: 0, key: 'blue',   name: '青', fill: '#2563eb', soft: '#bfdbfe' },
    { id: 1, key: 'yellow', name: '黄', fill: '#eab308', soft: '#fef08a' },
    { id: 2, key: 'red',    name: '赤', fill: '#dc2626', soft: '#fecaca' },
    { id: 3, key: 'green',  name: '緑', fill: '#16a34a', soft: '#bbf7d0' },
  ];

  // Start corners (clockwise from top-left). Recomputed from BOARD_SIZE.
  var N = BK.BOARD_SIZE - 1;
  BK.CORNERS = [
    [0, 0],   // blue   : top-left
    [0, N],   // yellow : top-right
    [N, N],   // red    : bottom-right
    [N, 0],   // green  : bottom-left
  ];

  BK.DIFFICULTIES = [
    { key: 'beginner',     label: '初級' },
    { key: 'intermediate', label: '中級' },
    { key: 'advanced',     label: '上級' },
    { key: 'expert',       label: '超上級' },
  ];
  BK.difficultyLabel = function (key) {
    for (var i = 0; i < BK.DIFFICULTIES.length; i++) {
      if (BK.DIFFICULTIES[i].key === key) return BK.DIFFICULTIES[i].label;
    }
    return key;
  };

  // Per-move thinking time budget (ms) used by the Expert tier search.
  BK.TIME_BUDGET = {
    beginner: 0,
    intermediate: 0,
    advanced: 120,
    expert: 1800,
  };

  // grid index helpers
  BK.idx = function (r, c) { return r * BK.BOARD_SIZE + c; };
  BK.rowOf = function (i) { return (i / BK.BOARD_SIZE) | 0; };
  BK.colOf = function (i) { return i % BK.BOARD_SIZE; };
  BK.inBounds = function (r, c) {
    return r >= 0 && c >= 0 && r < BK.BOARD_SIZE && c < BK.BOARD_SIZE;
  };

  // 4 orthogonal + 4 diagonal neighbor offsets
  BK.ORTHO = [[-1, 0], [1, 0], [0, -1], [0, 1]];
  BK.DIAG = [[-1, -1], [-1, 1], [1, -1], [1, 1]];
})(window.BK);
