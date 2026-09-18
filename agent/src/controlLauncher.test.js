const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  getControlAccessPath,
  openControlPanel,
  parseControlAccess,
  removeControlAccess,
  writeControlAccess,
} = require('./controlLauncher');

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
