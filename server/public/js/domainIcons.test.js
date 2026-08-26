import test from 'node:test';
import assert from 'node:assert/strict';

import { DOMAIN_ICONS, domainIcon } from './domainIcons.js';
import { SECTION_MANIFEST, VIEW_MANIFEST } from './viewManifest.js';

test('bottom navigation and More define every canonical view icon', () => {
  for (const [view, definition] of Object.entries(VIEW_MANIFEST)) {
    assert.equal(DOMAIN_ICONS[view], definition.iconKey, view);
  }
  for (const [section, definition] of Object.entries(SECTION_MANIFEST)) {
    assert.equal(DOMAIN_ICONS[section], definition.iconKey, section);
  }
  assert.equal(DOMAIN_ICONS.infoBoard, 'info');
  assert.equal(DOMAIN_ICONS.live, 'radioTower');
  assert.equal(DOMAIN_ICONS.skill, 'activity');
});

test('packing and To-Do use distinct symbols', () => {
  // The general-event footer places these actions side by side, so their
  // symbols must remain distinguishable even without reading the labels.
  assert.equal(domainIcon('competition'), domainIcon('tournaments'));
  assert.equal(domainIcon('insights'), domainIcon('leaderboard'));
  assert.notEqual(domainIcon('checklistPacking'), domainIcon('checklist'));
});

test('unknown domains use the requested fallback', () => {
  assert.equal(domainIcon('unknown'), 'bell');
  assert.equal(domainIcon('unknown', 'info'), 'info');
});
