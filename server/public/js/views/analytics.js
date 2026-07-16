// Auswertungen view: three tabs — "Spielzeit" and "Matches & Turniere" share
// one event/date filter (awards, longest sessions, a collapsed raw session
// log; recorded results, tournament
// counts, team-auslosen history, a few "witzige" head-to-head records).
// "Arcade" has its own date range (arcade_results isn't tied to a single
// event) and covers the arcade mini-games specifically: match durations and
// the most-active player per game — on top of
// the win/loss leaderboard already shown on the Arcade view's own stats tab.
// Reached via the "Mehr" hub, not the main bottom nav — this is for browsing
// after the fact, not something needed mid-game. Playtime/Matches used to be
// two separate views; merged since both answer
// "how did the LAN go", just from different angles (see server/CLAUDE.md
// games reorg) — one entry in the Mehr hub instead of two, and switching
// angles no longer means re-picking the event/date range from scratch.
//
// Data is fetched lazily per tab and cached in this module (not the shared
// `state`, since it's filtered by its own date range independent of the
// rest of the app) — loadPlaytimeData()/loadMatchesData()/loadArcadeData()
// fetch, then trigger a re-render.

import { api } from '../api.js';
import { state } from '../state.js';
import { escapeHtml, formatDateTime, avatarHtml, gameBadgeHtml } from '../format.js';
import { showToast } from '../toast.js';
import { dateTimeFieldHtml, wireDateTimeField } from '../dateTimeField.js';
import { icon } from '../icons.js';
import { infoTooltipHtml, wireInfoTooltips } from '../infoTooltip.js';

const EVENT_FILTER_HELP = 'Zeigt nur Daten des gewählten Events.';
const EVENT_RANGE_HELP = 'Zeigt das gewählte Event; der Zeitraum grenzt es optional weiter ein.';
const ARCADE_RANGE_HELP = 'Grenzt Arcade-Ergebnisse auf den gewählten Zeitraum ein.';

let activeTab = 'playtime'; // 'playtime' | 'matches' | 'arcade'

let cache = null; // playtime tab
let loading = false;
let matchesCache = null; // matches/tournaments tab
let matchesLoading = false;
let arcadeCache = null; // arcade tab
let arcadeLoading = false;

function defaultFilters() {
  // eventId: 'active' resolves to the currently active event on first
  // render; '' means "Gesamt, alle Events". from/to are an OPTIONAL extra
  // narrowing on top of whichever event is selected (e.g. "just Saturday
  // night of this LAN"), only meaningful for the Spielzeit tab — Matches &
  // Turniere always queries the whole selected event.
  return { eventId: 'active', from: null, to: null };
}
let filters = defaultFilters();
let arcadeRange = { from: null, to: null };

// Resolves the 'active' sentinel to a real event id once the events list is
// available, so the view opens pre-filtered to the current LAN by default.
function resolveEventSelection() {
  if (filters.eventId !== 'active') return;
  const active = state.events.find((e) => e.isActive);
  if (active) filters.eventId = active.id;
}

// The event's own date range, used only to pre-fill the manual date/time
// inputs with something sensible — the actual query scopes by eventId
// directly (exact), not by this range, unless the user applies a narrower one.
function selectedEventRange() {
  const ev = state.events.find((e) => e.id === filters.eventId);
  if (ev) return { from: ev.starts_at, to: ev.ends_at ?? Date.now() };
  const to = Date.now();
  return { from: to - 3 * 24 * 60 * 60 * 1000, to };
}

async function loadPlaytimeData(ctx) {
  loading = true;
  ctx.rerender();
  try {
    resolveEventSelection();
    const params = {};
    if (filters.eventId) params.eventId = filters.eventId;
    if (filters.from && filters.to) {
      params.from = String(filters.from);
      params.to = String(filters.to);
    }

    const [overview, sessions, awards, popularGames] = await Promise.all([
      api.analytics.overview(params),
      api.analytics.sessions(params),
      api.analytics.awards(params),
      api.analytics.games(params),
    ]);
    cache = { overview, sessions, awards, popularGames };
  } catch (err) {
    showToast(err.message, { error: true });
    cache = { overview: null, sessions: [], awards: { awards: [] }, popularGames: { games: [] } };
  } finally {
    loading = false;
    ctx.rerender();
  }
}

const FORMAT_LABELS = {
  single_elimination: 'K.O.-Turnier',
  round_robin: 'Liga',
  group_knockout: 'Gruppenphase + K.O.',
};

