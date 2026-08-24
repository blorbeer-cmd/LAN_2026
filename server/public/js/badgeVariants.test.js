// Every `badge-*` variant a view renders has to exist as a CSS rule.
//
// The base `.badge` only brings layout and weight; each variant supplies its
// own background and colour. A variant that is rendered but never styled
// therefore shows up as bare bold text with badge padding — which is exactly
// what happened to `.badge-event` in the notification center. `check:tokens`
// could not catch it: it validates design tokens, not the existence of the
// classes the JS templates name.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const jsDir = dirname(fileURLToPath(import.meta.url));
const cssDir = join(jsDir, '..', 'css');

function jsFiles(dir) {
  const found = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      found.push(...jsFiles(full));
    } else if (name.endsWith('.js') && !name.endsWith('.test.js')) {
      found.push(full);
    }
  }
  return found;
}

// Variants built from a runtime value (`badge-${p.state}`) cannot be read
// statically. Their possible values are listed here so the check still covers
// them instead of silently skipping the dynamic call sites.
const DYNAMIC_VARIANTS = new Set([
  'badge-playing',
  'badge-online',
  'badge-paused',
  'badge-offline',
]);

function renderedBadgeVariants() {
  const variants = new Set(DYNAMIC_VARIANTS);
  for (const file of jsFiles(jsDir)) {
    const source = readFileSync(file, 'utf8');
    for (const match of source.matchAll(/badge-[a-z][a-z0-9-]*/g)) {
      // `badge-${...}` leaves a bare `badge-` behind; the set above covers it.
      if (match[0] !== 'badge-') variants.add(match[0]);
    }
  }
  return variants;
}

function definedBadgeClasses() {
  const defined = new Set();
  for (const name of readdirSync(cssDir)) {
    if (!name.endsWith('.css')) continue;
    const source = readFileSync(join(cssDir, name), 'utf8');
    for (const match of source.matchAll(/\.(badge-[a-z][a-z0-9-]*)\b/g)) defined.add(match[1]);
  }
  return defined;
}

test('every rendered badge variant has a stylesheet rule', () => {
  const rendered = [...renderedBadgeVariants()].sort();
  const defined = definedBadgeClasses();
  const missing = rendered.filter((variant) => !defined.has(variant));
  assert.deepEqual(
    missing,
    [],
    `These badge variants are rendered but have no CSS rule, so they show as unstyled bold text: ${missing.join(', ')}`,
  );
});

test('the dynamic variant list still matches real state badge classes', () => {
  const defined = definedBadgeClasses();
  const stale = [...DYNAMIC_VARIANTS].filter((variant) => !defined.has(variant));
  assert.deepEqual(stale, [], `DYNAMIC_VARIANTS names classes that no longer exist: ${stale.join(', ')}`);
});
