import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { analyze, cssFiles, inventoryJs, parseCss, splitSelectors, subject } from './check-component-contracts.mjs';

const checker = fileURLToPath(new URL('./check-component-contracts.mjs', import.meta.url));
const contract = 'components/test.md#contract';
const button = { id: 'button', role: 'standard-control', selector: '.btn', owner: 'public/css/style.css', contract, purpose: 'Base button.' };
const variant = { id: 'menu', role: 'structural-target', selector: '.menu > .btn', owner: 'public/css/domains.css', contract, properties: ['height'], reason: 'Menu rows use a larger target.' };
const exception = { id: 'migration', file: 'public/css/domains.css', selector: '.old .btn', property: 'padding', value: '3px', reason: 'Legacy embedded action awaits the named owner migration.', finding: 'Old action still sets three-pixel padding.', targetPackage: 7, removalCriterion: 'Delete after old action uses its owner class and this declaration is removed.', contract };

function snapshot({ css = '.btn { min-height: 32px; padding: 0; }', domain = '', js = 'const markup = `<button class="btn">Go</button>`;', components = [button], variants = [], exceptions = [] } = {}) {
  const files = new Map(cssFiles.map(file => [file, '']));
  files.set(cssFiles[0], css);
  files.set(cssFiles[1], domain);
  files.set('server/public/js/view.js', js);
  files.set('server/frontend-contracts/component-registry.mjs', Object.entries({ components, permanentVariants: variants, temporaryExceptions: exceptions }).map(([key, value]) => `export const ${key} = ${JSON.stringify(value)};`).join('\n'));
  files.set('server/frontend-contracts/components/test.md', '# Contract\n' + [...components, ...variants, ...exceptions].map(entry => `registry:${entry.id}`).join('\n'));
  return files;
}

test('separates declaration candidates from ownership violations, regardless of tokens or suppression', async () => {
  const result = await analyze(snapshot({ domain: '.panel .btn { line-height: var(--line); width: 20px; /* design-token-ok: fixed chart scale */ }' }));
  assert.equal(result.counts.geometryCandidates, 1); // Base height is a permitted candidate.
  assert.equal(result.counts.violations, 2); // Suppression does not grant ownership.
  assert.equal(result.registryDiagnostics.length, 0);
  assert.deepEqual(result.violations.map(item => item.property), ['line-height', 'width']);
  assert.equal(result.findings.find(item => item.property === 'min-height').classification, 'component-owner');
});

test('parses lists, functions, strings, comments and nested at-rules by declaration', () => {
  const source = '@media (width > 400px) { @supports (display: grid) { .btn:is(.a,.b), input[data-x="a,b>{}"] { width: calc(100% - 20px); height: var(--h, 24px); content: "};,"; --local: 99px; } } }';
  const parsed = parseCss(source, 'fixture.css');
  assert.equal(parsed.rules.length, 1);
  assert.equal(parsed.declarations.length, 4);
  assert.deepEqual(parsed.rules[0].selectors, ['.btn:is(.a,.b)', 'input[data-x="a,b>{}"]']);
  assert.deepEqual(splitSelectors('.a:not(.b,.c), /* , */ .d'), ['.a:not(.b,.c)', '.d']);
  assert.equal(subject('.ancestor:has(.btn) > input[data-x="a b"]'), 'input[data-x="a b"]');
  assert.throws(() => parseCss('.btn { width: calc(1px; }', 'broken.css'), /Unbalanced/);
  assert.throws(() => parseCss('.btn { width: 1px;', 'broken.css'), /unclosed/);
});

test('candidate query counts declarations, ignores preambles and custom definitions, and honors only reasoned same-line comments', async () => {
  const result = await analyze(snapshot({ css: [
    ':root { --width: 99px; --color: rgba(1,2,3,.5); }',
    '@media (min-width: 400px) { @container (width < 300px) {',
    '.surface { width: calc(100% - 2px); height: var(--h, 3px); color: rgba(1,2,3,.5);',
    'max-width: 4px; /* design-token-ok: fixed plotting area */',
    '/* design-token-ok: previous line is not a suppression */',
    'min-width: 5px;',
    'max-height: 6px; /* design-token-ok */',
    'min-height: 7px; /* design-token-ok: */',
    'padding: 9px; width: var(--size); background: url("width-20px"); } } }',
    '.btn { padding: 0; }',
  ].join('\n') }));
  assert.equal(result.counts.geometryCandidates, 5);
  assert.equal(result.counts.colorCandidates, 1);
  assert.equal(result.exitCode, 0);
  assert.deepEqual(result.candidates.filter(item => item.line === 3).map(item => item.property), ['color', 'height', 'width']);
});

