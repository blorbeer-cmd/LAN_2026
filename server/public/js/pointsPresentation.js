import { escapeHtml } from './format.js';
import { icon } from './icons.js';

export const POINT_SOURCES = Object.freeze({
  start: 'Wett-Startguthaben',
  reservation: 'Reservierung',
  release: 'Freigabe',
  tip: 'Wette',
  refund: 'Erstattung',
  correction: 'Korrektur',
  reversal: 'Storno',
});
export const signedPoints = (value) => `${value > 0 ? '+' : ''}${value}`;

export const POINT_CATEGORIES = Object.freeze({ orga: 'Orga', playing: 'Spielen', betting: 'Wetten' });

export function pointsSectionHtml(key, title, content, { open = false, flat = false, meta = '', metaHtml = '', label = title } = {}) {
  return `<section aria-label="${escapeHtml(label)}"><details class="${flat ? 'points-ranking' : 'card'} collapsible-section" data-points-section="${escapeHtml(key)}"${open ? ' open' : ''}>
    <summary class="collapsible-section-header"><span class="collapsible-section-chevron">${icon('chevronRight')}</span><h2>${escapeHtml(title)}</h2>${metaHtml || meta ? `<span class="muted">${metaHtml || escapeHtml(meta)}</span>` : ''}</summary>
    <div class="collapsible-section-content stack">${content}</div></details></section>`;
}

export function categoryPlaceSummary(categories) {
  return categories ? Object.entries(POINT_CATEGORIES)
    .map(([key, label]) => `${label} ${categories[key].placePoints}`).join(' · ') : '';
}

// Corrections affect the entire source, even when an older booking is selected.
export function journalSourceState(entries, sourceId) {
  return entries.filter((entry) => entry.source_id === sourceId).reduce(
    (source, entry) => ({ total: source.total + entry.amount, revision: Math.max(source.revision, entry.revision) }),
    { total: 0, revision: 0 },
  );
}

// Both APIs' timestamp names retain the journal order for a shared millisecond. The curve shows
// the complete balance; filtering the journal must never change this history.
export function pointTimeline(entries) {
  let balance = 0;
  return entries.map((entry) => ({ id: entry.id, time: entry.createdAt ?? entry.created_at, balance: (balance += entry.amount) }));
}

export function pointsChartHtml(entries, { label: chartLabel = 'Punkteverlauf' } = {}) {
  const timeline = pointTimeline(entries);
  if (!timeline.length) return '';
  const start = timeline[0].time;
  const end = Math.max(start + 1, timeline.at(-1).time);
  const low = Math.min(0, ...timeline.map((p) => p.balance));
  const high = Math.max(1, ...timeline.map((p) => p.balance));
  const x = (time) => 24 + ((time - start) / (end - start)) * 552;
  const y = (balance) => 156 - ((balance - low) / (high - low)) * 132;
  let path = `M 24 ${y(0)}`;
  for (const point of timeline) path += ` H ${x(point.time)} V ${y(point.balance)}`;
  path += ' H 576';
  const label = `${chartLabel}: ${timeline.length} Buchungen, aktuell ${timeline.at(-1).balance} Punkte. Alle Werte stehen im Buchungsverlauf.`;
  return `<figure class="points-chart">
    <svg viewBox="0 0 600 180" role="img" aria-label="${escapeHtml(label)}">
      <path class="points-chart-baseline" d="M 24 ${y(0)} H 576" />
      <path class="points-chart-line" d="${path}" />
    </svg>
    <figcaption class="stack muted"><div class="row-between"><span>${low} P.</span><span>${high} P.</span></div>
      <div class="row-between"><span>${escapeHtml(new Date(start).toLocaleString('de-DE'))}</span><span>${escapeHtml(new Date(timeline.at(-1).time).toLocaleString('de-DE'))}</span></div></figcaption>
  </figure>`;
}

// Group stages and knockout rounds can share the same round number. Keep them
// distinct, including the third-place match beside its final.
// One status for all markets of a tournament on its card: open rounds first,
// then rounds still waiting for a result, otherwise how the last ones ended.
export function tournamentBettingSummary(rounds, closed = false) {
  const open = closed ? 0 : rounds.filter((round) => round.status === 'open').length;
  const mine = rounds.filter((round) => round.mine).length;
  const state = open ? `${open} ${open === 1 ? 'Tipprunde' : 'Tipprunden'} offen`
    : rounds.some((round) => round.status === 'locked' || round.status === 'open') ? 'Tipps geschlossen'
    : rounds.every((round) => round.status === 'refunded') ? 'Erstattet' : 'Abgerechnet';
  return [state, mine ? `${mine} ${mine === 1 ? 'eigener Tipp' : 'eigene Tipps'}` : ''].filter(Boolean).join(' · ');
}

export function tournamentTipGroups(rounds) {
  const groups = new Map();
  for (const round of rounds) {
    const t = round.tournament;
    // The server names fixtures like the bracket does; older payloads fall back.
    const label = round.sourceType === 'tournament' ? 'Turniersieger' : t?.phase ?? (t?.thirdPlace ? 'Spiel um Platz 3'
      : `${t?.groupIndex != null ? `Gruppe ${t.groupIndex + 1} · ` : ''}Runde ${t?.round ?? 1}`);
    if (!groups.has(label)) groups.set(label, { label, rounds: [] });
    groups.get(label).rounds.push(round);
  }
  return [...groups.values()];
}
