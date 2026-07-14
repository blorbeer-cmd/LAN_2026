// Mehrjahres-Hall-of-Fame (FR-36): who won overall / which tournaments were
// won, per LAN, across every event ever thrown — plus an all-time "wer hat
// am häufigsten gewonnen" ranking built from those same results. Reached
// from a button on Rangliste, same as Auswertungen/Turniere.

import { api } from '../api.js';
import { escapeHtml, avatarHtml, formatDate } from '../format.js';
import { showToast } from '../toast.js';

let cache = null;
let loading = false;

async function load(ctx) {
  loading = true;
  try {
    cache = await api.hallOfFame.get();
  } catch (err) {
    showToast(err.message, { error: true });
    cache = { events: [], allTime: { mostOverallWins: [], mostTournamentWins: [] } };
  } finally {
    loading = false;
    ctx.rerender();
  }
}

function rankedRows(entries, suffix) {
  if (entries.length === 0) {
    return `<div class="empty-state" style="padding:var(--space-4);">Noch keine Daten.</div>`;
  }
  return entries
    .map(
      (r, i) => `
      <div class="lb-row ${i === 0 ? 'rank-1' : ''}">
        <span class="lb-rank">${i + 1}</span>
        ${avatarHtml(r, 24)}
        <span style="flex:1;">${escapeHtml(r.name)}</span>
        <span class="lb-points">${r.count}× ${suffix}</span>
      </div>`
    )
    .join('');
}

function renderEvent(e) {
  const range = `${formatDate(e.startsAt)}${e.endsAt ? ' – ' + formatDate(e.endsAt) : ' (läuft)'}`;
  const championLine = e.overallChampion
    ? `<div class="row" style="margin-top:var(--space-2);">${avatarHtml(e.overallChampion, 22)} <strong>${escapeHtml(e.overallChampion.name)}</strong><span class="muted">— ${e.overallChampion.points} P. Gesamtsieger</span></div>`
    : `<div class="muted" style="margin-top:var(--space-2);font-size:var(--font-size-sm);">Kein Gesamtsieger erfasst.</div>`;

  const tournamentsHtml = e.tournamentChampions.length
    ? e.tournamentChampions
        .map(
          (t) => `
        <div class="chip" style="margin-top:var(--space-2);">
          ${escapeHtml(t.gameIcon)} ${escapeHtml(t.gameName)} — <strong>${escapeHtml(t.championTeamName || '–')}</strong>
          <span class="muted">(${escapeHtml(t.championPlayers.join(', '))})</span>
        </div>`
        )
        .join('')
    : '';

  return `
    <div class="card" style="margin-bottom:var(--space-3);">
      <div class="row-between">
        <span class="player-name">${escapeHtml(e.eventName)}</span>
        <span class="muted" style="font-size:var(--font-size-xs);">${range}</span>
      </div>
      ${championLine}
      <div class="chip-list">${tournamentsHtml}</div>
    </div>
  `;
}

export function renderHallOfFame(container, ctx) {
  if (cache === null && !loading) load(ctx);

  container.innerHTML = `
    <button type="button" class="btn btn-sm" data-navigate="more">‹ Zurück</button>
    <h1 class="view-title">Hall of Fame</h1>
    ${
      loading || cache === null
        ? `<div class="empty-state">Lädt…</div>`
        : `
      <div class="section-title">Meiste Gesamtsiege</div>
      <div class="card">${rankedRows(cache.allTime.mostOverallWins, 'Gesamtsieg')}</div>

      <div class="section-title">Meiste Turniersiege</div>
      <div class="card">${rankedRows(cache.allTime.mostTournamentWins, 'Turnier')}</div>

      <div class="section-title">Nach LAN</div>
      ${
        cache.events.length === 0
          ? `<div class="empty-state"><span class="emoji">🏛️</span>Noch keine Events.</div>`
          : cache.events.map(renderEvent).join('')
      }
    `
    }
  `;
}
