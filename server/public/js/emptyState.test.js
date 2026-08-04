// Unit tests for emptyStateHtml(), the single render function behind the
// app's ubiquitous ".empty-state" placeholder markup.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { emptyStateHtml } from './emptyState.js';

test('plain text renders a bare empty-state div with no icon span', () => {
  const html = emptyStateHtml('Noch keine Daten.');
  assert.equal(html, '<div class="empty-state">Noch keine Daten.</div>');
});

test('an icon option wraps it in the empty-state-icon span before the text', () => {
  const html = emptyStateHtml('Noch keine Events.', { icon: '<svg>x</svg>' });
  assert.equal(
    html,
    '<div class="empty-state"><span class="empty-state-icon"><svg>x</svg></span>Noch keine Events.</div>',
  );
});

test('className appends an extra class alongside empty-state', () => {
  const html = emptyStateHtml('Lädt…', { className: 'vote-empty-state' });
  assert.match(html, /^<div class="empty-state vote-empty-state">/);
});

test('style renders a style attribute matching existing call sites', () => {
  const html = emptyStateHtml('Lädt…', { style: 'padding:var(--space-4);' });
  assert.match(html, /^<div class="empty-state" style="padding:var\(--space-4\);">/);
});

test('text is passed through unescaped, matching the existing escapeHtml(...) call-site contract', () => {
  const html = emptyStateHtml('<strong>x</strong>');
  assert.match(html, /<strong>x<\/strong>/);
});