test('requires exact permanent variants and exact exceptions, and rejects stale entries', async () => {
  const options = { domain: '.menu > .btn { height: 44px; } .old .btn { padding: 3px; }', variants: [variant], exceptions: [exception] };
  const result = await analyze(snapshot(options));
  assert.equal(result.exitCode, 0);
  assert.equal(result.findings.find(item => item.registryId === 'menu').classification, 'permanent-variant');
  assert.equal(result.findings.find(item => item.registryId === 'migration').classification, 'temporary-exception');
  const changed = await analyze(snapshot({ ...options, domain: '.menu > .btn { height: 44px; padding: 0; } .old .btn:hover { padding: 3px; }' }));
  assert.equal(changed.violations.length, 2);
  assert.ok(changed.registryDiagnostics.some(item => item.id === 'migration' && item.code === 'stale-entry'));
  const wrongValue = await analyze(snapshot({ ...options, domain: '.menu > .btn { height: 44px; } .old .btn { padding: 4px; }' }));
  assert.equal(wrongValue.violations.length, 1);
});

test('unknown modifiers and JS extra classes fail independently of raw-value candidates', async () => {
  const result = await analyze(snapshot({ css: '.btn { padding: 0; } .narrow { line-height: var(--line); }', js: 'const markup = `<button class="btn btn-mystery narrow">Go</button>`;' }));
  assert.equal(result.candidates.length, 0);
  assert.ok(result.violations.some(item => item.code === 'modifier' && item.value === 'btn-mystery'));
  assert.ok(result.violations.some(item => item.code === 'markup-class' && item.value === 'narrow'));
  assert.ok(result.violations.some(item => item.code === 'css-ownership' && item.selector === '.narrow'));
  const ancestor = await analyze(snapshot({ css: '.btn { padding: 0; } .wrapper:has(.btn) .caption { height: 12px; }' }));
  assert.equal(ancestor.violations.length, 0);
});

test('checks literal inline styles, style properties, bracket properties and internal icon size', async () => {
  const result = await analyze(snapshot({ css: '.btn { padding: 0; } .btn > svg { width: 14px; }', js: [
    'const html = `<button class="btn" style="padding:var(--space);width:${size}px">Go</button>`;',
    'element.style.height = "32px";',
    'element.style["fontSize"] = "12px";',
    'element.style.setProperty("line-height", "1");',
  ].join('\n') }));
  assert.equal(result.violations.filter(item => item.code === 'inline-style').length, 2);
  assert.equal(result.violations.filter(item => item.code === 'element-style').length, 3);
  assert.equal(result.violations.filter(item => item.code === 'internal-icon').length, 1);
});

test('documents dynamic classes and properties without inventing names or guessing template tags', async () => {
  const source = 'const html = `<button class="btn btn-${kind} ${extra}">Go</button><${tag} class="hidden-${kind}">x</${tag}>`; element.style[property] = "20px";';
  const result = inventoryJs(source, 'server/public/js/view.js');
  assert.deepEqual(result.markup[0].classes, ['btn']);
  assert.equal(result.markup.length, 1);
  assert.ok(result.boundaries.some(item => item.kind === 'dynamic-class'));
  assert.ok(result.boundaries.some(item => item.kind === 'dynamic-property'));
  assert.equal(result.assignments.length, 0);
  const checked = await analyze(snapshot({ js: source }));
  assert.equal(checked.violations.length, 0);
  assert.ok(checked.registryDiagnostics.some(item => item.code === 'unregistered-dynamic-control'));
});

test('validates unique contract ownership, anchors and literal registry data', async () => {
  const files = snapshot();
  files.set('server/frontend-contracts/components/second.md', '# Other\nregistry:button');
  assert.ok((await analyze(files)).registryDiagnostics.some(item => item.code === 'contract-reference-count'));
  files.delete('server/frontend-contracts/components/second.md');
  files.set('server/frontend-contracts/components/test.md', '# Wrong\nregistry:button');
  assert.ok((await analyze(files)).registryDiagnostics.some(item => item.code === 'missing-contract-anchor'));
  files.set('server/frontend-contracts/component-registry.mjs', 'export const components = process.env;');
  await assert.rejects(() => analyze(files), /literal data/);
});

test('CSS strings cannot impersonate suppression comments and nested at-rules retain their subject', async () => {
  const result = await analyze(snapshot({ css: '.btn {\ncontent: "/* design-token-ok: string */"; width: 12px;\n@media (width > 400px) { height: 13px; }\n}', domain: '@font-face { size-adjust: 100%; }' }));
  assert.equal(result.counts.geometryCandidates, 2);
  assert.equal(result.violations.length, 0);
  assert.equal(result.findings.filter(item => item.code === 'css-ownership' && item.classification === 'component-owner').length, 2);
  assert.equal(parseCss('.x { content: "/* text */"; }', 'fixture.css').declarations[0].value, '"/* text */"');
});

