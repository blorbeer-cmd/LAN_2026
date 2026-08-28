// Real OS-level push notifications (Web Push), on top of the in-app socket
// toasts: those only reach a phone whose browser tab is open and connected,
// which misses the whole point of "ping everyone right now" while people are
// away from the app. VAPID keys are generated once and stored in app_state,
// so no manual setup/config file is needed (CLAUDE.md: no secrets in the
// repo, but a locally-generated keypair in the gitignored DB file is fine).

import { nanoid } from 'nanoid';
import webpush from 'web-push';
import { BASE_EVENT_ID, db, DEFAULT_GROUP_ID, getState, setState } from './db';
import { broadcast, Events } from './realtime';
import { ACCEPTED_EVENT_PARTICIPANT_SQL } from './eventParticipation';

// Only recent entries matter (the Kiosk shows the latest one, the personal
// notification center a short list) - trimmed on every insert so this never
// grows unbounded over a multi-day LAN party.
const PUSH_LOG_LIMIT = 50;

const VAPID_PUBLIC_KEY = 'vapid_public_key';
const VAPID_PRIVATE_KEY = 'vapid_private_key';

function ensureVapidKeys(): { publicKey: string; privateKey: string } {
  const existingPublic = getState(VAPID_PUBLIC_KEY);
  const existingPrivate = getState(VAPID_PRIVATE_KEY);
  if (existingPublic && existingPrivate) return { publicKey: existingPublic, privateKey: existingPrivate };

  const generated = webpush.generateVAPIDKeys();
  setState(VAPID_PUBLIC_KEY, generated.publicKey);
  setState(VAPID_PRIVATE_KEY, generated.privateKey);
  return generated;
}

const vapidKeys = ensureVapidKeys();
webpush.setVapidDetails('mailto:admin@respawn.local', vapidKeys.publicKey, vapidKeys.privateKey);

export function getVapidPublicKey(): string {
  return vapidKeys.publicKey;
}

// Indirection so tests can stub out the actual network call instead of
// hitting real push services (FCM/Mozilla/etc.) with fake subscriptions.
export const pushTransport = {
  send: webpush.sendNotification.bind(webpush),
};

interface SubscriptionInput {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}

export function isValidSubscription(sub: unknown): sub is SubscriptionInput {
  if (!sub || typeof sub !== 'object') return false;
  const s = sub as Record<string, unknown>;
  if (typeof s.endpoint !== 'string' || !s.endpoint) return false;
  const keys = s.keys as Record<string, unknown> | undefined;
  return Boolean(keys && typeof keys.p256dh === 'string' && typeof keys.auth === 'string');
}

// Upserts by endpoint: the same browser re-subscribing (or subscribing under
// a different "who am I") just re-points the existing row rather than
// piling up duplicates.
export function saveSubscription(playerId: string, sub: SubscriptionInput): void {
  db.prepare(
    `INSERT INTO push_subscriptions (id, player_id, endpoint, p256dh, auth, created_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(endpoint) DO UPDATE SET player_id = excluded.player_id, p256dh = excluded.p256dh, auth = excluded.auth`
  ).run(nanoid(), playerId, sub.endpoint, sub.keys.p256dh, sub.keys.auth, Date.now());
}

export function removeSubscription(endpoint: string, playerId?: string): void {
  if (playerId) {
    db.prepare('DELETE FROM push_subscriptions WHERE endpoint = ? AND player_id = ?').run(endpoint, playerId);
    return;
  }
  db.prepare('DELETE FROM push_subscriptions WHERE endpoint = ?').run(endpoint);
}

export interface PushPayload {
  title: string;
  body: string;
  url?: string;
  type?: string;
  targetId?: string;
}

export interface PushTopic {
  key: string;
  expiresAt?: number | null;
}

