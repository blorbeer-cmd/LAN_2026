// "Meine Statistiken": split out of the Profile view (which had grown into
// an "everything" page mixing one-time setup — identity, agent, push,
// skills, seat neighbors — with an open-ended stats dashboard people would
// come back to browse repeatedly). Reached via a button on Profil.

import { api } from '../api.js';
import { accessibleEvents, state } from '../state.js';
import { escapeHtml, formatDateTime } from '../format.js';
import { getMyId } from '../whoami.js';
import { showToast } from '../toast.js';
import { icon } from '../icons.js';
import { emptyStateHtml } from '../emptyState.js';
import { eventSelectOptions } from '../eventStatus.js';
import { searchSelectHtml, wireSearchSelect } from '../searchSelect.js';
import { backButtonHtml } from '../backButton.js';

let statsCache = null;
let statsLoading = false;
let statsForPlayerId = null;
let statsEventId = '';

// Clears cached personal stats before the next session-scoped fetch.
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

// Finished LANs are the point of this filter, so every option carries the
// event's title plus its state as an icon — the same option shape the topbar
// switcher, Auswertung's filter and Hall of Fame's LAN picker use.
function eventFilterOptions() {
  return eventSelectOptions(accessibleEvents(), { allEntryLabel: 'Gesamt (alle Events)' });
}

// Two accounts see different totals here, because each aggregate covers only
// the events its own account took part in. Name that basis instead of letting
// the difference look like a bug (docs/KONZEPT-EVENT-SICHTBARKEIT.md,
// Abschnitt 4.4). Only for the "Gesamt" selection — with one event picked the
// dropdown already says what the numbers cover.
//
// Exported and free of module state so the wording itself is testable: the
// singular is the normal case for every account that has not accepted a LAN
// invitation yet, so both halves of the sentence have to agree in number.
export function dataBasisText(eventIds, selectedEventId) {
  if (selectedEventId !== '') return '';
  const count = eventIds?.length ?? 0;
  if (count === 0) return '';
  return count === 1
    ? 'Aus einem Event, an dem du teilgenommen hast.'
    : `Aus deinen ${count} Events, an denen du teilgenommen hast.`;
}

function dataBasisHtml(stats) {
  const text = dataBasisText(stats.eventIds, statsEventId);
  if (!text) return '';
  return `<div class="muted" style="font-size:var(--font-size-xs);">${escapeHtml(text)}</div>`;
}

function renderStats() {
  if (statsLoading || !statsCache) {
    return emptyStateHtml('Lädt…', { style: 'padding:var(--space-4);' });
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
              <div class="player-name">${escapeHtml(a.title)}</div>
              <span class="lb-points">${escapeHtml(a.value)}</span>
            </div>
            <div class="muted" style="font-size:var(--font-size-xs);">${escapeHtml(a.description)}</div>
          </div>`
          )
          .join('')}
      </div>`
    : emptyStateHtml('Noch keine eigenen Awards.', { style: 'padding:var(--space-4);', icon: icon('award') });

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
    : emptyStateHtml('Noch keine Spielzeit erfasst.', { style: 'padding:var(--space-4);' });

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
    : emptyStateHtml('Noch keine Events mit Spielzeit.', { style: 'padding:var(--space-4);' });

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
    : emptyStateHtml('Noch keine Sessions.', { style: 'padding:var(--space-4);' });

  return `
    <div class="card stack">
      ${searchSelectHtml('my-stats-event', eventFilterOptions(), statsEventId, {
        placeholder: 'Event suchen…',
        ariaLabel: 'Veranstaltung',
        label: 'Auswertbare Events',
      })}
      ${dataBasisHtml(s)}
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
      ${backButtonHtml({ view: 'profile' })}
      ${emptyStateHtml('Bitte erst dein Profil einrichten.', { style: 'margin-top:var(--space-4);', icon: icon('user') })}
    `;
    return;
  }

  if (statsForPlayerId !== myId && !statsLoading) {
    loadStats(myId, statsEventId, ctx);
  }

  container.innerHTML = `
    ${backButtonHtml({ view: 'profile' })}
    <h1 class="view-title">Meine Statistiken</h1>
    ${renderStats()}
  `;

  wireSearchSelect(container, 'my-stats-event', eventFilterOptions(), {
    emptyText: 'Kein passendes Event gefunden.',
    onChange: (eventId) => {
      statsEventId = eventId;
      statsForPlayerId = null;
      ctx.rerender();
    },
  });
}