async function loadMatchesData(ctx) {
  matchesLoading = true;
  ctx.rerender();
  try {
    resolveEventSelection();
    const params = filters.eventId ? { eventId: filters.eventId } : {};
    matchesCache = await api.analytics.gamesTournaments(params);
  } catch (err) {
    showToast(err.message, { error: true });
    matchesCache = {
      matches: { total: 0, byGame: [] },
      tournaments: { total: 0, completed: 0, active: 0, byFormat: [], byGame: [] },
      draws: { total: 0, byGame: [], seatConflictRatePercent: null },
      fun: { biggestRivalry: null, bestDuo: null, biggestUnderdogWin: null },
    };
  } finally {
    matchesLoading = false;
    ctx.rerender();
  }
}

// Arcade results have no event id, so their separate date range filters the
// stored timestamps directly instead of pretending they belong to an event.
async function loadArcadeData(ctx) {
  arcadeLoading = true;
  ctx.rerender();
  try {
    const params = {};
    if (arcadeRange.from && arcadeRange.to) {
      params.from = String(arcadeRange.from);
      params.to = String(arcadeRange.to);
    }
    arcadeCache = await api.analytics.arcade(params);
  } catch (err) {
    showToast(err.message, { error: true });
    arcadeCache = { totals: { matches: 0, players: 0, totalDurationFormatted: '0s', avgDurationFormatted: '0s' }, games: [], timeline: [] };
  } finally {
    arcadeLoading = false;
    ctx.rerender();
  }
}

function renderEventOptions() {
  const sorted = [...state.events].sort((a, b) => b.starts_at - a.starts_at);
  const options = sorted
    .map((e) => {
      const range = `${new Date(e.starts_at).toLocaleDateString('de-DE')}${e.ends_at ? '–' + new Date(e.ends_at).toLocaleDateString('de-DE') : ' (läuft)'}`;
      return `<option value="${e.id}" ${e.id === filters.eventId ? 'selected' : ''}>${escapeHtml(e.name)} (${range})</option>`;
    })
    .join('');
  return `<option value="" ${filters.eventId === '' ? 'selected' : ''}>Gesamt (alle Events)</option>${options}`;
}

