import test from 'node:test';
import assert from 'node:assert/strict';
import { AREA_TOURS, getAreaTour } from './areaTourCatalog.js';
import { ARCADE_TOURS } from './arcade/areaTours.js';
import { stepsForTour } from './areaTours.js';
import { VIEW_MANIFEST } from './viewManifest.js';
import { exampleForTourStep, tourExampleHtml } from './areaTourExamples.js';

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
    for (const step of steps) {
      const example = exampleForTourStep(key, tour, step);
      assert.ok(example?.title, `${key}/${step.id}: missing example`);
      assert.ok(example.fields?.length || example.rows?.length, `${key}/${step.id}: empty example`);
    }
  }
});

test('example forms and entries escape values and cannot submit or navigate', () => {
  const unsafe = '<img src=x onerror="alert(1)">';
  const html = tourExampleHtml({ title: unsafe, kind: 'dialog', fields: [{ label: unsafe, value: unsafe }], rows: [{ title: unsafe, detail: unsafe }], actions: [unsafe] });
  assert.ok(!/<(?:img|form|a)\b/u.test(html));
  assert.match(html, /&lt;img/u);
  assert.match(html, /type="text" disabled value="&lt;img/u);
  assert.match(html, /type="button" class="btn btn-sm" disabled/u);
  const tour = AREA_TOURS.votes;
  assert.equal(exampleForTourStep('votes', tour, { id: 'vote/start' }).title, 'Abstimmung starten');
  assert.equal(exampleForTourStep('votes', tour, { id: 'vote/submitted' }).title, 'Samstagabend · Stimme gespeichert');
  assert.equal(exampleForTourStep('votes', tour, { id: 'result/close' }).title, 'Samstagabend · Ergebnis');
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
