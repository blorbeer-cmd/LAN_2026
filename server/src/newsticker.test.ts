import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  NEWSTICKER_FRESH_MS,
  composeNews,
  hashSeed,
  joinNames,
  rememberNews,
  seededRandom,
  type NewsFact,
  type NewsHistory,
  type NewsInput,
} from './newsticker';
import { FALLBACK_GAMES } from './newstickerTemplates';

const NOW = 1_800_000_000_000;

const roster = [
  { id: 'p-robin', name: 'Robin' },
  { id: 'p-kim', name: 'Kim' },
  { id: 'p-jamie', name: 'Jamie' },
  { id: 'p-nico', name: 'Nico' },
];

function history(): NewsHistory {
  return { recentTemplates: [], recentTexts: [], usedFacts: new Set(), lastSubject: null };
}

// Every draw below the fresh/tracking shares, so a fact is always chosen
// when one is available.
const alwaysLow = { next: () => 0 };

const matchFact: NewsFact = {
  kind: 'match',
  key: 'match:m1',
  at: NOW - 60_000,
  playerIds: ['p-robin', 'p-kim'],
  game: 'Counter-Strike 2',
  winners: ['Robin'],
  losers: ['Kim'],
  score: '16 : 11',
};

test('a fresh result takes priority and is reported only once', () => {
  const input: NewsInput = { roster, games: ['Counter-Strike 2'], facts: [matchFact] };
  const state = history();
  const first = composeNews(input, alwaysLow, state, NOW);
  assert.ok(first);
  assert.equal(first.factKey, 'match:m1');
  assert.match(first.text, /Robin/);
  assert.equal(first.meta, 'Counter-Strike 2 · Match');
  rememberNews(state, first);

  const second = composeNews(input, alwaysLow, state, NOW);
  assert.ok(second);
  assert.equal(second.factKey, null, 'the same result is not reported twice');
});

test('results older than the fresh window are left to the fallback', () => {
  const stale = { ...matchFact, at: NOW - NEWSTICKER_FRESH_MS - 1 };
  const composed = composeNews({ roster, games: ['Trackmania'], facts: [stale] }, alwaysLow, history(), NOW);
  assert.ok(composed);
  assert.equal(composed.factKey, null);
});

test('without facts a line combines a real participant with a catalog game', () => {
  const games = ['Age of Empires II', 'Rocket League'];
  const composed = composeNews({ roster, games, facts: [] }, seededRandom(7), history(), NOW);
  assert.ok(composed);
  assert.ok(roster.some((player) => composed.text.includes(player.name)));
  assert.ok(games.includes(composed.meta ?? ''), 'the meta line names the combined catalog game');
});

test('an empty catalog still yields lines with well-known games', () => {
  const composed = composeNews({ roster, games: [], facts: [] }, seededRandom(3), history(), NOW);
  assert.ok(composed);
  assert.ok((FALLBACK_GAMES as readonly string[]).includes(composed.meta ?? ''));
});

test('a feed without participants stays empty', () => {
  assert.equal(composeNews({ roster: [], games: ['Tetris'], facts: [] }, seededRandom(1), history(), NOW), null);
});

test('a long feed does not repeat lines, forms or the same person back to back', () => {
  const input: NewsInput = { roster, games: ['Counter-Strike 2', 'Age of Empires II', 'Rocket League', 'Warcraft III'], facts: [] };
  const state = history();
  const texts = new Set<string>();
  const templates: string[] = [];
  let previousSubject: string | null = null;
  // 240 slots are two hours of ticker: the whole remembered window.
  for (let slot = 0; slot < 240; slot += 1) {
    const composed = composeNews(input, seededRandom(hashSeed(`feed:${slot}`)), state, NOW);
    assert.ok(composed);
    assert.equal(texts.has(composed.text), false, `line repeated after ${slot} slots: ${composed.text}`);
    assert.notEqual(composed.subject, previousSubject, 'the same person is not named twice in a row');
    // House style: no dashes in visible copy.
    assert.doesNotMatch(composed.text, /[–—]/);
    // Short enough to read from across the room and to fit a small tile.
    assert.ok(composed.text.length <= 170, `line too long (${composed.text.length}): ${composed.text}`);
    texts.add(composed.text);
    templates.push(composed.templateId);
    previousSubject = composed.subject;
    rememberNews(state, composed);
  }
  for (let i = 20; i < templates.length; i += 1) {
    assert.equal(templates.slice(i - 20, i).includes(templates[i]), false, `form ${templates[i]} came back within 20 lines`);
  }
});

test('tracking facts are used when the event records play time', () => {
  const playing: NewsFact = {
    kind: 'playing',
    key: 'playing:p-nico:AoE:1',
    at: NOW,
    playerIds: ['p-nico'],
    game: 'Age of Empires II',
    player: 'Nico',
    minutes: 95,
  };
  const composed = composeNews({ roster, games: [], facts: [playing] }, alwaysLow, history(), NOW);
  assert.ok(composed);
  assert.equal(composed.factKey, playing.key);
  assert.match(composed.text, /Nico/);
  assert.deepEqual(composed.playerIds, ['p-nico']);
});

test('names are joined readably', () => {
  assert.equal(joinNames(['Robin']), 'Robin');
  assert.equal(joinNames(['Robin', 'Kim']), 'Robin und Kim');
  assert.equal(joinNames(['Robin', 'Kim', 'Nico']), 'Robin, Kim und Nico');
  assert.equal(joinNames(['Robin', 'Kim', 'Nico', 'Jamie', 'Mika']), 'Robin, Kim und 3 weitere');
});
