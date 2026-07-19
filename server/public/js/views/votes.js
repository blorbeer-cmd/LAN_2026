// "What's next?" voting view (FR-19..21). Voting needs to know WHO is voting;
// since the tool has no per-person login (just the shared access token),
// each phone remembers "who I am" locally so casting a vote takes no form.
//
// Layout, top to bottom:
// 1. Either "start a new round" controls (idle), or the full interactive
//    game list plus a submit button (round open) — the rest of the catalog
//    only appears once a round is actually running.
// 2. The latest closed result as "Letzter Vote", pulled from history.
// 3. The current Top 10 by aggregate "Bock" rating, split into two compact
//    five-item columns on wider screens.
//
// While a round is open, nobody sees how votes/points are distributed across
// games yet — only the server-side final tally, once closed, may influence
// anyone (no watching a leader emerge and piling onto it). The view only
// shows: the list of games to vote/rate, your own local (not-yet-submitted)
// picks, and how many people have already submitted (momentum, not a
// per-game breakdown). Full bars/rankings appear the moment the round
// closes, and past rounds stay inspectable afterwards via the history list.
//
// Every regular round runs in 'points' mode: one slider per game, 0-10
// points, 0 meaning "not rated" — as many games as you like. 'single' mode
// (pick exactly one game) still exists server-side, but only ever gets used
// for a runoff between tied winners (see the "Stichwahl" button below) — it
// is not offered as a choice when starting a fresh round.
// Either mode requires an explicit "Abstimmung abschicken" tap — selecting a
// game or moving a slider only stages a local draft, it does not hit the
// server until submitted. Closed-round results are sorted by each game's
// aggregate "Bock" rating (state.preferences, maintained per-player in
// profile.js) whenever the round's own score is tied.

import { api } from '../api.js';
import { icon } from '../icons.js';
import { state } from '../state.js';
import { escapeHtml, formatDate, formatDateTime } from '../format.js';
import { openModal, confirmDialog } from '../modal.js';
import { showToast } from '../toast.js';
import { getMyId, whoAmICardHtml, wireWhoAmICard } from '../whoami.js';
import { domainIcon } from '../domainIcons.js';
import { infoTooltipHtml, wireInfoTooltips } from '../infoTooltip.js';

// Cached separately from `state` (like analytics.js does) since it's fetched
// from its own endpoint, not part of the main loadAll() round-trip.
let historyCache = null;
let historyLoading = false;
let historyOpen = false;

async function loadHistory(ctx) {
  historyLoading = true;
  try {
    const res = await api.votes.history();
    historyCache = res.history;
  } catch {
    historyCache = [];
  } finally {
    historyLoading = false;
    ctx.rerender();
  }
}

// Called from app.js whenever a votes:changed event reports the round is no
// longer open, so a freshly closed round shows up next time this view opens
// instead of whatever the last fetch happened to see.
export function invalidateVoteHistory() {
  historyCache = null;
}

// The current player's own already-submitted entries in the running round.
// Any entry means this identity has used its one submission for the round;
// the values remain visible, but the controls and submit action are locked.
let mineCache = null; // Map<gameId, points|null>
let mineCacheKey = null; // `${round}:${playerId}`
let mineLoading = false;

async function loadMine(round, playerId, ctx) {
  mineLoading = true;
  try {
    const mine = await api.votes.mine(playerId);
    mineCache = new Map(mine.entries.map((e) => [e.gameId, e.points]));
  } catch {
    mineCache = new Map();
  } finally {
    mineCacheKey = `${round}:${playerId}`;
    mineLoading = false;
    ctx.rerender();
  }
}

// Local, not-yet-submitted picks. Tapping a game or dragging a slider only
// changes this draft; nothing reaches the server until the submit button is
// pressed. Reseeded from mineCache once per round/player (draftKey tracks
// that so a fresh round or a "Nicht du?" identity switch starts blank/fresh
// rather than carrying over a stale draft).
let draftSingleGameId = null;
let draftPoints = null; // Map<gameId, points>
let draftKey = null; // `${round}:${playerId}` the current draft belongs to

