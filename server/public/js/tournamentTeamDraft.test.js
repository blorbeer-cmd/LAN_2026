import test from 'node:test';
import assert from 'node:assert/strict';
import { EMPTY_TOURNAMENT_TEAM_ERROR, moveTournamentDraftPlayer } from './tournamentTeamDraft.js';

function draftTeams() {
  return [
    {
      name: 'Team 1',
      players: [
        { id: 'a', rating: 8 },
        { id: 'b', rating: 4 },
      ],
      playerIds: ['a', 'b'],
      totalRating: 12,
    },
    {
      name: 'Team 2',
      players: [{ id: 'c', rating: 6 }],
      playerIds: ['c'],
      totalRating: 6,
    },
  ];
}

test('moves a proposed tournament player and recalculates both teams', () => {
  const teams = draftTeams();

  assert.deepEqual(moveTournamentDraftPlayer(teams, 'a', 1), { moved: true, fromIndex: 0, toIndex: 1 });
  assert.deepEqual(teams[0].playerIds, ['b']);
  assert.deepEqual(teams[1].playerIds, ['c', 'a']);
  assert.equal(teams[0].totalRating, 4);
  assert.equal(teams[1].totalRating, 14);
});

test('keeps at least one player in every proposed tournament team', () => {
  const teams = draftTeams();

  assert.deepEqual(moveTournamentDraftPlayer(teams, 'c', 0), {
    moved: false,
    error: EMPTY_TOURNAMENT_TEAM_ERROR,
  });
  assert.deepEqual(teams[1].playerIds, ['c']);
});

test('ignores missing players, teams and moves to the current team', () => {
  const teams = draftTeams();

  assert.deepEqual(moveTournamentDraftPlayer(teams, 'missing', 1), { moved: false });
  assert.deepEqual(moveTournamentDraftPlayer(teams, 'a', 0), { moved: false });
  assert.deepEqual(moveTournamentDraftPlayer(teams, 'a', 8), { moved: false });
});
