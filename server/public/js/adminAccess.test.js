import test from 'node:test';
import assert from 'node:assert/strict';

import { hasAdminRole } from './adminAccess.js';

test('hasAdminRole only accepts the server-managed admin flag', () => {
  assert.equal(hasAdminRole({ is_admin: 1 }), true);
  assert.equal(hasAdminRole({ is_admin: 0 }), false);
  assert.equal(hasAdminRole({}), false);
  assert.equal(hasAdminRole(null), false);
});
