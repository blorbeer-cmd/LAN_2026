// Hides admin-seeded test players (players.is_test) from every view unless
// the device is in admin mode. Filtering happens client-side at the API
// boundary (see apiFetch in api.js): the server treats test players as
// perfectly normal players — that's what makes their seeded data exercise
// the real features — and this module strips them out of any response
// before a view ever sees them. Deliberately not a security boundary
// (matches admin mode itself, a plain localStorage flag): on a private LAN
// it only has to keep test noise out of everyone's UI, not defend against
// tampering.

import { isAdmin } from './admin.js';

// IDs of every test player seen in any response so far. Collected even in
// admin mode, so turning admin mode off doesn't need a page reload to know
// whom to hide. Grows per page load; loadAll() fetches the roster first
// (see data.js), so the set is populated before payloads that only carry
// player IDs arrive.
const testIds = new Set();

// Set once a device's session itself belongs to an is_test player (opened via
// an admin-minted test-session link, see docs/KONZEPT-TEST-USER.md "Als
// Testspieler anmelden"). A test player has no real admin role of its own, so
// this is deliberately separate from isAdmin() — it only needs to see its
// test-player peers (other seeded players it should be able to join/vote
// with), not gain the admin-mode banner or any real privilege.
const TEST_IDENTITY_KEY = 'respawn_test_identity';

export function setTestIdentity(isTest) {
  if (isTest) localStorage.setItem(TEST_IDENTITY_KEY, '1');
  else localStorage.removeItem(TEST_IDENTITY_KEY);
}

function isTestIdentity() {
  return localStorage.getItem(TEST_IDENTITY_KEY) === '1';
}

export function knownTestIds() {
  return testIds;
}

function collect(value) {
  if (Array.isArray(value)) {
    for (const item of value) collect(item);
  } else if (value && typeof value === 'object') {
    if (value.is_test === 1 && typeof value.id === 'string') testIds.add(value.id);
    for (const key of Object.keys(value)) collect(value[key]);
  }
}

// An object is hidden if it *is* a test player (is_test/id), *belongs to*
// one (playerId/player_id), or *pairs* one (seating's playerAId/playerBId).
function isHiddenObject(value) {
  if (value.is_test === 1 && typeof value.id === 'string') return true;
  if (typeof value.playerId === 'string' && testIds.has(value.playerId)) return true;
  if (typeof value.player_id === 'string' && testIds.has(value.player_id)) return true;
  if (typeof value.playerAId === 'string' && testIds.has(value.playerAId)) return true;
  if (typeof value.playerBId === 'string' && testIds.has(value.playerBId)) return true;
  return false;
}

function strip(value) {
  if (Array.isArray(value)) {
    return value
      .filter((item) => {
        if (typeof item === 'string') return !testIds.has(item); // bare ID lists
        if (item && typeof item === 'object') return !isHiddenObject(item);
        return true;
      })
      .map((item) => strip(item));
  }
  if (value && typeof value === 'object') {
    const out = {};
    for (const key of Object.keys(value)) out[key] = strip(value[key]);
    return out;
  }
  return value;
}

// Applied to every API response and player-carrying socket payload: always
// learns test IDs from it, and hides them unless the device is in admin mode.
export function filterTestUsers(payload) {
  collect(payload);
  if (isAdmin() || isTestIdentity() || testIds.size === 0) return payload;
  return strip(payload);
}
