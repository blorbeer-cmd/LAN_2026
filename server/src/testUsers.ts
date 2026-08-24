// Admin test-user seeding: creates players flagged is_test = 1 that come
// fully "lived in" — seated in the table plan (which derives their visible
// monitors through the same auto-neighbor sync the editor uses), with random
// skill/Bock ratings per game, finished play sessions for the tracking event,
// and a couple of them showing up as currently playing on the live board.
// The whole seed runs in one better-sqlite3 transaction, so two admins
// clicking at once serialize cleanly instead of double-booking seats.
//
// The frontend hides is_test players outside admin mode (see
// public/js/testFilter.js). Aggregate read paths additionally exclude them
// server-side because a browser cannot remove their contribution after a
// query has already grouped away the player id.

import { nanoid } from 'nanoid';
import { BASE_EVENT_ID, db, DEFAULT_GROUP_ID } from './db';
import { addPlayersToLayout, removePlayersFromLayouts } from './seatingLayout';
import { ensureAccountEventContext } from './eventContext';
import { setEventTrackingConsent } from './trackingContexts';
import { EVENT_TYPE_PRESETS } from './eventFeatureCatalog';
import { createEventFeatureSnapshot } from './eventFeatures';

// Avatar color palette for generated players (single source of truth since
// the profile editor moved to a free color picker without presets). Six of
// the eight reuse the app's semantic accent/state colors (--accent,
// --accent-2, --accent-3, --state-playing, --state-paused, --danger in
// public/css/style.css) so a generated color never introduces a hue that
// means something different elsewhere; cyan and lime are variety-only.
const COLORS = ['#5b8cff', '#9163f5', '#ef5da8', '#22c55e', '#f59e0b', '#ef4444', '#06b6d4', '#84cc16'];

const NAME_POOL = [
  'Test Alex',
  'Test Kim',
  'Test Sam',
  'Test Mika',
  'Test Toni',
  'Test Charlie',
  'Test Robin',
  'Test Luca',
  'Test Nico',
  'Test Jona',
  'Test Kai',
  'Test Sascha',
  'Test Jamie',
  'Test Chris',
  'Test Deniz',
  'Test Elia',
  'Test Finn',
  'Test Noa',
  'Test Rene',
  'Test Yuki',
];

export const MAX_TEST_USERS_PER_CALL = 20;

const HOUR_MS = 60 * 60 * 1000;
const MINUTE_MS = 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

const TEST_EVENT_TEMPLATES = [
  {
    name: 'Test-LAN',
    eventTypeKey: 'lan',
    startsAfterMs: 7 * DAY_MS,
    durationMs: 3 * DAY_MS,
    location: 'Testlocation LAN',
    description: 'Admin-Testevent für einen vollständigen LAN-Ablauf.',
  },
  {
    name: 'Allgemeines Testevent',
    eventTypeKey: 'general',
    startsAfterMs: 2 * DAY_MS,
    durationMs: 4 * HOUR_MS,
    location: 'Testlocation Allgemein',
    description: 'Admin-Testevent für eine allgemeine Veranstaltung.',
  },
] as const;

function randInt(min: number, max: number): number {
  return min + Math.floor(Math.random() * (max - min + 1));
}

function clampRating(value: number): number {
  return Math.min(10, Math.max(1, value));
}

interface GameRow {
  id: string;
}

interface CreatedTestUser {
  id: string;
  name: string;
}

// Picks a free name from the pool, falling back to a numbered suffix when a
// pool name (or a previous batch) already took it.
function pickName(taken: Set<string>): string {
  for (const candidate of NAME_POOL) {
    if (!taken.has(candidate.toLowerCase())) return candidate;
  }
  for (let n = 2; ; n++) {
    const candidate = `${NAME_POOL[randInt(0, NAME_POOL.length - 1)]} ${n}`;
    if (!taken.has(candidate.toLowerCase())) return candidate;
  }
}

