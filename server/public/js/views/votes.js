// "What's next?" voting view (FR-19..21). Voting needs to know WHO is voting;
// since the tool has no per-person login (just the shared access token),
// each phone remembers "who I am" locally so casting a vote takes no form.
//
// Layout, top to bottom:
// 1. The last (closed) round's result, pulled straight from the history —
//    always visible, so you see what just got decided without digging.
// 2. The current Top 5 by aggregate "Bock" rating — always visible,
//    read-only (no vote controls), so there's always something useful on
//    screen even with no vote running.
// 3. Either "start a new round" controls (idle), or the full interactive
//    game list plus a submit button (round open) — the rest of the catalog
//    only appears once a round is actually running.
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
import { escapeHtml, formatDate, formatDateTime, gameBadgeHtml } from '../format.js';
import { openModal, confirmDialog } from '../modal.js';
import { showToast } from '../toast.js';
import { getMyId, whoAmICardHtml, wireWhoAmICard } from '../whoami.js';

// Cached separately from `state` (like analytics.js does) since it's fetched
// from its own endpoint, not part of the main loadAll() round-trip.
let historyCache = null;
let historyLoading = false;

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

// The current player's own already-submitted entries in the running round —
// for 'points' mode this is which games, how many points each; for 'single'
// mode it's just "did I already vote, and for what". Used only to seed the
// local draft (see below) once per round/player, not rendered directly.
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

function preferenceChipHtml(r) {
  if (!r.preferenceCount) {
    return `<span class="muted" style="font-size:var(--font-size-xs);">🔥 –</span>`;
  }
  return `<span class="muted" style="font-size:var(--font-size-xs);">🔥 Ø ${r.avgPreference.toFixed(1)} (${r.preferenceCount})</span>`;
}

function lastPlayedHtml(r) {
  return r.playCount > 0 ? `zuletzt gespielt: ${formatDate(r.lastPlayedAt)} · ${r.playCount}× gespielt` : 'noch nie gespielt';
}

function playtimeChipHtml(r) {
  return `<span class="muted" style="font-size:var(--font-size-xs);">${icon('timer')} ${r.totalPlaytimeMs > 0 ? r.totalPlaytimeFormatted : '–'}</span>`;
}

function winCountChipHtml(r) {
  return `<span class="muted" style="font-size:var(--font-size-xs);">🏆 ${r.voteWinCount}× gewonnen</span>`;
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

// ---------- Top 5 by aggregate "Bock" rating: always visible, read-only ----------

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
    r.voteWinCount > 0 ? `🏆 ${r.voteWinCount}×` : null,
  ].filter(Boolean);
  return parts.join(' · ');
}

// Reuses the leaderboard's .lb-row (icon-led, single line, rank + a value
// pinned right) instead of the old full .vote-row block — a "Bock" ranking
// doesn't need its own two-line stats block per game to be useful at a
// glance.
function renderTop5(results) {
  const top5 = topByPreference(results, 5);
  if (top5.length === 0) {
    return `<div class="empty-state" style="padding:var(--space-4);">Noch keine Spiele im Katalog.</div>`;
  }
  return top5
    .map(
      (r, i) => `
        <div class="lb-row">
          <span class="lb-rank">${i + 1}</span>
          ${gameBadgeHtml({ id: r.gameId, icon: r.icon }, 28)}
          <span style="flex:1;min-width:0;">
            <div class="player-name" style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escapeHtml(r.gameName)}</div>
            <div class="muted" style="font-size:var(--font-size-xs);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${topMetaHtml(r)}</div>
          </span>
          <span class="lb-points">${r.preferenceCount ? `🔥 ${r.avgPreference.toFixed(1)}` : '🔥 –'}</span>
        </div>`
    )
    .join('');
}

// ---------- open round: stage a local draft, submit explicitly ----------

