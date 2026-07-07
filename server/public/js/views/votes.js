// "What's next?" voting view (FR-19..21). Voting needs to know WHO is voting;
// since the tool has no per-person login (just the shared access token),
// each phone remembers "who I am" locally so casting a vote is a single tap,
// not a form every time.

import { api } from '../api.js';
import { state } from '../state.js';
import { escapeHtml, formatDate } from '../format.js';
import { showToast } from '../toast.js';

const MY_ID_KEY = 'lan2026_my_player_id';

function getMyId() {
  return localStorage.getItem(MY_ID_KEY) || '';
}
function setMyId(id) {
  localStorage.setItem(MY_ID_KEY, id);
}

export function renderVotes(container, ctx) {
  const votes = state.votes;
  if (!votes) {
    container.innerHTML = `<h1 class="view-title">Abstimmung</h1><div class="empty-state">Lädt…</div>`;
    return;
  }

  const myId = getMyId();
  const whoAmI = `
    <div class="card row">
      <span style="flex:1;">Wer bist du?</span>
      <select id="whoami">
        <option value="">– wählen –</option>
        ${state.players.map((p) => `<option value="${p.id}" ${p.id === myId ? 'selected' : ''}>${escapeHtml(p.name)}</option>`).join('')}
      </select>
    </div>
  `;

  const maxVotes = Math.max(1, ...votes.results.map((r) => r.votes));
  const rows = votes.results
    .map((r) => {
      const isTop = r.votes > 0 && r.votes === maxVotes;
      const history =
        r.playCount > 0
          ? `zuletzt gespielt: ${formatDate(r.lastPlayedAt)} · ${r.playCount}× gespielt`
          : 'noch nie gespielt';
      return `
        <div class="vote-row ${isTop ? 'is-winner' : ''}">
          <div class="row-between">
            <span>${escapeHtml(r.icon)} ${escapeHtml(r.gameName)}</span>
            <span class="muted">${r.votes} Stimme(n)</span>
          </div>
          <div class="vote-bar-track"><div class="vote-bar-fill" style="width:${(r.votes / maxVotes) * 100}%"></div></div>
          <div class="row-between">
            <span class="muted" style="font-size:0.78rem;">${history}</span>
            ${votes.open ? `<button type="button" class="btn btn-sm" data-vote-game="${r.gameId}">Abstimmen</button>` : ''}
          </div>
        </div>`;
    })
    .join('');

  const controls = votes.open
    ? `
      <div class="row">
        <button type="button" class="btn btn-primary" id="votes-close" style="flex:1;">Beenden &amp; Gewinner küren</button>
        <button type="button" class="btn btn-danger" id="votes-cancel">Abbrechen</button>
      </div>`
    : `<button type="button" class="btn btn-primary btn-block" id="votes-start">Abstimmung starten</button>`;

  container.innerHTML = `
    <h1 class="view-title">Was zocken wir als Nächstes?</h1>
    ${whoAmI}
    <div class="card stack" style="margin-top:12px;">
      <div class="muted">${votes.open ? '🟢 Abstimmung läuft' : '⚪ Keine offene Abstimmung'} · Gesamt: ${votes.totalVotes} Stimme(n)</div>
      ${rows}
    </div>
    <div style="margin-top:12px;">${controls}</div>
  `;

  container.querySelector('#whoami').addEventListener('change', (e) => setMyId(e.target.value));

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

  const startBtn = container.querySelector('#votes-start');
  if (startBtn) {
    startBtn.addEventListener('click', async () => {
      try {
        await api.votes.start();
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
