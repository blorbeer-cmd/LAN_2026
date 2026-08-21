// Shared helpers for rendering a push_log entry (see push.ts): deep-link
// targets and labels for the notification center, plus the content markup
// used by the read-only Kiosk banner.

import { escapeHtml } from './format.js';
import { icon } from './icons.js';
import { domainIcon } from './domainIcons.js';

export const FEED_LINK_LABELS = {
  // Event invitations deep-link here: the dedicated Events area is where a
  // pending invitation is answered. No DOMAIN_ICONS lookup is needed for the
  // entry itself — the notification's bell fallback is the right icon for an
  // invitation.
  events: 'Zu den Events',
  votes: 'Zur Abstimmung',
  tournaments: 'Zum Turnier',
  matchmaking: 'Zu den Teams',
  foodOrders: 'Zur Bestellung',
  checklist: 'Zum To-Do',
  arcade: 'Zur Arcade',
  broadcast: 'Zu den Durchsagen',
};

// Older persisted push rows used a leading emoji as UI chrome. Keep their
// wording readable, but render the category through the shared icon set so
// history entries look the same as newly-created notifications.
const LEGACY_FEED_PREFIX = /^(?:🍕|🏆|🗳️?|⚔️?|👑|📢|🕹️?|✏️?)\s*/u;

// A push url like "/#votes" deep-links into a view; food order links also
// carry the order id so the target card can be expanded on arrival.
export function feedLinkView(url) {
  const hashIndex = (url || '').indexOf('#');
  if (hashIndex === -1) return null;
  const view = url.slice(hashIndex + 1).split('/')[0];
  return FEED_LINK_LABELS[view] ? view : null;
}

export function feedLinkTarget(url) {
  const hashIndex = (url || '').indexOf('#');
  if (hashIndex === -1) return null;
  const [view, encodedId] = url.slice(hashIndex + 1).split('/');
  if (view !== 'foodOrders' || !encodedId) return null;
  try {
    return { type: 'order', id: decodeURIComponent(encodedId) };
  } catch {
    return null;
  }
}

export function feedEntryTitle(entry) {
  return String(entry?.title ?? '').replace(LEGACY_FEED_PREFIX, '');
}

export function feedEntryIcon(entry) {
  return domainIcon(feedLinkView(entry?.url));
}

// Bell + title + body markup for the read-only Kiosk banner.
export function bannerContentHtml(entry) {
  const title = entry?.eventName ? `${entry.eventName} · ${feedEntryTitle(entry)}` : feedEntryTitle(entry);
  return `${icon(feedEntryIcon(entry))}<span class="notification-banner-text"><strong>${escapeHtml(title)}</strong><span class="notification-banner-body">${escapeHtml(entry.body)}</span></span>`;
}
