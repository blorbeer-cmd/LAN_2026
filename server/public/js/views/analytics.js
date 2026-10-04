// Statistiken: one page answering "how did the LAN go" for the selected
// event. A row of key figures opens it; every list below (play time, games,
// awards, results, tournaments, draws, arcade, trivia, the raw session log)
// is a collapsible card that starts collapsed, so the page needs no sub-tabs.
// Arcade results aren't tied to an event id, so their query derives the
// selected event's date bounds internally.
//
// Data is fetched for all lists at once and cached in this module (not the
// shared `state`, since it's filtered by this view's event selection).

import { api } from '../api.js';
import { accessibleEvents, state } from '../state.js';
import { escapeHtml, formatDateTime, avatarHtml } from '../format.js';
import { rankedListHtml, sharedRankNumbers } from '../rankedList.js';
import { showToast } from '../toast.js';
import { icon } from '../icons.js';
import { emptyStateHtml } from '../emptyState.js';
import { eventSelectOptions } from '../eventStatus.js';
import { searchSelectHtml, wireSearchSelect } from '../searchSelect.js';

let cache = null;
let loading = false;

function defaultFilters() {
  // eventId: 'active' resolves to the currently active event on first
  // render; '' means "Alle Events".
  return { eventId: 'active' };
}
let filters = defaultFilters();

// All data is filtered by this view's own event selection, so all of it
// belongs to the event that was active when it was fetched. Switching the
// workspace has to drop the numbers *and* the selection: the selected event
// may not even be readable from the new workspace, and re-resolving the
// 'active' sentinel is what re-points the view at the new event.
export function invalidateAnalytics() {
  cache = null;
  loading = false;
  filters = defaultFilters();
}

// Resolves the 'active' sentinel to a real event id once the events list is
// available, so the view opens pre-filtered to the current LAN by default.
// state.activeEvent is the account's persisted workspace; the per-event
// payload carries no "is this the active one" flag of its own.
function resolveEventSelection() {
  if (filters.eventId !== 'active') return;
  const activeId = state.activeEvent?.id ?? null;
  filters.eventId = activeId && accessibleEvents().some((e) => e.id === activeId) ? activeId : '';
}

// Arcade results do not carry an event id, so translate the selected event
// into its date bounds before querying the shared endpoint.
function selectedEventRange() {
  const ev = accessibleEvents().find((e) => e.id === filters.eventId);
  if (ev) return { from: ev.startsAt, to: ev.endsAt ?? Date.now() };
  return null;
}

const EMPTY_MATCHES = {
  matches: { total: 0, byGame: [] },
  tournaments: { total: 0, completed: 0, active: 0, byFormat: [], byGame: [] },
  draws: { total: 0, byGame: [], seatConflictRatePercent: null },
  fun: { biggestRivalry: null, bestDuo: null, biggestUnderdogWin: null },
};
const EMPTY_ARCADE = {
  totals: { matches: 0, players: 0, totalDurationFormatted: '0s', avgDurationFormatted: '0s' },
  games: [],
  timeline: [],
};

// Each request falls back on its own, so one failing dataset leaves the
// other lists usable; the first error is reported once.
async function loadData(ctx) {
  loading = true;
  ctx.rerender();
  resolveEventSelection();
  const params = filters.eventId ? { eventId: filters.eventId } : {};
  const arcadeParams = {};
  const eventRange = selectedEventRange();
  if (eventRange) {
    arcadeParams.from = String(eventRange.from);
    arcadeParams.to = String(eventRange.to);
  }
  let firstError = null;
  const settle = (promise, fallback) =>
    promise.catch((err) => {
      firstError ??= err;
      return fallback;
    });
  const [overview, sessions, awards, popularGames, playtime, matches, arcade] = await Promise.all([
    settle(api.analytics.overview(params), null),
    settle(api.analytics.sessions(params), []),
    settle(api.analytics.awards(params), { awards: [] }),
    settle(api.analytics.games(params), { games: [] }),
    settle(api.stats.playtime(undefined, params), { totals: [] }),
    settle(api.analytics.gamesTournaments(params), EMPTY_MATCHES),
    settle(api.analytics.arcade(arcadeParams), EMPTY_ARCADE),
  ]);
  if (firstError) showToast(firstError.message, { error: true });
  cache = { overview, sessions, awards, popularGames, playtime, matches, arcade };
  loading = false;
  ctx.rerender();
}

// The list spans finished LANs as well as the running one. Each option is the
// event's title plus its state as an icon — the same shape every other event
// dropdown uses.
function eventFilterOptions() {
  return eventSelectOptions(accessibleEvents(), { allEntryLabel: 'Alle Events' });
}

// Every list section starts collapsed; its open state survives re-renders
// and filter changes, the same way "Meine Statistiken" keeps its sections.
const sectionOpen = {};

