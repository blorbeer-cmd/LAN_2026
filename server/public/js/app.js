// App bootstrap: login gate, tab switching, and wiring realtime events into
// the shared state. Kept as one small orchestrator so each view module stays
// focused on its own rendering logic.

import { api } from './api.js';
import { ensureLogin } from './authGate.js';
import { connectSocket } from './socket.js';
import { initConnectionStatus } from './connectionStatus.js';
import { createConnectionRefreshCoordinator } from './connectionRefresh.js';
import { selectableEventWorkspaces, state } from './state.js';
import { loadAll } from './data.js';
import { showToast } from './toast.js';
import { openFeedbackModal } from './feedback.js';
import { getMyId } from './whoami.js';
import { isAdmin, setAdmin } from './admin.js';
import { currentPlayerHasAdminRole } from './adminAccess.js';
import { filterTestUsers } from './testFilter.js';
import { initNotificationBanner, refreshNotificationBanner } from './notificationBanner.js';
import { setDraftState } from './views/matchmaking.js';
import { openInfoBoard } from './views/infoBoard.js';
import { openPlayerDetail } from './views/playerDetail.js';
import { clearFoodOrderTarget, prepareFoodOrderTarget, refreshFoodOrders } from './views/foodOrders.js';
import { focusGameCatalog } from './views/gameCatalog.js';
import { focusTournament, showTournamentLanding } from './views/tournament.js';
import { eventSelectOptions, eventStatus, eventSwitcherLabel } from './eventStatus.js';
import { searchSelectHtml, wireSearchSelect } from './searchSelect.js';
import { icon, installIconReplacement } from './icons.js';
import { initNumberStepper } from './numberStepper.js';
import { initGlobalSearch } from './searchPalette.js';
import { domainIcon, installDomainIcons } from './domainIcons.js';
import { initGroupContext, refreshGroupContext } from './groupContext.js';
import { isKnownView, VIEW_REGISTRY } from './viewRegistry.js';
import { navGroupForView, sectionKeyForView } from './sectionNav.js';
import { initOnboarding, maybeStartOnboarding } from './onboarding.js';
import { captureViewRenderState, restoreViewRenderState } from './viewRenderState.js';
import { realtimeEventAffectsView } from './realtimeRefreshPolicy.js';
import { viewIsEnabledForEvent } from './eventFeatures.js';
import { bottomNavItemsForEvent } from './bottomNav.js';
import { invalidateEventScopedViews, invalidateViewCaches, invalidateViewsAfterReconnect } from './viewLifecycle.js';
import { viewDefinition } from './viewManifest.js';

installIconReplacement();
installDomainIcons();
initNumberStepper();

let currentView = 'home';
// The topbar has no room for a persistent Feedback icon at the narrowest
// supported phone width (verified: even one more 44px icon overflows a
// 320px viewport), so Feedback lives in the "Mehr" hub instead and needs
// this to still capture "which view were you actually looking at" — "Mehr"
// itself carries no content of its own to report feedback about.
let lastSubstantiveView = 'home';
let appReady = false;
let playerDataReady = false;
const viewContainer = document.getElementById('view-container');
let pendingSearchTarget = null;
let renderRevision = 0;
let sharedRefreshPromise = null;
let sharedRefreshDirty = false;
let sharedRefreshShouldRender = false;

