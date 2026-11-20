import test from 'node:test';
import assert from 'node:assert/strict';
import { kioskLiveActiveHtml, kioskLiveRowHtml } from './kioskLive.js';

const game = (id, name, extra = {}) => ({ game_id: id, game_name: name, game_icon: null, since: 0, ...extra });
const player = (id, name, state, games = [], extra = {}) => ({ player_id: id, name, state, games, color: null, ...extra });

test('a playing row names its game below the name, the foreground game first', () => {
  const html = kioskLiveRowHtml(player('p1', 'Anna', 'playing', [
    game('g1', 'Factorio', { foreground: false }),
    game('g2', 'CS2 <Ranked>', { foreground: true }),
  ], { activity_tracked: true }));

  assert.match(html, /<span class="kiosk-live-detail">CS2 &lt;Ranked&gt;, Factorio<\/span>/);
  assert.match(html, /class="kiosk-live-status is-playing" role="img" aria-label="Spielt"/);
});

test('a row without a running game shows its state in the same second line', () => {
  for (const [state, label] of [['online', 'Online'], ['paused', 'Pause'], ['offline', 'Offline']]) {
    const html = kioskLiveRowHtml(player('p1', 'Ben', state));
    assert.match(html, new RegExp(`<span class="kiosk-live-detail">${label}</span>`), state);
  }
});

test('"Gerade aktiv" counts the players per running game, largest group first', () => {
  const html = kioskLiveActiveHtml([
    player('p1', 'Anna', 'playing', [game('g1', 'Factorio')]),
    player('p2', 'Ben', 'playing', [game('g2', 'Rocket League')]),
    player('p3', 'Cem', 'playing', [game('g2', 'Rocket League')]),
    // Only actually playing participants count, whatever the board still lists.
    player('p4', 'Dana', 'paused', [game('g1', 'Factorio')]),
  ]);

  assert.match(html, /role="group" aria-label="Gerade aktiv"/);
  assert.ok(html.indexOf('Rocket League') < html.indexOf('Factorio'), html);
  assert.match(html, /<strong>Rocket League<\/strong><span [^>]*aria-label="2 Spieler"[^>]*><svg[^>]*>.*?<\/svg>2<\/span>/);
  assert.match(html, /<strong>Factorio<\/strong><span [^>]*aria-label="1 Spieler"[^>]*><svg[^>]*>.*?<\/svg>1<\/span>/);
});

test('"Gerade aktiv" stays away while nobody plays', () => {
  assert.equal(kioskLiveActiveHtml([player('p1', 'Anna', 'online'), player('p2', 'Ben', 'offline')]), '');
});
