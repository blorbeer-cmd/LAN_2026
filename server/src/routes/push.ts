// Endpoints backing the Web Push opt-in on the Profile page: hand out the
// VAPID public key the browser needs to subscribe, then store/remove the
// resulting subscription. Actual sending happens from push.ts, hooked into
// wherever a notify-worthy event already fires a socket toast.

import { Router } from 'express';
import { db } from '../db';
import {
  getVapidPublicKey,
  isValidSubscription,
  saveSubscription,
  removeSubscription,
  getLastPushLogEntry,
  getCurrentPushLogEntryFor,
  getPushLogEntriesFor,
  markPushSeen,
} from '../push';

export const pushRouter = Router();

// GET /api/push/vapid-public-key - the key the browser needs before it can
// call pushManager.subscribe().
pushRouter.get('/vapid-public-key', (_req, res) => {
  res.json({ publicKey: getVapidPublicKey() });
});

// GET /api/push/last - the most recent still-active notification sent via notifyPlayers()
// (Durchsage, neue Bestellung, Arcade-Lobby, Abstimmung, Turnier, ...),
// for the Kiosk screen. null when no applicable push remains.
pushRouter.get('/last', (_req, res) => {
  res.json({ entry: getLastPushLogEntry() });
});

// GET /api/push/current?playerId=... - the newest still-actionable entry for
// the personal app-header banner. Closed topics are skipped; the full /log
// endpoint below intentionally remains an unfiltered notification history.
pushRouter.get('/current', (req, res) => {
  const { playerId } = req.query;
  if (typeof playerId !== 'string' || !playerId) {
    return res.status(400).json({ error: 'playerId ist erforderlich.' });
  }
  const player = db.prepare('SELECT id FROM players WHERE id = ?').get(playerId);
  if (!player) return res.status(404).json({ error: 'Spieler nicht gefunden.' });
  res.json({ entry: getCurrentPushLogEntryFor(playerId) });
});

// GET /api/push/log?playerId=... - recent notifications relevant to one
// player (they were on the recipient list), newest first, for the Home
// view's "Mitteilungen" feed. Each entry carries the deep-link url the
// notification would open, so the feed can offer the same jump-off point.
pushRouter.get('/log', (req, res) => {
  const { playerId } = req.query;
  if (typeof playerId !== 'string' || !playerId) {
    return res.status(400).json({ error: 'playerId ist erforderlich.' });
  }
  const player = db.prepare('SELECT id FROM players WHERE id = ?').get(playerId);
  if (!player) return res.status(404).json({ error: 'Spieler nicht gefunden.' });
  res.json({ entries: getPushLogEntriesFor(playerId) });
});

// POST /api/push/:id/seen - dismiss one notification from this player's
// persistent header banner. It intentionally remains in /log as history.
pushRouter.post('/:id/seen', (req, res) => {
  const { playerId } = req.body ?? {};
  if (typeof playerId !== 'string' || !playerId) {
    return res.status(400).json({ error: 'playerId ist erforderlich.' });
  }
  const player = db.prepare('SELECT id FROM players WHERE id = ?').get(playerId);
  if (!player) return res.status(404).json({ error: 'Spieler nicht gefunden.' });

  const result = markPushSeen(req.params.id, playerId);
  if (result === 'not_found') return res.status(404).json({ error: 'Mitteilung nicht gefunden.' });
  if (result === 'not_recipient') return res.status(403).json({ error: 'Mitteilung gehört nicht zu diesem Spieler.' });
  res.status(204).end();
});

// POST /api/push/subscribe - register (or re-point) a browser subscription
// for a player. Body: { playerId, subscription: PushSubscriptionJSON }
pushRouter.post('/subscribe', (req, res) => {
  const { playerId, subscription } = req.body ?? {};
  if (typeof playerId !== 'string' || !playerId) {
    return res.status(400).json({ error: 'playerId ist erforderlich.' });
  }
  const player = db.prepare('SELECT id FROM players WHERE id = ?').get(playerId);
  if (!player) return res.status(404).json({ error: 'Spieler nicht gefunden.' });
  if (!isValidSubscription(subscription)) {
    return res.status(400).json({ error: 'subscription ist ungültig.' });
  }

  saveSubscription(playerId, subscription);
  res.status(201).json({ ok: true });
});

// POST /api/push/unsubscribe - drop a subscription (opt-out). Body: { endpoint }
pushRouter.post('/unsubscribe', (req, res) => {
  const { endpoint } = req.body ?? {};
  if (typeof endpoint !== 'string' || !endpoint) {
    return res.status(400).json({ error: 'endpoint ist erforderlich.' });
  }
  removeSubscription(endpoint);
  res.status(204).end();
});
