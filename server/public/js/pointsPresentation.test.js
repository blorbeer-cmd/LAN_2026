import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pointTimeline, pointsChartHtml, journalSourceState } from './pointsPresentation.js';
import { parseAppHash, appHash } from './appRoute.js';
import { feedLinkTarget, feedLinkView } from './pushFeed.js';
import { categoryPointsHtml, adminCategoryJournalHtml, categoryEntryFactsHtml } from './pointsCategories.js';

test('point history preserves same-time order, net settlements and negative corrections', () => {
  const entries = [
    { id: 'start', created_at: 1000, amount: 100 },
    { id: 'task', created_at: 1000, amount: 5 },
    { id: 'tip', created_at: 2000, amount: -10 },
    { id: 'correction', created_at: 3000, amount: -100 },
  ];
  assert.deepEqual(
    pointTimeline(entries).map((p) => p.balance),
    [100, 105, 95, -5],
  );
  const chart = pointsChartHtml(entries);
  assert.match(chart, /role="img"/);
  assert.match(chart, /aktuell -5 Punkte/);
  assert.match(chart, /H .* V /);
  assert.doesNotMatch(chart, /NaN|Infinity/);
  assert.doesNotMatch(pointsChartHtml([entries[0]]), /NaN|Infinity/);
  assert.equal(pointsChartHtml([]), '');
  const categoryEntries = entries.map(({ created_at, ...entry }) => ({ ...entry, createdAt: created_at }));
  assert.deepEqual(pointTimeline(categoryEntries), pointTimeline(entries));
  assert.match(pointsChartHtml(categoryEntries, { label: 'Orga-Punkteverlauf' }), /Orga-Punkteverlauf: 4 Buchungen, aktuell -5 Punkte/);
});

test('administration corrects the full source with its latest revision, independently of other accounts and sources', () => {
  const entries = [
    { source_id: 'orga-a', amount: -8, revision: 3 },
    { source_id: 'playing-a', amount: 4, revision: 1 },
    { source_id: 'orga-a', amount: 3, revision: 2 },
    { source_id: 'orga-a', amount: 2, revision: 1 },
    { source_id: 'orga-b', amount: 10, revision: 1 },
  ];
  assert.deepEqual(journalSourceState(entries, 'orga-a'), { total: -3, revision: 3 });
});

test('category views keep each full history when searching and escape journal content in personal and admin details', () => {
  const entries = [
    { id: 'orga-1', account: 'orga', amount: 2, title: 'Organisation', createdAt: 1000 },
    { id: 'playing-1', account: 'playing', amount: 4, title: 'Spiel', createdAt: 1000 },
    { id: 'orga-2', account: 'orga', amount: -3, title: 'Korrektur <script>', reason: '<img src=x onerror=alert(1)>', createdAt: 2000 },
    { id: 'wallet-1', account: 'wallet', amount: 100, title: 'Startguthaben', createdAt: 3000 },
  ];
  const html = categoryPointsHtml({ categoryJournal: entries, categoryBalances: { orga: -1, playing: 4, betting: 0 } },
    { account: 'orga', query: 'Korrektur' });
  assert.match(html, /Orga-Punkteverlauf: 2 Buchungen, aktuell -1 Punkte/);
  assert.match(html, /Korrektur &lt;script&gt;/);
  assert.doesNotMatch(html, /<script>|<img|Startguthaben/);
  assert.equal((html.match(/data-category-entry=/g) ?? []).length, 1);
  const adminEntry = { ...entries[2], playerName: '<Alice>', actorName: '<Admin>', created_at: 2000 };
  const admin = adminCategoryJournalHtml([adminEntry], { account: 'orga', query: 'Alice', loading: false, error: '' });
  assert.match(admin, /&lt;Alice&gt;/);
  assert.match(categoryEntryFactsHtml(adminEntry), /&lt;Admin&gt;/);
  assert.doesNotMatch(admin + categoryEntryFactsHtml(adminEntry), /<script>|<img|<Alice>|<Admin>/);
});

test('betting notifications retain their round deep link on reload and navigation', () => {
  const route = { kind: 'round', id: 'round/42' };
  const hash = appHash('points', route);
  assert.equal(hash, '#points/round/round%2F42');
  assert.deepEqual(parseAppHash(hash), { view: 'points', localRoute: route, searchTarget: null });
  assert.equal(parseAppHash('#points/round/%ZZ').localRoute, null);
  const url = `/?eventId=lan-42${hash}`;
  assert.equal(feedLinkView(url), 'points');
  assert.deepEqual(feedLinkTarget(url), { type: 'betting-round', id: route.id });
});
