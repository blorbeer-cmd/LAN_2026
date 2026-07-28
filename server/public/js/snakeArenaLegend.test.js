import { test } from 'node:test';
import assert from 'node:assert/strict';
import { snakeArenaLegendHtml } from './snakeArenaLegend.js';

test('Snake Arena legend maps every head number to an escaped player name', () => {
  const html = snakeArenaLegendHtml({
    gameType: 'snake',
    players: [{ name: 'Ada' }, { name: '<Bob>' }, { ref: { name: 'Carla' } }],
    world: { mode: 'arena', snakes: [{}, {}, {}] },
  });

  assert.match(html, /Schlange 1<\/strong><span>Ada/);
  assert.match(html, /Schlange 2<\/strong><span>&lt;Bob&gt;/);
  assert.match(html, /Schlange 3<\/strong><span>Carla/);
});

test('Snake legend stays hidden outside Arena mode', () => {
  assert.equal(snakeArenaLegendHtml({ gameType: 'snake', world: { mode: 'classic' }, players: [] }), '');
  assert.equal(snakeArenaLegendHtml({ gameType: 'pong', world: { mode: 'arena' }, players: [] }), '');
});
