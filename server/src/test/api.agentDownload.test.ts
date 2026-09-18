// Integration tests for the personalized agent-download ZIP.
//
// The download packs server/agent-dist/respawn-agent.exe — a committed ~90 MB
// binary — through archiver at deflate level 9. Compressing it twice cost this
// file about 15 seconds, roughly a tenth of the whole unit/integration suite,
// to assert a status code and four bytes of ZIP magic. It also made the
// assertions conditional: with the executable absent, the success branch
// silently disappeared and the test still passed. AGENT_DIST_DIR therefore
// points at a small stub here, so both branches are exercised deterministically
// and neither depends on what happens to sit in the repository.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import fs from 'fs';
import os from 'os';
import path from 'path';
import request from 'supertest';
import { createTestApp } from './testApp';
import { agentExePath, buildAgentConfig, buildInstallBat, resolveAgentServerUrl } from '../routes/agentDownload';

const app = createTestApp();
let stubDistDir: string;
let playerId: string;

before(() => {
  stubDistDir = fs.mkdtempSync(path.join(os.tmpdir(), 'respawn-agent-dist-'));
  fs.writeFileSync(path.join(stubDistDir, 'respawn-agent.exe'), 'stub agent executable');
  process.env.AGENT_DIST_DIR = stubDistDir;
});

after(() => {
  delete process.env.AGENT_DIST_DIR;
  fs.rmSync(stubDistDir, { recursive: true, force: true });
});

test('buildAgentConfig defaults trackActivity to off', () => {
  const config = buildAgentConfig('http://192.168.1.50:3000', 'the-key', undefined);
  assert.deepEqual(config, {
    serverUrl: 'http://192.168.1.50:3000',
    apiKey: 'the-key',
    pollIntervalMs: 10000,
    trackActivity: false,
  });
});

test('buildAgentConfig only turns trackActivity on for exactly "1"', () => {
  assert.equal(buildAgentConfig('http://x', 'k', '1').trackActivity, true);
  assert.equal(buildAgentConfig('http://x', 'k', 'true').trackActivity, false);
  assert.equal(buildAgentConfig('http://x', 'k', '0').trackActivity, false);
});

test('resolveAgentServerUrl prefers the configured public URL', () => {
  assert.equal(resolveAgentServerUrl('http', 'internal:3000', 'https://lan.example/'), 'https://lan.example');
  assert.equal(resolveAgentServerUrl('https', 'lan.example', ''), 'https://lan.example');
});

test('buildInstallBat replaces a running legacy agent before installing the secure launcher', () => {
  const script = buildInstallBat();
  const stageIndex = script.indexOf('respawn-agent.exe.new');
  const stopIndex = script.indexOf('Stop-Process -Id $_.ProcessId -Force');
  const replaceIndex = script.indexOf('move /Y "%INSTALL_DIR%\\respawn-agent.exe.new"');
  const shortcutIndex = script.indexOf('Respawn-Agent Steuerung.lnk');

  assert.ok(stageIndex >= 0 && stageIndex < stopIndex, 'the replacement must be staged before stopping the old agent');
  assert.ok(stopIndex < replaceIndex, 'the running executable must be stopped before replacement');
  assert.match(script, /if \(@\(Get-InstalledAgent\)\.Count -gt 0\) \{ exit 1 \}/);
  assert.ok(replaceIndex < shortcutIndex, 'the secure launcher must be created only after replacement succeeds');
  assert.ok((script.match(/if errorlevel 1 goto install_failed/g) ?? []).length >= 5);
  assert.match(script, /:install_failed[\s\S]*exit \/b 1/);
  assert.match(script, /Respawn-Agent Steuerung\.lnk/);
  assert.match(script, /--open-control/);
  assert.doesNotMatch(script, /URL=http:\/\/127\.0\.0\.1/);
});

test('the generated upgrade command releases a running Windows executable for replacement', {
  skip: process.platform !== 'win32',
}, async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'respawn-agent-upgrade-'));
  const installedExe = path.join(tempDir, 'respawn-agent.exe');
  const stagedExe = `${installedExe}.new`;
  let legacyAgent: ChildProcess | undefined;

  try {
    fs.copyFileSync(process.execPath, installedExe);
    fs.writeFileSync(stagedExe, 'secure replacement');
    legacyAgent = spawn(installedExe, ['-e', 'setInterval(() => {}, 1000)'], {
      stdio: 'ignore',
      windowsHide: true,
    });
    await once(legacyAgent, 'spawn');
    const exitPromise = once(legacyAgent, 'exit');

    const stopLine = buildInstallBat().split('\r\n')
      .find((line) => line.includes('function Get-InstalledAgent'));
    assert.ok(stopLine);
    const commandMarker = '-Command "';
    const commandStart = stopLine.indexOf(commandMarker);
    assert.ok(commandStart >= 0 && stopLine.endsWith('"'));
    const command = stopLine.slice(commandStart + commandMarker.length, -1);

    execFileSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', command], {
      env: { ...process.env, RESPAWN_AGENT_PATH: installedExe },
      windowsHide: true,
    });
    await exitPromise;

    fs.renameSync(stagedExe, installedExe);
    assert.equal(fs.readFileSync(installedExe, 'utf8'), 'secure replacement');
  } finally {
    legacyAgent?.kill();
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('agentExePath honours AGENT_DIST_DIR and falls back to the shipped directory', () => {
  assert.equal(agentExePath(), path.join(stubDistDir, 'respawn-agent.exe'));
  delete process.env.AGENT_DIST_DIR;
  assert.match(agentExePath(), /agent-dist[/\\]respawn-agent\.exe$/);
  process.env.AGENT_DIST_DIR = stubDistDir;
});

test('setup: a player', async () => {
  const p = await request(app).post('/api/players').send({ name: 'Download Tester' });
  playerId = p.body.id;
});

test('GET /api/agent-download derives the player from the session', async () => {
  const res = await request(app).get('/api/agent-download');
  assert.equal(res.status, 200);
});

test('GET /api/agent-download 404s for an unknown player', async () => {
  const res = await request(app).get('/api/agent-download?playerId=ghost');
  assert.equal(res.status, 401);
});

test('GET /api/agent-download streams a real ZIP named after the player', async () => {
  const res = await request(app)
    .get(`/api/agent-download?playerId=${playerId}`)
    .buffer(true)
    .parse((r, cb) => {
      const chunks: Buffer[] = [];
      r.on('data', (c: Buffer) => chunks.push(c));
      r.on('end', () => cb(null, Buffer.concat(chunks)));
    });

  assert.equal(res.status, 200);
  assert.equal(res.headers['content-type'], 'application/zip');
  assert.match(res.headers['content-disposition'] ?? '', /Respawn-Agent-Download_Tester\.zip/);
  // ZIP local-file-header magic ("PK\x03\x04") proves a real archive got
  // streamed, not an error page with ZIP headers.
  assert.equal((res.body as Buffer).subarray(0, 4).toString('binary'), 'PK\x03\x04');
});

test('GET /api/agent-download returns a clean 503 when the exe is not deployed', async () => {
  const emptyDir = fs.mkdtempSync(path.join(os.tmpdir(), 'respawn-agent-dist-empty-'));
  process.env.AGENT_DIST_DIR = emptyDir;
  try {
    const res = await request(app).get(`/api/agent-download?playerId=${playerId}`);
    assert.equal(res.status, 503);
    assert.match(res.body.error, /agent-dist\/respawn-agent\.exe fehlt/);
  } finally {
    process.env.AGENT_DIST_DIR = stubDistDir;
    fs.rmSync(emptyDir, { recursive: true, force: true });
  }
});
