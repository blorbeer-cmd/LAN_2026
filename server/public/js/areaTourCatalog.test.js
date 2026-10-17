import test from 'node:test';
import assert from 'node:assert/strict';
import { AREA_TOURS, getAreaTour } from './areaTourCatalog.js';
import { ARCADE_TOURS } from './arcade/areaTours.js';
import { stepsForTour, tourPanelPlacement } from './areaTours.js';
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
  // Match the native game headers and result actions, including solo Chimp.
  for (const [key, fullscreen, rematch] of [
    ['quizRoom', false, true], ['tetris', true, true], ['pong', true, true],
    ['blobby', true, true], ['snake', true, true], ['battleship', false, true],
    ['chimp', false, false], ['scribbleRoom', true, false], ['challengeRush', false, false],
  ]) {
    const steps = stepsForTour(ARCADE_TOURS[key]);
    const pause = steps.find((step) => step.id === 'play/pause');
    const result = steps.find((step) => step.id === 'play/result');
    assert.equal(/Vollbild/.test(`${pause.title} ${pause.text}`), fullscreen, `${key}: fullscreen availability`);
    assert.match(pause.text, /Nur der Host kann/, `${key}: pausing requires the host`);
    assert.equal(/Revanche/.test(`${result.title} ${result.text}`), rematch, `${key}: rematch availability`);
    assert.equal(result.target, rematch ? '[data-rematch-request]' : '', `${key}: only highlight an available result action`);
  }
});

test('tour explanations avoid targets in shallow windows and scroll in the remaining space', () => {
  const viewport = { width: 800, height: 500 };
  const beside = tourPanelPlacement({ left: 424, right: 784, top: 60, bottom: 460 },
    { width: 320, height: 280 }, viewport, 16, 100);
  assert.equal(beside.align, 'left', 'notifications remain visible beside the explanation');
  assert.equal(beside.maxHeight, null);
  const below = tourPanelPlacement({ left: 160, right: 640, top: 150, bottom: 350 },
    { width: 320, height: 280 }, viewport, 16, 100);
  assert.equal(below.placement, 'bottom');
  assert.equal(below.maxHeight, 118, 'a centered Info dialog retains its visible area');
  const crowded = tourPanelPlacement({ left: 160, right: 640, top: 150, bottom: 350 },
    { width: 320, height: 280 }, viewport, 16, 180);
  assert.equal(crowded.maxHeight, null, 'overlap is preferable when the free space cannot fit the header, text and navigation');
});

test('real-view demonstration data is consistent, isolated and cannot proxy writes or unknown reads', () => {
  const now = 1_800_000_000_000;
  const key = (view, step) => tourDemoSceneKey(view, step, {}, now);
  assert.equal(key('gameCatalog', 'ratings/bock'), key('gameCatalog', 'ratings/skill'), 'ratings move the highlight without replacing their view');
  assert.equal(key('gameCatalog', 'catalog/platform'), key('gameCatalog', 'catalog/notes'), 'one creation form stays mounted across its field explanations');
  for (const [view, steps] of [
    ['matchmaking', ['draft/mode', 'draft/roster', 'draft/captains']],
    ['matchmaking', ['draft/order', 'draft/live']],
    ['foodOrders', ['order/open', 'order/item', 'order/quantity', 'order/price', 'order/sum']],
    ['events', ['participate/calendar', 'participate/confirm']],
  ]) {
    for (const step of steps.slice(1)) assert.equal(key(view, steps[0]), key(view, step),
      `${view}/${step}: explaining another part of the same example preserves its document`);
  }
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
  const home = createTourDemo('home', 'notifications/obsolete', {}, now);
  const task = home.responses['/api/me/todos'].todos.find((todo) => todo.kind === 'task');
  assert.ok(home.state.availableEvents.some((event) => event.id === task.eventId && event.myParticipation.status === 'accepted'),
    'an open task belongs to an accepted event, separate from pending invitations');
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
