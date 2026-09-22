const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  LAUNCH_FAILURE_DIALOG_COMMAND,
  getControlAccessPath,
  openControlPanel,
  parseControlAccess,
  removeControlAccess,
  showLaunchFailure,
  writeControlAccess,
} = require('./controlLauncher');
const { defaultConfigPath } = require('./config');

const FIRST_KEY = 'A'.repeat(43);
const SECOND_KEY = 'B'.repeat(43);
const TICKET = 'T'.repeat(43);

test('control access follows the current fallback port and survives an agent restart', async () => {
  const installDir = fs.mkdtempSync(path.join(os.tmpdir(), 'respawn-control-access-'));
  const accessPath = getControlAccessPath(installDir);
  try {
    writeControlAccess(accessPath, { origin: 'http://127.0.0.1:47814', accessKey: FIRST_KEY });
    writeControlAccess(accessPath, { origin: 'http://127.0.0.1:47815', accessKey: SECOND_KEY });

    let openedUrl;
    await openControlPanel(accessPath, {
      fetchImpl: async (url, options) => {
        assert.equal(url, 'http://127.0.0.1:47815/api/launch');
        assert.equal(options.headers['X-Respawn-Control-Key'], SECOND_KEY);
        return new Response(JSON.stringify({ ticket: TICKET }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      },
      openUrl: (url) => {
        openedUrl = url;
      },
    });

    assert.equal(openedUrl, `http://127.0.0.1:47815/#ticket=${TICKET}`);
    assert.doesNotMatch(openedUrl, new RegExp(SECOND_KEY));

    removeControlAccess(accessPath, FIRST_KEY);
    assert.equal(fs.existsSync(accessPath), true, 'an older agent must not remove the new runtime access');
    removeControlAccess(accessPath, SECOND_KEY);
    assert.equal(fs.existsSync(accessPath), false);
  } finally {
    fs.rmSync(installDir, { recursive: true, force: true });
  }
});

test('control access accepts only an explicit IPv4 loopback origin and a random-sized key', () => {
  assert.throws(
    () => parseControlAccess(JSON.stringify({ version: 1, origin: 'http://localhost:47813', accessKey: FIRST_KEY })),
    /ungültig/,
  );
  assert.throws(
    () => parseControlAccess(JSON.stringify({ version: 1, origin: 'http://127.0.0.1:47813', accessKey: 'short' })),
    /ungültig/,
  );
});

// Regression guard for the install path this launcher depends on: the agent
// writes the runtime access file next to the config it loaded, the launcher
// reads it next to the .exe. When install.bat starts the agent those are only
// the same directory because the packaged build resolves its default config
// relative to the .exe rather than the working directory.
test('the packaged agent and the launcher agree on the runtime access file', () => {
  const originalPkg = process.pkg;
  process.pkg = { entrypoint: 'index.js' };
  try {
    const agentSide = getControlAccessPath(path.dirname(defaultConfigPath()));
    const launcherSide = getControlAccessPath(path.dirname(process.execPath));
    assert.equal(agentSide, launcherSide);
  } finally {
    if (originalPkg === undefined) delete process.pkg;
    else process.pkg = originalPkg;
  }
});

test('a failed launch reports the reason through a dialog without pasting it into PowerShell source', () => {
  const calls = [];
  const child = { on() {}, unref() {} };
  const spawnImpl = (command, args, options) => {
    calls.push({ command, args, options });
    return child;
  };

  assert.equal(showLaunchFailure('Agent läuft nicht: "kaputt" & weg', { spawnImpl, platform: 'win32' }), true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].command, 'powershell.exe');
  assert.equal(calls[0].options.env.RESPAWN_CONTROL_ERROR, 'Agent läuft nicht: "kaputt" & weg');
  assert.ok(
    calls[0].args.every((arg) => !arg.includes('kaputt')),
    'the message must travel through the environment, never through the command line',
  );
  assert.equal(calls[0].args.at(-1), LAUNCH_FAILURE_DIALOG_COMMAND);
  // Without -STA WinForms returns from MessageBox::Show without drawing
  // anything, which is exactly the silent failure this dialog exists to end.
  assert.ok(calls[0].args.includes('-STA'));

  assert.equal(showLaunchFailure('egal', { spawnImpl, platform: 'linux' }), false);
  assert.equal(calls.length, 1, 'no dialog attempt outside Windows');
});