function parseFoodOrderHash(hash) {
  const parts = String(hash || '').replace(/^#/, '').split('/');
  if (!['foodOrders', 'eventPolls'].includes(parts[0])) return null;
  if (!parts[1]) return { view: parts[0], target: null };
  try {
    return { view: parts[0], target: { type: parts[0] === 'foodOrders' ? 'order' : 'poll', id: decodeURIComponent(parts[1]) } };
  } catch {
    return { view: parts[0], target: null };
  }
}

function syncArcadeStylesheet(entry) {
  const linkId = 'arcade-stylesheet';
  const existing = document.getElementById(linkId);
  if (entry?.area === 'arcade') {
    if (existing?.dataset.loaded === 'true') return Promise.resolve();
    if (existing) {
      return new Promise((resolve, reject) => {
        existing.addEventListener('load', resolve, { once: true });
        existing.addEventListener('error', reject, { once: true });
      });
    }
    const link = document.createElement('link');
    link.id = linkId;
    link.rel = 'stylesheet';
    // bump ?v= when arcade.css changes so no cached copy survives a reload
    // (keep in sync with kiosk.html's static link)
    link.href = '/css/arcade.css?v=3';
    const loaded = new Promise((resolve, reject) => {
      link.addEventListener('load', () => {
        link.dataset.loaded = 'true';
        resolve();
      }, { once: true });
      link.addEventListener('error', () => {
        link.remove();
        reject(new Error('Arcade-Stylesheet konnte nicht geladen werden.'));
      }, { once: true });
    });
    document.head.append(link);
    return loaded;
  }
  existing?.remove();
  return Promise.resolve();
}

// Tracks the last vote round we've seen, so the socket handler can tell a
// genuinely new round (round number just changed while open) apart from a
// vote being cast or the round being closed — only the former deserves a
// "hey, go vote" nudge.
let lastVoteRound = null;
let voteRealtimeRefreshVersion = 0;

async function runSharedRefresh() {
  // Give the socket echo and the mutation response one task window to meet.
  // Every signal received while the requests are in flight marks the batch
  // dirty again; all network reconciliation finishes before a single render.
  await new Promise((resolve) => setTimeout(resolve, 24));
  let committed = false;
  do {
    sharedRefreshDirty = false;
    committed = await loadAll();
    // loadAll() intentionally discards its response when a newer caller
    // started another central snapshot in parallel. Do not render the old
    // state or resolve mutation callers in that case: retry until this
    // coordinator owns the snapshot that actually committed.
  } while (sharedRefreshDirty || !committed);
  renderEventContextSwitcher();
  syncFeatureNavigation();
  if (sharedRefreshShouldRender) renderCurrent();
}

function syncFeatureNavigation() {
  const items = bottomNavItemsForEvent(state.activeEvent);
  document.querySelectorAll('.nav-btn[data-nav-slot]').forEach((button) => {
    const item = items[Number(button.dataset.navSlot)];
    if (!item) return;
    button.dataset.view = item.view;
    button.id = item.id ?? '';
    button.setAttribute('aria-label', item.ariaLabel);
    const labelElement = button.querySelector('.nav-label');
    labelElement.textContent = item.label;
    if (item.labelBreakAfter) {
      labelElement.textContent = '';
      labelElement.append(
        item.label.slice(0, item.labelBreakAfter),
        document.createElement('wbr'),
        item.label.slice(item.labelBreakAfter),
      );
    }
    const iconElement = button.querySelector('.nav-icon');
    iconElement.dataset.domainIcon = item.iconKey;
    iconElement.innerHTML = icon(domainIcon(item.iconKey));

    const routeAvailable = isKnownView(item.view);
    button.disabled = !routeAvailable;
    button.title = routeAvailable ? '' : `${item.label} sind in diesem Stand noch nicht verfügbar.`;
    button.hidden = !viewIsEnabledForEvent(button.dataset.view, state.activeEvent);
  });
  syncBottomNavigationActiveState();
}

function syncBottomNavigationActiveState() {
  const activeGroup = navGroupForView(currentView, state.activeEvent);
  document.querySelectorAll('.nav-btn').forEach((button) => {
    button.classList.toggle(
      'active',
      !button.disabled && navGroupForView(button.dataset.view, state.activeEvent) === activeGroup,
    );
  });
}

function queueSharedRefresh({ render = true } = {}) {
  sharedRefreshDirty = true;
  sharedRefreshShouldRender ||= render;
  if (!sharedRefreshPromise) {
    sharedRefreshPromise = runSharedRefresh().finally(() => {
      sharedRefreshPromise = null;
      sharedRefreshShouldRender = false;
    });
  }
  return sharedRefreshPromise;
}

const ctx = {
  // Reload everything from the API, then re-render the active view. Use
  // after mutations whose effects aren't already carried by a socket event.
  refresh: () => queueSharedRefresh(),
  // Re-render the active view from whatever is already in `state`, with no
  // network round trip. Use when a view already updated `state` itself
  // (e.g. a freshly drawn matchmaking result).
  rerender: () => renderCurrent(),
};

// The topbar workspace switcher is the same searchable dropdown as every
// other event picker (and as the game pickers in Match): title plus the state
// as an icon, visible collapsed and on every row of the open list. It is
// rebuilt rather than patched because the option set itself changes when an
// event starts, ends or is left.
function renderEventContextSwitcher() {
  const container = document.getElementById('event-context');
  if (!container) return;
  // renderEventContextSwitcher() is called from 30+ unrelated ctx.refresh()
  // sites and from the event-context:changed socket push, none of which know
  // whether a reader currently has this control open and mid-search. Rebuilding
  // unconditionally would close the list and discard whatever they typed, which
  // a native <select> never did. Skip the rebuild while it's open and focused —
  // the option set (and the active-event highlight) simply catches up on the
  // next render once the reader closes it again.
  const openSearch = container.querySelector('#event-context-switcher-search');
  const openList = container.querySelector('#event-context-switcher-list');
  if (openList && !openList.hidden && document.activeElement === openSearch) return;
  const events = selectableEventWorkspaces();
  container.hidden = events.length === 0;
  if (events.length === 0) {
    container.innerHTML = '';
    return;
  }

  const active = events.find((event) => event.id === state.activeEvent?.id) ?? state.activeEvent;
  const options = eventSelectOptions(events);
  const activeId = active?.id ?? '';
  // The state stays in words too: the icon carries the German label, and the
  // wrapper describes the whole control, so colour is never the only cue. The
  // base workspace is the one case where name and state are the same word
  // ("Allgemein"), so it is not repeated back as "Allgemein – Allgemein".
  const activeName = eventSwitcherLabel(active);
  const activeState = eventStatus(active).label;
  const description = active
    ? `Aktives Event: ${activeName}${activeState === activeName ? '' : ` – ${activeState}`}`
    : 'Aktives Event';
  container.innerHTML = searchSelectHtml('event-context-switcher', options, activeId, {
    placeholder: 'Event suchen…',
    ariaLabel: description,
    label: 'Auswählbare Events',
  });
  container.title = description;

  wireSearchSelect(container, 'event-context-switcher', options, {
    emptyText: 'Kein passendes Event gefunden.',
    onChange: async (eventId) => {
      // Mirrors the disabled state the previous native <select> got for free
      // while its change handler awaited the switch: without it, a second
      // pick before the first request resolves fired a second overlapping
      // activateEvent() with no guarantee the visibly-last choice also wins
      // the race, plus an avoidable duplicate round trip. Both elements are
      // re-created by the renderEventContextSwitcher() call at the end of
      // activateEvent() (success or error), so nothing needs to re-enable
      // these exact nodes explicitly.
      const search = container.querySelector('#event-context-switcher-search');
      const toggle = container.querySelector('.search-select-toggle');
      if (search) search.disabled = true;
      if (toggle) toggle.disabled = true;
      try {
        await activateEvent(eventId);
      } catch (error) {
        renderEventContextSwitcher();
        showToast(error.message, { error: true });
      } finally {
        if (search) search.disabled = false;
        if (toggle) toggle.disabled = false;
      }
    },
  });
}

// Every caller (the switcher above and followEventDeepLink) funnels through
// this single queue, so two switches — however they were triggered — always
// finish in the order they were requested instead of racing on network
// timing. Without it, whichever request happened to complete last won,
// independent of which one the reader actually picked last.
let activateEventQueue = Promise.resolve();

async function activateEvent(eventId, { navigate, searchTarget = null } = {}) {
  const run = async () => {
    // A missing eventId is not an error: a notification stored before this
    // release carries no event, and its destination is still the thing the
    // reader tapped. Skip the switch, keep the navigation.
    if (eventId && state.activeEvent?.id !== eventId) {
      await api.events.activate(eventId);
      invalidateEventScopedViews(VIEW_REGISTRY);
      await loadAll();
      renderEventContextSwitcher();
      syncFeatureNavigation();
      await refreshNotificationBanner();
      renderCurrent();
    }
    if (navigate && isKnownView(navigate)) switchView(navigate, { searchTarget });
  };
  const queued = activateEventQueue.then(run, run);
  // A failure must not wedge every switch queued after it — only the caller
  // that triggered it should see the rejection.
  activateEventQueue = queued.catch(() => {});
  return queued;
}

// The one entry point for "a notification wants me somewhere". Its event may
// be gone by the time it is tapped — ended, cancelled, or the participation
// withdrawn — and PUT /api/me/active-event answers 404 for all three. That is
// an expected outcome of a stale link, not a startup failure: say so once and
// still take the reader to the promised view in whatever workspace is active.
async function followEventDeepLink(eventId, view, searchTarget = null) {
  try {
    await activateEvent(eventId, { navigate: view, searchTarget });
  } catch (error) {
    // Defensive on purpose: this catch runs during startup, so throwing a
    // second time here would reintroduce exactly the aborted-startup bug it
    // exists to prevent.
    if (error?.status === 404) {
      showToast('Das Event dieser Mitteilung ist nicht mehr verfügbar.', { error: true });
    } else {
      showToast(error?.message ?? 'Der Eventwechsel ist fehlgeschlagen.', { error: true });
    }
    if (view && isKnownView(view)) switchView(view, { searchTarget });
  }
}

// Selecting a workspace is wired in renderEventContextSwitcher, because that
// function owns the switcher's DOM and replaces it on every refresh. Only the
// deep-link listener belongs here: it outlives any single render.
function wireEventContextSwitcher() {
  window.addEventListener('respawn:event-navigate', (event) => {
    const { eventId, view, target } = event.detail ?? {};
    void followEventDeepLink(eventId, view, target);
  });
}

function renderCurrent({ preserveState = true } = {}) {
  if (playerDataReady && !viewIsEnabledForEvent(currentView, state.activeEvent)) {
    switchView('home', { replace: true });
    showToast('Dieser Bereich ist für das aktive Event nicht aktiviert.');
    return;
  }
  const revision = ++renderRevision;
  const view = currentView;
  const entry = VIEW_REGISTRY[view];
  if (!entry) return;
  const renderState = preserveState && entry.lifecycle.preserveState
    ? captureViewRenderState(viewContainer)
    : null;
  const stylesheetReady = syncArcadeStylesheet(entry);
  if (entry.render) {
    entry.render(viewContainer, ctx);
    restoreViewRenderState(viewContainer, renderState);
    focusPendingSearchTarget();
    return;
  }

  viewContainer.innerHTML = '<section class="card grouped-page-section"><p class="muted">Arcade wird geladen…</p></section>';
  Promise.all([entry.resolveRenderer(), stylesheetReady])
    .then(([renderFn]) => {
      if (revision !== renderRevision || view !== currentView) return;
      renderFn(viewContainer, ctx);
      restoreViewRenderState(viewContainer, renderState);
      focusPendingSearchTarget();
    })
    .catch((error) => {
      if (revision !== renderRevision || view !== currentView) return;
      // A failed Arcade chunk never poisons the Core registry. The explicit retry also resets the
      // registry's rejected promise, while navigating Home works immediately.
      console.error(error);
      viewContainer.innerHTML = '<section class="card grouped-page-section"><p class="muted">Arcade konnte nicht geladen werden.</p><button class="btn" data-retry-arcade>Erneut versuchen</button></section>';
      showToast('Arcade konnte nicht geladen werden.', { error: true });
    });
}

function focusPendingSearchTarget() {
  if (!pendingSearchTarget || pendingSearchTarget.view !== currentView) return;
  const { type, id } = pendingSearchTarget.target;
  // No `player`/`info` entry: both open as a dialog instead of navigating to a
  // view that would then have to highlight a row (see initGlobalSearch below).
  const candidates = {
    game: [...viewContainer.querySelectorAll('[data-search-game]')].filter((el) => el.dataset.searchGame === id),
    order: [
      ...viewContainer.querySelectorAll('[data-order-card], [data-closed-order]'),
    ].filter((el) => el.dataset.orderCard === id || el.dataset.closedOrder === id),
    broadcast: [...viewContainer.querySelectorAll('[data-broadcast]')].filter((el) => el.dataset.broadcast === id),
    carpool: [...viewContainer.querySelectorAll('[data-carpool]')].filter((el) => el.dataset.carpool === id),
    poll: [...viewContainer.querySelectorAll('[data-poll-card]')].filter((el) => el.dataset.pollCard === id),
  }[type] ?? [];
  const element = candidates[0];
  if (!element) return;
  let enclosingDetails = element.closest('details');
  while (enclosingDetails) {
    enclosingDetails.open = true;
    enclosingDetails = enclosingDetails.parentElement?.closest('details') ?? null;
  }
  element.classList.add('search-target-highlight');
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  element.scrollIntoView({ block: 'center', behavior: reducedMotion ? 'auto' : 'smooth' });
  if (element.matches('button, a, input, [tabindex]')) element.focus({ preventScroll: true });
  pendingSearchTarget = null;
}

function viewRequiresAdminRole(view) {
  const definition = viewDefinition(view);
  return definition?.requiresRole === 'admin' && Boolean(definition.deniedView);
}

function renderCurrentAfterPlayerDataLoad() {
  if (playerDataReady && viewRequiresAdminRole(currentView) && !currentPlayerHasAdminRole()) {
    switchView(currentView, { fromHistory: true, replace: true });
    return;
  }
  renderCurrent();
}

// Every deliberate tab switch pushes a browser history entry (see main()'s
// initial replaceState + the popstate listener below) — without this, the
// device's back button has no in-app navigation to undo and just leaves the
// tool entirely instead of jumping to whatever view was open before.
// `fromHistory` is set only when popstate itself calls this, so we render
// the view popstate already navigated the browser to instead of pushing
// another (identical) entry on top of it, which would trap back/forward in
// a loop between the same two states.
// `replace` swaps the current history entry for the target view instead of
// pushing a new one — for redirects away from an entry that must not stay
// reachable via the back button (e.g. a watch view whose match has ended;
// re-pushing would trap back/forward between the stale entry and its
// redirect target).
function switchView(view, { fromHistory = false, replace = false, searchTarget = null } = {}) {
  // Admin-only areas stay reachable through Admin links and deep links alike,
  // but never render for an account whose role no longer permits them.
  if (viewRequiresAdminRole(view) && playerDataReady && !currentPlayerHasAdminRole()) {
    view = viewDefinition(view).deniedView;
  }
  if (playerDataReady && !viewIsEnabledForEvent(view, state.activeEvent)) {
    view = 'home';
    replace = true;
  }
  const changed = view !== currentView;
  if (view !== 'foodOrders') clearFoodOrderTarget();
  pendingSearchTarget = searchTarget ? { view, target: searchTarget } : null;
  if (view === 'foodOrders' && searchTarget?.type === 'order') prepareFoodOrderTarget(searchTarget.id);
  currentView = view;
  if (view !== 'more') lastSubstantiveView = view;
  // Realtime game modules use this marker to ignore updates while another
  // view is active. Without it, a running game can rebuild the current DOM
  // during navigation and make a tap appear to be lost.
  viewContainer.dataset.view = view;
  // A nav button stands for a whole area, so every route inside that area
  // (e.g. Teams inside Wettkampf) keeps its button lit — see sectionNav.js.
  syncBottomNavigationActiveState();
  // Restart the view-enter animation (see .view-enter in style.css). Only on
  // deliberate navigation — realtime-triggered re-renders of the same view
  // must never flash, so renderCurrent() alone doesn't do this.
  viewContainer.classList.remove('view-enter');
  void viewContainer.offsetWidth; // force reflow so removing+adding re-triggers
  viewContainer.classList.add('view-enter');
  // A little indicator on the "Mehr" nav button (which now leads to "Mein
  // Profil") points new/unset devices at self-onboarding (name, avatar,
  // skills, agent key) instead of leaving them to stumble onto it.
  document.querySelector('.nav-btn[data-view="more"]').classList.toggle('needs-setup', !getMyId());
  renderCurrent({ preserveState: !changed && !searchTarget });
  if (!searchTarget) viewContainer.scrollTop = 0;
  if (replace) {
    history.replaceState({ view }, '');
  } else if (!fromHistory && changed) {
    history.pushState({ view }, '');
  }
}

// Persistent "you are in admin mode" indicator: the banner under the topbar
// plus a body class as a styling hook. Admin mode also changes which players
// are visible (test users, see testFilter.js), so every toggle refetches.
function updateAdminIndicator() {
  document.getElementById('admin-banner').hidden = !isAdmin();
  document.body.classList.toggle('admin-mode', isAdmin());
}

function wireAdminMode() {
  updateAdminIndicator();
  document.getElementById('admin-banner-leave').addEventListener('click', () => {
    setAdmin(false);
    showToast('Admin-Modus verlassen.');
  });
  // Views declare whether their cache depends on test-player visibility.
  const invalidateVisibilityCaches = () => invalidateViewCaches(VIEW_REGISTRY, 'visibility:changed');
  window.addEventListener('respawn:admin-changed', () => {
    updateAdminIndicator();
    invalidateVisibilityCaches();
    ctx.refresh();
  });
  // A redeemed test-session identity also needs its test-player peers visible
  // (see testFilter.js) — same "refetch so already-loaded data gets
  // re-filtered" reason as admin-changed above.
  window.addEventListener('respawn:test-identity-changed', () => {
    invalidateVisibilityCaches();
    ctx.refresh();
  });
}

function wireNav() {
  // Topbar and admin-banner icons come from icons.js like everywhere else
  // (index.html stays free of hand-copied SVG paths); the app shell is
  // hidden until this boot code runs, so nothing renders icon-less.
  document.getElementById('notifications-btn').insertAdjacentHTML('afterbegin', icon('bell'));
  document.getElementById('info-btn').innerHTML = icon(domainIcon('infoBoard'));
  document.getElementById('feedback-btn').innerHTML = icon(domainIcon('feedback'));
  document.querySelector('.admin-banner-label').insertAdjacentHTML('afterbegin', icon('shield'));

  document.querySelectorAll('.nav-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      if (btn.dataset.view === 'tournaments') showTournamentLanding();
      switchView(btn.dataset.view);
    });
  });
  // Feedback is reachable from every view via this topbar icon; the view it
  // was opened from is captured automatically (see lastSubstantiveView).
  document.getElementById('feedback-btn').addEventListener('click', () => openFeedbackModal(lastSubstantiveView));
  // Info is reference material people look up mid-conversation, so it opens
  // over whatever they were doing instead of costing them their current view.
  document.getElementById('info-btn').addEventListener('click', () => openInfoBoard());

  // Views can request navigation to a non-bottom-nav view (settings,
  // analytics) by rendering a control with data-navigate="<view>", without
  // needing to import app.js themselves (would risk circular imports).
  viewContainer.addEventListener('click', (e) => {
    if (e.target.closest('[data-retry-arcade]')) {
      renderCurrent();
      return;
    }
    // An area's own tab row (see sectionNav.js). Same navigation as
    // data-navigate, but switching back to the Turniere tab always returns to
    // the tournament list instead of whichever board was open last.
    const tab = e.target.closest('[data-section-tab]');
    if (tab) {
      if (tab.dataset.sectionTab === 'tournaments') showTournamentLanding();
      switchView(tab.dataset.sectionTab);
      return;
    }
    const detail = e.target.closest('[data-open-player-detail]');
    if (detail) {
      openPlayerDetail(detail.dataset.openPlayerDetail);
      return;
    }
    const btn = e.target.closest('[data-navigate]');
    if (btn) {
      if (btn instanceof HTMLAnchorElement) e.preventDefault();
      const target = btn.dataset.navigateTargetId
        ? { type: btn.dataset.navigateTargetType || 'order', id: btn.dataset.navigateTargetId }
        : null;
      switchView(btn.dataset.navigate, { searchTarget: target });
    }
  });

  // Programmatic hooks for view modules that must drive navigation/redraws
  // from outside a click (e.g. the Tetris module jumping to the board view
  // when a realtime match starts, or refreshing its inline lobby on a socket
  // update). Kept as plain CustomEvents so modules stay decoupled from app.js.
  // detail is either the view name or { view, replace } (see switchView).
  window.addEventListener('respawn:navigate', (e) => {
    const detail = typeof e.detail === 'string' ? { view: e.detail } : e.detail ?? {};
    if (isKnownView(detail.view)) switchView(detail.view, { replace: detail.replace === true });
  });
  window.addEventListener('respawn:rerender', () => renderCurrent());
  window.addEventListener('respawn:group-changed', () => ctx.refresh());

  // Back/forward: jump to whichever view is recorded on the popped entry
  // instead of re-pushing it (see switchView's fromHistory param). No
  // recorded state (extremely old entry, or a browser that fired this
  // without one) falls back to today's usual landing view.
  window.addEventListener('popstate', (e) => {
    const view = e.state?.view || (getMyId() ? 'home' : 'profile');
    switchView(view, { fromHistory: true });
  });

  // Tapping a push notification while the app is already open: the service
  // worker focuses this window and posts the target view (see sw.js) instead
  // of reloading the whole SPA just to change tabs.
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.addEventListener('message', (e) => {
      if (e.data?.type === 'navigate' && isKnownView(e.data.view)) {
        void followEventDeepLink(e.data.eventId, e.data.view, e.data.target ?? null);
      }
    });
  }
}

