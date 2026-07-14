// Shared helpers for rendering a push_log entry (see push.ts): deep-link
// targets and labels for the notification center, plus the content markup
// used by the read-only Kiosk banner.

import { escapeHtml } from './format.js';
import { icon } from './icons.js';

export const FEED_LINK_LABELS = {
  votes: 'Zur Abstimmung',
  tournaments: 'Zum Turnier',
  matchmaking: 'Zu den Teams',
  foodOrders: 'Zur Bestellung',
  arcade: 'Zur Arcade',
  broadcast: 'Zu den Durchsagen',
};

// A push url like "/#votes" deep-links into a view; anything else (or a
// hash we don't know) just gets no jump-off button.
export function feedLinkView(url) {
  const hashIndex = (url || '').indexOf('#');
  if (hashIndex === -1) return null;
  const view = url.slice(hashIndex + 1);
  return FEED_LINK_LABELS[view] ? view : null;
}

// Bell + title + body markup for the read-only Kiosk banner.
export function bannerContentHtml(entry) {
  return `${icon('bell')}<span class="notification-banner-text"><strong>${escapeHtml(entry.title)}</strong> ${escapeHtml(entry.body)}</span>`;
}
