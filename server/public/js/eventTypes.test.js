import { test } from 'node:test';
import assert from 'node:assert/strict';
import { availableEventTypeOptions, eventIsGroup, eventTypeTitle, isGroupEventType } from './eventTypes.js';

test('event types fall back to the three built-in choices', () => {
  assert.deepEqual(
    availableEventTypeOptions([]).map((option) => option.key),
    ['lan', 'general', 'group'],
  );
});

test('only a real group counts as one, never the permanent base workspace', () => {
  assert.equal(isGroupEventType('group'), true);
  assert.equal(isGroupEventType('general'), false);
  assert.equal(eventIsGroup({ eventType: 'group' }), true);
  // The base workspace is permanently open too, but it is not a group and
  // keeps its own "Allgemein" identity everywhere.
  assert.equal(eventIsGroup({ eventType: 'group', isBase: true }), false);
  assert.equal(eventIsGroup({ eventType: 'lan' }), false);
  assert.equal(eventIsGroup(null), false);
});

test('event type titles prefer the server catalog and degrade safely', () => {
  const options = [{ key: 'general', title: 'Gemeinsames Event' }];
  assert.equal(eventTypeTitle('general', options), 'Gemeinsames Event');
  assert.equal(eventTypeTitle('lan'), 'LAN-Party');
  assert.equal(eventTypeTitle('group'), 'Gruppe');
  assert.equal(eventTypeTitle('future', options), 'Event');
});
