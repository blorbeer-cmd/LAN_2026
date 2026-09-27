// Info: the pinned answers to the questions everyone asks five times per
// evening — WLAN password, Discord link, game-server IPs, house rules. Group
// admins and owners maintain the entries (the server gates every write on
// that role); everyone reads them, and each entry has a one-tap copy button
// since most of them exist to be pasted somewhere.
//
// This is a topbar "i" dialog instead of an own area: it is pure reference
// material people look up mid-conversation, so it must be reachable from
// wherever they are without losing the view they were working in.

import { api } from '../api.js';
import { escapeHtml, formatDateTime } from '../format.js';
import { openModal, confirmDialog } from '../modal.js';
import { showToast } from '../toast.js';
import { withStepUp } from '../reauth.js';
import { emptyStateHtml } from '../emptyState.js';
import { isGroupAdmin } from '../groupContext.js';
import { icon } from '../icons.js';

let cache = null;
let loading = false;
// The currently open dialog, so a socket update can refresh it in place and a
// second trigger (topbar button, search hit) reuses it instead of stacking a
// second copy on top.
let openDialog = null;

async function load() {
  if (loading) return;
  loading = true;
  try {
    const res = await api.info.list();
    cache = res.entries;
  } catch (err) {
    showToast(err.message, { error: true });
    cache = [];
  } finally {
    loading = false;
    renderOpenDialog();
  }
}

// Called from app.js on every info:changed socket event.
export function invalidateInfoBoard() {
  cache = null;
  if (openDialog) load();
}

// Turns bare URLs into clickable links — applied AFTER escapeHtml, so the
// matched text is already entity-escaped and safe to wrap in an anchor.
function linkify(escaped) {
  return escaped.replace(
    /(https?:\/\/[^\s<]+)/g,
    (url) => `<a href="${url}" target="_blank" rel="noopener" style="color:var(--accent);word-break:break-all;">${url}</a>`
  );
}

function findEntry(id) {
  return (cache || []).find((entry) => entry.id === id) ?? null;
}

async function copyContent(entry) {
  try {
    await navigator.clipboard.writeText(entry.content);
    showToast('Kopiert.');
  } catch {
    showToast('Kopieren nicht möglich, bitte manuell markieren.', { error: true });
  }
}

function openEntryForm(existing) {
  const isEdit = Boolean(existing);
  let modalEl;
  const { close } = openModal(
    isEdit ? 'Eintrag bearbeiten' : 'Neuer Eintrag',
    `
      <form id="info-form" class="stack">
        <label for="info-title" class="field-label is-required">Titel</label>
        <input type="text" id="info-title" maxlength="80" required autofocus placeholder="WLAN" value="${escapeHtml(existing?.title ?? '')}" />
        <label for="info-content" class="field-label is-required">Inhalt</label>
        <textarea id="info-content" class="info-board-content-field" maxlength="1000" rows="1" required placeholder="Netz Respawn, Passwort lan2026">${escapeHtml(existing?.content ?? '')}</textarea>
        <div class="modal-actions">
          <button type="button" class="btn" data-dialog-cancel>Abbrechen</button>
          <button type="submit" class="btn btn-primary">${isEdit ? 'Speichern' : 'Anlegen'}</button>
        </div>
      </form>
    `,
    {
      confirmClose: () => {
        if (!modalEl) return null;
        const title = modalEl.querySelector('#info-title').value.trim();
        const content = modalEl.querySelector('#info-content').value.trim();
        const dirty = isEdit
          ? title !== (existing.title ?? '') || content !== (existing.content ?? '')
          : Boolean(title || content);
        return dirty ? 'Der Eintrag mit Titel und Inhalt geht verloren.' : null;
      },
      onMount: (el, closeNow) => {
        modalEl = el;
        el.querySelector('[data-dialog-cancel]').addEventListener('click', () => el.querySelector('[data-close]').click());
        el.querySelector('#info-form').addEventListener('submit', async (e) => {
          e.preventDefault();
          const title = el.querySelector('#info-title').value.trim();
          const content = el.querySelector('#info-content').value.trim();
          if (!title || !content) return;
          try {
            if (isEdit) await api.info.update(existing.id, { title, content });
            else await api.info.create({ title, content });
            closeNow();
            cache = null;
            showToast(isEdit ? 'Gespeichert.' : 'Eintrag angelegt.');
            load();
          } catch (err) {
            showToast(err.message, { error: true });
          }
        });
      },
    }
  );
  return close;
}