test('HTML exceptions match the exact element attributes, property and value', async () => {
  const migration = { ...exception, file: 'public/js/view.js', selector: 'button.btn[data-action="old"]' };
  const js = 'const html = `<button class="btn" data-action="old" style="padding:3px"></button><button class="btn" data-action="new" style="padding:3px"></button>`;';
  const result = await analyze(snapshot({ js, exceptions: [migration] }));
  assert.equal(result.findings.filter(item => item.classification === 'temporary-exception').length, 1);
  assert.equal(result.violations.length, 1);
  assert.equal(result.registryDiagnostics.length, 0);
});

test('individual call bindings and dynamic evidence become stale when their exact source disappears', async () => {
  const ring = { ...button, id: 'ring', control: false, calls: [{ file: 'public/js/view.js', callKey: 'ring.style.width', property: 'width', value: 'size' }], dynamicUses: [{ file: 'public/js/view.js', source: 'btn-${kind}', reason: 'Known conditional modifier caller.' }] };
  const active = { components: [ring], js: 'const html = `<button class="btn btn-${kind}"></button>`; ring.style.width = size;' };
  assert.equal((await analyze(snapshot(active))).exitCode, 0);
  const removed = await analyze(snapshot({ ...active, js: 'const html = `<button class="btn"></button>`;' }));
  assert.deepEqual(removed.registryDiagnostics.map(item => item.code).sort(), ['stale-call-binding', 'stale-dynamic-use']);
});

test('staged and head use isolated Git snapshots, ignore unstaged sources and registry, and leave the repository untouched', () => {
  const directory = mkdtempSync(join(tmpdir(), 'component-contract-fixture-'));
  const git = args => execFileSync('git', args, { cwd: directory, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
  const write = (file, source) => { mkdirSync(dirname(join(directory, file)), { recursive: true }); writeFileSync(join(directory, file), source); };
  const check = (mode, cwd = directory) => {
    const result = spawnSync(process.execPath, [checker, mode, '--json'], { cwd, encoding: 'utf8' });
    assert.notEqual(result.status, 2, result.stderr);
    return { status: result.status, report: JSON.parse(result.stdout) };
  };
  try {
    git(['init', '-q']);
    git(['config', 'user.email', 'fixture@example.invalid']);
    git(['config', 'user.name', 'Contract fixture']);
    git(['config', 'core.hooksPath', join(directory, 'no-hooks')]);
    for (const [file, source] of snapshot()) write(file, source);
    git(['add', '.']); git(['commit', '-qm', 'Fixture base']);
    const head = check('--head');
    assert.equal(head.status, 0);
    assert.deepEqual(check('--staged'), head);
    assert.deepEqual(check('--staged', join(directory, 'server')), head);
    assert.deepEqual(check('--head', join(directory, 'server')), head);
    write(cssFiles[1], '.context .btn { padding: 2px; }');
    write('server/frontend-contracts/component-registry.mjs', 'invalid working-tree registry');
    assert.deepEqual(check('--staged'), head);
    git(['add', cssFiles[1]]);
    const before = git(['status', '--porcelain=v1']);
    const tree = git(['write-tree']);
    const staged = check('--staged');
    assert.equal(staged.status, 1);
    assert.deepEqual(check('--head'), head);
    assert.equal(git(['status', '--porcelain=v1']), before);
    assert.equal(git(['write-tree']), tree);
    git(['commit', '-qm', 'Fixture staged override']);
    assert.deepEqual(check('--head'), staged);
    git(['rm', '--cached', cssFiles[0]]);
    const missing = spawnSync(process.execPath, [checker, '--staged'], { cwd: directory, encoding: 'utf8' });
    assert.equal(missing.status, 2);
    assert.match(missing.stderr, /Missing staged snapshot file/);
  } finally {
    // The only recursive removal targets the exact directory returned by mkdtemp, never a worktree.
    rmSync(directory, { recursive: true, force: true });
  }
});

test('the repository staged component snapshot satisfies its registry contracts', () => {
  const result = spawnSync(process.execPath, [checker, '--staged', '--json'], { cwd: fileURLToPath(new URL('../../', import.meta.url)), encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
  const report = result.stdout ? JSON.parse(result.stdout) : null;
  assert.equal(result.status, 0, result.stderr || JSON.stringify({ violations: report?.violations, registryDiagnostics: report?.registryDiagnostics }));
});
