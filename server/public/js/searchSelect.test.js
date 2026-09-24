// Unit tests for searchSelectHtml(), the pure string-rendering half of the
// searchable combobox (see searchSelect.js's header for why it exists).
// wireSearchSelect() itself needs a real DOM and is exercised indirectly by
// the e2e suite instead.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { searchSelectHtml } from './searchSelect.js';

const OPTIONS = [
  { value: 'g1', label: '🎮 Counter-Strike 2' },
  { value: 'g2', label: '🎮 Age of Empires 2' },
];

test('renders a hidden input carrying the selected value', () => {
  const html = searchSelectHtml('my-field', OPTIONS, 'g2');
  assert.match(html, /<input type="hidden" id="my-field" value="g2" \/>/);
});

test('the visible search input shows the selected option label', () => {
  const html = searchSelectHtml('my-field', OPTIONS, 'g2');
  assert.match(html, /<input type="text" id="my-field-search"[^>]*value="🎮 Age of Empires 2"/);
});

test('an unknown/empty selected value leaves the visible input blank', () => {
  const html = searchSelectHtml('my-field', OPTIONS, null);
  assert.match(html, /<input type="hidden" id="my-field" value="" \/>/);
  assert.match(html, /<input type="text" id="my-field-search"[^>]*value=""/);
});

test('renders a themed listbox instead of a native datalist', () => {
  const html = searchSelectHtml('my-field', OPTIONS, null);
  assert.match(html, /class="search-select-results" role="listbox"/);
  assert.match(html, /class="search-select-option" role="option"/);
  assert.doesNotMatch(html, /<datalist/);
  assert.match(html, /<span class="search-select-option-label">🎮 Counter-Strike 2<\/span>/);
  assert.match(html, /<span class="search-select-option-label">🎮 Age of Empires 2<\/span>/);
});

test('connects the combobox to its listbox with accessible state', () => {
  const html = searchSelectHtml('my-field', OPTIONS, 'g2');
  assert.match(html, /id="my-field-search"[^>]*role="combobox"[^>]*aria-autocomplete="list"[^>]*aria-expanded="false"[^>]*aria-controls="my-field-results"/);
  assert.match(html, /id="my-field-option-1"[^>]*aria-selected="true"[^>]*tabindex="-1"/);
  assert.match(html, /class="search-select-toggle" aria-label="Auswahl öffnen"/);
});

test('option labels are HTML-escaped', () => {
  const html = searchSelectHtml('my-field', [{ value: 'g1', label: '<b>Evil</b>' }], null);
  assert.doesNotMatch(html, /<b>Evil<\/b>/);
  assert.match(html, /&lt;b&gt;Evil&lt;\/b&gt;/);
});

test('option values are HTML-escaped', () => {
  const html = searchSelectHtml('my-field', [{ value: '" onfocus="evil', label: 'Safe' }], null);
  assert.doesNotMatch(html, /data-search-select-value="" onfocus=/);
  assert.match(html, /data-search-select-value="&quot; onfocus=&quot;evil"/);
});

// --- Optional status icons (the event dropdowns) ---------------------------

const EVENT_OPTIONS = [
  { value: '', label: 'Gesamt (alle Events)' },
  { value: 'e1', label: 'Sommer-LAN', icon: 'radioTower', iconLabel: 'Trackt gerade', iconState: 'tracking' },
  { value: 'e2', label: 'Winter-LAN', icon: 'circleCheck', iconLabel: 'Beendet', iconState: 'ended' },
];

test('an option icon renders on its list row, so the state is visible while the list is open', () => {
  const html = searchSelectHtml('ev', EVENT_OPTIONS, 'e1');
  assert.match(html, /class="search-select-option-icon" data-event-status="tracking"/);
  assert.match(html, /class="search-select-option-icon" data-event-status="ended"/);
});

test('a status icon is never colour alone: it carries its German state as name and title', () => {
  const html = searchSelectHtml('ev', EVENT_OPTIONS, 'e1');
  assert.match(html, /role="img" aria-label="Trackt gerade" title="Trackt gerade"/);
  assert.match(html, /role="img" aria-label="Beendet" title="Beendet"/);
});

test('the collapsed control repeats the selected option icon', () => {
  const html = searchSelectHtml('ev', EVENT_OPTIONS, 'e2');
  const control = html.slice(0, html.indexOf('search-select-list'));
  assert.match(control, /class="search-select-status" data-event-status="ended"/);
  assert.doesNotMatch(control, /data-event-status="tracking"/);
});

