// "What's next?" voting view (FR-19..21). Voting needs to know WHO is voting;
// since the tool has no per-person login (just the shared access token),
// each phone remembers "who I am" locally so casting a vote is a single tap,
// not a form every time.
//
// While a round is open, nobody sees how votes/points are distributed across
// games yet — only the server-side final tally, once closed, may influence
// anyone (no watching a leader emerge and piling onto it). The view only
// shows: the list of games to vote/rate, your own already-cast pick(s) (your
// own choice, not the aggregate), and how many people have participated so
// far (momentum, not a per-game breakdown). Full bars/rankings appear the
// moment the round closes, and past rounds stay inspectable afterwards via
// the history list.
//
// Two modes (chosen when a round starts, see server/src/routes/votes.ts):
// - 'single': one tap picks a game, tapping another replaces it.
// - 'points': distribute 1-10 points across up to 5 games; changing your
//   mind just re-saves the whole set (same fire-and-forget pattern as the
//   skill/preference sliders in profile.js).
// Either way, closed-round results are also sorted by each game's aggregate
// "Bock" rating (state.preferences, maintained per-player in profile.js)
// whenever the round's own score is tied.

import { api } from '../api.js';
import { state } from '../state.js';
import { escapeHtml, formatDate, formatDateTime, gameBadgeHtml } from '../format.js';
import { openModal } from '../modal.js';
import { showToast } from '../toast.js';
import { getMyId, whoAmICardHtml, wireWhoAmICard } from '../whoami.js';

const MAX_POINT_GAMES = 5;

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

// The current player's own entries in the running round — for 'points' mode
// this reconstructs the multi-select UI (which games, how many points each);
// for 'single' mode it's just "did I already vote, and for what" so tapping
// a different game reads as changing your mind rather than a fresh pick with
// no feedback. Either way this is the player's OWN submission, not the
// aggregate, so showing it while the round is open doesn't leak anything
// about how the vote is trending.
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

async function savePointsDraft(playerId) {
  if (!mineCache || mineCache.size === 0) return; // nothing valid to save yet
  const entries = [...mineCache.entries()].map(([gameId, points]) => ({ gameId, points }));
  try {
    await api.votes.castPoints(playerId, entries);
  } catch (err) {
    showToast(err.message, { error: true });
  }
}

function preferenceChipHtml(r) {
  if (!r.preferenceCount) {
    return `<span class="muted" style="font-size:0.78rem;">🔥 –</span>`;
  }
  return `<span class="muted" style="font-size:0.78rem;">🔥 Ø ${r.avgPreference.toFixed(1)} (${r.preferenceCount})</span>`;
}

function lastPlayedHtml(r) {
  return r.playCount > 0 ? `zuletzt gespielt: ${formatDate(r.lastPlayedAt)} · ${r.playCount}× gespielt` : 'noch nie gespielt';
}

// ---------- open round: cast your vote, no distribution shown ----------

