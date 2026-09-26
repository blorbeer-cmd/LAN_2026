// RankedList (frontend-contracts/components/ranked-list.md): a ranking keeps
// its order and numbers its places; any other list is sorted alphabetically.
// Both fill the left column first, so the column break is the larger half.

import test from 'node:test';
import assert from 'node:assert/strict';
import { rankedListColumnBreak, rankedListHtml, sortUnrankedItems } from './rankedList.js';

const titles = (html) => [...html.matchAll(/class="ranked-list-title">([^<]*)</g)].map((match) => match[1]);
const ranks = (html) => [...html.matchAll(/class="ranked-list-rank">(\d+)</g)].map((match) => Number(match[1]));

test('the left column holds the larger half', () => {
  assert.deepEqual([0, 1, 2, 5, 13, 18].map(rankedListColumnBreak), [0, 1, 1, 3, 7, 9]);
});

test('a ranking keeps its order, numbers every place and marks both column tops', () => {
  const items = ['Halo', 'Fall Guys', 'UT2003', 'Golf', 'CS2'].map((title, index) => ({ title, value: `${9 - index}h` }));
  const html = rankedListHtml(items, { ranked: true, label: 'Spielzeit pro Spiel' });
  assert.deepEqual(titles(html), ['Halo', 'Fall Guys', 'UT2003', 'Golf', 'CS2']);
  assert.deepEqual(ranks(html), [1, 2, 3, 4, 5]);
  assert.equal((html.match(/is-column-top/g) ?? []).length, 2);
  assert.match(html, /style="--ranked-list-rows:3"/);
  assert.match(html, /role="list" aria-label="Spielzeit pro Spiel"/);
});

test('shared places keep the number the caller passes', () => {
  const html = rankedListHtml([{ title: 'A', value: '5', rank: 1 }, { title: 'B', value: '5', rank: 1 }, { title: 'C', value: '3' }], { ranked: true });
  assert.deepEqual(ranks(html), [1, 1, 3]);
});

test('a list without rank is alphabetical, numbers in natural order, and carries no numbers', () => {
  const html = rankedListHtml([
    { title: 'Zappelphilipp', value: '65' },
    { title: 'LAN 10', value: '1' },
    { title: 'frühaufsteher', value: '2' },
    { title: 'LAN 2', value: '3' },
  ]);
  assert.deepEqual(titles(html), ['frühaufsteher', 'LAN 2', 'LAN 10', 'Zappelphilipp']);
  assert.deepEqual(ranks(html), []);
});

test('markup in a title does not decide the order, an explicit sort key does', () => {
  const byTitle = sortUnrankedItems([{ title: '<b>Zebra</b>' }, { title: 'Apfel' }]);
  assert.deepEqual(byTitle.map((item) => item.title), ['Apfel', '<b>Zebra</b>']);
  const byKey = sortUnrankedItems([{ title: 'x', sortKey: 'Beta' }, { title: 'y', sortKey: 'alpha' }]);
  assert.deepEqual(byKey.map((item) => item.sortKey), ['alpha', 'Beta']);
});
