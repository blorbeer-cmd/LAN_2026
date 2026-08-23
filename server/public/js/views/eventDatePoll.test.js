// Unit tests for the date poll section's fetch-error recovery
// (renderDatePollSection/fetchPolls are DOM-free HTML-string builders, so
// these run without a browser — only api.js's eventDatePolls.list is
// stubbed).

import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { api } from '../api.js';
import { renderDatePollSection, invalidateEventDatePolls } from './eventDatePoll.js';

const EVENT = { id: 'evt-error-test', status: 'draft', startsAt: null, endsAt: null };

function waitForRerender(ctx) {
  return new Promise((resolve) => {
    ctx.rerender = resolve;
  });
}

beforeEach(() => {
  invalidateEventDatePolls();
});

test('a failed poll fetch renders a retry action instead of silently showing nothing', async () => {
  api.eventDatePolls.list = async () => {
    throw new Error('Netzwerkfehler');
  };
  const ctx = { rerender() {} };
  const rerendered = waitForRerender(ctx);
  const loadingHtml = renderDatePollSection(EVENT, ctx);
  assert.match(loadingHtml, /Lädt Terminabstimmung/);
  await rerendered;

  const errorHtml = renderDatePollSection(EVENT, ctx);
  assert.match(errorHtml, /konnte nicht geladen werden/);
  assert.match(errorHtml, /data-retry-date-polls="evt-error-test"/);
});

test('clearing the cache — what the retry button does — lets the section recover once the fetch succeeds', async () => {
  api.eventDatePolls.list = async () => {
    throw new Error('Netzwerkfehler');
  };
  const ctx = { rerender() {} };
  let rerendered = waitForRerender(ctx);
  renderDatePollSection(EVENT, ctx);
  await rerendered;
  assert.match(renderDatePollSection(EVENT, ctx), /konnte nicht geladen werden/);

  api.eventDatePolls.list = async () => [];
  invalidateEventDatePolls(); // same cache-clearing effect as the retry button
  rerendered = waitForRerender(ctx);
  assert.match(
    renderDatePollSection(EVENT, ctx),
    /Lädt Terminabstimmung/,
    'a cleared cache re-enters the loading state and triggers a fresh fetch',
  );
  await rerendered;

  assert.doesNotMatch(renderDatePollSection(EVENT, ctx), /konnte nicht geladen werden/);
});
