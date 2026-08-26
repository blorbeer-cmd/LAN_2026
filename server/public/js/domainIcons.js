// Canonical semantic icons shared across views, status cards and
// notifications. Keep meanings here instead of choosing an icon again at
// every call site: a trophy means a result/win, while an active tournament
// is represented by crossed swords everywhere.
import { icon } from './icons.js';
import { SECTION_MANIFEST, VIEW_MANIFEST } from './viewManifest.js';

const SHARED_DOMAIN_ICONS = Object.freeze({
  // Info lives in the topbar as the conventional "i" instead of a pinned note:
  // it is one small always-available control, not an area in the nav.
  infoBoard: 'info',
  live: 'radioTower',
  skill: 'activity',
  feedback: 'messageSquare',
});

export const DOMAIN_ICONS = Object.freeze({
  ...Object.fromEntries(Object.entries(VIEW_MANIFEST).map(([view, definition]) => [view, definition.iconKey])),
  ...Object.fromEntries(Object.entries(SECTION_MANIFEST).map(([section, definition]) => [section, definition.iconKey])),
  ...SHARED_DOMAIN_ICONS,
});

export function domainIcon(key, fallback = 'bell') {
  return DOMAIN_ICONS[key] || fallback;
}

export function installDomainIcons(root = document) {
  root.querySelectorAll('[data-domain-icon]').forEach((element) => {
    element.innerHTML = icon(domainIcon(element.dataset.domainIcon));
  });
}
