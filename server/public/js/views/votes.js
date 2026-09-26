// "What's next?" voting view (FR-19..21). The personal session identifies the
// voter, so casting a vote needs no extra identity form.
//
// Layout, top to bottom:
// 1. Either "start a new round" controls (idle), or the running round as one
//    card in the same shape as an Umfrage whose interim result is hidden:
//    header with participation and the viewer's answer state, one row per
//    game, and a footer with the own progress and "Speichern".
// 2. The latest closed result as "Letzter Vote", pulled from history, as a
//    collapsed Umfrage card: the header names round and winner, the opened
//    card shows result bar, "Win" chip and voter avatars per game.
// 3. The current Top 10 by aggregate "Bock" rating, split into two compact
//    five-item columns on wider screens.
//
// While a round is open, nobody sees how votes/points are distributed across
// games yet — only the server-side final tally, once closed, may influence
// anyone (no watching a leader emerge and piling onto it). The view only
// shows: the list of games to rate, your own local draft, and how many people
// have already submitted. Once closed, everyone can see who voted how.
//
// Every regular round runs in 'points' mode: a 0-5 number scale per game, and every
// game needs a rating from 0 to 5 before the ballot can be saved. 0 is a
// deliberate "Spiele ich nicht", so each result names how many voters would
// play the game. 'single' mode (pick exactly one game) only ever gets used
// for a runoff between tied winners (see the "Stichwahl" button below).
// Either mode requires an explicit "Speichern" tap — picking a number only
// stages a local draft. A saved ballot can be changed until the round ends.

import { actionMenuHtml, wireActionMenus } from '../actionMenu.js';
import { api } from '../api.js';
import { icon } from '../icons.js';
import { state, catalogGames, eventPlayers } from '../state.js';
import { escapeHtml, formatDate, formatDateTime } from '../format.js';
import { openModal, confirmDialog } from '../modal.js';
import { showToast } from '../toast.js';
import { getMyId } from '../whoami.js';
import { matchesSelectionSearch, selectionSearchHtml, wireSelectionSearch } from '../selectionSearch.js';
import { emptyStateHtml } from '../emptyState.js';
import { isGroupAdmin } from '../groupContext.js';
import { ratingScaleHtml } from '../ratingScale.js';
import { voteBreakdownHtml, voterNamesText, voterStackHtml, WIN_CHIP } from '../voteBreakdown.js';

// Cached separately from `state` (like analytics.js does) since it's fetched
// from its own endpoint, not part of the main loadAll() round-trip.
let historyCache = null;
let historyLoading = false;
let historyStale = false;
let historyOpen = false;
let top10Open = false;
let latestVoteOpen = false;
let historyRequestVersion = 0;

async function loadHistory(ctx) {
  const requestVersion = ++historyRequestVersion;
  historyLoading = true;
  historyStale = false;
  try {
    const res = await api.votes.history();
    if (requestVersion === historyRequestVersion) historyCache = res.history;
  } catch {
    if (requestVersion === historyRequestVersion) historyCache = [];
  } finally {
    if (requestVersion === historyRequestVersion) {
      historyLoading = false;
      ctx.rerender();
    }
  }
}

// Called from app.js whenever a votes:changed event reports the round is no
// longer open, so a freshly closed round shows up next time this view opens
// instead of whatever the last fetch happened to see.
export function invalidateVoteHistory({ hard = false } = {}) {
  historyRequestVersion += 1;
  historyLoading = false;
  historyStale = true;
  if (hard) historyCache = null;
}

// Switching the active event is a harder reset than a votes:changed refresh:
// the round number, this account's submitted entries and any unsubmitted
// draft all belong to the event they were made in. invalidateVoteHistory()
// deliberately leaves the draft alone (a broadcast must never discard picks
// someone is still working on), so the event switch needs its own entry
// point rather than a stronger version of that one.
export function invalidateVoteEventScope() {
  invalidateVoteHistory({ hard: true });
  mineCache = null;
  mineCacheKey = null;
  mineLoading = false;
  draftSingleGameId = null;
  draftPoints = null;
  draftKey = null;
  voteUnratedOnly = false;
  resetVoteGameSelection();
}

// The current player's own saved ballot in the running round. Any entry
// means this identity has answered; the draft below starts from it and can
// still be changed and saved again until the round ends.
let mineCache = null; // Map<gameId, points|null>
let mineCacheKey = null; // see mineKey()
let mineLoading = false;

// A cancelled round is deleted on the server, so the next round reuses its
// number. The start time tells the two apart; without it, the cancelled
// round's own picks would be shown as this round's saved ballot.
function mineKey(votes, playerId) {
  return `${votes.round}:${votes.startedAt}:${playerId}`;
}

async function loadMine(key, playerId, ctx) {
  mineLoading = true;
  try {
    const mine = await api.votes.mine(playerId);
    mineCache = new Map(mine.entries.map((e) => [e.gameId, e.points]));
  } catch {
    mineCache = new Map();
  } finally {
    mineCacheKey = key;
    mineLoading = false;
    ctx.rerender();
  }
}

// Local, not-yet-saved picks. Tapping a game or a number only changes
// this draft; nothing reaches the server until "Speichern" is pressed.
// Reseeded from mineCache once per round/player (draftKey tracks that so a
// fresh round starts blank rather than carrying over a stale draft).
// A game missing from draftPoints is still unrated; 0 is a real rating.
let draftSingleGameId = null;
let draftPoints = null; // Map<gameId, points>
let draftKey = null; // mineKey() of the round/player the current draft belongs to
// Points-mode-only toggle: hides already-rated rows so working through a
// long game list doesn't mean scrolling past everything already done.
let voteUnratedOnly = false;