function wireSocket() {
  let reconnectFailureNotified = false;
  const refreshCoordinator = createConnectionRefreshCoordinator({
    refresh: async () => {
      // Socket.IO does not replay arbitrary application events. Invalidate
      // every secondary cache and reload the central REST state after the
      // transport reconnects.
      invalidateViewsAfterReconnect(VIEW_REGISTRY);
      await refreshGroupContext({ throwOnError: true });
      await Promise.all([loadAll(), refreshNotificationBanner({ throwOnError: true })]);
      playerDataReady = true;
      if (appReady) renderCurrentAfterPlayerDataLoad();
    },
    onRecovered: () => {
      reconnectFailureNotified = false;
    },
    onFailure: () => {
      if (reconnectFailureNotified) return;
      showToast('Aktualisierung fehlgeschlagen – neuer Versuch läuft.', { error: true });
      reconnectFailureNotified = true;
    },
    onUnauthorized: () => location.reload(),
  });
  window.addEventListener('respawn:connection-restored', (event) => {
    refreshCoordinator.enqueue(event.detail);
  });
  window.addEventListener('respawn:connection-recovery-required', () => location.reload());

  // Only the long-lived application socket owns the global connection banner.
  // Arcade views open and intentionally close auxiliary sockets; those must
  // never make the whole app appear offline.
  const socket = connectSocket({ reportConnectionState: true });

  // These payload-less events still need a fresh central snapshot, but only
  // screens that consume the changed entity are redrawn. Secondary caches
  // are marked stale without throwing their last-known content away.
  const sharedStateEvents = [
    'players:changed',
    'games:changed',
    'skills:changed',
    'leaderboard:changed',
    'events:changed',
  ];
  sharedStateEvents.forEach((event) =>
    socket.on(event, () => {
      const refreshesOpenFoodOrders = event === 'players:changed' && currentView === 'foodOrders';
      invalidateViewCaches(VIEW_REGISTRY, event, {
        excludeViews: refreshesOpenFoodOrders ? ['foodOrders'] : [],
      });
      if (refreshesOpenFoodOrders) void refreshFoodOrders(ctx);
      void queueSharedRefresh({ render: realtimeEventAffectsView(event, currentView) });
    })
  );

  // These events carry the fresh payload directly, so we can update state
  // and re-render without an extra round trip — important since live-status
  // updates can arrive frequently (every agent report + periodic sweep).
  socket.on('live:changed', (payload) => {
    // Socket payloads bypass apiFetch, so the test-user filter must run here.
    state.live = filterTestUsers(payload);
    invalidateViewCaches(VIEW_REGISTRY, 'live:changed');
    if (currentView === 'home' || currentView === 'seating') renderCurrent();
  });
  socket.on('votes:changed', async () => {
    const refreshVersion = ++voteRealtimeRefreshVersion;
    let payload;
    try {
      // Vote aggregates cannot be filtered safely after the server has
      // grouped away player ids. Refetch through apiFetch so this device's
      // Admin-mode header decides whether fixture contributions are present.
      payload = await api.votes.get();
    } catch {
      return;
    }
    if (refreshVersion !== voteRealtimeRefreshVersion) return;
    const isNewRound = payload.open && payload.round !== lastVoteRound;
    if (!payload.open) invalidateViewCaches(VIEW_REGISTRY, 'votes:closed');
    lastVoteRound = payload.round;

    state.votes = payload;
    // Home shows an "Abstimmung läuft" status card driven by state.votes.
    if (currentView === 'votes' || currentView === 'home') renderCurrent();

    // Anyone with an identity gets nudged that a new vote opened, even if
    // they're not currently looking at the Votes tab — otherwise the only
    // way to notice is to happen to switch there. Skip it if they're already
    // on Votes: the view itself just updated in place, a toast on top would
    // just be noise.
    if (isNewRound && getMyId() && currentView !== 'votes') {
      showToast('Neue Abstimmung gestartet – tippen zum Mitmachen', {
        duration: 4500,
        onClick: () => switchView('votes'),
      });
    }
  });
  // Carries the changed row directly (see routes/preferences.ts) so it can be
  // patched into state.preferences without a round trip. Preferences drive
  // the voting view's sort order/display (see votes.js) and the Spiele
  // view's "Bock" numbers (see gameCatalog.js), but aren't part of the votes
  // payload, so that one tally is refetched too — cheap compared to a full
  // reload, and makes a slider change on one device show up everywhere else
  // immediately instead of only after some other event happens to reload.
  socket.on('preferences:changed', async (payload) => {
    if (payload) {
      const { playerId, gameId, rating } = payload;
      const existing = state.preferences.find((p) => p.player_id === playerId && p.game_id === gameId);
      if (rating === null) {
        state.preferences = state.preferences.filter((p) => !(p.player_id === playerId && p.game_id === gameId));
      } else if (existing) {
        existing.rating = rating;
      } else {
        state.preferences.push({ player_id: playerId, game_id: gameId, rating });
      }
    }
    try {
      state.votes = await api.votes.get();
    } catch {
      // transient failure - keep the last known votes state, not worth surfacing
    }
    if (currentView === 'votes' || currentView === 'gameCatalog') renderCurrent();
  });
  socket.on('matchmaking:generated', (payload) => {
    state.lastMatchmaking = payload;
    invalidateViewCaches(VIEW_REGISTRY, 'matchmaking:generated');
    if (currentView === 'matchmaking') renderCurrent();
  });
  // A draw's teams were fine-tuned (player moved) or a result was just
  // entered for it — refetch so everyone's history view stays in sync.
  socket.on('matchmaking:draws-changed', (payload) => {
    invalidateViewCaches(VIEW_REGISTRY, 'matchmaking:draws-changed');
    // A result was just recorded for this draw elsewhere — the "gerade
    // ausgelost" panel (if still showing that same draw) disappears too,
    // not just the history entry.
    if (payload?.matchId && state.lastMatchmaking?.id === payload.id) {
      state.lastMatchmaking = null;
    }
    if (currentView === 'matchmaking') renderCurrent();
  });
  socket.on('tournaments:changed', (payload) => {
    invalidateViewCaches(VIEW_REGISTRY, 'tournaments:changed');
    if (currentView === 'tournaments' || currentView === 'home') renderCurrent();

    // Same pattern as the vote nudge: only the players actually named in
    // this notification see it, and not if they're already looking at the
    // Turniere tab (it just updated in place).
    const myId = getMyId();
    if (payload?.notify && myId && payload.notify.playerIds.includes(myId) && currentView !== 'tournaments') {
      showToast(payload.notify.message, {
        duration: 5000,
        onClick: () => {
          focusTournament(payload.tournamentId);
          switchView('tournaments');
        },
      });
    }
  });
  // Every notifyPlayers() call on the server also lands here — refresh the
  // header notification center so new entries appear without a reload.
  socket.on('push:sent', () => {
    refreshNotificationBanner();
    invalidateViewCaches(VIEW_REGISTRY, 'push:sent');
  });
  // A short-lived push topic was closed, completed or reached its deadline.
  // Refresh the center so its server-backed state remains current.
  socket.on('push:changed', refreshNotificationBanner);
  // Dismissals are personal: only refresh devices currently acting as the
  // player who marked this entry as seen.
  socket.on('push:seen', (payload) => {
    if (payload?.playerId === getMyId()) refreshNotificationBanner();
  });

  // Arcade lobbies opening/closing update the Home "Aktuell" card. The
  // Arcade views consume these payloads themselves; Home just refetches the
  // cross-game summary (GET /api/arcade/lobbies) instead of tracking four
  // different payload shapes.
  ['arcade:lobbies', 'tetris:lobbies', 'scribble:lobbies', 'pong:lobbies', 'blobby:lobbies', 'snake:lobbies', 'battleship:lobbies', 'challenge-rush:lobbies'].forEach((event) =>
    socket.on(event, () => {
      invalidateViewCaches(VIEW_REGISTRY, 'arcade:lobbies-changed');
      if (currentView === 'home') renderCurrent();
    })
  );

  // Captain draft: the payload carries the full fresh state, so the Teams
  // view can re-render without a round trip. A newly started draft nudges
  // everyone who isn't already watching; a finished draft's teams land in
  // Historie (see draft.ts), so just point people there instead of
  // pinning the result to the top of the page.
  socket.on('draft:changed', (payload) => {
    setDraftState(payload);
    invalidateViewCaches(VIEW_REGISTRY, 'draft:changed');
    if (currentView === 'matchmaking') renderCurrent();
    if (payload?.started && getMyId() && currentView !== 'matchmaking') {
      showToast('Captain-Draft gestartet – tippen zum Zusehen', {
        duration: 5000,
        onClick: () => switchView('matchmaking'),
      });
    }
    if (payload?.completed) {
      showToast('Draft abgeschlossen – Teams stehen in der Historie', {
        duration: 5000,
        onClick: () => switchView('matchmaking'),
      });
    }
  });

  // Durchsagen land as a toast on every device — except the sender's, who
  // already got a "gesendet" confirmation from the form itself.
  socket.on('broadcast:new', (payload) => {
    invalidateViewCaches(VIEW_REGISTRY, 'broadcast:new');
    if (currentView === 'broadcast') renderCurrent();
    if (payload && payload.playerId !== getMyId()) {
      showToast(`${payload.playerName}: ${payload.message}`, { duration: 8000 });
    }
  });
  socket.on('broadcasts:changed', () => {
    invalidateViewCaches(VIEW_REGISTRY, 'broadcasts:changed');
    if (currentView === 'broadcast') renderCurrent();
  });

  // The Info dialog refreshes itself while it is open; nothing else on screen
  // depends on those entries.
  socket.on('info:changed', () => invalidateViewCaches(VIEW_REGISTRY, 'info:changed'));

  socket.on('foodOrders:changed', (payload) => {
    invalidateViewCaches(VIEW_REGISTRY, 'foodOrders:changed', {
      excludeViews: currentView === 'foodOrders' ? ['foodOrders'] : [],
    });
    if (currentView === 'foodOrders') {
      // Silent background refetch (see refreshFoodOrders) instead of the
      // hard invalidate+"Lädt…" reload every other live update uses - that
      // would flash and jump the view back to the top on every payment
      // toggle, including the echo of this device's own change.
      refreshFoodOrders(ctx);
    } else if (currentView === 'home') renderCurrent();
    const myId = getMyId();
    if (payload?.notify && myId && myId !== payload.notify.excludePlayerId && currentView !== 'foodOrders') {
      showToast(payload.notify.message, {
        duration: 5000,
        onClick: () => switchView('foodOrders', { searchTarget: payload.notify.target ?? null }),
      });
    }
  });

  socket.on('arrivals:changed', () => {
    invalidateViewCaches(VIEW_REGISTRY, 'arrivals:changed');
    if (currentView === 'arrivals') renderCurrent();
  });
  socket.on('checklist:changed', (payload) => {
    // The payload says whether tasks or someone's items changed; passing it on
    // keeps an unrelated half of the cache (and the Packliste draft it feeds)
    // from being thrown away.
    invalidateViewCaches(VIEW_REGISTRY, 'checklist:changed', { payload });
    // Every Orga tab re-renders, not just the two checklist ones: the To-Dos
    // tab count belongs to the area shell and is visible from all of them.
    if (sectionKeyForView(currentView) === 'orga') renderCurrent();
  });

  socket.on('music:changed', () => {
    invalidateViewCaches(VIEW_REGISTRY, 'music:changed');
    if (currentView === 'music') renderCurrent();
  });
  socket.on('event-context:changed', async () => {
    invalidateEventScopedViews(VIEW_REGISTRY);
    await loadAll();
    renderEventContextSwitcher();
    await refreshNotificationBanner();
    renderCurrent();
  });
  socket.on('groups:changed', async () => {
    await refreshGroupContext();
    invalidateViewCaches(VIEW_REGISTRY, 'groups:changed');
    if (['admin', 'adminFeatureUsage', 'adminFeedback'].includes(currentView)) renderCurrent();
  });
}

