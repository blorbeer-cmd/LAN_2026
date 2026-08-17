const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  probeSystem,
  buildLookup,
  mapHitsToConfiguredNames,
  buildProbeScript,
  parseProbeOutput,
  parsePsOutput,
} = require('./systemProbe');

test('buildLookup strips the .exe extension the OS lookup does not want', () => {
  assert.deepEqual([...buildLookup(['cs2.exe']).keys()], ['cs2']);
});

test('buildLookup normalizes casing and surrounding whitespace', () => {
  assert.deepEqual([...buildLookup(['  RocketLeague.EXE  ']).keys()], ['rocketleague']);
});

test('buildLookup maps a lookup name back to every configured spelling', () => {
  assert.deepEqual(buildLookup(['cs2.exe', 'CS2']).get('cs2'), ['cs2.exe', 'cs2']);
});

test('buildLookup ignores empty, non-string and duplicate entries', () => {
  const byLookup = buildLookup(['cs2.exe', 'cs2.exe', '', '   ', null, 42, undefined]);
  assert.deepEqual([...byLookup.keys()], ['cs2']);
  assert.deepEqual(byLookup.get('cs2'), ['cs2.exe']);
});

// The allow-list is admin input from the server and gets interpolated into a
// generated PowerShell script (the POSIX fallback never interpolates it into
// a command at all), so anything that could change the meaning of that script
// must never reach it.
test('buildLookup drops names containing shell or PowerShell metacharacters', () => {
  const hostile = [
    "cs2.exe'; Stop-Computer #",
    'cs2.exe; rm -rf /',
    'cs2.exe && whoami',
    'cs2.exe`n',
    'cs2$(whoami).exe',
    'cs2|whoami.exe',
    'cs2\nwhoami.exe',
  ];
  assert.deepEqual([...buildLookup(hostile).keys()], []);
});

test('buildLookup drops wildcard names so a lookup can never widen itself', () => {
  assert.deepEqual([...buildLookup(['*.exe', 'cs?.exe', 'cs[12].exe']).keys()], []);
});

test('buildLookup drops absurdly long names', () => {
  assert.deepEqual([...buildLookup([`${'a'.repeat(65)}.exe`]).keys()], []);
});

test('buildLookup keeps the punctuation real game executables actually use', () => {
  assert.deepEqual([...buildLookup(['Age of Empires II (2013).exe', 'game_launcher-x64.exe', 'q3+.exe']).keys()], [
    'age of empires ii (2013)',
    'game_launcher-x64',
    'q3+',
  ]);
});

test('mapHitsToConfiguredNames reports the spelling the server configured', () => {
  assert.deepEqual(mapHitsToConfiguredNames(['cs2'], buildLookup(['cs2.exe'])), ['cs2.exe']);
});

test('mapHitsToConfiguredNames deduplicates repeated hits of the same name', () => {
  assert.deepEqual(mapHitsToConfiguredNames(['cs2', 'cs2'], buildLookup(['cs2.exe'])), ['cs2.exe']);
});

test('mapHitsToConfiguredNames ignores a hit that was never configured', () => {
  assert.deepEqual(mapHitsToConfiguredNames(['explorer'], buildLookup(['cs2.exe'])), []);
});

// The generated script defines exactly what the agent is able to see, so these
// assertions are the privacy contract in code form.
test('buildProbeScript asks Get-Process only about the configured names', () => {
  const script = buildProbeScript(['cs2', 'rocketleague'], false);
  assert.match(script, /\$names = @\('cs2','rocketleague'\)/);
  assert.match(script, /Get-Process -Name \$names/);
});

test('buildProbeScript never enumerates processes without a name filter', () => {
  for (const script of [buildProbeScript(['cs2'], false), buildProbeScript(['cs2'], true), buildProbeScript([], true)]) {
    for (const line of script.split('\n')) {
      if (!line.includes('Get-Process')) continue;
      assert.ok(
        line.includes('-Name $names') || line.includes('-Id $procId'),
        `Get-Process must stay targeted, got: ${line}`
      );
    }
  }
});

test('buildProbeScript leaves out the process lookup when nothing is configured', () => {
  const script = buildProbeScript([], true);
  assert.ok(!script.includes('$names'), 'an empty allow-list must not produce a Get-Process name lookup');
  assert.match(script, /\$running = @\(\)/);
});

test('buildProbeScript omits the activity block unless activity tracking is on', () => {
  const withoutActivity = buildProbeScript(['cs2'], false);
  assert.ok(!withoutActivity.includes('user32.dll'), 'no opt-in means the focused window is never even read');
  assert.ok(!withoutActivity.includes('GetLastInputInfo'), 'no opt-in means idle time is never even read');

  const withActivity = buildProbeScript(['cs2'], true);
  assert.match(withActivity, /GetForegroundWindow/);
  assert.match(withActivity, /GetLastInputInfo/);
});

test('buildProbeScript only names a focused window that is a configured game', () => {
  assert.match(buildProbeScript(['cs2'], true), /if \(\$focused -and \(\$running -contains \$focused\)\)/);
});

test('buildProbeScript keeps the activity block from breaking the process lookup', () => {
  const script = buildProbeScript(['cs2'], true);
  // Both questions share one script now, so a failing Add-Type must not take
  // the running-game detection down with it.
  assert.ok(script.includes('try {'), 'the activity block must be guarded');
  assert.ok(script.includes('} catch {}'), 'the activity block must swallow its own failures');
  assert.ok(script.trimEnd().endsWith('ConvertTo-Json -Compress'), 'the script must still emit its result');
});

test('buildProbeScript emits one combined result for both questions', () => {
  assert.match(
    buildProbeScript(['cs2'], true),
    /@\{ processes = \$running; foreground = \$foreground; idleSeconds = \$idleSeconds \}/
  );
});

