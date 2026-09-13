import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const repositoryRoot = fileURLToPath(new URL('../../', import.meta.url));
const hookSource = join(repositoryRoot, '.githooks', 'pre-commit');
const designCheckerSource = join(repositoryRoot, 'server', 'scripts', 'check-design-tokens.js');
const componentCheckerSource = join(repositoryRoot, 'server', 'scripts', 'check-component-contracts.mjs');
const cssFiles = ['style', 'domains', 'arcade', 'overlays', 'kiosk'].map((name) => `server/public/css/${name}.css`);
const createdDirectories = [];
const readOnlyGitEnvironment = { ...process.env, GIT_OPTIONAL_LOCKS: '0' };

function write(directory, file, source) {
  const target = join(directory, file);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, source);
}

function git(directory, args, options = {}) {
  return execFileSync('git', args, {
    cwd: directory,
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'pipe'],
    ...options,
  });
}

function commit(directory, message) {
  const marker = join(directory, 'component-invocations.log');
  const result = spawnSync('git', ['commit', '-m', message], {
    cwd: directory,
    encoding: 'utf8',
    env: {
      ...process.env,
      PACKAGE5B_COMPONENT_CHECKER: componentCheckerSource,
      PACKAGE5B_COMPONENT_INVOCATIONS: marker,
    },
  });
  return { ...result, marker };
}

function fixture() {
  const directory = mkdtempSync(join(tmpdir(), 'pre-commit-hook-fixture-'));
  createdDirectories.push(directory);
  try {
    git(directory, ['init', '-q']);
    git(directory, ['config', 'user.email', 'fixture@example.invalid']);
    git(directory, ['config', 'user.name', 'Hook fixture']);
    git(directory, ['config', 'commit.gpgsign', 'false']);
    git(directory, ['config', 'core.hooksPath', join(directory, 'no-hooks')]);

    write(
      directory,
      cssFiles[0],
      ':root { --control-height: 32px; --line: 1.25; }\n' + '.btn { min-height: var(--control-height); padding: 0; }\n',
    );
    for (const file of cssFiles.slice(1)) write(directory, file, '');
    write(directory, 'server/public/js/view.js', 'const markup = `<button class="btn">Go</button>`;\n');
    write(
      directory,
      'server/frontend-contracts/component-registry.mjs',
      [
        "export const components = [{ id: 'button', role: 'standard-control', selector: '.btn', owner: 'public/css/style.css', contract: 'components/test.md#button', purpose: 'Base button.' }];",
        'export const permanentVariants = [];',
        'export const temporaryExceptions = [];',
      ].join('\n'),
    );
    write(directory, 'server/frontend-contracts/components/test.md', '# Button\n\nregistry:button\n');

    const hookTarget = join(directory, '.githooks', 'pre-commit');
    mkdirSync(dirname(hookTarget), { recursive: true });
    copyFileSync(hookSource, hookTarget);
    chmodSync(hookTarget, 0o755);
    const designCheckerTarget = join(directory, 'server', 'scripts', 'check-design-tokens.js');
    mkdirSync(dirname(designCheckerTarget), { recursive: true });
    copyFileSync(designCheckerSource, designCheckerTarget);
    write(
      directory,
      'server/scripts/check-component-contracts.mjs',
      [
        "import { appendFileSync } from 'node:fs';",
        "import { spawnSync } from 'node:child_process';",
        'const args = process.argv.slice(2);',
        "appendFileSync(process.env.PACKAGE5B_COMPONENT_INVOCATIONS, JSON.stringify(args) + '\\n');",
        "const result = spawnSync(process.execPath, [process.env.PACKAGE5B_COMPONENT_CHECKER, ...args], { cwd: process.cwd(), stdio: 'inherit' });",
        'process.exit(result.status ?? 2);',
      ].join('\n'),
    );
    mkdirSync(join(directory, 'server', 'node_modules', 'typescript'), { recursive: true });

    git(directory, ['add', '.']);
    git(directory, ['commit', '-qm', 'Fixture base']);
    git(directory, ['config', 'core.hooksPath', '.githooks']);
    return directory;
  } catch (error) {
    rmSync(directory, { recursive: true, force: true });
    throw error;
  }
}

