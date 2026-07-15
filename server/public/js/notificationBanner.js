// Header notifications have two complementary layers: the newest active,
// unread entry is an obvious deep link directly below the topbar, while the
// bell keeps the complete personal history.

import { api } from './api.js';
import { getMyId } from './whoami.js';
import { icon } from './icons.js';
import { escapeHtml, formatDateTime } from './format.js';
import { feedLinkView, FEED_LINK_LABELS } from './pushFeed.js';
import { showToast } from './toast.js';

const FEED_LIMIT = 20;

let epoch = 0;
let entries = [];
let highlightEntry = null;
let loadedForId = null;
let loading = false;
let loadError = false;
let isOpen = false;

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

function entryHtml(entry) {
  const view = feedLinkView(entry.url);
  const unreadBadge = entry.seen ? '' : '<span class="badge badge-playing">Neu</span>';
  const directBadge = entry.audience === 'direct' ? '<span class="badge badge-paused">Für dich</span>' : '';
  return `<article class="notification-center-entry${entry.seen ? '' : ' is-unread'}" data-notification-entry="${entry.id}">
    <div class="row-between notification-center-entry-head">
      <span class="row notification-center-entry-title">
        <strong>${escapeHtml(entry.title)}</strong>${unreadBadge}${directBadge}
      </span>
      <time class="muted notification-center-time">${formatDateTime(entry.createdAt)}</time>
    </div>
    <div class="muted notification-center-body">${escapeHtml(entry.body)}</div>
    <div class="notification-center-actions">
      ${view ? `<button type="button" class="btn btn-sm" data-notification-navigate="${view}" data-notification-id="${entry.id}">${FEED_LINK_LABELS[view]}</button>` : ''}
      ${entry.seen ? '' : `<button type="button" class="btn btn-sm" data-notification-seen="${entry.id}">Als gelesen markieren</button>`}
      <button type="button" class="icon-btn notification-center-remove" data-notification-hide="${entry.id}" aria-label="Mitteilung entfernen" title="Mitteilung entfernen">${icon('trash')}</button>
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
  if (highlightEntry?.id === entryId) highlightEntry = null;
  renderBanner();
  try {
    await api.push.seen(entryId, playerId);
    if (navigate) {
      setOpen(false);
      window.dispatchEvent(new CustomEvent('respawn:navigate', { detail: navigate }));
    }
  } catch (err) {
    entry.seen = false;
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
  if (highlightEntry?.id === entryId) highlightEntry = null;
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
      ${icon('bell')}
      <span class="notification-highlight-text"><strong>${escapeHtml(highlightEntry.title)}</strong><span>${escapeHtml(highlightEntry.body)}</span></span>
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
    <div class="notification-center-header row-between">
      <strong>Mitteilungen</strong>
      <button type="button" class="icon-btn" data-notification-close aria-label="Mitteilungen schließen" title="Schließen">${icon('x')}</button>
    </div>
    ${panelContentHtml(myId)}
  `;

  panel.querySelector('[data-notification-close]')?.addEventListener('click', () => {
    setOpen(false);
    button.focus();
  });
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
  } catch {
    if (thisEpoch !== epoch) return;
    entries = [];
    highlightEntry = null;
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
    loadedForId = null;
    loadError = false;
    refreshNotificationBanner();
  });
  refreshNotificationBanner();
}
