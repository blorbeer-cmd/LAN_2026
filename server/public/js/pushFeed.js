// Shared helpers for rendering a push_log entry (see push.ts): its deep-link
// url into an in-app view + button label, and its title/body into the same
// little icon + text markup everywhere a push shows up — the app's Home
// "Mitteilungen" history, the always-on header notification banner (see
// notificationBanner.js), and the Kiosk's shared-screen banner (kiosk.js) —
// so all three read as "the same banner" instead of drifting into their own
// wording/markup over time.

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

// The bell + title + body markup shared by every banner surface. Callers
// wrap this in whatever outer chrome fits their context (a clickable button
// with an arrow for the app header, a plain span for the read-only Kiosk).
export function bannerContentHtml(entry) {
  return `${icon('bell')}<span class="notification-banner-text"><strong>${escapeHtml(entry.title)}</strong> ${escapeHtml(entry.body)}</span>`;
}