function ensureTestEvents(ownerGroupId: string, now: number): void {
  const findEvent = db.prepare('SELECT id, schedule_revision FROM events WHERE group_id = ? AND is_test = 1 AND name = ?');
  const insertEvent = db.prepare(
    `INSERT INTO events
      (id, name, starts_at, ends_at, location, description, tracking_enabled, ended_at,
        is_test, group_id, status, visibility_scope, event_type_key, preset_version, schedule_revision)
     VALUES (?, ?, ?, ?, ?, ?, 0, NULL, 1, ?, 'published', 'participants', ?, ?, 1)`,
  );
  const insertParticipant = db.prepare(
    `INSERT INTO event_participants (event_id, player_id, status, confirmed_schedule_revision)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(event_id, player_id) DO UPDATE SET
       status = excluded.status,
       confirmed_schedule_revision = excluded.confirmed_schedule_revision`,
  );
  const testPlayers = db
    .prepare(
      `SELECT p.id
       FROM players p
       JOIN group_memberships gm ON gm.player_id = p.id
       WHERE p.is_test = 1 AND p.test_owner_group_id = ?
         AND gm.group_id = ? AND gm.status = 'active'
       ORDER BY p.created_at, p.id`,
    )
    .all(ownerGroupId, ownerGroupId) as Array<{ id: string }>;

  TEST_EVENT_TEMPLATES.forEach((template, eventIndex) => {
    let event = findEvent.get(ownerGroupId, template.name) as
      | { id: string; schedule_revision: number }
      | undefined;
    if (!event) {
      const id = nanoid();
      const startsAt = now + template.startsAfterMs;
      insertEvent.run(
        id,
        template.name,
        startsAt,
        startsAt + template.durationMs,
        template.location,
        template.description,
        ownerGroupId,
        template.eventTypeKey,
        EVENT_TYPE_PRESETS[template.eventTypeKey].version,
      );
      createEventFeatureSnapshot(id, template.eventTypeKey, null);
      event = { id, schedule_revision: 1 };
    }

    testPlayers.forEach((player, playerIndex) => {
      const status = (playerIndex + eventIndex) % 2 === 0 ? 'accepted' : 'invited';
      insertParticipant.run(
        event!.id,
        player.id,
        status,
        status === 'accepted' ? event!.schedule_revision : null,
      );
    });
  });
}

