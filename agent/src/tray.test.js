const { test } = require('node:test');
const assert = require('node:assert/strict');
const os = require('os');
const { buildTrayScript, hideConsoleWindow, startTrayIcon } = require('./tray');

test('buildTrayScript reads sensitive control access from its private process environment', () => {
  const script = buildTrayScript(4242);
  assert.match(script, /\$controlOrigin = \$env:RESPAWN_CONTROL_ORIGIN/);
  assert.match(script, /\$controlKey = \$env:RESPAWN_CONTROL_KEY/);
  assert.match(script, /\$agentPid = 4242/);
  assert.doesNotMatch(script, /http:\/\/127\.0\.0\.1/);
});

test('buildTrayScript exchanges the access key before opening a one-time fragment URL', () => {
  const script = buildTrayScript(1);
  assert.match(script, /\$openItem\.add_Click\(\$openAction\)/);
  assert.match(script, /\$icon\.add_DoubleClick\(\$openAction\)/);
  assert.match(script, /Invoke-RestMethod .*\/api\/launch/);
  assert.match(script, /Start-Process .*#ticket=/);
});

test('buildTrayScript wires the exit action to stop the agent process by PID', () => {
  const script = buildTrayScript(4242);
  assert.match(script, /Stop-Process -Id \$agentPid -Force/);
  assert.match(script, /\[System\.Windows\.Forms\.Application\]::Exit\(\)/);
});

test('hideConsoleWindow is a no-op off Windows', { skip: os.platform() === 'win32' }, () => {
  assert.doesNotThrow(() => hideConsoleWindow());
});

test('startTrayIcon returns null off Windows', { skip: os.platform() === 'win32' }, () => {
  assert.equal(startTrayIcon({ origin: 'http://127.0.0.1:47813', accessKey: 'secret' }, process.pid), null);
});
