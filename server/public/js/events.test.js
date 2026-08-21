import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderEventLocation } from './views/events.js';

test('event location copy buttons are named for their event', () => {
  const html = renderEventLocation('https://lan.example.test/location', 'Winter LAN');
  assert.match(html, /aria-label="Ort von Winter LAN kopieren"/);
  assert.match(html, /title="Ort von Winter LAN kopieren"/);
});
