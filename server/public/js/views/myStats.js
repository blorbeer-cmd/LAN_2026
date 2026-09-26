// "Meine Statistiken": split out of the Profile view (which had grown into
// an "everything" page mixing one-time setup — identity, agent, push,
// skills, seat neighbors — with an open-ended stats dashboard people would
// come back to browse repeatedly). Reached via a button on Profil.

import { api } from '../api.js';
import { accessibleEvents, state } from '../state.js';
import { escapeHtml } from '../format.js';
import { icon } from '../icons.js';
import { rankedListHtml } from '../rankedList.js';
import { getMyId } from '../whoami.js';
import { showToast } from '../toast.js';
import { emptyStateHtml } from '../emptyState.js';
import { eventSelectOptions } from '../eventStatus.js';
import { searchSelectHtml, wireSearchSelect } from '../searchSelect.js';

let statsCache = null;
let statsLoading = false;
let statsForPlayerId = null;
let statsEventId = '';
// Every section starts collapsed; its open state survives re-renders.
const sectionOpen = { awards: false, games: false, events: false, longest: false };

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
  return eventSelectOptions(accessibleEvents(), { allEntryLabel: 'Alle Events' });
}

function dayOf(timestamp) {
  return new Date(timestamp).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' });
}

function timeOf(timestamp) {
  return new Date(timestamp).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
}

// "29.07., 04:10 bis 10:21": the date appears once when a session stays on
// one day, and UI copy joins the range with "bis" instead of a dash.
export function sessionSpanText(startedAt, endedAt) {
  const start = `${dayOf(startedAt)}, ${timeOf(startedAt)}`;
  if (!endedAt) return `${start} bis jetzt`;
  return dayOf(startedAt) === dayOf(endedAt)
    ? `${start} bis ${timeOf(endedAt)}`
    : `${start} bis ${dayOf(endedAt)}, ${timeOf(endedAt)}`;
}

// A section with content is a collapsible card with its row count; an empty
// one collapses to the shared one-row empty card instead.
function statSection(key, title, items, emptyText, { ranked = false } = {}) {
  if (items.length === 0) {
    return `
      <section class="card stack grouped-page-section" aria-label="${title}">
        <div class="grouped-page-section-title"><h2>${title}</h2></div>
        ${emptyStateHtml(emptyText, { className: 'empty-state-compact' })}
      </section>`;
  }
  return `
    <details class="card grouped-page-section collapsible-section" data-my-stats-section="${key}" ${sectionOpen[key] ? 'open' : ''}>
      <summary class="collapsible-section-header">
        <h2>${title}</h2>
        <span class="collapsible-section-summary-end">
          <span class="badge badge-offline">${items.length}</span>
          <span class="collapsible-section-chevron">${icon('chevronRight')}</span>
        </span>
      </summary>
      <div class="collapsible-section-content">${rankedListHtml(items, { ranked, label: title })}</div>
    </details>`;
}

function kpi(value, label) {
  return `
    <div class="my-stats-kpi">
      <span class="my-stats-kpi-value">${value}</span>
      <span class="my-stats-kpi-label">${label}</span>
    </div>`;
}

function renderStats() {
  if (statsLoading || !statsCache) {
    return emptyStateHtml('Lädt', { className: 'empty-state-compact' });
  }
  const s = statsCache;
  // Two accounts see different totals, because each aggregate covers only
  // the events its own account took part in. With "Alle Events" selected the
  // number of those events is shown as its own figure, so the difference does
  // not look like a bug (docs/KONZEPT-EVENT-SICHTBARKEIT.md, Abschnitt 4.4).
  const eventCount = statsEventId === '' ? (s.eventIds?.length ?? 0) : null;

  const overview = `
    <section class="card stack grouped-page-section" aria-label="Überblick">
      <div class="my-stats-kpis">
        ${kpi(escapeHtml(s.formatted), s.activePercent !== null ? `Spielzeit · ${s.activePercent} % aktiv` : 'Spielzeit')}
        ${eventCount === null ? '' : kpi(eventCount, 'Events')}
        ${kpi(s.sessionCount, 'Sessions')}
        ${kpi(s.distinctGamesCount, 'Spiele')}
        ${kpi(escapeHtml(s.simultaneous.multiGameFormatted), s.simultaneous.maxSimultaneous > 1 ? `Parallel · max. ${s.simultaneous.maxSimultaneous}` : 'Parallel')}
      </div>
    </section>`;

  const awards = s.awards.map((a) => ({ title: escapeHtml(a.title), meta: escapeHtml(a.description), value: escapeHtml(a.value), sortKey: a.title }));
  const games = s.games.map((g) => ({
    title: escapeHtml(g.gameName),
    meta: g.activeMs > 0 && g.activeMs < g.totalMs ? `davon aktiv ${escapeHtml(g.activeFormatted)}` : '',
    value: escapeHtml(g.formatted),
  }));
  // Numbered like the other rankings, so events are ordered by play time
  // rather than the API's newest-first order.
  const events = [...s.events]
    .sort((a, b) => b.totalMs - a.totalMs)
    .map((e) => ({ title: escapeHtml(e.eventName), value: escapeHtml(e.formatted) }));
  const longest = s.longestSessions.map((l) => ({
    title: escapeHtml(l.gameName),
    meta: escapeHtml(sessionSpanText(l.startedAt, l.endedAt)),
    value: escapeHtml(l.formatted),
  }));

  return `
    <div class="grouped-page-sections">
      ${overview}
      ${statSection('awards', 'Erfolge', awards, 'Noch keine Erfolge')}
      ${statSection('games', 'Spielzeit pro Spiel', games, 'Noch keine Spielzeit', { ranked: true })}
      ${statSection('events', 'Spielzeit pro Event', events, 'Noch keine Events', { ranked: true })}
      ${statSection('longest', 'Längste Sessions', longest, 'Noch keine Sessions', { ranked: true })}
    </div>
  `;
}

function subpageHeaderHtml(filter = '') {
  return `
    <div class="more-subpage-header">
      <div class="more-subpage-title-row my-stats-title-row">
        <h1 class="view-title">Meine Statistiken</h1>
        ${filter ? `<div class="my-stats-filter">${filter}</div>` : ''}
      </div>
    </div>`;
}

export function renderMyStats(container, ctx) {
  const myId = getMyId();
  const me = state.players.find((p) => p.id === myId);
  if (!me) {
    container.innerHTML = `
      ${subpageHeaderHtml()}
      ${emptyStateHtml('Bitte erst dein Profil einrichten', { style: 'margin-top:var(--space-4);' })}
    `;
    return;
  }

  if (statsForPlayerId !== myId && !statsLoading) {
    loadStats(myId, statsEventId, ctx);
  }

  const filter = searchSelectHtml('my-stats-event', eventFilterOptions(), statsEventId, {
    placeholder: 'Event suchen',
    ariaLabel: 'Event',
    label: 'Auswertbare Events',
  });
  container.innerHTML = `
    ${subpageHeaderHtml(filter)}
    ${renderStats()}
  `;

  container.querySelectorAll('[data-my-stats-section]').forEach((section) => {
    section.addEventListener('toggle', () => {
      sectionOpen[section.dataset.myStatsSection] = section.open;
    });
  });

  wireSearchSelect(container, 'my-stats-event', eventFilterOptions(), {
    emptyText: 'Kein passendes Event gefunden',
    onChange: (eventId) => {
      statsEventId = eventId;
      statsForPlayerId = null;
      ctx.rerender();
    },
  });
}