async function deleteEntry(entry) {
  if (!(await confirmDialog(`Eintrag „${entry.title}“ löschen?`, { title: 'Eintrag löschen', confirmText: 'Löschen', danger: true }))) return false;
  try {
    const removed = await withStepUp(() => api.info.remove(entry.id), { title: 'Eintrag löschen' });
    if (removed === undefined) return false;
    cache = null;
    showToast('Eintrag gelöscht.');
    load();
    return true;
  } catch (err) {
    showToast(err.message, { error: true });
    return false;
  }
}

// The full entry: content with clickable links, copy for everyone and edit or
// delete for admins.
function openEntryDetail(entry) {
  const canEdit = isGroupAdmin();
  const meta = [
    entry.updatedAt ? `Geändert ${escapeHtml(formatDateTime(entry.updatedAt))}` : '',
    canEdit ? '<button type="button" class="profile-link-btn" data-detail-delete>Löschen</button>' : '',
  ].filter(Boolean).join(' · ');
  const footer = canEdit
    ? `<div class="modal-actions">
        <button type="button" class="btn" data-detail-edit>Bearbeiten</button>
        <button type="button" class="btn btn-primary" data-detail-copy>Kopieren</button>
      </div>`
    : '<div class="row" style="justify-content:flex-end;"><button type="button" class="btn btn-primary btn-sm" data-detail-copy>Kopieren</button></div>';
  const { close } = openModal(entry.title, `
    <div class="stack">
      <p class="info-board-content">${linkify(escapeHtml(entry.content))}</p>
      ${meta ? `<p class="info-board-meta">${meta}</p>` : ''}
      ${footer}
    </div>`, {
    onMount: (el) => {
      el.querySelector('[data-detail-copy]').addEventListener('click', () => copyContent(entry));
      el.querySelector('[data-detail-edit]')?.addEventListener('click', () => {
        close();
        openEntryForm(entry);
      });
      el.querySelector('[data-detail-delete]')?.addEventListener('click', async () => {
        if (await deleteEntry(entry)) close();
      });
    },
  });
}

function entriesHtml() {
  if (loading || cache === null) return emptyStateHtml('Lädt');
  if (cache.length === 0) return emptyStateHtml('Noch keine Einträge');
  const sorted = [...cache].sort((a, b) => a.title.localeCompare(b.title, 'de', { numeric: true, sensitivity: 'base' }));
  // Wide screens show two columns, filled column by column (left first).
  const columnRows = Math.ceil(sorted.length / 2);
  const columnClass = (index) => [
    index === 0 || index === columnRows ? ' is-column-top' : '',
    index === columnRows - 1 || index === sorted.length - 1 ? ' is-column-bottom' : '',
  ].join('');
  const rows = sorted
    .map((entry, index) => {
      const id = escapeHtml(entry.id);
      const title = escapeHtml(entry.title);
      return `<div class="profile-row${columnClass(index)}" data-info-entry="${id}">
        <button type="button" class="profile-row-main" data-open-entry="${id}">
          <span class="profile-row-text">
            <span class="profile-row-title">${title}</span>
            <span class="profile-row-meta info-board-preview">${escapeHtml(entry.content)}</span>
          </span>
        </button>
        <div class="profile-row-action">
          <button type="button" class="btn btn-sm btn-square" data-copy-entry="${id}" aria-label="${title} kopieren" title="Kopieren">${icon('copy')}</button>
        </div>
      </div>`;
    });
  return `<div class="profile-rows profile-rows-columns info-board-list" style="--profile-rows-count:${columnRows};">${rows.join('')}</div>`;
}

