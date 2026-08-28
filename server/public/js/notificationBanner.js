// Header notifications have two complementary layers: the newest active,
// unread entry is an obvious deep link directly below the topbar, while the
// bell keeps the complete personal history.

import { api } from './api.js';
import { getMyId } from './whoami.js';
import { icon } from './icons.js';
import { escapeHtml, formatDateTime } from './format.js';
import {
  feedEntryIcon,
  feedEntryTitle,
  feedLinkTarget,
  feedLinkView,
  FEED_LINK_LABELS,
  isFeedEntryObsolete,
} from './pushFeed.js';
import { showToast } from './toast.js';
import { confirmDialog } from './modal.js';
import { emptyStateHtml } from './emptyState.js';

const FEED_LIMIT = 20;

let epoch = 0;
let entries = [];
let highlightEntry = null;
let loadedForId = null;
let loading = false;
let loadError = false;
let isOpen = false;
let expiryRefreshTimer = null;

function buttonEl() {
  return document.getElementById('notifications-btn');
}

function panelEl() {
  return document.getElementById('notifications-panel');
}

function countEl() {
  return document.getElementById('notifications-count');
}

function highlightEl() {
  return document.getElementById('notification-highlight');
}

function setOpen(nextOpen) {
  isOpen = nextOpen;
  renderBanner();
}

function clearExpiryRefreshTimer() {
  if (expiryRefreshTimer !== null) window.clearTimeout(expiryRefreshTimer);
  expiryRefreshTimer = null;
}

// The earliest still-future expiresAt across the highlight banner and the
// full loaded list: any of them can flip an entry from active to obsolete
// (see isFeedEntryObsolete) purely by the clock, with no server push to
// trigger a refresh. Without this, an entry already rendered as unread could
// keep reading that way - and the "Obsolete aufräumen" action could stay
// hidden - until some unrelated refresh happens to reload the panel.
function nextExpiryTimestamp() {
  const now = Date.now();
  const candidates = [highlightEntry?.expiresAt, ...entries.map((entry) => entry.expiresAt)].filter(
    (expiresAt) => typeof expiresAt === 'number' && expiresAt > now,
  );
  return candidates.length > 0 ? Math.min(...candidates) : null;
}

function scheduleNextExpiryRefresh() {
  clearExpiryRefreshTimer();
  const nextExpiry = nextExpiryTimestamp();
  if (nextExpiry === null) return;
  const delay = Math.max(0, nextExpiry - Date.now());
  // Browser timers cap at a signed 32-bit integer. Very distant deadlines
  // simply re-check and schedule the remaining interval later.
  expiryRefreshTimer = window.setTimeout(refreshNotificationBanner, Math.min(delay, 2_147_483_647));
}

// An obsolete entry (its workflow resolved, or it expired - see
// isFeedEntryObsolete) never reads as unread, even before it has actually
// been opened: a returning player scanning the center after an absence
// should see at a glance which entries still need attention.
export function entryHtml(entry) {
  const view = feedLinkView(entry.url);
  const target = feedLinkTarget(entry.url);
  const obsolete = isFeedEntryObsolete(entry);
  const unread = !entry.seen && !obsolete;
  const directBadge = entry.audience === 'direct' ? '<span class="badge badge-paused">Für dich</span>' : '';
  const eventBadge = entry.eventName
    ? `<span class="badge badge-event">${escapeHtml(entry.eventName)}</span>`
    : '';
  const obsoleteBadge = obsolete
    ? `<span class="badge badge-neutral">${entry.resolvedAt ? 'Obsolet' : 'Abgelaufen'}</span>`
    : '';
  return `<article class="notification-center-entry${unread ? ' is-unread' : ''}${obsolete ? ' is-obsolete' : ''}" data-notification-entry="${entry.id}">
    <div class="row-between notification-center-entry-head">
      <span class="row notification-center-entry-title">
        <span class="notification-center-entry-icon">${icon(feedEntryIcon(entry))}</span>
        <strong>${escapeHtml(feedEntryTitle(entry))}</strong>${eventBadge}${directBadge}${obsoleteBadge}
      </span>
      <time class="muted notification-center-time">${formatDateTime(entry.createdAt)}</time>
    </div>
    <div class="muted notification-center-body">${escapeHtml(entry.body)}</div>
    <div class="notification-center-actions">
      ${view ? `<button type="button" class="btn btn-sm" data-notification-navigate="${view}" data-notification-target="${escapeHtml(target?.id ?? '')}" data-notification-event-id="${escapeHtml(entry.eventId ?? '')}" data-notification-id="${entry.id}">${FEED_LINK_LABELS[view]}</button>` : ''}
      <span class="notification-center-entry-tools">
        ${unread ? `<button type="button" class="icon-btn notification-center-seen" data-notification-seen="${entry.id}" aria-label="Als gelesen markieren" title="Als gelesen markieren">${icon('circleCheck')}</button>` : ''}
        <button type="button" class="icon-btn notification-center-remove" data-notification-hide="${entry.id}" aria-label="Mitteilung entfernen" title="Mitteilung entfernen">${icon('trash')}</button>
      </span>
    </div>
  </article>`;
}