function renderOpenRows(votes, myId, mine, mineReady) {
  return votes.results
    .map((r) => {
      let action = '';
      if (votes.mode === 'single') {
        const isMine = mineReady && mine.has(r.gameId);
        action = `<button type="button" class="btn btn-sm ${isMine ? 'btn-primary' : ''}" data-vote-game="${r.gameId}">${isMine ? '✓ Deine Stimme' : 'Abstimmen'}</button>`;
      } else {
        if (!mineReady) {
          action = `<span class="muted" style="font-size:0.78rem;">Lädt…</span>`;
        } else {
          const checked = mine.has(r.gameId);
          const pointsVal = checked ? mine.get(r.gameId) : 5;
          action = `
            <span class="row" style="gap:8px;align-items:center;">
              <label class="row" style="gap:6px;align-items:center;">
                <input type="checkbox" data-points-game="${r.gameId}" ${checked ? 'checked' : ''} />
                <span class="muted" style="font-size:0.78rem;">dabei</span>
              </label>
              ${
                checked
                  ? `<input type="number" min="1" max="10" step="1" data-points-value="${r.gameId}" value="${pointsVal}" style="width:52px;" />`
                  : ''
              }
            </span>`;
        }
      }

      return `
        <div class="vote-row">
          <div class="row-between">
            <span class="row" style="gap:8px;">${gameBadgeHtml({ id: r.gameId, icon: r.icon }, 24)} ${escapeHtml(r.gameName)}</span>
            ${action}
          </div>
          <div class="row-between">
            <span class="row" style="gap:10px;">
              <span class="muted" style="font-size:0.78rem;">${lastPlayedHtml(r)}</span>
              ${preferenceChipHtml(r)}
            </span>
          </div>
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
            <span class="row" style="gap:8px;">${gameBadgeHtml({ id: r.gameId, icon: r.icon }, 24)} ${escapeHtml(r.gameName)}</span>
            <span class="muted">${scoreLabel}</span>
          </div>
          <div class="vote-bar-track"><div class="vote-bar-fill" style="width:${(r.score / maxScore) * 100}%"></div></div>
          <div class="row-between">
            <span class="row" style="gap:10px;">
              <span class="muted" style="font-size:0.78rem;">${lastPlayedHtml(r)}</span>
              ${preferenceChipHtml(r)}
            </span>
          </div>
        </div>`;
    })
    .join('');
}

// ---------- history: list + reopen a past round's full detail ----------

