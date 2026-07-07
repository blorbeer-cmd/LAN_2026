// Live-status board (FR-13): who's currently playing what, updated in
// realtime. This is the home view — the thing people check most often.

import { state } from '../state.js';
import { escapeHtml, formatSince, stateLabel } from '../format.js';

const STATE_RANK = { playing: 0, paused: 1, offline: 2 };

export function renderLive(container, _ctx) {
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

  const cards = players
    .map((p) => {
      const badgeClass = `badge-${p.state}`;
      const games = p.games
        .map(
          (g) =>
            `<span class="chip">${escapeHtml(g.game_icon)} ${escapeHtml(g.game_name)} · ${formatSince(g.since)}</span>`
        )
        .join('');

      const noteLine =
        p.state === 'paused' && p.manual_note
          ? `<div class="muted" style="margin-top:4px;font-size:0.85rem;">${escapeHtml(p.manual_note)}</div>`
          : '';

      return `
        <div class="card player-card">
          <span class="avatar-dot" style="background:${escapeHtml(p.color)}"></span>
          <div class="player-card-main">
            <div class="row-between">
              <span class="player-name">${escapeHtml(p.name)}</span>
              <span class="badge ${badgeClass}">${stateLabel(p.state)}</span>
            </div>
            ${games ? `<div class="player-card-games chip-list">${games}</div>` : ''}
            ${noteLine}
          </div>
        </div>`;
    })
    .join('');

  container.innerHTML = `
    <h1 class="view-title">Live-Status</h1>
    <div class="stack">${cards}</div>
  `;
}
