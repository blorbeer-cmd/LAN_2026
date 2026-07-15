// Canonical semantic icons shared across views, status cards and
// notifications. Keep meanings here instead of choosing an icon again at
// every call site: a trophy means a result/win, while an active tournament
// is represented by crossed swords everywhere.
import { icon } from './icons.js';

export const DOMAIN_ICONS = Object.freeze({
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

export function domainIcon(key, fallback = 'bell') {
  return DOMAIN_ICONS[key] || fallback;
}

export function installDomainIcons(root = document) {
  root.querySelectorAll('[data-domain-icon]').forEach((element) => {
    element.innerHTML = icon(domainIcon(element.dataset.domainIcon));
  });
}
