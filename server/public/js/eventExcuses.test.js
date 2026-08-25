import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  EVENT_EXCUSES,
  EXCUSE_CATEGORIES,
  eventExcusePool,
  eventExcuseProfile,
  excuseCategoryLabel,
  excuseCredibility,
  fillExcuseText,
  pickEventExcuse,
} from './eventExcuses.js';

const DURATIONS = ['unknown', 'short', 'medium', 'long'];

// One representative event per duration bucket, built from local times so the
// day count matches what the cards print in the user's own timezone.
const EVENTS = {
  unknown: { startsAt: null, endsAt: null },
  short: { startsAt: new Date(2026, 8, 12, 18, 0).getTime(), endsAt: new Date(2026, 8, 12, 23, 30).getTime() },
  medium: { startsAt: new Date(2026, 8, 11, 16, 0).getTime(), endsAt: new Date(2026, 8, 13, 10, 0).getTime() },
  long: { startsAt: new Date(2026, 8, 7, 10, 0).getTime(), endsAt: new Date(2026, 8, 12, 16, 0).getTime() },
};

test('the excuse pool is large, unique and completely categorized', () => {
  assert.ok(EVENT_EXCUSES.length >= 120, `expected at least 120 excuses, got ${EVENT_EXCUSES.length}`);

  const ids = new Set(EVENT_EXCUSES.map((entry) => entry.id));
  assert.equal(ids.size, EVENT_EXCUSES.length, 'every excuse needs its own id');

  const categoryIds = new Set(EXCUSE_CATEGORIES.map((category) => category.id));
  for (const entry of EVENT_EXCUSES) {
    assert.ok(categoryIds.has(entry.category), `unknown category ${entry.category} on ${entry.id}`);
    assert.ok(entry.durations.length > 0, `${entry.id} fits no duration at all`);
    for (const duration of entry.durations) {
      assert.ok(DURATIONS.includes(duration), `${entry.id} declares unknown duration ${duration}`);
    }
    // "unknown" is derived from the absence of date placeholders, never declared.
    assert.equal(entry.durations.includes('unknown'), false, `${entry.id} must not declare the derived bucket`);
  }
});

test('an excuse never names the Respawn event it is an excuse for', () => {
  for (const entry of EVENT_EXCUSES) {
    assert.doesNotMatch(entry.text, /\{event\}|\bLAN\b|\bRespawn\b/i, `${entry.id} gives the game away`);
  }
});

test('every category stays offerable for every event duration', () => {
  for (const [name, event] of Object.entries(EVENTS)) {
    assert.ok(eventExcusePool(event).length >= 60, `${name} offers only ${eventExcusePool(event).length} excuses`);
    for (const category of EXCUSE_CATEGORIES) {
      const pool = eventExcusePool(event, { category: category.id });
      assert.ok(pool.length > 0, `${category.id} has no excuse for a ${name} event`);
      assert.ok(
        pool.every((entry) => entry.category === category.id),
        `${category.id} pool leaked a foreign category`,
      );
    }
  }
});

test('duration buckets follow the visible German day count', () => {
  assert.deepEqual(eventExcuseProfile(EVENTS.unknown), {
    duration: 'unknown',
    days: null,
    start: null,
    end: null,
    range: null,
  });
  assert.equal(eventExcuseProfile(EVENTS.short).duration, 'short');
  assert.equal(eventExcuseProfile(EVENTS.short).range, '12.09.', 'a single day prints one date, not a range');

  // Friday evening to Sunday morning is three days to everyone involved.
  const weekend = eventExcuseProfile(EVENTS.medium);
  assert.equal(weekend.duration, 'medium');
  assert.equal(weekend.days, 3);
  assert.equal(weekend.range, '11.09. – 13.09.');

  assert.equal(eventExcuseProfile(EVENTS.long).duration, 'long');
  assert.equal(eventExcuseProfile(EVENTS.long).days, 6);

  // An evening that crosses midnight stays an evening.
  const overnight = { startsAt: new Date(2026, 8, 12, 20, 0).getTime(), endsAt: new Date(2026, 8, 13, 2, 0).getTime() };
  assert.equal(eventExcuseProfile(overnight).duration, 'short');
});

test('incomplete or reversed event periods fall back to the date-free pool', () => {
  for (const event of [
    { startsAt: null, endsAt: EVENTS.medium.endsAt },
    { startsAt: EVENTS.medium.startsAt, endsAt: null },
    { startsAt: EVENTS.medium.endsAt, endsAt: EVENTS.medium.startsAt },
    { startsAt: 'nicht', endsAt: 'vergleichbar' },
    undefined,
  ]) {
    assert.equal(eventExcuseProfile(event).duration, 'unknown');
    assert.ok(eventExcusePool(event).every((entry) => !/\{(tage|zeitraum|start|ende)\}/.test(entry.text)));
  }
});