export const FOOD_ORDER_PAYMENT_REMINDER_TOPIC_PREFIX = 'food-order-payment-reminder:';
export const EVENT_POLL_REMINDER_TOPIC_PREFIX = 'event-poll-reminder:';
export const EVENT_REMINDER_TOPIC_PREFIX = 'event-reminder:';
export const EVENT_POLL_OPEN_TOPIC_PREFIX = 'event-poll-open:';

export function isDeduplicatedPushTopic(topicKey: string): boolean {
  return (
    topicKey.startsWith(FOOD_ORDER_PAYMENT_REMINDER_TOPIC_PREFIX) ||
    topicKey.startsWith(EVENT_POLL_REMINDER_TOPIC_PREFIX) ||
    topicKey.startsWith(EVENT_REMINDER_TOPIC_PREFIX) ||
    topicKey.startsWith(EVENT_POLL_OPEN_TOPIC_PREFIX)
  );
}

interface SubscriptionRow {
  endpoint: string;
  p256dh: string;
  auth: string;
}

// 'all' = a group-wide announcement (Durchsage, new vote, new lobby, ...);
// 'direct' = personally targeted (e.g. "dein Match ist bereit") — the
// notification center highlights these.
export type PushAudience = 'all' | 'direct';

export interface PushLogEntry {
  id: string;
  groupId: string;
  eventId: string;
  eventName: string;
  notificationType: string;
  targetId: string;
  title: string;
  body: string;
  url: string | null;
  audience: PushAudience;
  expiresAt: number | null;
  resolvedAt: number | null;
  createdAt: number;
}

interface PushScope {
  groupId: string;
  eventId?: string | null;
}

function normalizedPushScope(scope: PushScope): { groupId: string; eventId: string; eventName: string } {
  const eventId = scope.eventId ?? BASE_EVENT_ID;
  const event = db.prepare('SELECT name, group_id AS groupId FROM events WHERE id = ?').get(eventId) as
    | { name: string; groupId: string }
    | undefined;
  if (!event || event.groupId !== scope.groupId) throw new Error('Push scope requires a matching event.');
  return { groupId: scope.groupId, eventId, eventName: event.name };
}

function payloadType(payload: PushPayload, topic?: PushTopic): string {
  return payload.type ?? topic?.key.split(':', 1)[0] ?? 'message';
}

function payloadTargetId(payload: PushPayload, topic?: PushTopic): string {
  return payload.targetId ?? topic?.key ?? payloadType(payload, topic);
}

export interface PushDeliveryResult {
  entry: PushLogEntry;
  recipientPlayerIds: string[];
}

const ACTIVE_PUSH_SQL = 'resolved_at IS NULL AND (expires_at IS NULL OR expires_at > ?)';

// Only 'all' (group-wide) entries — the Kiosk is the sole consumer, a
// shared screen with no identity of its own, so a 'direct' one (e.g. "dein
// Match ist bereit") would read as if it applied to everyone glancing at it.
export function getLastPushLogEntry(groupId: string, eventId: string): PushLogEntry | null {
  const row = db
    .prepare(
      `SELECT id, group_id AS groupId, event_id AS eventId, event_name_snapshot AS eventName,
              notification_type AS notificationType, target_id AS targetId, title, body, url, audience,
              expires_at AS expiresAt, created_at AS createdAt
       FROM push_log
       WHERE group_id = ? AND event_id IS ? AND audience = 'all' AND ${ACTIVE_PUSH_SQL}
       ORDER BY created_at DESC LIMIT 1`
    )
    .get(groupId, eventId, Date.now()) as PushLogEntry | undefined;
  return row ?? null;
}

// Kiosk banners stay exact to the event encoded in the kiosk token.
export function getLastKioskPushLogEntry(groupId: string, eventId: string): PushLogEntry | null {
  return getLastPushLogEntry(groupId, eventId);
}

