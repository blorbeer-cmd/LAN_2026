// Real OS-level push notifications (Web Push), on top of the in-app socket
// toasts: those only reach a phone whose browser tab is open and connected,
// which misses the whole point of "ping everyone right now" while people are
// away from the app. VAPID keys are generated once and stored in app_state,
// so no manual setup/config file is needed (CLAUDE.md: no secrets in the
// repo, but a locally-generated keypair in the gitignored DB file is fine).

import { nanoid } from 'nanoid';
import webpush from 'web-push';
import { db, getState, setState } from './db';

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

interface SubscriptionRow {
  endpoint: string;
  p256dh: string;
  auth: string;
}

// Fire-and-forget by design (never awaited by callers): a request handler
// shouldn't wait on delivery to a third-party push service, and a slow or
// failing one must never block or crash the response. Subscriptions that
// come back as gone (404/410 - browser uninstalled, permission revoked,
// etc.) are pruned so they stop being retried forever.
export function notifyPlayers(playerIds: string[], payload: PushPayload): void {
  if (playerIds.length === 0) return;
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
