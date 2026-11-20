import test from 'node:test';
import assert from 'node:assert/strict';
import { kioskLiveActiveHtml, kioskLiveRowHtml, sortKioskLivePlayers } from './kioskLive.js';

const game = (id, name) => ({ game_id: id, game_name: name, game_icon: null, since: 0 });
const player = (id, name, state, games = []) => ({ player_id: id, name, state, games, color: null });

test('the roster stays alphabetical regardless of status', () => {
  const players = [
    player('p-zed', 'Berta', 'playing'),
    player('p-anna', 'Anna', 'offline'),
    player('p-b', 'Berta', 'paused'),
    player('p-clara', 'Clara', 'online'),
  ];

  assert.deepEqual(
    sortKioskLivePlayers(players).map(({ player_id }) => player_id),
    ['p-anna', 'p-b', 'p-zed', 'p-clara'],
  );
  assert.deepEqual(players.map(({ player_id }) => player_id), ['p-zed', 'p-anna', 'p-b', 'p-clara']);
});

test('a playing row shows the player and status without naming their game', () => {
  const html = kioskLiveRowHtml(player('p1', 'Anna', 'playing', [game('g1', 'Factorio')]));

  assert.match(html, /<span class="player-name">Anna<\/span>/);
  assert.doesNotMatch(html, /Factorio/);
  assert.match(html, /class="kiosk-live-status is-playing" role="img" aria-label="Spielt"/);
});

test('a row without a running game labels its status dot', () => {
  for (const [state, label] of [['online', 'Online'], ['paused', 'Pause'], ['offline', 'Offline']]) {
    const html = kioskLiveRowHtml(player('p1', 'Ben', state));
    assert.match(html, new RegExp(`class="kiosk-live-status is-${state}" role="img" aria-label="${label}"`));
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