// The app header needs the same active-only view as the shared Kiosk, but
// scoped to the current player so direct match notifications remain private.
export function getCurrentPushLogEntryFor(groupId: string, eventId: string, playerId: string): PushLogEntry | null {
  const rows = db
    .prepare(
      `SELECT id, group_id AS groupId, event_id AS eventId, event_name_snapshot AS eventName,
              notification_type AS notificationType, target_id AS targetId, title, body, url, audience,
              player_ids AS playerIds, expires_at AS expiresAt,
              created_at AS createdAt
       FROM push_log
       WHERE group_id = ? AND event_id IS ? AND ${ACTIVE_PUSH_SQL}
         AND NOT EXISTS (
           SELECT 1 FROM push_log_seen
           WHERE push_log_seen.push_id = push_log.id AND push_log_seen.player_id = ?
         )
         AND NOT EXISTS (
           SELECT 1 FROM push_log_hidden
           WHERE push_log_hidden.push_id = push_log.id AND push_log_hidden.player_id = ?
         )
       ORDER BY created_at DESC`
    )
    .all(groupId, eventId, Date.now(), playerId, playerId) as Array<PushLogEntry & { playerIds: string }>;
  const row = rows.find(
    (entry) => entry.playerIds === null || (JSON.parse(entry.playerIds) as string[]).includes(playerId)
  );
  if (!row) return null;
  const { playerIds: _playerIds, ...entry } = row;
  return entry;
}

export type MarkPushSeenResult = 'seen' | 'already_seen' | 'not_found' | 'not_recipient';
export type HidePushResult = 'hidden' | 'already_hidden' | 'not_found' | 'not_recipient';

export function setPushMute(groupId: string, playerId: string, eventId: string | null, muted: boolean): void {
  eventId ??= BASE_EVENT_ID;
  if (muted) {
    db.prepare('INSERT OR REPLACE INTO push_mutes (group_id, player_id, event_id, muted_at) VALUES (?, ?, ?, ?)')
      .run(groupId, playerId, eventId, Date.now());
  } else {
    db.prepare('DELETE FROM push_mutes WHERE group_id = ? AND player_id = ? AND event_id IS ?').run(groupId, playerId, eventId);
  }
}

export function isPushMuted(groupId: string, playerId: string, eventId: string | null): boolean {
  return Boolean(db.prepare(
    `SELECT 1 FROM push_mutes WHERE group_id = ? AND player_id = ? AND event_id = ?`
  ).get(groupId, playerId, eventId ?? BASE_EVENT_ID));
}

function pushRecipientCheck(
  groupId: string,
  pushId: string,
  playerId: string,
): 'recipient' | 'not_found' | 'not_recipient' {
  const row = db.prepare('SELECT player_ids AS playerIds FROM push_log WHERE id = ? AND group_id = ?').get(pushId, groupId) as
    | { playerIds: string }
    | undefined;
  if (!row) return 'not_found';
  if (row.playerIds !== null && !(JSON.parse(row.playerIds) as string[]).includes(playerId)) return 'not_recipient';
  return 'recipient';
}

function broadcastPushRefreshForPlayer(playerId: string): void {
  const scope = db
    .prepare(
      `SELECT e.group_id AS groupId, e.id AS eventId
       FROM player_event_contexts pec
       JOIN events e ON e.id = pec.active_event_id
       WHERE pec.player_id = ?`,
    )
    .get(playerId) as { groupId: string; eventId: string } | undefined;
  if (!scope) return;
  broadcast(Events.pushSeen, { playerId }, { ...scope, recipientPlayerIds: [playerId] });
}

// Marks one entry as read for this player without removing it from the
// notification center. Idempotence makes repeat taps harmless.
export function markPushSeen(groupId: string, pushId: string, playerId: string): MarkPushSeenResult {
  const recipient = pushRecipientCheck(groupId, pushId, playerId);
  if (recipient !== 'recipient') return recipient;

  const result = db
    .prepare('INSERT OR IGNORE INTO push_log_seen (push_id, player_id, seen_at) VALUES (?, ?, ?)')
    .run(pushId, playerId, Date.now());
  if (result.changes === 0) return 'already_seen';
  broadcastPushRefreshForPlayer(playerId);
  return 'seen';
}

