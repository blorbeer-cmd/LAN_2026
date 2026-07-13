// Always-on header banner: shows the newest still-active push notification
// that concerned this device's current identity, with a direct link into
// whatever view it's about — a persistent counterpart to the transient toast
// nudges app.js already fires on the relevant socket events, for anyone who
// missed the toast, wasn't looking at the screen, or is just coming back
// after a while away. Below that prominent line, it also surfaces the same
// "Aktuell" items Home shows (open vote, active tournaments, ...) as small
// tappable chips, so the always-visible one thing doesn't hide the rest of
// what's currently going on. Lives outside the per-view render cycle
// (switchView/renderCurrent in app.js) since it must stay visible across
// every view, not just Home, so it manages its own small slice of DOM
// directly instead of going through a view module's render(container, ctx).

import { api } from './api.js';
import { getMyId } from './whoami.js';
import { icon } from './icons.js';
import { escapeHtml } from './format.js';
import { feedLinkView, bannerContentHtml } from './pushFeed.js';
import { ensureAktuellLoaded, aktuellItems } from './aktuellStatus.js';
import { showToast } from './toast.js';

let epoch = 0;
let lastEntry = null;
let expiryTimer = null;

function bannerEl() {
  return document.getElementById('notification-banner');
}

// Redraws from whatever's currently cached — the last-fetched active push entry
// plus the shared "Aktuell" items — without refetching either. Called after
// a push refetch resolves, whenever aktuellStatus.js reports new data, and
// exported for app.js to call directly on state.votes changes (the vote
// chip reads state.votes live, which isn't part of aktuellStatus.js's own
// cache).
export function renderBanner() {
  const banner = bannerEl();
  if (!banner) return;

  if (expiryTimer) clearTimeout(expiryTimer);
  expiryTimer = null;
  if (lastEntry?.expiresAt) {
    const delay = Math.max(0, Math.min(lastEntry.expiresAt - Date.now() + 50, 2_147_483_647));
    expiryTimer = setTimeout(refreshNotificationBanner, delay);
  }

  const chips = aktuellItems()
    .map(
      (item) =>
        `<button type="button" class="chip notification-banner-chip" data-notification-navigate="${item.navigate}">${icon(item.iconName)}<span>${escapeHtml(item.title)}</span></button>`
    )
    .join('');

  if (!lastEntry && !chips) {
    banner.hidden = true;
    banner.innerHTML = '';
    return;
  }

  let pushLine = '';
  if (lastEntry) {
    const view = feedLinkView(lastEntry.url);
    const content = bannerContentHtml(lastEntry);
    const contentLine = view
      ? `<button type="button" class="notification-banner-link" data-notification-navigate="${view}">${content}${icon('chevronRight', { className: 'notification-banner-arrow' })}</button>`
      : `<span class="notification-banner-link notification-banner-static">${content}</span>`;
    pushLine = `<div class="notification-banner-push">
      ${contentLine}
      <button type="button" class="notification-banner-dismiss" data-notification-dismiss title="Als gesehen markieren" aria-label="Mitteilung als gesehen markieren">${icon('x')}</button>
    </div>`;
  }

  banner.innerHTML = `${pushLine}${chips ? `<div class="notification-banner-aktuell">${chips}</div>` : ''}`;
  banner.hidden = false;

  banner.querySelectorAll('[data-notification-navigate]').forEach((el) => {
    el.addEventListener('click', (e) => {
      window.dispatchEvent(new CustomEvent('lan:navigate', { detail: e.currentTarget.dataset.notificationNavigate }));
    });
  });

  const dismissButton = banner.querySelector('[data-notification-dismiss]');
  dismissButton?.addEventListener('click', async () => {
    const entryId = lastEntry?.id;
    const playerId = getMyId();
    if (!entryId || !playerId || dismissButton.disabled) return;
    dismissButton.disabled = true;
    try {
      await api.push.seen(entryId, playerId);
      await refreshNotificationBanner();
    } catch (err) {
      dismissButton.disabled = false;
      showToast(err.message, { error: true });
    }
  });
}

export async function refreshNotificationBanner() {
  const myId = getMyId();
  const thisEpoch = ++epoch;

  // The "Aktuell" chips aren't personal (besides the skill nudge, which
  // aktuellStatus.js only loads once an identity exists) so they don't need
  // an identity to show — only the personal push line does.
  let entry = null;
  if (myId) {
    try {
      const res = await api.push.current(myId);
      entry = res.entry ?? null;
    } catch {
      entry = null;
    }
  }
  // A newer refresh (identity change, or another push arriving) has since
  // started or already finished — its result is the current one, don't let
  // this now-outdated response clobber it.
  if (thisEpoch !== epoch) return;

  lastEntry = entry;
  renderBanner();
}

// Called once from app.js's main(): loads the initial state and keeps it
// live afterward without any per-view module having to remember to ask.
export function initNotificationBanner() {
  refreshNotificationBanner();
  ensureAktuellLoaded();
  window.addEventListener('lan:identity-changed', () => {
    refreshNotificationBanner();
    ensureAktuellLoaded();
  });
  window.addEventListener('lan:aktuell-changed', renderBanner);
}
