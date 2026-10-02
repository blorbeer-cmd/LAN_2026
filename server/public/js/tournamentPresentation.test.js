import test from 'node:test';
import assert from 'node:assert/strict';
import { createTournamentPresentation } from './tournamentPresentation.js';

const player = (id) => ({ id, name: id, color: null });
const team = (id, ...playerIds) => ({ id, name: `Team ${id}`, players: playerIds.map(player) });
const match = (id, round, slot, teamAId, teamBId, overrides = {}) => ({
  id,
  round,
  slot,
  stage: null,
  groupIndex: null,
  teamAId,
  teamBId,
  winnerTeamId: null,
  isDraw: false,
  isBye: false,
  scoreA: null,
  scoreB: null,
  lobbyName: `Lobby ${id}`,
  ...overrides,
});

// Quarterfinal with three open pairings; "me" plays in the second one.
const knockout = {
  id: 'ko',
  gameId: 'g',
  format: 'single_elimination',
  status: 'active',
  trackScore: true,
  lobbyName: 'Cup',
  lobbyPassword: 'pw',
  teams: [team('1', 'p1'), team('2', 'p2'), team('3', 'me', 'p3'), team('4', 'p4')],
  matches: [
    match('qf1', 1, 0, '1', '2'),
    match('qf2', 1, 1, '3', '4'),
    match('f', 2, 0, null, null),
  ],
};

const league = {
  id: 'rr',
  gameId: 'g',
  format: 'round_robin',
  status: 'active',
  trackScore: false,
  lobbyName: null,
  lobbyPassword: null,
  teams: [team('1', 'p1'), team('2', 'me'), team('3', 'p3')],
  matches: [match('m1', 1, 0, '1', '3'), match('m2', 1, 1, '2', '1')],
  standings: [
    { teamId: '1', played: 0, wins: 0, draws: 0, losses: 0, points: 0 },
    { teamId: '2', played: 0, wins: 0, draws: 0, losses: 0, points: 0 },
    { teamId: '3', played: 0, wins: 0, draws: 0, losses: 0, points: 0 },
  ],
};

// Text a screen reader reads from the markup (hidden hints included, attributes not).
const readableText = (html) => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

const lobbyOrder = (html) => [...html.matchAll(/data-copy-lobby-match="([^"]+)" data-copy-lobby-kind="name"/g)].map((m) => m[1]);

test('marks only the signed-in player’s team and puts their lobby first', () => {
  const pres = createTournamentPresentation('me');

  const lobbies = pres.renderActiveLobbies(knockout);
  assert.deepEqual(lobbyOrder(lobbies), ['qf2', 'qf1']);
  assert.equal((lobbies.match(/tournament-lobby-row is-mine/g) ?? []).length, 1);
  assert.match(readableText(lobbies), /^Aktive Lobbys Deine Lobby: Team 3 vs Team 4 /);
  assert.equal((readableText(lobbies).match(/Deine Lobby/g) ?? []).length, 1);

  const bracket = pres.renderBracket(knockout);
  assert.equal((bracket.match(/bracket-team-row[^"]*is-mine/g) ?? []).length, 1);
  // The hint sits beside the name, so the name element's text stays the team name.
  assert.match(bracket, /class="bracket-team-row is-mine"><span class="bracket-team-name">Team 3<\/span><span class="visually-hidden"> \(dein Team\)<\/span>/);

  const board = pres.renderRoundRobin(league);
  assert.equal((board.match(/tournament-fixture is-mine/g) ?? []).length, 1);
  assert.match(readableText(board), /Dein Spiel: Team 2 vs Team 1/);
  assert.equal((board.match(/<tr class="[^"]*is-mine/g) ?? []).length, 1);

  const teams = pres.renderTournamentTeams(league);
  assert.equal((teams.match(/tournament-team-card is-mine/g) ?? []).length, 1);
  assert.equal((teams.match(/\(dein Team\)/g) ?? []).length, 1);
});

test('an early-ended tournament offers no result action, a regularly completed one keeps its corrections', () => {
  const pres = createTournamentPresentation('me');
  const played = { ...league, status: 'completed', matches: [match('m1', 1, 0, '1', '3', { winnerTeamId: '1' }), match('m2', 1, 1, '2', '1')] };
  const resultActions = (html) => (html.match(/data-open-result="/g) ?? []).length;
  assert.equal(resultActions(pres.renderRoundRobin(played)), 1, 'a completed tournament still allows correcting a recorded result');
  assert.equal(resultActions(pres.renderRoundRobin({ ...played, endedEarly: true })), 0);
  assert.equal(resultActions(pres.renderBracket({ ...knockout, status: 'completed', endedEarly: true })), 0);
});

test('leaves boards unmarked and in schedule order for players outside the tournament', () => {
  for (const pres of [createTournamentPresentation('spectator'), createTournamentPresentation(null)]) {
    const html = [
      pres.renderActiveLobbies(knockout),
      pres.renderBracket(knockout),
      pres.renderRoundRobin(league),
      pres.renderTournamentTeams(league),
    ].join('');
    assert.doesNotMatch(html, /is-mine|dein Team|Deine Lobby|Dein Spiel/);
    assert.deepEqual(lobbyOrder(pres.renderActiveLobbies(knockout)), ['qf1', 'qf2']);
  }
});
