// Mehrjahres-Hall-of-Fame (FR-36): who won overall / which tournaments were
// won, per LAN, across every event ever thrown — plus an all-time "wer hat
// am häufigsten gewonnen" ranking built from those same results. Reached
// from a button on Rangliste, same as Auswertungen/Turniere.

import { api } from '../api.js';
import { escapeHtml, avatarHtml, formatDate } from '../format.js';
import { showToast } from '../toast.js';
import { emptyStateHtml } from '../emptyState.js';
import { icon } from '../icons.js';
import { rankedListHtml, sharedRankNumbers } from '../rankedList.js';
import { accessibleEvents } from '../state.js';
import { eventSelectOption } from '../eventStatus.js';
import { searchSelectHtml, wireSearchSelect } from '../searchSelect.js';

let cache = null;
let loading = false;
let cacheStale = false;
let requestVersion = 0;
let selectedEventId = null;
// Every section starts collapsed; its open state survives re-renders.
const sectionOpen = { overall: false, tournaments: false, events: false };

// A filled section is a collapsible card with its row count; an empty one
// collapses to the shared one-row empty card (design rule 8).
function collapsibleSection(key, title, count, emptyText, contentHtml) {
  if (count === 0) {
    return `
      <section class="card stack grouped-page-section" aria-label="${title}">
        <div class="grouped-page-section-title"><h2>${title}</h2></div>
        ${emptyStateHtml(emptyText, { className: 'empty-state-compact' })}
      </section>`;
  }
  return `
    <details class="card grouped-page-section collapsible-section" data-hall-section="${key}" ${sectionOpen[key] ? 'open' : ''}>
      <summary class="collapsible-section-header">
        <span class="collapsible-section-chevron">${icon('chevronRight')}</span>
        <h2>${title}</h2>
        <span class="collapsible-section-summary-end">
          <span class="badge badge-offline">${count}</span>
        </span>
      </summary>
      <div class="collapsible-section-content stack">${contentHtml}</div>
    </details>`;
}

export function invalidateHallOfFame({ hard = false } = {}) {
  requestVersion += 1;
  loading = false;
  cacheStale = true;
  if (hard) cache = null;
}

async function load(ctx) {
  const version = ++requestVersion;
  loading = true;
  cacheStale = false;
  try {
    const result = await api.hallOfFame.get();
    if (version === requestVersion) cache = result;
  } catch (err) {
    if (version === requestVersion) {
      showToast(err.message, { error: true });
      if (cache === null) cache = { events: [], allTime: { mostOverallWins: [], mostTournamentWins: [] } };
    }
  } finally {
    if (version === requestVersion) {
      loading = false;
      ctx.rerender();
    }
  }
}

// All-time counts as a ranking: equal counts share their place.
// The card title names what is counted, so the value column only carries
// "4×" and stays narrow enough for phones.
function countList(entries, label) {
  const ranks = sharedRankNumbers(entries.map((r) => r.count));
  return rankedListHtml(
    entries.map((r, i) => ({
      rank: ranks[i],
      lead: avatarHtml(r, 28),
      title: escapeHtml(r.name),
      value: `${r.count}×`,
    })),
    { ranked: true, label },
  );
}

function eventRange(e) {
  if (!e.startsAt) return '';
  return e.endsAt ? `${formatDate(e.startsAt)} bis ${formatDate(e.endsAt)}` : `seit ${formatDate(e.startsAt)}`;
}

