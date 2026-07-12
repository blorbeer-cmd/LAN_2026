import { afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { claimLobbyMembership, clearLobbyMemberships, releaseLobbyMembership } from './lobbyMembership';

afterEach(clearLobbyMemberships);

test('a player can only claim one Arcade lobby at a time', () => {
  assert.equal(claimLobbyMembership('player-1', 'quiz', 'quiz-1'), true);
  assert.equal(claimLobbyMembership('player-1', 'pong', 'pong-1'), false);
});

test('reconnecting to the same lobby is allowed', () => {
  assert.equal(claimLobbyMembership('player-1', 'quiz', 'quiz-1'), true);
  assert.equal(claimLobbyMembership('player-1', 'quiz', 'quiz-1'), true);
});

test('leaving the current lobby allows a new claim', () => {
  claimLobbyMembership('player-1', 'quiz', 'quiz-1');
  releaseLobbyMembership('player-1', 'quiz', 'quiz-1');
  assert.equal(claimLobbyMembership('player-1', 'pong', 'pong-1'), true);
});
