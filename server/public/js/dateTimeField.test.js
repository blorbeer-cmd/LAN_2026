import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  calendarMonthTargetMs,
  dateTimeFieldHtml,
  formatDateTyping,
  formatTimeTyping,
  parseDateInput,
  parseTimeInput,
} from './dateTimeField.js';

test('an empty value renders one editable date and one editable time field', () => {
  const html = dateTimeFieldHtml('my-field', null, { clearable: true, label: 'Beginn' });
  assert.match(html, /id="my-field-date"[^>]+placeholder="TT\.MM\.JJJJ"/);
  assert.match(html, /id="my-field-time"[^>]+placeholder="HH:MM"/);
  assert.doesNotMatch(html, /data-dt-hour|data-dt-minute|<select/);
  assert.match(html, /aria-label="Kalender für Beginn öffnen"/);
});

test('a set value renders localized visible values and the compatible hidden value', () => {
  const value = new Date(2026, 6, 8, 14, 35, 0).getTime();
  const html = dateTimeFieldHtml('my-field', value);
  assert.match(html, /id="my-field" value="2026-07-08T14:35"/);
  assert.match(html, /data-dt-date[^>]+value="08\.07\.2026"/);
  assert.match(html, /data-dt-time[^>]+value="14:35"/);
});

test('the minute value snaps to the shared 5-minute step', () => {
  const value = new Date(2026, 6, 8, 14, 37, 0).getTime();
  const html = dateTimeFieldHtml('my-field', value);
  assert.match(html, /value="2026-07-08T14:35"/);
  assert.match(html, /data-dt-time[^>]+value="14:35"/);
});

test('clearable controls the clear action and required state', () => {
  const clearable = dateTimeFieldHtml('f1', Date.now(), { clearable: true });
  assert.match(clearable, /class="dt-clear-btn[^>]+data-dt-clear/);
  assert.doesNotMatch(clearable, /data-dt-date[^>]+ required/);

  const required = dateTimeFieldHtml('f2', Date.now());
  assert.doesNotMatch(required, /class="dt-clear-btn/);
  assert.match(required, /data-dt-date[^>]+ required/);
  assert.match(required, /data-dt-time[^>]+ required/);
});

test('disabled disables every visible control', () => {
  const html = dateTimeFieldHtml('f1', Date.now(), { disabled: true, clearable: true });
  assert.match(html, /data-dt-date[^>]+ disabled/);
  assert.match(html, /data-dt-trigger[^>]+ disabled/);
  assert.match(html, /data-dt-time[^>]+ disabled/);
  assert.match(html, /data-dt-clear[^>]+ disabled/);
});

test('date-only mode omits the time field but preserves the hidden contract', () => {
  const value = new Date(2026, 6, 8, 14, 37, 0).getTime();
  const html = dateTimeFieldHtml('f1', value, { dateOnly: true });
  assert.doesNotMatch(html, /data-dt-time/);
  assert.match(html, /value="2026-07-08T14:37"/);
  assert.match(html, /value="08\.07\.2026"/);
});

test('manual German date parsing rejects impossible dates', () => {
  assert.deepEqual(parseDateInput('8.7.2026'), { day: 8, month: 6, year: 2026 });
  assert.deepEqual(parseDateInput('08.07.2026'), { day: 8, month: 6, year: 2026 });
  assert.equal(parseDateInput('31.02.2026'), null);
  assert.equal(parseDateInput('2026-07-08'), null);
});

test('manual 24-hour time parsing validates hours and minutes', () => {
  assert.deepEqual(parseTimeInput('9:05'), { hour: 9, minute: 5 });
  assert.deepEqual(parseTimeInput('23:59'), { hour: 23, minute: 59 });
  assert.equal(parseTimeInput('24:00'), null);
  assert.equal(parseTimeInput('12:60'), null);
});

test('numeric mobile typing inserts the separators required by the visible formats', () => {
  assert.equal(formatDateTyping('08072026'), '08.07.2026');
  assert.equal(formatDateTyping('08'), '08.');
  assert.equal(formatDateTyping('08..07..2026'), '08.07.2026');
  assert.equal(formatTimeTyping('1435'), '14:35');
  assert.equal(formatTimeTyping('14'), '14:');
});

test('typing helpers preserve supported short and partially entered forms', () => {
  assert.equal(formatDateTyping('8.7.2026'), '8.7.2026');
  assert.equal(formatDateTyping('8.'), '8.');
  assert.equal(formatTimeTyping('9:05'), '9:05');
  assert.equal(formatTimeTyping('9:'), '9:');
});

test('calendar month paging never moves focus into a fully disabled month', () => {
  const focused = new Date(2026, 7, 24).getTime();
  const minimum = new Date(2026, 7, 24, 14, 5).getTime();
  assert.equal(calendarMonthTargetMs(focused, -1, minimum), focused);
});

test('calendar month paging clamps focus to the first enabled day and valid month length', () => {
  const minimum = new Date(2026, 8, 20, 14, 5).getTime();
  assert.equal(
    calendarMonthTargetMs(new Date(2026, 9, 12).getTime(), -1, minimum),
    new Date(2026, 8, 20).getTime(),
  );
  assert.equal(
    calendarMonthTargetMs(new Date(2027, 0, 31).getTime(), 1),
    new Date(2027, 1, 28).getTime(),
  );
});
