// Small counters on navigation entries: how many unread notifications and
// open To-Dos wait in that area. Opening the area clears them. The counting
// rules live in navBadgeModel.js; this module reads the shared caches, keeps
// the per-device "seen" list of To-Dos and draws the counters into the
// bottom nav, the desktop rail and the "Mehr" hub.

import { state } from './state.js';
import { getMyId } from './whoami.js';
import { markFeedEntriesSeen, notificationFeedEntries } from './notificationBanner.js';
import { ensureMyTodosLoaded, invalidateMyTodos, keepMyTodosFresh, myTodoRows, pendingVoteRounds } from './myTodos.js';
import {
  countForBottomNav,
  countForDesktopNav,
  countForMoreCard,
  itemsSeenByOpening,
  navBadgeItems,
  navBadgeLabel,
  navBadgeText,
  navTargetForView,
  pruneSeenTodoIds,
  rememberSeenTodoIds,
  settleOpenedArea,
  todoIdsSettledBy,
  unseenNavBadgeItems,
} from './navBadgeModel.js';

const STORAGE_PREFIX = 'respawn_nav_seen_todos:';

let openView = null;
let openRoute = null;
// The area opened before the feed and the workspace had loaded: applied once
// both are there, so a reload straight into a view still counts it as seen.
let pendingFeedOpen = null;
// A failed "read" write restores the unread entry; the same visit retries it
// a bounded number of times instead of leaving it unread while open.
const MAX_SEEN_RETRIES = 2;
let seenRetries = 0;

function readSeenTodoIds(playerId) {
  if (!playerId) return [];
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_PREFIX + playerId) ?? '[]');
    return Array.isArray(parsed) ? parsed.filter((id) => typeof id === 'string') : [];
  } catch {
    return [];
  }
}

function writeSeenTodoIds(playerId, ids) {
  if (!playerId) return;
  try {
    localStorage.setItem(STORAGE_PREFIX + playerId, JSON.stringify(ids));
  } catch {
    // Private mode or full storage: counters then simply reappear after a
    // reload, which is the safe direction.
  }
}

function currentItems() {
  const feedEntries = notificationFeedEntries();
  const todoRows = myTodoRows({ skillNudges: [] }) ?? [];
  // Notifications are matched against the open workspace, so an area can
  // only be settled once both the feed and the workspace snapshot are here.
  return {
    feedReady: feedEntries !== null && Boolean(state.activeEvent?.id),
    items: navBadgeItems({
      feedEntries: feedEntries ?? [],
      todoRows,
      pendingVotes: pendingVoteRounds(),
      activeEventId: state.activeEvent?.id ?? null,
    }),
  };
}

// Forgets seen marks of To-Dos that are no longer open, once the full list
// is loaded, so a reopened task counts again (see pruneSeenTodoIds).
function pruneSeenTodos(playerId, seenIds) {
  const rows = myTodoRows({ skillNudges: [] });
  if (!playerId || rows === null) return seenIds;
  const activeEventId = state.activeEvent?.id ?? null;
  const openIds = [
    ...rows.map((row) => `todo:${row.id}`),
    ...pendingVoteRounds().map((round) => `todo:vote-ballot:${activeEventId}:${round}`),
  ];
  const next = pruneSeenTodoIds(seenIds, openIds, activeEventId);
  if (next.length !== seenIds.length) writeSeenTodoIds(playerId, next);
  return next;
}

function readFeedEntries(view, entryIds) {
  if (entryIds.length === 0) return;
  void markFeedEntriesSeen(entryIds).then((saved) => {
    if (saved || view !== openView || seenRetries >= MAX_SEEN_RETRIES) return;
    seenRetries += 1;
    pendingFeedOpen = view;
    renderNavBadges();
  });
}

function markTodosSeen(playerId, items, seenIds) {
  const newIds = todoIdsSettledBy(items).filter((id) => !seenIds.includes(id));
  if (newIds.length === 0) return seenIds;
  const next = rememberSeenTodoIds(seenIds, newIds);
  writeSeenTodoIds(playerId, next);
  return next;
}