function panelContentHtml(myId) {
  if (!myId) {
    return emptyStateHtml('Wähle zuerst dein Profil aus.', { className: 'notification-center-empty' });
  }
  if (loading && loadedForId !== myId) {
    return emptyStateHtml('Mitteilungen werden geladen…', { className: 'notification-center-empty' });
  }
  if (loadError) {
    return emptyStateHtml('Mitteilungen konnten nicht geladen werden.', { className: 'notification-center-empty' });
  }
  if (entries.length === 0) {
    return emptyStateHtml('Keine Mitteilungen.', { className: 'notification-center-empty' });
  }
  return `<div class="notification-center-list">${entries.slice(0, FEED_LIMIT).map(entryHtml).join('')}</div>`;
}

async function markSeen(entryId, { navigate, eventId, target = null } = {}) {
  const playerId = getMyId();
  const entry = entries.find((item) => item.id === entryId);
  if (!playerId || !entry) return;
  entry.seen = true;
  const previousHighlight = highlightEntry;
  if (highlightEntry?.id === entryId) {
    highlightEntry = null;
  }
  renderBanner();
  try {
    await api.push.seen(entryId, playerId);
    if (navigate) {
      setOpen(false);
      window.dispatchEvent(new CustomEvent('respawn:event-navigate', { detail: { view: navigate, eventId, target } }));
    }
  } catch (err) {
    entry.seen = false;
    highlightEntry = previousHighlight;
    renderBanner();
    showToast(err.message, { error: true });
  }
}

async function hideEntry(entryId) {
  const playerId = getMyId();
  if (!playerId) return;
  const previousEntries = entries;
  const previousHighlight = highlightEntry;
  entries = entries.filter((item) => item.id !== entryId);
  if (highlightEntry?.id === entryId) {
    highlightEntry = null;
  }
  renderBanner();
  try {
    await api.push.hide(entryId, playerId);
  } catch (err) {
    entries = previousEntries;
    highlightEntry = previousHighlight;
    renderBanner();
    showToast(err.message, { error: true });
  }
}

async function markAllSeen() {
  const playerId = getMyId();
  if (!playerId || entries.every((entry) => entry.seen)) return;
  const previousEntries = entries.map((entry) => ({ ...entry }));
  const previousHighlight = highlightEntry;
  entries.forEach((entry) => {
    entry.seen = true;
  });
  highlightEntry = null;
  renderBanner();
  try {
    await api.push.seenAll(playerId);
  } catch (err) {
    entries = previousEntries;
    highlightEntry = previousHighlight;
    renderBanner();
    showToast(err.message, { error: true });
  }
}

async function hideAllEntries() {
  const playerId = getMyId();
  if (!playerId || entries.length === 0) return;
  if (!(await confirmDialog('Alle Mitteilungen aus deiner Historie entfernen?', {
    confirmText: 'Alle löschen',
    danger: true,
  }))) return;
  const previousEntries = entries;
  const previousHighlight = highlightEntry;
  entries = [];
  highlightEntry = null;
  renderBanner();
  try {
    await api.push.hideAll(playerId);
  } catch (err) {
    entries = previousEntries;
    highlightEntry = previousHighlight;
    renderBanner();
    showToast(err.message, { error: true });
  }
}