// "Neue Abstimmung" game selection. Persisted here (like matchmaking.js's
// checkedIds) rather than left in the DOM, because a votes:changed/
// games:changed socket event re-renders this whole view from scratch
// whenever anyone else interacts with voting — without this, that re-render
// would clear any manual deselection mid-edit.
// The first selection of every fresh round is the current Top 10 by Bock;
// excludedGameIds then tracks games manually unchecked from that starting
// point. Anything not listed after initialization (including a newly added
// game) defaults to selected — so a round covering every game is just the
// Top-10 starting point with "Alle markieren" applied, or every remaining
// exclusion cleared by hand.
let excludedGameIds = new Set();
let voteSelectionInitialized = false;
let voteSelectionDirty = false;
let voteGameSearchQuery = '';
let lastRenderedRoundOpen = false;

// Games are listed alphabetically everywhere on this page, so a game is
// always found at the same place while choosing or rating.
function sortVoteGames(games) {
  return [...games].sort((a, b) => a.name.localeCompare(b.name, 'de'));
}

// The start form still preselects the ten games the group most wants to play.
function gamesByPreference(games, results) {
  const preferences = new Map(results.map((result) => [result.gameId, result.avgPreference ?? -1]));
  return [...games].sort((a, b) => {
    const preferenceDiff = (preferences.get(b.id) ?? -1) - (preferences.get(a.id) ?? -1);
    if (preferenceDiff !== 0) return preferenceDiff;
    return a.name.localeCompare(b.name, 'de');
  });
}

function initializeVoteGameSelection(votes) {
  if (voteSelectionInitialized && voteSelectionDirty) return;
  const catalog = catalogGames();
  const selectedGameIds = new Set(gamesByPreference(catalog, votes.catalogResults ?? []).slice(0, 10).map((game) => game.id));
  excludedGameIds = new Set(catalog.filter((game) => !selectedGameIds.has(game.id)).map((game) => game.id));
  voteSelectionInitialized = true;
}

function resetVoteGameSelection() {
  excludedGameIds = new Set();
  voteSelectionInitialized = false;
  voteSelectionDirty = false;
}

function voteSearchVisibleGames() {
  return sortVoteGames(catalogGames()).filter((game) => matchesSelectionSearch(game.name, voteGameSearchQuery));
}

function allVisibleVoteGamesSelected() {
  const visible = voteSearchVisibleGames();
  return visible.length > 0 && visible.every((g) => !excludedGameIds.has(g.id));
}

function voteSelectToggleContent(allSelected) {
  return allSelected
    ? { iconName: 'listX', label: 'Sichtbare Spiele abwählen', tooltip: 'Sichtbare abwählen' }
    : { iconName: 'listChecks', label: 'Sichtbare Spiele markieren', tooltip: 'Sichtbare markieren' };
}

function voteSelectToggleHtml(allSelected) {
  const { iconName, label, tooltip } = voteSelectToggleContent(allSelected);
  return `<button type="button" class="icon-btn selection-toolbar-icon" id="votes-select-all" aria-label="${label}" data-tooltip="${tooltip}">${icon(iconName)}</button>`;
}

function syncVoteSelectToggle(button) {
  if (!button) return;
  const { iconName, label, tooltip } = voteSelectToggleContent(allVisibleVoteGamesSelected());
  button.setAttribute('aria-label', label);
  button.dataset.tooltip = tooltip;
  button.innerHTML = icon(iconName);
}

// The points button that was just pressed, so keyboard focus survives the
// re-render that the press triggers.
let focusAfterRender = null;

// One compact meta line per game, shared by the open round and the result:
// empty values ("0× gewonnen", "–") are left out instead of shown.
function gameMetaHtml(r) {
  return [
    r.playCount > 0 ? `zuletzt ${formatDate(r.lastPlayedAt)}` : 'noch nie gespielt',
    r.totalPlaytimeMs > 0 ? r.totalPlaytimeFormatted : null,
    r.preferenceCount ? `${icon('flame')} Ø ${r.avgPreference.toFixed(1)}` : null,
    r.voteWinCount > 0 ? `${icon('trophy')} ${r.voteWinCount}×` : null,
  ]
    .filter(Boolean)
    .join(' · ');
}

// ---------- Top 10 by aggregate "Bock" rating: always visible, read-only ----------

function topByPreference(results, n = 5) {
  return [...results]
    .sort((a, b) => {
      const diff = (b.avgPreference ?? -1) - (a.avgPreference ?? -1);
      if (diff !== 0) return diff;
      return a.gameName.localeCompare(b.gameName, 'de');
    })
    .slice(0, n);
}

function topMetaHtml(r) {
  const parts = [
    r.playCount > 0 ? `zuletzt ${formatDate(r.lastPlayedAt)}` : 'noch nie gespielt',
    r.totalPlaytimeMs > 0 ? r.totalPlaytimeFormatted : null,
    r.voteWinCount > 0 ? `${icon('trophy')} ${r.voteWinCount}×` : null,
  ].filter(Boolean);
  return parts.join(' · ');
}

