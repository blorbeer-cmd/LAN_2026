// Endpoints backing the Web Push opt-in on the Profile page: hand out the
// VAPID public key the browser needs to subscribe, then store/remove the
// resulting subscription. Actual sending happens from push.ts, hooked into
// wherever a notify-worthy event already fires a socket toast.

import { Router } from 'express';
import { db } from '../db';
import { getVapidPublicKey, isValidSubscription, saveSubscription, removeSubscription } from '../push';

export const pushRouter = Router();

// GET /api/push/vapid-public-key - the key the browser needs before it can
// call pushManager.subscribe().
pushRouter.get('/vapid-public-key', (_req, res) => {
  res.json({ publicKey: getVapidPublicKey() });
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