test('buildProbeScript keeps the here-string terminator at the start of its line', () => {
  // PowerShell only accepts `"@` in column 0; an indented terminator makes the
  // whole script a syntax error, which no non-Windows test would catch.
  const lines = buildProbeScript(['cs2'], true).split('\n');
  assert.ok(lines.includes('"@'), 'the Add-Type here-string must be closed at column 0');
});

test('parseProbeOutput reads processes, foreground and idle time', () => {
  const result = parseProbeOutput('{"processes":["CS2"],"foreground":"CS2","idleSeconds":3}');
  assert.deepEqual(result, { processes: ['cs2'], foreground: 'cs2', idleSeconds: 3 });
});

test('parseProbeOutput accepts a single process collapsed to a scalar by ConvertTo-Json', () => {
  assert.deepEqual(parseProbeOutput('{"processes":"cs2","foreground":null,"idleSeconds":null}').processes, ['cs2']);
});

test('parseProbeOutput handles an empty result (nothing configured running)', () => {
  assert.deepEqual(parseProbeOutput('{"processes":[],"foreground":null,"idleSeconds":42}'), {
    processes: [],
    foreground: null,
    idleSeconds: 42,
  });
});

test('parseProbeOutput ignores a non-numeric idleSeconds', () => {
  const result = parseProbeOutput('{"processes":[],"foreground":null,"idleSeconds":"oops"}');
  assert.equal(result.idleSeconds, null);
});

test('parseProbeOutput trims surrounding whitespace/newlines from PowerShell output', () => {
  assert.deepEqual(parseProbeOutput('\r\n{"processes":[],"foreground":null,"idleSeconds":0}\r\n').idleSeconds, 0);
});

// A broken probe must not look like "nothing is running" — that would be an
// agent that appears healthy while tracking nothing at all.
test('parseProbeOutput rejects empty output instead of reporting no games', () => {
  assert.throws(() => parseProbeOutput(''), /keine Ausgabe/);
  assert.throws(() => parseProbeOutput('   '), /keine Ausgabe/);
});

test('parseProbeOutput rejects malformed output instead of reporting no games', () => {
  assert.throws(() => parseProbeOutput('not json at all'), /keine gültige Antwort/);
});

test('parsePsOutput lowercases one command per line', () => {
  assert.deepEqual(parsePsOutput('Xorg\nbash\nNode\n'), ['xorg', 'bash', 'node']);
});

test('parsePsOutput strips a leading path if present', () => {
  assert.deepEqual(parsePsOutput('/usr/bin/node\nbash\n'), ['node', 'bash']);
});

test('parsePsOutput ignores blank lines', () => {
  assert.deepEqual(parsePsOutput('node\n\n'), ['node']);
});

test('parsePsOutput returns an empty array for empty output', () => {
  assert.deepEqual(parsePsOutput(''), []);
});

test('probeSystem finds a process that is actually running', async () => {
  // Same trick the e2e test uses: this test itself runs in Node, so one of
  // these spellings must be found — which also proves the real OS probe is
  // wired up, not just the parsing.
  const candidates = ['node.exe', 'node', 'mainthread'];
  const probe = await probeSystem({ allowedProcessNames: candidates });

  assert.ok(probe.processNames.length > 0, 'the running Node test process should be found by a targeted probe');
  assert.ok(
    probe.processNames.every((name) => candidates.includes(name)),
    'only names that were asked about may be returned'
  );
});

test('probeSystem returns nothing for a name that is not running', async () => {
  const probe = await probeSystem({ allowedProcessNames: ['definitely-not-running-lanparty-xyz.exe'] });
  assert.deepEqual(probe.processNames, []);
});

test('probeSystem touches the machine for nothing when there is nothing to ask about', async () => {
  // No configured game and no activity opt-in means no reason to look at the
  // player's processes at all — not even a query the OS could answer.
  assert.deepEqual(await probeSystem({ allowedProcessNames: [] }), {
    processNames: [],
    foregroundProcessName: null,
    idleSeconds: null,
  });
  assert.deepEqual(await probeSystem({}), { processNames: [], foregroundProcessName: null, idleSeconds: null });
  assert.deepEqual(await probeSystem(), { processNames: [], foregroundProcessName: null, idleSeconds: null });
});

test('probeSystem reports no activity data on platforms that do not support it', async () => {
  const probe = await probeSystem({ allowedProcessNames: ['node.exe', 'node', 'mainthread'], includeActivity: true });
  if (os.platform() === 'win32') return;
  assert.equal(probe.foregroundProcessName, null, 'the foreground window is a Windows-only capability');
  assert.equal(probe.idleSeconds, null, 'idle time is a Windows-only capability');
});

test('probeSystem never lets a hostile allow-list entry reach the shell', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-probe-test-'));
  const marker = path.join(dir, 'pwned');

  const probe = await probeSystem({
    allowedProcessNames: [`x'; touch ${marker} #.exe`, `x$(touch ${marker}).exe`],
  });

  assert.deepEqual(probe.processNames, [], 'an unsafe name must not produce a match');
  assert.equal(fs.existsSync(marker), false, 'an unsafe name must never be executed by the probe');
});

test('probeSystem handles an allow-list far larger than any real LAN', async () => {
  const filler = Array.from({ length: 500 }, (_, i) => `not-running-filler-${i}.exe`);
  const probe = await probeSystem({ allowedProcessNames: [...filler, 'node.exe', 'node', 'mainthread'] });

  assert.ok(probe.processNames.length > 0, 'the running Node process should still be found');
  assert.ok(
    probe.processNames.every((name) => !name.startsWith('not-running-filler-')),
    'no filler name may be reported as running'
  );
});
