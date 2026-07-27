import test from 'node:test';
import assert from 'node:assert/strict';

import {
  SOUND_NAMES,
  isArcadeSoundMuted,
  setArcadeSoundMuted,
  toggleArcadeSoundMuted,
  playArcadeSound,
} from './arcadeSound.js';

test('starts unmuted when no browser storage is available (node:test has no window)', () => {
  assert.equal(isArcadeSoundMuted(), false);
});

test('setArcadeSoundMuted updates and returns the new state without throwing without window/localStorage', () => {
  assert.equal(setArcadeSoundMuted(true), true);
  assert.equal(isArcadeSoundMuted(), true);
  assert.equal(setArcadeSoundMuted(false), false);
  assert.equal(isArcadeSoundMuted(), false);
});

test('toggleArcadeSoundMuted flips and returns the state', () => {
  setArcadeSoundMuted(false);
  assert.equal(toggleArcadeSoundMuted(), true);
  assert.equal(toggleArcadeSoundMuted(), false);
});

test('every arcade game exposes at least one distinct sound cue', () => {
  const games = ['tetris', 'snake', 'pong', 'blobby', 'battleship', 'scribble', 'challenge', 'quiz'];
  for (const game of games) {
    assert.ok(SOUND_NAMES.some((name) => name.startsWith(game)), `expected a cue prefixed "${game}-"`);
  }
});

test('playArcadeSound never throws without an AudioContext (headless/node environment)', () => {
  setArcadeSoundMuted(false);
  for (const name of SOUND_NAMES) assert.doesNotThrow(() => playArcadeSound(name));
});

test('playArcadeSound silently ignores an unknown cue name', () => {
  assert.doesNotThrow(() => playArcadeSound('does-not-exist'));
});

test('playArcadeSound is a no-op while muted', () => {
  setArcadeSoundMuted(true);
  assert.doesNotThrow(() => playArcadeSound(SOUND_NAMES[0]));
  setArcadeSoundMuted(false);
});
