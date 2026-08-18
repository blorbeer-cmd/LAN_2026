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
  // Info lives in the topbar as the conventional "i" instead of a pinned note:
  // it is one small always-available control, not an area in the nav.
  infoBoard: 'info',
  // Merged top-level areas (see sectionNav.js). Each one reuses the symbol of
  // its leading tab so the nav keeps the meaning it already had.
  competition: 'swords',
  insights: 'trophy',
  orga: 'clipboard',
  checklistPacking: 'clipboard',
  live: 'radioTower',
  foodOrders: 'hamburger',
  checklist: 'clipboard',
  arcade: 'joystick',
  broadcast: 'megaphone',
  gameCatalog: 'gamepad',
  skill: 'activity',
  music: 'music',
  events: 'calendar',
  feedback: 'messageSquare',
});

export function domainIcon(key, fallback = 'bell') {
  return DOMAIN_ICONS[key] || fallback;
}

export function installDomainIcons(root = document) {
  root.querySelectorAll('[data-domain-icon]').forEach((element) => {
    element.innerHTML = icon(domainIcon(element.dataset.domainIcon));
  });
}
