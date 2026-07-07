import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isGameActive, ACTIVE_IDLE_THRESHOLD_S } from './activity';

const CS2 = ['cs2.exe'];

test('active when the game is focused and the system is not idle', () => {
  assert.equal(isGameActive('cs2.exe', 5, CS2), true);
});

test('not active when no foreground info is available (tracking off)', () => {
  assert.equal(isGameActive(null, null, CS2), false);
});

test('not active when a different process is focused', () => {
  assert.equal(isGameActive('discord.exe', 0, CS2), false);
});

test('not active when idle for the threshold or longer, even if focused', () => {
  assert.equal(isGameActive('cs2.exe', ACTIVE_IDLE_THRESHOLD_S, CS2), false);
  assert.equal(isGameActive('cs2.exe', ACTIVE_IDLE_THRESHOLD_S + 30, CS2), false);
});

test('active just under the idle threshold', () => {
  assert.equal(isGameActive('cs2.exe', ACTIVE_IDLE_THRESHOLD_S - 1, CS2), true);
});

test('idleSeconds null (unknown) does not block activity by itself', () => {
  assert.equal(isGameActive('cs2.exe', null, CS2), true);
});

test('matches any of several process names mapped to the same game', () => {
  const multi = ['league of legends.exe', 'leagueclient.exe'];
  assert.equal(isGameActive('leagueclient.exe', 0, multi), true);
});
