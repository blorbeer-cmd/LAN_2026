// Integration tests for the invite-link QR code endpoint.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { createApp } from '../app';

const app = createApp();

test('GET /api/qrcode rejects a missing text param', async () => {
  const res = await request(app).get('/api/qrcode');
  assert.equal(res.status, 400);
});

test('GET /api/qrcode rejects an overly long text param', async () => {
  const res = await request(app).get(`/api/qrcode?text=${'a'.repeat(2001)}`);
  assert.equal(res.status, 400);
});

test('GET /api/qrcode returns an SVG for a valid URL', async () => {
  // supertest/superagent only auto-buffers known text MIME types as
  // res.text; image/svg+xml falls back to a raw Buffer in res.body, so
  // decode that instead.
  const res = await request(app)
    .get(`/api/qrcode?text=${encodeURIComponent('https://example.com/?token=abc123')}`)
    .buffer(true)
    .parse((response, callback) => {
      const chunks: Buffer[] = [];
      response.on('data', (chunk: Buffer) => chunks.push(chunk));
      response.on('end', () => callback(null, Buffer.concat(chunks).toString('utf8')));
    });
  assert.equal(res.status, 200);
  assert.match(res.headers['content-type'], /image\/svg\+xml/);
  assert.match(res.body, /<svg/);
});
