// Always-on header banner: shows the single most recent push notification
// that concerned this device's current identity, with a direct link into
// whatever view it's about — a persistent counterpart to the transient toast
// nudges app.js already fires on the relevant socket events, for anyone who
// missed the toast, wasn't looking at the screen, or is just coming back
// after a while away. Lives outside the per-view render cycle (switchView/
// renderCurrent in app.js) since it must stay visible across every view, not
// just Home, so it manages its own small slice of DOM directly instead of
// going through a view module's render(container, ctx).

import { api } from './api.js';
import { getMyId } from './whoami.js';
import { icon } from './icons.js';
import { feedLinkView, bannerContentHtml } from './pushFeed.js';

let epoch = 0;

function bannerEl() {
  return document.getElementById('notification-banner');
}

export async function refreshNotificationBanner() {
  const banner = bannerEl();
  if (!banner) return;
  const myId = getMyId();
  const thisEpoch = ++epoch;

  if (!myId) {
    banner.hidden = true;
    banner.innerHTML = '';
    return;
  }

  let entry = null;
  try {
    const res = await api.push.log(myId);
    entry = res.entries[0] ?? null;
  } catch {
    entry = null;
  }
  // A newer refresh (identity change, or another push arriving) has since
  // started or already finished — its result is the current one, don't let
  // this now-outdated response clobber it.
  if (thisEpoch !== epoch) return;

  if (!entry) {
    banner.hidden = true;
    banner.innerHTML = '';
    return;
  }

  const view = feedLinkView(entry.url);
  const content = bannerContentHtml(entry);
  banner.innerHTML = view
    ? `<button type="button" class="notification-banner-link" data-notification-navigate="${view}">${content}${icon('chevronRight', { className: 'notification-banner-arrow' })}</button>`
    : `<span class="notification-banner-link notification-banner-static">${content}</span>`;
  banner.hidden = false;

  banner.querySelector('[data-notification-navigate]')?.addEventListener('click', (e) => {
    window.dispatchEvent(new CustomEvent('lan:navigate', { detail: e.currentTarget.dataset.notificationNavigate }));
  });
}

// Called once from app.js's main(): loads the initial state and keeps it
// live afterward without any per-view module having to remember to ask.
export function initNotificationBanner() {
  refreshNotificationBanner();
  window.addEventListener('lan:identity-changed', refreshNotificationBanner);
}