function renderHistory() {
  if (historyLoading || historyCache === null) {
    return `<div class="empty-state" style="padding:16px;">Lädt…</div>`;
  }
  if (historyCache.length === 0) {
    return `<div class="empty-state" style="padding:16px;"><span class="emoji">🗳️</span>Noch keine vergangenen Abstimmungen.</div>`;
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
          <div class="stack" style="gap:4px;flex:1;">
            <div class="chip-list">${winners}</div>
            <span class="muted" style="font-size:0.75rem;">${formatDateTime(h.closedAt)} · ${h.mode === 'points' ? 'Punkte-Modus' : 'Einzel-Wahl'}</span>
          </div>
          <span class="muted" style="font-size:0.8rem;flex-shrink:0;">${h.totalVotes} Stimme(n) ›</span>
        </button>`;
    })
    .join('');
}

async function openHistoryRoundDetail(round) {
  const { el } = openModal('Lädt…', `<div class="empty-state">Lädt…</div>`);
  try {
    const detail = await api.votes.historyRound(round);
    const titleEl = el.querySelector('.modal-header h2');
    if (titleEl) titleEl.textContent = `🗳️ Abstimmung Runde ${detail.round}`;
    const bodyEl = el.querySelector('.modal-body');
    if (bodyEl) {
      bodyEl.innerHTML = `
        <div class="muted" style="font-size:0.8rem;margin-bottom:10px;">
          ${formatDateTime(detail.closedAt)} · ${detail.mode === 'points' ? 'Punkte-Modus' : 'Einzel-Wahl'} ·
          ${detail.mode === 'points' ? `${detail.totalPoints} Punkt(e)` : `${detail.totalVotes} Stimme(n)`}
          von ${detail.totalVoters} Teilnehmer(n)
        </div>
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

  const whoAmI = whoAmICardHtml('whoami');

  const rows = votes.open
    ? renderOpenRows(votes, myId, mineReady ? mineCache : new Map(), Boolean(mineReady))
    : renderClosedRows(votes.results, votes.mode, votes.winnerGameIds);

  const controls = votes.open
    ? `
      <div class="row">
        <button type="button" class="btn btn-primary" id="votes-close" style="flex:1;">Beenden &amp; Gewinner küren</button>
        <button type="button" class="btn btn-danger" id="votes-cancel">Abbrechen</button>
      </div>`
    : `
      <div class="card stack">
        <div class="section-title" style="margin-bottom:0;">Neue Abstimmung starten</div>
        <label class="check-row">
          <input type="radio" name="vote-mode" value="single" checked />
          <span style="flex:1;">🗳️ Einzel-Wahl – eine Stimme pro Person</span>
        </label>
        <label class="check-row">
          <input type="radio" name="vote-mode" value="points" />
          <span style="flex:1;">🔢 Punkte-Modus – bis zu ${MAX_POINT_GAMES} Spiele mit 1-10 Punkten bewerten</span>
        </label>
        <button type="button" class="btn btn-primary btn-block" id="votes-start">Abstimmung starten</button>
      </div>`;

  const summary = votes.open
    ? votes.mode === 'points'
      ? `🟢 Abstimmung läuft (Punkte-Modus) · ${votes.totalVoters} Teilnehmer bisher – Verteilung gibt's erst nach dem Ende`
      : `🟢 Abstimmung läuft (Einzel-Wahl) · ${votes.totalVoters} Stimme(n) bisher – Ergebnis gibt's erst nach dem Ende`
    : '⚪ Keine offene Abstimmung';

  const draftHint =
    votes.open && votes.mode === 'points' && mineReady
      ? `<div class="muted" style="font-size:0.78rem;margin-top:4px;">${mineCache.size}/${MAX_POINT_GAMES} Spiele ausgewählt – Änderungen speichern automatisch.</div>`
      : '';

  container.innerHTML = `
    <h1 class="view-title">Was zocken wir als Nächstes?</h1>
    ${whoAmI}
    <div class="card stack" style="margin-top:12px;">
      <div class="muted">${summary}</div>
      ${draftHint}
      ${rows}
    </div>
    <div style="margin-top:12px;">${controls}</div>

    <div class="section-title">🕓 Vote-Historie</div>
    <p class="muted" style="font-size:0.78rem;margin:-4px 0 8px;">Antippen für die genaue Punkteverteilung dieser Runde.</p>
    <div class="card">${renderHistory()}</div>
  `;

  wireWhoAmICard(container, 'whoami', ctx);

  container.querySelectorAll('[data-vote-game]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const playerId = getMyId();
      if (!playerId) return showToast('Bitte zuerst auswählen, wer du bist.', { error: true });
      try {
        await api.votes.cast(playerId, btn.dataset.voteGame);
        mineCache = null; // force a reload so the "✓ Deine Stimme" state reflects the new pick
        mineCacheKey = null;
        await ctx.refresh();
        showToast('Stimme gezählt.');
      } catch (err) {
        showToast(err.message, { error: true });
      }
    });
  });

  container.querySelectorAll('[data-points-game]').forEach((cb) => {
    cb.addEventListener('change', () => {
      const playerId = getMyId();
      if (!playerId) {
        cb.checked = false;
        return showToast('Bitte zuerst auswählen, wer du bist.', { error: true });
      }
      const gameId = cb.dataset.pointsGame;
      if (cb.checked) {
        if (mineCache.size >= MAX_POINT_GAMES) {
          cb.checked = false;
          return showToast(`Maximal ${MAX_POINT_GAMES} Spiele auswählen.`, { error: true });
        }
        mineCache.set(gameId, 5);
      } else {
        mineCache.delete(gameId);
      }
      ctx.rerender(); // show/hide the points input for this row
      savePointsDraft(playerId);
    });
  });

  container.querySelectorAll('[data-points-value]').forEach((input) => {
    let debounceTimer = null;
    input.addEventListener('input', () => {
      const playerId = getMyId();
      if (!playerId) return;
      const gameId = input.dataset.pointsValue;
      const value = Math.min(10, Math.max(1, parseInt(input.value, 10) || 1));
      mineCache.set(gameId, value);
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => savePointsDraft(playerId), 300);
    });
  });

  container.querySelectorAll('[data-open-history-round]').forEach((btn) => {
    btn.addEventListener('click', () => openHistoryRoundDetail(btn.dataset.openHistoryRound));
  });

  const startBtn = container.querySelector('#votes-start');
  if (startBtn) {
    startBtn.addEventListener('click', async () => {
      const mode = container.querySelector('input[name="vote-mode"]:checked')?.value || 'single';
      try {
        await api.votes.start(mode);
        await ctx.refresh();
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
      if (!confirm('Abstimmung wirklich abbrechen? Alle Stimmen gehen verloren.')) return;
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
