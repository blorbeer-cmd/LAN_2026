const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { scheduleUninstall } = require('./uninstaller');

test('scheduleUninstall removes the install dir and shortcut on non-Windows', (t) => {
  if (os.platform() === 'win32') {
    t.skip('exercises the non-Windows synchronous cleanup path');
    return;
  }
  const installDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-uninstall-test-'));
  fs.writeFileSync(path.join(installDir, 'agent.config.json'), '{}');
  const shortcutDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-uninstall-shortcut-'));
  const shortcutPath = path.join(shortcutDir, 'Respawn-Agent.lnk');
  fs.writeFileSync(shortcutPath, 'placeholder');

  scheduleUninstall({ installDir, startupShortcutPath: shortcutPath });

  assert.equal(fs.existsSync(installDir), false);
  assert.equal(fs.existsSync(shortcutPath), false);
  fs.rmSync(shortcutDir, { recursive: true, force: true });
});

test('scheduleUninstall is a no-op if nothing to remove exists', (t) => {
  if (os.platform() === 'win32') {
    t.skip('exercises the non-Windows synchronous cleanup path');
    return;
  }
  const missingDir = path.join(os.tmpdir(), `agent-uninstall-missing-${Date.now()}`);
  assert.doesNotThrow(() => scheduleUninstall({ installDir: missingDir, startupShortcutPath: null }));
});
