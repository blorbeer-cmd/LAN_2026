// Endpoints backing the Web Push opt-in on the Profile page: hand out the
// VAPID public key the browser needs to subscribe, then store/remove the
// resulting subscription. Actual sending happens from push.ts, hooked into
// wherever a notify-worthy event already fires a socket toast.

import { Router } from 'express';
import {
  getVapidPublicKey,
  isValidSubscription,
  saveSubscription,
  removeSubscription,
  getLastPushLogEntry,
  getLastKioskPushLogEntry,
  getCurrentPushLogEntryFor,
  getPushLogEntriesFor,
  markPushSeen,
  hidePushForPlayer,
  markAllPushSeen,
  hideAllPushForPlayer,
  setPushMute,
  isPushMuted,
} from '../push';
import { withBodyPlayerIdentity, withQueryPlayerIdentity } from '../sessions';
import { requireGroupEventAccess, resolveGroupEventScope } from '../groupEventScope';
import { activeGroupPlayers } from '../groupPlayers';

export const pushRouter = Router();

// GET /api/push/vapid-public-key - the key the browser needs before it can
// call pushManager.subscribe().
pushRouter.get('/vapid-public-key', (_req, res) => {
  res.json({ publicKey: getVapidPublicKey() });
});

pushRouter.get('/mute', ...withQueryPlayerIdentity, (req, res) => {
  const playerId = typeof req.query.playerId === 'string' ? req.query.playerId : req.player?.id;
  if (!playerId || !activeGroupPlayers(req.group!.id, [playerId]).has(playerId)) return res.status(404).json({ error: 'Spieler nicht gefunden.' });
  const eventId = req.query.eventId === undefined ? null : (typeof req.query.eventId === 'string' ? req.query.eventId : null);
  const scope = resolveGroupEventScope(req.group!.id, eventId);
  if (!scope.ok) return res.status(scope.status).json({ error: scope.error });
  if (!requireGroupEventAccess(req, res, scope.eventId)) return;
  res.json({ muted: isPushMuted(req.group!.id, playerId, scope.eventId) });
});

pushRouter.put('/mute', ...withBodyPlayerIdentity, (req, res) => {
  const { playerId, eventId, muted } = req.body ?? {};
  if (typeof playerId !== 'string' || !playerId || typeof muted !== 'boolean') return res.status(400).json({ error: 'playerId und muted sind erforderlich.' });
  if (!activeGroupPlayers(req.group!.id, [playerId]).has(playerId)) return res.status(404).json({ error: 'Spieler nicht gefunden.' });
  const scope = resolveGroupEventScope(req.group!.id, eventId);
  if (!scope.ok) return res.status(scope.status).json({ error: scope.error });
  if (!requireGroupEventAccess(req, res, scope.eventId)) return;
  setPushMute(req.group!.id, playerId, scope.eventId, muted);
  res.json({ muted });
});

// GET /api/push/last - the most recent still-active notification sent via notifyPlayers()
// (Durchsage, neue Bestellung, Arcade-Lobby, Abstimmung, Turnier, ...),
// for the Kiosk screen. null when no applicable push remains.
pushRouter.get('/last', (req, res) => {
  // A kiosk uses its bound token scope, mirroring the socket push:sent rules:
  // an event kiosk stays exact to its event, a group kiosk unions its group
  // room with its currently tracking event so a live banner does not flicker
  // away on the next refresh.
  if (req.kioskScope) {
    if (req.kioskScope.eventId) {
      return res.json({
        entry: getLastKioskPushLogEntry(req.group!.id, { includeGroupRoom: false, eventId: req.kioskScope.eventId }),
      });
    }
    const current = resolveGroupEventScope(req.group!.id, undefined);
    return res.json({
      entry: getLastKioskPushLogEntry(req.group!.id, {
        includeGroupRoom: true,
        eventId: current.ok ? current.eventId : null,
      }),
    });
  }
  const scope = resolveGroupEventScope(req.group!.id, req.query.eventId);
  if (!scope.ok) return res.status(scope.status).json({ error: scope.error });
  if (!requireGroupEventAccess(req, res, scope.eventId)) return;
  res.json({ entry: getLastPushLogEntry(req.group!.id, scope.eventId) });
});

// GET /api/push/current?playerId=... - legacy endpoint for the newest
// still-actionable personal entry. The full /log endpoint below remains the
// notification history used by the current header center.
pushRouter.get('/current', ...withQueryPlayerIdentity, (req, res) => {
  const { playerId } = req.query;
  if (typeof playerId !== 'string' || !playerId) {
    return res.status(400).json({ error: 'playerId ist erforderlich.' });
  }
  if (!activeGroupPlayers(req.group!.id, [playerId]).has(playerId)) {
    return res.status(404).json({ error: 'Spieler nicht gefunden.' });
  }
  const scope = resolveGroupEventScope(req.group!.id, req.query.eventId);
  if (!scope.ok) return res.status(scope.status).json({ error: scope.error });
  if (!requireGroupEventAccess(req, res, scope.eventId)) return;
  res.json({ entry: getCurrentPushLogEntryFor(req.group!.id, scope.eventId, playerId) });
});

