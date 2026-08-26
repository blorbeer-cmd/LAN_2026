import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { VIEW_MANIFEST } from './viewManifest.js';

// The lifecycle module owns browser views whose module-level listeners are
// intentionally wired against window. Supply the minimal event target that
// lets this Node contract test import the real executable handler registry.
globalThis.window ??= { addEventListener() {} };
const { APP_LIFECYCLE_HANDLERS, VIEW_LIFECYCLE_HANDLERS } = await import('./viewLifecycle.js');

const jsDir = dirname(fileURLToPath(import.meta.url));
const lifecycleSource = readFileSync(join(jsDir, 'viewLifecycle.js'), 'utf8');
const appSource = readFileSync(join(jsDir, 'app.js'), 'utf8');

const EVENT_INDEPENDENT = new Map([
  ['invalidateSkillSuggestions', 'Account-wide game history is not narrowed by the active event.'],
  ['invalidateMissingSkills', 'Missing self-ratings are per account and game.'],
  ['invalidateAdminMemberships', 'Group membership and roles outlive every event.'],
]);

function sourceFiles() {
  const viewsDir = join(jsDir, 'views');
  return [
    ...readdirSync(viewsDir)
      .filter((name) => name.endsWith('.js') && !name.endsWith('.test.js'))
      .map((name) => join(viewsDir, name)),
    ...readdirSync(jsDir)
      .filter((name) => name.endsWith('.js') && !name.endsWith('.test.js'))
      .map((name) => join(jsDir, name)),
  ];
}

function exportedInvalidators() {
  const found = new Map();
  for (const file of sourceFiles()) {
    const source = readFileSync(file, 'utf8');
    for (const match of source.matchAll(/^export function (invalidate[A-Za-z0-9_]*)\s*\(/gm)) {
      found.set(match[1], file.slice(jsDir.length + 1));
    }
  }
  return found;
}

test('every invalidator is owned by the lifecycle layer or explicitly event-independent', () => {
  const unaccounted = [...exportedInvalidators().entries()]
    .filter(([name]) => !lifecycleSource.includes(name) && !EVENT_INDEPENDENT.has(name))
    .map(([name, file]) => `${name} (${file})`);
  assert.deepEqual(unaccounted, []);
});

test('app orchestrates lifecycle events without importing view invalidators', () => {
  const invalidatorImports = [...appSource.matchAll(/import\s+\{([^}]*)\}\s+from\s+['"]([^'"]+)['"]/g)]
    .filter(([, names]) => /\binvalidate[A-Za-z0-9_]*/.test(names))
    .map(([, , source]) => source);
  assert.deepEqual(invalidatorImports, ['./viewLifecycle.js']);
  assert.match(appSource, /invalidateEventScopedViews\(VIEW_REGISTRY\)/);
  assert.match(appSource, /invalidateViewsAfterReconnect\(VIEW_REGISTRY\)/);
});

test('known event-scoped views declare the workspace boundary in the registry', () => {
  for (const view of [
    'home', 'matchmaking', 'votes', 'tournaments', 'seating', 'broadcast',
    'foodOrders', 'eventPolls', 'checklist', 'checklistPacking', 'arrivals',
    'music', 'analytics', 'myStats', 'hallOfFame', 'admin',
    'adminFeatureUsage', 'profile',
  ]) {
    assert.equal(VIEW_MANIFEST[view].lifecycle.eventScoped, true, view);
    assert.ok(VIEW_MANIFEST[view].lifecycle.invalidateOn.includes('event-context:changed'), view);
  }
});

test('every registered view handler is enabled by its lifecycle declaration', () => {
  for (const [view, handlers] of Object.entries(VIEW_LIFECYCLE_HANDLERS)) {
    for (const eventName of Object.keys(handlers)) {
      assert.ok(
        VIEW_MANIFEST[view].lifecycle.invalidateOn.includes(eventName),
        `${view}.${eventName} must be reachable through invalidateViewCaches()`,
      );
    }
  }
});

test('the event switch still drops every secondary cache and drawn lineup', () => {
  const expectedInvalidators = {
    home: ['invalidateAktuellStatus', 'invalidateHomeSeating'],
    matchmaking: ['invalidateMatchmakingHistory', 'invalidateMatchmakingDraft'],
    votes: ['invalidateVoteEventScope'],
    tournaments: ['invalidateTournaments'],
    seating: ['invalidateSeating'],
    broadcast: ['invalidateBroadcasts'],
    foodOrders: ['invalidateFoodOrders'],
    eventPolls: ['invalidateEventPolls'],
    checklist: ['invalidateChecklist'],
    arrivals: ['invalidateArrivals'],
    music: ['invalidateMusic'],
    analytics: ['invalidateAnalytics'],
    myStats: ['invalidateMyStats'],
    hallOfFame: ['invalidateHallOfFame'],
    admin: ['invalidateAdminReadiness'],
    adminFeatureUsage: ['invalidateAdminFeatureUsage'],
    profile: ['invalidateSeatNeighbors'],
    app: ['invalidateInfoBoard'],
  };

  for (const [owner, names] of Object.entries(expectedInvalidators)) {
    const handler = owner === 'app'
      ? APP_LIFECYCLE_HANDLERS['event-context:changed']
      : VIEW_LIFECYCLE_HANDLERS[owner]?.['event-context:changed'];
    assert.equal(typeof handler, 'function', `${owner} needs an event-context:changed handler`);
    for (const name of names) {
      assert.ok(
        handler.toString().includes(name),
        `${owner}.${name} must be reachable from its event-context:changed handler`,
      );
    }
  }
  assert.match(APP_LIFECYCLE_HANDLERS['event-context:changed'].toString(), /state\.lastMatchmaking = null/);
});
