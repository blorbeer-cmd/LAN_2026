// "What's next?" voting view (FR-19..21). The personal session identifies the
// voter, so casting a vote needs no extra identity form.
//
// Layout, top to bottom:
// 1. Either the "Aktuelle Abstimmung" card whose „Abstimmung starten" opens
//    the start dialog (idle), or the running round as one card in the same
//    shape as an Umfrage: header with participation and the viewer's answer
//    state, one row per game, and a footer with the own progress and
//    "Speichern".
// 2. The latest closed result as "Letzter Vote", pulled from history, as a
//    collapsed Umfrage card: the header names round and winner, the opened
//    card shows result bar, "Win" chip and voter avatars per game.
// 3. The current Top 10 by aggregate "Bock" rating, split into two compact
//    five-item columns on wider screens.
//
// Every game of a round gets 0-5 points (0 is a deliberate "Spiele ich
// nicht"); only a runoff between tied winners ("Stichwahl") asks for exactly
// one game. Like an Umfrage (see pollControls.js), a round may be anonymous
// and may hide its interim result: "Zwischenstand verbergen" (on by default) keeps the per-game
// distribution hidden from everyone while the round runs, so nobody piles
// onto a visible leader; only participation shows. "Anonym" never reveals
// who voted how. Every answer is a local draft until "Speichern"; a saved
// ballot can be changed until the round ends.

import { api } from '../api.js';
import { icon } from '../icons.js';
import { state, catalogGames, eventPlayers } from '../state.js';
import { escapeHtml, formatDate, formatDateTime } from '../format.js';
import { openModal, confirmDialog } from '../modal.js';
import { showToast } from '../toast.js';
import { getMyId } from '../whoami.js';
import { matchesSelectionSearch, wireSelectionSearch } from '../selectionSearch.js';
import { emptyStateHtml } from '../emptyState.js';
import { isGroupAdmin } from '../groupContext.js';
import { ratingScaleHtml } from '../ratingScale.js';
import { skillRatingFor } from '../skillDisplay.js';
import { sharedRankNumbers } from '../rankedList.js';
import { wireActionMenus } from '../actionMenu.js';
import { wireInfoTooltips } from '../infoTooltip.js';
import {
  choiceBarFillHtml,
  CHOSEN_CELL,
  resultBarHtml,
  voteBreakdownHtml,
  voterNamesText,
  voterStackHtml,
  WIN_CHIP,
} from '../voteBreakdown.js';
import { choiceControlHtml, pollFlagsHtml } from '../pollControls.js';
import {
  createGameListFilters,
  filterGames,
  gameListToolbarHtml,
  ratingStats,
  sortGames,
  wireGameListToolbar,
} from '../gameListControls.js';

const ANONYMOUS_HELP = 'Stimmen bleiben dauerhaft anonym. Auch nach Ende der Abstimmung ist nicht sichtbar, wer wie abgestimmt hat.';
const LIVE_RESULTS_HELP = 'Solange die Abstimmung läuft, sieht niemand, wie die Stimmen verteilt sind; sichtbar ist nur, wie viele schon abgestimmt haben. Nach dem Ende ist das Ergebnis für alle sichtbar.';

// Cached separately from `state` (like analytics.js does) since it's fetched
// from its own endpoint, not part of the main loadAll() round-trip.
let historyCache = null;
let historyLoading = false;
let historyStale = false;
let historyOpen = false;
let top10Open = false;
let latestVoteOpen = false;
const expandedHistoryRounds = new Set();
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
  expandedHistoryRounds.clear();
  mineCache = null;
  mineCacheKey = null;
  mineLoading = false;
  draft = null;
  draftKey = null;
}

// The current player's own saved ballot in the running round. Any entry
// means this identity has answered; the draft below starts from it and can
// still be changed and saved again until the round ends.
let mineCache = null; // Map<gameId, { points }>
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
    mineCache = new Map(mine.entries.map((e) => [e.gameId, { points: e.points }]));
  } catch {
    mineCache = new Map();
  } finally {
    mineCacheKey = key;
    mineLoading = false;
    ctx.rerender();
  }
}