// Unlike hideAllEntries, this never needs a confirmation dialog: it only
// ever removes entries that are already obsolete, never one a player might
// still act on.
async function hideResolvedEntries() {
  const playerId = getMyId();
  if (!playerId) return;
  const obsoleteIds = new Set(entries.filter((entry) => isFeedEntryObsolete(entry)).map((entry) => entry.id));
  if (obsoleteIds.size === 0) return;
  const previousEntries = entries;
  const previousHighlight = highlightEntry;
  entries = entries.filter((entry) => !obsoleteIds.has(entry.id));
  if (highlightEntry && obsoleteIds.has(highlightEntry.id)) {
    highlightEntry = null;
  }
  renderBanner();
  try {
    await api.push.hideResolved(playerId);
  } catch (err) {
    entries = previousEntries;
    highlightEntry = previousHighlight;
    renderBanner();
    showToast(err.message, { error: true });
  }
}

function renderHighlight() {
  const container = highlightEl();
  if (!container) return;
  const view = highlightEntry ? feedLinkView(highlightEntry.url) : null;
  if (!highlightEntry || !getMyId()) {
    container.hidden = true;
    container.innerHTML = '';
    return;
  }
  container.hidden = false;
  container.innerHTML = `
    <button type="button" class="notification-highlight-link" ${view ? `data-notification-highlight-navigate="${view}"` : 'data-notification-highlight-open'} data-notification-id="${highlightEntry.id}">
      ${icon(feedEntryIcon(highlightEntry))}
      <span class="notification-highlight-text"><strong>${escapeHtml(highlightEntry.eventName ? `${highlightEntry.eventName} · ${feedEntryTitle(highlightEntry)}` : feedEntryTitle(highlightEntry))}</strong><span>${escapeHtml(highlightEntry.body)}</span></span>
      ${view ? icon('chevronRight') : ''}
    </button>
    <button type="button" class="icon-btn notification-highlight-dismiss" data-notification-highlight-dismiss="${highlightEntry.id}" aria-label="Aktuelle Mitteilung schließen" title="Schließen">${icon('x')}</button>`;
  container.querySelector('[data-notification-highlight-navigate]')?.addEventListener('click', (event) => {
    markSeen(event.currentTarget.dataset.notificationId, {
      navigate: event.currentTarget.dataset.notificationHighlightNavigate,
      eventId: highlightEntry.eventId,
      target: feedLinkTarget(highlightEntry.url),
    });
  });
  container.querySelector('[data-notification-highlight-open]')?.addEventListener('click', () => setOpen(true));
  container.querySelector('[data-notification-highlight-dismiss]')?.addEventListener('click', (event) => {
    markSeen(event.currentTarget.dataset.notificationHighlightDismiss);
  });
}

// Kept under the established export name so app.js and realtime consumers
// do not need a second notification state abstraction.
export function renderBanner() {
  const button = buttonEl();
  const panel = panelEl();
  const count = countEl();
  if (!button || !panel || !count) return;

  renderHighlight();
  // Re-arms against the current entries/highlight state on every render, so
  // the individual mutators below no longer need to reason about the timer
  // themselves - see nextExpiryTimestamp's own comment.
  scheduleNextExpiryRefresh();

  const myId = getMyId();
  const unreadCount =
    myId === loadedForId ? entries.filter((entry) => !entry.seen && !isFeedEntryObsolete(entry)).length : 0;
  count.textContent = unreadCount > 9 ? '9+' : String(unreadCount);
  count.hidden = unreadCount === 0;
  button.classList.toggle('has-unread', unreadCount > 0);
  button.setAttribute('aria-expanded', String(isOpen));
  button.setAttribute(
    'aria-label',
    unreadCount > 0 ? `Mitteilungen, ${unreadCount} ungelesen` : 'Mitteilungen'
  );

  panel.hidden = !isOpen;
  if (!isOpen) return;
  panel.innerHTML = `
    <div class="notification-center-header">
      <div class="row-between">
        <strong>Mitteilungen</strong>
        <button type="button" class="icon-btn" data-notification-close aria-label="Mitteilungen schließen" title="Schließen">${icon('x')}</button>
      </div>
    </div>
    ${panelContentHtml(myId)}
    ${entries.length > 0 ? (() => {
      const hasObsolete = entries.some((entry) => isFeedEntryObsolete(entry));
      return `<div class="notification-center-toolbar${hasObsolete ? ' notification-center-toolbar--3' : ''}">
      ${hasObsolete ? '<button type="button" class="btn btn-sm" data-notifications-hide-resolved>Obsolete aufräumen</button>' : ''}
      <button type="button" class="btn btn-sm" data-notifications-seen-all ${entries.every((entry) => entry.seen || isFeedEntryObsolete(entry)) ? 'disabled' : ''}>Alle gelesen</button>
      <button type="button" class="btn btn-sm btn-danger" data-notifications-hide-all>Alle löschen</button>
    </div>`;
    })() : ''}
  `;

  panel.querySelector('[data-notification-close]')?.addEventListener('click', () => {
    setOpen(false);
    button.focus();
  });
  panel.querySelector('[data-notifications-hide-resolved]')?.addEventListener('click', hideResolvedEntries);
  panel.querySelector('[data-notifications-seen-all]')?.addEventListener('click', markAllSeen);
  panel.querySelector('[data-notifications-hide-all]')?.addEventListener('click', hideAllEntries);
  panel.querySelectorAll('[data-notification-seen]').forEach((control) => {
    control.addEventListener('click', () => markSeen(control.dataset.notificationSeen));
  });
  panel.querySelectorAll('[data-notification-hide]').forEach((control) => {
    control.addEventListener('click', () => hideEntry(control.dataset.notificationHide));
  });
  panel.querySelectorAll('[data-notification-navigate]').forEach((control) => {
    control.addEventListener('click', () =>
      markSeen(control.dataset.notificationId, {
        navigate: control.dataset.notificationNavigate,
        eventId: control.dataset.notificationEventId,
        target: control.dataset.notificationTarget ? { type: 'order', id: control.dataset.notificationTarget } : null,
      })
    );
  });
}

