// Integration tests for skill-rating upsert/read/delete. Creates its own
// player and game so it doesn't depend on seed data or other test files.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { createTestApp, DEFAULT_GROUP_ID, TEST_ADMIN_ID } from './testApp';

import { db } from '../db';
import { createEvent, setParticipants } from '../events';
import { readPointsSource, readPointsJournal, readPointsBalances } from '../pointsJournal';
import { syncOrgaPoints, backfillCompetitionPoints } from '../orgaPoints';
import { grantSkillCompletionBonus, SKILL_BONUS_SOURCE } from '../skillBonus';

const app = createTestApp();
let playerId: string;
let gameId: string;

test('setup: create a player and a game to rate', async () => {
  const player = await request(app).post('/api/players').send({ name: 'Skill Tester' });
  const game = await request(app).post('/api/games').send({ name: 'Skill Test Game' });
  playerId = player.body.id;
  gameId = game.body.id;
  assert.ok(playerId && gameId);
});

test('PUT /api/skills rejects an out-of-range rating', async () => {
  const res = await request(app).put('/api/skills').send({ playerId, gameId, rating: 6 });
  assert.equal(res.status, 400);
});

test('PUT /api/skills rejects an invalid session identity', async () => {
  const res = await request(app)
    .put('/api/skills')
    .send({ playerId: 'ghost', gameId, rating: 5 });
  assert.equal(res.status, 401);
});

test('PUT /api/skills creates a rating', async () => {
  const res = await request(app).put('/api/skills').send({ playerId, gameId, rating: 0 });
  assert.equal(res.status, 200);
  assert.equal(res.body.rating, 0);
});

test('PUT /api/skills upserts (updates) the same rating', async () => {
  const res = await request(app).put('/api/skills').send({ playerId, gameId, rating: 4 });
  assert.equal(res.status, 200);

  const list = await request(app).get(`/api/skills?playerId=${playerId}`);
  assert.equal(list.body.length, 1);
  assert.equal(list.body[0].rating, 4);
});

test('GET /api/skills filters by gameId', async () => {
  const res = await request(app).get(`/api/skills?gameId=${gameId}`);
  assert.equal(res.status, 200);
  assert.ok(res.body.some((s: { player_id: string }) => s.player_id === playerId));
});

test('DELETE /api/skills/:playerId/:gameId clears the rating', async () => {
  const res = await request(app).delete(`/api/skills/${playerId}/${gameId}`);
  assert.equal(res.status, 204);

  const list = await request(app).get(`/api/skills?playerId=${playerId}`);
  assert.equal(list.body.length, 0);
});

test('DELETE /api/skills/:playerId/:gameId 404s when already gone', async () => {
  const res = await request(app).delete(`/api/skills/${playerId}/${gameId}`);
  assert.equal(res.status, 404);
});


function bonusSource(eventId: string, playerId: string) {
  return { groupId: DEFAULT_GROUP_ID, eventId, playerId, account: 'orga' as const, sourceKey: SKILL_BONUS_SOURCE };
}
function catalogIds(): string[] {
  return (
    db
      .prepare("SELECT id FROM games WHERE group_id = ? AND status = 'catalog' AND arcade_key IS NULL ORDER BY id")
      .all(DEFAULT_GROUP_ID) as Array<{ id: string }>
  ).map((game) => game.id);
}
function bonusEvent(name: string) {
  return createEvent(name, { groupId: DEFAULT_GROUP_ID, startsAt: Date.now() + 86400000, endsAt: null });
}