export function renderAnalytics(container, ctx) {
  resolveEventSelection();
  if (activeTab === 'arcade' && (!arcadeRange.from || !arcadeRange.to)) {
    arcadeRange = selectedEventRange();
  }
  if (activeTab === 'playtime' && cache === null && !loading) {
    loadPlaytimeData(ctx);
  }
  if (activeTab === 'matches' && matchesCache === null && !matchesLoading) {
    loadMatchesData(ctx);
  }
  if (activeTab === 'arcade' && arcadeCache === null && !arcadeLoading) {
    loadArcadeData(ctx);
  }
  const displayRange = filters.from && filters.to ? { from: filters.from, to: filters.to } : selectedEventRange();

  container.innerHTML = `
    <button type="button" class="btn btn-sm" data-navigate="more">${icon('chevronLeft')} Zurück</button>
    <h1 class="view-title">Auswertungen</h1>
    <div class="grouped-page-sections">
      <section class="card stack grouped-page-section" aria-labelledby="analytics-controls-title">
        <div class="grouped-page-section-title"><h2 id="analytics-controls-title">Ansicht & Zeitraum</h2></div>
        <div class="tabs" style="display:flex;gap:var(--space-2);flex-wrap:wrap;">
          <button type="button" class="btn btn-sm ${activeTab === 'playtime' ? 'btn-primary' : ''}" data-an-tab="playtime">Spielzeit</button>
          <button type="button" class="btn btn-sm ${activeTab === 'matches' ? 'btn-primary' : ''}" data-an-tab="matches">Matches & Turniere</button>
          <button type="button" class="btn btn-sm ${activeTab === 'arcade' ? 'btn-primary' : ''}" data-an-tab="arcade">Arcade</button>
        </div>
        ${
          activeTab === 'arcade'
            ? `<div class="title-with-info analytics-filter-label">
                 <span class="field-label">Zeitraum</span>
                 ${infoTooltipHtml('analytics-arcade-range-help', 'Arcade-Zeitraum', ARCADE_RANGE_HELP)}
               </div>
               <div class="field-row">
                 <div>${dateTimeFieldHtml('an-arcade-from', arcadeRange.from)}</div>
                 <div>${dateTimeFieldHtml('an-arcade-to', arcadeRange.to)}</div>
               </div>
               <button type="button" class="btn btn-primary btn-block" id="an-arcade-apply">Zeitraum anwenden</button>`
            : `<div class="title-with-info analytics-filter-label">
                 <span class="field-label">Event${activeTab === 'playtime' ? ' & Zeitraum' : ''}</span>
                 ${infoTooltipHtml(
                   activeTab === 'playtime' ? 'analytics-event-range-help' : 'analytics-event-help',
                   activeTab === 'playtime' ? 'Event und Zeitraum' : 'Event',
                   activeTab === 'playtime' ? EVENT_RANGE_HELP : EVENT_FILTER_HELP
                 )}
               </div>
               <select id="an-event">${renderEventOptions()}</select>
               ${
                 activeTab === 'playtime'
                   ? `<div class="field-row">
                        <div>${dateTimeFieldHtml('an-from', displayRange.from, { clearable: true })}</div>
                        <div>${dateTimeFieldHtml('an-to', displayRange.to, { clearable: true })}</div>
                      </div>
                      <button type="button" class="btn btn-primary btn-block" id="an-apply">Zeitraum zusätzlich eingrenzen</button>`
                   : ''
               }`
        }
      </section>
      <div id="an-content" class="grouped-page-sections">${renderActiveTabContent()}</div>
    </div>
  `;

  if (activeTab === 'playtime') {
    wireDateTimeField(container, 'an-from');
    wireDateTimeField(container, 'an-to');
    container.querySelector('#an-apply').addEventListener('click', () => {
      const fromVal = container.querySelector('#an-from').value;
      const toVal = container.querySelector('#an-to').value;
      filters.from = fromVal ? new Date(fromVal).getTime() : null;
      filters.to = toVal ? new Date(toVal).getTime() : null;
      cache = null;
      ctx.rerender();
    });
  }
  if (activeTab === 'arcade') {
    wireDateTimeField(container, 'an-arcade-from');
    wireDateTimeField(container, 'an-arcade-to');
    container.querySelector('#an-arcade-apply').addEventListener('click', () => {
      arcadeRange.from = new Date(container.querySelector('#an-arcade-from').value).getTime();
      arcadeRange.to = new Date(container.querySelector('#an-arcade-to').value).getTime();
      arcadeCache = null;
      ctx.rerender();
    });
  }
  wireInfoTooltips(container);

  container.querySelectorAll('[data-an-tab]').forEach((btn) => {
    btn.addEventListener('click', () => {
      activeTab = btn.dataset.anTab;
      ctx.rerender();
    });
  });

  const eventSelect = container.querySelector('#an-event');
  if (eventSelect) {
    eventSelect.addEventListener('change', (e) => {
      filters.eventId = e.target.value; // '' selects "Gesamt (alle Events)"
      filters.from = null;
      filters.to = null;
      cache = null;
      matchesCache = null;
      ctx.rerender();
    });
  }

}

function renderActiveTabContent() {
  if (activeTab === 'matches') {
    return matchesLoading || !matchesCache ? `<div class="empty-state">Lädt…</div>` : renderMatchesContent();
  }
  if (activeTab === 'arcade') {
    return arcadeLoading || !arcadeCache ? `<div class="empty-state">Lädt…</div>` : renderArcadeContent();
  }
  return loading || !cache ? `<div class="empty-state">Lädt…</div>` : renderPlaytimeContent();
}

