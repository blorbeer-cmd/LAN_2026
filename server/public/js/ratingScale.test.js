import test from 'node:test';
import assert from 'node:assert/strict';

import { ratingScaleHtml } from './ratingScale.js';

const attributes = (value) => `data-value="${value}"`;

test('a plain scale renders six numbers with only the chosen one pressed', () => {
  const html = ratingScaleHtml({ selected: '2', groupLabel: 'Bewertung', attributes });
  assert.equal((html.match(/<button/g) ?? []).length, 6);
  assert.match(html, /class="btn btn-square is-selected" data-value="2"/);
  assert.equal((html.match(/aria-pressed="true"/g) ?? []).length, 1);
  assert.doesNotMatch(html, /rating-scale-meter/);
});

test('a reference value is pre-marked and named, but never pressed', () => {
  const html = ratingScaleHtml({ selected: null, groupLabel: 'Punkte', attributes, hint: 4, hintLabel: 'dein Bock' });
  assert.match(html, /class="btn btn-square is-hint" data-value="4"\s+aria-label="4 von 5, dein Bock" aria-pressed="false"/);
  assert.doesNotMatch(html, /aria-pressed="true"/);

  const chosenElsewhere = ratingScaleHtml({ selected: 2, groupLabel: 'Punkte', attributes, hint: 2 });
  assert.doesNotMatch(chosenElsewhere, /is-hint/, 'the chosen number is not additionally pre-marked');
});

test('a toned scale adds a fill line: proportional, empty for 0 and dashed while unrated', () => {
  const four = ratingScaleHtml({ selected: 4, groupLabel: 'Bock', attributes, tone: 'bock' });
  assert.match(four, /^<div class="rating-scale rating-scale--bock">/);
  assert.match(four, /rating-scale-meter-fill" style="width:80%;"/);

  const zero = ratingScaleHtml({ selected: 0, groupLabel: 'Skill', attributes, tone: 'skill' });
  assert.match(zero, /rating-scale-meter-fill" style="width:0%;"/);
  assert.doesNotMatch(zero, /is-unrated/);

  const unrated = ratingScaleHtml({ selected: undefined, groupLabel: 'Skill', attributes, tone: 'skill' });
  assert.match(unrated, /rating-scale-meter is-unrated/);
  assert.doesNotMatch(unrated, /rating-scale-meter-fill/);
});
