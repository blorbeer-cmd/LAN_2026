// Info-Board view: the pinned answers to the questions everyone asks five
// times per evening — WLAN password, Discord link, game-server IPs, house
// rules. Anyone can add/edit/delete entries (LAN trust model); values get a
// one-tap copy button since most of them exist to be pasted somewhere.

import { api } from '../api.js';
import { escapeHtml } from '../format.js';
import { openModal } from '../modal.js';
import { showToast } from '../toast.js';

let cache = null;
let loading = false;

async function load(ctx) {
  loading = true;
  try {
    const res = await api.info.list();
    cache = res.entries;
  } catch (err) {
    showToast(err.message, { error: true });
    cache = [];
  } finally {
    loading = false;
    ctx.rerender();
  }
}

// Called from app.js on every info:changed socket event.
export function invalidateInfoBoard() {
  cache = null;
}

// Turns bare URLs into clickable links — applied AFTER escapeHtml, so the
// matched text is already entity-escaped and safe to wrap in an anchor.
function linkify(escaped) {
  return escaped.replace(
    /(https?:\/\/[^\s<]+)/g,
    (url) => `<a href="${url}" target="_blank" rel="noopener" style="color:var(--accent);word-break:break-all;">${url}</a>`
  );
}

function openEntryForm(ctx, existing) {
  const isEdit = Boolean(existing);
  const { close } = openModal(
    isEdit ? 'Eintrag bearbeiten' : 'Neuer Eintrag',
    `
      <form id="info-form" class="stack">
        <input type="text" id="info-title" maxlength="80" required autofocus placeholder="z.B. WLAN" value="${escapeHtml(existing?.title ?? '')}" />
        <textarea id="info-content" maxlength="1000" rows="4" required placeholder="z.B. Netz: LAN2026 / Passwort: …">${escapeHtml(existing?.content ?? '')}</textarea>
        <button type="submit" class="btn btn-primary btn-block">${isEdit ? 'Speichern' : 'Anlegen'}</button>
      </form>
    `,
    {
      onMount: (el) => {
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
            ctx.rerender();
          } catch (err) {
            showToast(err.message, { error: true });
          }
        });
      },
    }
  );
}

export function renderInfoBoard(container, ctx) {
  if (cache === null && !loading) load(ctx);

  const entries =
    loading || cache === null
      ? `<div class="empty-state">Lädt…</div>`
      : cache.length === 0
        ? `<div class="empty-state"><span class="emoji">📌</span>Noch keine Einträge.<br />
           <span class="muted" style="font-size:var(--font-size-sm);">Gut aufgehoben hier: WLAN-Passwort, Discord-Link, Server-IPs, Hausregeln.</span></div>`
        : `<div class="card-grid">${cache
            .map(
              (e) => `
            <div class="card stack" style="gap:var(--space-2);">
              <div class="row-between">
                <strong>${escapeHtml(e.title)}</strong>
                <span class="row" style="gap:var(--space-1);">
                  <button type="button" class="icon-btn" data-copy-entry="${e.id}" title="Inhalt kopieren" aria-label="Inhalt kopieren">📋</button>
                  <button type="button" class="icon-btn" data-edit-entry="${e.id}" title="Bearbeiten" aria-label="Bearbeiten">✏️</button>
                  <button type="button" class="icon-btn" data-delete-entry="${e.id}" title="Löschen" aria-label="Löschen">🗑️</button>
                </span>
              </div>
              <div style="white-space:pre-wrap;word-break:break-word;font-size:var(--font-size-md);">${linkify(escapeHtml(e.content))}</div>
            </div>`
            )
            .join('')}</div>`;

  container.innerHTML = `
    <button type="button" class="btn btn-sm" data-navigate="more">‹ Zurück</button>
    <div class="row-between">
      <h1 class="view-title">📌 Info-Board</h1>
      <button type="button" class="btn btn-primary btn-sm" id="info-new-btn">+ Eintrag</button>
    </div>
    ${entries}
  `;

  container.querySelector('#info-new-btn').addEventListener('click', () => openEntryForm(ctx, null));

  container.querySelectorAll('[data-edit-entry]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const entry = (cache || []).find((e) => e.id === btn.dataset.editEntry);
      if (entry) openEntryForm(ctx, entry);
    });
  });

  container.querySelectorAll('[data-copy-entry]').forEach((btn) => {
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

  container.querySelectorAll('[data-delete-entry]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const entry = (cache || []).find((e) => e.id === btn.dataset.deleteEntry);
      if (!entry) return;
      if (!confirm(`Eintrag "${entry.title}" wirklich löschen?`)) return;
      try {
        await api.info.remove(entry.id);
        cache = null;
        showToast('Eintrag gelöscht.');
        ctx.rerender();
      } catch (err) {
        showToast(err.message, { error: true });
      }
    });
  });
}
