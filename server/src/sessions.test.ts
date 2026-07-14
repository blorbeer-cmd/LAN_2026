// Unit tests for session lifecycle + the requireUser/requireSessionAdmin
// gates. Uses the real (in-memory) DB for the session/player rows, and
// lightweight fake req/res objects for the middleware (same style as
// auth.test.ts's access-guard tests).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Request, Response } from 'express';
import { nanoid } from 'nanoid';
import { db } from './db';
import {
  parseCookieHeader,
  createSession,
  verifySession,
  deleteSessionByToken,
  deleteAllSessionsForPlayer,
  requireUser,
  requireSessionAdmin,
  SESSION_COOKIE_NAME,
} from './sessions';

function makePlayer(opts: { isAdmin?: boolean } = {}): string {
  const id = nanoid();
  db.prepare('INSERT INTO players (id, name, api_key, is_admin, created_at) VALUES (?, ?, ?, ?, ?)').run(
    id,
    `Session Test ${id}`,
    nanoid(24),
    opts.isAdmin ? 1 : 0,
    Date.now()
  );
  return id;
}

function fakeReq(cookieHeader?: string): Request {
  return { headers: { cookie: cookieHeader } } as unknown as Request;
}

function fakeRes(): Response & { statusCode: number; body: unknown } {
  const res = {
    statusCode: 0,
    body: undefined as unknown,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(payload: unknown) {
      this.body = payload;
      return this;
    },
  };
  return res as unknown as Response & { statusCode: number; body: unknown };
}

test('parseCookieHeader reads one cookie among several', () => {
  const cookies = parseCookieHeader('a=1; lan2026_session=abc123; b=2');
  assert.equal(cookies[SESSION_COOKIE_NAME], 'abc123');
});

test('parseCookieHeader returns an empty object for no header', () => {
  assert.deepEqual(parseCookieHeader(undefined), {});
});

test('createSession + verifySession round-trip resolves the right player', () => {
  const playerId = makePlayer();
  const token = createSession(playerId);
  const resolved = verifySession(token);
  assert.ok(resolved);
  assert.equal(resolved!.player.id, playerId);
});

test('verifySession rejects an unknown token', () => {
  assert.equal(verifySession('not-a-real-token'), undefined);
});

test('verifySession rejects (and cleans up) an expired session', () => {
  const playerId = makePlayer();
  const token = createSession(playerId);
  // Backdate the session's expiry directly, since a real 90-day wait isn't
  // practical here.
  db.prepare('UPDATE sessions SET expires_at = ? WHERE player_id = ?').run(Date.now() - 1000, playerId);

  assert.equal(verifySession(token), undefined);
  const remaining = db.prepare('SELECT COUNT(*) AS n FROM sessions WHERE player_id = ?').get(playerId) as { n: number };
  assert.equal(remaining.n, 0, 'expired session row should be deleted on lookup');
});

test('verifySession slides the expiry forward on each successful lookup', () => {
  const playerId = makePlayer();
  const token = createSession(playerId);
  const before = (db.prepare('SELECT expires_at FROM sessions WHERE player_id = ?').get(playerId) as {
    expires_at: number;
  }).expires_at;

  // Force a visible time difference regardless of how fast this test runs.
  db.prepare('UPDATE sessions SET expires_at = ? WHERE player_id = ?').run(before - 10_000, playerId);
  verifySession(token);

  const after = (db.prepare('SELECT expires_at FROM sessions WHERE player_id = ?').get(playerId) as {
    expires_at: number;
  }).expires_at;
  assert.ok(after > before - 10_000, 'expiry should have slid forward past the backdated value');
});

test('deleteSessionByToken removes exactly that session', () => {
  const playerId = makePlayer();
  const token = createSession(playerId);
  deleteSessionByToken(token);
  assert.equal(verifySession(token), undefined);
});

test('deleteAllSessionsForPlayer removes every session except the excluded one', () => {
  const playerId = makePlayer();
  const tokenA = createSession(playerId);
  const tokenB = createSession(playerId);
  const tokenC = createSession(playerId);

  const resolvedB = verifySession(tokenB)!;
  deleteAllSessionsForPlayer(playerId, resolvedB.session.id);

  assert.equal(verifySession(tokenA), undefined);
  assert.ok(verifySession(tokenB), 'excluded session should survive');
  assert.equal(verifySession(tokenC), undefined);
});

test('requireUser rejects a request with no session cookie', () => {
  const res = fakeRes();
  let called = false;
  requireUser(fakeReq(undefined), res, () => {
    called = true;
  });
  assert.equal(called, false);
  assert.equal(res.statusCode, 401);
});

test('requireUser accepts a valid session and sets req.player', () => {
  const playerId = makePlayer();
  const token = createSession(playerId);
  const req = fakeReq(`${SESSION_COOKIE_NAME}=${token}`);
  const res = fakeRes();
  let called = false;
  requireUser(req, res, () => {
    called = true;
  });
  assert.equal(called, true);
  assert.equal(req.player?.id, playerId);
  assert.equal(typeof req.sessionId, 'string');
});

test('requireSessionAdmin rejects a logged-in non-admin with 403', () => {
  const playerId = makePlayer({ isAdmin: false });
  const token = createSession(playerId);
  const req = fakeReq(`${SESSION_COOKIE_NAME}=${token}`);
  const res = fakeRes();
  let called = false;
  const next = () => {
    called = true;
  };
  requireSessionAdmin[0](req, res, () => requireSessionAdmin[1](req, res, next));
  assert.equal(called, false);
  assert.equal(res.statusCode, 403);
});

test('requireSessionAdmin accepts a logged-in admin', () => {
  const playerId = makePlayer({ isAdmin: true });
  const token = createSession(playerId);
  const req = fakeReq(`${SESSION_COOKIE_NAME}=${token}`);
  const res = fakeRes();
  let called = false;
  const next = () => {
    called = true;
  };
  requireSessionAdmin[0](req, res, () => requireSessionAdmin[1](req, res, next));
  assert.equal(called, true);
});