function renderRankingColumns(items, rowHtml) {
  const splitAt = Math.ceil(items.length / 2);
  const secondColumn = items.slice(splitAt);
  return `
    <div class="vote-ranking-columns">
      <div class="vote-ranking-column">${items.slice(0, splitAt).map(rowHtml).join('')}</div>
      ${secondColumn.length ? `<div class="vote-ranking-column">${secondColumn.map((item, i) => rowHtml(item, i + splitAt)).join('')}</div>` : ''}
    </div>`;
}

// Reuses the leaderboard's .lb-row (icon-led, single line, rank + a value
// pinned right) — a "Bock" ranking doesn't need its own two-line stats block
// per game to be useful at a glance.
function renderTop10(results) {
  const top10 = topByPreference(results, 10);
  if (top10.length === 0) {
    return emptyStateHtml('Noch keine Spiele.', { className: 'empty-state-compact' });
  }
  const rowHtml = (r, i) => `
    <div class="lb-row ${i === 0 ? 'rank-1' : ''}">
      <span class="lb-rank">${i + 1}</span>
            <span style="flex:1;min-width:0;">
        <div class="player-name" style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escapeHtml(r.gameName)}</div>
        <div class="muted" style="font-size:var(--font-size-xs);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${topMetaHtml(r)}</div>
      </span>
      <span class="lb-points">${icon('flame')} ${r.preferenceCount ? r.avgPreference.toFixed(1) : '–'}</span>
    </div>`;
  return renderRankingColumns(top10, rowHtml);
}

// ---------- open round: stage a local draft, save explicitly ----------

const DECLINE_LABEL = 'Spiele ich nicht';

function pointsValueText(value) {
  if (value === 0) return `0 Punkte, ${DECLINE_LABEL.toLowerCase()}`;
  return `${value} ${value === 1 ? 'Punkt' : 'Punkte'}`;
}

function ballotGames(votes) {
  return [...votes.results].sort((a, b) => a.gameName.localeCompare(b.gameName, 'de'));
}

function ratedDraftCount(votes) {
  return votes.results.filter((r) => draftPoints.has(r.gameId)).length;
}

function ballotComplete(votes) {
  if (votes.mode === 'single') return Boolean(draftSingleGameId);
  return votes.results.length > 0 && ratedDraftCount(votes) === votes.results.length;
}

function draftProgressText(votes) {
  if (votes.mode === 'single') return `${draftSingleGameId ? 1 : 0} gewählt`;
  return `${ratedDraftCount(votes)} von ${votes.results.length} bewertet`;
}

function answerChipHtml(hasSubmitted) {
  return hasSubmitted
    ? `<span class="badge badge-playing event-poll-answer-chip">${icon('check')}Abgegeben</span>`
    : '<span class="badge event-poll-answer-chip is-missing">Deine Stimme fehlt</span>';
}

// Same four columns as an Umfrage row (name, result, voters, answer); while
// the round runs the result and voter columns stay empty, exactly like an
// Umfrage with a hidden interim result.
// The viewer's own Bock (0-5) for a game, or null. Vote points use the same
// scale, so it serves as orientation and as the optional prefill.
function ownBock(gameId) {
  const myId = getMyId();
  const entry = myId ? state.preferences?.find((pref) => pref.player_id === myId && pref.game_id === gameId) : null;
  return entry ? entry.rating : null;
}

// Games still unrated in the draft that the viewer already has a Bock for.
function prefillableGames(votes) {
  return votes.results.filter((r) => !draftPoints.has(r.gameId) && ownBock(r.gameId) !== null);
}

function renderOpenRow(votes, r, draftReady) {
  const bock = votes.mode === 'points' ? ownBock(r.gameId) : null;
  let control;
  if (!draftReady) {
    control = '<span class="muted vote-points-loading">Lädt…</span>';
  } else if (votes.mode === 'single') {
    const selected = draftSingleGameId === r.gameId;
    control = `
      <div class="event-poll-choice-control">
        <div class="selection-toolbar event-poll-response-toolbar">
          <button type="button" class="btn btn-sm event-poll-choice-btn${selected ? ' is-selected' : ''}" data-vote-select="${r.gameId}"
            aria-pressed="${selected}" aria-label="${escapeHtml(`${r.gameName} wählen`)}">${selected ? 'Ausgewählt' : 'Wählen'}</button>
        </div>
      </div>`;
  } else {
    // The same 0-5 number scale as an Umfrage rating; no button selected
    // means "not rated yet".
    control = ratingScaleHtml({
      selected: draftPoints.get(r.gameId),
      groupLabel: `Punkte für ${r.gameName}`,
      valueLabel: pointsValueText,
      attributes: (value) => `data-vote-points="${r.gameId}" data-points-value="${value}"`,
      hint: bock,
      hintLabel: 'dein Bock',
    });
  }
  return `
    <div class="event-poll-option" data-points-row="${r.gameId}">
      <div class="event-poll-option-info">
        <span class="event-poll-option-title-row"><strong>${escapeHtml(r.gameName)}</strong></span>
        <span class="muted event-poll-option-note">${votes.mode === 'points' ? `<span class="vote-own-bock${bock === null ? ' is-missing' : ''}">Dein Bock: ${bock ?? '–'}</span> · ` : ''}${gameMetaHtml(r)}</span>
      </div>
      <span class="event-poll-result"></span>
      <span class="event-poll-option-badges">
        <span class="event-poll-tag vote-decline-tag" data-decline-tag ${draftReady && draftPoints?.get(r.gameId) === 0 ? '' : 'hidden'}>${DECLINE_LABEL}</span>
      </span>
      ${control}
    </div>`;
}

