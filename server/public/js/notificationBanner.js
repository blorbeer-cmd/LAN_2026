// Header notifications have two complementary layers: the newest active,
// unread entry is an obvious deep link directly below the topbar, while the
// bell keeps the complete personal history.

import { api } from './api.js';
import { getMyId } from './whoami.js';
import { icon } from './icons.js';
import { escapeHtml, formatDateTime } from './format.js';
import { feedEntryIcon, feedEntryTitle, feedLinkView, FEED_LINK_LABELS } from './pushFeed.js';
import { showToast } from './toast.js';
import { confirmDialog } from './modal.js';

const FEED_LIMIT = 20;

let epoch = 0;
let entries = [];
let highlightEntry = null;
let loadedForId = null;
let loading = false;
let loadError = false;
let isOpen = false;
let highlightExpiryTimer = null;

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

function clearHighlightExpiryTimer() {
  if (highlightExpiryTimer !== null) window.clearTimeout(highlightExpiryTimer);
  highlightExpiryTimer = null;
}

function scheduleHighlightExpiry() {
  clearHighlightExpiryTimer();
  if (!highlightEntry?.expiresAt) return;
  const delay = Math.max(0, highlightEntry.expiresAt - Date.now());
  // Browser timers cap at a signed 32-bit integer. Very distant deadlines
  // simply re-check and schedule the remaining interval later.
  highlightExpiryTimer = window.setTimeout(refreshNotificationBanner, Math.min(delay, 2_147_483_647));
}

function entryHtml(entry) {
  const view = feedLinkView(entry.url);
  const unreadBadge = entry.seen ? '' : '<span class="badge badge-playing">Neu</span>';
  const directBadge = entry.audience === 'direct' ? '<span class="badge badge-paused">Für dich</span>' : '';
  return `<article class="notification-center-entry${entry.seen ? '' : ' is-unread'}" data-notification-entry="${entry.id}">
    <div class="row-between notification-center-entry-head">
      <span class="row notification-center-entry-title">
        <span class="notification-center-entry-icon">${icon(feedEntryIcon(entry))}</span>
        <strong>${escapeHtml(feedEntryTitle(entry))}</strong>${unreadBadge}${directBadge}
      </span>
      <time class="muted notification-center-time">${formatDateTime(entry.createdAt)}</time>
    </div>
    <div class="muted notification-center-body">${escapeHtml(entry.body)}</div>
    <div class="notification-center-actions">
      ${view ? `<button type="button" class="btn btn-sm" data-notification-navigate="${view}" data-notification-id="${entry.id}">${FEED_LINK_LABELS[view]}</button>` : ''}
      <span class="notification-center-entry-tools">
        ${entry.seen ? '' : `<button type="button" class="icon-btn notification-center-seen" data-notification-seen="${entry.id}" aria-label="Als gelesen markieren" title="Als gelesen markieren">${icon('circleCheck')}</button>`}
        <button type="button" class="icon-btn notification-center-remove" data-notification-hide="${entry.id}" aria-label="Mitteilung entfernen" title="Mitteilung entfernen">${icon('trash')}</button>
      </span>
    </div>
  </article>`;
}

function panelContentHtml(myId) {
  if (!myId) {
    return '<div class="empty-state notification-center-empty">Wähle zuerst dein Profil aus.</div>';
  }
  if (loading && loadedForId !== myId) {
    return '<div class="empty-state notification-center-empty">Mitteilungen werden geladen…</div>';
  }
  if (loadError) {
    return '<div class="empty-state notification-center-empty">Mitteilungen konnten nicht geladen werden.</div>';
  }
  if (entries.length === 0) {
    return '<div class="empty-state notification-center-empty">Keine Mitteilungen.</div>';
  }
  return `<div class="notification-center-list">${entries.slice(0, FEED_LIMIT).map(entryHtml).join('')}</div>`;
}

