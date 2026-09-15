import assert from 'node:assert/strict';
import path from 'node:path';
import { test } from 'node:test';
import {
  VISUAL_REFERENCE_PLATFORM,
  dockerStatus,
  ensureVisualReferenceImage,
  prepareVisualReference,
  runVisualOwnersInContainer,
  visualContainerArguments,
  visualFilesForSelection,
  visualReferenceImageTag,
} from './visual-reference.mjs';

test('the image tag follows Dockerfile and lockfile content, not checkout line endings', () => {
  const contents = {
    Dockerfile: 'FROM pinned\nRUN npm ci\n',
    'Dockerfile.dockerignore': '*\n',
    'package.json': '{}\n',
    'package-lock.json': '{"lockfileVersion":3}\n',
  };
  const tagFor = (files) => visualReferenceImageTag((file) => files[path.basename(file)]);
  const tag = tagFor(contents);
  assert.match(tag, /^respawn-visual-reference:[0-9a-f]{16}$/);
  const windowsCheckout = Object.fromEntries(
    Object.entries(contents).map(([name, text]) => [name, text.replace(/\n/g, '\r\n')]),
  );
  assert.equal(tagFor(windowsCheckout), tag);
  assert.notEqual(tagFor({ ...contents, 'package-lock.json': '{"lockfileVersion":4}\n' }), tag);
  assert.notEqual(tagFor({ ...contents, Dockerfile: 'FROM other\nRUN npm ci\n' }), tag);
});

test('Docker availability names the concrete cause', () => {
  assert.deepEqual(dockerStatus(() => ({ status: 0, stdout: 'linux/amd64\n', stderr: '' })), {
    ok: true,
    server: 'linux/amd64',
  });
  const missingCli = Object.assign(new Error('spawn docker ENOENT'), { code: 'ENOENT' });
  assert.equal(dockerStatus(() => ({ error: missingCli })).reason, 'Docker-CLI nicht gefunden');
  assert.equal(
    dockerStatus(() => ({
      status: 1,
      stdout: '/\n',
      stderr: '\nfailed to connect to the docker API at npipe:////./pipe/dockerDesktopLinuxEngine\n',
    })).reason,
    'Docker-Engine nicht erreichbar (failed to connect to the docker API at npipe:////./pipe/dockerDesktopLinuxEngine)',
  );
  assert.match(
    dockerStatus(() => ({ status: 0, stdout: 'windows/amd64\n', stderr: '' })).reason,
    /windows\/amd64-Containern; benötigt werden Linux-Container/,
  );
});

test('containers mount the checkout read-only and never reuse the host dependencies', () => {
  const args = visualContainerArguments({
    tag: 'respawn-visual-reference:0123456789abcdef',
    files: ['visualCore.e2e.test.ts', 'visualArcade.e2e.test.ts'],
    artifactDirectory: '/runner/e2e/runs/1',
    env: { NODE_ENV: 'test', E2E_FAST_TIMERS: '1', E2E_TRACE: '1', ImageOS: 'ubuntu24', GH_TOKEN: 'secret' },
  });
  const valuesOf = (flag) => args.flatMap((arg, index) => (args[index - 1] === flag ? [arg] : []));
  const mounts = valuesOf('--mount');
  assert.equal(mounts.length, 3);
  assert.match(mounts[0], /^type=bind,source=.+,target=\/work,readonly$/);
  assert.equal(mounts[1], 'type=volume,target=/work/server/node_modules');
  assert.equal(mounts[2], 'type=bind,source=/runner/e2e/runs/1,target=/artifacts');
  assert.deepEqual(valuesOf('--platform'), [VISUAL_REFERENCE_PLATFORM]);
  assert.deepEqual(valuesOf('--env'), ['NODE_ENV=test', 'E2E_FAST_TIMERS=1', 'E2E_TRACE=1', 'E2E_ARTIFACT_DIR=/artifacts']);
  assert.deepEqual(args.slice(-2), [
    'dist-test/test/e2e/visualCore.e2e.test.js',
    'dist-test/test/e2e/visualArcade.e2e.test.js',
  ]);
});