function renderOpenRound(votes, { mineReady, hasSubmitted, totalPlayers }) {
  const isPoints = votes.mode === 'points';
  const showUnratedOnly = isPoints && voteUnratedOnly && mineReady;
  const games = ballotGames(votes).filter((r) => !showUnratedOnly || !draftPoints.has(r.gameId));
  const rows = showUnratedOnly && games.length === 0
    ? emptyStateHtml('Alle Spiele bewertet.')
    : games.map((r) => renderOpenRow(votes, r, mineReady)).join('');
  const tags = [];
  // Runoffs are titled "Stichwahl: …" already, so the tag only shows when
  // the title does not say it.
  if (!isPoints && !(votes.title ?? '').includes('Stichwahl')) tags.push('Stichwahl');
  tags.push('Zwischenstand verborgen');
  const admin = isGroupAdmin();
  const answer = mineReady ? answerChipHtml(hasSubmitted) : '';
  return `
    <section class="card vote-page-section event-poll-card vote-round-card" aria-labelledby="vote-current-title">
      <header class="event-poll-card-header">
        <div class="event-poll-card-title vote-round-heading">
          <h2 id="vote-current-title">${votes.title ? escapeHtml(votes.title) : 'Abstimmung läuft'}</h2>
          <span class="event-poll-card-meta-line">
            <span class="muted" data-vote-participation>${votes.totalVoters}/${totalPlayers} abgegeben</span>
            <span class="event-poll-answer-inline">${answer}</span>
          </span>
        </div>
        <div class="event-poll-card-side">
          <span class="event-poll-answer-side">${answer}</span>
          ${admin ? '<button type="button" class="btn btn-sm" id="votes-close">Beenden</button>' : ''}
          ${admin ? actionMenuHtml('<button type="button" class="btn btn-sm btn-danger" id="votes-cancel">Abbrechen</button>', 'Aktionen für die Abstimmung') : ''}
        </div>
      </header>
      <div class="stack event-poll-card-content">
        <section class="stack event-poll-round">
          <div class="event-poll-tags vote-round-tags">
            ${tags.map((tag) => `<span class="event-poll-tag">${tag}</span>`).join('')}
            ${isPoints && mineReady && prefillableGames(votes).length ? '<span class="vote-bock-prefill"><button type="button" class="btn btn-sm" id="votes-bock-prefill">Mit meinem Bock vorbelegen</button></span>' : ''}
          </div>
          ${votes.info ? `<p class="event-poll-note">${escapeHtml(votes.info)}</p>` : ''}
          <div class="stack event-poll-options has-answers is-compact">${rows}</div>
          <div class="event-poll-save-row event-poll-footer">
            <span class="vote-footer-progress">
              <span class="muted" data-vote-rated-progress>${mineReady ? draftProgressText(votes) : ''}</span>
              ${isPoints && mineReady ? `<button type="button" class="chip${voteUnratedOnly ? ' is-active' : ''}" id="votes-unrated-toggle" aria-pressed="${voteUnratedOnly}">Unbewertet</button>` : ''}
            </span>
            <button type="button" class="btn btn-primary btn-sm" id="votes-submit" ${mineReady && ballotComplete(votes) ? '' : 'disabled'}>Speichern</button>
          </div>
        </section>
      </div>
    </section>`;
}

// ---------- closed rounds: the ended-Umfrage shape ----------

function roundTitle(h) {
  return h.title || `Abstimmung Runde ${h.round}`;
}

function submissionCountLabel(count) {
  return `${count} abgegeben`;
}

function roundMetaText(h) {
  return [h.title, formatDateTime(h.closedAt), h.mode === 'single' && !(h.title ?? '').includes('Stichwahl') ? 'Stichwahl' : null, submissionCountLabel(h.totalVoters)]
    .filter(Boolean)
    .join(' · ');
}

function resultSummary(h, r) {
  if (h.mode === 'single') return `${r.votes} ${r.votes === 1 ? 'Stimme' : 'Stimmen'}`;
  return `${r.points} Pkt. · ${r.votes}/${h.totalVoters} spielen mit`;
}

// Everyone who picked the game, or gave it at least one point, highest first.
function supportersOf(h, gameId) {
  return (h.ballots ?? [])
    .map((ballot) => ({ ballot, entry: ballot.entries.find((entry) => entry.gameId === gameId) }))
    .filter(({ entry }) => entry && (h.mode === 'single' || entry.points > 0))
    .sort((a, b) => (b.entry.points ?? 0) - (a.entry.points ?? 0) || a.ballot.name.localeCompare(b.ballot.name, 'de'))
    .map(({ ballot }) => ({ playerId: ballot.playerId, name: ballot.name }));
}

