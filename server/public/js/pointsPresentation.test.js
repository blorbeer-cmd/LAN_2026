import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pointTimeline, pointsChartHtml } from './pointsPresentation.js';
import { parseAppHash, appHash } from './appRoute.js';
import { feedLinkTarget, feedLinkView } from './pushFeed.js';

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
