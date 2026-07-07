const { test } = require('node:test');
const assert = require('node:assert/strict');
const { parseTasklistCsv, parsePsOutput } = require('./processList');

test('parseTasklistCsv extracts lowercase process names from CSV rows', () => {
  const output = [
    '"cs2.exe","1234","Console","1","512,000 K"',
    '"RocketLeague.exe","5678","Console","1","900,000 K"',
    '"explorer.exe","42","Console","1","50,000 K"',
  ].join('\r\n');
  assert.deepEqual(parseTasklistCsv(output), ['cs2.exe', 'rocketleague.exe', 'explorer.exe']);
});

test('parseTasklistCsv ignores blank lines', () => {
  const output = '"cs2.exe","1234","Console","1","512,000 K"\r\n\r\n';
  assert.deepEqual(parseTasklistCsv(output), ['cs2.exe']);
});

test('parseTasklistCsv returns an empty array for empty output', () => {
  assert.deepEqual(parseTasklistCsv(''), []);
});

test('parsePsOutput lowercases command names', () => {
  const output = 'Xorg\nbash\nNode\n';
  assert.deepEqual(parsePsOutput(output), ['xorg', 'bash', 'node']);
});

test('parsePsOutput strips a leading path if present', () => {
  const output = '/usr/bin/node\nbash\n';
  assert.deepEqual(parsePsOutput(output), ['node', 'bash']);
});
