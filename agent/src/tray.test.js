const { test } = require('node:test');
const assert = require('node:assert/strict');
const os = require('os');
const { buildTrayScript, hideConsoleWindow, startTrayIcon } = require('./tray');

test('buildTrayScript embeds the control URL and agent PID', () => {
  const script = buildTrayScript('http://127.0.0.1:47813', 4242);
  assert.match(script, /\$controlUrl = "http:\/\/127\.0\.0\.1:47813"/);
  assert.match(script, /\$agentPid = 4242/);
});

test('buildTrayScript wires the open action to Start-Process on click and double-click', () => {
  const script = buildTrayScript('http://127.0.0.1:47813', 1);
  assert.match(script, /\$openItem\.add_Click\(\$openAction\)/);
  assert.match(script, /\$icon\.add_DoubleClick\(\$openAction\)/);
  assert.match(script, /Start-Process \$controlUrl/);
});

test('buildTrayScript wires the exit action to stop the agent process by PID', () => {
  const script = buildTrayScript('http://127.0.0.1:47813', 4242);
  assert.match(script, /Stop-Process -Id \$agentPid -Force/);
  assert.match(script, /\[System\.Windows\.Forms\.Application\]::Exit\(\)/);
});

test('hideConsoleWindow is a no-op off Windows', { skip: os.platform() === 'win32' }, () => {
  assert.doesNotThrow(() => hideConsoleWindow());
});

test('startTrayIcon returns null off Windows', { skip: os.platform() === 'win32' }, () => {
  assert.equal(startTrayIcon('http://127.0.0.1:47813', process.pid), null);
});