// Removes one notification from one player's center. The shared row stays
// available to every other recipient; repeated taps are idempotent.
export function hidePushForPlayer(groupId: string, pushId: string, playerId: string): HidePushResult {
  const recipient = pushRecipientCheck(groupId, pushId, playerId);
  if (recipient !== 'recipient') return recipient;

  const result = db
    .prepare('INSERT OR IGNORE INTO push_log_hidden (push_id, player_id, hidden_at) VALUES (?, ?, ?)')
    .run(pushId, playerId, Date.now());
  if (result.changes === 0) return 'already_hidden';
  broadcastPushRefreshForPlayer(playerId);
  return 'hidden';
}

function visiblePushIdsFor(
  groupId: string,
  eventId: string | null,
  playerId: string,
): Array<{ id: string; seen: boolean }> {
  return getPushLogEntriesFor(groupId, eventId, playerId, PUSH_LOG_LIMIT).map((entry) => ({
    id: entry.id,
    seen: entry.seen,
  }));
}

// Bulk actions stay personal, just like their single-entry counterparts.
// One transaction and one realtime signal avoid a burst of up to 50 writes
// and socket refreshes when someone clears the whole center.
export function markAllPushSeen(groupId: string, eventId: string | null, playerId: string): number {
  const entries = visiblePushIdsFor(groupId, eventId, playerId).filter((entry) => !entry.seen);
  if (entries.length === 0) return 0;
  const insert = db.prepare('INSERT OR IGNORE INTO push_log_seen (push_id, player_id, seen_at) VALUES (?, ?, ?)');
  const seenAt = Date.now();
  const changes = db.transaction(() =>
    entries.reduce((sum, entry) => sum + insert.run(entry.id, playerId, seenAt).changes, 0)
  )();
  if (changes > 0) broadcastPushRefreshForPlayer(playerId);
  return changes;
}

export function hideAllPushForPlayer(groupId: string, eventId: string | null, playerId: string): number {
  const entries = visiblePushIdsFor(groupId, eventId, playerId);
  if (entries.length === 0) return 0;
  const insert = db.prepare('INSERT OR IGNORE INTO push_log_hidden (push_id, player_id, hidden_at) VALUES (?, ?, ?)');
  const hiddenAt = Date.now();
  const changes = db.transaction(() =>
    entries.reduce((sum, entry) => sum + insert.run(entry.id, playerId, hiddenAt).changes, 0)
  )();
  if (changes > 0) broadcastPushRefreshForPlayer(playerId);
  return changes;
}

// Recent log entries relevant to one player, newest first, for the header
// notification center. "Relevant" = the player was on the recipient
// list; rows from before recipients were recorded (player_ids NULL) show
// for everyone. The recipient-list JSON is parsed in JS rather than matched
// in SQL — the log is hard-capped at PUSH_LOG_LIMIT rows, so there's nothing
// to gain from a LIKE-based filter that can false-match id substrings.
export function getPushLogEntriesFor(
  groupId: string,
  eventId: string | null,
  playerId: string,
  limit = 20,
): Array<PushLogEntry & { seen: boolean }> {
  const rows = db
    .prepare(
      `SELECT id, group_id AS groupId, event_id AS eventId, event_name_snapshot AS eventName,
              notification_type AS notificationType, target_id AS targetId, title, body, url, audience,
              player_ids AS playerIds, topic_key AS topicKey, expires_at AS expiresAt,
              resolved_at AS resolvedAt, created_at AS createdAt,
              EXISTS (
                SELECT 1 FROM push_log_seen
                WHERE push_log_seen.push_id = push_log.id AND push_log_seen.player_id = ?
              ) AS seen,
              EXISTS (
                SELECT 1 FROM push_log_hidden
                WHERE push_log_hidden.push_id = push_log.id AND push_log_hidden.player_id = ?
              ) AS hidden
       FROM push_log
       WHERE group_id = ? AND event_id IS ?
       ORDER BY created_at DESC`
    )
    .all(playerId, playerId, groupId, eventId ?? BASE_EVENT_ID) as Array<
    PushLogEntry & { playerIds: string; topicKey: string | null; seen: number; hidden: number }
  >;
  return collapseDeduplicatedTopicRows(
    rows.filter((row) => row.playerIds === null || (JSON.parse(row.playerIds) as string[]).includes(playerId)),
  )
    .filter((row) => row.hidden === 0)
    .slice(0, limit)
    .map(({ playerIds: _playerIds, topicKey: _topicKey, hidden: _hidden, seen, ...entry }) => ({
      ...entry,
      seen: seen === 1,
    }));
}

