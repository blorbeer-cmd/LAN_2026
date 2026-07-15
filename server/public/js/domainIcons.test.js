import test from 'node:test';
import assert from 'node:assert/strict';

import { DOMAIN_ICONS, domainIcon } from './domainIcons.js';

test('bottom navigation and More define every canonical view icon', () => {
  assert.deepEqual(DOMAIN_ICONS, {
    home: 'house',
    tournaments: 'swords',
    matchmaking: 'scale',
    votes: 'vote',
    leaderboard: 'trophy',
    more: 'menu',
    admin: 'shield',
    arrivals: 'van',
    analytics: 'chart',
    hallOfFame: 'landmark',
    infoBoard: 'pin',
    players: 'users',
    live: 'radioTower',
    foodOrders: 'hamburger',
    arcade: 'joystick',
    broadcast: 'megaphone',
    gameCatalog: 'gamepad',
    skill: 'activity',
  });
});

test('unknown domains use the requested fallback', () => {
  assert.equal(domainIcon('unknown'), 'bell');
  assert.equal(domainIcon('unknown', 'info'), 'info');
});
