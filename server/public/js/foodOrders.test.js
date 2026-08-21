// Unit tests for the pure helpers used by the "Essen bestellen" view. No DOM
// needed - these are plain string/array functions.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  addTipToCents,
  normalizePaypalInput,
  paypalEmailFromLink,
  paypalPayUrl,
  groupPaymentState,
  buildConsolidatedRows,
  foodOrderDescriptionSuggestions,
} from './views/foodOrders.js';

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

test('paypalEmailFromLink treats malformed recipient encoding as a normal URL', () => {
  assert.equal(paypalEmailFromLink('https://www.paypal.com/myaccount/transfer/homepage/pay?recipient=%E0%A4%A'), null);
});

test('paypalPayUrl appends the amount to a bare paypal.me link', () => {
  assert.equal(paypalPayUrl('https://paypal.me/luigi', 2090), 'https://paypal.me/luigi/20.90EUR');
});

test('paypalPayUrl leaves an email-based send-money link unchanged (no amount can be pre-filled)', () => {
  const link = normalizePaypalInput('blorbeer@gmx.de');
  assert.equal(paypalPayUrl(link, 2090), link);
});

// --- Per-person payment state ----------------------------------------------

test('groupPaymentState has exactly the two derived states', () => {
  assert.equal(groupPaymentState([]), 'open');
  assert.equal(groupPaymentState([{ paid: false }, { paid: true }]), 'open');
  assert.equal(groupPaymentState([{ paid: true }, { paid: true }]), 'paid');
});

// --- AP4.2: consolidated order list -----------------------------------------

test('buildConsolidatedRows merges same normalized description and same price', () => {
  const rows = buildConsolidatedRows([
    { description: 'Margherita', priceCents: 850, quantity: 1 },
    { description: '  margherita  ', priceCents: 850, quantity: 2 },
  ]);
  assert.equal(rows.length, 1);
  assert.deepEqual(rows[0], { description: 'Margherita', priceCents: 850, quantity: 3 });
});

test('buildConsolidatedRows keeps the same name at a different price as its own row', () => {
  const rows = buildConsolidatedRows([
    { description: 'Margherita', priceCents: 850, quantity: 1 },
    { description: 'Margherita', priceCents: 900, quantity: 1 },
  ]);
  assert.equal(rows.length, 2);
  assert.deepEqual(
    rows.map((r) => r.priceCents).sort((a, b) => a - b),
    [850, 900]
  );
});

test('buildConsolidatedRows sums quantities of unpriced items with the same description', () => {
  const rows = buildConsolidatedRows([
    { description: 'Wasser', priceCents: null, quantity: 1 },
    { description: 'Wasser', priceCents: null, quantity: 2 },
  ]);
  assert.equal(rows.length, 1);
  assert.deepEqual(rows[0], { description: 'Wasser', priceCents: null, quantity: 3 });
});

test('buildConsolidatedRows defaults a missing quantity to 1', () => {
  const rows = buildConsolidatedRows([{ description: 'Cola', priceCents: 250 }]);
  assert.equal(rows[0].quantity, 1);
});

test('buildConsolidatedRows sorts alphabetically with the German locale', () => {
  const rows = buildConsolidatedRows([
    { description: 'Pizza', priceCents: 100, quantity: 1 },
    { description: 'Öl', priceCents: 100, quantity: 1 },
    { description: 'Apfelschorle', priceCents: 100, quantity: 1 },
  ]);
  assert.deepEqual(
    rows.map((r) => r.description),
    ['Apfelschorle', 'Öl', 'Pizza']
  );
});

test('foodOrderDescriptionSuggestions deduplicates by normalized description, keeping the first spelling and price', () => {
  const suggestions = foodOrderDescriptionSuggestions([
    { description: 'Margherita', priceCents: 850 },
    { description: '  margherita  ', priceCents: 900 },
    { description: 'MARGHERITA', priceCents: 900 },
  ]);
  assert.deepEqual(suggestions, [{ label: 'Margherita', priceCents: 850 }]);
});

test('foodOrderDescriptionSuggestions keeps a null price when the first-seen item had none', () => {
  const suggestions = foodOrderDescriptionSuggestions([{ description: 'Wasser', priceCents: null }]);
  assert.deepEqual(suggestions, [{ label: 'Wasser', priceCents: null }]);
});

test('foodOrderDescriptionSuggestions sorts alphabetically with the German locale', () => {
  const suggestions = foodOrderDescriptionSuggestions([
    { description: 'Pizza', priceCents: null },
    { description: 'Öl', priceCents: null },
    { description: 'Apfelschorle', priceCents: null },
  ]);
  assert.deepEqual(
    suggestions.map((s) => s.label),
    ['Apfelschorle', 'Öl', 'Pizza']
  );
});

test('foodOrderDescriptionSuggestions returns an empty list for an order without items', () => {
  assert.deepEqual(foodOrderDescriptionSuggestions([]), []);
});