// A filled section is a collapsible card with its row count; an empty one
// collapses to the shared one-row empty card (design rule 8).
function listSection(key, title, items, emptyText, { ranked = false } = {}) {
  if (items.length === 0) {
    return `
      <section class="card stack grouped-page-section" aria-label="${escapeHtml(title)}">
        <div class="grouped-page-section-title"><h2>${escapeHtml(title)}</h2></div>
        ${emptyStateHtml(emptyText, { className: 'empty-state-compact' })}
      </section>`;
  }
  return `
    <details class="card grouped-page-section collapsible-section" data-analytics-section="${key}" ${sectionOpen[key] ? 'open' : ''}>
      <summary class="collapsible-section-header">
        <span class="collapsible-section-chevron">${icon('chevronRight')}</span>
        <h2>${escapeHtml(title)}</h2>
        <span class="collapsible-section-summary-end">
          <span class="badge badge-offline">${items.length}</span>
        </span>
      </summary>
      <div class="collapsible-section-content">${rankedListHtml(items, { ranked, label: title })}</div>
    </details>`;
}

// Count lists ("5×") are rankings: highest first, equal counts share a place.
function rankedByCount(items) {
  const sorted = [...items].sort((a, b) => b.count - a.count);
  const ranks = sharedRankNumbers(sorted.map((item) => item.count));
  return sorted.map(({ count, ...item }, i) => ({ ...item, rank: ranks[i], value: `${count}×` }));
}

function formatTotalMs(ms) {
  const minutes = Math.round(ms / 60000);
  const hours = Math.floor(minutes / 60);
  return hours > 0 ? `${hours}h ${minutes % 60}m` : `${minutes}m`;
}

function playerLead(id, color) {
  return avatarHtml(state.players.find((p) => p.id === id) || { color }, 28);
}

// The page's first card: the event filter in full width below its title,
// like the pickers in Rangliste and Hall of Fame, then the totals as one row
// of figures, the same overview "Meine Statistiken" opens with.
function overviewCard(filterHtml) {
  const figures = [];
  if (cache) {
    const totalMs = (cache.playtime?.totals || []).reduce((sum, p) => sum + (p.totalMs || 0), 0);
    figures.push(
      [escapeHtml(formatTotalMs(totalMs)), 'Spielzeit'],
      [(cache.sessions || []).length, 'Sessions'],
      [cache.matches.matches.total, 'Matches'],
      [cache.matches.tournaments.total, 'Turniere'],
      [cache.matches.draws.total, 'Auslosungen'],
      [cache.arcade.totals.matches, 'Arcade'],
    );
  }
  return `
    <section class="card stack grouped-page-section" aria-labelledby="analytics-overview-title">
      <div class="grouped-page-section-title"><h2 id="analytics-overview-title">Überblick</h2></div>
      ${filterHtml}
      ${figures.length
        ? `<div class="my-stats-kpis">
            ${figures.map(([value, text]) => `
              <div class="my-stats-kpi">
                <span class="my-stats-kpi-value">${value}</span>
                <span class="my-stats-kpi-label">${text}</span>
              </div>`).join('')}
          </div>`
        : emptyStateHtml('Lädt', { className: 'empty-state-compact' })}
    </section>`;
}

export function renderAnalytics(container, ctx) {
  resolveEventSelection();
  if (cache === null && !loading) loadData(ctx);

  const filterHtml = searchSelectHtml('an-event', eventFilterOptions(), filters.eventId, {
    placeholder: 'Event suchen',
    ariaLabel: 'Event',
    label: 'Auswertbare Events',
  });
  container.innerHTML = `
    <div class="grouped-page-sections">
      ${overviewCard(filterHtml)}
      ${cache && !loading ? renderSections() : ''}
    </div>
  `;

  container.querySelectorAll('[data-analytics-section]').forEach((section) => {
    section.addEventListener('toggle', () => {
      sectionOpen[section.dataset.analyticsSection] = section.open;
    });
  });

  wireSearchSelect(container, 'an-event', eventFilterOptions(), {
    emptyText: 'Kein passendes Event gefunden',
    onChange: (eventId) => {
      filters.eventId = eventId; // '' selects "Alle Events"
      cache = null;
      ctx.rerender();
    },
  });
}