test('the image is built only when missing, and build or dependency failures stop the visual run', () => {
  const calls = [];
  const missingImage = (command, args) => {
    calls.push(args[0]);
    return args[0] === 'image' ? { status: 1, stdout: '' } : { status: 0 };
  };
  assert.equal(ensureVisualReferenceImage({ run: missingImage, log: () => undefined, tag: 'image:1' }), 'image:1');
  assert.deepEqual(calls, ['image', 'build']);

  calls.length = 0;
  const presentImage = (command, args) => {
    calls.push(args[0]);
    return { status: 0, stdout: `${VISUAL_REFERENCE_PLATFORM}\n` };
  };
  assert.equal(ensureVisualReferenceImage({ run: presentImage, tag: 'image:1' }), 'image:1');
  assert.deepEqual(calls, ['image']);

  const failingBuild = (command, args) => (args[0] === 'image' ? { status: 1, stdout: '' } : { status: 1 });
  assert.throws(
    () => ensureVisualReferenceImage({ run: failingBuild, log: () => undefined, tag: 'image:1' }),
    /Referenzumgebung konnte nicht gebaut werden \(docker build: Exit 1\)/,
  );
  assert.throws(
    () => runVisualOwnersInContainer({
      files: ['visualCore.e2e.test.ts'],
      artifactDirectory: '/runner/e2e/runs/1',
      run: () => assert.fail('no Docker call without Linux dependencies'),
      fileExists: () => false,
    }),
    /server\/node_modules fehlt/,
  );
});

test('a missing Docker engine only fails where the comparison is demanded', () => {
  const missing = () => ({ ok: false, reason: 'Docker-CLI nicht gefunden' });
  const ensureImage = () => assert.fail('no image build without a Docker engine');
  const prepare = (env) => {
    const messages = [];
    prepareVisualReference({
      argv: ['prepare', 'arcade-smoke'],
      env,
      docker: missing,
      ensureImage,
      log: (message) => messages.push(message),
    });
    return messages;
  };

  for (const env of [{}, { CI: '' }, { CI: 'false' }, { CI: 'true', RESPAWN_VISUAL_REQUIRED: '0' }]) {
    assert.match(
      prepare(env).join('\n'),
      /ÜBERSPRUNGEN: visualArcade\.e2e\.test\.ts – Docker-CLI nicht gefunden\. .*optional.*Einrichtung/,
      JSON.stringify(env),
    );
  }
  for (const env of [{ CI: 'true' }, { CI: '1' }, { RESPAWN_VISUAL_REQUIRED: '1' }]) {
    assert.throws(() => prepare(env), /Docker-CLI nicht gefunden\. Einrichtung/, JSON.stringify(env));
  }

  // A selection without visual owners never asks for Docker at all.
  const withoutVisualOwners = [];
  prepareVisualReference({
    argv: ['prepare', 'core', 'auth'],
    env: { CI: 'true' },
    docker: () => assert.fail('no Docker check without a visual owner'),
    ensureImage,
    log: (message) => withoutVisualOwners.push(message),
  });
  assert.match(withoutVisualOwners.join('\n'), /enthält keine visuellen Referenztests/);
});

test('only selections with a visual owner need the reference container', () => {
  assert.deepEqual(visualFilesForSelection('core', 'auth,checklist'), []);
  assert.deepEqual(visualFilesForSelection('core', 'flows'), ['visualCore.e2e.test.ts']);
  assert.deepEqual(visualFilesForSelection('arcade-smoke'), ['visualArcade.e2e.test.ts']);
  assert.deepEqual(visualFilesForSelection('arcade'), ['visualArcade.e2e.test.ts']);
  assert.deepEqual(visualFilesForSelection('all'), ['visualCore.e2e.test.ts', 'visualArcade.e2e.test.ts']);
});
