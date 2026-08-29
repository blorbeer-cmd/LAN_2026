import assert from 'node:assert/strict';
import test from 'node:test';
import { copyText } from './clipboard.js';

test('copyText uses the Clipboard API when it is available', async () => {
  let copied = '';
  await copyText('Kiosk-Passwort', {
    navigatorRef: { clipboard: { writeText: async (value) => { copied = value; } } },
    documentRef: null,
  });
  assert.equal(copied, 'Kiosk-Passwort');
});

test('copyText falls back to a selected textarea when Clipboard rejects LAN HTTP', async () => {
  const calls = [];
  const field = {
    value: '',
    style: {},
    setAttribute: (...args) => calls.push(['attribute', ...args]),
    select: () => calls.push(['select']),
    setSelectionRange: (...args) => calls.push(['selection', ...args]),
    remove: () => calls.push(['remove']),
  };
  await copyText('fallback-secret', {
    navigatorRef: { clipboard: { writeText: async () => { throw new Error('insecure context'); } } },
    documentRef: {
      body: { appendChild: (node) => calls.push(['append', node]) },
      createElement: (tag) => {
        calls.push(['create', tag]);
        return field;
      },
      execCommand: (command) => {
        calls.push(['exec', command]);
        return true;
      },
    },
  });
  assert.equal(field.value, 'fallback-secret');
  assert.deepEqual(calls.filter(([name]) => ['select', 'selection', 'exec', 'remove'].includes(name)), [
    ['select'],
    ['selection', 0, 15],
    ['exec', 'copy'],
    ['remove'],
  ]);
});

test('copyText removes its fallback field when copying fails', async () => {
  let removed = false;
  const field = {
    style: {},
    setAttribute: () => {},
    select: () => {},
    setSelectionRange: () => {},
    remove: () => { removed = true; },
  };
  await assert.rejects(() => copyText('secret', {
    navigatorRef: {},
    documentRef: {
      body: { appendChild: () => {} },
      createElement: () => field,
      execCommand: () => false,
    },
  }), /Copy failed/);
  assert.equal(removed, true);
});
