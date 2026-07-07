const { test } = require('node:test');
const assert = require('node:assert/strict');
const { parseActivityOutput } = require('./activity');

test('parseActivityOutput reads a normal JSON snapshot', () => {
  const result = parseActivityOutput('{"foreground":"CS2.exe","idleSeconds":3}');
  assert.equal(result.foregroundProcessName, 'cs2.exe');
  assert.equal(result.idleSeconds, 3);
});

test('parseActivityOutput handles a null foreground (e.g. desktop focused)', () => {
  const result = parseActivityOutput('{"foreground":null,"idleSeconds":42}');
  assert.equal(result.foregroundProcessName, null);
  assert.equal(result.idleSeconds, 42);
});

test('parseActivityOutput returns nulls for empty output', () => {
  assert.deepEqual(parseActivityOutput(''), { foregroundProcessName: null, idleSeconds: null });
  assert.deepEqual(parseActivityOutput('   '), { foregroundProcessName: null, idleSeconds: null });
});

test('parseActivityOutput returns nulls for malformed JSON', () => {
  assert.deepEqual(parseActivityOutput('not json at all'), {
    foregroundProcessName: null,
    idleSeconds: null,
  });
});

test('parseActivityOutput ignores a non-numeric idleSeconds', () => {
  const result = parseActivityOutput('{"foreground":"explorer.exe","idleSeconds":"oops"}');
  assert.equal(result.idleSeconds, null);
  assert.equal(result.foregroundProcessName, 'explorer.exe');
});

test('parseActivityOutput trims surrounding whitespace/newlines from PowerShell output', () => {
  const result = parseActivityOutput('\r\n{"foreground":"cs2.exe","idleSeconds":0}\r\n');
  assert.equal(result.foregroundProcessName, 'cs2.exe');
  assert.equal(result.idleSeconds, 0);
});
