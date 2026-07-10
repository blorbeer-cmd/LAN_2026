import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  BOARD_WIDTH,
  BOARD_HEIGHT,
  GARBAGE_CELL,
  emptyBoard,
  collides,
  spawnPiece,
  tryMove,
  tryRotate,
  dropDistance,
  lockPiece,
  clearLines,
  garbageFor,
  lineScore,
  addGarbage,
  levelForLines,
  gravityMsForLevel,
  makeRng,
  stringToSeed,
  nextBag,
  pieceCells,
  PIECE_TYPES,
} from './tetrisLogic';

test('emptyBoard has the right dimensions and is all zeros', () => {
  const board = emptyBoard();
  assert.equal(board.length, BOARD_HEIGHT);
  assert.equal(board[0].length, BOARD_WIDTH);
  assert.ok(board.every((row) => row.every((c) => c === 0)));
});

test('collides detects side walls, floor and occupied cells', () => {
  const board = emptyBoard();
  const piece = spawnPiece('O');
  assert.equal(collides(board, piece), false);
  // Push it off the left wall.
  assert.equal(collides(board, { ...piece, x: -2 }), true);
  // Push it off the right wall.
  assert.equal(collides(board, { ...piece, x: BOARD_WIDTH }), true);
  // Push it through the floor.
  assert.equal(collides(board, { ...piece, y: BOARD_HEIGHT }), true);
  // Occupy a cell the O would land on.
  const [cx, cy] = pieceCells(piece)[0];
  board[cy][cx] = 5;
  assert.equal(collides(board, piece), true);
});

test('cells above the ceiling are allowed (spawn/rotate against the top)', () => {
  const board = emptyBoard();
  const piece = { ...spawnPiece('I'), y: -1 };
  assert.equal(collides(board, piece), false);
});

test('tryMove returns null when blocked, the moved piece otherwise', () => {
  const board = emptyBoard();
  const piece = spawnPiece('T');
  const moved = tryMove(board, piece, 1, 0);
  assert.ok(moved);
  assert.equal(moved!.x, piece.x + 1);
  // Against the right wall an O can move at most to x = BOARD_WIDTH - 3 origin.
  const atWall = { ...spawnPiece('O'), x: BOARD_WIDTH - 3 };
  assert.equal(tryMove(board, atWall, 1, 0), null);
});

test('tryRotate wall-kicks an I-piece off the left wall instead of failing', () => {
  const board = emptyBoard();
  // Vertical I flush against the left wall.
  const vertical = { type: 'I' as const, rotation: 1, x: -2, y: 5 };
  assert.equal(collides(board, vertical), false);
  const rotated = tryRotate(board, vertical, 1);
  assert.ok(rotated, 'rotation should succeed via a wall kick');
  assert.equal(collides(board, rotated!), false);
});

test('dropDistance measures the fall to the floor', () => {
  const board = emptyBoard();
  const piece = spawnPiece('O'); // occupies rows 0-1
  // O bottom cells are at row y+1; floor is row 19, so it can fall to y=18.
  assert.equal(dropDistance(board, piece), BOARD_HEIGHT - 2);
});

test('lockPiece writes the piece colour and leaves the source board untouched', () => {
  const board = emptyBoard();
  const piece = { ...spawnPiece('O'), y: BOARD_HEIGHT - 2 };
  const locked = lockPiece(board, piece);
  assert.ok(board.every((row) => row.every((c) => c === 0)), 'original board unchanged');
  const filled = locked.flat().filter((c) => c !== 0).length;
  assert.equal(filled, 4);
});

test('clearLines removes full rows and drops the stack down', () => {
  const board = emptyBoard();
  // Fill the bottom row completely, plus one stray cell above it.
  board[BOARD_HEIGHT - 1] = Array(BOARD_WIDTH).fill(2);
  board[BOARD_HEIGHT - 2][0] = 3;
  const { board: next, cleared } = clearLines(board);
  assert.equal(cleared, 1);
  // The stray cell falls to the new bottom row.
  assert.equal(next[BOARD_HEIGHT - 1][0], 3);
  // Top row is empty.
  assert.ok(next[0].every((c) => c === 0));
});

test('clearLines can clear a Tetris (4 rows at once)', () => {
  const board = emptyBoard();
  for (let y = BOARD_HEIGHT - 4; y < BOARD_HEIGHT; y++) board[y] = Array(BOARD_WIDTH).fill(1);
  const { cleared } = clearLines(board);
  assert.equal(cleared, 4);
});

test('garbageFor rewards bigger clears, nothing for a single', () => {
  assert.equal(garbageFor(1), 0);
  assert.equal(garbageFor(2), 1);
  assert.equal(garbageFor(3), 2);
  assert.equal(garbageFor(4), 4);
});

test('lineScore scales with level', () => {
  assert.equal(lineScore(1, 1), 100);
  assert.equal(lineScore(4, 1), 800);
  assert.equal(lineScore(4, 3), 2400);
  assert.equal(lineScore(0, 5), 0);
});

test('addGarbage pushes rows up and leaves exactly one hole per row', () => {
  const board = emptyBoard();
  // Mark the top row so we can confirm it gets pushed off.
  board[0][0] = 9;
  const next = addGarbage(board, 2, 4);
  assert.equal(next.length, BOARD_HEIGHT);
  // Two garbage rows now sit at the bottom.
  for (let y = BOARD_HEIGHT - 2; y < BOARD_HEIGHT; y++) {
    assert.equal(next[y][4], 0, 'gap column is empty');
    assert.equal(next[y].filter((c) => c === GARBAGE_CELL).length, BOARD_WIDTH - 1);
  }
  // The marked top row was shoved past the ceiling and lost.
  assert.ok(next.flat().every((c) => c !== 9));
});

test('addGarbage with count 0 is a no-op copy', () => {
  const board = emptyBoard();
  board[5][5] = 3;
  const next = addGarbage(board, 0, 2);
  assert.deepEqual(next, board);
  assert.notEqual(next, board, 'returns a copy, not the same reference');
});

test('levelForLines and gravity speed up over time', () => {
  assert.equal(levelForLines(0), 1);
  assert.equal(levelForLines(10), 2);
  assert.equal(levelForLines(95), 10);
  assert.ok(gravityMsForLevel(1) > gravityMsForLevel(5));
  assert.ok(gravityMsForLevel(50) <= gravityMsForLevel(10));
});

test('makeRng is deterministic for a given seed', () => {
  const a = makeRng(1234);
  const b = makeRng(1234);
  for (let i = 0; i < 20; i++) assert.equal(a(), b());
});

test('stringToSeed is stable and differs for different ids', () => {
  assert.equal(stringToSeed('match-abc'), stringToSeed('match-abc'));
  assert.notEqual(stringToSeed('match-abc'), stringToSeed('match-abd'));
});

test('nextBag yields all seven pieces once, deterministically per seed', () => {
  const rngA = makeRng(stringToSeed('seed'));
  const rngB = makeRng(stringToSeed('seed'));
  const bagA = nextBag(rngA);
  const bagB = nextBag(rngB);
  assert.deepEqual(bagA, bagB, 'same seed -> same bag (fair for both players)');
  assert.deepEqual([...bagA].sort(), [...PIECE_TYPES].sort());
});

test('two players sharing a seed get an identical long piece stream', () => {
  const streamFor = (seed: number) => {
    const rng = makeRng(seed);
    const out: string[] = [];
    for (let i = 0; i < 5; i++) out.push(...nextBag(rng));
    return out;
  };
  const seed = stringToSeed('match-42');
  assert.deepEqual(streamFor(seed), streamFor(seed));
});