function renderArcadeContent() {
  const totals = arcadeCache.totals;
  const games = arcadeCache.games;

  const gameRows = games.length
    ? games
        .map(
          (g, i) => `
        <div class="lb-row ${i === 0 ? 'rank-1' : ''}">
          <span class="lb-rank">${i + 1}</span>
          <span style="flex:1;">
            ${escapeHtml(g.title)}
            <div class="muted" style="font-size:var(--font-size-xs);">
              ${g.uniquePlayers} Spieler · ⌀ ${escapeHtml(g.avgDurationFormatted)} · längstes Match ${escapeHtml(g.longestDurationFormatted)}
              ${g.mostActive ? ` · aktivster Spieler: ${escapeHtml(g.mostActive.name)} (${g.mostActive.matches}×)` : ''}
            </div>
          </span>
          <span class="lb-points">${g.matches}×</span>
        </div>`
        )
        .join('')
    : `<div class="empty-state" style="padding:var(--space-4);">Noch keine abgeschlossenen Arcade-Matches.</div>`;

  return `
    <section class="card stack grouped-page-section" aria-labelledby="analytics-arcade-total-title">
      <div class="grouped-page-section-title"><h2 id="analytics-arcade-total-title">Arcade insgesamt</h2></div>
      <div>
        <div class="lb-row"><span style="flex:1;">Matches</span><span class="lb-points">${totals.matches}</span></div>
        <div class="lb-row"><span style="flex:1;">Beteiligte Spieler</span><span class="lb-points">${totals.players}</span></div>
        <div class="lb-row"><span style="flex:1;">Ø Matchdauer</span><span class="lb-points">${escapeHtml(totals.avgDurationFormatted)}</span></div>
        <div class="lb-row"><span style="flex:1;">Gesamte Matchzeit</span><span class="lb-points">${escapeHtml(totals.totalDurationFormatted)}</span></div>
      </div>
    </section>
    <section class="card stack grouped-page-section" aria-labelledby="analytics-arcade-games-title">
      <div class="grouped-page-section-title"><h2 id="analytics-arcade-games-title">Pro Spiel</h2></div>
      ${gameRows}
    </section>
  `;
}

function renderPlaytimeContent() {
  const awards = cache.awards?.awards || [];
  const overview = cache.overview || {
    longestSessionsPerGame: [],
  };
  const sessions = cache.sessions || [];
  const popularGames = cache.popularGames?.games || [];

  const popularGamesHtml = popularGames.length
    ? popularGames
        .map(
          (g, i) => `
        <div class="lb-row ${i === 0 ? 'rank-1' : ''}">
          <span class="lb-rank">${i + 1}</span>
          ${gameBadgeHtml({ id: g.gameId, icon: g.gameIcon }, 24)}
          <span style="flex:1;">
            ${escapeHtml(g.gameName)}
            <div class="muted" style="font-size:var(--font-size-xs);">${g.playerCount} Spieler · ${g.sessionCount} Session(s)</div>
          </span>
          <span class="lb-points">${escapeHtml(g.totalFormatted)}</span>
        </div>`
        )
        .join('')
    : `<div class="empty-state" style="padding:var(--space-4);">Keine Sessions in diesem Zeitraum.</div>`;

  const awardsHtml = awards.length
    ? awards
        .map(
          (a) => `
        <div class="card award-card">
          <div class="row-between">
            <span style="font-size:var(--font-size-xl);">${escapeHtml(a.emoji)}</span>
            <span class="lb-points">${escapeHtml(a.value)}</span>
          </div>
          <div class="player-name">${escapeHtml(a.title)}</div>
          <div class="muted" style="font-size:var(--font-size-xs);">${escapeHtml(a.description)}</div>
          <div class="row award-card-player">
            ${avatarHtml(state.players.find((p) => p.id === a.playerId) || { color: a.playerColor }, 20)}
            <span>${escapeHtml(a.playerName)}</span>
          </div>
        </div>`
        )
        .join('')
    : `<div class="empty-state" style="padding:var(--space-4);"><span class="empty-state-icon">${icon('award')}</span>Noch keine Awards in diesem Zeitraum.</div>`;

  const longestPerGameHtml = overview.longestSessionsPerGame.length
    ? overview.longestSessionsPerGame
        .map(
          (r) => `
        <div class="lb-row">
          ${avatarHtml(state.players.find((p) => p.id === r.playerId) || { color: r.playerColor }, 20)}
          <span class="row" style="flex:1;gap:var(--space-2);">${gameBadgeHtml({ id: r.gameId, icon: r.gameIcon }, 20)} ${escapeHtml(r.gameName)} — ${escapeHtml(r.playerName)}</span>
          <span class="lb-points">${escapeHtml(r.formatted)}</span>
        </div>`
        )
        .join('')
    : `<div class="empty-state" style="padding:var(--space-4);">Keine Sessions in diesem Zeitraum.</div>`;

  const sessionRows = sessions
    .slice(0, 100)
    .map(
      (s) => `
      <div class="lb-row">
        ${avatarHtml(state.players.find((p) => p.id === s.playerId) || { color: s.playerColor }, 20)}
        <span style="flex:1;">
          ${escapeHtml(s.playerName)} — ${gameBadgeHtml({ id: s.gameId, icon: s.gameIcon }, 18)} ${escapeHtml(s.gameName)}
          <div class="muted" style="font-size:var(--font-size-xs);">${formatDateTime(s.startedAt)} – ${s.endedAt ? formatDateTime(s.endedAt) : 'läuft noch'}</div>
        </span>
        <span class="lb-points">${escapeHtml(s.formatted)}</span>
      </div>`
    )
    .join('');

  return `
    <section class="card stack grouped-page-section" aria-labelledby="analytics-popular-games-title">
      <div class="grouped-page-section-title"><h2 id="analytics-popular-games-title">Beliebteste Spiele</h2></div>
      ${popularGamesHtml}
    </section>
    <section class="card stack grouped-page-section" aria-labelledby="analytics-awards-title">
      <div class="grouped-page-section-title"><h2 id="analytics-awards-title">Awards</h2></div>
      <div class="two-column-card-grid">${awardsHtml}</div>
    </section>
    <section class="card stack grouped-page-section" aria-labelledby="analytics-longest-title">
      <div class="grouped-page-section-title"><h2 id="analytics-longest-title">Längste individuelle Session pro Spiel</h2></div>
      ${longestPerGameHtml}
    </section>
    <details class="card history-details collapsible-section grouped-page-section">
      <summary class="collapsible-section-header">
        <h2>Session-Protokoll</h2>
        <span class="collapsible-section-summary-end">
          <span class="badge badge-offline">${sessions.length}</span>
          <span class="collapsible-section-chevron">${icon('chevronRight')}</span>
        </span>
      </summary>
      <div class="collapsible-section-content">
        ${sessionRows || `<div class="empty-state" style="padding:var(--space-4);">Keine Sessions in diesem Zeitraum.</div>`}
      </div>
    </details>
  `;
}