test('every offered excuse renders without a leftover placeholder', () => {
  for (const [name, event] of Object.entries(EVENTS)) {
    const profile = eventExcuseProfile(event);
    for (const entry of eventExcusePool(event)) {
      const text = fillExcuseText(entry.text, profile);
      assert.doesNotMatch(text, /[{}]/, `${entry.id} keeps a placeholder for a ${name} event`);
      // The German plural in "{tage} Tage" only works from two days upwards.
      if (entry.text.includes('{tage}')) assert.ok(profile.days >= 2, `${entry.id} would print "1 Tage"`);
    }
  }
});

test('an excuse printing both dates is kept away from single-day events', () => {
  // On a single-day event `{start}` and `{ende}` resolve to the same date, so
  // such a text would print "von 12.09. bis 12.09." — the copy-paste look that
  // eventExcuseProfile()'s collapsed `range` exists to avoid. `{zeitraum}` is
  // the placeholder that already handles it.
  for (const entry of EVENT_EXCUSES) {
    if (!entry.text.includes('{start}') || !entry.text.includes('{ende}')) continue;
    assert.equal(
      entry.durations.includes('short'),
      false,
      `${entry.id} prints a start and an end date and must not be offered for a single-day event`,
    );
  }

  const sameDay = eventExcuseProfile(EVENTS.short);
  assert.equal(sameDay.start, sameDay.end);
  for (const entry of eventExcusePool(EVENTS.short)) {
    const text = fillExcuseText(entry.text, sameDay);
    assert.doesNotMatch(text, /(\d{2}\.\d{2}\.)[^\d]{1,12}\1/, `${entry.id} repeats the same date twice`);
  }
});

test('a filled-in date never collides with the sentence punctuation around it', () => {
  // Every printed date already ends in a period, so a placeholder in
  // sentence-final position renders "12.09..". That reads as a typo, and a
  // typo is exactly what an excuse trading on detail cannot afford.
  for (const event of Object.values(EVENTS)) {
    const profile = eventExcuseProfile(event);
    for (const entry of eventExcusePool(event)) {
      const text = fillExcuseText(entry.text, profile);
      assert.doesNotMatch(text, /\.\./, `${entry.id} renders a doubled period for a ${profile.duration} event`);
    }
  }
});

test('a day count is filled in and survives a missing period', () => {
  assert.match(fillExcuseText('Genau {tage} Tage.', eventExcuseProfile(EVENTS.medium)), /Genau 3 Tage\./);
  assert.match(
    fillExcuseText('Von {start} bis {ende}, also {zeitraum}.', eventExcuseProfile(EVENTS.long)),
    /Von 07\.09\. bis 12\.09\., also 07\.09\. – 12\.09\.\./,
  );
  assert.doesNotMatch(fillExcuseText('{tage} {zeitraum} {start} {ende}', eventExcuseProfile(EVENTS.unknown)), /[{}]/);
});

test('credibility rewards length and concrete numbers, capped at five', () => {
  assert.equal(excuseCredibility('Keine Zeit.'), 1);
  assert.ok(excuseCredibility('Ich kann leider nicht, es passt einfach nicht.') < excuseCredibility(EVENT_EXCUSES[0].text));
  assert.equal(excuseCredibility(`${'Detail 42. '.repeat(40)}`), 5);
  assert.equal(excuseCredibility(undefined), 1);
  for (const entry of EVENT_EXCUSES) {
    const credibility = excuseCredibility(entry.text);
    assert.ok(credibility >= 1 && credibility <= 5, `${entry.id} scored ${credibility}`);
  }
});

test('picking honours the category filter and avoids the excuses just shown', () => {
  const first = pickEventExcuse(EVENTS.medium, { category: 'tier', random: () => 0 });
  assert.equal(first.category, 'tier');
  assert.equal(first.credibility, excuseCredibility(first.text));

  const second = pickEventExcuse(EVENTS.medium, { category: 'tier', recentIds: [first.id], random: () => 0 });
  assert.notEqual(second.id, first.id);

  // Once every excuse of the pool has been shown, repeating beats giving up.
  const pool = eventExcusePool(EVENTS.medium, { category: 'tier' });
  const exhausted = pickEventExcuse(EVENTS.medium, {
    category: 'tier',
    recentIds: pool.map((entry) => entry.id),
    random: () => 0,
  });
  assert.ok(exhausted);
  assert.equal(exhausted.id, pool[0].id);
});

test('picking stays inside the pool for every random value and unknown filter', () => {
  for (const value of [0, 0.5, 0.999999, 1]) {
    const excuse = pickEventExcuse(EVENTS.long, { random: () => value });
    assert.ok(EVENT_EXCUSES.some((entry) => entry.id === excuse.id));
    assert.doesNotMatch(excuse.text, /[{}]/);
  }
  assert.equal(pickEventExcuse(EVENTS.long, { category: 'gibt-es-nicht' }), null);
});

test('category labels stay resolvable and never render as an empty chip', () => {
  for (const category of EXCUSE_CATEGORIES) {
    assert.equal(excuseCategoryLabel(category.id), category.label);
    assert.ok(category.label.trim().length > 0);
  }
  assert.equal(excuseCategoryLabel('gibt-es-nicht'), 'Sonstiges');
});
