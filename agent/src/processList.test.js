const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  getRunningProcessNames,
  buildLookup,
  mapHitsToConfiguredNames,
  chunkLookupNames,
  parseGetProcessOutput,
  parsePgrepOutput,
  MAX_LOOKUP_COMMAND_CHARS,
} = require('./processList');

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
// PowerShell argument / a pgrep pattern, so anything that could change the
// meaning of those commands must never reach them.
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
  const byLookup = buildLookup(['cs2.exe']);
  assert.deepEqual(mapHitsToConfiguredNames(['cs2'], byLookup), ['cs2.exe']);
});

test('mapHitsToConfiguredNames deduplicates repeated hits of the same name', () => {
  const byLookup = buildLookup(['cs2.exe']);
  assert.deepEqual(mapHitsToConfiguredNames(['cs2', 'cs2'], byLookup), ['cs2.exe']);
});

test('mapHitsToConfiguredNames ignores a hit that was never configured', () => {
  assert.deepEqual(mapHitsToConfiguredNames(['explorer'], buildLookup(['cs2.exe'])), []);
});

test('parseGetProcessOutput lowercases one process name per line', () => {
  assert.deepEqual(parseGetProcessOutput('cs2\r\nRocketLeague\r\n'), ['cs2', 'rocketleague']);
});

test('parseGetProcessOutput returns an empty array when nothing matched', () => {
  assert.deepEqual(parseGetProcessOutput(''), []);
});

test('parsePgrepOutput drops the pid column', () => {
  assert.deepEqual(parsePgrepOutput('6994 bash\n7001 Node\n'), ['bash', 'node']);
});

test('parsePgrepOutput returns an empty array when nothing matched', () => {
  assert.deepEqual(parsePgrepOutput(''), []);
});

test('getRunningProcessNames finds a name that is actually running', async () => {
  // Same trick the e2e test uses: this test itself runs in Node, so one of
  // these spellings must be found — which also proves the real OS lookup is
  // wired up, not just the parsing.
  const running = await getRunningProcessNames(['node.exe', 'node', 'mainthread']);
  assert.ok(running.length > 0, 'the running Node test process should be found by a targeted lookup');
  assert.ok(
    running.every((name) => ['node.exe', 'node', 'mainthread'].includes(name)),
    'only names that were asked about may be returned'
  );
});

test('getRunningProcessNames returns nothing for a name that is not running', async () => {
  assert.deepEqual(await getRunningProcessNames(['definitely-not-running-lanparty-xyz.exe']), []);
});

test('getRunningProcessNames asks the OS about nothing when the allow-list is empty', async () => {
  // No configured game means no reason to look at the player's processes at
  // all — not even a query the OS could answer.
  assert.deepEqual(await getRunningProcessNames([]), []);
  assert.deepEqual(await getRunningProcessNames(undefined), []);
});

test('getRunningProcessNames never lets a hostile allow-list entry reach the shell', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-processlist-test-'));
  const marker = path.join(dir, 'pwned');

  const running = await getRunningProcessNames([`x'; touch ${marker} #.exe`, `x$(touch ${marker}).exe`]);

  assert.deepEqual(running, [], 'an unsafe name must not produce a match');
  assert.equal(fs.existsSync(marker), false, 'an unsafe name must never be executed by the lookup');
});

test('chunkLookupNames keeps every batch inside the command-line budget', () => {
  const names = Array.from({ length: 500 }, (_, i) => `game-with-a-fairly-long-name-${i}`);
  const chunks = chunkLookupNames(names);

  assert.ok(chunks.length > 1, 'a list this long must be split');
  assert.deepEqual(chunks.flat(), names, 'splitting must not lose or reorder a single name');
  for (const chunk of chunks) {
    const generated = chunk.reduce((sum, name) => sum + name.length + 3, 0);
    assert.ok(generated <= MAX_LOOKUP_COMMAND_CHARS, `a batch generated ${generated} characters`);
  }
});

test('chunkLookupNames keeps a realistic allow-list in a single lookup', () => {
  const names = Array.from({ length: 40 }, (_, i) => `game${i}`);
  assert.equal(chunkLookupNames(names).length, 1);
});

test('chunkLookupNames returns no batch at all for an empty list', () => {
  assert.deepEqual(chunkLookupNames([]), []);
});

test('getRunningProcessNames splits an oversized allow-list into several lookups', async () => {
  // Far more names than a real LAN would ever configure: the point is that a
  // long list still answers correctly instead of blowing the command line.
  const filler = Array.from({ length: 500 }, (_, i) => `not-running-filler-${i}.exe`);
  const running = await getRunningProcessNames([...filler, 'node.exe', 'node', 'mainthread']);

  assert.ok(running.length > 0, 'the running Node process should still be found in a chunked lookup');
  assert.ok(
    running.every((name) => !name.startsWith('not-running-filler-')),
    'no filler name may be reported as running'
  );
});