// GET /api/push/log?playerId=... - recent notifications relevant to one
// player (they were on the recipient list), newest first, for the header
// notification center. Each entry carries its in-app deep link.
pushRouter.get('/log', ...withQueryPlayerIdentity, (req, res) => {
  const { playerId } = req.query;
  if (typeof playerId !== 'string' || !playerId) {
    return res.status(400).json({ error: 'playerId ist erforderlich.' });
  }
  if (!activeGroupPlayers(req.group!.id, [playerId]).has(playerId)) {
    return res.status(404).json({ error: 'Spieler nicht gefunden.' });
  }
  const scope = resolveGroupEventScope(req.group!.id, req.query.eventId);
  if (!scope.ok) return res.status(scope.status).json({ error: scope.error });
  if (!requireGroupEventAccess(req, res, scope.eventId)) return;
  const entries = getPushLogEntriesFor(req.group!.id, scope.eventId, playerId);
  res.json({
    entries,
    summary: {
      total: entries.length,
      direct: entries.filter((entry) => entry.audience === 'direct').length,
      groupWide: entries.filter((entry) => entry.audience === 'all').length,
    },
  });
});

// Bulk variants retain the same identity scoping as the single-entry
// actions. They never mutate another recipient's history.
pushRouter.post('/seen-all', ...withBodyPlayerIdentity, (req, res) => {
  const { playerId, eventId } = req.body ?? {};
  if (typeof playerId !== 'string' || !playerId) {
    return res.status(400).json({ error: 'playerId ist erforderlich.' });
  }
  if (!activeGroupPlayers(req.group!.id, [playerId]).has(playerId)) {
    return res.status(404).json({ error: 'Spieler nicht gefunden.' });
  }
  const scope = resolveGroupEventScope(req.group!.id, eventId);
  if (!scope.ok) return res.status(scope.status).json({ error: scope.error });
  if (!requireGroupEventAccess(req, res, scope.eventId)) return;
  res.json({ changed: markAllPushSeen(req.group!.id, scope.eventId, playerId) });
});

pushRouter.delete('/', ...withBodyPlayerIdentity, (req, res) => {
  const { playerId, eventId } = req.body ?? {};
  if (typeof playerId !== 'string' || !playerId) {
    return res.status(400).json({ error: 'playerId ist erforderlich.' });
  }
  if (!activeGroupPlayers(req.group!.id, [playerId]).has(playerId)) {
    return res.status(404).json({ error: 'Spieler nicht gefunden.' });
  }
  const scope = resolveGroupEventScope(req.group!.id, eventId);
  if (!scope.ok) return res.status(scope.status).json({ error: scope.error });
  if (!requireGroupEventAccess(req, res, scope.eventId)) return;
  res.json({ changed: hideAllPushForPlayer(req.group!.id, scope.eventId, playerId) });
});

// POST /api/push/:id/seen - mark one notification read for this player. It
// intentionally remains in /log as history.
pushRouter.post('/:id/seen', ...withBodyPlayerIdentity, (req, res) => {
  const { playerId } = req.body ?? {};
  if (typeof playerId !== 'string' || !playerId) {
    return res.status(400).json({ error: 'playerId ist erforderlich.' });
  }
  if (!activeGroupPlayers(req.group!.id, [playerId]).has(playerId)) {
    return res.status(404).json({ error: 'Spieler nicht gefunden.' });
  }

  const result = markPushSeen(req.group!.id, req.params.id, playerId);
  if (result === 'not_found') return res.status(404).json({ error: 'Mitteilung nicht gefunden.' });
  if (result === 'not_recipient') return res.status(403).json({ error: 'Mitteilung gehört nicht zu diesem Spieler.' });
  res.status(204).end();
});

// DELETE /api/push/:id - hide one notification for one player. This is a
// per-recipient removal, never a global deletion from the shared push log.
pushRouter.delete('/:id', ...withBodyPlayerIdentity, (req, res) => {
  const { playerId } = req.body ?? {};
  if (typeof playerId !== 'string' || !playerId) {
    return res.status(400).json({ error: 'playerId ist erforderlich.' });
  }
  if (!activeGroupPlayers(req.group!.id, [playerId]).has(playerId)) {
    return res.status(404).json({ error: 'Spieler nicht gefunden.' });
  }

  const result = hidePushForPlayer(req.group!.id, req.params.id, playerId);
  if (result === 'not_found') return res.status(404).json({ error: 'Mitteilung nicht gefunden.' });
  if (result === 'not_recipient') return res.status(403).json({ error: 'Mitteilung gehört nicht zu diesem Spieler.' });
  res.status(204).end();
});

// POST /api/push/subscribe - register (or re-point) a browser subscription
// for a player. Body: { playerId, subscription: PushSubscriptionJSON }
pushRouter.post('/subscribe', ...withBodyPlayerIdentity, (req, res) => {
  const { playerId, subscription } = req.body ?? {};
  if (typeof playerId !== 'string' || !playerId) {
    return res.status(400).json({ error: 'playerId ist erforderlich.' });
  }
  if (!activeGroupPlayers(req.group!.id, [playerId]).has(playerId)) {
    return res.status(404).json({ error: 'Spieler nicht gefunden.' });
  }
  if (!isValidSubscription(subscription)) {
    return res.status(400).json({ error: 'subscription ist ungültig.' });
  }

  saveSubscription(playerId, subscription);
  res.status(201).json({ ok: true });
});

// POST /api/push/unsubscribe - drop a subscription (opt-out). Body: { endpoint }
pushRouter.post('/unsubscribe', ...withBodyPlayerIdentity, (req, res) => {
  const { endpoint, playerId } = req.body ?? {};
  if (typeof endpoint !== 'string' || !endpoint) {
    return res.status(400).json({ error: 'endpoint ist erforderlich.' });
  }
  removeSubscription(endpoint, req.player ? playerId : undefined);
  res.status(204).end();
});
