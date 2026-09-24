import { Router } from 'express';
import { db } from '../db';
import { requireAdmin } from '../auth';
import { clearSessionCookie, requireRecentReauthentication } from '../sessions';
import { buildPersonalDataExport, deleteAccount, listDeletionReceipts } from '../privacyService';
import { previewPrivacyRetention } from '../privacyRetention';
import { getTrackingConsentDefaultVersion, setTrackingConsentDefault } from '../trackingContexts';
import {
  GROUP_TRACKING_CONSENT_PURPOSE,
  GROUP_TRACKING_CONSENT_TEXT,
  GROUP_TRACKING_CONSENT_TEXT_VERSION,
  TRACKING_CONSENT_PURPOSE,
  TRACKING_CONSENT_TEXT,
  TRACKING_CONSENT_TEXT_VERSION,
} from '../privacyPolicy';
import { disconnectPlayerSockets, broadcast, Events } from '../realtime';

export const privacyRouter = Router();

privacyRouter.get('/', (req, res) => {
  const events = db
    .prepare(
      `SELECT e.id AS eventId, e.name AS eventName, e.event_type_key AS eventType,
              c.id AS consentId, c.accepted_at AS grantedAt, c.revoked_at AS revokedAt,
              c.purpose, c.text_version AS textVersion, c.source
       FROM event_participants ep
       JOIN events e ON e.id = ep.event_id
       LEFT JOIN event_tracking_consents c
         ON c.event_id = e.id AND c.player_id = ep.player_id AND c.revoked_at IS NULL
        AND c.purpose = ? AND c.text_version = ?
       WHERE ep.player_id = ? AND ep.status = 'accepted'
       ORDER BY e.starts_at DESC`,
    )
    .all(TRACKING_CONSENT_PURPOSE, TRACKING_CONSENT_TEXT_VERSION, req.player!.id);
  // Consents kept unversioned by migration 106 no longer match the join
  // above, so they render as "Nicht aktiviert" and stay unreachable while
  // still holding revoked_at IS NULL — which is what the personal export
  // shows. List them separately so they can be revoked, exactly like the
  // legacy community consents below.
  const legacyEventConsents = db
    .prepare(
      `SELECT e.id AS eventId, e.name AS eventName, c.id AS consentId,
              c.accepted_at AS grantedAt, c.purpose, c.text_version AS textVersion, c.source
       FROM event_tracking_consents c
       JOIN events e ON e.id = c.event_id
       JOIN group_memberships gm ON gm.group_id = e.group_id AND gm.player_id = c.player_id
       WHERE c.player_id = ? AND c.revoked_at IS NULL AND gm.status = 'active'
         AND NOT (c.purpose IS ? AND c.text_version IS ?)
       ORDER BY e.starts_at DESC`,
    )
    .all(req.player!.id, TRACKING_CONSENT_PURPOSE, TRACKING_CONSENT_TEXT_VERSION);
  const defaultVersion = getTrackingConsentDefaultVersion(req.player!.id);
  const retention = previewPrivacyRetention();
  const legacyGroupConsents = db.prepare(
    `SELECT g.id AS groupId, g.name AS groupName, c.granted_at AS grantedAt,
            c.purpose, c.text_version AS textVersion
     FROM group_tracking_consents c
     JOIN groups g ON g.id = c.group_id
     JOIN group_memberships gm ON gm.group_id = c.group_id AND gm.player_id = c.player_id
     WHERE c.player_id = ? AND c.revoked_at IS NULL AND gm.status = 'active'
     ORDER BY g.name COLLATE NOCASE`,
  ).all(req.player!.id);
  res.json({
    trackingConsent: {
      purpose: TRACKING_CONSENT_PURPOSE,
      textVersion: TRACKING_CONSENT_TEXT_VERSION,
      text: TRACKING_CONSENT_TEXT,
      events,
      legacyEvents: legacyEventConsents,
      // The stored version is reported as-is so the view can say that an
      // older agreement no longer applies instead of silently showing "off".
      autoConsent: {
        enabled: defaultVersion === TRACKING_CONSENT_TEXT_VERSION,
        agreedTextVersion: defaultVersion,
      },
    },
    legacyGroupTracking: {
      purpose: GROUP_TRACKING_CONSENT_PURPOSE,
      textVersion: GROUP_TRACKING_CONSENT_TEXT_VERSION,
      text: GROUP_TRACKING_CONSENT_TEXT,
      groups: legacyGroupConsents,
    },
    retention: {
      enabled: retention.enabled,
      policies: retention.policies.map(({ key, purpose, retentionDays, protection }) => ({
        key,
        purpose,
        retentionDays,
        protection,
      })),
    },
    operatorDecisionsRequired: [
      'Verantwortliche Stelle und Kontakt',
      'Rechtsgrundlagen je notwendiger Verarbeitung',
      'gesetzliche oder vertragliche Aufbewahrungspflichten',
      'eingesetzte Hosting-, Push- und weitere Dienstleister',
    ],
  });
});

// Setting the standing default is itself the informed decision, so it carries
// the same text version check as a per-event grant: an account can only
// pre-authorize the wording it was actually shown.
privacyRouter.post('/tracking-default', (req, res) => {
  const { enabled, textVersion } = req.body ?? {};
  if (typeof enabled !== 'boolean') {
    return res.status(400).json({ error: 'enabled muss ein Boolean sein.' });
  }
  if (enabled && textVersion !== TRACKING_CONSENT_TEXT_VERSION) {
    return res.status(409).json({
      error: 'Der Einwilligungstext hat sich geändert. Bitte lade die Datenschutzangaben neu.',
      code: 'consent_text_changed',
    });
  }
  setTrackingConsentDefault(req.player!.id, enabled ? TRACKING_CONSENT_TEXT_VERSION : null);
  return res.json({ enabled, agreedTextVersion: enabled ? TRACKING_CONSENT_TEXT_VERSION : null });
});

privacyRouter.get('/export', (req, res) => {
  const data = buildPersonalDataExport(req.player!.id);
  if (!data) return res.status(404).json({ error: 'Konto nicht gefunden.' });
  const date = new Date().toISOString().slice(0, 10);
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="respawn-meine-daten-${date}.json"`);
  res.send(`${JSON.stringify(data, null, 2)}\n`);
});

privacyRouter.get('/retention-preview', requireAdmin, (_req, res) => {
  res.json(previewPrivacyRetention());
});

privacyRouter.get('/deletion-receipts', requireAdmin, (_req, res) => {
  const date = new Date().toISOString().slice(0, 10);
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="respawn-loeschnachweise-${date}.json"`);
  res.send(`${JSON.stringify({
    format: 'respawn-deletion-receipts',
    version: 1,
    exportedAt: Date.now(),
    receipts: listDeletionReceipts(),
  }, null, 2)}\n`);
});

privacyRouter.delete('/account', requireRecentReauthentication, (req, res) => {
  const playerId = req.player!.id;
  const result = deleteAccount(playerId, playerId);
  if (!result.ok) {
    const status = result.code === 'not_found' ? 404 : result.code === 'deletion_receipt_unavailable' ? 503 : 409;
    return res.status(status).json({ error: result.message, code: result.code });
  }
  disconnectPlayerSockets(playerId);
  for (const groupId of result.affectedGroupIds) broadcast(Events.playersChanged, null, { groupId });
  clearSessionCookie(res);
  return res.status(204).end();
});
