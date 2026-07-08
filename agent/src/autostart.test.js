const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  getStartupShortcutPath,
  isAutostartEnabled,
  enableAutostart,
  disableAutostart,
} = require('./autostart');

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'agent-autostart-test-'));
}

test('isAutostartEnabled is false when no shortcut exists', () => {
  const dir = tempDir();
  assert.equal(isAutostartEnabled(dir), false);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('isAutostartEnabled is true once the shortcut file exists', () => {
  const dir = tempDir();
  fs.writeFileSync(getStartupShortcutPath(dir), 'placeholder');
  assert.equal(isAutostartEnabled(dir), true);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('disableAutostart removes the shortcut and is a no-op if already absent', () => {
  const dir = tempDir();
  fs.writeFileSync(getStartupShortcutPath(dir), 'placeholder');
  disableAutostart(dir);
  assert.equal(isAutostartEnabled(dir), false);
  // Calling again on an already-removed shortcut must not throw.
  assert.doesNotThrow(() => disableAutostart(dir));
  fs.rmSync(dir, { recursive: true, force: true });
});

test('enableAutostart rejects on non-Windows platforms', async (t) => {
  if (os.platform() === 'win32') {
    t.skip('only meaningful on non-Windows');
    return;
  }
  const dir = tempDir();
  await assert.rejects(
    () => enableAutostart({ startupDir: dir, exePath: '/fake/agent.exe', installDir: dir }),
    /Windows/
  );
  fs.rmSync(dir, { recursive: true, force: true });
});
