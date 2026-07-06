// Unit tests for the access guard. No server or DB needed — we exercise the
// middleware factory directly with lightweight request/response fakes.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Request, Response } from 'express';
import { createAccessGuard, extractToken } from './auth';

// Builds a minimal fake Express request with the given header/query.
function fakeReq(opts: { header?: string; query?: Record<string, unknown> }): Request {
  return {
    header: (name: string) =>
      name.toLowerCase() === 'x-access-token' ? opts.header : undefined,
    query: opts.query ?? {},
  } as unknown as Request;
}

// Fake response that records status + json payload.
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

test('extractToken reads the x-access-token header', () => {
  assert.equal(extractToken(fakeReq({ header: 'abc' })), 'abc');
});

test('extractToken falls back to the token query param', () => {
  assert.equal(extractToken(fakeReq({ query: { token: 'xyz' } })), 'xyz');
});

test('extractToken returns undefined when nothing is provided', () => {
  assert.equal(extractToken(fakeReq({})), undefined);
});

test('guard with empty token disables protection (calls next)', () => {
  const guard = createAccessGuard('');
  let called = false;
  guard(fakeReq({}), fakeRes(), () => {
    called = true;
  });
  assert.equal(called, true);
});

test('guard rejects a missing token with 401', () => {
  const guard = createAccessGuard('secret');
  const res = fakeRes();
  let called = false;
  guard(fakeReq({}), res, () => {
    called = true;
  });
  assert.equal(called, false);
  assert.equal(res.statusCode, 401);
  assert.match((res.body as { error: string }).error, /Token/);
});

test('guard rejects a wrong token with 401', () => {
  const guard = createAccessGuard('secret');
  const res = fakeRes();
  let called = false;
  guard(fakeReq({ header: 'nope' }), res, () => {
    called = true;
  });
  assert.equal(called, false);
  assert.equal(res.statusCode, 401);
});

test('guard accepts the correct token (calls next)', () => {
  const guard = createAccessGuard('secret');
  let called = false;
  guard(fakeReq({ header: 'secret' }), fakeRes(), () => {
    called = true;
  });
  assert.equal(called, true);
});