// Guards the points sliders against a re-render landing mid-drag (another
// player casting a vote, or a Bock rating changing elsewhere, both trigger a
// renderCurrent() while this view is open) — see gameCatalog.js's identical
// guard for why: replacing container.innerHTML destroys the exact <input>
// the pointer is down on and silently drops the browser's native pointer
// capture for that drag, so the thumb stops tracking the mouse until
// released and re-grabbed. endDrag() catches up with a no-network re-render
// once the drag actually ends.
let sliderDragActive = false;
let dragGuardInstalled = false;
let lastCtx = null;

function ensureDragGuardInstalled() {
  if (dragGuardInstalled) return;
  dragGuardInstalled = true;
  const endDrag = () => {
    if (!sliderDragActive) return;
    sliderDragActive = false;
    lastCtx?.rerender();
  };
  document.addEventListener('pointerup', endDrag);
  document.addEventListener('pointercancel', endDrag);
  document.addEventListener('mouseup', endDrag);
  document.addEventListener('touchend', endDrag);
}

function preferenceChipHtml(r) {
  if (!r.preferenceCount) {
    return `<span class="muted" style="font-size:var(--font-size-xs);">${icon('flame')} –</span>`;
  }
  return `<span class="muted" style="font-size:var(--font-size-xs);">${icon('flame')} Ø ${r.avgPreference.toFixed(1)} (${r.preferenceCount})</span>`;
}

function lastPlayedHtml(r) {
  return r.playCount > 0 ? `zuletzt gespielt: ${formatDate(r.lastPlayedAt)} · ${r.playCount}× gespielt` : 'noch nie gespielt';
}

function playtimeChipHtml(r) {
  return `<span class="muted" style="font-size:var(--font-size-xs);">${icon('timer')} ${r.totalPlaytimeMs > 0 ? r.totalPlaytimeFormatted : '–'}</span>`;
}

function winCountChipHtml(r) {
  return `<span class="muted" style="font-size:var(--font-size-xs);">${icon('trophy')} ${r.voteWinCount}× gewonnen</span>`;
}