function setBadge(host, count) {
  if (!host) return;
  let badge = host.querySelector(':scope > .nav-badge');
  if (count <= 0) {
    badge?.remove();
    return;
  }
  if (!badge) {
    badge = document.createElement('span');
    badge.className = 'nav-badge';
    badge.innerHTML = '<span class="nav-count-value" aria-hidden="true"></span><span class="visually-hidden"></span>';
    host.append(badge);
  }
  badge.querySelector('.nav-count-value').textContent = navBadgeText(count);
  badge.querySelector('.visually-hidden').textContent = `, ${count} neu`;
}

// The accessible name of a labelled nav button carries the count as well,
// because aria-label hides the badge's own text.
function setButtonLabel(button, count) {
  const base = button.dataset.baseLabel;
  if (base) button.setAttribute('aria-label', navBadgeLabel(base, count));
}

export function renderNavBadges() {
  if (typeof document === 'undefined') return;
  const playerId = getMyId();
  const { items, feedReady } = playerId ? currentItems() : { items: [], feedReady: false };

  if (playerId && pendingFeedOpen) {
    const settled = settleOpenedArea({ pendingView: pendingFeedOpen, openView, openRoute, feedReady, items });
    pendingFeedOpen = settled.pendingView;
    readFeedEntries(openView, settled.feedEntryIds);
  }

  // To-Dos that turn up while their area is open are seen right there; they
  // stay listed on Home either way.
  let seenIds = pruneSeenTodos(playerId, readSeenTodoIds(playerId));
  if (playerId) seenIds = markTodosSeen(playerId, itemsSeenByOpening(items, openView, openRoute), seenIds);
  const visible = unseenNavBadgeItems(items, new Set(seenIds));
  const activeTarget = openView ? navTargetForView(openView) : null;

  document.querySelectorAll('.nav-btn[data-view]').forEach((button) => {
    const count = button.classList.contains('active') || button.hidden
      ? 0
      : countForBottomNav(visible, button.dataset.view, state.activeEvent);
    setBadge(button.querySelector('.nav-icon'), count);
    setButtonLabel(button, count);
  });
  document.querySelectorAll('.desktop-nav-btn[data-view]').forEach((button) => {
    const count = button.dataset.view === activeTarget ? 0 : countForDesktopNav(visible, button.dataset.view);
    // The rail icon is too small for a corner counter without covering the
    // label, so the counter closes the row instead.
    setBadge(button, count);
    setButtonLabel(button, count);
  });
  document.querySelectorAll('.more-card[data-navigate]').forEach((card) => {
    setBadge(card.querySelector('.list-row-icon'), countForMoreCard(visible, card.dataset.navigate));
  });
}

// Called by switchView() for every navigation, including a repeated tap on
// the area that is already open. `route` is the view's local route, such as
// the betting round a notification link opened.
export function noteNavViewOpened(view, route = null) {
  openView = view;
  openRoute = route;
  seenRetries = 0;
  const playerId = getMyId();
  if (!playerId) return;
  ensureMyTodosLoaded();
  const { items, feedReady } = currentItems();
  markTodosSeen(playerId, itemsSeenByOpening(items, view, route), readSeenTodoIds(playerId));
  const settled = settleOpenedArea({ pendingView: view, openView: view, openRoute: route, feedReady, items });
  pendingFeedOpen = settled.pendingView;
  readFeedEntries(view, settled.feedEntryIds);
}

export function initNavBadges() {
  keepMyTodosFresh();
  window.addEventListener('respawn:notifications-changed', renderNavBadges);
  window.addEventListener('respawn:my-todos-changed', renderNavBadges);
  // Another account's To-Dos must not stay on screen, and the backoff of a
  // load that failed while nobody was signed in must not delay the new one.
  window.addEventListener('respawn:identity-changed', () => {
    if (getMyId()) invalidateMyTodos({ hard: true });
    renderNavBadges();
  });
  if (getMyId()) ensureMyTodosLoaded();
  renderNavBadges();
}
