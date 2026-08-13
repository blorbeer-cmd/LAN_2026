// Info: the pinned answers to the questions everyone asks five times per
// evening — WLAN password, Discord link, game-server IPs, house rules. Anyone
// can add/edit/delete entries (LAN trust model); values get a one-tap copy
// button since most of them exist to be pasted somewhere.
//
// This is a topbar "i" dialog instead of an own area: it is pure reference
// material people look up mid-conversation, so it must be reachable from
// wherever they are without losing the view they were working in.

import { api } from '../api.js';
import { escapeHtml } from '../format.js';
import { openModal, confirmDialog } from '../modal.js';
import { showToast } from '../toast.js';
import { icon } from '../icons.js';
import { withStepUp } from '../reauth.js';
import { emptyStateHtml } from '../emptyState.js';
import { infoTooltipHtml, wireInfoTooltips } from '../infoTooltip.js';

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

function openEntryForm(existing) {
  const isEdit = Boolean(existing);
  let modalEl;
  const { close } = openModal(
    isEdit ? 'Eintrag bearbeiten' : 'Neuer Eintrag',
    `
      <form id="info-form" class="stack">
        <label for="info-title" class="field-label">Titel</label>
        <input type="text" id="info-title" maxlength="80" required autofocus placeholder="z.B. WLAN" value="${escapeHtml(existing?.title ?? '')}" />
        <label for="info-content" class="field-label">Inhalt</label>
        <textarea id="info-content" maxlength="1000" rows="4" required placeholder="z.B. Netz: Respawn / Passwort: …">${escapeHtml(existing?.content ?? '')}</textarea>
        <button type="submit" class="btn btn-primary btn-block">${isEdit ? 'Speichern' : 'Anlegen'}</button>
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
      onMount: (el) => {
        modalEl = el;
        el.querySelector('#info-form').addEventListener('submit', async (e) => {
          e.preventDefault();
          const title = el.querySelector('#info-title').value.trim();
          const content = el.querySelector('#info-content').value.trim();
          if (!title || !content) return;
          try {
            if (isEdit) await api.info.update(existing.id, { title, content });
            else await api.info.create({ title, content });
            close();
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
}

function entriesHtml() {
  if (loading || cache === null) return emptyStateHtml('Lädt…');
  if (cache.length === 0) {
    return emptyStateHtml('Noch keine Einträge.');
  }
  return `<div class="two-column-card-grid">${[...cache]
    .sort((a, b) => a.title.localeCompare(b.title, 'de', { sensitivity: 'base' }))
    .map(
      (e) => `
      <div class="card stack" style="gap:var(--space-2);" data-info-entry="${e.id}">
        <div class="row-between">
          <strong class="info-board-title">${escapeHtml(e.title)}</strong>
          <span class="row" style="gap:var(--space-1);">
            <button type="button" class="icon-btn" data-copy-entry="${e.id}" title="Inhalt kopieren" aria-label="Inhalt kopieren">${icon('copy')}</button>
            <button type="button" class="icon-btn" data-edit-entry="${e.id}" title="Bearbeiten" aria-label="Bearbeiten">${icon('pencil')}</button>
            <button type="button" class="icon-btn" data-delete-entry="${e.id}" title="Löschen" aria-label="Löschen">${icon('trash')}</button>
          </span>
        </div>
        <div class="info-board-content">${linkify(escapeHtml(e.content))}</div>
      </div>`
    )
    .join('')}</div>`;
}

function bodyHtml() {
  return `
    <div class="stack info-board-dialog">
      <button type="button" class="btn btn-primary btn-sm btn-block" id="info-new-btn">Eintrag anlegen</button>
      <div class="grouped-page-section-title">
        <strong class="title-with-info">
          <span>Einträge</span>
          ${infoTooltipHtml('info-board-entries-help', 'Einträge', 'Für WLAN-Passwort, Discord-Link, Server-IPs und Hausregeln.')}
        </strong>
      </div>
      ${entriesHtml()}
    </div>
  `;
}

function wireBody(root) {
  wireInfoTooltips(root);
  root.querySelector('#info-new-btn').addEventListener('click', () => openEntryForm(null));

  root.querySelectorAll('[data-edit-entry]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const entry = (cache || []).find((e) => e.id === btn.dataset.editEntry);
      if (entry) openEntryForm(entry);
    });
  });

  root.querySelectorAll('[data-copy-entry]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const entry = (cache || []).find((e) => e.id === btn.dataset.copyEntry);
      if (!entry) return;
      try {
        await navigator.clipboard.writeText(entry.content);
        showToast('Kopiert.');
      } catch {
        showToast('Kopieren nicht möglich – bitte manuell markieren.', { error: true });
      }
    });
  });

  root.querySelectorAll('[data-delete-entry]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const entry = (cache || []).find((e) => e.id === btn.dataset.deleteEntry);
      if (!entry) return;
      if (!(await confirmDialog(`Eintrag "${entry.title}" wirklich löschen?`, { confirmText: 'Löschen', danger: true }))) return;
      try {
        const removed = await withStepUp(() => api.info.remove(entry.id));
        if (removed === undefined) return;
        cache = null;
        showToast('Eintrag gelöscht.');
        load();
      } catch (err) {
        showToast(err.message, { error: true });
      }
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
// refresh. "Eintrag anlegen" has a stable id; a specific entry's own
// copy/edit/delete action is keyed by the data attribute it carries instead,
// since individual entry rows have no id of their own.
function focusedBodySelector(body) {
  const active = document.activeElement;
  if (!active || !body.contains(active)) return null;
  if (active.id) return `#${active.id}`;
  for (const attr of ['data-copy-entry', 'data-edit-entry', 'data-delete-entry']) {
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
  const { el } = openModal('Info', bodyHtml(), {
    onClose: () => {
      openDialog = null;
    },
    onMount: (backdrop) => {
      backdrop.classList.add('info-board-modal');
      wireBody(backdrop.querySelector('.modal-body'));
    },
  });
  openDialog = { el, focusEntryId };
  if (focusEntryId) focusEntry(el, focusEntryId);
}