async function markSeen(entryId, { navigate } = {}) {
  const playerId = getMyId();
  const entry = entries.find((item) => item.id === entryId);
  if (!playerId || !entry) return;
  entry.seen = true;
  const previousHighlight = highlightEntry;
  if (highlightEntry?.id === entryId) {
    highlightEntry = null;
    clearHighlightExpiryTimer();
  }
  renderBanner();
  try {
    await api.push.seen(entryId, playerId);
    if (navigate) {
      setOpen(false);
      window.dispatchEvent(new CustomEvent('respawn:navigate', { detail: navigate }));
    }
  } catch (err) {
    entry.seen = false;
    highlightEntry = previousHighlight;
    scheduleHighlightExpiry();
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
    clearHighlightExpiryTimer();
  }
  renderBanner();
  try {
    await api.push.hide(entryId, playerId);
  } catch (err) {
    entries = previousEntries;
    highlightEntry = previousHighlight;
    scheduleHighlightExpiry();
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
  clearHighlightExpiryTimer();
  renderBanner();
  try {
    await api.push.seenAll(playerId);
  } catch (err) {
    entries = previousEntries;
    highlightEntry = previousHighlight;
    scheduleHighlightExpiry();
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
  clearHighlightExpiryTimer();
  renderBanner();
  try {
    await api.push.hideAll(playerId);
  } catch (err) {
    entries = previousEntries;
    highlightEntry = previousHighlight;
    scheduleHighlightExpiry();
    renderBanner();
    showToast(err.message, { error: true });
  }
}

function renderHighlight() {
  const container = highlightEl();
  if (!container) return;
  const view = highlightEntry ? feedLinkView(highlightEntry.url) : null;
  if (!highlightEntry || !getMyId()) {
    clearHighlightExpiryTimer();
    container.hidden = true;
    container.innerHTML = '';
    return;
  }
  container.hidden = false;
  container.innerHTML = `
    <button type="button" class="notification-highlight-link" ${view ? `data-notification-highlight-navigate="${view}"` : 'data-notification-highlight-open'} data-notification-id="${highlightEntry.id}">
      ${icon(feedEntryIcon(highlightEntry))}
      <span class="notification-highlight-text"><strong>${escapeHtml(feedEntryTitle(highlightEntry))}</strong><span>${escapeHtml(highlightEntry.body)}</span></span>
      ${view ? icon('chevronRight') : ''}
    </button>
    <button type="button" class="icon-btn notification-highlight-dismiss" data-notification-highlight-dismiss="${highlightEntry.id}" aria-label="Aktuelle Mitteilung schließen" title="Schließen">${icon('x')}</button>`;
  container.querySelector('[data-notification-highlight-navigate]')?.addEventListener('click', (event) => {
    markSeen(event.currentTarget.dataset.notificationId, {
      navigate: event.currentTarget.dataset.notificationHighlightNavigate,
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

  const myId = getMyId();
  const unreadCount = myId === loadedForId ? entries.filter((entry) => !entry.seen).length : 0;
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
    ${entries.length > 0 ? `<div class="notification-center-toolbar">
      <button type="button" class="btn btn-sm" data-notifications-seen-all ${entries.every((entry) => entry.seen) ? 'disabled' : ''}>Alle als gelesen markieren</button>
      <button type="button" class="btn btn-sm btn-danger" data-notifications-hide-all>Alle löschen</button>
    </div>` : ''}
  `;

  panel.querySelector('[data-notification-close]')?.addEventListener('click', () => {
    setOpen(false);
    button.focus();
  });
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
      markSeen(control.dataset.notificationId, { navigate: control.dataset.notificationNavigate })
    );
  });
}

export async function refreshNotificationBanner() {
  const myId = getMyId();
  const thisEpoch = ++epoch;
  if (!myId) {
    entries = [];
    highlightEntry = null;
    clearHighlightExpiryTimer();
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
    scheduleHighlightExpiry();
    loadedForId = myId;
  } catch {
    if (thisEpoch !== epoch) return;
    entries = [];
    highlightEntry = null;
    clearHighlightExpiryTimer();
    loadedForId = myId;
    loadError = true;
  } finally {
    if (thisEpoch === epoch) {
      loading = false;
      renderBanner();
    }
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
    clearHighlightExpiryTimer();
    loadedForId = null;
    loadError = false;
    refreshNotificationBanner();
  });
  refreshNotificationBanner();
}
