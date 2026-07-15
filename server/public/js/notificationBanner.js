// Header notification center: the bell next to profile/settings loads the
// current identity's relevant push-log entries, keeps unread state on the
// server, and lets that player hide an entry without deleting it for anyone
// else. The old always-visible strip and Home history intentionally no
// longer render the same notification in parallel.

import { api } from './api.js';
import { getMyId } from './whoami.js';
import { icon } from './icons.js';
import { escapeHtml, formatDateTime } from './format.js';
import { feedLinkView, FEED_LINK_LABELS } from './pushFeed.js';
import { showToast } from './toast.js';

const FEED_LIMIT = 20;

let epoch = 0;
let entries = [];
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
  entries = entries.filter((item) => item.id !== entryId);
  renderBanner();
  try {
    await api.push.hide(entryId, playerId);
  } catch (err) {
    entries = previousEntries;
    renderBanner();
    showToast(err.message, { error: true });
  }
}

// Kept under the established export name so app.js and realtime consumers
// do not need a second notification state abstraction.
export function renderBanner() {
  const button = buttonEl();
  const panel = panelEl();
  const count = countEl();
  if (!button || !panel || !count) return;

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
    const res = await api.push.log(myId);
    if (thisEpoch !== epoch) return;
    entries = res.entries;
    loadedForId = myId;
  } catch {
    if (thisEpoch !== epoch) return;
    entries = [];
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
    loadedForId = null;
    loadError = false;
    refreshNotificationBanner();
  });
  refreshNotificationBanner();
}