export function createTestUsers(
  count: number,
  ownerGroupId = DEFAULT_GROUP_ID,
  eventId = BASE_EVENT_ID,
): CreatedTestUser[] {
  const seed = db.transaction((): CreatedTestUser[] => {
    const now = Date.now();
    const seatingEventId = eventId;
    // Arcade titles (quiz/tetris/...) are excluded here just like in
    // GET /api/games — they aren't skill-rated or vote-eligible, see
    // routes/games.ts's arcade_key filter. Scoped to the owning group's own
    // catalog, same as every other group-owned read.
    const games = db.prepare('SELECT id FROM games WHERE arcade_key IS NULL AND group_id = ?').all(ownerGroupId) as GameRow[];
    const takenNames = new Set(
      (db.prepare('SELECT name FROM players').all() as Array<{ name: string }>).map((r) => r.name.toLowerCase()),
    );

    const insertPlayer = db.prepare(
      // Test identities never carry real admin privileges. Admins can act as
      // them later without leaking their own role into the test account.
      `INSERT INTO players
         (id, name, color, avatar, api_key, tracking_paused, is_admin, is_test, test_owner_group_id, created_at)
       VALUES (?, ?, ?, ?, ?, 0, 0, 1, ?, ?)`,
    );
    const insertMembership = db.prepare(
      `INSERT INTO group_memberships
         (group_id, player_id, role, status, joined_at, ended_at, outside_tracking_enabled, invited_by)
       VALUES (?, ?, 'member', 'active', ?, NULL, 0, NULL)`,
    );
    const insertSkill = db.prepare('INSERT INTO skills (player_id, game_id, group_id, rating) VALUES (?, ?, ?, ?)');
    const insertPreference = db.prepare('INSERT INTO preferences (player_id, game_id, group_id, rating) VALUES (?, ?, ?, ?)');
    const insertSession = db.prepare(
      'INSERT INTO play_sessions (id, player_id, game_id, group_id, event_id, started_at, ended_at, active_ms) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    );
    const insertLiveStatus = db.prepare(
      `INSERT INTO tracking_live_contexts
         (player_id, group_id, event_id, last_seen, manual_note, activity_tracked)
       VALUES (?, ?, ?, ?, NULL, 0)
       ON CONFLICT(player_id, group_id, event_id) DO UPDATE SET last_seen = excluded.last_seen`,
    );
    const insertLiveGame = db.prepare(
      `INSERT OR IGNORE INTO tracking_live_games
         (player_id, group_id, event_id, game_id, since, is_foreground)
       VALUES (?, ?, ?, ?, ?, 1)`,
    );

    const created: CreatedTestUser[] = [];
    const existingTestCount = (db.prepare('SELECT COUNT(*) AS n FROM players WHERE is_test = 1').get() as { n: number })
      .n;

    for (let i = 0; i < count; i++) {
      const id = nanoid();
      const name = pickName(takenNames);
      takenNames.add(name.toLowerCase());
      const color = COLORS[(existingTestCount + i) % COLORS.length];
      insertPlayer.run(id, name, color, null, nanoid(24), ownerGroupId, now);
      insertMembership.run(ownerGroupId, id, now);
      ensureAccountEventContext(id, eventId);
      setEventTrackingConsent(eventId, ownerGroupId, id, true, now);
      created.push({ id, name });

      // Bock loosely follows skill (people usually feel like playing what
      // they're good at) — pure noise reads fake in the voting view.
      const bockByGame = new Map<string, number>();
      for (const game of games) {
        const skill = randInt(1, 10);
        const bock = clampRating(skill + randInt(-3, 3));
        insertSkill.run(id, game.id, ownerGroupId, skill);
        insertPreference.run(id, game.id, ownerGroupId, bock);
        bockByGame.set(game.id, bock);
      }

      // 2-4 finished sessions over the last ~12h, biased toward the games
      // this user has the most Bock for, walking backwards in time so a
      // single player's sessions never overlap each other.
      if (games.length > 0) {
        const favorites = [...bockByGame.entries()].sort((a, b) => b[1] - a[1]).map(([gameId]) => gameId);
        let cursor = now - randInt(5, 45) * MINUTE_MS;
        const sessionCount = randInt(2, 4);
        for (let s = 0; s < sessionCount; s++) {
          const gameId = favorites[randInt(0, Math.min(2, favorites.length - 1))];
          const durationMs = randInt(20, 120) * MINUTE_MS;
          const endedAt = cursor;
          const startedAt = endedAt - durationMs;
          if (startedAt < now - 12 * HOUR_MS) break;
          const activeMs = Math.round((durationMs * randInt(60, 95)) / 100);
          insertSession.run(nanoid(), id, gameId, ownerGroupId, eventId, startedAt, endedAt, activeMs);
          cursor = startedAt - randInt(10, 60) * MINUTE_MS;
        }
      }

      // The first two of each batch show up as "spielt gerade": an open
      // session plus a live row seen just now. They flip to offline after
      // the normal agent timeout — exactly the real mechanism.
      if (i < 2 && games.length > 0) {
        const gameId = [...bockByGame.entries()].sort((a, b) => b[1] - a[1])[0][0];
        const since = now - randInt(10, 30) * MINUTE_MS;
        insertSession.run(nanoid(), id, gameId, ownerGroupId, eventId, since, null, 0);
        insertLiveStatus.run(id, ownerGroupId, eventId, now);
        insertLiveGame.run(id, ownerGroupId, eventId, gameId, since);
      }
    }

    // Seat everyone; persistLayout inside re-derives the auto seat neighbors
    // ("Sichtbare Monitore") exactly like the interactive editor would.
    addPlayersToLayout(
      ownerGroupId,
      seatingEventId,
      created.map((c) => c.id),
    );

    // One extra manual pair (if two seeded users exist) so the auto/manual
    // distinction in the neighbors UI has data to show too.
    if (created.length >= 2) {
      const insertManual = db.prepare(
        `INSERT OR IGNORE INTO seat_neighbors
           (group_id, event_id, player_id, neighbor_id, player_name_snapshot, neighbor_name_snapshot, source)
         VALUES (?, ?, ?, ?, ?, ?, 'manual')`,
      );
      const [a, b] = [created[0], created[created.length - 1]];
      insertManual.run(ownerGroupId, seatingEventId, a.id, b.id, a.name, b.name);
      insertManual.run(ownerGroupId, seatingEventId, b.id, a.id, b.name, a.name);
    }

    // Two realistic event cards exercise both the LAN and the general-event
    // workflows. Every test identity is accepted to one and still invited to
    // the other, so both states stay visible without touching real accounts.
    ensureTestEvents(ownerGroupId, now);

    return created;
  });
  return seed();
}

// Deletes every test user; FK cascades clean up their skills, Bock ratings,
// sessions, live status, and seat_neighbors, while the layout assignments
// (JSON, no FK) are pruned explicitly with an auto-neighbor re-sync.
export function deleteTestUsers(ownerGroupId?: string): number {
  const cleanup = db.transaction((): number => {
    const rows = (
      ownerGroupId
        ? db.prepare('SELECT id FROM players WHERE is_test = 1 AND test_owner_group_id = ?').all(ownerGroupId)
        : db.prepare('SELECT id FROM players WHERE is_test = 1').all()
    ) as Array<{ id: string }>;
    const ids = rows.map((row) => row.id);
    if (ids.length === 0) return 0;
    removePlayersFromLayouts(new Set(ids));
    const placeholders = ids.map(() => '?').join(',');
    db.prepare(`DELETE FROM players WHERE id IN (${placeholders})`).run(...ids);
    return ids.length;
  });
  return cleanup();
}

export function countTestUsers(ownerGroupId?: string): number {
  const row = ownerGroupId
    ? db.prepare('SELECT COUNT(*) AS n FROM players WHERE is_test = 1 AND test_owner_group_id = ?').get(ownerGroupId)
    : db.prepare('SELECT COUNT(*) AS n FROM players WHERE is_test = 1').get();
  return (row as { n: number }).n;
}
