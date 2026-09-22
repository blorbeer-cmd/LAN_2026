const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { buildDesktopShortcutCleanupPowerShell, scheduleUninstall } = require('./uninstaller');

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

test('desktop shortcut cleanup uses the Windows known Desktop folder', () => {
  const command = buildDesktopShortcutCleanupPowerShell();
  assert.match(command, /\[Environment\]::GetFolderPath\('Desktop'\)/);
  assert.doesNotMatch(command, /USERPROFILE/);
  assert.match(command, /Respawn-Agent Steuerung\.lnk/);
  assert.match(command, /Respawn-Agent Steuerung\.url/);
});

test('desktop shortcut cleanup removes launchers from a redirected Desktop', {
  skip: os.platform() !== 'win32',
}, () => {
  const redirectedDesktop = fs.mkdtempSync(path.join(os.tmpdir(), "respawn-agent-redirected-O'Brien-"));
  const launcher = path.join(redirectedDesktop, 'Respawn-Agent Steuerung.lnk');
  const legacyLauncher = path.join(redirectedDesktop, 'Respawn-Agent Steuerung.url');
  fs.writeFileSync(launcher, 'placeholder');
  fs.writeFileSync(legacyLauncher, 'placeholder');

  try {
    const command = buildDesktopShortcutCleanupPowerShell('$env:RESPAWN_TEST_DESKTOP');
    execFileSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', command], {
      env: { ...process.env, RESPAWN_TEST_DESKTOP: redirectedDesktop },
      windowsHide: true,
    });
    assert.equal(fs.existsSync(launcher), false);
    assert.equal(fs.existsSync(legacyLauncher), false);
  } finally {
    fs.rmSync(redirectedDesktop, { recursive: true, force: true });
  }
});
