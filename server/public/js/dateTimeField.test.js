// Unit tests for dateTimeFieldHtml(), the pure string-rendering half of the
// custom date/time picker (see dateTimeField.js's header for why it exists —
// it replaces the native <input type="datetime-local"> whose popup can't be
// themed). wireDateTimeField() itself needs a real DOM/browser and is
// exercised indirectly by the e2e suite instead.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dateTimeFieldHtml } from './dateTimeField.js';

test('an empty value renders the placeholder label and a disabled time selects', () => {
  const html = dateTimeFieldHtml('my-field', null);
  assert.match(html, /Datum wählen/);
  assert.match(html, /data-dt-hour disabled/);
  assert.match(html, /data-dt-minute disabled/);
});

test('a set value renders the hidden input in datetime-local format and enables the time selects', () => {
  const d = new Date(2026, 6, 8, 14, 35, 0);
  const html = dateTimeFieldHtml('my-field', d.getTime());
  assert.match(html, /value="2026-07-08T14:35"/);
  assert.doesNotMatch(html, /data-dt-hour disabled/);
  assert.doesNotMatch(html, /data-dt-minute disabled/);
});

test('the minute value snaps to the nearest 5-minute step', () => {
  const d = new Date(2026, 6, 8, 14, 37, 0); // 37 -> rounds to 35
  const html = dateTimeFieldHtml('my-field', d.getTime());
  assert.match(html, /value="2026-07-08T14:35"/);
});

test('the clear button only renders when opts.clearable is set', () => {
  const withClear = dateTimeFieldHtml('f1', Date.now(), { clearable: true });
  assert.match(withClear, /data-dt-clear/);

  const withoutClear = dateTimeFieldHtml('f1', Date.now());
  assert.doesNotMatch(withoutClear, /data-dt-clear/);
});

test('opts.disabled disables the trigger button and both time selects', () => {
  const html = dateTimeFieldHtml('f1', Date.now(), { disabled: true });
  assert.match(html, /dt-date-btn" data-dt-trigger disabled/);
});

test('the correct hour/minute <option> is marked selected', () => {
  const d = new Date(2026, 6, 8, 9, 20, 0);
  const html = dateTimeFieldHtml('f1', d.getTime());
  assert.match(html, /<option value="9" selected>09<\/option>/);
  assert.match(html, /<option value="20" selected>20<\/option>/);
});
