import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_EVENT_TYPE_KEY,
  EVENT_FEATURE_CATALOG,
  EVENT_FEATURE_KEYS,
  EVENT_TYPE_KEYS,
  EVENT_TYPE_PRESETS,
  eventTypeIsUndated,
  isEventFeatureKey,
  isEventTypeKey,
} from './eventFeatureCatalog';

test('event feature catalog exposes unique stable keys and complete descriptors', () => {
  assert.equal(new Set(EVENT_FEATURE_KEYS).size, EVENT_FEATURE_KEYS.length);
  assert.deepEqual(Object.keys(EVENT_FEATURE_CATALOG), [...EVENT_FEATURE_KEYS]);
  for (const featureKey of EVENT_FEATURE_KEYS) {
    const descriptor = EVENT_FEATURE_CATALOG[featureKey];
    assert.equal(descriptor.key, featureKey);
    assert.ok(descriptor.version > 0);
    assert.ok(descriptor.title.length > 0);
    assert.ok(descriptor.description.length > 0);
    assert.ok(descriptor.requiredFeatureKeys.every(isEventFeatureKey));
  }
});

test('event type presets only reference known features and satisfy hard dependencies', () => {
  assert.equal(DEFAULT_EVENT_TYPE_KEY, 'lan');
  assert.deepEqual(Object.keys(EVENT_TYPE_PRESETS), [...EVENT_TYPE_KEYS]);
  for (const eventTypeKey of EVENT_TYPE_KEYS) {
    const preset = EVENT_TYPE_PRESETS[eventTypeKey];
    assert.equal(preset.key, eventTypeKey);
    assert.ok(preset.version > 0);
    assert.ok(preset.recommendedFeatureKeys.every(isEventFeatureKey));
    assert.ok(preset.suggestedFeatureKeys.every(isEventFeatureKey));
    assert.equal(new Set(preset.recommendedFeatureKeys).size, preset.recommendedFeatureKeys.length);
    assert.equal(new Set(preset.suggestedFeatureKeys).size, preset.suggestedFeatureKeys.length);
    for (const featureKey of preset.recommendedFeatureKeys) {
      for (const dependency of EVENT_FEATURE_CATALOG[featureKey].requiredFeatureKeys) {
        assert.ok(
          preset.recommendedFeatureKeys.includes(dependency),
          `${eventTypeKey}: ${featureKey} requires ${dependency}`,
        );
      }
    }
  }
  assert.deepEqual(EVENT_TYPE_PRESETS.lan.recommendedFeatureKeys, EVENT_FEATURE_KEYS);
  assert.deepEqual(EVENT_TYPE_PRESETS.general.recommendedFeatureKeys, [
    'tasks',
    'packing',
    'travel',
    'food',
    'costs',
    'music',
    'arcade',
  ]);
  // A group is permanently open and free: no period planning, no money, no
  // packing for a trip that never happens, and nothing that needs a running
  // LAN (tracking, kiosk, seating).
  assert.deepEqual(EVENT_TYPE_PRESETS.group.recommendedFeatureKeys, [
    'tasks',
    'food',
    'music',
    'games',
    'arcade',
  ]);
  assert.equal(eventTypeIsUndated('group'), true);
  assert.equal(eventTypeIsUndated('lan'), false);
  assert.equal(eventTypeIsUndated('general'), false);
  assert.equal(isEventTypeKey('general'), true);
  assert.equal(isEventTypeKey('group'), true);
  assert.equal(isEventTypeKey('trip'), false);
  assert.equal(isEventTypeKey('unknown'), false);
});
