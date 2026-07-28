import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  canStartTetris,
  nextArenaTarget,
  placementForElimination,
  tetrisBotCount,
  tetrisMode,
  tetrisPlayerLimit,
} from './tetrisArena';
import { chooseBotTarget, evaluateBotBoard, planBotPath } from './tetris';
import { emptyBoard, lockPiece, spawnPiece } from './tetrisLogic';

test('Tetris modes keep duel exact and arena bounded to three through eight players', () => {
  assert.equal(tetrisMode('arena'), 'arena');
  assert.equal(tetrisMode('unknown'), 'duel');
  assert.equal(tetrisPlayerLimit('duel'), 2);
  assert.equal(tetrisPlayerLimit('arena'), 8);
  assert.equal(canStartTetris('duel', 2), true);
  assert.equal(canStartTetris('duel', 3), false);
  assert.equal(canStartTetris('arena', 2), false);
  assert.equal(canStartTetris('arena', 3), true);
  assert.equal(canStartTetris('arena', 8), true);
  assert.equal(canStartTetris('arena', 9), false);
  assert.equal(tetrisBotCount('duel', 7), 1);
  assert.equal(tetrisBotCount('arena', 1), 2);
  assert.equal(tetrisBotCount('arena', 5), 5);
  assert.equal(tetrisBotCount('arena', 99), 7);
});

test('arena targeting rotates over living opponents and skips eliminated players', () => {
  const order = ['a', 'b', 'c', 'd'];
  const alive = new Set(['a', 'c', 'd']);
  assert.equal(nextArenaTarget(order, alive, 'a', null), 'c');
  assert.equal(nextArenaTarget(order, alive, 'a', 'c'), 'd');
  assert.equal(nextArenaTarget(order, alive, 'a', 'd'), 'c');
});

test('arena targeting returns null when no opponent is alive', () => {
  assert.equal(nextArenaTarget(['a', 'b'], new Set(['a']), 'a', null), null);
  assert.equal(nextArenaTarget(['a', 'b'], new Set(['b']), 'a', null), null);
});

test('elimination placement reflects the number alive before top-out', () => {
  assert.equal(placementForElimination(8), 8);
  assert.equal(placementForElimination(3), 3);
  assert.equal(placementForElimination(1), 2);
});

test('the KI planner deterministically finds a legal target and ends with a hard drop', () => {
  const board = emptyBoard();
  const piece = spawnPiece('T');
  const first = chooseBotTarget(board, piece);
  const second = chooseBotTarget(board, piece);
  assert.deepEqual(first, second);
  assert.ok(first);
  const plan = planBotPath(board, piece, first.rotation, first.x);
  assert.equal(plan.at(-1), 'hard');
  assert.ok(plan.length <= 19);
});

test('the KI board evaluation rewards clearing lines over leaving a tall stack', () => {
  const nearlyFull = emptyBoard();
  nearlyFull[19] = Array(10).fill(1);
  nearlyFull[19][4] = 0;
  const tall = emptyBoard();
  for (let row = 10; row < 20; row += 1) tall[row][0] = 1;
  const clearedBoard = lockPiece(emptyBoard(), { ...spawnPiece('I'), y: 18 });
  assert.ok(evaluateBotBoard(clearedBoard, 1) > evaluateBotBoard(tall, 0));
  assert.ok(evaluateBotBoard(nearlyFull, 0) > evaluateBotBoard(tall, 0));
});