export function getPushLogEntriesForPlayer(
  playerId: string,
  limit = 20,
): Array<PushLogEntry & { seen: boolean }> {
  const rows = db
    .prepare(
      `SELECT id, group_id AS groupId, event_id AS eventId, event_name_snapshot AS eventName,
              notification_type AS notificationType, target_id AS targetId, title, body, url, audience,
              player_ids AS playerIds, topic_key AS topicKey, expires_at AS expiresAt,
              resolved_at AS resolvedAt, created_at AS createdAt,
              EXISTS (
                SELECT 1 FROM push_log_seen
                WHERE push_log_seen.push_id = push_log.id AND push_log_seen.player_id = ?
              ) AS seen,
              EXISTS (
                SELECT 1 FROM push_log_hidden
                WHERE push_log_hidden.push_id = push_log.id AND push_log_hidden.player_id = ?
              ) AS hidden
       FROM push_log
       WHERE event_id IS NOT NULL
       ORDER BY created_at DESC`,
    )
    .all(playerId, playerId) as Array<
    PushLogEntry & { playerIds: string; topicKey: string | null; seen: number; hidden: number }
  >;
  return collapseDeduplicatedTopicRows(
    rows.filter((row) => row.playerIds !== null && (JSON.parse(row.playerIds) as string[]).includes(playerId)),
  )
    .filter((row) => row.hidden === 0)
    .slice(0, limit)
    .map(({ playerIds: _playerIds, topicKey: _topicKey, hidden: _hidden, seen, ...entry }) => ({
      ...entry,
      seen: seen === 1,
    }));
}

function collapseDeduplicatedTopicRows<
  T extends { notificationType: string; topicKey: string | null },
>(rows: T[]): T[] {
  const topics = new Set<string>();
  return rows.filter((row) => {
    if (!row.topicKey || !isDeduplicatedPushTopic(row.topicKey)) return true;
    if (topics.has(row.topicKey)) return false;
    topics.add(row.topicKey);
    return true;
  });
}

export function markAllPushSeenForPlayer(playerId: string): number {
  const entries = getPushLogEntriesForPlayer(playerId, PUSH_LOG_LIMIT).filter((entry) => !entry.seen);
  if (entries.length === 0) return 0;
  const insert = db.prepare('INSERT OR IGNORE INTO push_log_seen (push_id, player_id, seen_at) VALUES (?, ?, ?)');
  const seenAt = Date.now();
  const changes = db.transaction(() =>
    entries.reduce((sum, entry) => sum + insert.run(entry.id, playerId, seenAt).changes, 0)
  )();
  if (changes > 0) broadcastPushRefreshForPlayer(playerId);
  return changes;
}

export function hideAllPushForPlayerAcrossEvents(playerId: string): number {
  const entries = getPushLogEntriesForPlayer(playerId, PUSH_LOG_LIMIT);
  if (entries.length === 0) return 0;
  const insert = db.prepare('INSERT OR IGNORE INTO push_log_hidden (push_id, player_id, hidden_at) VALUES (?, ?, ?)');
  const hiddenAt = Date.now();
  const changes = db.transaction(() =>
    entries.reduce((sum, entry) => sum + insert.run(entry.id, playerId, hiddenAt).changes, 0)
  )();
  if (changes > 0) broadcastPushRefreshForPlayer(playerId);
  return changes;
}

