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

test('a hint marks exactly one number and names it, independent of the selection', () => {
  const html = ratingScaleHtml({ selected: 4, hint: 2, hintLabel: 'dein Bock', groupLabel: 'Punkte', attributes, tone: 'vote' });
  assert.equal((html.match(/is-hint/g) ?? []).length, 1);
  assert.match(html, /class="btn btn-square is-hint" data-value="2"\s+aria-label="2 von 5, dein Bock" aria-pressed="false" title="dein Bock"/);
  assert.match(html, /class="btn btn-square is-selected" data-value="4"/);

  const zero = ratingScaleHtml({ selected: null, hint: 0, hintLabel: 'dein Bock', groupLabel: 'Punkte', attributes });
  assert.match(zero, /is-hint" data-value="0"/, '0 is a real Bock and is marked too');
  assert.doesNotMatch(ratingScaleHtml({ selected: 1, groupLabel: 'Punkte', attributes }), /is-hint|title=/);
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
