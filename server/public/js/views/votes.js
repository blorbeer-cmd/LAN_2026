// "What's next?" voting view (FR-19..21). Voting needs to know WHO is voting;
// since the tool has no per-person login (just the shared access token),
// each phone remembers "who I am" locally so casting a vote is a single tap,
// not a form every time.
//
// Two modes (chosen when a round starts, see server/src/routes/votes.ts):
// - 'single': one tap picks a game, tapping another replaces it.
// - 'points': one slider per game, 0-10 points, 0 meaning "not rated" — as
//   many games as you like. Changing your mind just re-saves the whole set
//   (same fire-and-forget pattern as the skill/preference sliders in
//   profile.js).
// Either way, results are also sorted by each game's aggregate "Bock" rating
// (state.preferences, maintained per-player in profile.js) whenever the
// round's own score is tied — most visibly before anyone has voted yet, so
// the list starts out popularity-sorted instead of alphabetical.

import { api } from '../api.js';
import { state } from '../state.js';
import { escapeHtml, formatDate, formatDateTime, gameBadgeHtml } from '../format.js';
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

// The current player's own in-progress 'points' mode picks: Map<gameId,
// points>. Loaded once per (round, player) from the server (so switching
// devices or reopening the tab still shows what you already picked), then
// edited locally and fire-and-forget saved on every change.
let pointsDraft = null;
let pointsDraftKey = null;
let pointsDraftLoading = false;

async function loadPointsDraft(round, playerId, ctx) {
  pointsDraftLoading = true;
  try {
    const mine = await api.votes.mine(playerId);
    pointsDraft = new Map(mine.entries.map((e) => [e.gameId, e.points]));
  } catch {
    pointsDraft = new Map();
  } finally {
    pointsDraftKey = `${round}:${playerId}`;
    pointsDraftLoading = false;
    ctx.rerender();
  }
}

