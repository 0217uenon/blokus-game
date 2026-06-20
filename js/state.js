/* state.js — GameState creation, immutable move application, scoring, ranking.
 * Public transitions return NEW state objects (no in-place mutation). The AI
 * uses its own scratch board for fast rollouts (see ai.js). */
(function (BK) {
  'use strict';

  var N = BK.BOARD_SIZE;

  function fullRemaining() {
    var arr = new Array(BK.PIECE_COUNT);
    for (var i = 0; i < BK.PIECE_COUNT; i++) arr[i] = true;
    return arr;
  }

  /* config: { seats: [{isHuman, difficulty, name}] x4, humanLevel } */
  BK.createGame = function (config) {
    var board = new Int8Array(BK.CELLS).fill(BK.EMPTY);
    var players = [];
    for (var i = 0; i < BK.NUM_PLAYERS; i++) {
      var seat = config.seats[i];
      players.push({
        id: i,
        name: seat.name,
        isHuman: !!seat.isHuman,
        difficulty: seat.difficulty || null,
        remaining: fullRemaining(),
        placedCount: 0,
        hasPlayed: false,
        finished: false,
        lastPieceIndex: -1,
      });
    }
    return {
      board: board,
      players: players,
      current: 0,
      humanLevel: config.humanLevel || 'advanced',
      history: [],
      status: 'playing', // 'playing' | 'over'
    };
  };

  // shallow-clone the state, copying the board and the players array (with a
  // fresh object only for the player that changed) — immutable update pattern.
  function cloneFor(state, changedId, changedPlayer) {
    var players = state.players.map(function (p) {
      return p.id === changedId ? changedPlayer : p;
    });
    return {
      board: state.board, // replaced by caller when board changes
      players: players,
      current: state.current,
      humanLevel: state.humanLevel,
      history: state.history,
      status: state.status,
    };
  }

  /* Apply a placement move for state.current. Returns a NEW state with the piece
   * placed and the turn advanced to the next not-finished player. */
  BK.applyMove = function (state, move) {
    var id = state.current;
    var prev = state.players[id];
    var board = Int8Array.from(state.board);
    for (var k = 0; k < move.cells.length; k++) board[move.cells[k]] = id;

    var remaining = prev.remaining.slice();
    remaining[move.pieceIndex] = false;
    var next = {
      id: id, name: prev.name, isHuman: prev.isHuman, difficulty: prev.difficulty,
      remaining: remaining,
      placedCount: prev.placedCount + 1,
      hasPlayed: true,
      finished: false,
      lastPieceIndex: move.pieceIndex,
    };
    var ns = cloneFor(state, id, next);
    ns.board = board;
    ns.history = state.history.concat([{ player: id, move: move }]);
    ns.current = nextActive(ns, id);
    if (ns.current === -1) ns.status = 'over';
    return ns;
  };

  /* Mark a player finished (no legal moves) without placing. Returns new state,
   * advancing the turn. */
  BK.passPlayer = function (state) {
    var id = state.current;
    var prev = state.players[id];
    var fin = {
      id: id, name: prev.name, isHuman: prev.isHuman, difficulty: prev.difficulty,
      remaining: prev.remaining, placedCount: prev.placedCount, hasPlayed: prev.hasPlayed,
      finished: true, lastPieceIndex: prev.lastPieceIndex,
    };
    var ns = cloneFor(state, id, fin);
    ns.board = state.board;
    ns.current = nextActive(ns, id);
    if (ns.current === -1) ns.status = 'over';
    return ns;
  };

  // next player id (cyclic) after `fromId` that is not finished; -1 if none.
  function nextActive(state, fromId) {
    for (var step = 1; step <= BK.NUM_PLAYERS; step++) {
      var cand = (fromId + step) % BK.NUM_PLAYERS;
      if (!state.players[cand].finished) return cand;
    }
    return -1;
  }
  BK.nextActive = nextActive;

  BK.isFirstMove = function (player) { return !player.hasPlayed; };

  // remaining (unplaced) cell count for a player
  BK.remainingCells = function (player) {
    var sum = 0;
    for (var i = 0; i < BK.PIECE_COUNT; i++) {
      if (player.remaining[i]) sum += BK.PIECES[i].size;
    }
    return sum;
  };

  /* Official Blokus score: -1 per leftover cell; +15 if all 21 placed,
   * +20 total if the monomino was the last piece played. Higher is better. */
  BK.scoreOf = function (player) {
    var left = BK.remainingCells(player);
    if (left === 0) {
      return player.lastPieceIndex === BK.MONO_INDEX ? 20 : 15;
    }
    return -left;
  };

  BK.ranking = function (state) {
    var rows = state.players.map(function (p) {
      return {
        id: p.id, name: p.name, isHuman: p.isHuman, difficulty: p.difficulty,
        score: BK.scoreOf(p), left: BK.remainingCells(p), placed: p.placedCount,
      };
    });
    rows.sort(function (a, b) { return b.score - a.score || a.left - b.left; });
    var rank = 0, prevScore = null;
    rows.forEach(function (row, i) {
      if (prevScore === null || row.score !== prevScore) { rank = i + 1; prevScore = row.score; }
      row.rank = rank;
    });
    return rows;
  };
})(window.BK);