test('complete catalog skills grant five points once, survive data changes and respect manual deductions', async () => {
  const player = (await request(app).post('/api/players').send({ name: 'Permanent Skill bonus' })).body.id;
  const event = bonusEvent('Skill bonus permanence');
  setParticipants(event.id, [TEST_ADMIN_ID, player]);
  const suggestion = await request(app)
    .post('/api/games')
    .send({ name: 'Unrated Skill proposal', status: 'suggestion' });
  assert.equal(suggestion.status, 201);
  const games = catalogIds();
  assert.ok(games.length > 1);
  for (const gameId of games.slice(0, -1))
    assert.equal((await request(app).put('/api/skills').send({ playerId: player, gameId, rating: 0 })).status, 200);
  const source = bonusSource(event.id, player);
  assert.deepEqual(readPointsSource(source), { total: 0, revision: 0 }, 'missing one catalog entry is incomplete');
  const last = games[games.length - 1];
  db.exec(`CREATE TEMP TRIGGER fail_skill_bonus BEFORE INSERT ON points_journal
    WHEN EXISTS(SELECT 1 FROM points_sources s WHERE s.id = NEW.source_id AND s.source_key = 'bonus:skills')
    BEGIN SELECT RAISE(ABORT, 'test Skill bonus failure'); END;`);
  try {
    assert.equal(
      (await request(app).put('/api/skills').send({ playerId: player, gameId: last, rating: 0 })).status,
      500,
    );
    assert.equal(
      db.prepare('SELECT 1 FROM skills WHERE player_id = ? AND game_id = ?').get(player, last),
      undefined,
      'rating and bonus commit together',
    );
  } finally {
    db.exec('DROP TRIGGER fail_skill_bonus');
  }
  const completed = await Promise.all(
    [0, 1].map(() => request(app).put('/api/skills').send({ playerId: player, gameId: last, rating: 0 })),
  );
  assert.deepEqual(
    completed.map((res) => res.status),
    [200, 200],
  );
  assert.deepEqual(readPointsSource(source), { total: 5, revision: 1 }, 'never played (0) is a valid assessment');
  assert.equal(readPointsBalances(DEFAULT_GROUP_ID, event.id, player)!.wallet, 0);
  const journal = readPointsJournal(DEFAULT_GROUP_ID, event.id, player);
  assert.equal(journal.length, 1);
  assert.match(journal[0].title, new RegExp(`${games.length} Katalogspiele`));
  assert.equal(
    syncOrgaPoints(DEFAULT_GROUP_ID, event.id),
    false,
    'regular Orga reconciliation retains the permanent bonus',
  );
  assert.equal(
    (
      await request(app)
        .post(`/api/points/admin/journal/${journal[0].id}/correct?eventId=${event.id}`)
        .send({ total: 0, revision: 1, reason: 'Skill-Bonus begründet entzogen' })
    ).status,
    200,
  );
  const removed = await Promise.all([0, 1].map(() => request(app).delete(`/api/skills/${player}/${games[0]}`)));
  assert.deepEqual(removed.map((res) => res.status).sort(), [204, 404]);
  const extra = await request(app).post('/api/games').send({ name: 'Added after Skill bonus' });
  assert.equal(extra.status, 201);
  assert.deepEqual(readPointsSource(source), { total: 0, revision: 2 });
  for (const gameId of [games[0], extra.body.id])
    assert.equal((await request(app).put('/api/skills').send({ playerId: player, gameId, rating: 5 })).status, 200);
  backfillCompetitionPoints();
  backfillCompetitionPoints();
  assert.deepEqual(
    readPointsSource(source),
    { total: 0, revision: 2 },
    're-completing, higher ratings and restarts never repay a deducted bonus',
  );
  const second = createEvent('Creator Skill bonus', {
    groupId: DEFAULT_GROUP_ID,
    createdBy: player,
    startsAt: Date.now() + 86400000,
    endsAt: null,
  });
  assert.deepEqual(
    readPointsSource(bonusSource(second.id, player)),
    { total: 5, revision: 1 },
    'existing assessments count for a new creator participation',
  );
  const third = bonusEvent('Roster Skill bonus');
  const rosters = await Promise.all(
    [0, 1].map(() =>
      request(app)
        .put(`/api/events/${third.id}/participants`)
        .send({ playerIds: [TEST_ADMIN_ID, player] }),
    ),
  );
  assert.deepEqual(
    rosters.map((res) => res.status),
    [200, 200],
  );
  assert.deepEqual(readPointsSource(bonusSource(third.id, player)), { total: 5, revision: 1 });
  assert.equal(
    (
      await request(app)
        .put(`/api/events/${third.id}/participants`)
        .send({ playerIds: [TEST_ADMIN_ID] })
    ).status,
    200,
  );
  assert.deepEqual(
    readPointsSource(bonusSource(third.id, player)),
    { total: 5, revision: 1 },
    'roster changes retain an already earned bonus',
  );
  assert.equal(readPointsSource({ ...source, groupId: 'foreign-group' }), undefined);
});

