import test from 'node:test';
import assert from 'node:assert/strict';
import { AREA_TOURS, getAreaTour } from './areaTourCatalog.js';
import { ARCADE_TOURS } from './arcade/areaTours.js';
import { stepsForTour } from './areaTours.js';
import { VIEW_MANIFEST } from './viewManifest.js';

test('every area and game has concise tour copy with stable unambiguous step ids', () => {
  const catalogs = { ...AREA_TOURS, ...ARCADE_TOURS };
  for (const [key, route] of Object.entries(VIEW_MANIFEST)) {
    assert.ok(catalogs[key], `Missing tour: ${key} (${route.label})`);
  }
  for (const [key, tour] of Object.entries(catalogs)) {
    const chapters = new Set();
    for (const chapter of tour.chapters) {
      assert.ok(!chapters.has(chapter.id), `${key}: duplicate chapter`);
      chapters.add(chapter.id);
      const ids = new Set();
      for (const step of chapter.steps) {
        assert.ok(!ids.has(step.id), `${key}/${chapter.id}: duplicate step`);
        ids.add(step.id);
        assert.ok(step.title.length <= 55, `${key}: long title`);
        assert.ok(step.text.trim().split(/\s+/u).length <= 30, `${key}/${step.id}: text exceeds 30 words`);
      }
    }
    const steps = stepsForTour(tour);
    assert.equal(new Set(steps.map((step) => step.id)).size, steps.length);
  }
});

test('admin and feature-dependent explanations follow the current context', () => {
  assert.equal(getAreaTour('admin', { admin: false }), null);
  assert.ok(getAreaTour('admin', { admin: true }));
  const memberEvents = getAreaTour('events', { admin: false });
  assert.deepEqual(memberEvents.chapters.map((chapter) => chapter.id), ['participate']);
  const generalProfile = getAreaTour('profile', { event: { enabledFeatures: [] } });
  assert.ok(!generalProfile.chapters.some((chapter) => chapter.id === 'agent'));
  assert.ok(!stepsForTour(generalProfile).some((step) => step.id === 'privacy/delete-tracking'));
  assert.ok(stepsForTour(generalProfile).some((step) => step.id === 'privacy/export'));
  assert.ok(!stepsForTour(generalProfile).some((step) => step.id === 'account/admin'));
  assert.deepEqual(stepsForTour(memberEvents, 'missing'), []);
});