function playerChip(p) {
  return `${avatarHtml(state.players.find((pl) => pl.id === p.id) || { color: p.color }, 20)} ${escapeHtml(p.name)}`;
}

function renderMatchesContent() {
  const matches = matchesCache.matches;
  const tournaments = matchesCache.tournaments;
  const draws = matchesCache.draws;
  const fun = matchesCache.fun;

  const matchRows = matches.byGame.length
    ? matches.byGame
        .map(
          (g) => `
        <div class="lb-row">
          ${gameBadgeHtml({ id: g.gameId, icon: g.gameIcon }, 24)}
          <span style="flex:1;">
            ${escapeHtml(g.gameName)}
            <div class="muted" style="font-size:var(--font-size-xs);">${g.decided} entschieden${g.undecided ? ` · ${g.undecided} ohne Sieger/Unentschieden` : ''}</div>
          </span>
          <span class="lb-points">${g.count}×</span>
        </div>`
        )
        .join('')
    : `<div class="empty-state" style="padding:var(--space-4);">Noch keine Ergebnisse eingetragen.</div>`;

  const tournamentByGameRows = tournaments.byGame.length
    ? tournaments.byGame
        .map(
          (g) => `
        <div class="lb-row">
          ${gameBadgeHtml({ id: g.gameId, icon: g.gameIcon }, 24)}
          <span style="flex:1;">${escapeHtml(g.gameName)}</span>
          <span class="lb-points">${g.count}×</span>
        </div>`
        )
        .join('')
    : `<div class="empty-state" style="padding:var(--space-4);">Noch keine Turniere.</div>`;

  const formatRows = tournaments.byFormat.length
    ? tournaments.byFormat
        .map(
          (f) => `
        <div class="lb-row">
          <span style="flex:1;">${FORMAT_LABELS[f.format] || escapeHtml(f.format)}</span>
          <span class="lb-points">${f.count}×</span>
        </div>`
        )
        .join('')
    : `<div class="empty-state" style="padding:var(--space-4);">Noch keine Turnierarten.</div>`;

  const drawRows = draws.byGame.length
    ? draws.byGame
        .map(
          (g) => `
        <div class="lb-row">
          ${gameBadgeHtml({ id: g.gameId, icon: g.gameIcon }, 24)}
          <span style="flex:1;">${escapeHtml(g.gameName)}</span>
          <span class="lb-points">${g.count}×</span>
        </div>`
        )
        .join('')
    : `<div class="empty-state" style="padding:var(--space-4);">Noch keine Teams ausgelost.</div>`;

  const funCards = [];
  if (fun.biggestRivalry) {
    funCards.push(`
      <div class="card">
        <div class="row-between"><span class="inline-icon">${icon('activity')}</span><span class="lb-points">${fun.biggestRivalry.count}×</span></div>
        <div class="player-name">Größte Rivalität</div>
        <div class="muted" style="font-size:var(--font-size-xs);">Sind sich am häufigsten als Gegner begegnet.</div>
        <div class="stack" style="margin-top:var(--space-2);gap:var(--space-1);">
          <div class="row">${playerChip(fun.biggestRivalry.playerA)}</div>
          <div class="row">${playerChip(fun.biggestRivalry.playerB)}</div>
        </div>
      </div>`);
  }
  if (fun.bestDuo) {
    const winRate = fun.bestDuo.gamesTogether > 0 ? Math.round((fun.bestDuo.winsTogether / fun.bestDuo.gamesTogether) * 100) : 0;
    funCards.push(`
      <div class="card">
        <div class="row-between"><span class="inline-icon">${icon('users')}</span><span class="lb-points">${winRate}%</span></div>
        <div class="player-name">Bestes Duo</div>
        <div class="muted" style="font-size:var(--font-size-xs);">${fun.bestDuo.gamesTogether}× zusammen im Team, ${fun.bestDuo.winsTogether}× gewonnen.</div>
        <div class="stack" style="margin-top:var(--space-2);gap:var(--space-1);">
          <div class="row">${playerChip(fun.bestDuo.playerA)}</div>
          <div class="row">${playerChip(fun.bestDuo.playerB)}</div>
        </div>
      </div>`);
  }
  if (fun.biggestUnderdogWin) {
    const u = fun.biggestUnderdogWin;
    funCards.push(`
      <div class="card">
        <div class="row-between"><span class="inline-icon">${icon('sparkles')}</span><span class="lb-points">${u.winnerAvgRating} vs ${u.loserAvgRating}</span></div>
        <div class="player-name">Krasseste Überraschung</div>
        <div class="muted" style="font-size:var(--font-size-xs);">${gameBadgeHtml({ id: u.gameId, icon: u.gameIcon }, 16)} ${escapeHtml(u.gameName)} — als klarer Außenseiter gewonnen (Skill-Wertung).</div>
        <div class="stack" style="margin-top:var(--space-2);gap:var(--space-1);">
          ${u.winners.map((w) => `<div class="row">${playerChip(w)}</div>`).join('')}
        </div>
      </div>`);
  }
  const funHtml = funCards.length
    ? `<div class="grid" style="grid-template-columns:repeat(auto-fit, minmax(200px, 1fr));">${funCards.join('')}</div>`
    : `<div class="empty-state" style="padding:var(--space-4);"><span class="empty-state-icon">${icon('sparkles')}</span>Noch nicht genug Ergebnisse für witzige Rekorde.</div>`;

  return `
    <section class="card stack grouped-page-section" aria-labelledby="analytics-match-results-title">
      <div class="grouped-page-section-title">
        <h2 id="analytics-match-results-title">Ergebnisse pro Spiel</h2>
        <span class="muted">${matches.total} insgesamt</span>
      </div>
      ${matchRows}
    </section>
    <section class="card stack grouped-page-section" aria-labelledby="analytics-tournaments-title">
      <div class="grouped-page-section-title">
        <h2 id="analytics-tournaments-title">Turniere</h2>
        <span class="muted">${tournaments.total} insgesamt · ${tournaments.completed} beendet · ${tournaments.active} laufend</span>
      </div>
      <div class="analytics-tournament-breakdowns">
        <section class="card analytics-tournament-breakdown is-formats"><div class="section-title">Turnierarten</div>${formatRows}</section>
        <section class="card analytics-tournament-breakdown is-games"><div class="section-title">Turniere pro Spiel</div>${tournamentByGameRows}</section>
      </div>
    </section>
    <section class="card stack grouped-page-section" aria-labelledby="analytics-draws-title">
      <div class="grouped-page-section-title">
        <h2 id="analytics-draws-title">Team-Auslosungen</h2>
        <span class="muted">${draws.total} insgesamt${draws.seatConflictRatePercent !== null ? ` · ${draws.seatConflictRatePercent}% Sitznachbarn mussten gegeneinander` : ''}</span>
      </div>
      ${drawRows}
    </section>
    <section class="card stack grouped-page-section" aria-labelledby="analytics-fun-title">
      <div class="grouped-page-section-title"><h2 id="analytics-fun-title">Trivia</h2></div>
      ${funHtml}
    </section>
  `;
}