function statsRowHtml(r) {
  return `
    <div class="row-between">
      <span class="row" style="gap:var(--space-3);flex-wrap:wrap;">
        <span class="muted" style="font-size:var(--font-size-xs);">${lastPlayedHtml(r)}</span>
        ${preferenceChipHtml(r)}
      </span>
    </div>
    <div class="row-between">
      <span class="row" style="gap:var(--space-3);flex-wrap:wrap;">
        ${playtimeChipHtml(r)}
        ${winCountChipHtml(r)}
      </span>
    </div>`;
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

function submissionCountLabel(count, mode) {
  if (mode === 'points') return `${count} ${count === 1 ? 'Bewertung' : 'Bewertungen'}`;
  return `${count} ${count === 1 ? 'Stimme' : 'Stimmen'}`;
}

// Reuses the leaderboard's .lb-row (icon-led, single line, rank + a value
// pinned right) instead of the old full .vote-row block — a "Bock" ranking
// doesn't need its own two-line stats block per game to be useful at a
// glance.
function renderTop10(results) {
  const top10 = topByPreference(results, 10);
  if (top10.length === 0) {
    return `<div class="empty-state" style="padding:var(--space-4);">Noch keine Spiele im Katalog.</div>`;
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

// ---------- open round: stage a local draft, submit explicitly ----------

function renderOpenRows(votes, draftReady, hasSubmitted) {
  return votes.results
    .map((r) => {
      let action = '';
      let pointsSliderRow = '';
      if (!draftReady) {
        pointsSliderRow = `<div class="muted" style="font-size:var(--font-size-xs);padding:var(--space-1) 0 0;">Lädt deine Auswahl…</div>`;
      } else if (votes.mode === 'single') {
        const isSelected = draftSingleGameId === r.gameId;
        action = `<button type="button" class="btn btn-sm ${isSelected ? 'btn-primary' : ''}" data-vote-select="${r.gameId}" ${hasSubmitted ? 'disabled' : ''}>${isSelected ? 'Ausgewählt' : 'Auswählen'}</button>`;
      } else {
        const pointsVal = draftPoints.get(r.gameId) ?? 0;
        pointsSliderRow = `
          <div class="skill-row" data-points-row="${r.gameId}" style="padding:var(--space-1) 0 0;">
            <span class="muted" style="font-size:var(--font-size-xs);">Punkte</span>
            <span class="skill-value">${pointsVal}</span>
            <input type="range" class="skill-row-slider" min="0" max="10" step="1"
                   data-points-slider="${r.gameId}" value="${pointsVal}" ${hasSubmitted ? 'disabled' : ''} />
          </div>`;
      }

      return `
        <div class="vote-row">
          <div class="row-between">
            <span class="row" style="gap:var(--space-2);">${escapeHtml(r.gameName)}</span>
            ${action}
          </div>
          ${statsRowHtml(r)}
          ${pointsSliderRow}
        </div>`;
    })
    .join('');
}

// ---------- closed round (current or reopened from history): full bars ----------

function renderClosedRows(results, mode, winnerGameIds) {
  const scoredResults = results.filter((result) => result.score > 0);
  const maxScore = Math.max(1, ...scoredResults.map((result) => result.score));
  return scoredResults
    .map((r) => {
      const isWinner = winnerGameIds ? winnerGameIds.includes(r.gameId) : r.score > 0 && r.score === maxScore;
      const scoreLabel =
        mode === 'points' ? `${r.points} Punkt(e)${r.votes ? ` · ${r.votes} Spieler` : ''}` : `${r.votes} Stimme(n)`;
      return `
        <div class="vote-row ${isWinner ? 'is-winner' : ''}">
          <div class="row-between">
            <span class="row" style="gap:var(--space-2);">${escapeHtml(r.gameName)}</span>
            <span class="muted">${scoreLabel}</span>
          </div>
          <div class="vote-bar-track"><div class="vote-bar-mask" style="width:${100 - (r.score / maxScore) * 100}%"></div></div>
          ${statsRowHtml(r)}
        </div>`;
    })
    .join('');
}

function renderVoteRanking(results, mode, winnerGameIds) {
  const winners = new Set(winnerGameIds ?? []);
  const tiedWinners = winners.size > 1;
  let previousScore = null;
  let currentRank = 0;
  const rankedResults = results.filter((result) => result.score > 0).slice(0, 10).map((result, index) => {
    if (previousScore === null || result.score !== previousScore) currentRank = index + 1;
    previousScore = result.score;
    return { result, rank: currentRank };
  });
  return renderRankingColumns(rankedResults, ({ result, rank }) => {
    const score = mode === 'points' ? `${result.points} Pkt.` : submissionCountLabel(result.votes, 'single');
    const isWinner = winners.has(result.gameId);
    const isTiedWinner = tiedWinners && isWinner;
    return `
      <div class="lb-row ${isWinner ? 'rank-1' : ''}${isTiedWinner ? ' is-tied' : ''}">
        <span class="lb-rank">${rank}</span>
                <span style="flex:1;min-width:0;">
          <div class="player-name" style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escapeHtml(result.gameName)}</div>
          <div class="muted" style="font-size:var(--font-size-xs);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${topMetaHtml(result)}</div>
        </span>
        <span class="lb-points">${score}</span>
      </div>`;
  });
}

// ---------- current vote: the most recent closed round, straight from history ----------

function renderCurrentVote({ allowRunoff = false } = {}) {
  if (historyLoading || historyCache === null) {
    return `<div class="empty-state vote-empty-state" style="padding:var(--space-4);">Lädt…</div>`;
  }
  if (historyCache.length === 0) {
    return `<div class="empty-state vote-empty-state" style="padding:var(--space-4);"><span class="empty-state-icon">${icon(domainIcon('votes'))}</span><span>Noch keine Abstimmung durchgeführt.</span></div>`;
  }
  const h = historyCache[0];
  if (!h.totalVoters) {
    return `<div class="empty-state vote-empty-state" style="padding:var(--space-4);">Niemand hat abgestimmt.</div>`;
  }
  const meta = [h.title, formatDateTime(h.closedAt), h.mode === 'single' ? 'Stichwahl' : null]
    .filter(Boolean)
    .map(escapeHtml)
    .join(' · ');
  const hasTie = h.winnerGameIds?.length > 1;
  return `
    <div class="muted vote-result-meta">${meta} · ${submissionCountLabel(h.totalVoters, h.mode)}</div>
    ${renderVoteRanking(h.results, h.mode, h.winnerGameIds)}
    ${
      hasTie && allowRunoff
        ? `<div class="vote-tie-action">
            <button type="button" class="btn btn-primary btn-block" id="votes-runoff">Stichwahl starten</button>
          </div>`
        : ''
    }`;
}

// ---------- history: list + reopen a past round's full detail ----------

function renderHistory() {
  if (historyLoading || historyCache === null) {
    return `<div class="empty-state vote-empty-state" style="padding:var(--space-4);">Lädt…</div>`;
  }
  if (historyCache.length === 0) {
    return `<div class="empty-state vote-empty-state" style="padding:var(--space-4);"><span class="empty-state-icon">${icon(domainIcon('votes'))}</span><span>Noch keine vergangenen Abstimmungen.</span></div>`;
  }
  // Each round stays visually separate and repeats the same compact ranking
  // used by "Letzter Vote". The detail action retains the full bar view.
  return historyCache
    .map((h) => {
      const title = h.title ? escapeHtml(h.title) : `Abstimmung Runde ${h.round}`;
      const mode = h.mode === 'single' ? ' · Stichwahl' : '';
      return `
        <div class="card stack vote-history-round" style="margin-bottom:var(--space-3);">
          <div class="row-between">
            <div class="stack" style="gap:var(--space-1);min-width:0;">
              <div class="player-name">${title}</div>
              <span class="muted vote-result-meta">${formatDateTime(h.closedAt)}${mode} · ${submissionCountLabel(h.totalVoters, h.mode)}</span>
            </div>
            <button type="button" class="btn btn-sm" data-open-history-round="${h.round}">Details</button>
          </div>
          ${h.info ? `<p class="muted" style="font-size:var(--font-size-xs);margin:0;">${escapeHtml(h.info)}</p>` : ''}
          ${h.totalVoters ? renderVoteRanking(h.results, h.mode, h.winnerGameIds) : '<div class="empty-state">Niemand hat abgestimmt.</div>'}
        </div>`;
    })
    .join('');
}

async function openHistoryRoundDetail(round) {
  const { el } = openModal('Lädt…', `<div class="empty-state">Lädt…</div>`);
  try {
    const detail = await api.votes.historyRound(round);
    const titleEl = el.querySelector('.modal-header h2');
    if (titleEl) titleEl.textContent = detail.title || `Abstimmung Runde ${detail.round}`;
    const bodyEl = el.querySelector('.modal-body');
    if (bodyEl) {
      bodyEl.innerHTML = `
        <div class="muted" style="font-size:var(--font-size-xs);margin-bottom:var(--space-3);">
          ${formatDateTime(detail.closedAt)}${detail.mode === 'single' ? ' · Stichwahl' : ''} ·
          ${detail.mode === 'points' ? `${detail.totalPoints} Punkt(e)` : `${detail.totalVotes} Stimme(n)`}
          von ${detail.totalVoters} Teilnehmer(n)
        </div>
        ${detail.info ? `<p class="muted" style="font-size:var(--font-size-xs);margin:0 0 var(--space-3);">${escapeHtml(detail.info)}</p>` : ''}
        ${renderClosedRows(detail.results, detail.mode, detail.winnerGameIds)}
      `;
    }
  } catch (err) {
    const bodyEl = el.querySelector('.modal-body');
    if (bodyEl) bodyEl.innerHTML = `<div class="empty-state">${escapeHtml(err.message)}</div>`;
  }
}

export function renderVotes(container, ctx) {
  lastCtx = ctx;
  ensureDragGuardInstalled();
  if (sliderDragActive) return;

  const votes = state.votes;
  if (!votes) {
    container.innerHTML = `<h1 class="view-title">Vote</h1><div class="empty-state">Lädt…</div>`;
    return;
  }

  if (historyCache === null && !historyLoading) {
    loadHistory(ctx);
  }

  const myId = getMyId();
  if (votes.open && myId) {
    const key = `${votes.round}:${myId}`;
    if (mineCacheKey !== key && !mineLoading) {
      loadMine(votes.round, myId, ctx);
    }
  }
  const mineReady = votes.open && myId && mineCacheKey === `${votes.round}:${myId}` && mineCache;
  const hasSubmitted = Boolean(mineReady && mineCache.size > 0);

  if (mineReady && draftKey !== mineCacheKey) {
    draftSingleGameId = votes.mode === 'single' ? [...mineCache.keys()][0] ?? null : null;
    draftPoints = new Map(mineCache);
    draftKey = mineCacheKey;
  }

  const whoAmI = whoAmICardHtml('whoami');
  const totalPlayers = state.players.length;

  let openSectionHtml = '';
  if (votes.open) {
    const modeLabel = votes.mode === 'single' ? 'Stichwahl' : '';
    const resultHelp =
      votes.mode === 'points'
        ? 'Die Punkteverteilung bleibt bis zum Ende der Abstimmung verborgen.'
        : 'Das Ergebnis bleibt bis zum Ende der Stichwahl verborgen.';
    const rows = `<div class="vote-game-grid">${renderOpenRows(votes, mineReady, hasSubmitted)}</div>`;
    const submitLabel = votes.mode === 'points' ? 'Bewertung abschicken' : 'Stimme abschicken';
    const submittedLabel = votes.mode === 'points' ? 'Bewertung abgegeben' : 'Stimme abgegeben';
    const participationLabel = votes.mode === 'points' ? 'Bewertungen abgegeben' : 'Stimmen abgegeben';
    openSectionHtml = `
      <section class="card vote-page-section vote-workflow-section stack" aria-labelledby="vote-current-title">
        <div class="tournament-create-step-title">
          <h2 id="vote-current-title" class="title-with-info">
            <span>${votes.title ? escapeHtml(votes.title) : 'Abstimmung läuft'}</span>
            ${infoTooltipHtml('vote-result-visibility-help', 'Verdeckte Auswertung', resultHelp)}
          </h2>
          ${modeLabel ? `<span class="muted">${modeLabel}</span>` : ''}
        </div>
        <div class="vote-participation-status" aria-label="${participationLabel}: ${votes.totalVoters} von ${totalPlayers}">
          <span>${participationLabel}</span>
          <strong>${votes.totalVoters} / ${totalPlayers}</strong>
        </div>
        ${votes.info ? `<p class="muted" style="font-size:var(--font-size-xs);margin:0;">${escapeHtml(votes.info)}</p>` : ''}
        ${rows}
        <div class="vote-action-stack sticky-actions">
          ${
            hasSubmitted
              ? `<div class="vote-submitted-state">${icon('circleCheck')} ${submittedLabel}</div>`
              : `<button type="button" class="btn btn-primary btn-block" id="votes-submit" ${mineReady ? '' : 'disabled'}>${submitLabel}</button>`
          }
          <div class="vote-secondary-actions">
            <button type="button" class="btn btn-danger btn-block" id="votes-cancel">Abbrechen</button>
            <button type="button" class="btn btn-block" id="votes-close">Beenden</button>
          </div>
        </div>
      </section>`;
  } else {
    const gameCheckboxes = state.games
      .map(
        (g) => `
        <label class="check-row">
          <input type="checkbox" data-vote-game-checkbox value="${g.id}" checked />
          <span class="row" style="flex:1;gap:var(--space-2);">${escapeHtml(g.name)}</span>
        </label>`
      )
      .join('');
    openSectionHtml = `
      <section class="card vote-page-section vote-workflow-section stack" aria-labelledby="vote-start-title">
        <div class="tournament-create-step-title">
          <h2 id="vote-start-title" class="title-with-info">
            <span>Neue Abstimmung</span>
            ${infoTooltipHtml(
                'vote-points-help',
                'Neue Abstimmung',
                'Punkte frei verteilen, höchste Summe gewinnt.'
              )}
          </h2>
        </div>
        <label class="stack" style="gap:var(--space-1);">
          <span class="muted" style="font-size:var(--font-size-xs);">Titel (optional)</span>
          <input type="text" id="votes-title" maxlength="80" placeholder="z.B. Samstagabend" />
        </label>
        <label class="stack" style="gap:var(--space-1);">
          <span class="muted" style="font-size:var(--font-size-xs);">Info (optional)</span>
          <textarea class="vote-info-input" id="votes-info" maxlength="500" rows="1" placeholder="z.B. Nur Spiele für 4 Leute"></textarea>
        </label>
        <div class="stack vote-game-filter">
          <label class="check-row">
            <input type="checkbox" id="votes-limit-games" />
            <span style="flex:1;">Nur bestimmte Spiele zur Wahl stellen</span>
          </label>
          <div id="votes-game-select-wrap" class="stack vote-game-select-wrap" hidden>
            <div class="row-between vote-game-select-toolbar">
              <span class="field-label">Welche Spiele stehen zur Wahl?</span>
              <button type="button" class="btn btn-sm" id="votes-select-toggle">Alle abwählen</button>
            </div>
            <div id="votes-game-select" class="vote-game-grid">${gameCheckboxes}</div>
          </div>
        </div>
        <div class="sticky-actions">
          <button type="button" class="btn btn-primary btn-block" id="votes-start">Abstimmung starten</button>
        </div>
      </section>`;
  }

  container.innerHTML = `
    <h1 class="view-title">Vote</h1>
    ${whoAmI}

    ${openSectionHtml}

    <section class="card vote-page-section stack" aria-labelledby="vote-current-result-title">
      <div class="tournament-create-step-title"><h2 id="vote-current-result-title">Letzter Vote</h2></div>
      ${renderCurrentVote({ allowRunoff: !votes.open })}
    </section>

    <section class="card vote-page-section stack" aria-labelledby="vote-top-games-title">
      <div class="tournament-create-step-title"><h2 id="vote-top-games-title">Top 10 nach Bock-Level</h2></div>
      ${renderTop10(votes.catalogResults)}
    </section>

    <details class="card history-details collapsible-section" data-vote-history ${historyOpen ? 'open' : ''}>
      <summary class="collapsible-section-header">
        <h2>Historie</h2>
        <span class="collapsible-section-summary-end">
          <span class="badge badge-offline">${historyCache?.length ?? 0}</span>
          <span class="collapsible-section-chevron">${icon('chevronRight')}</span>
        </span>
      </summary>
      <div class="collapsible-section-content">${renderHistory()}</div>
    </details>
  `;

  wireWhoAmICard(container, 'whoami', ctx);
  wireInfoTooltips(container);

  container.querySelector('[data-vote-history]')?.addEventListener('toggle', (event) => {
    historyOpen = event.currentTarget.open;
  });

  container.querySelectorAll('[data-vote-select]').forEach((btn) => {
    btn.addEventListener('click', () => {
      draftSingleGameId = btn.dataset.voteSelect;
      ctx.rerender();
    });
  });

  container.querySelectorAll('[data-points-slider]').forEach((slider) => {
    const gameId = slider.dataset.pointsSlider;
    const valueEl = slider.closest('[data-points-row]').querySelector('.skill-value');
    const updateSliderTone = () => {
      slider.style.setProperty('--slider-pct', `${(Number(slider.value) / 10) * 100}%`);
    };
    updateSliderTone();
    slider.addEventListener('pointerdown', () => {
      sliderDragActive = true;
    });
    slider.addEventListener('input', () => {
      valueEl.textContent = slider.value;
      const value = parseInt(slider.value, 10);
      if (value > 0) draftPoints.set(gameId, value);
      else draftPoints.delete(gameId);
      updateSliderTone();
    });
  });

  container.querySelectorAll('[data-open-history-round]').forEach((btn) => {
    btn.addEventListener('click', () => openHistoryRoundDetail(btn.dataset.openHistoryRound));
  });

  const submitBtn = container.querySelector('#votes-submit');
  if (submitBtn) {
    submitBtn.addEventListener('click', async () => {
      if (submitBtn.disabled) return;
      const playerId = getMyId();
      if (!playerId) return showToast('Bitte zuerst auswählen, wer du bist.', { error: true });
      if (votes.mode === 'single' && !draftSingleGameId) {
        return showToast('Bitte zuerst ein Spiel auswählen.', { error: true });
      }
      const entries = votes.mode === 'points'
        ? [...draftPoints.entries()].map(([gameId, points]) => ({ gameId, points }))
        : [];
      if (votes.mode === 'points' && entries.length === 0) {
        return showToast('Bitte mindestens ein Spiel bewerten.', { error: true });
      }
      submitBtn.disabled = true;
      try {
        if (votes.mode === 'single') {
          await api.votes.cast(playerId, draftSingleGameId);
        } else {
          await api.votes.castPoints(playerId, entries);
        }
        mineCache = null; // force a reload so the draft re-syncs with what the server now has
        mineCacheKey = null;
        await ctx.refresh();
        showToast('Deine Stimme wurde gezählt.');
      } catch (err) {
        submitBtn.disabled = false;
        showToast(err.message, { error: true });
      }
    });
  }

  const limitGamesCheckbox = container.querySelector('#votes-limit-games');
  const gameSelectWrap = container.querySelector('#votes-game-select-wrap');
  if (limitGamesCheckbox && gameSelectWrap) {
    limitGamesCheckbox.addEventListener('change', () => {
      gameSelectWrap.hidden = !limitGamesCheckbox.checked;
    });
  }

  const toggleBtn = container.querySelector('#votes-select-toggle');
  if (toggleBtn) {
    toggleBtn.addEventListener('click', () => {
      const boxes = [...container.querySelectorAll('[data-vote-game-checkbox]')];
      const allChecked = boxes.every((b) => b.checked);
      boxes.forEach((b) => (b.checked = !allChecked));
      toggleBtn.textContent = allChecked ? 'Alle auswählen' : 'Alle abwählen';
    });
  }

  const startBtn = container.querySelector('#votes-start');
  if (startBtn) {
    startBtn.addEventListener('click', async () => {
      const title = container.querySelector('#votes-title')?.value.trim() || undefined;
      const info = container.querySelector('#votes-info')?.value.trim() || undefined;
      let gameIds;
      if (limitGamesCheckbox?.checked) {
        const checkboxes = [...container.querySelectorAll('[data-vote-game-checkbox]')];
        const checked = checkboxes.filter((b) => b.checked).map((b) => b.value);
        if (checked.length === 0) {
          return showToast('Bitte mindestens ein Spiel auswählen.', { error: true });
        }
        gameIds = checked;
      }
      try {
        await api.votes.start({ mode: 'points', title, info, gameIds });
        await ctx.refresh();
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
        await api.votes.start({
          mode: 'single',
          title: lastClosed.title ? `Stichwahl: ${lastClosed.title}` : 'Stichwahl',
          gameIds: lastClosed.winners.map((w) => w.gameId),
        });
        await ctx.refresh();
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
        await api.votes.close();
        await ctx.refresh();
        showToast('Abstimmung beendet.');
      } catch (err) {
        showToast(err.message, { error: true });
      }
    });
  }

  const cancelBtn = container.querySelector('#votes-cancel');
  if (cancelBtn) {
    cancelBtn.addEventListener('click', async () => {
      if (!(await confirmDialog('Abstimmung wirklich abbrechen? Alle Stimmen gehen verloren.'))) return;
      try {
        await api.votes.cancel();
        await ctx.refresh();
        showToast('Abstimmung abgebrochen.');
      } catch (err) {
        showToast(err.message, { error: true });
      }
    });
  }
}
