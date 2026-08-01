// Unit tests for reading the dedicated kiosk credential.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Request } from 'express';
import { extractToken } from './auth';

// Builds a minimal fake Express request with the given header/query.
function fakeReq(opts: { header?: string; query?: Record<string, unknown> }): Request {
  return {
    header: (name: string) =>
      name.toLowerCase() === 'x-access-token' ? opts.header : undefined,
    query: opts.query ?? {},
  } as unknown as Request;
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
