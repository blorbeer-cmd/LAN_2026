import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import checker from './check-design-tokens.js';

const { findUndefinedCustomProperties } = checker;
const checkerPath = fileURLToPath(new URL('./check-design-tokens.js', import.meta.url));

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

test('reads the complete frontend from the staged index instead of the working tree', () => {
  const repository = mkdtempSync(join(tmpdir(), 'design-token-index-test-'));
  const stylesheet = join(repository, 'server', 'public', 'css', 'style.css');
  const stagedSource = ':root { --radius: 14px; }\n.card { border-radius: var(--radius); }\n';
  const unstagedSource = '.card { border-radius: var(--unfinished-wip); }\n';

  try {
    mkdirSync(join(repository, 'server', 'public', 'css'), { recursive: true });
    execFileSync('git', ['init', '--quiet'], { cwd: repository });
    execFileSync('git', ['config', 'core.autocrlf', 'false'], { cwd: repository });
    writeFileSync(stylesheet, stagedSource);
    execFileSync('git', ['add', 'server/public/css/style.css'], { cwd: repository });
    writeFileSync(stylesheet, unstagedSource);

    const program =
      `const checker = require(${JSON.stringify(checkerPath)});` +
      'process.stdout.write(JSON.stringify(checker.frontendSources()));';
    const sources = JSON.parse(execFileSync(process.execPath, ['-e', program], { cwd: repository, encoding: 'utf8' }));

    assert.equal(readFileSync(stylesheet, 'utf8'), unstagedSource);
    assert.equal(sources.length, 1);
    assert.equal(sources[0].file, 'server/public/css/style.css');
    assert.match(sources[0].source, /--radius/);
    assert.doesNotMatch(sources[0].source, /--unfinished-wip/);
    assert.deepEqual(findUndefinedCustomProperties(sources), []);
  } finally {
    rmSync(repository, { recursive: true, force: true });
  }
});
