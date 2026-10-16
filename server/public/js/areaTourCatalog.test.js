import test from 'node:test';
import assert from 'node:assert/strict';
import { AREA_TOURS, getAreaTour } from './areaTourCatalog.js';
import { ARCADE_TOURS } from './arcade/areaTours.js';
import { stepsForTour } from './areaTours.js';
import { VIEW_MANIFEST } from './viewManifest.js';
import { createTourDemo, demoApiResponse, DEMO_VIEWS, tourDemoSceneKey } from './areaTourDemoData.js';

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
    if (DEMO_VIEWS.includes(key)) for (const step of steps) {
      const demo = createTourDemo(key, step.id, {}, 1_800_000_000_000);
      assert.ok(demo.state.players.length && demo.state.games.length, `${key}/${step.id}: missing demo data`);
    }
  }
});

test('real-view demonstration data is consistent, isolated and cannot proxy writes or unknown reads', () => {
  const now = 1_800_000_000_000;
  const key = (view, step) => tourDemoSceneKey(view, step, {}, now);
  assert.equal(key('gameCatalog', 'ratings/bock'), key('gameCatalog', 'ratings/skill'), 'ratings move the highlight without replacing their view');
  assert.equal(key('gameCatalog', 'catalog/platform'), key('gameCatalog', 'catalog/notes'), 'one creation form stays mounted across its field explanations');
  assert.notEqual(key('votes', 'vote/prefill'), key('votes', 'vote/submitted'), 'a saved ballot is an actual state transition');
  const winner = createTourDemo('votes', 'result/close', {}, now).responses['/api/votes/history'].history[0].results;
  assert.ok(winner[0].points > winner[1].points && winner[0].votes < winner[1].votes,
    'the example illustrates that the points winner can have fewer willing players');
  const demo = createTourDemo('votes', 'result/close', {}, 1_800_000_000_000);
  const history = demo.responses['/api/votes/history'].history[0];
  for (const result of history.results) {
    assert.equal(result.points, history.ballots.reduce((sum, ballot) => sum + ballot.entries.find((entry) => entry.gameId === result.gameId).points, 0));
    assert.equal(result.votes, history.ballots.filter((ballot) => ballot.entries.some((entry) => entry.gameId === result.gameId && entry.points > 0)).length);
    assert.equal(result.score, result.points);
  }
  assert.ok(Number.isFinite(history.closedAt), 'history uses the actual API timestamp field');
  for (const method of ['POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']) {
    assert.equal(demoApiResponse(demo, '/api/votes/start', { method }).status, 405);
  }
  assert.equal(demoApiResponse(demo, '/api/unknown').status, 404);
  const response = demoApiResponse(demo, '/api/votes/history');
  response.body.history[0].title = 'Changed';
  assert.equal(history.title, 'Samstagabend');
  assert.equal(createTourDemo('profile', 'account/identity'), null);
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
