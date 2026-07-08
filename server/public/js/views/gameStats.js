// "Spiele & Turniere" view: how much each game got played as recorded
// matches, how many tournaments were run (and in which format), how often
// "Teams auslosen" was used, plus a few "witzige" head-to-head records
// (Rivalität, Duo, Underdog-Sieg). Sibling to analytics.js's "Spielzeit"
// view — that one is about session/playtime data, this one is about
// matches/tournaments/draws as first-class subjects.

import { api } from '../api.js';
import { state } from '../state.js';
import { escapeHtml, avatarHtml, gameBadgeHtml } from '../format.js';
import { showToast } from '../toast.js';

let cache = null;
let loading = false;
let eventFilter = 'active'; // 'active' resolves once state.events is available; '' = alle Events

function resolveEventFilter() {
  if (eventFilter !== 'active') return;
  const active = state.events.find((e) => e.isActive);
  if (active) eventFilter = active.id;
}

const FORMAT_LABELS = {
  single_elimination: '🏆 K.O.-Turnier',
  round_robin: '🔁 Liga',
  group_knockout: '👥 Gruppenphase + K.O.',
};

async function loadData(ctx) {
  loading = true;
  ctx.rerender();
  try {
    resolveEventFilter();
    const params = eventFilter ? { eventId: eventFilter } : {};
    cache = await api.analytics.gamesTournaments(params);
  } catch (err) {
    showToast(err.message, { error: true });
    cache = {
      matches: { total: 0, byGame: [] },
      tournaments: { total: 0, completed: 0, active: 0, byFormat: [], byGame: [] },
      draws: { total: 0, byGame: [], seatConflictRatePercent: null },
      fun: { biggestRivalry: null, bestDuo: null, biggestUnderdogWin: null },
    };
  } finally {
    loading = false;
    ctx.rerender();
  }
}

function renderEventOptions() {
  const sorted = [...state.events].sort((a, b) => b.starts_at - a.starts_at);
  const options = sorted
    .map((e) => {
      const range = `${new Date(e.starts_at).toLocaleDateString('de-DE')}${e.ends_at ? '–' + new Date(e.ends_at).toLocaleDateString('de-DE') : ' (läuft)'}`;
      return `<option value="${e.id}" ${e.id === eventFilter ? 'selected' : ''}>${escapeHtml(e.name)} (${range})</option>`;
    })
    .join('');
  return `<option value="" ${eventFilter === '' ? 'selected' : ''}>🌐 Gesamt (alle Events)</option>${options}`;
}

function playerChip(p) {
  return `${avatarHtml(state.players.find((pl) => pl.id === p.id) || { color: p.color }, 20)} ${escapeHtml(p.name)}`;
}

