import assert from 'node:assert/strict';
import test from 'node:test';
import {
  CHIMP_GRID_CELLS, CHIMP_MAX_LEVEL, applyChimpClick, applyChimpInactivity, chimpRating, continueChimpRun,
  createChimpLayout, finishChimpReveal, isImplausibleChimpInput, rankChimpResults, startChimpRun, type ChimpRun,
} from './chimpLogic';

const SEED = 4242;

function clearLevel(run: ChimpRun, msPerAttempt = 1_000): void {
  for (const cell of [...run.layout]) applyChimpClick(run, cell, msPerAttempt);
}

function failLevel(run: ChimpRun, msPerAttempt = 1_000): void {
  applyChimpClick(run, run.layout[1], msPerAttempt);
  finishChimpReveal(run);
}

test('layouts are distinct cells, deterministic per seed and differ between players and attempts', () => {
  const layout = createChimpLayout(SEED, 12);
  assert.equal(layout.length, 12);
  assert.equal(new Set(layout).size, 12);
  assert.ok(layout.every((cell) => Number.isInteger(cell) && cell >= 0 && cell < CHIMP_GRID_CELLS));
  assert.deepEqual(createChimpLayout(SEED, 12), layout);
  assert.notDeepEqual(startChimpRun(SEED, 'alice').layout, startChimpRun(SEED, 'bob').layout);
  const run = startChimpRun(SEED, 'alice');
  const first = [...run.layout];
  failLevel(run);
  continueChimpRun(run, SEED, 'alice');
  assert.equal(run.level, 4);
  assert.notDeepEqual(run.layout, first);
});

test('a correct sequence completes the level and the next level adds one number', () => {
  const run = startChimpRun(SEED, 'alice');
  assert.equal(run.phase, 'memorize');
  assert.equal(applyChimpClick(run, run.layout[0], 500), 'correct');
  assert.equal(run.phase, 'input');
  assert.equal(applyChimpClick(run, run.layout[1], 600), 'correct');
  assert.equal(applyChimpClick(run, run.layout[2], 700), 'correct');
  assert.equal(applyChimpClick(run, run.layout[3], 800), 'level-complete');
  assert.equal(run.phase, 'interstitial');
  assert.equal(run.bestLevel, 4);
  assert.equal(run.totalActiveMs, 800);
  assert.equal(continueChimpRun(run, SEED, 'alice'), true);
  assert.equal(run.level, 5);
  assert.equal(run.layout.length, 5);
  assert.equal(run.phase, 'memorize');
});

test('wrong numbers strike, empty or cleared cells do not, invalid cells are rejected', () => {
  const run = startChimpRun(SEED, 'alice');
  const empty = Array.from({ length: CHIMP_GRID_CELLS }, (_, cell) => cell).find((cell) => !run.layout.includes(cell))!;
  assert.equal(applyChimpClick(run, empty, 100), 'ignored');
  assert.equal(applyChimpClick(run, 40, 100), 'invalid');
  assert.equal(applyChimpClick(run, '3', 100), 'invalid');
  applyChimpClick(run, run.layout[0], 100);
  assert.equal(applyChimpClick(run, run.layout[0], 100), 'ignored');
  assert.equal(run.strikes, 0);

  // Clicking another number before the 1 is a mistake as well.
  const early = startChimpRun(SEED, 'bob');
  assert.equal(applyChimpClick(early, early.layout[2], 300), 'strike');
  assert.equal(early.phase, 'reveal');
  assert.deepEqual(early.reveal, { layout: early.layout, wrongCell: early.layout[2], expectedNumber: 1 });
  finishChimpReveal(early);
  assert.equal(early.phase, 'interstitial');
  assert.equal(early.reveal, null);
});

test('three strikes end the run and the level cap ends it as well', () => {
  const run = startChimpRun(SEED, 'alice');
  for (let attempt = 0; attempt < 3; attempt += 1) {
    failLevel(run);
    if (attempt < 2) continueChimpRun(run, SEED, 'alice');
  }
  assert.equal(run.phase, 'out');
  assert.equal(run.bestLevel, 0);
  assert.equal(continueChimpRun(run, SEED, 'alice'), false);

  const capped = startChimpRun(SEED, 'bob');
  while (capped.phase !== 'out') {
    clearLevel(capped);
    continueChimpRun(capped, SEED, 'bob');
  }
  assert.equal(capped.bestLevel, CHIMP_MAX_LEVEL);
});

