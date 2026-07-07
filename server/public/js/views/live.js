// Live-status board (FR-13): who's currently playing what, updated in
// realtime. This is the home view — the thing people check most often.

import { api } from '../api.js';
import { state } from '../state.js';
import { escapeHtml, formatSince, stateLabel, avatarHtml, gameBadgeHtml } from '../format.js';
import { getMyId, setMyId } from '../whoami.js';
import { showToast } from '../toast.js';

const STATE_RANK = { playing: 0, paused: 1, offline: 2 };

// Groups currently-playing players by game (FR-27): a quick glance at who's
// in the same game right now, complementing the per-player list below.
function renderActiveGroups(players) {
  const byGame = new Map();
  for (const p of players) {
    if (p.state !== 'playing') continue;
    for (const g of p.games) {
      const entry = byGame.get(g.game_id) ?? { id: g.game_id, name: g.game_name, icon: g.game_icon, players: [] };
      entry.players.push(p.name);
      byGame.set(g.game_id, entry);
    }
  }
  if (byGame.size === 0) return '';

  const groups = [...byGame.values()]
    .sort((a, b) => b.players.length - a.players.length)
    .map(
      (g) => `
      <div class="chip">${gameBadgeHtml(g, 20)} <strong>${escapeHtml(g.name)}</strong>: ${g.players.map(escapeHtml).join(', ')}</div>`
    )
    .join('');

  return `
    <div class="section-title">Gerade aktiv</div>
    <div class="stack" style="gap:6px;margin-bottom:16px;">${groups}</div>
  `;
}

export function renderLive(container, ctx) {
  const players = [...state.live].sort((a, b) => {
    const rankDiff = STATE_RANK[a.state] - STATE_RANK[b.state];
    if (rankDiff !== 0) return rankDiff;
    return a.name.localeCompare(b.name, 'de');
  });

  if (players.length === 0) {
    container.innerHTML = `
      <h1 class="view-title">Live-Status</h1>
      <div class="empty-state">
        <span class="emoji">👋</span>
        Noch keine Spieler angelegt.<br />Leg welche im Tab „Spieler" an.
      </div>`;
    return;
  }

  const myId = getMyId();
  const whoAmI = `
    <div class="card row" style="margin-bottom:16px;">
      <span style="flex:1;">Wer bist du?</span>
      <select id="live-whoami">
        <option value="">– wählen –</option>
        ${state.players.map((p) => `<option value="${p.id}" ${p.id === myId ? 'selected' : ''}>${escapeHtml(p.name)}</option>`).join('')}
      </select>
    </div>
  `;

  const cards = players
    .map((p) => {
      const badgeClass = `badge-${p.state}`;
      const games = p.games
        .map(
          (g) =>
            `<span class="chip">${gameBadgeHtml({ id: g.game_id, icon: g.game_icon }, 20)} ${escapeHtml(g.game_name)} · ${formatSince(g.since)}</span>`
        )
        .join('');

      const noteLine =
        p.state === 'paused' && p.manual_note
          ? `<div class="muted" style="margin-top:4px;font-size:0.85rem;">${escapeHtml(p.manual_note)}</div>`
          : '';

      const isMe = p.player_id === myId;
      const pauseToggle = isMe
        ? `<button type="button" class="btn btn-sm" data-toggle-pause="${p.player_id}" data-paused="${p.state === 'paused' ? '1' : '0'}" style="margin-top:8px;">
            ${p.state === 'paused' ? '▶️ Bin wieder da' : '⏸️ Pause / Essen'}
          </button>`
        : '';

      return `
        <div class="card player-card">
          ${avatarHtml(p, 36)}
          <div class="player-card-main">
            <div class="row-between">
              <span class="player-name">${escapeHtml(p.name)}${isMe ? ' <span class=\"muted\">(du)</span>' : ''}</span>
              <span class="badge ${badgeClass}">${stateLabel(p.state)}</span>
            </div>
            ${games ? `<div class="player-card-games chip-list">${games}</div>` : ''}
            ${noteLine}
            ${pauseToggle}
          </div>
        </div>`;
    })
    .join('');

  container.innerHTML = `
    <h1 class="view-title">Live-Status</h1>
    ${whoAmI}
    ${renderActiveGroups(players)}
    <div class="stack">${cards}</div>
  `;

  container.querySelector('#live-whoami').addEventListener('change', (e) => {
    setMyId(e.target.value);
    ctx.rerender();
  });

  container.querySelectorAll('[data-toggle-pause]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const isPaused = btn.dataset.paused === '1';
      try {
        await api.live.setNote(btn.dataset.togglePause, isPaused ? null : 'Pause / Essen');
        await ctx.refresh();
      } catch (err) {
        showToast(err.message, { error: true });
      }
    });
  });
}
