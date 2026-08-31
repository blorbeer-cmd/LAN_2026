import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import {
  bottomNavigationEntries,
  createLazyRenderer,
  createViewRegistry,
  desktopNavigationEntries,
  moreNavigationEntries,
  searchableViewEntries,
  sectionViews,
  VIEW_MANIFEST,
} from './viewManifest.js';

const jsDir = path.dirname(fileURLToPath(import.meta.url));

function productionJavaScriptFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) return productionJavaScriptFiles(absolute);
    return entry.name.endsWith('.js') && !entry.name.endsWith('.test.js') ? [absolute] : [];
  });
}

test('the view manifest resolves every Arcade route export and every Core renderer', () => {
  const coreRenderers = {};
  const declaredArcadeModules = new Set();
  for (const [name, entry] of Object.entries(VIEW_MANIFEST)) {
    if (entry.area === 'core') {
      coreRenderers[name] = () => {};
      continue;
    }
    assert.match(entry.module, /^\.\/arcade\/views\//, name);
    declaredArcadeModules.add(path.basename(entry.module));
    const moduleFile = fileURLToPath(new URL(entry.module, import.meta.url));
    const source = readFileSync(moduleFile, 'utf8');
    assert.match(source, new RegExp(`export\\s+(?:async\\s+)?function\\s+${entry.exportName}\\b`),
      `${name}: ${entry.exportName}`);
  }

  const rendererFiles = readdirSync(path.join(jsDir, 'arcade', 'views'))
    .filter((file) => file.endsWith('.js'))
    .sort();
  assert.deepEqual(
    [...declaredArcadeModules].sort(),
    rendererFiles,
    'every Arcade renderer file must be classified by the manifest and every declaration must exist',
  );

  const registry = createViewRegistry(coreRenderers, {}, async () => ({}));
  assert.deepEqual(Object.keys(registry), Object.keys(VIEW_MANIFEST));
  for (const [name, entry] of Object.entries(registry)) {
    assert.equal(entry.area, VIEW_MANIFEST[name].area, name);
    assert.equal(typeof (entry.area === 'core' ? entry.render : entry.resolveRenderer), 'function', name);
  }
});

test('every route carries the shared navigation and lifecycle contract', () => {
  for (const [view, entry] of Object.entries(VIEW_MANIFEST)) {
    assert.ok(entry.label, `${view}: label`);
    assert.ok(entry.iconKey, `${view}: iconKey`);
    assert.ok(['core', 'arcade'].includes(entry.area), `${view}: area`);
    assert.ok(Array.isArray(entry.lifecycle.invalidateOn), `${view}: invalidateOn`);
    assert.ok(Array.isArray(entry.lifecycle.refreshOn), `${view}: refreshOn`);
    assert.equal(typeof entry.lifecycle.preserveState, 'boolean', `${view}: preserveState`);
    if (entry.requiresRole) assert.equal(entry.requiresRole, 'admin', `${view}: requiresRole`);
  }

  assert.deepEqual(sectionViews('competition').map((entry) => entry.view), ['matchmaking', 'tournaments']);
  assert.deepEqual(bottomNavigationEntries('lan').map((entry) => entry.view), ['home', 'matchmaking', 'votes', 'foodOrders', 'gameCatalog', 'more']);
  assert.deepEqual(bottomNavigationEntries('general').map((entry) => entry.view), ['home', 'arrivals', 'checklistPacking', 'checklist', 'eventPolls', 'more']);
  assert.deepEqual(moreNavigationEntries('lan').map((entry) => entry.view ?? entry.section), ['profile', 'admin', 'arcade', 'broadcast', 'music', 'orga']);
  assert.deepEqual(
    desktopNavigationEntries('lan').map((entry) => entry.view),
    ['home', 'matchmaking', 'votes', 'gameCatalog', 'events', 'eventPolls', 'arrivals', 'checklistPacking', 'checklist', 'foodOrders', 'broadcast', 'arcade', 'music', 'admin', 'profile'],
  );
  assert.ok(searchableViewEntries().every((entry) => entry.view && entry.title && entry.description));
});

test('lazy renderers reuse a successful import and retry a failed fetch with a fresh URL', async () => {
  const renderer = () => {};
  const successfulRequests = [];
  const resolveOnce = createLazyRenderer('./arcade/views/arcade.js', 'renderArcade', async (request) => {
    successfulRequests.push(request);
    return { renderArcade: renderer };
  });
  assert.equal(await resolveOnce(), renderer);
  assert.equal(await resolveOnce(), renderer);
  assert.deepEqual(successfulRequests, ['./arcade/views/arcade.js']);

  const retryRequests = [];
  const resolveAfterFailure = createLazyRenderer('./arcade/views/arcade.js', 'renderArcade', async (request) => {
    retryRequests.push(request);
    if (retryRequests.length === 1) throw new Error('temporary fetch failure');
    return { renderArcade: renderer };
  });
  await assert.rejects(resolveAfterFailure(), /temporary fetch failure/);
  assert.equal(await resolveAfterFailure(), renderer);
  assert.deepEqual(retryRequests, [
    './arcade/views/arcade.js',
    './arcade/views/arcade.js?arcade-retry=1',
  ]);
});

test('Core production modules do not statically import Arcade implementation details', () => {
  const violations = [];
  for (const file of productionJavaScriptFiles(jsDir)) {
    if (file.includes(`${path.sep}arcade${path.sep}`)) continue;
    const source = readFileSync(file, 'utf8');
    const imports = [...source.matchAll(/(?:from\s+|import\s*)['"](\.\/arcade\/[^'"]+)['"]/g)]
      .map((match) => match[1]);
    if (imports.length === 0) continue;
    const relative = path.relative(jsDir, file).replaceAll('\\', '/');
    const allowed = relative === 'kiosk.js' && imports.length === 2 && imports.every((specifier) =>
      ['./arcade/shared/arcadeStreamRenderer.js', './arcade/shared/snakeArenaLegend.js'].includes(specifier));
    if (!allowed) violations.push(`${relative}: ${imports.join(', ')}`);
  }
  assert.deepEqual(violations, []);
});