async function savePointsDraft(playerId) {
  if (!pointsDraft) return; // draft not loaded yet, nothing to save
  const entries = [...pointsDraft.entries()].map(([gameId, points]) => ({ gameId, points }));
  try {
    await api.votes.castPoints(playerId, entries);
  } catch (err) {
    showToast(err.message, { error: true });
  }
}

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
        <div class="lb-row" style="align-items:flex-start;">
          <div class="stack" style="gap:4px;flex:1;">
            <div class="chip-list">${winners}</div>
            <span class="muted" style="font-size:0.75rem;">${formatDateTime(h.closedAt)} · ${h.mode === 'points' ? 'Punkte-Modus' : 'Einzel-Wahl'}</span>
          </div>
          <span class="muted" style="font-size:0.8rem;flex-shrink:0;">${h.totalVotes} Stimme(n)</span>
        </div>`;
    })
    .join('');
}

function preferenceChipHtml(r) {
  if (!r.preferenceCount) {
    return `<span class="muted" style="font-size:0.78rem;">🔥 –</span>`;
  }
  return `<span class="muted" style="font-size:0.78rem;">🔥 Ø ${r.avgPreference.toFixed(1)} (${r.preferenceCount})</span>`;
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
  const pointsModeActive = votes.open && votes.mode === 'points';
  if (pointsModeActive && myId) {
    const key = `${votes.round}:${myId}`;
    if (pointsDraftKey !== key && !pointsDraftLoading) {
      loadPointsDraft(votes.round, myId, ctx);
    }
  }
  const draftReady = pointsModeActive && myId && pointsDraftKey === `${votes.round}:${myId}` && pointsDraft;

  const whoAmI = whoAmICardHtml('whoami');

  const maxScore = Math.max(1, ...votes.results.map((r) => r.score));
  const rows = votes.results
    .map((r) => {
      const isTop = r.score > 0 && r.score === maxScore;
      const history =
        r.playCount > 0
          ? `zuletzt gespielt: ${formatDate(r.lastPlayedAt)} · ${r.playCount}× gespielt`
          : 'noch nie gespielt';
      const scoreLabel =
        votes.mode === 'points' ? `${r.points} Punkt(e)${r.votes ? ` · ${r.votes} Spieler` : ''}` : `${r.votes} Stimme(n)`;

      let action = '';
      let pointsSliderRow = '';
      if (votes.open && votes.mode === 'single') {
        action = `<button type="button" class="btn btn-sm" data-vote-game="${r.gameId}">Abstimmen</button>`;
      } else if (votes.open && votes.mode === 'points') {
        if (!draftReady) {
          pointsSliderRow = `<div class="muted" style="font-size:0.78rem;padding:4px 0 0;">Lädt deine Punkte…</div>`;
        } else {
          const pointsVal = pointsDraft.get(r.gameId) ?? 0;
          pointsSliderRow = `
            <div class="skill-row" data-points-row="${r.gameId}" style="padding:4px 0 0;">
              <span class="muted" style="font-size:0.78rem;">Punkte</span>
              <span class="skill-value">${pointsVal}</span>
              <input type="range" class="skill-row-slider" min="0" max="10" step="1"
                     data-points-slider="${r.gameId}" value="${pointsVal}" />
            </div>`;
        }
      }

      return `
        <div class="vote-row ${isTop ? 'is-winner' : ''}">
          <div class="row-between">
            <span class="row" style="gap:8px;">${gameBadgeHtml({ id: r.gameId, icon: r.icon }, 24)} ${escapeHtml(r.gameName)}</span>
            <span class="muted">${scoreLabel}</span>
          </div>
          <div class="vote-bar-track"><div class="vote-bar-fill" style="width:${(r.score / maxScore) * 100}%"></div></div>
          <div class="row-between">
            <span class="row" style="gap:10px;">
              <span class="muted" style="font-size:0.78rem;">${history}</span>
              ${preferenceChipHtml(r)}
            </span>
            ${action}
          </div>
          ${pointsSliderRow}
        </div>`;
    })
    .join('');

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
          <span style="flex:1;">🔢 Punkte-Modus – jedes Spiel mit 0-10 Punkten bewerten</span>
        </label>
        <button type="button" class="btn btn-primary btn-block" id="votes-start">Abstimmung starten</button>
      </div>`;

  const summary = votes.open
    ? votes.mode === 'points'
      ? `🟢 Abstimmung läuft (Punkte-Modus) · ${votes.totalPoints} Punkt(e) von ${votes.totalVoters} Teilnehmer(n)`
      : `🟢 Abstimmung läuft (Einzel-Wahl) · Gesamt: ${votes.totalVotes} Stimme(n)`
    : '⚪ Keine offene Abstimmung';

  const draftHint =
    pointsModeActive && myId && draftReady
      ? `<div class="muted" style="font-size:0.78rem;margin-top:4px;">${pointsDraft.size} Spiel(e) bewertet – Änderungen speichern automatisch.</div>`
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
    <div class="card">${renderHistory()}</div>
  `;

  wireWhoAmICard(container, 'whoami', ctx);

  container.querySelectorAll('[data-vote-game]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const playerId = getMyId();
      if (!playerId) return showToast('Bitte zuerst auswählen, wer du bist.', { error: true });
      try {
        await api.votes.cast(playerId, btn.dataset.voteGame);
        await ctx.refresh();
        showToast('Stimme gezählt.');
      } catch (err) {
        showToast(err.message, { error: true });
      }
    });
  });

  container.querySelectorAll('[data-points-slider]').forEach((slider) => {
    const gameId = slider.dataset.pointsSlider;
    const valueEl = slider.closest('[data-points-row]').querySelector('.skill-value');
    let debounceTimer = null;
    slider.addEventListener('input', () => {
      const playerId = getMyId();
      if (!playerId) return;
      valueEl.textContent = slider.value;
      const value = parseInt(slider.value, 10);
      if (value > 0) pointsDraft.set(gameId, value);
      else pointsDraft.delete(gameId); // 0 = not rating this game
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => savePointsDraft(playerId), 300);
    });
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
