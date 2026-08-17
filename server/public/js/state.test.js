// Unit tests for the shared in-memory client store's lookup helpers.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  accessibleEvents,
  selectableEventWorkspaces,
  state,
  playerById,
  gameById,
  catalogGames,
  gamesWithHistory,
  eventPlayers,
} from './state.js';

test('state starts with the expected empty defaults', () => {
  assert.deepEqual(state.players, []);
  assert.deepEqual(state.games, []);
  assert.equal(state.votes, null);
  assert.equal(state.selectedGameId, null);
  assert.equal(state.lastMatchmaking, null);
});

test('playerById finds a player by id', () => {
  state.players = [{ id: 'p1', name: 'Alice' }, { id: 'p2', name: 'Bob' }];
  assert.equal(playerById('p2').name, 'Bob');
});

test('playerById returns undefined for an unknown id', () => {
  state.players = [{ id: 'p1', name: 'Alice' }];
  assert.equal(playerById('nope'), undefined);
});

test('gameById finds a game by id', () => {
  state.games = [{ id: 'g1', name: 'CS2' }, { id: 'g2', name: 'Rocket League' }];
  assert.equal(gameById('g1').name, 'CS2');
});

test('gameById returns undefined for an unknown id', () => {
  state.games = [];
  assert.equal(gameById('missing'), undefined);
});

test('accessibleEvents offers the participation history, not the admin management list', () => {
  // The shapes below mirror GET /api/events: `historicalEvents` is every
  // event this account accepted at some point (ended ones included, because
  // a finished LAN is exactly what an event filter is for), `availableEvents`
  // is the subset that can still be worked in, and `managedEvents` is the
  // owner/admin list of every event in the group — including ones they never
  // joined, which personal analytics answer with a 404.
  state.availableEvents = [
    { id: 'instance-base-event', isBase: true },
    { id: 'joined-event' },
  ];
  state.historicalEvents = [...state.availableEvents, { id: 'finished-event', isEnded: true }];
  state.managedEvents = [{ id: 'joined-event' }, { id: 'never-joined-event' }];
  state.events = state.managedEvents;
  assert.deepEqual(
    accessibleEvents().map((event) => event.id),
    ['instance-base-event', 'joined-event', 'finished-event'],
  );
});

test('the workspace switcher stays on the events that can still be entered', () => {
  // A finished event remains a valid analytics filter but is not a workspace
  // anyone can switch into — PUT /api/me/active-event rejects it with a 404.
  state.availableEvents = [{ id: 'instance-base-event', isBase: true }];
  state.historicalEvents = [...state.availableEvents, { id: 'finished-event', isEnded: true }];
  assert.deepEqual(
    selectableEventWorkspaces().map((event) => event.id),
    ['instance-base-event'],
  );
});

test('accessibleEvents is empty before the first event payload arrives', () => {
  state.availableEvents = undefined;
  state.historicalEvents = undefined;
  assert.deepEqual(accessibleEvents(), []);
  assert.deepEqual(selectableEventWorkspaces(), []);
});

test('catalogGames keeps the accepted games and drops the suggestions', () => {
  state.games = [
    { id: 'g1', name: 'CS2', isSuggestion: false },
    { id: 'g2', name: 'Neuer Vorschlag', isSuggestion: true },
    { id: 'g3', name: 'Rocket League' },
  ];
  assert.deepEqual(
    catalogGames().map((g) => g.id),
    ['g1', 'g3'],
  );
});

test('catalogGames is empty while only suggestions exist', () => {
  state.games = [{ id: 'g1', name: 'Nur ein Vorschlag', isSuggestion: true }];
  assert.deepEqual(catalogGames(), []);
});

test('gamesWithHistory keeps a demoted game that already carries results', () => {
  state.games = [
    { id: 'g1', name: 'CS2', isSuggestion: false },
    { id: 'g2', name: 'Zurückgestuft', isSuggestion: true },
    { id: 'g3', name: 'Frischer Vorschlag', isSuggestion: true },
  ];
  state.matches = [{ id: 'm1', gameId: 'g2' }];
  assert.deepEqual(
    gamesWithHistory().map((g) => g.id),
    ['g1', 'g2'],
  );
});

test('eventPlayers keeps only players accepted into the active event', () => {
  state.players = [{ id: 'p1', name: 'Alice' }, { id: 'p2', name: 'Bob' }, { id: 'p3', name: 'Carla' }];
  state.activeEvent = { id: 'testevent', participantIds: ['p1', 'p3'] };
  assert.deepEqual(eventPlayers().map((p) => p.id), ['p1', 'p3']);
});

test('eventPlayers falls back to the full roster before participant ids are known', () => {
  state.players = [{ id: 'p1', name: 'Alice' }, { id: 'p2', name: 'Bob' }];
  state.activeEvent = { id: 'base' };
  assert.deepEqual(eventPlayers().map((p) => p.id), ['p1', 'p2']);
  state.activeEvent = null;
  assert.deepEqual(eventPlayers().map((p) => p.id), ['p1', 'p2']);
});

test('gamesWithHistory also keeps the extra ids it is handed', () => {
  state.games = [
    { id: 'g1', name: 'CS2', isSuggestion: false },
    { id: 'g2', name: 'Frisch ausgelost', isSuggestion: true },
  ];
  state.matches = [];
  assert.deepEqual(
    gamesWithHistory([undefined, 'g2']).map((g) => g.id),
    ['g1', 'g2'],
  );
  assert.deepEqual(
    gamesWithHistory().map((g) => g.id),
    ['g1'],
  );
});