function renderResultRows(h) {
  const maxPoints = Math.max(1, ...h.results.map((r) => r.points));
  const winners = new Set(h.winnerGameIds ?? []);
  return h.results
    .map((r) => {
      const win = winners.has(r.gameId);
      const share = h.mode === 'single' ? r.votes / Math.max(1, h.totalVoters) : r.points / maxPoints;
      const supporters = supportersOf(h, r.gameId);
      const stack = voterStackHtml({
        people: supporters,
        label: `Stimmen zu ${r.gameName} ansehen · ${h.mode === 'single' ? 'Gewählt von' : 'Spielen mit'}: ${voterNamesText(supporters)}`,
        attributes: `data-open-vote-round="${h.round}"`,
      });
      return `
        <div class="event-poll-option${win ? ' is-winner' : ''}">
          <div class="event-poll-option-info">
            <span class="event-poll-option-title-row">
              <strong>${escapeHtml(r.gameName)}</strong>
              ${win ? WIN_CHIP : ''}
            </span>
            <span class="muted event-poll-option-note">${gameMetaHtml(r)}</span>
          </div>
          <span class="event-poll-result">
            <span class="event-poll-bar" aria-hidden="true">${share > 0 ? `<span class="event-poll-bar-fill is-choice" style="width:${Math.round(share * 1000) / 10}%;"></span>` : ''}</span>
            <span class="event-poll-counts">${escapeHtml(resultSummary(h, r))}</span>
          </span>
          <span class="event-poll-option-badges">${stack}</span>
        </div>`;
    })
    .join('');
}

// ---------- current vote: the most recent closed round, straight from history ----------

function winnerNames(h) {
  return h.results.filter((r) => (h.winnerGameIds ?? []).includes(r.gameId)).map((r) => r.gameName);
}

// Collapsed like an Umfrage card: the header keeps the round, its winner and
// the actions visible; the full result opens below it.
function renderLatestVoteCard({ showRunoff }) {
  const h = historyCache?.[0];
  if (!h?.totalVoters) {
    const empty = historyCache === null ? 'Lädt…' : historyCache.length === 0 ? 'Noch keine Abstimmung.' : 'Niemand hat abgestimmt.';
    return `
      <section class="card vote-page-section stack" aria-labelledby="vote-current-result-title">
        <div class="grouped-page-section-title"><h2 id="vote-current-result-title">Letzter Vote</h2></div>
        ${emptyStateHtml(empty, { className: 'vote-empty-state empty-state-compact' })}
      </section>`;
  }
  const winners = winnerNames(h);
  return `
    <section class="card vote-page-section event-poll-card" aria-labelledby="vote-current-result-title" data-latest-vote>
      <header class="event-poll-card-header">
        <button type="button" class="event-poll-card-toggle" data-toggle-latest-vote aria-expanded="${latestVoteOpen}">
          <span class="collapsible-section-chevron" aria-hidden="true">${icon('chevronRight')}</span>
          <span class="event-poll-card-title">
            <strong id="vote-current-result-title">Letzter Vote</strong>
            <span class="event-poll-card-meta-line">
              <span class="muted">${escapeHtml(roundMetaText(h))}</span>
              ${winners.length ? `<span class="event-poll-best-result">${WIN_CHIP}<span>${escapeHtml(winners.join(', '))}</span></span>` : ''}
            </span>
          </span>
        </button>
        <div class="event-poll-card-side">
          <button type="button" class="btn btn-sm" data-open-vote-round="${h.round}">Stimmen ansehen</button>
          ${showRunoff ? '<button type="button" class="btn btn-primary btn-sm" id="votes-runoff">Stichwahl starten</button>' : ''}
        </div>
      </header>
      <div class="stack event-poll-card-content" ${latestVoteOpen ? '' : 'hidden'}>
        <section class="stack event-poll-round">
          ${h.info ? `<p class="event-poll-note">${escapeHtml(h.info)}</p>` : ''}
          <div class="stack event-poll-options">${renderResultRows(h)}</div>
        </section>
      </div>
    </section>`;
}

// ---------- history: one compact row per older round ----------

function renderHistory() {
  if (historyCache === null) {
    return emptyStateHtml('Lädt…', { className: 'vote-empty-state empty-state-compact' });
  }
  // The most recent round is already shown as "Letzter Vote" above, so
  // Historie lists only the older rounds.
  const olderRounds = historyCache.slice(1);
  if (olderRounds.length === 0) {
    return emptyStateHtml('Noch keine älteren Abstimmungen.', {
      className: 'vote-empty-state empty-state-compact',
    });
  }
  return `<div class="event-poll-history-list">${olderRounds
    .map((h) => {
      const winners = winnerNames(h);
      const meta = [roundTitle(h), formatDateTime(h.closedAt), submissionCountLabel(h.totalVoters)].join(' · ');
      return `
        <div class="event-poll-history-round">
          <span class="event-poll-history-main">
            <span class="event-poll-history-meta">${escapeHtml(meta)}</span>
            ${winners.length ? `<span class="event-poll-history-result">${WIN_CHIP}<span>${escapeHtml(winners.join(', '))}</span></span>` : '<span class="muted">Keine Stimmen</span>'}
          </span>
          <button type="button" class="btn btn-sm" data-open-vote-round="${h.round}">Stimmen ansehen</button>
        </div>`;
    })
    .join('')}</div>`;
}

// ---------- "Stimmen": who voted how in one closed round ----------

const DECLINE_CELL = `<span class="event-poll-vote-cell is-cannot" role="img" aria-label="Spielt nicht" title="Spielt nicht">${icon('x')}</span>`;

function ballotCell(h, entry) {
  if (h.mode === 'single') {
    return entry
      ? `<span class="event-poll-vote-cell is-can" role="img" aria-label="Gewählt" title="Gewählt">${icon('check')}</span>`
      : '<span class="event-poll-vote-cell is-empty" aria-hidden="true"></span>';
  }
  if (!entry) return '<span class="event-poll-vote-cell is-empty" aria-label="Nicht bewertet">–</span>';
  if (entry.points === 0) return DECLINE_CELL;
  return `<span class="event-poll-vote-cell is-rating">${entry.points}</span>`;
}

