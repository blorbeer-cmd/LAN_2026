import test from 'node:test';
import assert from 'node:assert/strict';

import { DOMAIN_ICONS, domainIcon } from './domainIcons.js';

test('bottom navigation and More define every canonical view icon', () => {
  assert.deepEqual(DOMAIN_ICONS, {
    home: 'house',
    tournaments: 'swords',
    matchmaking: 'scale',
    votes: 'vote',
    eventPolls: 'vote',
    leaderboard: 'trophy',
    more: 'menu',
    admin: 'shield',
    arrivals: 'van',
    analytics: 'chart',
    hallOfFame: 'landmark',
    infoBoard: 'info',
    competition: 'swords',
    insights: 'trophy',
    orga: 'clipboard',
    checklistPacking: 'clipboard',
    live: 'radioTower',
    foodOrders: 'hamburger',
    checklist: 'listChecks',
    arcade: 'joystick',
    broadcast: 'megaphone',
    gameCatalog: 'gamepad',
    skill: 'activity',
    music: 'music',
    events: 'calendar',
    feedback: 'messageSquare',
    profile: 'circleUser',
  });
});

test('packing and To-Do use distinct symbols', () => {
  // The general-event footer places these actions side by side, so their
  // symbols must remain distinguishable even without reading the labels.
  assert.equal(domainIcon('competition'), domainIcon('tournaments'));
  assert.equal(domainIcon('insights'), domainIcon('leaderboard'));
  assert.notEqual(domainIcon('checklistPacking'), domainIcon('checklist'));
});

test('unknown domains use the requested fallback', () => {
  assert.equal(domainIcon('unknown'), 'bell');
  assert.equal(domainIcon('unknown', 'info'), 'info');
});
