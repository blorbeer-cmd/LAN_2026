// Unit tests for the pure PayPal link helpers used by the "Essen bestellen"
// view. No DOM needed - these are plain string functions.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addTipToCents, normalizePaypalInput, paypalEmailFromLink, paypalPayUrl } from './views/foodOrders.js';

test('addTipToCents adds and rounds the configured percentage', () => {
  assert.equal(addTipToCents(1000, 10), 1100);
  assert.equal(addTipToCents(995, 10), 1095);
  assert.equal(addTipToCents(1000, null), 1000);
});

test('normalizePaypalInput returns null for empty input', () => {
  assert.equal(normalizePaypalInput(''), null);
  assert.equal(normalizePaypalInput('   '), null);
  assert.equal(normalizePaypalInput(null), null);
  assert.equal(normalizePaypalInput(undefined), null);
});

test('normalizePaypalInput passes a full http(s) URL through unchanged', () => {
  assert.equal(normalizePaypalInput('https://paypal.me/luigi'), 'https://paypal.me/luigi');
  assert.equal(normalizePaypalInput('http://example.com/pay'), 'http://example.com/pay');
});

test('normalizePaypalInput turns a bare PayPal.me name into a full link', () => {
  assert.equal(normalizePaypalInput('blorbeer'), 'https://paypal.me/blorbeer');
  assert.equal(normalizePaypalInput('  blorbeer  '), 'https://paypal.me/blorbeer');
});

test('normalizePaypalInput strips a leading "@" and a pasted paypal.me prefix', () => {
  assert.equal(normalizePaypalInput('@blorbeer'), 'https://paypal.me/blorbeer');
  assert.equal(normalizePaypalInput('paypal.me/blorbeer'), 'https://paypal.me/blorbeer');
  assert.equal(normalizePaypalInput('www.paypal.me/blorbeer/'), 'https://paypal.me/blorbeer');
});

test('normalizePaypalInput rejects a name with whitespace', () => {
  assert.throws(() => normalizePaypalInput('blor beer'), /gültige URL/);
});

test('normalizePaypalInput turns an email address into a copyable send-money link', () => {
  const result = normalizePaypalInput('blorbeer@gmx.de');
  assert.equal(result, 'https://www.paypal.com/myaccount/transfer/homepage/pay?recipient=blorbeer%40gmx.de');
});

test('paypalEmailFromLink recovers the email from a normalized email link', () => {
  const link = normalizePaypalInput('blorbeer@gmx.de');
  assert.equal(paypalEmailFromLink(link), 'blorbeer@gmx.de');
});

test('paypalEmailFromLink returns null for a paypal.me link or other input', () => {
  assert.equal(paypalEmailFromLink('https://paypal.me/blorbeer'), null);
  assert.equal(paypalEmailFromLink('https://example.com/pay'), null);
  assert.equal(paypalEmailFromLink(null), null);
  assert.equal(paypalEmailFromLink(undefined), null);
});

test('paypalPayUrl appends the amount to a bare paypal.me link', () => {
  assert.equal(paypalPayUrl('https://paypal.me/luigi', 2090), 'https://paypal.me/luigi/20.90EUR');
});

test('paypalPayUrl leaves an email-based send-money link unchanged (no amount can be pre-filled)', () => {
  const link = normalizePaypalInput('blorbeer@gmx.de');
  assert.equal(paypalPayUrl(link, 2090), link);
});
