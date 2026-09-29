// Shared form fields and answer controls of Umfragen and Vote. Both start
// dialogs offer the same answer kinds and privacy options, and both ballots
// answer an option or a game with the same Passt/Notfalls/Nein toolbar or
// Wählen button; only the wording of the details differs per view.

import { escapeHtml } from './format.js';
import { infoTooltipHtml } from './infoTooltip.js';
import { searchSelectHtml, wireSearchSelect } from './searchSelect.js';

export const FEASIBILITY_VALUES = ['can', 'if_needed', 'cannot'];
export const FEASIBILITY_LABELS = { can: 'Passt', if_needed: 'Notfalls', cannot: 'Nein' };
const FEASIBILITY_FULL_LABELS = { can: 'Passt', if_needed: 'Wenn nötig', cannot: 'Passt nicht' };

// modes: Array<{ value, label }> in display order. The answer kind is a plain
// app-rendered select (see searchSelect.js), so its list opens below the
// field in the same dark style as every other dropdown.
export function responseModeFieldHtml(id, modes, selected, { required = true } = {}) {
  return `
    <div>
      <label for="${id}-search" class="field-label${required ? ' is-required' : ''}">Antwortart</label>
      ${searchSelectHtml(id, modes, selected, { searchable: false, placeholder: '', label: 'Antwortarten' })}
    </div>`;
}

// `disabled` shows the fixed answer kind of an existing round.
export function wireResponseModeField(container, id, modes, { onChange, disabled = false } = {}) {
  wireSearchSelect(container, id, modes, { onChange });
  if (!disabled) return;
  const search = container.querySelector(`#${id}-search`);
  const toggle = search?.closest('[data-search-select]')?.querySelector('.search-select-toggle');
  if (search) search.disabled = true;
  if (toggle) toggle.disabled = true;
}

// "Stimmen pro Person" of a Mehrfachauswahl; empty means no limit.
export function maxSelectionsFieldHtml(id, value) {
  return `<div><label for="${id}" class="field-label">Stimmen pro Person</label><input id="${id}" type="number" min="1" value="${escapeHtml(value ?? '')}" placeholder="Unbegrenzt" /></div>`;
}

// Anonymity and interim-result checkboxes with their contextual help.
export function pollFlagsHtml({ anonymousId, hiddenId, anonymous = false, hideLiveResults = true, anonymousHelp, hiddenHelp }) {
  return `
    <div class="event-poll-form-flags">
      <div class="event-poll-flag">
        <input type="checkbox" id="${anonymousId}" ${anonymous ? 'checked' : ''} />
        <label for="${anonymousId}">Anonym</label>
        ${infoTooltipHtml(`${anonymousId}-help`, 'Anonym', anonymousHelp)}
      </div>
      <div class="event-poll-flag">
        <input type="checkbox" id="${hiddenId}" ${hideLiveResults ? 'checked' : ''} />
        <label for="${hiddenId}">Zwischenstand verbergen</label>
        ${infoTooltipHtml(`${hiddenId}-help`, 'Zwischenstand verbergen', hiddenHelp)}
      </div>
    </div>`;
}

// Passt/Notfalls/Nein for one option or game. `attributes(value)` returns the
// trusted, already escaped data attributes that wire each button.
export function feasibilityControlHtml({ selected, groupLabel, attributes }) {
  return `
    <div class="selection-toolbar event-poll-response-toolbar" role="group" aria-label="${escapeHtml(groupLabel)}">
      ${FEASIBILITY_VALUES.map((value) => `
        <button type="button" class="btn btn-sm${selected === value ? ' is-selected' : ''}" ${attributes(value)}
          aria-label="${FEASIBILITY_FULL_LABELS[value]}" aria-pressed="${selected === value}">${FEASIBILITY_LABELS[value]}</button>`).join('')}
    </div>`;
}

// The Wählen/Ausgewählt toggle of a single or multiple choice.
export function choiceControlHtml({ selected, label = '', attributes }) {
  return `
    <div class="event-poll-choice-control">
      <div class="selection-toolbar event-poll-response-toolbar">
        <button type="button" class="btn btn-sm event-poll-choice-btn${selected ? ' is-selected' : ''}" ${attributes}
          aria-pressed="${selected}"${label ? ` aria-label="${escapeHtml(label)}"` : ''}>${selected ? 'Ausgewählt' : 'Wählen'}</button>
      </div>
    </div>`;
}
