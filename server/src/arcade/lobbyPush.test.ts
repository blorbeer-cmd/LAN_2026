import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { shouldSendLobbyPush, clearLobbyPushThrottle, LOBBY_PUSH_COOLDOWN_MS } from './lobbyPush';

beforeEach(() => clearLobbyPushThrottle());

test('first lobby push per game type goes through', () => {
  assert.equal(shouldSendLobbyPush('quiz', 1_000), true);
});

test('rapid re-creation within the cooldown is suppressed', () => {
  assert.equal(shouldSendLobbyPush('quiz', 1_000), true);
  assert.equal(shouldSendLobbyPush('quiz', 1_001), false);
  assert.equal(shouldSendLobbyPush('quiz', 1_000 + LOBBY_PUSH_COOLDOWN_MS - 1), false);
});

test('a push after the cooldown goes through again', () => {
  assert.equal(shouldSendLobbyPush('quiz', 1_000), true);
  assert.equal(shouldSendLobbyPush('quiz', 1_000 + LOBBY_PUSH_COOLDOWN_MS), true);
});

test('game types are throttled independently', () => {
  assert.equal(shouldSendLobbyPush('quiz', 1_000), true);
  assert.equal(shouldSendLobbyPush('scribble', 1_001), true);
  assert.equal(shouldSendLobbyPush('quiz', 1_002), false);
});

test('a suppressed push does not extend the cooldown window', () => {
  assert.equal(shouldSendLobbyPush('quiz', 1_000), true);
  assert.equal(shouldSendLobbyPush('quiz', 1_000 + LOBBY_PUSH_COOLDOWN_MS - 1), false);
  // Were the suppressed attempt to refresh the timestamp, this would fail.
  assert.equal(shouldSendLobbyPush('quiz', 1_000 + LOBBY_PUSH_COOLDOWN_MS), true);
});
