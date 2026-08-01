import test from 'node:test';
import assert from 'node:assert/strict';
import { connectionStatusText } from './connectionStatus.js';

test('connection status text covers offline and reconnect states', () => {
  assert.match(connectionStatusText('offline'), /offline/);
  assert.match(connectionStatusText('reconnecting'), /automatisch neu/);
  assert.match(connectionStatusText('connecting'), /hergestellt/);
  assert.equal(connectionStatusText('connected'), '');
});