async function main() {
  await ensureLogin();
  document.getElementById('app').hidden = false;
  await initGroupContext();
  wireNav();
  initGlobalSearch((entry) => {
    // Info entries and foreign profiles have no own area any more — they open
    // as a dialog over the current view instead of navigating away from it.
    if (entry.target?.type === 'info' || entry.action === 'info') {
      openInfoBoard({ focusEntryId: entry.target?.id ?? null });
      return;
    }
    if (entry.target?.type === 'player') {
      if (entry.target.id === getMyId()) switchView('profile');
      else openPlayerDetail(entry.target.id);
      return;
    }
    if (entry.target?.type === 'tournament') focusTournament(entry.target.id);
    if (entry.target?.type === 'game') focusGameCatalog(entry.target.id);
    switchView(entry.view, {
      searchTarget: entry.target?.type === 'tournament' ? null : entry.target,
    });
  });
  wireAdminMode();
  initConnectionStatus();
  initNotificationBanner();
  wireEventContextSwitcher();
  // Socket connection and REST cache recovery are background concerns. The
  // app shell and onboarding must still become usable when a single refresh
  // request fails temporarily (or keeps retrying in the background).
  const initialDataLoad = loadAll()
    .then(() => {
      playerDataReady = true;
      renderEventContextSwitcher();
      syncFeatureNavigation();
      if (appReady) renderCurrentAfterPlayerDataLoad();
    })
    .catch((error) => {
      if (error?.status !== 401) showToast('Daten konnten noch nicht geladen werden – neuer Versuch läuft.', { error: true });
    });
  // Start the initial snapshot before opening the socket. This gives it the
  // oldest generation, so any reconnect refresh that starts afterwards wins
  // the state commit even when the initial requests resolve late.
  wireSocket();
  appReady = true;
  await initOnboarding({ navigate: (view) => switchView(view, { replace: true }), rerender: renderCurrent, getCurrentView: () => currentView });
  lastVoteRound = state.votes ? state.votes.round : null;
  const pushedEventId = new URL(location.href).searchParams.get('eventId');
  if (pushedEventId) {
    await initialDataLoad;
    // Never let a stale link abort the remaining startup: the base history
    // entry, the initial switchView() and onboarding all still have to run.
    // The parameter is dropped either way, or a failing link would replay its
    // failure on every reload of this tab.
    await followEventDeepLink(pushedEventId);
    const cleanUrl = new URL(location.href);
    cleanUrl.searchParams.delete('eventId');
    history.replaceState(history.state, '', `${cleanUrl.pathname}${cleanUrl.search}${cleanUrl.hash}`);
  }
  // A push notification's deep link (e.g. /#votes, opened by sw.js when no
  // app window existed yet) overrides that default so the tap actually lands
  // where the notification promised.
  const hashTarget = parseFoodOrderHash(location.hash);
  const hashView = hashTarget?.view ?? location.hash.slice(1);
  // A reload keeps the view the browser was on (stored on the history entry
  // by switchView) instead of bouncing back to Home mid-workflow.
  const restoredView = history.state?.view;
  const initialView = isKnownView(hashView)
    ? hashView
    : isKnownView(restoredView)
      ? restoredView
      : 'home';
  // Establishes the base history entry the very first popstate can land on
  // (replace, not push — this page load shouldn't cost an extra back-step)
  // before any tab switch starts pushing entries on top of it.
  history.replaceState({ view: initialView }, '');
  switchView(initialView, { fromHistory: true, searchTarget: hashTarget?.target ?? null });
  // The core tour's step list depends on the admin role, which only exists
  // on state.players once initialDataLoad resolves (see loadAll() above).
  // The app itself stays interactive regardless - only starting the tour
  // waits, so an admin's first login never silently loses the Admin step to
  // this still-loading player list. initialDataLoad never rejects (see its
  // own .catch() above), so this can't turn a failed refresh into a stuck
  // startup.
  await initialDataLoad;
  maybeStartOnboarding();
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  showToast(`Fehler beim Start: ${err.message}`, { error: true });
});