function roundBreakdownHtml(h) {
  if (!h.ballots?.length) return '<p class="muted">Für diese Runde wurden keine Stimmen abgegeben.</p>';
  const winners = new Set(h.winnerGameIds ?? []);
  const entriesByPlayer = new Map(
    h.ballots.map((ballot) => [ballot.playerId, new Map(ballot.entries.map((entry) => [entry.gameId, entry]))]),
  );
  const hasDeclines = h.mode === 'points' && h.ballots.some((ballot) => ballot.entries.some((entry) => entry.points === 0));
  const keyHtml = hasDeclines
    ? `<div class="muted event-poll-vote-key"><span><span class="event-poll-vote-cell is-cannot" aria-hidden="true">${icon('x')}</span>Spielt nicht</span></div>`
    : '';
  return `
    <div class="muted vote-result-meta">${escapeHtml(roundMetaText(h))}</div>
    ${h.info ? `<p class="event-poll-note">${escapeHtml(h.info)}</p>` : ''}
    ${voteBreakdownHtml({
      columns: h.results.map((r) => ({ label: r.gameName, win: winners.has(r.gameId), summary: resultSummary(h, r) })),
      people: h.ballots,
      keyHtml,
      cellHtml: (person, index) => ballotCell(h, entriesByPlayer.get(person.playerId)?.get(h.results[index].gameId)),
    })}`;
}

async function openRoundBreakdown(round) {
  const { el } = openModal('Lädt…', emptyStateHtml('Lädt…'));
  try {
    const detail = await api.votes.historyRound(round);
    const titleEl = el.querySelector('.modal-header h2');
    if (titleEl) titleEl.textContent = `Stimmen · ${roundTitle(detail)}`;
    const bodyEl = el.querySelector('.modal-body');
    if (bodyEl) bodyEl.innerHTML = `<div class="stack">${roundBreakdownHtml(detail)}</div>`;
  } catch (err) {
    const bodyEl = el.querySelector('.modal-body');
    if (bodyEl) bodyEl.innerHTML = emptyStateHtml(err.message);
  }
}

