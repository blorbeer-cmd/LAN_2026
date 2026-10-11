import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { PAUSED_RECONNECT_GRACE_MS, RECONNECT_GRACE_MS, ReconnectGrace, graceMsFor, type GraceMatch } from './reconnectGrace';

test('the reconnect grace is one minute, and ten minutes only while a pause keeps nobody waiting', () => {
  assert.equal(RECONNECT_GRACE_MS, 60_000);
  assert.equal(PAUSED_RECONNECT_GRACE_MS, 10 * 60_000);
  assert.equal(graceMsFor({ paused: false, otherHumanConnected: false }, RECONNECT_GRACE_MS), RECONNECT_GRACE_MS);
  assert.equal(graceMsFor({ paused: false, otherHumanConnected: true }, RECONNECT_GRACE_MS), RECONNECT_GRACE_MS);
  assert.equal(graceMsFor({ paused: true, otherHumanConnected: true }, RECONNECT_GRACE_MS), RECONNECT_GRACE_MS);
  assert.equal(graceMsFor({ paused: true, otherHumanConnected: false }, RECONNECT_GRACE_MS), PAUSED_RECONNECT_GRACE_MS);
});

// A match whose expiries behave like the games' departure paths: the gone
// player leaves for good, which re-evaluates everybody else's countdown.
function pausedMatch(playerIds: string[]) {
  const match: GraceMatch = {
    paused: true,
    players: playerIds.map((id) => ({ id })),
    socketIds: new Map(playerIds.map((id) => [id, `socket-${id}`])),
  };
  const expired: Array<{ playerId: string; at: number }> = [];
  const grace: ReconnectGrace = new ReconnectGrace(() => match, () => false, (playerId) => {
    expired.push({ playerId, at: Date.now() });
    grace.left(playerId);
  }, () => RECONNECT_GRACE_MS);
  return { match, grace, expired };
}

test('countdowns are re-evaluated together, but never restarted by another player leaving', (t) => {
  mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 0 });
  t.after(() => mock.timers.reset());

  // Everyone is away during a pause: one shared ten-minute limit, even though
  // each expiry removes a player and re-evaluates the rest.
  const all = pausedMatch(['a', 'b', 'c']);
  for (const id of ['a', 'b', 'c']) all.grace.disconnected(id);
  mock.timers.tick(PAUSED_RECONNECT_GRACE_MS);
  assert.deepEqual(all.expired.map((entry) => entry.at), [PAUSED_RECONNECT_GRACE_MS, PAUSED_RECONNECT_GRACE_MS, PAUSED_RECONNECT_GRACE_MS]);
});

test('a player away first gets the long grace once nobody is left waiting, and the short one again when someone returns', (t) => {
  mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 0 });
  t.after(() => mock.timers.reset());

  // A drops while B still waits (short grace), then B drops too: A must not
  // be removed after one minute, since nobody is waiting any more.
  const { match, grace, expired } = pausedMatch(['a', 'b']);
  grace.disconnected('a');
  mock.timers.tick(30_000);
  grace.disconnected('b');
  mock.timers.tick(RECONNECT_GRACE_MS);
  assert.deepEqual(expired, []);
  assert.equal(grace.isAway('a'), true);

  // B returns after five minutes: A now has at most the short grace left.
  mock.timers.tick(5 * 60_000 - 90_000);
  match.socketIds.set('b', 'socket-b-new');
  grace.returned('b');
  mock.timers.tick(RECONNECT_GRACE_MS - 1);
  assert.deepEqual(expired, []);
  mock.timers.tick(1);
  assert.deepEqual(expired, [{ playerId: 'a', at: 5 * 60_000 + RECONNECT_GRACE_MS }]);
});
