import assert from 'node:assert/strict';
import test from 'node:test';

import checker from './check-design-tokens.js';

const { findUndefinedCustomProperties } = checker;

test('accepts custom properties defined anywhere in the frontend sources', () => {
  const findings = findUndefinedCustomProperties([
    { file: 'server/public/css/style.css', source: ':root { --radius: 14px; }' },
    { file: 'server/public/js/view.js', source: '`<div style="border-radius:var(--radius)">`' },
  ]);

  assert.deepEqual(findings, []);
});

test('accepts dynamically assigned custom properties and explicit fallbacks', () => {
  const findings = findUndefinedCustomProperties([
    {
      file: 'server/public/js/view.js',
      source: "slider.style.setProperty('--slider-pct', value);",
    },
    {
      file: 'server/public/css/style.css',
      source: '.slider { left: var(--slider-pct); width: var(--external-width, 100%); }',
    },
  ]);

  assert.deepEqual(findings, []);
});

test('reports every undefined custom property with its source line', () => {
  const findings = findUndefinedCustomProperties([
    {
      file: 'server/public/css/style.css',
      source: '.card {\n  border-radius: var(--radius-missing);\n}',
    },
  ]);

  assert.deepEqual(findings, [
    {
      file: 'server/public/css/style.css',
      line: 2,
      name: '--radius-missing',
    },
  ]);
});