function renderSections() {
  const { overview, sessions, awards, popularGames, playtime, matches, arcade } = cache;

  // Per-player play time, already ordered by the API.
  const playtimeItems = (playtime?.totals || []).map((p) => ({
    lead: playerLead(p.playerId, p.playerColor),
    title: escapeHtml(p.playerName),
    meta: p.activeMs > 0 && p.activeMs < p.totalMs ? `davon aktiv ${escapeHtml(p.activeFormatted || '0m')}` : '',
    value: escapeHtml(p.formatted),
  }));

  // The API already orders by total play time.
  const popularItems = (popularGames?.games || []).map((g) => ({
    title: escapeHtml(g.gameName),
    meta: `${g.playerCount} Spieler · ${g.sessionCount} ${g.sessionCount === 1 ? 'Session' : 'Sessions'}`,
    value: escapeHtml(g.totalFormatted),
  }));

  const longestItems = [...(overview?.longestSessionsPerGame || [])]
    .sort((a, b) => b.durationMs - a.durationMs)
    .map((r) => ({
      lead: playerLead(r.playerId, r.playerColor),
      title: escapeHtml(r.gameName),
      meta: escapeHtml(r.playerName),
      value: escapeHtml(r.formatted),
    }));

  const awardItems = (awards?.awards || []).map((a) => ({
    lead: playerLead(a.playerId, a.playerColor),
    title: escapeHtml(a.title),
    sortKey: a.title,
    meta: `${escapeHtml(a.playerName)} · ${escapeHtml(a.description)}`,
    value: escapeHtml(a.value),
  }));

  const matchItems = rankedByCount(
    matches.matches.byGame.map((g) => ({
      count: g.count,
      title: escapeHtml(g.gameName),
      meta: `${g.decided} entschieden${g.undecided ? ` · ${g.undecided} ohne Sieger` : ''}`,
    })),
  );
  const tournamentItems = rankedByCount(
    matches.tournaments.byGame.map((g) => ({ count: g.count, title: escapeHtml(g.gameName) })),
  );
  const drawItems = rankedByCount(matches.draws.byGame.map((g) => ({ count: g.count, title: escapeHtml(g.gameName) })));

  const arcadeItems = rankedByCount(
    arcade.games.map((g) => ({
      count: g.matches,
      title: escapeHtml(g.title),
      meta: [
        `${g.uniquePlayers} Spieler`,
        `⌀ ${escapeHtml(g.avgDurationFormatted)}`,
        `längstes ${escapeHtml(g.longestDurationFormatted)}`,
        g.mostActive ? `aktivster ${escapeHtml(g.mostActive.name)} (${g.mostActive.matches}×)` : '',
      ].filter(Boolean).join(' · '),
    })),
  );

  const fun = matches.fun;
  const trivia = [];
  if (fun.biggestRivalry) {
    const r = fun.biggestRivalry;
    trivia.push({
      title: 'Größte Rivalität',
      meta: `${escapeHtml(r.playerA.name)} gegen ${escapeHtml(r.playerB.name)}`,
      value: `${r.count}×`,
    });
  }
  if (fun.bestDuo) {
    const d = fun.bestDuo;
    const winRate = d.gamesTogether > 0 ? Math.round((d.winsTogether / d.gamesTogether) * 100) : 0;
    trivia.push({
      title: 'Bestes Duo',
      meta: `${escapeHtml(d.playerA.name)} und ${escapeHtml(d.playerB.name)} · ${d.winsTogether} von ${d.gamesTogether} gewonnen`,
      value: `${winRate} %`,
    });
  }
  if (fun.biggestUnderdogWin) {
    const u = fun.biggestUnderdogWin;
    trivia.push({
      title: 'Krasseste Überraschung',
      meta: `${escapeHtml(u.gameName)} · ${u.winners.map((w) => escapeHtml(w.name)).join(', ')}`,
      value: `${u.winnerAvgRating} vs ${u.loserAvgRating}`,
    });
  }
  if (matches.draws.seatConflictRatePercent !== null) {
    trivia.push({
      title: 'Sitznachbarn als Gegner',
      meta: 'Anteil der Auslosungen',
      value: `${matches.draws.seatConflictRatePercent} %`,
    });
  }

  // A log is no ranking, so it is a value list. Its sort key inverts the
  // start time, so the alphabetical order of the list is newest first.
  const sessionItems = (sessions || []).slice(0, 100).map((s) => ({
    lead: playerLead(s.playerId, s.playerColor),
    title: `${escapeHtml(s.playerName)} · ${escapeHtml(s.gameName)}`,
    sortKey: String(Number.MAX_SAFE_INTEGER - s.startedAt).padStart(16, '0'),
    meta: `${formatDateTime(s.startedAt)} bis ${s.endedAt ? formatDateTime(s.endedAt) : 'jetzt'}`,
    value: escapeHtml(s.formatted),
  }));

  return `
    ${listSection('playtime', 'Spielzeit pro Spieler', playtimeItems, 'Noch keine Spielzeit', { ranked: true })}
    ${listSection('popular', 'Beliebteste Spiele', popularItems, 'Noch keine Sessions', { ranked: true })}
    ${listSection('longest', 'Längste Session pro Spiel', longestItems, 'Noch keine Sessions', { ranked: true })}
    ${listSection('awards', 'Awards', awardItems, 'Noch keine Awards')}
    ${listSection('matchGames', 'Ergebnisse pro Spiel', matchItems, 'Noch keine Ergebnisse', { ranked: true })}
    ${listSection('tournamentGames', 'Turniere pro Spiel', tournamentItems, 'Noch keine Turniere', { ranked: true })}
    ${listSection('draws', 'Team-Auslosungen', drawItems, 'Noch keine Auslosungen', { ranked: true })}
    ${listSection('arcadeGames', 'Arcade pro Spiel', arcadeItems, 'Noch keine Arcade-Matches', { ranked: true })}
    ${listSection('trivia', 'Trivia', trivia, 'Noch nicht genug Ergebnisse')}
    ${listSection('sessions', 'Session-Protokoll', sessionItems, 'Noch keine Sessions')}
  `;
}