// An entry is obsolete once its underlying workflow resolved (its topic was
// closed - a poll ended, a broadcast beaten) or its own expiry passed, even
// though it stays in the notification center as history either way.
function isPushLogEntryObsolete(entry: { resolvedAt: number | null; expiresAt: number | null }, now: number): boolean {
  return entry.resolvedAt !== null || (entry.expiresAt !== null && entry.expiresAt <= now);
}

// Same per-player scoping as the other bulk actions, but limited to entries
// a returning player no longer needs to act on - the cleanup someone reaches
// for after being away, without touching still-open ones.
export function hideResolvedPushForPlayer(playerId: string): number {
  const now = Date.now();
  const entries = getPushLogEntriesForPlayer(playerId, PUSH_LOG_LIMIT).filter((entry) => isPushLogEntryObsolete(entry, now));
  if (entries.length === 0) return 0;
  const insert = db.prepare('INSERT OR IGNORE INTO push_log_hidden (push_id, player_id, hidden_at) VALUES (?, ?, ?)');
  const hiddenAt = Date.now();
  const changes = db.transaction(() =>
    entries.reduce((sum, entry) => sum + insert.run(entry.id, playerId, hiddenAt).changes, 0)
  )();
  if (changes > 0) broadcastPushRefreshForPlayer(playerId);
  return changes;
}

// Resolving a topic only removes it from active banners; the notification
// center keeps the original push as history. includeChildren handles
// tournament-wide completion, where pending match/stage notifications end too.
export function resolvePushTopic(
  topicKey: string,
  includeChildren = false,
  scope: PushScope = { groupId: DEFAULT_GROUP_ID, eventId: BASE_EVENT_ID },
  emitDeliveryEvent = true,
): void {
  const normalizedScope = normalizedPushScope(scope);
  const now = Date.now();
  const result = includeChildren
    ? db
        .prepare(
          `UPDATE push_log SET resolved_at = ?
           WHERE group_id = ? AND event_id IS ? AND resolved_at IS NULL AND (topic_key = ? OR topic_key GLOB ?)`
        )
        .run(now, normalizedScope.groupId, normalizedScope.eventId, topicKey, `${topicKey}:*`)
    : db
        .prepare('UPDATE push_log SET resolved_at = ? WHERE group_id = ? AND event_id IS ? AND resolved_at IS NULL AND topic_key = ?')
        .run(now, normalizedScope.groupId, normalizedScope.eventId, topicKey);
  if (emitDeliveryEvent && result.changes > 0) {
    broadcast(Events.pushChanged, { groupId: normalizedScope.groupId }, normalizedScope);
  }
}

// Food-order deadlines are editable. Keep the banner expiry synchronized
// without rewriting the historical notification itself.
export function updatePushTopicExpiry(
  topicKey: string,
  expiresAt: number | null,
  scope: PushScope = { groupId: DEFAULT_GROUP_ID, eventId: BASE_EVENT_ID },
): void {
  const normalizedScope = normalizedPushScope(scope);
  const result = db
    .prepare(
      'UPDATE push_log SET expires_at = ? WHERE group_id = ? AND event_id IS ? AND resolved_at IS NULL AND topic_key = ?',
    )
    .run(expiresAt, normalizedScope.groupId, normalizedScope.eventId, topicKey);
  if (result.changes > 0) broadcast(Events.pushChanged, { groupId: normalizedScope.groupId }, normalizedScope);
}