// Local, not-yet-saved answers, one per game: 0-5 points or `true` for the
// picked game of a runoff. Tapping only changes this draft;
// nothing reaches the server until "Speichern" is pressed. Reseeded from
// mineCache once per round/player (draftKey tracks that so a fresh round
// starts blank rather than carrying over a stale draft). A game missing from
// the draft is still unanswered; 0 is a real rating.
let draft = null; // Map<gameId, number | true>
let draftKey = null; // mineKey() of the round/player the current draft belongs to

function seedDraft(votes) {
  draft = new Map();
  for (const [gameId, entry] of mineCache) {
    if (votes.mode !== 'points') draft.set(gameId, true);
    else if (typeof entry.points === 'number') draft.set(gameId, entry.points);
  }
  // A points ballot not yet answered starts from the viewer's own Bock per
  // game; it is still only a local draft until "Speichern".
  if (votes.mode === 'points' && mineCache.size === 0) {
    for (const r of votes.results) {
      const bock = ownBock(r.gameId);
      if (bock !== null) draft.set(r.gameId, bock);
    }
  }
}

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

// The button that was just pressed, so keyboard focus survives the re-render
// that the press triggers.
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
  const ranks = sharedRankNumbers(top10.map((result) => result.avgPreference ?? -1));
  if (top10.length === 0) {
    return emptyStateHtml('Noch keine Spiele.', { className: 'empty-state-compact' });
  }
  const rowHtml = (r, i) => `
    <div class="lb-row ${ranks[i] === 1 ? 'rank-1' : ''}">
      <span class="lb-rank">${ranks[i]}</span>
            <span style="flex:1;min-width:0;">
        <div class="player-name" style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escapeHtml(r.gameName)}</div>
        <div class="muted" style="font-size:var(--font-size-xs);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${topMetaHtml(r)}</div>
      </span>
      <span class="lb-points">${icon('flame')} ${r.preferenceCount ? r.avgPreference.toFixed(1) : '–'}</span>
    </div>`;
  return renderRankingColumns(top10, rowHtml);
}

// ---------- results: shared by a visible interim result and closed rounds ----------

function resultSummary(h, r) {
  if (h.mode === 'points') return `${r.points} Pkt. · ${r.votes}/${h.totalVoters} spielen mit`;
  return `${r.votes} ${r.votes === 1 ? 'Stimme' : 'Stimmen'}`;
}

// The value a result's place number compares, as the server ranks it.
function rankValue(h, r) {
  return h.mode === 'points' ? r.points : r.votes;
}

function resultCellHtml(h, r, maxPoints) {
  const share = h.mode === 'points' ? r.points / maxPoints : r.votes / Math.max(1, h.totalVoters);
  return resultBarHtml(choiceBarFillHtml(share), `<span class="event-poll-count-text">${escapeHtml(resultSummary(h, r))}</span>`);
}

// Everyone who picked the game or gave it at least one point, highest first. An anonymous round names nobody.
function supportersOf(h, gameId) {
  if (h.anonymous) return [];
  return (h.ballots ?? [])
    .map((ballot) => ({ ballot, entry: ballot.entries.find((entry) => entry.gameId === gameId) }))
    .filter(({ entry }) => entry && (h.mode !== 'points' || entry.points > 0))
    .sort((a, b) => (b.entry.points ?? 0) - (a.entry.points ?? 0) || a.ballot.name.localeCompare(b.ballot.name, 'de'))
    .map(({ ballot }) => ({ playerId: ballot.playerId, name: ballot.name }));
}

