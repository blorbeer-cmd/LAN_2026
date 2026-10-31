import { escapeHtml } from './format.js';

export const POINT_SOURCES = Object.freeze({
  start: 'Grundstock',
  task: 'Orga-Aufgabe',
  tip: 'Wette',
  refund: 'Erstattung',
  correction: 'Korrektur',
  reversal: 'Storno',
});
export const signedPoints = (value) => `${value > 0 ? '+' : ''}${value}`;

// Preserve journal order for bookings sharing a millisecond. The curve shows
// the complete balance; filtering the journal must never change this history.
export function pointTimeline(entries) {
  let balance = 0;
  return entries.map((entry) => ({ id: entry.id, time: entry.created_at, balance: (balance += entry.amount) }));
}

export function pointsChartHtml(entries) {
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
  const label = `Punkteverlauf: ${timeline.length} Buchungen, aktuell ${timeline.at(-1).balance} Punkte. Alle Werte stehen im Buchungsverlauf.`;
  return `<figure class="points-chart">
    <svg viewBox="0 0 600 180" role="img" aria-label="${escapeHtml(label)}">
      <path class="points-chart-baseline" d="M 24 ${y(0)} H 576" />
      <path class="points-chart-line" d="${path}" />
      <text x="24" y="16">${high} P.</text><text x="24" y="176">${low} P.</text>
    </svg>
    <figcaption class="row-between muted"><span>${escapeHtml(new Date(start).toLocaleString('de-DE'))}</span><span>${escapeHtml(new Date(timeline.at(-1).time).toLocaleString('de-DE'))}</span></figcaption>
  </figure>`;
}
