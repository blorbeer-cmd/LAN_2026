import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nanoid } from 'nanoid';
import { config } from './config';
import { BASE_EVENT_ID, db, DEFAULT_GROUP_ID } from './db';
import { previewPrivacyRetention, runPrivacyRetention } from './privacyRetention';

test('retention preview is non-destructive and enabled cleanup is bounded, repeatable and protects active work', () => {
  const now = Date.now();
  const prefix = `retention-${nanoid()}`;
  const playerId = `${prefix}-player`;
  const endedEventId = `${prefix}-ended-event`;
  const gameId = (db.prepare('SELECT id FROM games WHERE group_id = ? LIMIT 1').get(DEFAULT_GROUP_ID) as { id: string }).id;
  db.prepare('INSERT INTO players (id, name, api_key, created_at) VALUES (?, ?, ?, ?)').run(playerId, playerId, `${prefix}-key`, now);
  db.prepare(
    `INSERT INTO group_memberships
       (group_id, player_id, role, status, joined_at, outside_tracking_enabled)
     VALUES (?, ?, 'member', 'active', ?, 0)`,
  ).run(DEFAULT_GROUP_ID, playerId, now);
  db.prepare(
    `INSERT INTO events (id, name, starts_at, ends_at, tracking_enabled, ended_at, group_id, status)
     VALUES (?, ?, ?, ?, 0, ?, ?, 'ended')`,
  ).run(endedEventId, endedEventId, now - 900 * 86_400_000, now - 899 * 86_400_000, now - 899 * 86_400_000, DEFAULT_GROUP_ID);
  for (let index = 0; index < 2; index += 1) {
    db.prepare('INSERT INTO agent_diagnostics (player_id, last_report_at, process_names) VALUES (?, ?, ?) ON CONFLICT(player_id) DO UPDATE SET last_report_at = excluded.last_report_at')
      .run(playerId, now - (10 + index) * 86_400_000, '[]');
    db.prepare(
      `INSERT INTO push_log (id, group_id, event_id, title, body, audience, player_ids, resolved_at, created_at)
       VALUES (?, ?, ?, 'Alt', 'Alt', 'direct', '[]', ?, ?)`,
    ).run(`${prefix}-push-${index}`, DEFAULT_GROUP_ID, BASE_EVENT_ID, now - 100 * 86_400_000, now - 100 * 86_400_000 - index);
    db.prepare(
      `INSERT INTO admin_log (id, action, target_type, created_at)
       VALUES (?, 'old_action', 'test', ?)`,
    ).run(`${prefix}-audit-${index}`, now - 400 * 86_400_000 - index);
    db.prepare(
      `INSERT INTO play_sessions (id, player_id, game_id, event_id, started_at, ended_at, group_id)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).run(`${prefix}-session-${index}`, playerId, gameId, endedEventId, now - 800 * 86_400_000, now - 799 * 86_400_000 - index, DEFAULT_GROUP_ID);
    db.prepare(
      `INSERT INTO sessions (id, player_id, token_hash, created_at, last_seen_at, expires_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run(`${prefix}-auth-${index}`, playerId, `${prefix}-hash-${index}`, now - 10_000, now - 10_000, now - 1_000 - index);
  }
  db.prepare(
    `INSERT INTO push_log (id, group_id, event_id, title, body, audience, player_ids, resolved_at, expires_at, created_at)
     VALUES (?, ?, ?, 'Offen', 'Bleibt', 'direct', '[]', NULL, ?, ?)`,
  ).run(`${prefix}-active-push`, DEFAULT_GROUP_ID, BASE_EVENT_ID, now + 86_400_000, now - 100 * 86_400_000);
  db.prepare(
    `INSERT INTO broadcasts
       (id, group_id, event_id, player_id, player_name_snapshot, message, ends_at, ended_at, recipient_ids, created_at)
     VALUES (?, ?, ?, ?, ?, 'Alt', ?, ?, '[]', ?)`,
  ).run(
    `${prefix}-broadcast`,
    DEFAULT_GROUP_ID,
    BASE_EVENT_ID,
    playerId,
    playerId,
    now - 200 * 86_400_000,
    now - 200 * 86_400_000,
    now - 200 * 86_400_000,
  );
  db.prepare(
    `INSERT INTO feedback_entries
       (id, group_id, event_id, player_id, view, sentiment, message, device, created_at, resolved_at)
     VALUES (?, ?, ?, ?, 'profile', 'idea', 'Alt', 'desktop', ?, ?)`,
  ).run(
    `${prefix}-feedback`,
    DEFAULT_GROUP_ID,
    BASE_EVENT_ID,
    playerId,
    now - 400 * 86_400_000,
    now - 400 * 86_400_000,
  );
  db.prepare(
    `INSERT INTO play_sessions (id, player_id, game_id, event_id, started_at, ended_at, group_id)
     VALUES (?, ?, ?, ?, ?, NULL, ?)`,
  ).run(`${prefix}-active-play`, playerId, gameId, BASE_EVENT_ID, now - 900 * 86_400_000, DEFAULT_GROUP_ID);
  db.prepare(
    `INSERT INTO admin_log (id, action, target_type, details, created_at)
     VALUES (?, 'player_self_deleted', 'deleted_account', ?, ?)`,
  ).run(`${prefix}-deletion-receipt`, JSON.stringify({ subjectHash: 'a'.repeat(64) }), now - 800 * 86_400_000);

  const mutable = config.privacyRetention as unknown as { enabled: boolean; batchSize: number };
  const previous = { enabled: mutable.enabled, batchSize: mutable.batchSize };
  mutable.enabled = true;
  mutable.batchSize = 1;
  try {
    const preview = previewPrivacyRetention(now);
    assert.equal(preview.policies.find((policy) => policy.key === 'resolved_push')!.candidateCount >= 2, true);
    assert.ok(db.prepare('SELECT 1 FROM push_log WHERE id = ?').get(`${prefix}-push-0`), 'preview does not delete');

    const first = runPrivacyRetention(now);
    assert.equal(first.resolvedPush, 1);
    assert.equal(first.endedBroadcasts, 1);
    assert.equal(first.resolvedFeedback, 1);
    assert.equal(first.adminAudit, 1);
    assert.equal(first.endedPlaySessions, 1);
    assert.equal(first.expiredSessions, 1);
    const second = runPrivacyRetention(now);
    assert.equal(second.resolvedPush, 1);
    assert.equal(second.adminAudit, 1);
    assert.equal(second.endedPlaySessions, 1);
    assert.equal(second.expiredSessions, 1);
    assert.ok(db.prepare('SELECT 1 FROM push_log WHERE id = ?').get(`${prefix}-active-push`));
    assert.ok(db.prepare('SELECT 1 FROM play_sessions WHERE id = ?').get(`${prefix}-active-play`));
    assert.equal(db.prepare('SELECT 1 FROM broadcasts WHERE id = ?').get(`${prefix}-broadcast`), undefined);
    assert.equal(db.prepare('SELECT 1 FROM feedback_entries WHERE id = ?').get(`${prefix}-feedback`), undefined);
    assert.ok(
      db.prepare('SELECT 1 FROM admin_log WHERE id = ?').get(`${prefix}-deletion-receipt`),
      'restore deletion receipts are protected from automatic audit cleanup',
    );
    assert.equal(runPrivacyRetention(now).resolvedPush, 0, 'a completed sweep is safe to repeat');
  } finally {
    mutable.enabled = previous.enabled;
    mutable.batchSize = previous.batchSize;
  }
});