function renderEvent(e) {
  const standings = e.overallStandings ?? [];
  // Same order as the server's standings: points, then wins.
  const ranks = sharedRankNumbers(standings.map((r) => [r.points, r.wins]));
  const standingsHtml = standings.length
    ? rankedListHtml(
        standings.map((r, i) => ({
          rank: ranks[i],
          lead: avatarHtml(r, 28),
          title: escapeHtml(r.name),
          meta: `${r.wins} ${r.wins === 1 ? 'Sieg' : 'Siege'} · ${r.matchesPlayed} ${r.matchesPlayed === 1 ? 'Spiel' : 'Spiele'}`,
          value: `${r.points} P`,
        })),
        { ranked: true, label: 'Gesamtplatzierungen' },
      )
    : emptyStateHtml('Noch keine Platzierungen', { className: 'empty-state-compact' });

  // Tournaments are no ranking among each other, so they read alphabetically;
  // the champion team takes the value column, its players the meta line.
  const tournamentsHtml = e.tournamentChampions.length
    ? rankedListHtml(
        e.tournamentChampions.map((t) => ({
          title: escapeHtml(t.name),
          sortKey: t.name,
          meta: [t.gameName, t.championPlayers.join(', ')].filter(Boolean).map(escapeHtml).join(' · '),
          value: `<span class="hall-of-fame-champion" title="${escapeHtml(t.championTeamName || '')}">${escapeHtml(t.championTeamName || '')}</span>`,
        })),
        { label: 'Turniere' },
      )
    : '';

  const range = eventRange(e);
  return `
    ${range ? `<span class="muted hall-of-fame-event-range">${range}</span>` : ''}
    <section class="stack hall-of-fame-event-section">
      <h3 class="section-title hall-of-fame-subtitle">Gesamtplatzierungen</h3>
      ${standingsHtml}
    </section>
    ${tournamentsHtml ? `<section class="stack hall-of-fame-event-section"><h3 class="section-title hall-of-fame-subtitle">Turniere</h3>${tournamentsHtml}</section>` : ''}
  `;
}

// The Hall-of-Fame payload carries results, not lifecycle flags, so the state
// comes from the shared event list this account can see. An event that list
// no longer holds still gets an option — it has results to show — just
// without a state claim the payload cannot back.
function eventPickerOptions(events) {
  const byId = new Map(accessibleEvents().map((event) => [event.id, event]));
  return events.map((summary) => {
    const known = byId.get(summary.eventId);
    return known
      ? { ...eventSelectOption(known), value: summary.eventId }
      : { value: summary.eventId, label: summary.eventName };
  });
}

export function renderHallOfFame(container, ctx) {
  if ((cache === null || cacheStale) && !loading) load(ctx);
  const events = cache?.events ?? [];
  if (!events.some((event) => event.eventId === selectedEventId)) selectedEventId = events[0]?.eventId ?? null;
  const selectedEvent = events.find((event) => event.eventId === selectedEventId) ?? null;

  const eventContent = events.length === 0
    ? ''
    : `${searchSelectHtml('hall-event-select', eventPickerOptions(events), selectedEventId, {
        placeholder: 'Event suchen',
        ariaLabel: 'Event',
        label: 'Events mit Ergebnissen',
      })}
      ${renderEvent(selectedEvent)}`;

  container.innerHTML =
    cache === null
      ? emptyStateHtml('Lädt', { className: 'empty-state-compact' })
      : `
      <div class="grouped-page-sections">
        ${collapsibleSection('overall', 'Meiste Gesamtsiege', cache.allTime.mostOverallWins.length, 'Noch keine Platzierungen',
          countList(cache.allTime.mostOverallWins, 'Meiste Gesamtsiege'))}
        ${collapsibleSection('tournaments', 'Meiste Turniersiege', cache.allTime.mostTournamentWins.length, 'Noch keine Platzierungen',
          countList(cache.allTime.mostTournamentWins, 'Meiste Turniersiege'))}
        ${collapsibleSection('events', 'Nach Event', events.length, 'Noch keine Events', eventContent)}
      </div>
    `;

  container.querySelectorAll('[data-hall-section]').forEach((section) => {
    section.addEventListener('toggle', () => {
      sectionOpen[section.dataset.hallSection] = section.open;
    });
  });

  wireSearchSelect(container, 'hall-event-select', eventPickerOptions(events), {
    emptyText: 'Kein passendes Event gefunden',
    onChange: (eventId) => {
      selectedEventId = eventId;
      ctx.rerender();
    },
  });
}
