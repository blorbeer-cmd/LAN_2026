// Admin controls for the welcome trailer: upload and replace the video and
// its poster, switch it on or off, show it to everyone again, remove it.
// Mounted below /api/admin, so every route already requires an admin.

import { Router, type Request, type Response } from 'express';
import { writeAdminAudit } from '../adminAudit';
import { requireRecentReauthentication } from '../sessions';
import {
  removeWelcomeTrailerAssets,
  resetWelcomeTrailerSeen,
  setWelcomeTrailerEnabled,
  storeWelcomeTrailerAsset,
  WELCOME_TRAILER_ASSETS,
  welcomeTrailerAdminStatus,
  WelcomeTrailerUploadError,
  type WelcomeTrailerAsset,
} from '../welcomeTrailer';

export const welcomeTrailerAdminRouter = Router();

welcomeTrailerAdminRouter.get('/', (_req, res) => {
  res.json(welcomeTrailerAdminStatus());
});

// Lets the browser ask for the password before it sends a large file, instead
// of finding out after the whole upload was rejected.
welcomeTrailerAdminRouter.post('/upload-check', requireRecentReauthentication, (_req, res) => {
  res.sendStatus(204);
});

function declaredLength(req: Request): number | null {
  const header = req.headers['content-length'];
  if (typeof header !== 'string' || !/^\d+$/.test(header)) return null;
  return Number(header);
}

async function upload(req: Request, res: Response, asset: WelcomeTrailerAsset): Promise<void> {
  const rule = WELCOME_TRAILER_ASSETS[asset];
  const type = (req.headers['content-type'] ?? '').split(';')[0].trim().toLowerCase();
  if (type !== rule.contentType) {
    req.resume();
    res.status(415).json({ error: `Bitte eine Datei vom Typ ${rule.label} hochladen.` });
    return;
  }
  try {
    await storeWelcomeTrailerAsset(asset, req, declaredLength(req));
  } catch (error) {
    if (!(error instanceof WelcomeTrailerUploadError)) throw error;
    req.resume();
    if (!res.headersSent) res.status(error.status).json({ error: error.message });
    return;
  }
  writeAdminAudit({
    actorPlayerId: req.player!.id,
    action: 'welcome_trailer_uploaded',
    targetType: 'welcome_trailer',
    targetId: asset,
  });
  res.json(welcomeTrailerAdminStatus());
}

welcomeTrailerAdminRouter.put('/video', requireRecentReauthentication, (req, res, next) => {
  upload(req, res, 'video').catch(next);
});

welcomeTrailerAdminRouter.put('/poster', requireRecentReauthentication, (req, res, next) => {
  upload(req, res, 'poster').catch(next);
});

welcomeTrailerAdminRouter.put('/settings', (req, res) => {
  const { enabled } = req.body ?? {};
  if (typeof enabled !== 'boolean') return res.status(400).json({ error: 'enabled muss true oder false sein.' });
  setWelcomeTrailerEnabled(enabled);
  writeAdminAudit({
    actorPlayerId: req.player!.id,
    action: enabled ? 'welcome_trailer_enabled' : 'welcome_trailer_disabled',
    targetType: 'welcome_trailer',
    targetId: 'settings',
  });
  return res.json(welcomeTrailerAdminStatus());
});

welcomeTrailerAdminRouter.post('/seen/reset', requireRecentReauthentication, (req, res) => {
  const reset = resetWelcomeTrailerSeen();
  writeAdminAudit({
    actorPlayerId: req.player!.id,
    action: 'welcome_trailer_seen_reset',
    targetType: 'welcome_trailer',
    targetId: 'seen',
    details: { reset },
  });
  res.json({ ...welcomeTrailerAdminStatus(), reset });
});

welcomeTrailerAdminRouter.delete('/', requireRecentReauthentication, (req, res) => {
  removeWelcomeTrailerAssets();
  writeAdminAudit({
    actorPlayerId: req.player!.id,
    action: 'welcome_trailer_removed',
    targetType: 'welcome_trailer',
    targetId: 'video',
  });
  res.json(welcomeTrailerAdminStatus());
});