function withFixture(run) {
  const directory = fixture();
  try {
    run(directory);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

test('the pre-commit hook gates commits with both staged checks without touching the real repository', () => {
  const realState = {
    status: git(repositoryRoot, ['status', '--porcelain=v1', '--untracked-files=all'], {
      env: readOnlyGitEnvironment,
    }),
    index: git(repositoryRoot, ['ls-files', '--stage'], { env: readOnlyGitEnvironment }),
    hook: readFileSync(hookSource, 'utf8'),
    hooksPath: spawnSync('git', ['config', '--local', '--get', 'core.hooksPath'], {
      cwd: repositoryRoot,
      encoding: 'utf8',
      env: readOnlyGitEnvironment,
    }),
  };

  try {
    withFixture((directory) => {
      write(directory, 'notes.txt', 'safe change\n');
      git(directory, ['add', 'notes.txt']);
      const result = commit(directory, 'Allow valid snapshots');
      assert.equal(result.status, 0, result.stderr);
      assert.equal(readFileSync(result.marker, 'utf8'), '["--staged"]\n');
    });

    withFixture((directory) => {
      rmSync(join(directory, 'server', 'node_modules'), { recursive: true, force: true });
      write(directory, 'notes.txt', 'dependencies missing\n');
      git(directory, ['add', 'notes.txt']);
      const result = commit(directory, 'Explain missing server dependencies');
      assert.notEqual(result.status, 0);
      assert.match(result.stderr, /requires server dependencies.*npm --prefix server install/);
      assert.equal(existsSync(result.marker), false, 'the checker must not start without its dependency');
    });

    withFixture((directory) => {
      write(
        directory,
        'server/public/js/view.js',
        'const markup = `<button class="btn">Go</button>`; const color = "#123456";\n',
      );
      git(directory, ['add', 'server/public/js/view.js']);
      const result = commit(directory, 'Reject design-token violation');
      assert.notEqual(result.status, 0);
      assert.match(result.stderr, /Design-token check failed/);
      assert.equal(existsSync(result.marker), false, 'the later check must not mask or follow a token failure');
    });

    withFixture((directory) => {
      const violation = '.context .btn { line-height: var(--line); }\n';
      write(directory, cssFiles[1], violation);
      git(directory, ['add', cssFiles[1]]);
      write(directory, cssFiles[1], '');
      const result = commit(directory, 'Reject staged component violation');
      assert.notEqual(result.status, 0);
      assert.equal(readFileSync(result.marker, 'utf8'), '["--staged"]\n');
      assert.match(result.stdout + result.stderr, /VIOLATION/);
      assert.equal(git(directory, ['show', `:${cssFiles[1]}`]), violation);
      assert.equal(readFileSync(join(directory, cssFiles[1]), 'utf8'), '');
    });

    withFixture((directory) => {
      write(directory, cssFiles[1], '.context .btn { line-height: var(--line); }\n');
      write(directory, 'notes.txt', 'only this file is staged\n');
      git(directory, ['add', 'notes.txt']);
      const result = commit(directory, 'Ignore unstaged component violation');
      assert.equal(result.status, 0, result.stderr);
      assert.equal(readFileSync(result.marker, 'utf8'), '["--staged"]\n');
      assert.match(git(directory, ['status', '--porcelain=v1']), /^ M server\/public\/css\/domains\.css$/m);
    });
  } finally {
    assert.equal(
      git(repositoryRoot, ['status', '--porcelain=v1', '--untracked-files=all'], {
        env: readOnlyGitEnvironment,
      }),
      realState.status,
    );
    assert.equal(git(repositoryRoot, ['ls-files', '--stage'], { env: readOnlyGitEnvironment }), realState.index);
    assert.equal(readFileSync(hookSource, 'utf8'), realState.hook);
    const hooksPath = spawnSync('git', ['config', '--local', '--get', 'core.hooksPath'], {
      cwd: repositoryRoot,
      encoding: 'utf8',
      env: readOnlyGitEnvironment,
    });
    assert.equal(hooksPath.status, realState.hooksPath.status);
    assert.equal(hooksPath.stdout, realState.hooksPath.stdout);
    assert.ok(createdDirectories.every((directory) => !existsSync(directory)));
  }
});
