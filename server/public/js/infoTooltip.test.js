import test from 'node:test';
import assert from 'node:assert/strict';
import { infoTooltipHtml } from './infoTooltip.js';

test('infoTooltipHtml renders accessible escaped markup', () => {
  const html = infoTooltipHtml('captain-help', 'Captain <Draft>', 'Wählt 2–4 & spielt.');
  assert.match(html, /aria-controls="captain-help"/);
  assert.match(html, /aria-expanded="false"/);
  assert.match(html, /Mehr Informationen zu Captain &lt;Draft&gt;/);
  assert.match(html, /Wählt 2–4 &amp; spielt\./);
  assert.doesNotMatch(html, /Captain <Draft>/);
});
