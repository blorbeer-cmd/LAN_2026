import test from 'node:test';
import assert from 'node:assert/strict';
import { selectActiveLobbyMatches } from './tournamentLobbies.js';

const match = (id, round, overrides = {}) => ({
  id,
  round,
  slot: 0,
  stage: null,
  teamAId: 'a',
  teamBId: 'b',
  winnerTeamId: null,
  isDraw: false,
  isBye: false,
  ...overrides,
});

test('selectActiveLobbyMatches exposes only the earliest unfinished league round', () => {
  const active = selectActiveLobbyMatches({
    status: 'active',
    format: 'round_robin',
    lobbyName: 'LAN',
    lobbyPassword: 'pw',
    matches: [match('r1a', 1), match('r1b', 1), match('r2', 2)],
  });
  assert.deepEqual(active.map((entry) => entry.id), ['r1a', 'r1b']);
});

test('selectActiveLobbyMatches exposes every ready bracket pairing', () => {
  const active = selectActiveLobbyMatches({
    status: 'active',
    format: 'single_elimination',
    lobbyName: 'LAN',
    lobbyPassword: null,
    matches: [
      match('open', 1),
      match('waiting', 2, { teamBId: null }),
      match('done', 1, { winnerTeamId: 'a' }),
    ],
  });
  assert.deepEqual(active.map((entry) => entry.id), ['open']);
});

test('selectActiveLobbyMatches switches from group rounds to the knockout stage', () => {
  const tournament = {
    status: 'active',
    format: 'group_knockout',
    lobbyName: 'LAN',
    lobbyPassword: 'pw',
    matches: [
      match('g1', 1, { stage: 'group', groupIndex: 0 }),
      match('g2', 2, { stage: 'group', groupIndex: 0 }),
    ],
  };
  assert.deepEqual(selectActiveLobbyMatches(tournament).map((entry) => entry.id), ['g1']);

  tournament.matches.push(match('ko1', 1, { stage: 'knockout' }));
  assert.deepEqual(selectActiveLobbyMatches(tournament).map((entry) => entry.id), ['ko1']);
});

test('selectActiveLobbyMatches hides lobbies without configuration or after completion', () => {
  const base = { status: 'active', format: 'round_robin', lobbyName: null, lobbyPassword: null, matches: [match('m', 1)] };
  assert.deepEqual(selectActiveLobbyMatches(base), []);
  assert.deepEqual(selectActiveLobbyMatches({ ...base, status: 'completed', lobbyName: 'LAN' }), []);
});