test('an option without an icon renders none, including the all-events entry', () => {
  const html = searchSelectHtml('ev', EVENT_OPTIONS, '');
  const allEntry = html.slice(html.indexOf('data-search-select-value=""'));
  const row = allEntry.slice(0, allEntry.indexOf('</button>'));
  assert.doesNotMatch(row, /search-select-option-icon/);
  const control = html.slice(0, html.indexOf('search-select-list'));
  assert.doesNotMatch(control, /search-select-status/);
});

test('icon-free option sets keep the existing markup, without a leading inset', () => {
  const html = searchSelectHtml('my-field', OPTIONS, 'g1');
  assert.doesNotMatch(html, /has-status-icon/);
  assert.doesNotMatch(html, /search-select-value-icon/);
});

test('icon labels are escaped like every other option field', () => {
  const html = searchSelectHtml('ev', [{ value: 'x', label: 'X', icon: 'pause', iconLabel: '"><script>' }], null);
  assert.doesNotMatch(html, /<script>/);
  assert.match(html, /aria-label="&quot;&gt;&lt;script&gt;"/);
});

test('the control takes an accessible name where no visible label precedes it', () => {
  // The game pickers keep their <label for="…-search">, so they pass none and
  // must not gain an aria-label that would override that visible text.
  assert.doesNotMatch(searchSelectHtml('my-field', OPTIONS, null), /aria-label="[^"]*"[^>]*role="combobox"/);
  assert.match(
    searchSelectHtml('ev', EVENT_OPTIONS, null, { ariaLabel: 'Veranstaltung' }),
    /id="ev-search"[^>]*aria-label="Veranstaltung"/,
  );
});

test('the listbox label defaults generically and can name what is being chosen', () => {
  assert.match(searchSelectHtml('ev', EVENT_OPTIONS, null), /aria-label="Verfügbare Optionen"/);
  assert.match(
    searchSelectHtml('ev', EVENT_OPTIONS, null, { label: 'Auswertbare Events' }),
    /aria-label="Auswertbare Events"/,
  );
});

test('the placeholder defaults to a generic search hint and can be overridden', () => {
  const withDefault = searchSelectHtml('my-field', OPTIONS, null);
  assert.match(withDefault, /placeholder="Suchen"/);

  const withCustom = searchSelectHtml('my-field', OPTIONS, null, { placeholder: 'Spiel suchen' });
  assert.match(withCustom, /placeholder="Spiel suchen"/);
});

// --- Pinned action (the topbar workspace switcher's "manage") ---------------

const MANAGE_ACTION = { label: 'Events & Gruppen verwalten', icon: 'calendar' };

test('a picker without an action renders none, so the game pickers are untouched', () => {
  const html = searchSelectHtml('my-field', OPTIONS, null);
  assert.doesNotMatch(html, /search-select-action/);
});

test('the action is a command outside the listbox, not another option in it', () => {
  const html = searchSelectHtml('ev', EVENT_OPTIONS, 'e1', { action: MANAGE_ACTION });
  const listbox = html.slice(html.indexOf('search-select-results'), html.indexOf('search-select-action'));
  // It must not sit inside role="listbox", carry an option index or carry a
  // value — those are exactly what would make it selectable and filterable.
  assert.doesNotMatch(listbox, /search-select-action/);
  const action = html.slice(html.indexOf('<button type="button" id="ev-action"'));
  assert.doesNotMatch(action, /role="option"|data-search-select-index|data-search-select-value/);
  assert.match(action, /class="search-select-action" data-search-select-action/);
  assert.match(action, /<span class="search-select-action-label">Events &amp; Gruppen verwalten<\/span>/);
});

test('the action carries a leading icon and a trailing chevron, and its label is escaped', () => {
  const withIcon = searchSelectHtml('ev', EVENT_OPTIONS, null, { action: MANAGE_ACTION });
  assert.match(withIcon, /<span class="search-select-action-icon">/);
  assert.match(withIcon, /<span class="search-select-action-chevron">/);

  const withoutIcon = searchSelectHtml('ev', EVENT_OPTIONS, null, { action: { label: '<b>X</b>' } });
  assert.doesNotMatch(withoutIcon, /search-select-action-icon/);
  assert.match(withoutIcon, /&lt;b&gt;X&lt;\/b&gt;/);
});

test('the action never becomes the selected value shown in the collapsed control', () => {
  const html = searchSelectHtml('ev', EVENT_OPTIONS, null, { action: MANAGE_ACTION });
  assert.match(html, /<input type="hidden" id="ev" value="" \/>/);
  const control = html.slice(0, html.indexOf('search-select-list'));
  assert.doesNotMatch(control, /Gruppen verwalten/);
});
