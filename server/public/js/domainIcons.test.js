import test from 'node:test';
import assert from 'node:assert/strict';

import { domainIcon } from './domainIcons.js';

test('shared domain icons distinguish activities from results', () => {
  assert.equal(domainIcon('skill'), 'activity');
  assert.equal(domainIcon('tournaments'), 'swords');
  assert.equal(domainIcon('leaderboard'), 'trophy');
});

test('unknown domains use the requested fallback', () => {
  assert.equal(domainIcon('unknown'), 'bell');
  assert.equal(domainIcon('unknown', 'info'), 'info');
});
