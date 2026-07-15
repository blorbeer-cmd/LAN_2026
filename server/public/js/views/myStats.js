// "Meine Statistiken": split out of the Profile view (which had grown into
// an "everything" page mixing one-time setup — identity, agent, push,
// skills, seat neighbors — with an open-ended stats dashboard people would
// come back to browse repeatedly). Reached via a button on Profil.

import { api } from '../api.js';
import { state } from '../state.js';
import { escapeHtml, formatDateTime } from '../format.js';
import { getMyId } from '../whoami.js';
import { showToast } from '../toast.js';
import { icon } from '../icons.js';

let statsCache = null;
let statsLoading = false;
let statsForPlayerId = null;
let statsEventId = '';

// Called from profile.js when the active identity changes ("Nicht du?"),
// so a stale stranger's stats don't flash before the fresh fetch lands.
export function invalidateMyStats() {
  statsCache = null;
  statsForPlayerId = null;
}

async function loadStats(playerId, eventId, ctx) {
  statsLoading = true;
  ctx.rerender();
  try {
    const params = eventId ? { eventId } : {};
    statsCache = await api.players.stats(playerId, params);
    statsForPlayerId = playerId;
  } catch (err) {
    showToast(err.message, { error: true });
    statsCache = null;
  } finally {
    statsLoading = false;
    ctx.rerender();
  }
}

function renderEventOptions() {
  const sorted = [...state.events].sort((a, b) => b.starts_at - a.starts_at);
  const options = sorted
    .map((e) => `<option value="${e.id}" ${e.id === statsEventId ? 'selected' : ''}>${escapeHtml(e.name)}</option>`)
    .join('');
  return `<option value="" ${statsEventId === '' ? 'selected' : ''}>Gesamt (alle Events)</option>${options}`;
}

function renderStats() {
  if (statsLoading || !statsCache) {
    return `<div class="empty-state" style="padding:var(--space-4);">Lädt…</div>`;
  }
  const s = statsCache;

  const activeHint =
    s.activePercent !== null
      ? `<div class="muted" style="font-size:var(--font-size-xs);">davon aktiv gespielt: ${escapeHtml(s.activeFormatted)} (${s.activePercent}%)</div>`
      : '';

  const kpis = `
    <div class="grid" style="grid-template-columns:repeat(auto-fit, minmax(140px, 1fr));">
      <div class="card">
        <div class="muted" style="font-size:var(--font-size-xs);">Gesamtspielzeit</div>
        <div class="lb-points">${escapeHtml(s.formatted)}</div>
        ${activeHint}
      </div>
      <div class="card">
        <div class="muted" style="font-size:var(--font-size-xs);">Sessions</div>
        <div class="lb-points">${s.sessionCount}</div>
      </div>
      <div class="card">
        <div class="muted" style="font-size:var(--font-size-xs);">Verschiedene Spiele</div>
        <div class="lb-points">${s.distinctGamesCount}</div>
      </div>
      <div class="card">
        <div class="muted" style="font-size:var(--font-size-xs);">Mehrere Spiele gleichzeitig</div>
        <div class="lb-points">${escapeHtml(s.simultaneous.multiGameFormatted)}</div>
        ${s.simultaneous.maxSimultaneous > 0 ? `<div class="muted" style="font-size:var(--font-size-xs);">max. ${s.simultaneous.maxSimultaneous} gleichzeitig</div>` : ''}
      </div>
    </div>
  `;

  const awardsHtml = s.awards.length
    ? `<div class="grid" style="grid-template-columns:repeat(auto-fit, minmax(160px, 1fr));">
        ${s.awards
          .map(
            (a) => `
          <div class="card">
            <div class="row-between">
              <span style="font-size:var(--font-size-xl);">${escapeHtml(a.emoji)}</span>
              <span class="lb-points">${escapeHtml(a.value)}</span>
            </div>
            <div class="player-name">${escapeHtml(a.title)}</div>
            <div class="muted" style="font-size:var(--font-size-xs);">${escapeHtml(a.description)}</div>
          </div>`
          )
          .join('')}
      </div>`
    : `<div class="empty-state" style="padding:var(--space-4);"><span class="empty-state-icon">${icon('award')}</span>Noch keine eigenen Awards.</div>`;

  const gamesHtml = s.games.length
    ? s.games
        .map(
          (g) => `
        <div class="lb-row">
          <span>${escapeHtml(g.gameIcon)}</span>
          <span style="flex:1;">
            ${escapeHtml(g.gameName)}
            ${g.activeMs > 0 && g.activeMs < g.totalMs ? `<div class="muted" style="font-size:var(--font-size-xs);">davon aktiv: ${escapeHtml(g.activeFormatted)}</div>` : ''}
          </span>
          <span class="lb-points">${escapeHtml(g.formatted)}</span>
        </div>`
        )
        .join('')
    : `<div class="empty-state" style="padding:var(--space-4);">Noch keine Spielzeit erfasst.</div>`;

  const eventsHtml = s.events.length
    ? s.events
        .map(
          (e) => `
        <div class="lb-row">
          <span style="flex:1;">${escapeHtml(e.eventName)}</span>
          <span class="lb-points">${escapeHtml(e.formatted)}</span>
        </div>`
        )
        .join('')
    : `<div class="empty-state" style="padding:var(--space-4);">Noch keine Events mit Spielzeit.</div>`;

  const longestHtml = s.longestSessions.length
    ? s.longestSessions
        .map(
          (l) => `
        <div class="lb-row">
          <span style="flex:1;">
            ${escapeHtml(l.gameIcon)} ${escapeHtml(l.gameName)}
            <div class="muted" style="font-size:var(--font-size-xs);">${formatDateTime(l.startedAt)} – ${l.endedAt ? formatDateTime(l.endedAt) : 'läuft noch'}</div>
          </span>
          <span class="lb-points">${escapeHtml(l.formatted)}</span>
        </div>`
        )
        .join('')
    : `<div class="empty-state" style="padding:var(--space-4);">Noch keine Sessions.</div>`;

  return `
    <div class="card stack">
      <select id="my-stats-event">${renderEventOptions()}</select>
    </div>
    ${kpis}

    <div class="section-title">Meine Erfolge</div>
    ${awardsHtml}

    <div class="section-title">Spielzeit pro Spiel</div>
    <div class="card">${gamesHtml}</div>

    <div class="section-title">Spielzeit pro Event</div>
    <div class="card">${eventsHtml}</div>

    <div class="section-title">Meine längsten Sessions</div>
    <div class="card">${longestHtml}</div>
  `;
}

export function renderMyStats(container, ctx) {
  const myId = getMyId();
  const me = state.players.find((p) => p.id === myId);
  if (!me) {
    container.innerHTML = `
      <button type="button" class="btn btn-sm" data-navigate="profile">‹ Zurück zum Profil</button>
      <div class="empty-state" style="margin-top:var(--space-4);"><span class="empty-state-icon">${icon('user')}</span>Bitte erst dein Profil einrichten.</div>
    `;
    return;
  }

  if (statsForPlayerId !== myId && !statsLoading) {
    loadStats(myId, statsEventId, ctx);
  }

  container.innerHTML = `
    <button type="button" class="btn btn-sm" data-navigate="profile">‹ Zurück zum Profil</button>
    <h1 class="view-title">Meine Statistiken</h1>
    ${renderStats()}
  `;

  const eventSelect = container.querySelector('#my-stats-event');
  if (eventSelect) {
    eventSelect.addEventListener('change', (e) => {
      statsEventId = e.target.value;
      statsForPlayerId = null;
      ctx.rerender();
    });
  }
}