test('catalog removal can complete a profile and later catalog growth never withdraws or duplicates a bonus', async () => {
  const player = (await request(app).post('/api/players').send({ name: 'Catalog Skill bonus' })).body.id;
  const a = await request(app).post('/api/games').send({ name: 'Skill missing A' });
  const b = await request(app).post('/api/games').send({ name: 'Skill missing B' });
  const event = bonusEvent('Skill catalog changes');
  setParticipants(event.id, [TEST_ADMIN_ID, player]);
  for (const gameId of catalogIds().filter((id) => id !== a.body.id && id !== b.body.id))
    assert.equal((await request(app).put('/api/skills').send({ playerId: player, gameId, rating: 1 })).status, 200);
  const source = bonusSource(event.id, player);
  const demoted = await Promise.all([0, 1].map(() => request(app).post(`/api/games/${a.body.id}/demote`)));
  assert.deepEqual(demoted.map((res) => res.status).sort(), [200, 409]);
  assert.deepEqual(readPointsSource(source), { total: 0, revision: 0 });
  const deleted = await Promise.all([0, 1].map(() => request(app).delete(`/api/games/${b.body.id}`)));
  assert.deepEqual(deleted.map((res) => res.status).sort(), [204, 404]);
  assert.deepEqual(
    readPointsSource(source),
    { total: 5, revision: 1 },
    'removing the final missing game completes the catalog',
  );
  const promoted = await Promise.all([0, 1].map(() => request(app).post(`/api/games/${a.body.id}/promote`)));
  assert.deepEqual(promoted.map((res) => res.status).sort(), [200, 409]);
  assert.deepEqual(readPointsSource(source), { total: 5, revision: 1 });
  const added = await Promise.all(
    [0, 1].map(() => request(app).post('/api/games').send({ name: 'Duplicate Skill catalog insert' })),
  );
  assert.deepEqual(added.map((res) => res.status).sort(), [201, 409]);
  assert.deepEqual(readPointsSource(source), { total: 5, revision: 1 });
  assert.equal(syncOrgaPoints(DEFAULT_GROUP_ID, event.id), false);
});