function supporterStackHtml(h, r, attributes) {
  const supporters = supportersOf(h, r.gameId);
  return voterStackHtml({
    people: supporters,
    label: `Stimmen zu ${r.gameName} ansehen · ${h.mode === 'points' ? 'Spielen mit' : 'Gewählt von'}: ${voterNamesText(supporters)}`,
    attributes,
  });
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

function answeredCount(votes) {
  return votes.results.filter((r) => draft.has(r.gameId)).length;
}

function ballotComplete(votes) {
  const answered = answeredCount(votes);
  if (votes.mode === 'points') return votes.results.length > 0 && answered === votes.results.length;
  return answered === 1;
}

function draftProgressText(votes) {
  const answered = answeredCount(votes);
  if (votes.mode === 'points') return `${answered} von ${votes.results.length} bewertet`;
  return `${answered} gewählt`;
}

function answerChipHtml(hasSubmitted) {
  return hasSubmitted
    ? `<span class="badge badge-playing event-poll-answer-chip">${icon('check')}Abgegeben</span>`
    : '<span class="badge event-poll-answer-chip is-missing">Deine Stimme fehlt</span>';
}

// The viewer's own Bock (0-5) for a game, or null. Vote points use the same
// scale, so an unanswered ballot starts from it.
function ownBock(gameId) {
  const myId = getMyId();
  const entry = myId ? state.preferences?.find((pref) => pref.player_id === myId && pref.game_id === gameId) : null;
  return entry ? entry.rating : null;
}

// The viewer's own Skill beside each game as orientation; 0 means
// "kenne ich nicht", – means not rated yet.
function ownSkillHtml(gameId) {
  const myId = getMyId();
  const skill = myId ? skillRatingFor(myId, gameId) : null;
  return `<span class="vote-own-skill${skill === null ? ' is-missing' : ''}">Mein Skill: ${skill ?? '–'}</span>`;
}

// The answer control of one game: the 0-5 scale, or in a runoff the same
// Wählen button as an Umfrage with a single choice.
function ballotControlHtml(votes, r) {
  const value = draft.get(r.gameId);
  const gameId = escapeHtml(r.gameId);
  if (votes.mode === 'points') {
    // No button selected means "not rated yet".
    return ratingScaleHtml({
      selected: value,
      tone: 'vote',
      groupLabel: `Punkte für ${r.gameName}`,
      valueLabel: pointsValueText,
      attributes: (points) => `data-vote-points="${gameId}" data-points-value="${points}"`,
    });
  }
  return choiceControlHtml({ selected: value === true, label: `${r.gameName} wählen`, attributes: `data-vote-select="${gameId}"` });
}

// Same four columns as an Umfrage row (name, result, voters, answer). While
// the interim result is hidden the result and voter columns stay empty.
function renderOpenRow(votes, r, draftReady, { columnStart, showResult, maxPoints }) {
  const control = draftReady ? ballotControlHtml(votes, r) : '<span class="muted vote-points-loading">Lädt…</span>';
  const decline = votes.mode === 'points'
    ? `<span class="event-poll-tag vote-decline-tag" data-decline-tag ${draftReady && draft.get(r.gameId) === 0 ? '' : 'hidden'}>${DECLINE_LABEL}</span>`
    : '';
  return `
    <div class="event-poll-option${columnStart ? ' is-column-start' : ''}" data-vote-row="${escapeHtml(r.gameId)}">
      <div class="event-poll-option-info">
        <span class="event-poll-option-title-row"><strong>${escapeHtml(r.gameName)}</strong></span>
        <span class="muted event-poll-option-note">${ownSkillHtml(r.gameId)} · ${gameMetaHtml(r)}</span>
      </div>
      ${showResult ? resultCellHtml(votes, r, maxPoints) : '<span class="event-poll-result"></span>'}
      <span class="event-poll-option-badges">${showResult ? supporterStackHtml(votes, r, 'data-open-live-votes') : ''}${decline}</span>
      ${control}
    </div>`;
}

function isUntitledRunoff(round) {
  return round.mode === 'single' && !(round.title ?? '').includes('Stichwahl');
}

function roundTagsHtml(votes) {
  const tags = [];
  // Runoffs are titled "Stichwahl: …" already, so the tag only shows when
  // the title does not say it.
  if (isUntitledRunoff(votes)) tags.push('Stichwahl');
  if (votes.anonymous) tags.push('Anonym');
  if (votes.hideLiveResults) tags.push('Zwischenstand verborgen');
  return `<div class="event-poll-tags">${tags.map((tag) => `<span class="event-poll-tag">${escapeHtml(tag)}</span>`).join('')}</div>`;
}

function renderOpenRound(votes, { mineReady, hasSubmitted, totalPlayers }) {
  const games = ballotGames(votes);
  const showResult = !votes.hideLiveResults;
  const maxPoints = Math.max(1, ...votes.results.map((r) => r.points ?? 0));
  // With the result hidden, two columns on wide screens read down the left
  // column first, then the right one (see .event-poll-options.is-compact).
  const columnRows = Math.max(1, Math.ceil(games.length / 2));
  const rows = games
    .map((r, index) => renderOpenRow(votes, r, mineReady, { columnStart: !showResult && index === columnRows, showResult, maxPoints }))
    .join('');
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
          ${admin ? '<button type="button" class="btn btn-sm btn-danger" id="votes-cancel">Abbrechen</button>' : ''}
        </div>
      </header>
      <div class="stack event-poll-card-content">
        <section class="stack event-poll-round">
          ${roundTagsHtml(votes)}
          ${votes.info ? `<p class="event-poll-note">${escapeHtml(votes.info)}</p>` : ''}
          <div class="stack event-poll-options has-answers${showResult ? '' : ' is-compact'}"${showResult ? '' : ` style="--compact-rows: ${columnRows};"`}>${rows}</div>
          <div class="event-poll-save-row event-poll-footer">
            <span class="muted" data-vote-rated-progress>${mineReady ? draftProgressText(votes) : ''}</span>
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
  return [h.title, formatDateTime(h.closedAt), isUntitledRunoff(h) ? 'Stichwahl' : null, submissionCountLabel(h.totalVoters)]
    .filter(Boolean)
    .join(' · ');
}

function renderResultRows(h, columnRows) {
  const maxPoints = Math.max(1, ...h.results.map((r) => r.points));
  const ranks = sharedRankNumbers(h.results.map((result) => rankValue(h, result)));
  const winners = new Set(h.winnerGameIds ?? []);
  return h.results
    .map((r, index) => {
      const win = winners.has(r.gameId);
      return `
        <div class="event-poll-option${win ? ' is-winner' : ''}${index === columnRows ? ' is-column-start' : ''}">
          <div class="row" style="gap:var(--space-2);min-width:0;">
            <span class="lb-rank${ranks[index] === 1 ? ' is-first' : ''}" style="flex-shrink:0;" aria-hidden="true">${ranks[index]}</span>
            <span class="visually-hidden">Platz ${ranks[index]}</span>
            <div class="event-poll-option-info">
              <span class="event-poll-option-title-row">
                <strong>${escapeHtml(r.gameName)}</strong>
                ${win ? WIN_CHIP : ''}
              </span>
              <span class="muted event-poll-option-note">${gameMetaHtml(r)}</span>
            </div>
          </div>
          ${resultCellHtml(h, r, maxPoints)}
          <span class="event-poll-option-badges">${supporterStackHtml(h, r, `data-open-vote-round="${h.round}"`)}</span>
        </div>`;
    })
    .join('');
}

// ---------- current vote: the most recent closed round, straight from history ----------

function winnerNames(h) {
  return h.results.filter((r) => (h.winnerGameIds ?? []).includes(r.gameId)).map((r) => r.gameName);
}

function renderVoteResultContent(h) {
  // The API already ranks results by this round's score. Preserve that order
  // while filling the left column before the right one, as in the ballot.
  const columnRows = Math.max(1, Math.ceil(h.results.length / 2));
  return `<section class="stack event-poll-round">
    ${h.info ? `<p class="event-poll-note">${escapeHtml(h.info)}</p>` : ''}
    <div class="stack event-poll-options is-ranked" style="--compact-rows: ${columnRows};">${renderResultRows(h, columnRows)}</div>
  </section>`;
}

// "Stimmen ansehen" only exists where the round names its voters.
function votesButtonHtml(h) {
  return h.anonymous ? '' : `<button type="button" class="btn btn-sm" data-open-vote-round="${escapeHtml(String(h.round))}">Stimmen ansehen</button>`;
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
          ${votesButtonHtml(h)}
          ${showRunoff ? '<button type="button" class="btn btn-primary btn-sm" id="votes-runoff">Stichwahl starten</button>' : ''}
        </div>
      </header>
      <div class="stack event-poll-card-content" ${latestVoteOpen ? '' : 'hidden'}>
        ${renderVoteResultContent(h)}
      </div>
    </section>`;
}

// ---------- history: one independently collapsible card per older round ----------

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
  return `<div class="stack">${olderRounds
    .map((h) => {
      const winners = winnerNames(h);
      const meta = [roundTitle(h), formatDateTime(h.closedAt), submissionCountLabel(h.totalVoters)].join(' · ');
      const round = escapeHtml(String(h.round));
      const expanded = expandedHistoryRounds.has(String(h.round));
      return `
        <article class="card event-poll-card" data-vote-history-round="${round}" aria-labelledby="vote-history-title-${round}">
          <header class="event-poll-card-header">
            <button type="button" class="event-poll-card-toggle" data-toggle-vote-history="${round}" aria-expanded="${expanded}" aria-controls="vote-history-result-${round}">
              <span class="collapsible-section-chevron" aria-hidden="true">${icon('chevronRight')}</span>
              <span class="event-poll-history-main">
                <span class="event-poll-history-meta" id="vote-history-title-${round}">${escapeHtml(meta)}</span>
                ${winners.length ? `<span class="event-poll-history-result">${WIN_CHIP}<span>${escapeHtml(winners.join(', '))}</span></span>` : '<span class="muted">Keine Stimmen</span>'}
              </span>
            </button>
            <div class="event-poll-card-side">${votesButtonHtml(h)}</div>
          </header>
          <div class="stack event-poll-card-content" id="vote-history-result-${round}" ${expanded ? '' : 'hidden'}>
            ${expanded ? renderVoteResultContent(h) : ''}
          </div>
        </article>`;
    })
    .join('')}</div>`;
}

// ---------- "Stimmen": who voted how in one round ----------

const DECLINE_CELL = `<span class="event-poll-vote-cell is-cannot" role="img" aria-label="Spielt nicht" title="Spielt nicht">${icon('x')}</span>`;

function ballotCell(h, entry) {
  if (h.mode === 'single') {
    return entry ? CHOSEN_CELL : '<span class="event-poll-vote-cell is-empty" aria-hidden="true"></span>';
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
    <div class="muted vote-result-meta">${escapeHtml(h.open ? [h.title, submissionCountLabel(h.totalVoters)].filter(Boolean).join(' · ') : roundMetaText(h))}</div>
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

// A running round with a visible interim result already carries its ballots.
function openLiveBreakdown(votes) {
  openModal(`Stimmen · ${roundTitle(votes)}`, `<div class="stack">${roundBreakdownHtml(votes)}</div>`);
}

// ---------- start dialog: like "Umfrage starten", plus the game list ----------

function voteSelectToggleContent(allSelected) {
  return allSelected
    ? { iconName: 'listX', label: 'Sichtbare Spiele abwählen', tooltip: 'Sichtbare abwählen' }
    : { iconName: 'listChecks', label: 'Sichtbare Spiele markieren', tooltip: 'Sichtbare markieren' };
}

function voteSelectToggleHtml(allSelected) {
  const { iconName, label, tooltip } = voteSelectToggleContent(allSelected);
  return `<button type="button" class="icon-btn selection-toolbar-icon" id="votes-select-all" aria-label="${label}" data-tooltip="${tooltip}">${icon(iconName)}</button>`;
}

function selectionCountText(count) {
  return `${count} ${count === 1 ? 'Spiel' : 'Spiele'} ausgewählt`;
}

// One compact meta line per game in the start list: genres and the group's
// average Bock, so sorting and filtering by them stays readable.
function startGameMetaHtml(game) {
  const bock = ratingStats(state.preferences ?? [], game.id).avg;
  return [
    game.genres?.length ? escapeHtml(game.genres.join(', ')) : null,
    bock === null ? null : `${icon('flame')} Ø ${bock.toFixed(1)}`,
  ]
    .filter(Boolean)
    .join(' · ');
}

function openVoteStartForm(ctx) {
  const catalog = sortVoteGames(catalogGames());
  // The ten games the group most wants to play are the starting selection;
  // the bulk toggle or single checkboxes adjust it.
  const selected = new Set(gamesByPreference(catalog, state.votes?.catalogResults ?? []).slice(0, 10).map((game) => game.id));
  const filters = createGameListFilters();
  const myId = getMyId();
  let query = '';
  let dirty = false;

  const listedGames = () => sortGames(filterGames(catalog, filters, myId), filters, myId);
  const searchVisibleGames = () => listedGames().filter((game) => matchesSelectionSearch(game.name, query));
  const allVisibleSelected = () => {
    const visible = searchVisibleGames();
    return visible.length > 0 && visible.every((game) => selected.has(game.id));
  };

  const gameRowsHtml = () => {
    const games = listedGames();
    if (games.length === 0) {
      return emptyStateHtml(catalog.length === 0 ? 'Noch keine Spiele.' : 'Keine Spiele für diese Filter.', { className: 'empty-state-compact' });
    }
    return `<div id="votes-game-select" class="vote-game-grid" role="group" aria-labelledby="votes-games-label">${games
      .map((game) => {
        const meta = startGameMetaHtml(game);
        return `
        <label class="check-row" data-vote-game-search-item data-selection-search="${escapeHtml(game.name)}">
          <input type="checkbox" data-vote-game-checkbox value="${escapeHtml(game.id)}" ${selected.has(game.id) ? 'checked' : ''} />
          <span class="vote-game-option">
            <span class="vote-game-option-name">${escapeHtml(game.name)}</span>
            ${meta ? `<span class="muted vote-game-option-meta">${meta}</span>` : ''}
          </span>
        </label>`;
      })
      .join('')}</div>`;
  };

  const pickerHtml = () => `
    <div>
      <span class="field-label is-required" id="votes-games-label">Spiele</span>
      ${gameListToolbarHtml(filters, {
        games: catalog,
        myId,
        searchId: 'votes-game-search',
        searchLabel: 'Spiel suchen',
        query,
        extraHtml: voteSelectToggleHtml(allVisibleSelected()),
        className: 'vote-game-toolbar',
        // The start list filters by genre only.
        ratingFilters: false,
      })}
    </div>
    ${gameRowsHtml()}
    <p class="muted vote-game-search-empty" data-vote-game-search-empty role="status" hidden>Keine passenden Spiele gefunden.</p>`;

  const { close } = openModal('Abstimmung starten', `
    <form id="vote-start-form" class="stack event-poll-form">
      <div><label for="votes-title" class="field-label">Titel</label><input type="text" id="votes-title" maxlength="80" placeholder="Samstagabend" autofocus /></div>
      <div><label for="votes-info" class="field-label">Beschreibung</label><textarea id="votes-info" class="event-poll-note-input" maxlength="500" rows="1" placeholder="Nur Spiele für 4 Leute"></textarea></div>
      ${pollFlagsHtml({
        anonymousId: 'votes-anonymous',
        hiddenId: 'votes-hide-live-results',
        anonymousHelp: ANONYMOUS_HELP,
        hiddenHelp: LIVE_RESULTS_HELP,
      })}
      <div class="stack vote-game-picker" data-vote-game-picker>${pickerHtml()}</div>
      <div class="event-poll-save-row event-poll-footer">
        <span class="muted" data-vote-selected-count>${selectionCountText(selected.size)}</span>
        <button type="submit" class="btn btn-primary btn-sm" id="votes-start">Abstimmung starten</button>
      </div>
    </form>`, {
    confirmClose: () => (dirty ? 'Die eingegebenen Angaben gehen verloren.' : null),
    onMount: (modal) => {
      const form = modal.querySelector('#vote-start-form');
      const picker = modal.querySelector('[data-vote-game-picker]');
      const markDirty = () => { dirty = true; };
      form.addEventListener('input', markDirty);
      form.addEventListener('change', markDirty);
      wireInfoTooltips(modal);

      const syncSelection = () => {
        const button = picker.querySelector('#votes-select-all');
        if (button) {
          const { iconName, label, tooltip } = voteSelectToggleContent(allVisibleSelected());
          button.setAttribute('aria-label', label);
          button.dataset.tooltip = tooltip;
          button.innerHTML = icon(iconName);
        }
        modal.querySelector('[data-vote-selected-count]').textContent = selectionCountText(selected.size);
      };

      const renderPicker = ({ focusSelector } = {}) => {
        picker.innerHTML = pickerHtml();
        wirePicker();
        if (focusSelector) picker.querySelector(focusSelector)?.focus({ preventScroll: true });
      };

      function wirePicker() {
        wireActionMenus(picker);
        wireGameListToolbar(picker, filters, { onChange: renderPicker });
        wireSelectionSearch(picker, {
          inputId: 'votes-game-search',
          itemSelector: '[data-vote-game-search-item]',
          emptySelector: '[data-vote-game-search-empty]',
          onQueryChange: (value) => {
            query = value;
            syncSelection();
          },
        });
        // Enter in the search field filters; it must not start the round.
        picker.querySelector('#votes-game-search')?.addEventListener('keydown', (event) => {
          if (event.key === 'Enter') event.preventDefault();
        });
        picker.querySelectorAll('[data-vote-game-checkbox]').forEach((checkbox) => {
          checkbox.addEventListener('change', () => {
            if (checkbox.checked) selected.add(checkbox.value);
            else selected.delete(checkbox.value);
            syncSelection();
          });
        });
        // One bulk toggle like the Match rosters: deselect when every visible
        // game is selected, otherwise select all visible games.
        picker.querySelector('#votes-select-all')?.addEventListener('click', () => {
          dirty = true;
          const deselect = allVisibleSelected();
          for (const game of searchVisibleGames()) {
            if (deselect) selected.delete(game.id);
            else selected.add(game.id);
          }
          picker.querySelectorAll('[data-vote-game-checkbox]').forEach((checkbox) => {
            checkbox.checked = selected.has(checkbox.value);
          });
          syncSelection();
        });
      }
      wirePicker();

      // The dialog closes on Escape; an open sort or filter menu inside it
      // takes that Escape first and only closes itself.
      modal.addEventListener('keydown', (event) => {
        if (event.key !== 'Escape') return;
        const menu = picker.querySelector('.action-menu[open]');
        if (!menu) return;
        event.preventDefault();
        menu.open = false;
        menu.querySelector('summary')?.focus();
      });

      form.addEventListener('submit', async (submitEvent) => {
        submitEvent.preventDefault();
        const submitButton = submitEvent.submitter ?? modal.querySelector('#votes-start');
        // Every selected game counts, also one a filter currently hides.
        const gameIds = catalog.filter((game) => selected.has(game.id)).map((game) => game.id);
        if (gameIds.length === 0) return showToast('Bitte mindestens ein Spiel auswählen.', { error: true });
        submitButton.disabled = true;
        try {
          // No ctx.refresh() (a full loadAll()): patch state.votes straight
          // from our own response and do a plain rerender() instead — see the
          // submit button below for why that's both cheaper and more reliable
          // than depending solely on the 'votes:changed' broadcast this call
          // also triggers for every other client.
          state.votes = await api.votes.start({
            mode: 'points',
            title: modal.querySelector('#votes-title').value.trim() || undefined,
            info: modal.querySelector('#votes-info').value.trim() || undefined,
            gameIds,
            anonymous: modal.querySelector('#votes-anonymous').checked,
            hideLiveResults: modal.querySelector('#votes-hide-live-results').checked,
          });
          dirty = false;
          close();
          ctx.rerender();
          showToast('Abstimmung gestartet.');
        } catch (err) {
          submitButton.disabled = false;
          showToast(err.message, { error: true });
        }
      });
    },
  });
}

// ---------- page ----------

function renderStartSection() {
  return `
    <section class="card stack grouped-page-section primary-collection-section vote-page-section" aria-labelledby="vote-start-title">
      <div class="grouped-page-section-title">
        <h2 id="vote-start-title">Aktuelle Abstimmung</h2>
        <button type="button" class="btn btn-primary btn-sm" id="votes-new">Abstimmung starten</button>
      </div>
      ${emptyStateHtml('Keine laufende Abstimmung')}
    </section>`;
}

export function renderVotes(container, ctx) {
  const votes = state.votes;
  if (!votes) {
    container.innerHTML = `<h1 class="view-title">Vote</h1>${emptyStateHtml('Lädt…')}`;
    return;
  }

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
    seedDraft(votes);
    draftKey = mineCacheKey;
  }

  // Eligible voters are the active event's accepted participants, not every
  // group member — an invited-but-not-yet-accepted person must not inflate
  // the "X/Y" denominator (see eventPlayers()).
  const totalPlayers = eventPlayers().length;

  // A tie in the most recent round offers the runoff right in that card's
  // header, like every other primary action on this page.
  const latestRound = historyCache?.[0];
  const showRunoff = !votes.open && isGroupAdmin() && Boolean(latestRound?.totalVoters) && latestRound.winnerGameIds?.length > 1;

  container.innerHTML = `
    <h1 class="view-title">Vote</h1>
    ${votes.open ? renderOpenRound(votes, { mineReady, hasSubmitted, totalPlayers }) : renderStartSection()}

    ${renderLatestVoteCard({ showRunoff })}

    <details class="card history-details collapsible-section vote-page-section" data-vote-top10 ${top10Open ? 'open' : ''}>
      <summary class="collapsible-section-header">
        <span class="collapsible-section-chevron">${icon('chevronRight')}</span>
        <h2>Top 10 nach Bock-Level</h2>
      </summary>
      <div class="collapsible-section-content">${renderTop10(votes.catalogResults)}</div>
    </details>

    <details class="card history-details collapsible-section" data-vote-history ${historyOpen ? 'open' : ''}>
      <summary class="collapsible-section-header">
        <span class="collapsible-section-chevron">${icon('chevronRight')}</span>
        <h2>Historie</h2>
        <span class="collapsible-section-summary-end">
          <span class="badge badge-offline">${Math.max(0, (historyCache?.length ?? 0) - 1)}</span>
        </span>
      </summary>
      <div class="collapsible-section-content">${renderHistory()}</div>
    </details>
  `;

  container.querySelector('#votes-new')?.addEventListener('click', () => openVoteStartForm(ctx));
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
  container.querySelectorAll('[data-toggle-vote-history]').forEach((button) => {
    button.addEventListener('click', async () => {
      const round = button.dataset.toggleVoteHistory;
      if (expandedHistoryRounds.has(round)) expandedHistoryRounds.delete(round);
      else expandedHistoryRounds.add(round);
      await ctx.rerender();
      [...container.querySelectorAll('[data-toggle-vote-history]')]
        .find((toggle) => toggle.dataset.toggleVoteHistory === round)?.focus({ preventScroll: true });
    });
  });

  // A runoff pick replaces the previous one.
  container.querySelectorAll('[data-vote-select]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const gameId = btn.dataset.voteSelect;
      draft = new Map([[gameId, true]]);
      focusAfterRender = `[data-vote-select="${CSS.escape(gameId)}"]`;
      ctx.rerender();
    });
  });

  // Like an Umfrage: pressing the chosen answer again clears it.
  container.querySelectorAll('[data-vote-points]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const gameId = btn.dataset.votePoints;
      const value = Number(btn.dataset.pointsValue);
      if (draft.get(gameId) === value) draft.delete(gameId);
      else draft.set(gameId, value);
      focusAfterRender = `[data-vote-points="${CSS.escape(gameId)}"][data-points-value="${value}"]`;
      ctx.rerender();
    });
  });
  if (focusAfterRender) {
    const selector = focusAfterRender;
    focusAfterRender = null;
    container.querySelector(selector)?.focus({ preventScroll: true });
  }

  container.querySelectorAll('[data-open-vote-round]').forEach((btn) => {
    btn.addEventListener('click', () => openRoundBreakdown(btn.dataset.openVoteRound));
  });
  container.querySelectorAll('[data-open-live-votes]').forEach((btn) => {
    btn.addEventListener('click', () => openLiveBreakdown(votes));
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
      // Only games of this round count; a draft may still hold a game that
      // was removed since.
      const answered = votes.results.filter((r) => draft.has(r.gameId)).map((r) => [r.gameId, draft.get(r.gameId)]);
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
        if (votes.mode === 'single') state.votes = await api.votes.cast(playerId, answered[0][0]);
        else state.votes = await api.votes.castPoints(playerId, answered.map(([gameId, points]) => ({ gameId, points })));
        mineCache = new Map(answered.map(([gameId, value]) => [gameId, { points: typeof value === 'number' ? value : null }]));
        mineCacheKey = key;
        draftKey = key;
        ctx.rerender();
        showToast(votes.mode === 'points' ? 'Deine Bewertung wurde gespeichert.' : 'Deine Stimme wurde gespeichert.');
      } catch (err) {
        submitBtn.disabled = false;
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
        // No ctx.refresh(): see the submit button above. The runoff keeps
        // the privacy options of the round it decides.
        state.votes = await api.votes.start({
          mode: 'single',
          title: lastClosed.title ? `Stichwahl: ${lastClosed.title}` : 'Stichwahl',
          gameIds: lastClosed.winners.map((w) => w.gameId),
          anonymous: Boolean(lastClosed.anonymous),
          hideLiveResults: lastClosed.hideLiveResults !== false,
        });
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
        // No ctx.refresh(): see the submit button above.
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
        // No ctx.refresh(): see the submit button above.
        state.votes = await api.votes.cancel();
        ctx.rerender();
        showToast('Abstimmung abgebrochen.');
      } catch (err) {
        showToast(err.message, { error: true });
      }
    });
  }
}
