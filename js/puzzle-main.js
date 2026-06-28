/* puzzle-main.js — collect DOM refs and start the puzzle controller. Loaded last. */
(function (BK) {
  'use strict';
  function $(id) { return document.getElementById(id); }
  document.addEventListener('DOMContentLoaded', function () {
    BK.PuzzleUI.init({
      // screens
      screenSetup: $('puz-setup'),
      screenPlay: $('puz-play'),
      screenEnd: $('puz-end'),
      // setup
      levelCards: $('puz-level-cards'),
      countSelect: $('puz-count'),
      btnStart: $('btn-puz-start'),
      histSummary: $('puz-hist-summary'),
      btnClear: $('btn-puz-clear'),
      // play
      banner: $('puz-banner'),
      board: $('board'),
      legend: $('puz-legend'),
      info: $('puz-info'),
      reveal: $('puz-reveal'),
      grade: $('puz-grade'),
      explain: $('puz-explain'),
      btnNext: $('btn-puz-next'),
      btnQuit: $('btn-puz-quit'),
      solve: $('puz-solve'),
      btnRotate: $('btn-puz-rotate'),
      btnFlip: $('btn-puz-flip'),
      btnDeselect: $('btn-puz-deselect'),
      trayTitle: $('puz-tray-title'),
      tray: $('tray'),
      btnAnswer: $('btn-answer'),
      btnNudgeUp: $('btn-nudge-up'),
      btnNudgeDown: $('btn-nudge-down'),
      btnNudgeLeft: $('btn-nudge-left'),
      btnNudgeRight: $('btn-nudge-right'),
      toast: $('toast'),
      // end
      endSummary: $('puz-end-summary'),
      endList: $('puz-end-list'),
      endThemes: $('puz-end-themes'),
      saveStatus: $('puz-save-status'),
      btnExport: $('btn-puz-export'),
      btnAgain: $('btn-puz-again'),
    });
  });
})(window.BK);
