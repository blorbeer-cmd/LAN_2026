#!/usr/bin/env node
// Pre-commit guard for the design system (see server/DESIGN_SYSTEM.md).
//
// The undefined-custom-property rule and the cleaned legacy rules read a full,
// internally consistent frontend snapshot: the Git index locally and the HEAD
// tree when CI passes `--base-ref`. Neither mode reads unrelated unstaged
// working-tree changes. Color, typography and radius debt remains guarded on
// added lines; spacing and responsive-breakpoint annotations are clean across
// the existing frontend and are therefore enforced on the complete snapshot.
//
// A new line that's a genuine, deliberate exception (not an oversight) can
// still pass by adding a `design-token-ok` comment on the same source line,
// e.g. `border-radius:2px; /* design-token-ok: scaled to bar height */` —
// mirroring the "leave a short comment explaining why" guidance in
// DESIGN_SYSTEM.md instead of silently bypassing the check.

const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const BASE_REF_FLAG = '--base-ref';
const baseRefFlagIndex = process.argv.indexOf(BASE_REF_FLAG);
const baseRef = baseRefFlagIndex === -1 ? null : process.argv[baseRefFlagIndex + 1];

if (baseRefFlagIndex !== -1 && (!baseRef || baseRef.startsWith('--'))) {
  console.error(`Missing value for ${BASE_REF_FLAG}.`);
  process.exit(2);
}

const SCOPE = 'server/public';
const FRONTEND_EXTENSIONS = new Set(['.css', '.html', '.js']);
const EXEMPT_FILES = new Set([
  // Single source of truth for the avatar swatch palette — hex values here
  // ARE the token definitions, not a bypass of them.
  'server/public/js/avatarPalette.js',
]);

const RULES = [
  {
    name: 'hardcoded hex color',
    test: (line) => /#[0-9a-fA-F]{3,8}\b/.test(line),
    exempt: (line, file) => {
      // Defining a new token in :root (`--foo-color: #112233;`) is how you're
      // supposed to introduce a color — that's not a bypass.
      if (/^\+\s*--[\w-]+\s*:\s*#/.test(line)) return true;
      // <meta name="theme-color"> can't consume a CSS custom property; this
      // is a documented, unavoidable duplicate of --bg (see DESIGN_SYSTEM.md).
      if (/theme-color/.test(line)) return true;
      return false;
    },
  },
  {
    name: 'hardcoded font-size/font-weight',
    test: (line) => /font-(size|weight):\s*[0-9]/.test(line),
    exempt: isCustomPropertyDefinition,
  },
  {
    name: 'hardcoded spacing (gap/padding/margin)',
    test: hasHardcodedSpacing,
    exempt: isCustomPropertyDefinition,
  },
  {
    name: 'hardcoded border-radius',
    test: (line) => /border-radius:\s*[0-9.]+px/.test(line),
    exempt: isCustomPropertyDefinition,
  },
];

function hasHardcodedSpacing(line) {
  return /(?:^|[\s;{'"])(?:(?:row-|column-|grid-)?gap|(?:padding|margin)(?:-(?:top|bottom|left|right|block(?:-start|-end)?|inline(?:-start|-end)?))?)\s*:[^;\n]*-?(?:\d*\.)?\d+px\b/.test(
    line,
  );
}

// Defining a custom property (`--bracket-pair-gap: 20px;`) is how a shared
// value is introduced, not a bypass of one — mirrors the hex-color rule's
// exemption for `--foo: #...` definitions.
function isCustomPropertyDefinition(line) {
  return /^\+\s*--[\w-]+\s*:\s*/.test(line);
}

function gitDiff(args) {
  return execFileSync('git', ['diff', ...args], { encoding: 'utf8' });
}

function changedFiles() {
  const revisionArgs = baseRef ? [`${baseRef}...HEAD`] : ['--cached'];
  const out = gitDiff(['--name-only', '--diff-filter=ACM', ...revisionArgs]);
  return out
    .split('\n')
    .map((f) => f.trim())
    .filter((f) => f.startsWith(SCOPE + '/') && /\.(css|js)$/.test(f))
    .filter((f) => !EXEMPT_FILES.has(f));
}

function addedLines(file) {
  // -U0: no context lines, only the actual diff hunks — keeps this to just
  // what's genuinely new in the commit or pull-request range.
  const revisionArgs = baseRef ? [`${baseRef}...HEAD`] : ['--cached'];
  // `git diff --name-only` reports paths relative to the repo root, but a
  // plain pathspec is resolved relative to the current working directory —
  // and this script runs from server/ via npm. `:(top)` pins the pathspec to
  // the repo root so the per-file diff isn't silently empty.
  const diff = gitDiff(['-U0', ...revisionArgs, '--', `:(top)${file}`]);
  return diff.split('\n').filter((l) => l.startsWith('+') && !l.startsWith('+++'));
}

function sourcesFromDirectory(root) {
  const files = [];

  function visit(directory) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const absolutePath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        visit(absolutePath);
      } else if (entry.isFile() && FRONTEND_EXTENSIONS.has(path.extname(entry.name))) {
        files.push(absolutePath);
      }
    }
  }

  visit(root);
  return files.sort().map((absolutePath) => ({
    file: `${SCOPE}/${path.relative(root, absolutePath).replaceAll('\\', '/')}`,
    source: fs.readFileSync(absolutePath, 'utf8'),
  }));
}

