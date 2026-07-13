// Real OS-level push notifications (Web Push), on top of the in-app socket
// toasts: those only reach a phone whose browser tab is open and connected,
// which misses the whole point of "ping everyone right now" while people are
// away from the app. VAPID keys are generated once and stored in app_state,
// so no manual setup/config file is needed (CLAUDE.md: no secrets in the
// repo, but a locally-generated keypair in the gitignored DB file is fine).

import { nanoid } from 'nanoid';
import webpush from 'web-push';
import { db, getState, setState } from './db';
import { broadcast, Events } from './realtime';

// Only recent entries matter (the Kiosk shows the latest one, the Home feed
// the last handful per player) - trimmed on every insert so this never grows
// unbounded over a multi-day LAN party.
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
webpush.setVapidDetails('mailto:admin@respawnhq.local', vapidKeys.publicKey, vapidKeys.privateKey);

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

export function removeSubscription(endpoint: string): void {
  db.prepare('DELETE FROM push_subscriptions WHERE endpoint = ?').run(endpoint);
}

interface PushPayload {
  title: string;
  body: string;
  url?: string;
}

export interface PushTopic {
  key: string;
  expiresAt?: number | null;
}

interface SubscriptionRow {
  endpoint: string;
  p256dh: string;
  auth: string;
}

// 'all' = a group-wide announcement (Durchsage, new vote, new lobby, ...);
// 'direct' = personally targeted (e.g. "dein Match ist bereit") — the Home
// feed highlights these.
export type PushAudience = 'all' | 'direct';

interface PushLogEntry {
  id: string;
  title: string;
  body: string;
  url: string | null;
  audience: PushAudience;
  expiresAt: number | null;
  createdAt: number;
}

const ACTIVE_PUSH_SQL = 'resolved_at IS NULL AND (expires_at IS NULL OR expires_at > ?)';

// Only 'all' (group-wide) entries — the Kiosk is the sole consumer, a
// shared screen with no identity of its own, so a 'direct' one (e.g. "dein
// Match ist bereit") would read as if it applied to everyone glancing at it.
export function getLastPushLogEntry(): PushLogEntry | null {
  const row = db
    .prepare(
      `SELECT id, title, body, url, audience, expires_at AS expiresAt, created_at AS createdAt FROM push_log
       WHERE audience = 'all' AND ${ACTIVE_PUSH_SQL} ORDER BY created_at DESC LIMIT 1`
    )
    .get(Date.now()) as PushLogEntry | undefined;
  return row ?? null;
}

// The app header needs the same active-only view as the shared Kiosk, but
// scoped to the current player so direct match notifications remain private.
export function getCurrentPushLogEntryFor(playerId: string): PushLogEntry | null {
  const rows = db
    .prepare(
      `SELECT id, title, body, url, audience, player_ids AS playerIds, expires_at AS expiresAt,
              created_at AS createdAt
       FROM push_log
       WHERE ${ACTIVE_PUSH_SQL}
         AND NOT EXISTS (
           SELECT 1 FROM push_log_seen
           WHERE push_log_seen.push_id = push_log.id AND push_log_seen.player_id = ?
         )
       ORDER BY created_at DESC`
    )
    .all(Date.now(), playerId) as Array<PushLogEntry & { playerIds: string | null }>;
  const row = rows.find(
    (entry) => entry.playerIds === null || (JSON.parse(entry.playerIds) as string[]).includes(playerId)
  );
  if (!row) return null;
  const { playerIds: _playerIds, ...entry } = row;
  return entry;
}

export type MarkPushSeenResult = 'seen' | 'already_seen' | 'not_found' | 'not_recipient';

// Hides one entry from this player's header banner without removing it from
// push_log or from the Home notification history. Idempotence makes repeat
// taps and duplicate requests harmless.
export function markPushSeen(pushId: string, playerId: string): MarkPushSeenResult {
  const row = db.prepare('SELECT player_ids AS playerIds FROM push_log WHERE id = ?').get(pushId) as
    | { playerIds: string | null }
    | undefined;
  if (!row) return 'not_found';
  if (row.playerIds !== null && !(JSON.parse(row.playerIds) as string[]).includes(playerId)) return 'not_recipient';

  const result = db
    .prepare('INSERT OR IGNORE INTO push_log_seen (push_id, player_id, seen_at) VALUES (?, ?, ?)')
    .run(pushId, playerId, Date.now());
  if (result.changes === 0) return 'already_seen';
  broadcast(Events.pushSeen, { playerId });
  return 'seen';
}

