// Mehrjahres-Hall-of-Fame (FR-36): who won overall / which tournaments were
// won, per LAN, across every event ever thrown — plus an all-time "wer hat
// am häufigsten gewonnen" ranking built from those same results. Reached
// from a button on Rangliste, same as Auswertungen/Turniere.

import { api } from '../api.js';
import { escapeHtml, avatarHtml, formatDate } from '../format.js';
import { showToast } from '../toast.js';
import { icon } from '../icons.js';
import { domainIcon } from '../domainIcons.js';

let cache = null;
let loading = false;
let selectedEventId = null;

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
        <span class="player-name" style="flex:1;">${escapeHtml(r.name)}</span>
        <span class="lb-points">${r.count}× ${suffix}</span>
      </div>`
    )
    .join('');
}

function renderEventStanding(r, index) {
  return `
    <div class="lb-row ${index === 0 ? 'rank-1' : ''}">
      <span class="lb-rank">${index + 1}</span>
      ${avatarHtml(r, 24)}
      <span class="leaderboard-row-main">
        <strong class="player-name leaderboard-row-name">${escapeHtml(r.name)}</strong>
        <span class="muted leaderboard-row-stat">${r.wins} ${r.wins === 1 ? 'Sieg' : 'Siege'} · ${r.matchesPlayed} ${r.matchesPlayed === 1 ? 'Spiel' : 'Spiele'}</span>
      </span>
      <strong class="lb-points">${r.points} P.</strong>
    </div>`;
}

function renderEvent(e) {
  const range = `${formatDate(e.startsAt)}${e.endsAt ? ' – ' + formatDate(e.endsAt) : ' (läuft)'}`;
  const standings = e.overallStandings ?? [];
  const standingsHtml = standings.length
    ? `<div class="leaderboard-list-grid">${standings.map(renderEventStanding).join('')}</div>`
    : `<div class="muted hall-of-fame-empty-result">Noch keine Platzierungen.</div>`;

  const tournamentsHtml = e.tournamentChampions.length
    ? e.tournamentChampions
        .map(
          (t) => `
        <div class="hall-of-fame-result">
          <span class="hall-of-fame-game">
            <strong>${escapeHtml(t.name)}</strong>
            <span class="muted">${escapeHtml(t.gameName)}</span>
          </span>
          <span class="hall-of-fame-tournament-winner">
            <strong>${escapeHtml(t.championTeamName || '–')}</strong>
            <span class="muted">${escapeHtml(t.championPlayers.join(', '))}</span>
          </span>
        </div>`
        )
        .join('')
    : '';

  return `
    <div class="stack hall-of-fame-event">
      <div class="row-between hall-of-fame-event-header">
        <span class="player-name">${escapeHtml(e.eventName)}</span>
        <span class="muted" style="font-size:var(--font-size-xs);">${range}</span>
      </div>
      <div class="section-title hall-of-fame-subtitle">Gesamtplatzierungen</div>
      ${standingsHtml}
      ${tournamentsHtml ? `<div class="section-title hall-of-fame-subtitle">Turniere</div><div class="hall-of-fame-tournaments">${tournamentsHtml}</div>` : ''}
    </div>
  `;
}

export function renderHallOfFame(container, ctx) {
  if (cache === null && !loading) load(ctx);
  const events = cache?.events ?? [];
  if (!events.some((event) => event.eventId === selectedEventId)) selectedEventId = events[0]?.eventId ?? null;
  const selectedEvent = events.find((event) => event.eventId === selectedEventId) ?? null;

  container.innerHTML = `
    <button type="button" class="btn btn-sm" data-navigate="more">${icon('chevronLeft')} Zurück</button>
    <h1 class="view-title">Hall of Fame</h1>
    ${
      loading || cache === null
        ? `<div class="empty-state">Lädt…</div>`
        : `
      <div class="grouped-page-sections">
        <section class="card stack grouped-page-section" aria-labelledby="hall-overall-title">
          <div class="grouped-page-section-title"><h2 id="hall-overall-title">Meiste Gesamtsiege</h2></div>
          <div class="leaderboard-list-grid">${rankedRows(cache.allTime.mostOverallWins, 'Gesamtsieg')}</div>
        </section>
        <section class="card stack grouped-page-section" aria-labelledby="hall-tournaments-title">
          <div class="grouped-page-section-title"><h2 id="hall-tournaments-title">Meiste Turniersiege</h2></div>
          <div class="leaderboard-list-grid">${rankedRows(cache.allTime.mostTournamentWins, 'Turnier')}</div>
        </section>
        <section class="card stack grouped-page-section" aria-labelledby="hall-events-title">
          <div class="grouped-page-section-title"><h2 id="hall-events-title">Nach LAN</h2></div>
          ${
            events.length === 0
              ? `<div class="empty-state"><span class="empty-state-icon">${icon(domainIcon('hallOfFame'))}</span>Noch keine Events.</div>`
              : `<label for="hall-event-select" class="field-label">LAN auswählen</label>
                 <select id="hall-event-select">
                   ${events.map((event) => `<option value="${event.eventId}" ${event.eventId === selectedEventId ? 'selected' : ''}>${escapeHtml(event.eventName)}</option>`).join('')}
                 </select>
                 <div class="card hall-of-fame-selected-event">${renderEvent(selectedEvent)}</div>`
          }
        </section>
      </div>
    `
    }
  `;

  container.querySelector('#hall-event-select')?.addEventListener('change', (event) => {
    selectedEventId = event.currentTarget.value;
    ctx.rerender();
  });
}