function frontendSources() {
  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'design-token-check-'));
  const snapshotRoot = path.join(temporaryRoot, 'snapshot');
  const gitEnvironment = { ...process.env };
  const repositoryRoot = execFileSync('git', ['rev-parse', '--show-toplevel'], {
    encoding: 'utf8',
  }).trim();

  try {
    fs.mkdirSync(snapshotRoot, { recursive: true });

    if (baseRef) {
      // CI checks the committed PR head, even if a caller happens to have
      // unrelated working-tree or index changes in its checkout.
      gitEnvironment.GIT_INDEX_FILE = path.join(temporaryRoot, 'head-index');
      execFileSync('git', ['read-tree', 'HEAD'], {
        cwd: repositoryRoot,
        env: gitEnvironment,
      });
    }

    const frontendFiles = execFileSync('git', ['ls-files', '-z', '--', SCOPE], {
      cwd: repositoryRoot,
      env: gitEnvironment,
    });
    const checkoutPrefix = `${snapshotRoot.replaceAll('\\', '/')}/`;
    execFileSync('git', ['checkout-index', '-z', '--stdin', `--prefix=${checkoutPrefix}`], {
      cwd: repositoryRoot,
      env: gitEnvironment,
      input: frontendFiles,
    });

    return sourcesFromDirectory(path.join(snapshotRoot, SCOPE));
  } finally {
    fs.rmSync(temporaryRoot, { recursive: true, force: true });
  }
}

function findUndefinedCustomProperties(sources) {
  const definitions = new Set();

  for (const { source } of sources) {
    for (const match of source.matchAll(/(--[\w-]+)\s*:/g)) {
      definitions.add(match[1]);
    }
    for (const match of source.matchAll(/\.setProperty\(\s*(['"`])(--[\w-]+)\1/g)) {
      definitions.add(match[2]);
    }
  }

  const undefinedReferences = [];
  for (const { file, source } of sources) {
    for (const match of source.matchAll(/var\(\s*(--[\w-]+)\s*(,)?/g)) {
      const [, name, fallbackMarker] = match;
      if (definitions.has(name) || fallbackMarker) continue;
      undefinedReferences.push({
        file,
        line: source.slice(0, match.index).split('\n').length,
        name,
      });
    }
  }

  return undefinedReferences;
}

function findLegacySnapshotViolations(sources) {
  const violations = [];

  for (const { file, source } of sources) {
    if (EXEMPT_FILES.has(file)) continue;
    const lines = source.split('\n');
    lines.forEach((line, index) => {
      if (line.includes('design-token-ok')) return;
      if (hasHardcodedSpacing(line)) {
        violations.push({
          file,
          line: index + 1,
          rule: 'hardcoded spacing (full frontend)',
          source: line.trim(),
        });
      }
      if (
        path.extname(file) === '.css' &&
        /@media\s*\(\s*(?:min|max)-(?:width|height)\s*:/.test(line) &&
        !line.includes('--bp-')
      ) {
        violations.push({
          file,
          line: index + 1,
          rule: 'unannotated responsive breakpoint (full frontend)',
          source: line.trim(),
        });
      }
    });
  }

  return violations;
}

function main() {
  const files = changedFiles();
  const violations = [];
  const sources = frontendSources();
  const undefinedCustomProperties = findUndefinedCustomProperties(sources);
  const legacySnapshotViolations = findLegacySnapshotViolations(sources);

  for (const file of files) {
    for (const line of addedLines(file)) {
      if (line.includes('design-token-ok')) continue;
      for (const rule of RULES) {
        if (rule.test(line) && !(rule.exempt && rule.exempt(line, file))) {
          violations.push({ file, rule: rule.name, line: line.slice(1).trim() });
        }
      }
    }
  }

  if (undefinedCustomProperties.length === 0 && violations.length === 0 && legacySnapshotViolations.length === 0) {
    return 0;
  }

  if (undefinedCustomProperties.length > 0) {
    console.error('\n✗ Design-token check failed — undefined CSS custom property reference(s):\n');
    for (const reference of undefinedCustomProperties) {
      console.error(`  ${reference.file}:${reference.line} [${reference.name}]`);
    }
    console.error(
      '\nDefine each property in the design-system tokens, set it dynamically with style.setProperty(...), ' +
        'or provide an intentional var(--name, fallback) value.\n',
    );
  }

  if (legacySnapshotViolations.length > 0) {
    console.error('\n✗ Design-token check failed — cleaned legacy contract regressed:\n');
    for (const violation of legacySnapshotViolations) {
      console.error(`  ${violation.file}:${violation.line} [${violation.rule}]`);
      console.error(`    ${violation.source}`);
    }
    console.error(
      '\nUse a spacing token and annotate standard @media values with their --bp-* token. ' +
        'Document a genuine exception with a same-line "design-token-ok" reason.\n',
    );
  }

  if (violations.length > 0) {
    const checkedScope = baseRef ? `changes since ${baseRef}` : 'staged changes';
    console.error(`\n✗ Design-token check failed — hardcoded value(s) found in ${checkedScope}:\n`);
    for (const v of violations) {
      console.error(`  ${v.file} [${v.rule}]`);
      console.error(`    ${v.line}`);
    }
    console.error(
      '\nUse an existing token from server/DESIGN_SYSTEM.md instead (var(--space-N), var(--font-size-*), ...).',
    );
    console.error(
      'If this is a genuine, deliberate exception, add a same-line comment containing "design-token-ok"\n' +
        'plus a short reason (see "When a value genuinely doesn\'t fit" in DESIGN_SYSTEM.md).\n',
    );
  }

  return 1;
}

if (require.main === module) {
  process.exitCode = main();
}

module.exports = { findLegacySnapshotViolations, findUndefinedCustomProperties, frontendSources, main };