export function renderVotes(container, ctx) {

  const votes = state.votes;
  if (!votes) {
    container.innerHTML = `<h1 class="view-title">Vote</h1>${emptyStateHtml('Lädt…')}`;
    return;
  }

  if (!votes.open && lastRenderedRoundOpen) resetVoteGameSelection();
  lastRenderedRoundOpen = votes.open;

  if ((historyCache === null || historyStale) && !historyLoading) {
    loadHistory(ctx);
  }

  const myId = getMyId();
  const currentMineKey = votes.open && myId ? mineKey(votes, myId) : null;
  if (currentMineKey && mineCacheKey !== currentMineKey && !mineLoading) {
    loadMine(currentMineKey, myId, ctx);
  }
  const mineReady = Boolean(currentMineKey && mineCacheKey === currentMineKey && mineCache);
  const hasSubmitted = Boolean(mineReady && mineCache.size > 0);

  if (mineReady && draftKey !== mineCacheKey) {
    draftSingleGameId = votes.mode === 'single' ? [...mineCache.keys()][0] ?? null : null;
    draftPoints = new Map([...mineCache].filter(([, points]) => typeof points === 'number'));
    draftKey = mineCacheKey;
  }

  // Eligible voters are the active event's accepted participants, not every
  // group member — an invited-but-not-yet-accepted person must not inflate
  // the "X/Y" denominator (see eventPlayers()).
  const totalPlayers = eventPlayers().length;

  let openSectionHtml = '';
  if (votes.open) {
    openSectionHtml = renderOpenRound(votes, { mineReady, hasSubmitted, totalPlayers });
  } else {
    initializeVoteGameSelection(votes);
    const gameCheckboxes = sortVoteGames(catalogGames())
      .map(
        (g) => `
        <label class="check-row" data-vote-game-search-item data-selection-search="${escapeHtml(g.name)}">
          <input type="checkbox" data-vote-game-checkbox value="${g.id}" ${excludedGameIds.has(g.id) ? '' : 'checked'} />
          <span class="row" style="flex:1;gap:var(--space-2);">${escapeHtml(g.name)}</span>
        </label>`
      )
      .join('');
    openSectionHtml = `
      <section class="card vote-page-section vote-workflow-section stack" aria-labelledby="vote-start-title">
        <div class="grouped-page-section-title">
          <h2 id="vote-start-title">Neue Abstimmung</h2>
          <button type="button" class="btn btn-primary btn-sm" id="votes-start">Starten</button>
        </div>
        <div class="vote-start-row">
          <div>
            <label class="field-label" for="votes-title">Titel</label>
            <input type="text" id="votes-title" maxlength="80" placeholder="Samstagabend" />
          </div>
          <div>
            <label class="field-label" for="votes-info">Info</label>
            <textarea class="vote-info-input" id="votes-info" maxlength="500" rows="1" placeholder="Nur Spiele für 4 Leute"></textarea>
          </div>
          <div class="selection-toolbar vote-start-toolbar">
            ${voteSelectToggleHtml(allVisibleVoteGamesSelected())}
            ${selectionSearchHtml('votes-game-search', voteGameSearchQuery, { placeholder: 'Spiel suchen', label: 'Spiel suchen' })}
          </div>
        </div>
        <div id="votes-game-select-wrap" class="stack vote-game-select-wrap">
          <div id="votes-game-select" class="vote-game-grid">${gameCheckboxes}</div>
          <p class="muted" data-vote-game-search-empty role="status" style="font-size:var(--font-size-xs);" hidden>Keine passenden Spiele gefunden.</p>
        </div>
      </section>`;
  }

  // Title/Info are typed before the round exists, so they live only in the
  // DOM — and this view re-renders on its own whenever a background fetch
  // (history, own submissions) resolves or a realtime event arrives. Carry
  // both across that re-render, same survives-its-own-rerender pattern the
  // Checkliste's add-item field uses; without it a round could be started
  // with an empty title just because a fetch landed mid-typing.
  const previousDraft = {
    title: container.querySelector('#votes-title')?.value ?? '',
    info: container.querySelector('#votes-info')?.value ?? '',
    focusedId: document.activeElement?.closest?.('#votes-title, #votes-info')?.id ?? null,
  };

  // A tie in the most recent round offers the runoff right in that card's
  // header, like every other primary action on this page.
  const latestRound = historyCache?.[0];
  const showRunoff = !votes.open && isGroupAdmin() && Boolean(latestRound?.totalVoters) && latestRound.winnerGameIds?.length > 1;

  container.innerHTML = `
    <h1 class="view-title">Vote</h1>
    ${openSectionHtml}

    ${renderLatestVoteCard({ showRunoff })}

    <details class="card history-details collapsible-section vote-page-section" data-vote-top10 ${top10Open ? 'open' : ''}>
      <summary class="collapsible-section-header">
        <h2>Top 10 nach Bock-Level</h2>
        <span class="collapsible-section-summary-end">
          <span class="collapsible-section-chevron">${icon('chevronRight')}</span>
        </span>
      </summary>
      <div class="collapsible-section-content">${renderTop10(votes.catalogResults)}</div>
    </details>

    <details class="card history-details collapsible-section" data-vote-history ${historyOpen ? 'open' : ''}>
      <summary class="collapsible-section-header">
        <h2>Historie</h2>
        <span class="collapsible-section-summary-end">
          <span class="badge badge-offline">${Math.max(0, (historyCache?.length ?? 0) - 1)}</span>
          <span class="collapsible-section-chevron">${icon('chevronRight')}</span>
        </span>
      </summary>
      <div class="collapsible-section-content">${renderHistory()}</div>
    </details>
  `;

  wireActionMenus(container);

  for (const [id, value] of [['votes-title', previousDraft.title], ['votes-info', previousDraft.info]]) {
    if (!value) continue;
    const field = container.querySelector(`#${id}`);
    if (field) field.value = value;
  }
  if (previousDraft.focusedId) container.querySelector(`#${previousDraft.focusedId}`)?.focus();

  container.querySelector('[data-vote-history]')?.addEventListener('toggle', (event) => {
    historyOpen = event.currentTarget.open;
  });
  container.querySelector('[data-vote-top10]')?.addEventListener('toggle', (event) => {
    top10Open = event.currentTarget.open;
  });
  container.querySelector('[data-toggle-latest-vote]')?.addEventListener('click', () => {
    latestVoteOpen = !latestVoteOpen;
    ctx.rerender();
  });

  container.querySelectorAll('[data-vote-select]').forEach((btn) => {
    btn.addEventListener('click', () => {
      draftSingleGameId = btn.dataset.voteSelect;
      ctx.rerender();
    });
  });

  container.querySelector('#votes-unrated-toggle')?.addEventListener('click', () => {
    voteUnratedOnly = !voteUnratedOnly;
    ctx.rerender();
  });

  // Like an Umfrage rating: pressing the chosen number again clears it.
  // Fills only the games still unrated in the draft; nothing is saved until
  // "Speichern", and choices already made stay untouched.
  container.querySelector('#votes-bock-prefill')?.addEventListener('click', () => {
    for (const r of prefillableGames(state.votes)) draftPoints.set(r.gameId, ownBock(r.gameId));
    ctx.rerender();
  });

  container.querySelectorAll('[data-vote-points]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const gameId = btn.dataset.votePoints;
      const value = Number(btn.dataset.pointsValue);
      if (draftPoints.get(gameId) === value) draftPoints.delete(gameId);
      else draftPoints.set(gameId, value);
      focusAfterRender = { gameId, value };
      ctx.rerender();
    });
  });
  if (focusAfterRender) {
    const { gameId, value } = focusAfterRender;
    focusAfterRender = null;
    [...container.querySelectorAll('[data-vote-points]')]
      .find((btn) => btn.dataset.votePoints === gameId && Number(btn.dataset.pointsValue) === value)
      ?.focus({ preventScroll: true });
  }

  container.querySelectorAll('[data-open-vote-round]').forEach((btn) => {
    btn.addEventListener('click', () => openRoundBreakdown(btn.dataset.openVoteRound));
  });

  const submitBtn = container.querySelector('#votes-submit');
  if (submitBtn) {
    submitBtn.addEventListener('click', async () => {
      if (submitBtn.disabled) return;
      const playerId = getMyId();
      if (!playerId) return showToast('Bitte zuerst auswählen, wer du bist.', { error: true });
      if (!ballotComplete(votes)) {
        return showToast(votes.mode === 'single' ? 'Bitte zuerst ein Spiel auswählen.' : 'Bitte jedes Spiel mit 0 bis 5 Punkten bewerten.', { error: true });
      }
      const entries = votes.mode === 'points'
        ? votes.results.map((r) => ({ gameId: r.gameId, points: draftPoints.get(r.gameId) }))
        : [];
      const key = mineKey(votes, playerId);
      submitBtn.disabled = true;
      try {
        // Every vote mutation route returns the same fresh payload it
        // broadcasts as 'votes:changed' (see routes/votes.ts) — patching
        // state.votes from our own response and doing a plain, no-network
        // rerender() is both cheaper than ctx.refresh()'s full loadAll() and
        // more reliable than depending solely on the broadcast: if this
        // client's own socket is disconnected/reconnecting right when the
        // write lands, the broadcast never arrives. The saved ballot is
        // exactly what was just sent, so the own-entries cache is set from
        // it directly instead of reloading and flashing the rows.
        state.votes = votes.mode === 'single' ? await api.votes.cast(playerId, draftSingleGameId) : await api.votes.castPoints(playerId, entries);
        mineCache = votes.mode === 'single'
          ? new Map([[draftSingleGameId, null]])
          : new Map(entries.map((entry) => [entry.gameId, entry.points]));
        mineCacheKey = key;
        draftKey = key;
        ctx.rerender();
        showToast(votes.mode === 'single' ? 'Deine Stimme wurde gespeichert.' : 'Deine Bewertung wurde gespeichert.');
      } catch (err) {
        submitBtn.disabled = false;
        showToast(err.message, { error: true });
      }
    });
  }

  container.querySelectorAll('[data-vote-game-checkbox]').forEach((checkbox) => {
    checkbox.addEventListener('change', () => {
      voteSelectionDirty = true;
      if (checkbox.checked) excludedGameIds.delete(checkbox.value);
      else excludedGameIds.add(checkbox.value);
      syncVoteSelectToggle(container.querySelector('#votes-select-all'));
    });
  });

  wireSelectionSearch(container, {
    inputId: 'votes-game-search',
    itemSelector: '[data-vote-game-search-item]',
    emptySelector: '[data-vote-game-search-empty]',
    onQueryChange: (query) => {
      voteGameSearchQuery = query;
      syncVoteSelectToggle(container.querySelector('#votes-select-all'));
    },
  });

  // One bulk toggle like the Match rosters: deselect when every visible game
  // is selected, otherwise select all visible games.
  container.querySelector('#votes-select-all')?.addEventListener('click', () => {
    voteSelectionDirty = true;
    const deselect = allVisibleVoteGamesSelected();
    for (const g of voteSearchVisibleGames()) {
      if (deselect) excludedGameIds.add(g.id);
      else excludedGameIds.delete(g.id);
    }
    ctx.rerender();
  });

  const startBtn = container.querySelector('#votes-start');
  if (startBtn) {
    startBtn.addEventListener('click', async () => {
      const title = container.querySelector('#votes-title')?.value.trim() || undefined;
      const info = container.querySelector('#votes-info')?.value.trim() || undefined;
      const gameIds = sortVoteGames(catalogGames())
        .filter((g) => !excludedGameIds.has(g.id))
        .map((g) => g.id);
      if (gameIds.length === 0) {
        return showToast('Bitte mindestens ein Spiel auswählen.', { error: true });
      }
      try {
        // No ctx.refresh() (a full loadAll()): patch state.votes straight
        // from our own response and do a plain rerender() instead — see the
        // submit button above for why that's both cheaper and more reliable
        // than depending solely on the 'votes:changed' broadcast this call
        // also triggers for every other client.
        state.votes = await api.votes.start({ mode: 'points', title, info, gameIds });
        resetVoteGameSelection();
        ctx.rerender();
      } catch (err) {
        showToast(err.message, { error: true });
      }
    });
  }

  const runoffBtn = container.querySelector('#votes-runoff');
  if (runoffBtn) {
    runoffBtn.addEventListener('click', async () => {
      const lastClosed = historyCache && historyCache[0];
      if (!lastClosed) return;
      try {
        // No ctx.refresh(): see the start button above.
        state.votes = await api.votes.start({
          mode: 'single',
          title: lastClosed.title ? `Stichwahl: ${lastClosed.title}` : 'Stichwahl',
          gameIds: lastClosed.winners.map((w) => w.gameId),
        });
        resetVoteGameSelection();
        ctx.rerender();
        showToast('Stichwahl gestartet.');
      } catch (err) {
        showToast(err.message, { error: true });
      }
    });
  }

  const closeBtn = container.querySelector('#votes-close');
  if (closeBtn) {
    closeBtn.addEventListener('click', async () => {
      try {
        // No ctx.refresh(): see the start button above.
        state.votes = await api.votes.close();
        // The close response belongs to this client, so invalidate the
        // separately cached history immediately instead of waiting for the
        // socket echo. This also guarantees a fresh history request when a
        // socket delivery races the rerender below.
        invalidateVoteHistory();
        ctx.rerender();
        showToast('Abstimmung beendet.');
      } catch (err) {
        showToast(err.message, { error: true });
      }
    });
  }

  const cancelBtn = container.querySelector('#votes-cancel');
  if (cancelBtn) {
    cancelBtn.addEventListener('click', async () => {
      if (!(await confirmDialog('Abstimmung wirklich abbrechen? Alle Stimmen gehen verloren.', { confirmText: 'Abstimmung abbrechen', danger: true }))) return;
      try {
        // No ctx.refresh(): see the start button above.
        state.votes = await api.votes.cancel();
        resetVoteGameSelection();
        ctx.rerender();
        showToast('Abstimmung abgebrochen.');
      } catch (err) {
        showToast(err.message, { error: true });
      }
    });
  }
}