test('inactivity strikes only during input, never while memorizing', () => {
  const run = startChimpRun(SEED, 'alice');
  assert.equal(applyChimpInactivity(run, 120_000), false);
  assert.equal(run.strikes, 0);
  applyChimpClick(run, run.layout[0], 100);
  assert.equal(applyChimpInactivity(run, 60_000), true);
  assert.equal(run.strikes, 1);
  assert.equal(run.reveal?.wrongCell, null);
});

test('ranking values freeze at the scored level, so playing on never ranks below quitting', () => {
  const quitter = startChimpRun(SEED, 'alice');
  const persistent = startChimpRun(SEED, 'bob');
  for (const run of [quitter, persistent]) {
    for (let level = 4; level <= 9; level += 1) {
      clearLevel(run);
      continueChimpRun(run, SEED, run === quitter ? 'alice' : 'bob');
    }
  }
  // Both reached level 9 the same way; only bob keeps going and fails 10 three times.
  for (let attempt = 0; attempt < 3; attempt += 1) {
    failLevel(persistent, 5_000);
    continueChimpRun(persistent, SEED, 'bob');
  }
  assert.equal(persistent.phase, 'out');
  assert.equal(persistent.strikes, 3);
  assert.equal(persistent.totalActiveMs, 21_000);
  const results = [quitter, persistent].map((run, index) => ({ id: index, level: run.bestLevel, strikesAtLevel: run.strikesAtLevel, activeMsAtLevel: run.activeMsAtLevel }));
  assert.deepEqual(results.map(({ level, strikesAtLevel, activeMsAtLevel }) => [level, strikesAtLevel, activeMsAtLevel]), [[9, 0, 6_000], [9, 0, 6_000]]);
  assert.deepEqual(rankChimpResults(results).map((entry) => entry.place), [1, 1]);
});

test('ranks by level, then strikes, then active time; the leaderboard breaks full ties by time of achievement', () => {
  const ranked = rankChimpResults([
    { id: 'slow', level: 9, strikesAtLevel: 1, activeMsAtLevel: 9_000 },
    { id: 'clean', level: 9, strikesAtLevel: 0, activeMsAtLevel: 20_000 },
    { id: 'best', level: 11, strikesAtLevel: 2, activeMsAtLevel: 30_000 },
    { id: 'fast', level: 9, strikesAtLevel: 1, activeMsAtLevel: 8_000 },
    { id: 'twin', level: 9, strikesAtLevel: 1, activeMsAtLevel: 8_000 },
  ]);
  assert.deepEqual(ranked.map((entry) => [entry.id, entry.place]), [['best', 1], ['clean', 2], ['fast', 3], ['twin', 3], ['slow', 5]]);
  const leaderboard = rankChimpResults([
    { id: 'later', level: 7, strikesAtLevel: 0, activeMsAtLevel: 5_000, achievedAt: 20 },
    { id: 'earlier', level: 7, strikesAtLevel: 0, activeMsAtLevel: 5_000, achievedAt: 10 },
  ], { byAchievedAt: true });
  assert.deepEqual(leaderboard.map((entry) => [entry.id, entry.place]), [['earlier', 1], ['later', 2]]);
});

test('chimp rating follows the agreed tiers around Ayumu', () => {
  assert.deepEqual(chimpRating(0), { percent: 0, beyond: 0, tier: 'Bananenschale' });
  assert.deepEqual(chimpRating(4), { percent: 44, beyond: 0, tier: 'Zoobesucher' });
  assert.deepEqual(chimpRating(5), { percent: 56, beyond: 0, tier: 'Zoobesucher' });
  assert.deepEqual(chimpRating(6), { percent: 67, beyond: 0, tier: 'Kletteraffe' });
  assert.deepEqual(chimpRating(7), { percent: 78, beyond: 0, tier: 'Kletteraffe' });
  assert.deepEqual(chimpRating(8), { percent: 89, beyond: 0, tier: 'Fast Ayumu' });
  assert.deepEqual(chimpRating(9), { percent: 100, beyond: 0, tier: 'Ayumu-Niveau' });
  assert.deepEqual(chimpRating(10), { percent: null, beyond: 1, tier: 'Silberrücken' });
  assert.deepEqual(chimpRating(14), { percent: null, beyond: 5, tier: 'Silberrücken' });
  assert.deepEqual(chimpRating(15), { percent: null, beyond: 6, tier: 'Affenkönig' });
});

test('flags inhumanly fast input only from level 8 on', () => {
  assert.equal(isImplausibleChimpInput(20, 400), true);
  assert.equal(isImplausibleChimpInput(20, 2_000), false);
  assert.equal(isImplausibleChimpInput(7, 10), false);
});
