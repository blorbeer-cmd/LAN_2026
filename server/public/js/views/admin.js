// Admin panel: unlock admin mode (PIN or freely in open mode), then the
// moderation tools — bulk-create test players to try features solo, grant/
// revoke admin, and delete players. Deliberately minimal (the base of #33/#34);
// most features stay open to everyone in the LAN trust model, this is just the
// extra role for testing and moderation.

import { api } from '../api.js';
import { state } from '../state.js';
import { escapeHtml } from '../format.js';
import { showToast } from '../toast.js';
import { isAdmin, getAdminPin, setAdmin } from '../admin.js';
import { icon } from '../icons.js';

const TEST_COLORS = ['#4f9dff', '#ef5da8', '#22c55e', '#f59e0b', '#9163f5', '#06b6d4', '#f43f5e', '#84cc16'];

// Whether the server requires a PIN — fetched once so the unlock screen knows
// whether to prompt for one or just offer a button.
let pinRequired = null;

async function loadStatus(ctx) {
  try {
    const res = await api.admin.status();
    pinRequired = res.pinRequired;
  } catch {
    pinRequired = true; // safest assumption if we can't tell
  }
  ctx.rerender();
}

async function bulkCreate(count, ctx) {
  let created = 0;
  for (let i = 0; i < count; i++) {
    const color = TEST_COLORS[(state.players.length + i) % TEST_COLORS.length];
    // Suffix keeps names unique across repeated runs (server enforces unique
    // names); a short random tail avoids clashing with an earlier batch.
    const name = `Test ${state.players.length + i + 1}-${Math.random().toString(36).slice(2, 5)}`;
    try {
      await api.players.create({ name, color });
      created++;
    } catch {
      // skip a clash, keep going
    }
  }
  showToast(`${created} Test-Spieler angelegt.`);
  await ctx.refresh();
}

async function toggleAdmin(player, ctx) {
  try {
    await api.players.update(player.id, { isAdmin: !player.is_admin });
    showToast(player.is_admin ? `${player.name} ist kein Admin mehr.` : `${player.name} ist jetzt Admin.`);
    await ctx.refresh();
  } catch (err) {
    showToast(err.message, { error: true });
  }
}

async function deletePlayer(player, ctx) {
  if (!confirm(`Spieler "${player.name}" wirklich löschen?`)) return;
  try {
    await api.players.remove(player.id);
    showToast('Spieler gelöscht.');
    await ctx.refresh();
  } catch (err) {
    showToast(err.message, { error: true });
  }
}

function renderUnlock(container, ctx) {
  if (pinRequired === null) {
    loadStatus(ctx);
    container.innerHTML = `<div class="empty-state">Lädt…</div>`;
    return;
  }

  container.innerHTML = `
    <button type="button" class="btn btn-sm" data-navigate="more">‹ Zurück</button>
    <h1 class="view-title">${icon('shield')} Admin</h1>
    <div class="card stack">
      <p class="muted">${
        pinRequired
          ? 'Gib den Admin-PIN ein, um Test-Spieler anzulegen und zu moderieren.'
          : 'Kein PIN gesetzt (offener Modus) – Admin-Modus kann direkt aktiviert werden.'
      }</p>
      ${pinRequired ? `<input type="password" id="admin-pin" inputmode="numeric" placeholder="Admin-PIN" autofocus />` : ''}
      <button type="button" class="btn btn-primary btn-block" id="admin-unlock">Admin-Modus aktivieren</button>
    </div>
  `;

  container.querySelector('#admin-unlock').addEventListener('click', async () => {
    const pin = pinRequired ? container.querySelector('#admin-pin').value.trim() : '';
    try {
      await api.admin.unlock(pin);
      setAdmin(true, pin);
      showToast('Admin-Modus aktiv.');
      ctx.rerender();
    } catch (err) {
      showToast(err.message, { error: true });
    }
  });
}

function renderPanel(container, ctx) {
  const players = state.players || [];
  const rows = players
    .map(
      (p) => `
      <div class="row-between" style="padding:8px 0;border-bottom:1px solid var(--border);">
        <span class="row" style="gap:8px;">
          <span class="avatar-dot" style="background:${escapeHtml(p.color)};"></span>
          <span class="player-name">${escapeHtml(p.name)}</span>
          ${p.is_admin ? '<span class="badge badge-playing">Admin</span>' : ''}
        </span>
        <span class="row" style="gap:6px;">
          <button type="button" class="btn btn-sm" data-toggle-admin="${p.id}">${p.is_admin ? 'Admin entziehen' : 'Admin machen'}</button>
          <button type="button" class="btn btn-sm btn-danger" data-delete-player="${p.id}">Löschen</button>
        </span>
      </div>`
    )
    .join('');

  container.innerHTML = `
    <button type="button" class="btn btn-sm" data-navigate="more">‹ Zurück</button>
    <div class="row-between">
      <h1 class="view-title">${icon('shield')} Admin</h1>
      <button type="button" class="btn btn-sm" id="admin-leave">Modus verlassen</button>
    </div>

    <div class="section-title">Test-Spieler anlegen</div>
    <div class="card row" style="gap:8px;">
      <input type="number" id="admin-count" value="5" min="1" max="20" style="max-width:90px;" />
      <button type="button" class="btn btn-primary" id="admin-bulk" style="flex:1;">Test-Spieler anlegen</button>
    </div>

    <div class="section-title">Spieler (${players.length})</div>
    <div class="card">${rows || '<span class="muted">Noch keine Spieler.</span>'}</div>
  `;

  container.querySelector('#admin-leave').addEventListener('click', () => {
    setAdmin(false);
    showToast('Admin-Modus verlassen.');
    ctx.rerender();
  });

  container.querySelector('#admin-bulk').addEventListener('click', () => {
    const count = Math.min(20, Math.max(1, parseInt(container.querySelector('#admin-count').value, 10) || 5));
    bulkCreate(count, ctx);
  });

  container.querySelectorAll('[data-toggle-admin]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const player = (state.players || []).find((p) => p.id === btn.dataset.toggleAdmin);
      if (player) toggleAdmin(player, ctx);
    });
  });

  container.querySelectorAll('[data-delete-player]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const player = (state.players || []).find((p) => p.id === btn.dataset.deletePlayer);
      if (player) deletePlayer(player, ctx);
    });
  });
}

export function renderAdmin(container, ctx) {
  if (isAdmin()) renderPanel(container, ctx);
  else renderUnlock(container, ctx);
}