function bodyHtml() {
  return `<div class="info-board-dialog">${entriesHtml()}</div>`;
}

function wireBody(root) {
  root.querySelectorAll('[data-open-entry]').forEach((button) => {
    button.addEventListener('click', () => {
      const entry = findEntry(button.dataset.openEntry);
      if (entry) openEntryDetail(entry);
    });
  });
  root.querySelectorAll('[data-copy-entry]').forEach((button) => {
    button.addEventListener('click', () => {
      const entry = findEntry(button.dataset.copyEntry);
      if (entry) copyContent(entry);
    });
  });
}

// Highlights and scrolls to one entry, used when the global search jumps
// straight to a known info entry.
function focusEntry(root, entryId) {
  const element = root.querySelector(`[data-info-entry="${CSS.escape(entryId)}"]`);
  if (!element) return;
  element.classList.add('search-target-highlight');
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  element.scrollIntoView({ block: 'center', behavior: reducedMotion ? 'auto' : 'smooth' });
}

// A control inside the still-open Info dialog that currently has focus,
// expressed as a selector that resolves to the equivalent control after a
// refresh. Entry rows have no id of their own, so a row's open or copy
// control is keyed by the data attribute it carries.
function focusedBodySelector(body) {
  const active = document.activeElement;
  if (!active || !body.contains(active)) return null;
  if (active.id) return `#${active.id}`;
  for (const attr of ['data-open-entry', 'data-copy-entry']) {
    if (active.hasAttribute(attr)) return `[${attr}="${CSS.escape(active.getAttribute(attr))}"]`;
  }
  return null;
}

function renderOpenDialog() {
  if (!openDialog) return;
  const { el, focusEntryId } = openDialog;
  const body = el.querySelector('.modal-body');
  if (!body) return;
  // The refresh unconditionally rebuilds every row (new/edited/deleted
  // entries all reach here through load()), so whatever had focus is removed
  // from the DOM along with the rest of the old markup. Without restoring
  // it, focus silently falls back to <body> - modal.js's own Tab-trap only
  // engages while the topmost backdrop still contains document.activeElement
  // (see isTopmostModal/onKeydown there), so Tab would then escape into
  // whatever sits behind this dialog instead of cycling inside it. Only
  // acts when focus was actually inside this dialog to begin with - a
  // refresh triggered while focus sits elsewhere (e.g. the topbar trigger
  // that reopened an already-open dialog) must not steal it.
  const focusedSelector = focusedBodySelector(body);
  body.innerHTML = bodyHtml();
  wireBody(body);
  if (focusEntryId) focusEntry(body, focusEntryId);
  if (!focusedSelector) return;
  const restored = body.querySelector(focusedSelector);
  if (restored) restored.focus();
  else body.querySelector('button, [href], input, select, textarea, [tabindex]')?.focus();
}

export function openInfoBoard({ focusEntryId = null } = {}) {
  if (openDialog?.el.isConnected) {
    openDialog.focusEntryId = focusEntryId;
    renderOpenDialog();
    return;
  }
  if (cache === null) load();
  const canEdit = isGroupAdmin();
  const { el } = openModal('Info', bodyHtml(), {
    headerAction: canEdit ? '<button type="button" class="btn btn-primary btn-sm" id="info-new-btn">Eintrag anlegen</button>' : '',
    closeButton: false,
    onClose: () => {
      openDialog = null;
    },
    onMount: (backdrop) => {
      backdrop.classList.add('info-board-modal');
      backdrop.querySelector('#info-new-btn')?.addEventListener('click', () => openEntryForm(null));
      wireBody(backdrop.querySelector('.modal-body'));
    },
  });
  openDialog = { el, focusEntryId };
  if (focusEntryId) focusEntry(el, focusEntryId);
}
