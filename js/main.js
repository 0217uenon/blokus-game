/* main.js — collect DOM refs and start the UI controller. Loaded last. */
(function (BK) {
  'use strict';
  function $(id) { return document.getElementById(id); }
  document.addEventListener('DOMContentLoaded', function () {
    BK.UI.init({
      screenSetup: $('screen-setup'),
      screenGame: $('screen-game'),
      screenEnd: $('screen-end'),
      selHuman: $('sel-human'),
      selOpp1: $('sel-opp-1'),
      selOpp2: $('sel-opp-2'),
      selOpp3: $('sel-opp-3'),
      btnStart: $('btn-start'),
      board: $('board'),
      turnBanner: $('turn-banner'),
      scoreboard: $('scoreboard'),
      tray: $('tray'),
      trayTitle: $('tray-title'),
      controls: $('controls'),
      btnRotate: $('btn-rotate'),
      btnFlip: $('btn-flip'),
      btnPass: $('btn-pass'),
      btnDeselect: $('btn-deselect'),
      actionBar: $('action-bar'),
      btnConfirm: $('btn-confirm'),
      btnNudgeUp: $('btn-nudge-up'),
      btnNudgeDown: $('btn-nudge-down'),
      btnNudgeLeft: $('btn-nudge-left'),
      btnNudgeRight: $('btn-nudge-right'),
      toast: $('toast'),
      finalList: $('final-list'),
      winnerText: $('winner-text'),
      reflection: $('reflection'),
      historySummary: $('history-summary'),
      historyList: $('history-list'),
      btnExport: $('btn-export'),
      btnClear: $('btn-clear'),
      btnRestart: $('btn-restart'),
    });
  });
})(window.BK);
