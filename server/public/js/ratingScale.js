// The one 0-5 number scale shared by Vote ballots, Umfrage ratings and the
// Bock/Skill ratings in Spiele: six square buttons, the chosen one outlined.
// 0 is always a deliberate answer ("no"), never "not rated yet" — an unrated
// scale simply has no button selected.

import { escapeHtml } from './format.js';

export const RATING_SCALE_VALUES = [0, 1, 2, 3, 4, 5];
export const RATING_SCALE_MAX = 5;

function scaleValue(value) {
  return value === null || value === undefined || value === '' ? null : Number(value);
}

// selected: the chosen value (number or numeric string) or null/undefined.
// attributes(value) returns trusted, already escaped markup that identifies
// the button for the caller's click handler.
// hint: an optional reference value (Vote: the viewer's own Bock) marked with
// a dashed outline while another or no number is chosen.
// tone ('bock' | 'skill'): colors the chosen number and adds the fill line
// below the numbers that picks up the former sliders' gradient.
export function ratingScaleHtml({
  selected,
  groupLabel,
  valueLabel = (value) => `${value} von ${RATING_SCALE_MAX}`,
  attributes,
  disabled = false,
  hint = null,
  hintLabel = '',
  tone = null,
}) {
  const chosen = scaleValue(selected);
  const hinted = scaleValue(hint);
  const buttonClass = (value) => (chosen === value ? ' is-selected' : hinted === value ? ' is-hint' : '');
  const toolbar = `
    <div class="selection-toolbar event-poll-response-toolbar event-poll-rating-toolbar" role="group" aria-label="${escapeHtml(groupLabel)}">
      ${RATING_SCALE_VALUES.map((value) => `
        <button type="button" class="btn btn-square${buttonClass(value)}" ${attributes(value)}
          aria-label="${escapeHtml(`${valueLabel(value)}${hinted === value && hintLabel ? `, ${hintLabel}` : ''}`)}" aria-pressed="${chosen === value}" ${disabled ? 'disabled' : ''}>${value}</button>`).join('')}
    </div>`;
  if (!tone) return toolbar;
  // The fill line repeats the chosen value visually; a dashed empty line means
  // "not rated yet", an empty solid line is a deliberate 0.
  const meter = chosen === null
    ? '<span class="rating-scale-meter is-unrated" aria-hidden="true"></span>'
    : `<span class="rating-scale-meter" aria-hidden="true"><span class="rating-scale-meter-fill" style="width:${(chosen / RATING_SCALE_MAX) * 100}%;"></span></span>`;
  return `<div class="rating-scale rating-scale--${tone}">${toolbar}${meter}</div>`;
}
