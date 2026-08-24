// The "Meine Statistiken" data-basis line. Two accounts legitimately see
// different totals here because each aggregate covers only the events its own
// account took part in, so this sentence is what keeps the difference from
// reading as a bug (docs/KONZEPT-EVENT-SICHTBARKEIT.md, Abschnitt 4.4).

import test from 'node:test';
import assert from 'node:assert/strict';
import { dataBasisText } from './views/myStats.js';

test('the singular case agrees in number', () => {
  // Not an edge case: every account starts out in the base event alone, so
  // this is what a member sees until they accept their first LAN invitation.
  assert.equal(dataBasisText(['instance-base-event'], ''), 'Aus einem Event, an dem du teilgenommen hast.');
});

test('the plural case names the count', () => {
  assert.equal(
    dataBasisText(['a', 'b', 'c', 'd'], ''),
    'Aus deinen 4 Events, an denen du teilgenommen hast.',
  );
});

test('a selected event says nothing, because the dropdown already does', () => {
  assert.equal(dataBasisText(['a', 'b'], 'a'), '');
});

test('an empty or missing allowlist stays silent instead of claiming zero events', () => {
  assert.equal(dataBasisText([], ''), '');
  assert.equal(dataBasisText(undefined, ''), '');
});