test('existing assessments backfill on reopening and accepting an invitation grants atomically', async () => {
  const player = (await request(app).post('/api/players').send({ name: 'Skill backfill attendee' })).body.id;
  const event = bonusEvent('Closed Skill bonus');
  setParticipants(event.id, [TEST_ADMIN_ID, player]);
  const games = catalogIds();
  // An empty catalog is not completed work. Restore the isolated fixture before continuing.
  db.prepare("UPDATE games SET status = 'suggestion' WHERE group_id = ? AND status = 'catalog'").run(DEFAULT_GROUP_ID);
  try {
    assert.equal(grantSkillCompletionBonus(event.id), false);
  } finally {
    for (const gameId of games) db.prepare("UPDATE games SET status = 'catalog' WHERE id = ?").run(gameId);
  }
  assert.equal((await request(app).post(`/api/points/close?eventId=${event.id}`)).status, 200);
  for (const gameId of games)
    db.prepare('INSERT INTO skills(player_id,game_id,group_id,rating) VALUES (?, ?, ?, 0)').run(
      player,
      gameId,
      DEFAULT_GROUP_ID,
    );
  const source = bonusSource(event.id, player);
  backfillCompetitionPoints();
  assert.deepEqual(readPointsSource(source), { total: 0, revision: 0 }, 'final valuation stays frozen');
  const reopened = await Promise.all(
    [0, 1].map(() =>
      request(app).post(`/api/points/reopen?eventId=${event.id}`).send({ reason: 'Vollständige Skills nachtragen' }),
    ),
  );
  assert.deepEqual(reopened.map((res) => res.status).sort(), [200, 409]);
  assert.deepEqual(readPointsSource(source), { total: 5, revision: 1 });
  const invitation = bonusEvent('Invited Skill bonus');
  assert.equal(
    (
      await request(app)
        .post(`/api/events/${invitation.id}/invitations`)
        .set('x-test-player-id', TEST_ADMIN_ID)
        .send({ playerId: player })
    ).status,
    201,
  );
  db.exec(`CREATE TEMP TRIGGER fail_skill_acceptance BEFORE INSERT ON points_journal
    WHEN EXISTS(SELECT 1 FROM points_sources s WHERE s.id = NEW.source_id AND s.source_key = 'bonus:skills')
    BEGIN SELECT RAISE(ABORT, 'test Skill acceptance failure'); END;`);
  try {
    assert.equal(
      (await request(app).post(`/api/events/${invitation.id}/invitation/accept`).set('x-test-player-id', player))
        .status,
      500,
    );
    assert.equal(
      (
        db
          .prepare('SELECT status FROM event_participants WHERE event_id = ? AND player_id = ?')
          .get(invitation.id, player) as { status: string }
      ).status,
      'invited',
    );
    const count = (db.prepare('SELECT COUNT(*) AS n FROM events').get() as { n: number }).n;
    assert.throws(
      () =>
        createEvent('Failed Skill creator', {
          groupId: DEFAULT_GROUP_ID,
          createdBy: player,
          startsAt: Date.now() + 86400000,
          endsAt: null,
        }),
      /test Skill acceptance failure/,
    );
    assert.equal((db.prepare('SELECT COUNT(*) AS n FROM events').get() as { n: number }).n, count);
    assert.throws(() => setParticipants(invitation.id, [player]), /test Skill acceptance failure/);
    assert.equal(
      (
        db
          .prepare('SELECT status FROM event_participants WHERE event_id = ? AND player_id = ?')
          .get(invitation.id, player) as { status: string }
      ).status,
      'invited',
      'roster update and bonus roll back together',
    );
    // Legacy accepted participation with complete ratings but no grant yet.
    db.prepare("UPDATE event_participants SET status = 'accepted' WHERE event_id = ? AND player_id = ?").run(
      invitation.id,
      player,
    );
    try {
      const beforeGames = catalogIds();
      assert.equal((await request(app).post('/api/games').send({ name: 'Failed Skill catalog addition' })).status, 500);
      assert.deepEqual(catalogIds(), beforeGames, 'catalog insertion and captured eligibility roll back together');
      assert.equal((await request(app).delete(`/api/skills/${player}/${games[0]}`)).status, 500);
      assert.ok(
        db.prepare('SELECT 1 FROM skills WHERE player_id = ? AND game_id = ?').get(player, games[0]),
        'rating deletion rolls back when its first bonus cannot be granted',
      );
    } finally {
      db.prepare("UPDATE event_participants SET status = 'invited' WHERE event_id = ? AND player_id = ?").run(
        invitation.id,
        player,
      );
    }
  } finally {
    db.exec('DROP TRIGGER fail_skill_acceptance');
  }
  const accepted = await Promise.all(
    [0, 1].map(() =>
      request(app).post(`/api/events/${invitation.id}/invitation/accept`).set('x-test-player-id', player),
    ),
  );
  assert.deepEqual(
    accepted.map((res) => res.status),
    [200, 200],
  );
  assert.deepEqual(readPointsSource(bonusSource(invitation.id, player)), { total: 5, revision: 1 });
  assert.equal(readPointsSource(bonusSource('unknown-event', player)), undefined);
  assert.equal(grantSkillCompletionBonus('unknown-event'), false);
});
