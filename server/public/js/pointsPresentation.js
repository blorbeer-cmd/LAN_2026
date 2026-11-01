import { escapeHtml } from './format.js';

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