function renderContent() {
  const matches = cache.matches;
  const tournaments = cache.tournaments;
  const draws = cache.draws;
  const fun = cache.fun;

  const matchRows = matches.byGame.length
    ? matches.byGame
        .map(
          (g) => `
        <div class="lb-row">
          ${gameBadgeHtml({ id: g.gameId, icon: g.gameIcon }, 24)}
          <span style="flex:1;">
            ${escapeHtml(g.gameName)}
            <div class="muted" style="font-size:0.75rem;">${g.decided} entschieden${g.undecided ? ` · ${g.undecided} ohne Sieger/Unentschieden` : ''}</div>
          </span>
          <span class="lb-points">${g.count}×</span>
        </div>`
        )
        .join('')
    : `<div class="empty-state" style="padding:20px;">Noch keine Ergebnisse eingetragen.</div>`;

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
    : `<div class="empty-state" style="padding:20px;">Noch keine Turniere.</div>`;

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
    : '';

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
    : `<div class="empty-state" style="padding:20px;">Noch keine Teams ausgelost.</div>`;

  const funCards = [];
  if (fun.biggestRivalry) {
    funCards.push(`
      <div class="card">
        <div class="row-between"><span style="font-size:1.4rem;">🥊</span><span class="lb-points">${fun.biggestRivalry.count}×</span></div>
        <div class="player-name">Größte Rivalität</div>
        <div class="muted" style="font-size:0.8rem;">Sind sich am häufigsten als Gegner begegnet.</div>
        <div class="stack" style="margin-top:6px;gap:4px;">
          <div class="row">${playerChip(fun.biggestRivalry.playerA)}</div>
          <div class="row">${playerChip(fun.biggestRivalry.playerB)}</div>
        </div>
      </div>`);
  }
  if (fun.bestDuo) {
    const winRate = fun.bestDuo.gamesTogether > 0 ? Math.round((fun.bestDuo.winsTogether / fun.bestDuo.gamesTogether) * 100) : 0;
    funCards.push(`
      <div class="card">
        <div class="row-between"><span style="font-size:1.4rem;">🤝</span><span class="lb-points">${winRate}%</span></div>
        <div class="player-name">Bestes Duo</div>
        <div class="muted" style="font-size:0.8rem;">${fun.bestDuo.gamesTogether}× zusammen im Team, ${fun.bestDuo.winsTogether}× gewonnen.</div>
        <div class="stack" style="margin-top:6px;gap:4px;">
          <div class="row">${playerChip(fun.bestDuo.playerA)}</div>
          <div class="row">${playerChip(fun.bestDuo.playerB)}</div>
        </div>
      </div>`);
  }
  if (fun.biggestUnderdogWin) {
    const u = fun.biggestUnderdogWin;
    funCards.push(`
      <div class="card">
        <div class="row-between"><span style="font-size:1.4rem;">😱</span><span class="lb-points">${u.winnerAvgRating} vs ${u.loserAvgRating}</span></div>
        <div class="player-name">Krasseste Überraschung</div>
        <div class="muted" style="font-size:0.8rem;">${gameBadgeHtml({ id: u.gameId, icon: u.gameIcon }, 16)} ${escapeHtml(u.gameName)} — als klarer Außenseiter gewonnen (Skill-Wertung).</div>
        <div class="stack" style="margin-top:6px;gap:4px;">
          ${u.winners.map((w) => `<div class="row">${playerChip(w)}</div>`).join('')}
        </div>
      </div>`);
  }
  const funHtml = funCards.length
    ? `<div class="grid" style="grid-template-columns:repeat(auto-fit, minmax(200px, 1fr));">${funCards.join('')}</div>`
    : `<div class="empty-state" style="padding:20px;"><span class="emoji">🎉</span>Noch nicht genug Ergebnisse für witzige Rekorde.</div>`;

  return `
    <div class="section-title">🎲 Ergebnisse pro Spiel <span class="muted" style="font-weight:400;">(${matches.total} insgesamt)</span></div>
    <div class="card">${matchRows}</div>

    <div class="section-title">🏆 Turniere <span class="muted" style="font-weight:400;">(${tournaments.total} insgesamt · ${tournaments.completed} beendet · ${tournaments.active} laufend)</span></div>
    ${formatRows ? `<div class="card" style="margin-bottom:10px;">${formatRows}</div>` : ''}
    <div class="card">${tournamentByGameRows}</div>

    <div class="section-title">⚖️ Team-Auslosungen <span class="muted" style="font-weight:400;">(${draws.total} insgesamt${draws.seatConflictRatePercent !== null ? ` · ${draws.seatConflictRatePercent}% Sitznachbarn mussten gegeneinander` : ''})</span></div>
    <div class="card">${drawRows}</div>

    <div class="section-title">🎉 Witzige Rekorde</div>
    ${funHtml}
  `;
}

export function renderGameStats(container, ctx) {
  if (cache === null && !loading) {
    loadData(ctx);
  }
  resolveEventFilter();

  container.innerHTML = `
    <button type="button" class="btn btn-sm" data-navigate="more">‹ Zurück</button>
    <h1 class="view-title">📊 Spiele & Turniere</h1>
    <div class="card">
      <select id="gs-event">${renderEventOptions()}</select>
    </div>
    <div id="gs-content">${loading || !cache ? `<div class="empty-state">Lädt…</div>` : renderContent()}</div>
  `;

  container.querySelector('#gs-event').addEventListener('change', (e) => {
    eventFilter = e.target.value;
    cache = null;
    ctx.rerender();
  });
}