// Fire-and-forget by design (never awaited by callers): a request handler
// shouldn't wait on delivery to a third-party push service, and a slow or
// failing one must never block or crash the response. Subscriptions that
// come back as gone (404/410 - browser uninstalled, permission revoked,
// etc.) are pruned so they stop being retried forever.
export function notifyPlayers(
  playerIds: string[],
  payload: PushPayload,
  audience: PushAudience = 'all',
  topic?: PushTopic,
  scope: PushScope = { groupId: DEFAULT_GROUP_ID, eventId: BASE_EVENT_ID },
): PushDeliveryResult | null {
  const normalizedScope = normalizedPushScope(scope);
  const recordKioskOnlyDelivery = (): PushDeliveryResult | null => {
    if (audience !== 'all') return null;
    const entry = recordPushLog([], payload, audience, topic, normalizedScope);
    broadcast(Events.pushSent, entry, { ...normalizedScope, recipientPlayerIds: [], includeKiosk: true });
    return { entry, recipientPlayerIds: [] };
  };
  if (playerIds.length === 0) return recordKioskOnlyDelivery();

  const placeholders = playerIds.map(() => '?').join(',');
  const eligible = db.prepare(
    `SELECT DISTINCT gm.player_id AS playerId
     FROM group_memberships gm JOIN players p ON p.id = gm.player_id
     WHERE gm.group_id = ? AND gm.status = 'active' AND p.deactivated_at IS NULL AND p.is_test = 0
       AND gm.player_id IN (${placeholders})
       AND NOT EXISTS (SELECT 1 FROM push_mutes pm WHERE pm.group_id = gm.group_id AND pm.player_id = gm.player_id
                      AND pm.event_id = ?)
       AND EXISTS (SELECT 1 FROM event_participants ep WHERE ep.event_id = ? AND ep.player_id = gm.player_id AND ${ACCEPTED_EVENT_PARTICIPANT_SQL})`
  ).all(
    normalizedScope.groupId,
    ...playerIds,
    normalizedScope.eventId,
    normalizedScope.eventId,
  ) as Array<{ playerId: string }>;
  playerIds = eligible.map((row) => row.playerId);
  // A shared kiosk has no personal mute preference. Keep a recipient-less
  // group entry durable for its banner when there were no initial recipients
  // or every individual target was filtered; personal feeds cannot see it and
  // no Web Push request is sent.
  if (playerIds.length === 0) return recordKioskOnlyDelivery();

  const entry = recordPushLog(playerIds, payload, audience, topic, normalizedScope);
  // Every personal socket delivery is bound to the post-mute recipient set.
  // Shared all-audience entries additionally reach the explicitly scoped
  // kiosk, which has no personal mute preference.
  broadcast(
    Events.pushSent,
    entry,
    {
      ...normalizedScope,
      recipientPlayerIds: playerIds,
      ...(audience === 'all' ? { includeKiosk: true } : {}),
    },
  );

  const recipientPlaceholders = playerIds.map(() => '?').join(',');
  const rows = db
    .prepare(`SELECT endpoint, p256dh, auth FROM push_subscriptions WHERE player_id IN (${recipientPlaceholders})`)
    .all(...playerIds) as SubscriptionRow[];

  for (const row of rows) {
    const subscription = { endpoint: row.endpoint, keys: { p256dh: row.p256dh, auth: row.auth } };
    pushTransport
      .send(
        subscription,
        JSON.stringify({
          ...payload,
          eventId: entry.eventId,
          eventName: entry.eventName,
          notificationType: entry.notificationType,
          targetId: entry.targetId,
          occurredAt: entry.createdAt,
        }),
      )
      .catch((err: { statusCode?: number }) => {
        if (err?.statusCode === 404 || err?.statusCode === 410) {
          removeSubscription(row.endpoint);
        }
      });
  }
  return { entry, recipientPlayerIds: playerIds };
}

