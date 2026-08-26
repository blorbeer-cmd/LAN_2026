// Unit tests for emptyStateHtml(), the single render function behind the
// app's ubiquitous ".empty-state" placeholder markup.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { emptyStateHtml } from './emptyState.js';

test('plain text renders a bare empty-state div with no icon span', () => {
  const html = emptyStateHtml('Noch keine Daten.');
  assert.equal(html, '<div class="empty-state">Noch keine Daten.</div>');
});

test('plain text is escaped', () => {
  const html = emptyStateHtml('<strong>x</strong>');
  assert.equal(html, '<div class="empty-state">&lt;strong&gt;x&lt;/strong&gt;</div>');
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

test('structured content renders escaped title, body and a canonical action', () => {
  const html = emptyStateHtml({
    title: 'Event <wählen>',
    body: 'Aktives Event & Kontext',
    action: { id: 'choose-event', label: 'Event wählen' },
  });
  assert.match(html, /empty-state-structured/);
  assert.match(html, /Event &lt;wählen&gt;/);
  assert.match(html, /Aktives Event &amp; Kontext/);
  assert.match(html, /id="choose-event"/);
  assert.match(html, />Event wählen<\/button>/);
});

test('structured illustration attributes are escaped', () => {
  const html = emptyStateHtml({
    title: 'Leer',
    illustration: { src: '/img/mascot.svg', alt: '', width: 72, height: 66, className: 'mascot' },
  });
  assert.match(html, /<img src="\/img\/mascot\.svg" alt="" width="72" height="66" class="mascot" \/>/);
});
