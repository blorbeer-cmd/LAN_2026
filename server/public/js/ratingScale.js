// The one 0-5 number scale shared by Vote ballots, Umfrage ratings and the
// Bock/Skill ratings in Spiele: six square buttons, the chosen one outlined.
// 0 is always a deliberate answer ("no"), never "not rated yet" — an unrated
// scale simply has no button selected.

import { escapeHtml } from './format.js';

export const RATING_SCALE_VALUES = [0, 1, 2, 3, 4, 5];
export const RATING_SCALE_MAX = 5;

// selected: the chosen value (number or numeric string) or null/undefined.
// attributes(value) returns trusted, already escaped markup that identifies
// the button for the caller's click handler.
export function ratingScaleHtml({ selected, groupLabel, valueLabel = (value) => `${value} von ${RATING_SCALE_MAX}`, attributes, disabled = false }) {
  const chosen = selected === null || selected === undefined || selected === '' ? null : Number(selected);
  return `
    <div class="selection-toolbar event-poll-response-toolbar event-poll-rating-toolbar" role="group" aria-label="${escapeHtml(groupLabel)}">
      ${RATING_SCALE_VALUES.map((value) => `
        <button type="button" class="btn btn-square${chosen === value ? ' is-selected' : ''}" ${attributes(value)}
          aria-label="${escapeHtml(valueLabel(value))}" aria-pressed="${chosen === value}" ${disabled ? 'disabled' : ''}>${value}</button>`).join('')}
    </div>`;
}