export async function refreshNotificationBanner({ throwOnError = false } = {}) {
  const myId = getMyId();
  const thisEpoch = ++epoch;
  if (!myId) {
    entries = [];
    highlightEntry = null;
    loadedForId = null;
    loading = false;
    loadError = false;
    renderBanner();
    return;
  }

  loading = true;
  loadError = false;
  renderBanner();
  try {
    const [res, current] = await Promise.all([api.push.log(myId), api.push.current(myId)]);
    if (thisEpoch !== epoch) return;
    entries = res.entries;
    highlightEntry = current.entry;
    loadedForId = myId;
  } catch (error) {
    if (thisEpoch !== epoch) return;
    entries = [];
    highlightEntry = null;
    loadedForId = myId;
    loadError = true;
    if (throwOnError) throw error;
  } finally {
    if (thisEpoch === epoch) {
      loading = false;
      renderBanner();
    }
  }
}

// A workflow can retire its own actionable notification without deleting the
// historical entry. The target id is the server's stable topic key, so this
// works even when the notification itself belongs to the base workspace (as
// event invitations do before the invitee may enter the target event).
export async function settleNotificationTarget(targetId) {
  const playerId = getMyId();
  if (!playerId || !targetId) return;
  let matching = entries.filter((entry) => entry.targetId === targetId && !entry.seen);
  if (matching.length === 0) {
    try {
      const response = await api.push.log(playerId);
      matching = response.entries.filter((entry) => entry.targetId === targetId && !entry.seen);
    } catch {
      // The invitation mutation already succeeded. The ordinary refresh event
      // below retries the center without turning that success into an error.
      return;
    }
  }
  if (matching.length === 0) return;
  entries.filter((entry) => entry.targetId === targetId).forEach((entry) => {
    entry.seen = true;
  });
  if (matching.some((entry) => entry.id === highlightEntry?.id)) {
    highlightEntry = null;
  }
  renderBanner();
  try {
    await Promise.all(matching.map((entry) => api.push.seen(entry.id, playerId)));
  } catch (error) {
    await refreshNotificationBanner();
    showToast(error.message, { error: true });
  }
}

export function initNotificationBanner() {
  const button = buttonEl();
  const center = document.querySelector('[data-notification-center]');
  if (!button || !center) return;

  button.addEventListener('click', () => {
    setOpen(!isOpen);
    if (isOpen) refreshNotificationBanner();
  });
  document.addEventListener('pointerdown', (event) => {
    if (isOpen && !center.contains(event.target)) setOpen(false);
  });
  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape' || !isOpen) return;
    setOpen(false);
    button.focus();
  });
  window.addEventListener('respawn:identity-changed', () => {
    isOpen = false;
    entries = [];
    highlightEntry = null;
    loadedForId = null;
    loadError = false;
    refreshNotificationBanner();
  });
  // Local REST mutations can refresh this browser without implying delivery
  // to sockets, Push subscribers or the Kiosk.
  window.addEventListener('respawn:notifications-refresh', refreshNotificationBanner);
  refreshNotificationBanner();
}