// Persists the recipient definition and history only. Organisation routes use
// this in Phase 5c so later delivery work can consume the data without this
// cluster introducing Socket.IO, Web Push or kiosk side effects.
export function recordPushLog(
  playerIds: string[],
  payload: PushPayload,
  audience: PushAudience = 'all',
  topic?: PushTopic,
  scope: PushScope = { groupId: DEFAULT_GROUP_ID, eventId: BASE_EVENT_ID },
): PushLogEntry {
  const normalizedScope = normalizedPushScope(scope);
  // Logged regardless of how many subscriptions actually exist: this is a
  // record of "the app told these players something", for the Kiosk banner
  // and the Home feed, not a delivery receipt.
  const existing = topic && isDeduplicatedPushTopic(topic.key)
    ? db
        .prepare(
          `SELECT id FROM push_log
           WHERE group_id = ? AND event_id IS ? AND topic_key = ?
           ORDER BY created_at DESC LIMIT 1`,
        )
        .get(normalizedScope.groupId, normalizedScope.eventId, topic.key) as { id: string } | undefined
    : undefined;
  const entry: PushLogEntry = {
    id: existing?.id ?? nanoid(),
    groupId: normalizedScope.groupId,
    eventId: normalizedScope.eventId,
    eventName: normalizedScope.eventName,
    notificationType: payloadType(payload, topic),
    targetId: payloadTargetId(payload, topic),
    title: payload.title,
    body: payload.body,
    url: payload.url ?? null,
    audience,
    expiresAt: topic?.expiresAt ?? null,
    resolvedAt: null,
    createdAt: Date.now(),
  };
  db.transaction(() => {
    if (existing) {
      db.prepare(
        `UPDATE push_log SET
           event_name_snapshot = ?, notification_type = ?, target_id = ?, title = ?, body = ?, url = ?,
           audience = ?, player_ids = ?, topic_key = ?, expires_at = ?, resolved_at = NULL, created_at = ?
         WHERE id = ?`,
      ).run(
        entry.eventName,
        entry.notificationType,
        entry.targetId,
        entry.title,
        entry.body,
        entry.url,
        entry.audience,
        JSON.stringify(playerIds),
        topic?.key ?? null,
        entry.expiresAt,
        entry.createdAt,
        entry.id,
      );
      // A recurring reminder is a new occurrence of the same feed item.
      // Reset only the current recipients' personal state. The feed row and
      // resolved state are shared, so a new occurrence reopens the item for
      // the current recipient set without affecting other recipients.
      if (playerIds.length > 0) {
        const recipientPlaceholders = playerIds.map(() => '?').join(',');
        db.prepare(`DELETE FROM push_log_seen WHERE push_id = ? AND player_id IN (${recipientPlaceholders})`).run(
          entry.id,
          ...playerIds,
        );
        db.prepare(`DELETE FROM push_log_hidden WHERE push_id = ? AND player_id IN (${recipientPlaceholders})`).run(
          entry.id,
          ...playerIds,
        );
      }
      // Remove duplicates written by older versions before this topic was
      // marked as deduplicated. The newest row remains the stable identity.
      db.prepare(
        'DELETE FROM push_log WHERE group_id = ? AND event_id IS ? AND topic_key = ? AND id <> ?',
      ).run(entry.groupId, entry.eventId, topic?.key ?? null, entry.id);
    } else {
      db.prepare(
        `INSERT INTO push_log
           (id, group_id, event_id, event_name_snapshot, notification_type, target_id,
            title, body, url, audience, player_ids, topic_key, expires_at, resolved_at, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?)`,
      ).run(
        entry.id,
        entry.groupId,
        entry.eventId,
        entry.eventName,
        entry.notificationType,
        entry.targetId,
        entry.title,
        entry.body,
        entry.url,
        entry.audience,
        JSON.stringify(playerIds),
        topic?.key ?? null,
        entry.expiresAt,
        entry.createdAt,
      );
    }
    db.prepare(
      `DELETE FROM push_log
       WHERE group_id = ? AND id NOT IN (
         SELECT id FROM push_log WHERE group_id = ? ORDER BY created_at DESC LIMIT ${PUSH_LOG_LIMIT}
       )`,
    ).run(entry.groupId, entry.groupId);
  })();
  return entry;
}

// Arcade lobbies are intentionally in-memory. After a process restart none
// can still be open, so their previously active pushes must not survive as
// ghost banners even though no socket close event could run during shutdown.
db.prepare(
  `UPDATE push_log SET resolved_at = ?
   WHERE resolved_at IS NULL AND topic_key LIKE 'arcade-lobby:%'`
).run(Date.now());
