import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { GAME_GENRES, MAX_GENRES_PER_GAME } from './gameGenres.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const gamesRoutePath = path.join(here, '..', '..', 'src', 'routes', 'games.ts');

// There is no bundler, so the server's genre list and this module's copy are
// two literal arrays that can silently drift apart. Reading the route file back
// as text is the only way to compare them from the frontend's ESM test process.
function serverGenres() {
  const source = fs.readFileSync(gamesRoutePath, 'utf8');
  const literal = /const GAME_GENRES = \[([^\]]*)\] as const;/.exec(source);
  assert.ok(literal, 'GAME_GENRES literal not found in src/routes/games.ts');
  return [...literal[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
}

test('the frontend genre list matches the server list exactly', () => {
  assert.deepEqual([...GAME_GENRES], serverGenres());
});

test('genres are unique and Sonstiges stays the last catch-all option', () => {
  assert.equal(new Set(GAME_GENRES).size, GAME_GENRES.length);
  assert.equal(GAME_GENRES.at(-1), 'Sonstiges');
  for (const genre of GAME_GENRES) {
    assert.equal(genre, genre.trim());
    assert.ok(genre.length > 0);
  }
});

test('the genre list covers the LAN-relevant genres beyond the original set', () => {
  for (const genre of [
    'MOBA',
    '4X',
    'Battle Royale',
    'Survival',
    'Aufbau',
    'Sandbox',
    'Roguelike',
    'Tower Defense',
    'MMO',
    'Rhythmus',
    'Quiz',
    'Abenteuer',
  ]) {
    assert.ok(GAME_GENRES.includes(genre), `missing genre: ${genre}`);
  }
});

test('a game can still only carry a handful of genre tags', () => {
  assert.equal(MAX_GENRES_PER_GAME, 5);
  assert.ok(MAX_GENRES_PER_GAME < GAME_GENRES.length);
});