function renderOpenRows(votes, draftReady) {
  return votes.results
    .map((r) => {
      let action = '';
      let pointsSliderRow = '';
      if (!draftReady) {
        pointsSliderRow = `<div class="muted" style="font-size:var(--font-size-xs);padding:var(--space-1) 0 0;">Lädt deine Auswahl…</div>`;
      } else if (votes.mode === 'single') {
        const isSelected = draftSingleGameId === r.gameId;
        action = `<button type="button" class="btn btn-sm ${isSelected ? 'btn-primary' : ''}" data-vote-select="${r.gameId}">${isSelected ? '✓ Ausgewählt' : 'Auswählen'}</button>`;
      } else {
        const pointsVal = draftPoints.get(r.gameId) ?? 0;
        pointsSliderRow = `
          <div class="skill-row" data-points-row="${r.gameId}" style="padding:var(--space-1) 0 0;">
            <span class="muted" style="font-size:var(--font-size-xs);">Punkte</span>
            <span class="skill-value">${pointsVal}</span>
            <input type="range" class="skill-row-slider" min="0" max="10" step="1"
                   data-points-slider="${r.gameId}" value="${pointsVal}" />
          </div>`;
      }

      return `
        <div class="vote-row">
          <div class="row-between">
            <span class="row" style="gap:var(--space-2);">${gameBadgeHtml({ id: r.gameId, icon: r.icon }, 24)} ${escapeHtml(r.gameName)}</span>
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
  const maxScore = Math.max(1, ...results.map((r) => r.score));
  return results
    .map((r) => {
      const isWinner = winnerGameIds ? winnerGameIds.includes(r.gameId) : r.score > 0 && r.score === maxScore;
      const scoreLabel =
        mode === 'points' ? `${r.points} Punkt(e)${r.votes ? ` · ${r.votes} Spieler` : ''}` : `${r.votes} Stimme(n)`;
      return `
        <div class="vote-row ${isWinner ? 'is-winner' : ''}">
          <div class="row-between">
            <span class="row" style="gap:var(--space-2);">${gameBadgeHtml({ id: r.gameId, icon: r.icon }, 24)} ${escapeHtml(r.gameName)}</span>
            <span class="muted">${scoreLabel}</span>
          </div>
          <div class="vote-bar-track"><div class="vote-bar-mask" style="width:${100 - (r.score / maxScore) * 100}%"></div></div>
          ${statsRowHtml(r)}
        </div>`;
    })
    .join('');
}

// ---------- last result: the most recent closed round, straight from history ----------

function renderLastResult() {
  if (historyLoading || historyCache === null) {
    return `<div class="empty-state" style="padding:var(--space-4);">Lädt…</div>`;
  }
  if (historyCache.length === 0) {
    return `<div class="empty-state" style="padding:var(--space-4);"><span class="emoji">🗳️</span>Noch keine Abstimmung durchgeführt.</div>`;
  }
  const h = historyCache[0];
  const winners = h.winners.length
    ? h.winners
        .map((w) => {
          const points = h.mode === 'points' && w.points > 0 ? ` · ${w.points} Pkt.` : '';
          const voteCount = h.mode !== 'points' && w.votes > 0 ? ` · ${w.votes} Stimme(n)` : '';
          return `<span class="chip">${gameBadgeHtml({ id: w.gameId, icon: w.icon }, 24)} ${escapeHtml(w.gameName)}${points}${voteCount}</span>`;
        })
        .join('')
    : `<span class="muted">Niemand hat abgestimmt</span>`;
  return `
    <div class="stack" style="gap:var(--space-2);padding:var(--space-1) 0;">
      ${h.title ? `<div class="player-name">${escapeHtml(h.title)}</div>` : ''}
      <div class="chip-list">${winners}</div>
      <span class="muted" style="font-size:var(--font-size-xs);">
        ${formatDateTime(h.closedAt)} · ${h.mode === 'points' ? 'Punkte-Modus' : 'Stichwahl'} · ${h.totalVotes} Stimme(n)
      </span>
    </div>`;
}

// ---------- history: list + reopen a past round's full detail ----------

function renderHistory() {
  if (historyLoading || historyCache === null) {
    return `<div class="empty-state" style="padding:var(--space-4);">Lädt…</div>`;
  }
  if (historyCache.length === 0) {
    return `<div class="empty-state" style="padding:var(--space-4);"><span class="emoji">🗳️</span>Noch keine vergangenen Abstimmungen.</div>`;
  }
  return historyCache
    .map((h) => {
      const winners = h.winners.length
        ? h.winners
            .map((w) => {
              const points = h.mode === 'points' && w.points > 0 ? ` · ${w.points} Pkt.` : '';
              return `<span class="chip">${gameBadgeHtml({ id: w.gameId, icon: w.icon }, 20)} ${escapeHtml(w.gameName)}${points}</span>`;
            })
            .join('')
        : `<span class="muted">Niemand hat abgestimmt</span>`;
      return `
        <button type="button" class="lb-row" style="align-items:flex-start;width:100%;text-align:left;background:none;border:none;cursor:pointer;" data-open-history-round="${h.round}">
          <div class="stack" style="gap:var(--space-1);flex:1;">
            ${h.title ? `<div class="player-name">${escapeHtml(h.title)}</div>` : ''}
            <div class="chip-list">${winners}</div>
            <span class="muted" style="font-size:var(--font-size-xs);">${formatDateTime(h.closedAt)} · ${h.mode === 'points' ? 'Punkte-Modus' : 'Stichwahl'}</span>
          </div>
          <span class="muted" style="font-size:var(--font-size-xs);flex-shrink:0;">${h.totalVotes} Stimme(n) ›</span>
        </button>`;
    })
    .join('');
}

async function openHistoryRoundDetail(round) {
  const { el } = openModal('Lädt…', `<div class="empty-state">Lädt…</div>`);
  try {
    const detail = await api.votes.historyRound(round);
    const titleEl = el.querySelector('.modal-header h2');
    if (titleEl) titleEl.textContent = detail.title ? `🗳️ ${detail.title}` : `🗳️ Abstimmung Runde ${detail.round}`;
    const bodyEl = el.querySelector('.modal-body');
    if (bodyEl) {
      bodyEl.innerHTML = `
        <div class="muted" style="font-size:var(--font-size-xs);margin-bottom:var(--space-3);">
          ${formatDateTime(detail.closedAt)} · ${detail.mode === 'points' ? 'Punkte-Modus' : 'Stichwahl'} ·
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
  const votes = state.votes;
  if (!votes) {
    container.innerHTML = `<h1 class="view-title">Abstimmung</h1><div class="empty-state">Lädt…</div>`;
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

  if (mineReady && draftKey !== mineCacheKey) {
    draftSingleGameId = votes.mode === 'single' ? [...mineCache.keys()][0] ?? null : null;
    draftPoints = new Map(mineCache);
    draftKey = mineCacheKey;
  }

  const whoAmI = whoAmICardHtml('whoami');
  const totalPlayers = state.players.length;

  let openSectionHtml = '';
  let runoffSectionHtml = '';
  if (votes.open) {
    const summary =
      votes.mode === 'points'
        ? `🟢 Abstimmung läuft (Punkte-Modus) · ${votes.totalVoters} von ${totalPlayers} haben abgestimmt – Verteilung gibt's erst nach dem Ende`
        : `🟢 Stichwahl läuft · ${votes.totalVoters} von ${totalPlayers} haben abgestimmt – Ergebnis gibt's erst nach dem Ende`;
    const rows = renderOpenRows(votes, mineReady);
    const submitLabel = votes.mode === 'points' ? 'Bewertung abschicken' : 'Stimme abschicken';
    openSectionHtml = `
      <div class="section-title">🗳️ ${votes.title ? escapeHtml(votes.title) : 'Abstimmung'}</div>
      <div class="card stack">
        <div class="muted">${summary}</div>
        ${votes.info ? `<p class="muted" style="font-size:var(--font-size-xs);margin:0;">${escapeHtml(votes.info)}</p>` : ''}
        ${rows}
        <button type="button" class="btn btn-primary btn-block" id="votes-submit" ${mineReady ? '' : 'disabled'}>${submitLabel}</button>
      </div>
      <div class="row" style="margin-top:var(--space-3);">
        <button type="button" class="btn btn-primary" id="votes-close" style="flex:1;">Beenden &amp; Gewinner küren</button>
        <button type="button" class="btn btn-danger" id="votes-cancel">Abbrechen</button>
      </div>`;
  } else {
    // Only offered right after a round closed in a tie (several games sharing
    // top score) — a one-tap way to settle it instead of manually starting
    // a fresh round and re-picking the games by hand.
    const lastClosed = historyCache && historyCache.length ? historyCache[0] : null;
    if (lastClosed && lastClosed.winners.length > 1) {
      const tiedChips = lastClosed.winners
        .map((w) => `<span class="chip">${gameBadgeHtml({ id: w.gameId, icon: w.icon }, 24)} ${escapeHtml(w.gameName)}</span>`)
        .join('');
      runoffSectionHtml = `
        <div class="card stack">
          <div class="section-title" style="margin-bottom:0;">🤝 Unentschieden</div>
          <div class="chip-list">${tiedChips}</div>
          <button type="button" class="btn btn-primary btn-block" id="votes-runoff">Stichwahl starten</button>
        </div>`;
    }

    const gameCheckboxes = state.games
      .map(
        (g) => `
        <label class="check-row">
          <input type="checkbox" data-vote-game-checkbox value="${g.id}" checked />
          <span class="row" style="flex:1;gap:var(--space-2);">${gameBadgeHtml(g, 24)} ${escapeHtml(g.name)}</span>
        </label>`
      )
      .join('');
    openSectionHtml = `
      <div class="card stack">
        <div class="section-title" style="margin-bottom:0;">Neue Abstimmung starten</div>
        <p class="muted" style="font-size:var(--font-size-xs);margin:0;">
          🔢 Jede:r verteilt 0–10 Punkte auf beliebig viele Spiele. Nach dem Beenden gewinnt die höchste Punktzahl.
        </p>
        <label class="stack" style="gap:var(--space-1);">
          <span class="muted" style="font-size:var(--font-size-xs);">Titel (optional)</span>
          <input type="text" id="votes-title" maxlength="80" placeholder="z.B. Samstagabend" />
        </label>
        <label class="stack" style="gap:var(--space-1);">
          <span class="muted" style="font-size:var(--font-size-xs);">Info (optional)</span>
          <textarea id="votes-info" maxlength="500" rows="2" placeholder="z.B. Nur Spiele für 4 Leute"></textarea>
        </label>
        <div class="stack" style="gap:var(--space-1);">
          <label class="check-row">
            <input type="checkbox" id="votes-limit-games" />
            <span style="flex:1;">Nur bestimmte Spiele zur Wahl stellen</span>
          </label>
          <div id="votes-game-select-wrap" style="display:none;">
            <div class="row-between">
              <span class="muted" style="font-size:var(--font-size-xs);">Welche Spiele stehen zur Wahl?</span>
              <button type="button" class="btn btn-sm" id="votes-select-toggle">Alle abwählen</button>
            </div>
            <div id="votes-game-select">${gameCheckboxes}</div>
          </div>
        </div>
        <button type="button" class="btn btn-primary btn-block" id="votes-start">Abstimmung starten</button>
      </div>`;
  }

  container.innerHTML = `
    <h1 class="view-title">Was zocken wir als Nächstes?</h1>
    ${whoAmI}

    <div class="section-title">🏆 Letztes Ergebnis</div>
    <div class="card">${renderLastResult()}</div>

    <div class="section-title">🔥 Top 5 nach Bock-Level</div>
    <div class="card">${renderTop5(votes.results)}</div>

    ${runoffSectionHtml}
    ${openSectionHtml}

    <div class="section-title">${icon('timer')} Vote-Historie</div>
    <p class="muted" style="font-size:var(--font-size-xs);margin:calc(var(--space-1) * -1) 0 var(--space-2);">Antippen für die genaue Punkteverteilung dieser Runde.</p>
    <div class="card">${renderHistory()}</div>
  `;

  wireWhoAmICard(container, 'whoami', ctx);

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
      const playerId = getMyId();
      if (!playerId) return showToast('Bitte zuerst auswählen, wer du bist.', { error: true });
      if (votes.mode === 'single' && !draftSingleGameId) {
        return showToast('Bitte zuerst ein Spiel auswählen.', { error: true });
      }
      try {
        if (votes.mode === 'single') {
          await api.votes.cast(playerId, draftSingleGameId);
        } else {
          const entries = [...draftPoints.entries()].map(([gameId, points]) => ({ gameId, points }));
          await api.votes.castPoints(playerId, entries);
        }
        mineCache = null; // force a reload so the draft re-syncs with what the server now has
        mineCacheKey = null;
        await ctx.refresh();
        showToast('Deine Stimme wurde gezählt.');
      } catch (err) {
        showToast(err.message, { error: true });
      }
    });
  }

  const limitGamesCheckbox = container.querySelector('#votes-limit-games');
  const gameSelectWrap = container.querySelector('#votes-game-select-wrap');
  if (limitGamesCheckbox && gameSelectWrap) {
    limitGamesCheckbox.addEventListener('change', () => {
      gameSelectWrap.style.display = limitGamesCheckbox.checked ? '' : 'none';
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
