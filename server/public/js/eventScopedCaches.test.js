// Switching the active event has to leave nothing of the previous workspace
// on screen. loadAll() takes care of everything in `state`, but every view
// that fetches from its own endpoint caches outside `state` — and those
// caches are only dropped because app.js's invalidateEventScopedCaches()
// names them one by one.
//
// That hand-maintained list is exactly the kind of thing that drifts: a new
// view ships its own cache plus an invalidator, nobody remembers the list in
// app.js, and the new area silently keeps showing the previous event's data.
// This test makes that impossible to miss — every invalidator a view exports
// must either be called on an event switch or be declared event-independent
// here, with a reason.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const jsDir = dirname(fileURLToPath(import.meta.url));

// Invalidators whose data does not belong to an event. Each entry needs a
// reason, so "add it here to make the test pass" stays a deliberate claim
// about the endpoint rather than a shortcut.
const EVENT_INDEPENDENT = new Map([
  ['invalidateSkillSuggestions', 'GET /api/skills/suggestions derives from the group-wide match record, not from one event.'],
  ['invalidateMissingSkills', 'Missing self-ratings are per account and game; no event narrows them.'],
  ['invalidateAdminMemberships', 'Group membership and roles are instance data that outlive every event.'],
]);

function sourceFiles() {
  const viewsDir = join(jsDir, 'views');
  const files = readdirSync(viewsDir)
    .filter((name) => name.endsWith('.js') && !name.endsWith('.test.js'))
    .map((name) => join(viewsDir, name));
  files.push(...readdirSync(jsDir)
    .filter((name) => name.endsWith('.js') && !name.endsWith('.test.js'))
    .map((name) => join(jsDir, name)));
  return files;
}

function exportedInvalidators() {
  const found = new Map(); // name -> file
  for (const file of sourceFiles()) {
    const source = readFileSync(file, 'utf8');
    for (const match of source.matchAll(/^export function (invalidate[A-Za-z0-9_]*)\s*\(/gm)) {
      found.set(match[1], file.slice(jsDir.length + 1));
    }
  }
  return found;
}

function functionBody(source, signature) {
  const start = source.indexOf(signature);
  if (start === -1) return null;
  const opening = source.indexOf('{', start);
  let depth = 0;
  for (let i = opening; i < source.length; i += 1) {
    if (source[i] === '{') depth += 1;
    else if (source[i] === '}') {
      depth -= 1;
      if (depth === 0) return source.slice(opening, i);
    }
  }
  return null;
}

function invalidatorCallsIn(body) {
  return [...body.matchAll(/(invalidate[A-Za-z0-9_]*)\s*\(/g)].map((m) => m[1]);
}

// The names invalidateEventScopedCaches() reaches, following delegation:
// invalidateVoteEventScope() runs invalidateVoteHistory() on its way, so that
// cache is dropped on a switch just as surely as a directly listed one.
function eventSwitchInvalidatorCalls() {
  const appSource = readFileSync(join(jsDir, 'app.js'), 'utf8');
  const root = functionBody(appSource, 'function invalidateEventScopedCaches()');
  assert.ok(root, 'app.js must define invalidateEventScopedCaches() with a balanced body');

  const sources = sourceFiles().map((file) => readFileSync(file, 'utf8'));
  const reached = new Set();
  const queue = invalidatorCallsIn(root);
  while (queue.length > 0) {
    const name = queue.shift();
    if (reached.has(name)) continue;
    reached.add(name);
    for (const source of sources) {
      const body = functionBody(source, `export function ${name}(`);
      if (body) queue.push(...invalidatorCallsIn(body));
    }
  }
  return reached;
}

test('every view invalidator is either event-scoped or declared event-independent', () => {
  const exported = exportedInvalidators();
  const called = eventSwitchInvalidatorCalls();

  assert.ok(exported.size > 0, 'the scan must find the view invalidators');

  const unaccounted = [...exported.entries()]
    .filter(([name]) => !called.has(name) && !EVENT_INDEPENDENT.has(name))
    .map(([name, file]) => `${name} (${file})`);

  assert.deepEqual(
    unaccounted,
    [],
    `These invalidators are neither called when the active event changes nor declared event-independent.\n` +
      `Add the call to invalidateEventScopedCaches() in app.js, or list the name in EVENT_INDEPENDENT with a reason:\n  ` +
      unaccounted.join('\n  '),
  );
});

test('the event-independent allowlist stays honest about what still exists', () => {
  const exported = exportedInvalidators();
  const stale = [...EVENT_INDEPENDENT.keys()].filter((name) => !exported.has(name));
  assert.deepEqual(stale, [], `EVENT_INDEPENDENT names invalidators that no longer exist: ${stale.join(', ')}`);

  const contradictory = [...EVENT_INDEPENDENT.keys()].filter((name) => eventSwitchInvalidatorCalls().has(name));
  assert.deepEqual(
    contradictory,
    [],
    `These are declared event-independent but are invalidated on an event switch anyway: ${contradictory.join(', ')}`,
  );
});

test('the caches an event switch drops cover the known event-scoped areas', () => {
  // A regression guard with teeth: these are the areas the workspace model
  // promises to separate, so losing any one of them from the switch is a
  // behavioural change, not a refactor.
  const called = eventSwitchInvalidatorCalls();
  for (const name of [
    'invalidateAktuellStatus',
    'invalidateMatchmakingHistory',
    'invalidateMatchmakingDraft',
    'invalidateVoteEventScope',
    'invalidateTournaments',
    'invalidateHomeSeating',
    'invalidateSeating',
    'invalidateBroadcasts',
    'invalidateInfoBoard',
    'invalidateFoodOrders',
    'invalidateChecklist',
    'invalidateArrivals',
    'invalidateMusic',
    'invalidateAnalytics',
    'invalidateMyStats',
    'invalidateHallOfFame',
    'invalidateAdminReadiness',
    'invalidateSeatNeighbors',
  ]) {
    assert.ok(called.has(name), `${name} must run when the active event changes`);
  }
});

test('the drawn lineup is cleared with the rest of the workspace', () => {
  const source = readFileSync(join(jsDir, 'app.js'), 'utf8');
  const start = source.indexOf('function invalidateEventScopedCaches()');
  const body = source.slice(start, source.indexOf('\n}', start));
  assert.match(
    body,
    /state\.lastMatchmaking = null/,
    'state.lastMatchmaking survives loadAll(), so the event switch has to clear it explicitly',
  );
});
