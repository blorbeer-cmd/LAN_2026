// Reproducible admin fixtures that are deliberately stored in the real local
// database so the polished overview screens can be judged with realistic
// density. Every historical event is marked is_test and can therefore be
// removed atomically without touching a real LAN.

import { nanoid } from 'nanoid';
import { db, DEFAULT_GROUP_ID } from './db';
import { deleteTestUsers } from './testUsers';

const FIRST_TEST_YEAR = 2015;
const LAST_TEST_YEAR = 2026;
const MATCHES_PER_EVENT = 18;
const TOURNAMENTS_PER_EVENT = 3;

interface PlayerRow {
  id: string;
}

interface GameRow {
  id: string;
  name: string;
}

export interface HallOfFameSeedResult {
  events: number;
  matches: number;
  tournaments: number;
}

export interface TestDataCleanupResult {
  deletedPlayers: number;
  deletedEvents: number;
}

function deleteTestEventsInTransaction(): number {
  const result = db.prepare('DELETE FROM events WHERE is_test = 1').run();
  return result.changes;
}

export function seedHallOfFameTestData(): HallOfFameSeedResult {
  const seed = db.transaction((): HallOfFameSeedResult => {
    const players = db
      .prepare('SELECT id FROM players ORDER BY is_test, created_at, name COLLATE NOCASE LIMIT 12')
      .all() as PlayerRow[];
    const games = db
      .prepare('SELECT id, name FROM games WHERE arcade_key IS NULL ORDER BY name COLLATE NOCASE LIMIT 8')
      .all() as GameRow[];

    if (players.length < 4) throw new Error('Mindestens vier Spieler werden für Hall-of-Fame-Testdaten benötigt.');
    if (games.length === 0) throw new Error('Mindestens ein Spiel wird für Hall-of-Fame-Testdaten benötigt.');

    // Re-seeding is intentionally a replacement, not an append operation:
    // the resulting years/counts stay stable across repeated button presses.
    deleteTestEventsInTransaction();

    const insertEvent = db.prepare(
      `INSERT INTO events
       (id, name, starts_at, ends_at, location, description, tracking_enabled, ended_at, is_test, group_id)
       VALUES (?, ?, ?, ?, ?, ?, 0, ?, 1, ?)`
    );
    const insertParticipant = db.prepare(
      'INSERT INTO event_participants (event_id, player_id) VALUES (?, ?)'
    );
    const insertMatch = db.prepare(
      'INSERT INTO matches (id, game_id, event_id, played_at, result, group_id) VALUES (?, ?, ?, ?, ?, ?)'
    );
    const insertTournament = db.prepare(
      `INSERT INTO tournaments
       (id, event_id, game_id, name, format, two_legged, track_score, group_count,
        advancers_per_group, status, created_at, lobby_name, lobby_password, group_id)
       VALUES (?, ?, ?, ?, 'single_elimination', 0, 1, NULL, NULL, 'completed', ?, NULL, NULL, ?)`
    );
    const insertTeam = db.prepare(
      'INSERT INTO tournament_teams (id, tournament_id, name, player_ids, group_index) VALUES (?, ?, ?, ?, NULL)'
    );
    const insertTournamentMatch = db.prepare(
      `INSERT INTO tournament_matches
       (id, tournament_id, round, slot, stage, group_index, team_a_id, team_b_id,
        winner_team_id, score_a, score_b, is_draw, is_bye, match_id, played_at)
       VALUES (?, ?, ?, ?, NULL, NULL, ?, ?, ?, ?, ?, 0, 0, NULL, ?)`
    );

    let matchCount = 0;
    let tournamentCount = 0;
    for (let year = FIRST_TEST_YEAR; year <= LAST_TEST_YEAR; year++) {
      const eventId = nanoid();
      const startsAt = Date.UTC(year, 7, 14, 16, 0);
      const endsAt = startsAt + 3 * 24 * 60 * 60 * 1000;
      insertEvent.run(
        eventId,
        `Respawn Test-LAN ${year}`,
        startsAt,
        endsAt,
        year % 2 === 0 ? 'Hamburg' : 'Melle',
        'Historische Testdaten für die Hall of Fame.',
        endsAt,
        DEFAULT_GROUP_ID
      );
      for (const player of players) insertParticipant.run(eventId, player.id);

      // Enough normal results to produce full, visibly changing standings.
      // Winners rotate by year and round so the all-time ranking is dense but
      // not artificially tied everywhere.
      for (let index = 0; index < MATCHES_PER_EVENT; index++) {
        const playerA = players[(index + year) % players.length];
        const playerB = players[(index * 3 + year + 1) % players.length];
        const winnerTeamIndex = (index + year) % 3 === 0 ? 1 : 0;
        const result = {
          teams: [{ playerIds: [playerA.id] }, { playerIds: [playerB.id] }],
          winnerTeamIndex,
        };
        insertMatch.run(
          nanoid(),
          games[(index + year) % games.length].id,
          eventId,
          startsAt + (index + 1) * 2 * 60 * 60 * 1000,
          JSON.stringify(result),
          DEFAULT_GROUP_ID
        );
        matchCount += 1;
      }

      // Three compact four-team brackets per LAN make the per-event dropdown
      // and all-time tournament ranking useful at a glance.
      for (let index = 0; index < TOURNAMENTS_PER_EVENT; index++) {
        const game = games[(year + index * 2) % games.length];
        const tournamentId = nanoid();
        const playedAt = startsAt + (index + 1) * 12 * 60 * 60 * 1000;
        insertTournament.run(tournamentId, eventId, game.id, `${game.name} Cup ${year}`, playedAt, DEFAULT_GROUP_ID);

        const teams = ['Blau', 'Pink', 'Violett', 'Grün'].map((label, teamIndex) => {
          const first = players[(year + index + teamIndex * 2) % players.length];
          const second = players[(year + index + teamIndex * 2 + 1) % players.length];
          const id = nanoid();
          insertTeam.run(id, tournamentId, `Team ${label}`, JSON.stringify([first.id, second.id]));
          return id;
        });
        const semifinalAWinner = teams[(year + index) % 2];
        const semifinalBWinner = teams[2 + ((year + index + 1) % 2)];
        const champion = (year + index) % 3 === 0 ? semifinalBWinner : semifinalAWinner;
        insertTournamentMatch.run(nanoid(), tournamentId, 1, 0, teams[0], teams[1], semifinalAWinner, 2, 1, playedAt);
        insertTournamentMatch.run(nanoid(), tournamentId, 1, 1, teams[2], teams[3], semifinalBWinner, 2, 0, playedAt + 60 * 60 * 1000);
        insertTournamentMatch.run(
          nanoid(),
          tournamentId,
          2,
          0,
          semifinalAWinner,
          semifinalBWinner,
          champion,
          champion === semifinalAWinner ? 3 : 1,
          champion === semifinalBWinner ? 3 : 1,
          playedAt + 2 * 60 * 60 * 1000
        );
        tournamentCount += 1;
      }
    }

    return {
      events: LAST_TEST_YEAR - FIRST_TEST_YEAR + 1,
      matches: matchCount,
      tournaments: tournamentCount,
    };
  });
  return seed();
}

export function deleteAllTestData(): TestDataCleanupResult {
  const cleanup = db.transaction((): TestDataCleanupResult => {
    // Test events first: their matches/tournaments/orders are event-scoped
    // and disappear through FK cascades before test-player cleanup runs.
    const deletedEvents = deleteTestEventsInTransaction();
    const deletedPlayers = deleteTestUsers();
    return { deletedPlayers, deletedEvents };
  });
  return cleanup();
}

export function countTestEvents(): number {
  return (db.prepare('SELECT COUNT(*) AS n FROM events WHERE is_test = 1').get() as { n: number }).n;
}
