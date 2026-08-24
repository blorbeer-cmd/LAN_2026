import { test } from 'node:test';
import assert from 'node:assert/strict';
import { availableEventTypeOptions, eventTypeTitle } from './eventTypes.js';

test('event types fall back to the two MVP choices', () => {
  assert.deepEqual(
    availableEventTypeOptions([]).map((option) => option.key),
    ['lan', 'general'],
  );
});

test('event type titles prefer the server catalog and degrade safely', () => {
  const options = [{ key: 'general', title: 'Gemeinsames Event' }];
  assert.equal(eventTypeTitle('general', options), 'Gemeinsames Event');
  assert.equal(eventTypeTitle('lan'), 'LAN-Party');
  assert.equal(eventTypeTitle('future', options), 'Event');
});