// Recent log entries relevant to one player, newest first, for the Home
// view's notification feed. "Relevant" = the player was on the recipient
// list; rows from before recipients were recorded (player_ids NULL) show
// for everyone. The recipient-list JSON is parsed in JS rather than matched
// in SQL — the log is hard-capped at PUSH_LOG_LIMIT rows, so there's nothing
// to gain from a LIKE-based filter that can false-match id substrings.
export function getPushLogEntriesFor(playerId: string, limit = 20): PushLogEntry[] {
  const rows = db
    .prepare(
      `SELECT id, title, body, url, audience, player_ids AS playerIds, expires_at AS expiresAt,
              created_at AS createdAt
       FROM push_log ORDER BY created_at DESC`
    )
    .all() as Array<PushLogEntry & { playerIds: string | null }>;
  return rows
    .filter((row) => row.playerIds === null || (JSON.parse(row.playerIds) as string[]).includes(playerId))
    .slice(0, limit)
    .map(({ playerIds: _playerIds, ...entry }) => entry);
}

function broadcastPushChanged(changes: number): void {
  if (changes > 0) broadcast(Events.pushChanged, null);
}

// Resolving a topic only removes it from active banners; the Home feed keeps
// the original push as history. includeChildren handles tournament-wide
// completion, where any still-pending match/stage notifications end too.
export function resolvePushTopic(topicKey: string, includeChildren = false): void {
  const now = Date.now();
  const result = includeChildren
    ? db
        .prepare(
          `UPDATE push_log SET resolved_at = ?
           WHERE resolved_at IS NULL AND (topic_key = ? OR topic_key GLOB ?)`
        )
        .run(now, topicKey, `${topicKey}:*`)
    : db.prepare('UPDATE push_log SET resolved_at = ? WHERE resolved_at IS NULL AND topic_key = ?').run(now, topicKey);
  broadcastPushChanged(result.changes);
}

// Food-order deadlines are editable. Keep the banner expiry synchronized
// without rewriting the historical notification itself.
export function updatePushTopicExpiry(topicKey: string, expiresAt: number | null): void {
  const result = db
    .prepare('UPDATE push_log SET expires_at = ? WHERE resolved_at IS NULL AND topic_key = ?')
    .run(expiresAt, topicKey);
  broadcastPushChanged(result.changes);
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
  topic?: PushTopic
): void {
  if (playerIds.length === 0) return;

  // Logged regardless of how many subscriptions actually exist: this is a
  // record of "the app told these players something", for the Kiosk banner
  // and the Home feed, not a delivery receipt.
  const entry: PushLogEntry = {
    id: nanoid(),
    title: payload.title,
    body: payload.body,
    url: payload.url ?? null,
    audience,
    expiresAt: topic?.expiresAt ?? null,
    createdAt: Date.now(),
  };
  db.prepare(
    `INSERT INTO push_log
       (id, title, body, url, audience, player_ids, topic_key, expires_at, resolved_at, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, ?)`
  ).run(
    entry.id,
    entry.title,
    entry.body,
    entry.url,
    entry.audience,
    JSON.stringify(playerIds),
    topic?.key ?? null,
    entry.expiresAt,
    entry.createdAt
  );
  db.prepare(
    `DELETE FROM push_log WHERE id NOT IN (SELECT id FROM push_log ORDER BY created_at DESC LIMIT ${PUSH_LOG_LIMIT})`
  ).run();
  broadcast(Events.pushSent, entry);

  const placeholders = playerIds.map(() => '?').join(',');
  const rows = db
    .prepare(`SELECT endpoint, p256dh, auth FROM push_subscriptions WHERE player_id IN (${placeholders})`)
    .all(...playerIds) as SubscriptionRow[];

  for (const row of rows) {
    const subscription = { endpoint: row.endpoint, keys: { p256dh: row.p256dh, auth: row.auth } };
    pushTransport
      .send(subscription, JSON.stringify(payload))
      .catch((err: { statusCode?: number }) => {
        if (err?.statusCode === 404 || err?.statusCode === 410) {
          removeSubscription(row.endpoint);
        }
        // Any other failure (offline push service, transient error, ...) is
        // swallowed: the in-app toast already covers the connected case,
        // this is a best-effort bonus for the disconnected one.
      });
  }
}

// Arcade lobbies are intentionally in-memory. After a process restart none
// can still be open, so their previously active pushes must not survive as
// ghost banners even though no socket close event could run during shutdown.
db.prepare(
  `UPDATE push_log SET resolved_at = ?
   WHERE resolved_at IS NULL AND topic_key LIKE 'arcade-lobby:%'`
).run(Date.now());
