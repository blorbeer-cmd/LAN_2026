import test from 'node:test';
import assert from 'node:assert/strict';

import { state } from '../state.js';
import { arrivalsPeopleRows, eventArrivalDepartureDefaults, resolveMyArrivalFields } from './arrivals.js';

const PLAYERS = [
  { id: 'p1', name: 'Alice' },
  { id: 'p2', name: 'Nur eingeladen' },
  { id: 'p3', name: 'Carla' },
];

test.beforeEach(() => {
  state.players = PLAYERS;
  state.activeEvent = { id: 'lan', participantIds: ['p1', 'p3'] };
});

// GET /api/players answers with everyone on the instance, so the table used
// to carry accounts that were merely invited, declined, or withdrew their
// acceptance as permanent "offen" rows.
test('the times table lists only people accepted into the active event', () => {
  assert.deepEqual(
    arrivalsPeopleRows([]).map(({ player }) => player.id),
    ['p1', 'p3'],
  );
});

test('a leftover entry of someone who is no longer accepted stays hidden', () => {
  const arrivals = [
    { player_id: 'p2', arrival_at: 1000, departure_at: 2000, note: 'Zusage zurückgezogen' },
    { player_id: 'p3', arrival_at: 3000, departure_at: 4000, note: null },
  ];
  assert.deepEqual(
    arrivalsPeopleRows(arrivals).map(({ player, entry }) => [player.id, entry?.arrival_at ?? null]),
    [
      ['p1', null],
      ['p3', 3000],
    ],
  );
});

test('accepted people without saved times still get an open row', () => {
  assert.deepEqual(
    arrivalsPeopleRows(undefined).map(({ player, entry }) => [player.id, entry]),
    [
      ['p1', null],
      ['p3', null],
    ],
  );
});

// Before the events payload lands there are no participant ids to filter by;
// showing the full roster beats rendering an empty table (see eventPlayers).
test('the full roster is kept while the active event has no participant ids yet', () => {
  state.activeEvent = null;
  assert.deepEqual(
    arrivalsPeopleRows([]).map(({ player }) => player.id),
    ['p1', 'p2', 'p3'],
  );
});

test("own Ankunft/Abreise defaults to the event's start/end once both are set", () => {
  assert.deepEqual(
    eventArrivalDepartureDefaults({ startsAt: 1000, endsAt: 2000 }),
    { arrivalAt: 1000, departureAt: 2000 },
  );
});

test('a one-sided event period (only start or only end) yields no default', () => {
  assert.deepEqual(eventArrivalDepartureDefaults({ startsAt: 1000, endsAt: null }), { arrivalAt: null, departureAt: null });
  assert.deepEqual(eventArrivalDepartureDefaults({ startsAt: null, endsAt: 2000 }), { arrivalAt: null, departureAt: null });
  assert.deepEqual(eventArrivalDepartureDefaults(null), { arrivalAt: null, departureAt: null });
});

const DEFAULTS = { arrivalAt: 1000, departureAt: 2000 };

test('no saved row yet falls back to the event default', () => {
  assert.deepEqual(resolveMyArrivalFields(null, DEFAULTS, null), { arrivalAt: 1000, departureAt: 2000, note: '' });
});

// Regression: PUT /api/arrivals/mine can store an explicit null (the user
// cleared the field), and leaving/losing a carpool resets its synced field
// to null server-side (syncOwnDirectionField in src/routes/arrivals.ts).
// Both must render as genuinely open, not silently repopulated with the
// event default on the next render.
test('an explicitly cleared field on an existing row stays open, not re-defaulted', () => {
  const own = { arrival_at: null, departure_at: 3000, note: 'x' };
  assert.deepEqual(resolveMyArrivalFields(own, DEFAULTS, null), { arrivalAt: null, departureAt: 3000, note: 'x' });
});

test('an unsaved draft overrides both the saved row and the event default', () => {
  const own = { arrival_at: 3000, departure_at: 4000, note: 'gespeichert' };
  const draft = { arrivalAt: null, departureAt: 5000, note: 'Entwurf' };
  assert.deepEqual(resolveMyArrivalFields(own, DEFAULTS, draft), { arrivalAt: null, departureAt: 5000, note: 'Entwurf' });
});
