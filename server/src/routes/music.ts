import { createHash, randomBytes } from 'crypto';
import { NextFunction, Request, RequestHandler, Response, Router } from 'express';
import fs from 'fs';
import path from 'path';
import archiver from 'archiver';
import { nanoid } from 'nanoid';
import { config } from '../config';
import { db } from '../db';
import { activeGroupPlayers } from '../groupPlayers';
import {
  buildControllerReadme,
  buildControllerSetup,
  buildUnixLauncher,
  buildWindowsLauncher,
  buildWindowsPowerShell,
} from '../jamControllerPackage';
import {
  controllerSummary,
  issueMusicControllerCommand,
  MusicControllerError,
} from '../musicController';
import { broadcast, Events } from '../realtime';
import { resolveAgentServerUrl } from './agentDownload';
import { withBodyPlayerIdentity } from '../sessions';

export const musicRouter = Router();

const PAIRING_TTL_MS = 10 * 60 * 1000;
const CONTROLLER_SCRIPT_PATH = path.join(__dirname, '..', '..', 'scripts', 'jam-controller.mjs');

interface MusicSessionRow {
  id: string;
  group_id: string;
  host_player_id: string;
  device_id: string;
  device_name: string;
  status: 'active' | 'ended';
  current_track_uri: string | null;
  current_track_json: string | null;
  playback_is_playing: number;
  playback_progress_ms: number;
  playback_updated_at: number | null;
  started_at: number;
  ended_at: number | null;
}

interface PublicTrack {
  id: string;
  uri: string;
  name: string;
  artist: string;
  album: string;
  imageUrl: string | null;
  durationMs: number;
}

interface MusicRequestPayload {
  id: string;
  trackId: string;
  trackUri: string;
  name: string;
  artist: string;
  album: string | null;
  imageUrl: string | null;
  durationMs: number;
  requestedBy: string;
  requestedByName: string;
  status: 'sending' | 'queued' | 'playing';
  createdAt: number;
  playedAt: number | null;
}

type AsyncRoute = (req: Request, res: Response) => Promise<void | Response>;

function asyncRoute(handler: AsyncRoute): RequestHandler {
  return (req, res, next: NextFunction) => {
    void handler(req, res).catch((error) => {
      if (error instanceof MusicControllerError) {
        res.status(error.status).json({ error: error.message });
        return;
      }
      next(error);
    });
  };
}

function hash(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function actorPlayerId(req: Request): string | null {
  if (req.player?.id) return req.player.id;
  const bodyId = req.body?.playerId;
  if (typeof bodyId === 'string' && bodyId) return bodyId;
  return req.header('x-player-id') || null;
}

function activePlayer(req: Request): { id: string; name: string; isAdmin: number } | null {
  const playerId = actorPlayerId(req);
  if (!playerId || !activeGroupPlayers(req.group!.id, [playerId]).has(playerId)) return null;
  return db.prepare('SELECT id, name, is_admin AS isAdmin FROM players WHERE id = ?').get(playerId) as {
    id: string;
    name: string;
    isAdmin: number;
  };
}

function activeSession(groupId: string): MusicSessionRow | undefined {
  return db.prepare("SELECT * FROM music_sessions WHERE group_id = ? AND status = 'active'").get(groupId) as
    | MusicSessionRow
    | undefined;
}

function mayControl(req: Request, session: MusicSessionRow, playerId: string): boolean {
  return session.host_player_id === playerId || req.groupMembership?.role === 'owner' || req.groupMembership?.role === 'admin';
}

function mayManageController(req: Request, _player: { isAdmin: number }): boolean {
  if (config.authMode === 'legacy') return req.header('x-admin-mode') === '1';
  return req.groupMembership?.role === 'owner' || req.groupMembership?.role === 'admin';
}

function validTrack(value: unknown): PublicTrack | null {
  if (!value || typeof value !== 'object') return null;
  const track = value as Record<string, unknown>;
  if (
    typeof track.id !== 'string' || !/^[A-Za-z0-9]{22}$/.test(track.id) ||
    typeof track.uri !== 'string' || typeof track.name !== 'string' ||
    typeof track.artist !== 'string' || !Number.isSafeInteger(track.durationMs)
  ) return null;
  return {
    id: track.id,
    uri: track.uri,
    name: track.name.slice(0, 300),
    artist: track.artist.slice(0, 300),
    album: typeof track.album === 'string' ? track.album.slice(0, 300) : '',
    imageUrl: typeof track.imageUrl === 'string' ? track.imageUrl : null,
    durationMs: Number(track.durationMs),
  };
}

function requestRows(sessionId: string): MusicRequestPayload[] {
  return db.prepare(
    `SELECT r.id, r.track_id AS trackId, r.track_uri AS trackUri, r.track_name AS name,
            r.artist_name AS artist, r.album_name AS album, r.image_url AS imageUrl,
            r.duration_ms AS durationMs, r.requested_by AS requestedBy,
            r.requested_by_name_snapshot AS requestedByName, r.status,
            r.created_at AS createdAt, r.played_at AS playedAt
     FROM music_requests r
     WHERE r.session_id = ? AND r.status IN ('sending', 'queued', 'playing')
     ORDER BY CASE r.status WHEN 'playing' THEN 0 ELSE 1 END, r.created_at`,
  ).all(sessionId) as MusicRequestPayload[];
}

function nextRequestCreatedAt(sessionId: string): number {
  const row = db.prepare('SELECT COALESCE(MAX(created_at), 0) AS value FROM music_requests WHERE session_id = ?')
    .get(sessionId) as { value: number };
  return Math.max(Date.now(), row.value + 1);
}

function sessionPayload(session: MusicSessionRow | undefined) {
  if (!session) return null;
  let currentTrack: PublicTrack | null = null;
  try { currentTrack = session.current_track_json ? JSON.parse(session.current_track_json) : null; } catch { /* stale data */ }
  return {
    id: session.id,
    hostPlayerId: session.host_player_id,
    deviceId: session.device_id,
    deviceName: session.device_name,
    currentTrack,
    isPlaying: Boolean(session.playback_is_playing),
    progressMs: session.playback_progress_ms,
    playbackUpdatedAt: session.playback_updated_at,
    startedAt: session.started_at,
    requests: requestRows(session.id),
  };
}

function currentProgress(session: MusicSessionRow): number {
  let duration = 0;
  try { duration = Number(JSON.parse(session.current_track_json || '{}').durationMs || 0); } catch { /* ignore */ }
  const elapsed = session.playback_is_playing && session.playback_updated_at ? Date.now() - session.playback_updated_at : 0;
  return Math.max(0, Math.min(duration, session.playback_progress_ms + elapsed));
}

function trackFromRequest(request: MusicRequestPayload): PublicTrack {
  return {
    id: request.trackId,
    uri: request.trackUri,
    name: request.name,
    artist: request.artist,
    album: request.album || '',
    imageUrl: request.imageUrl,
    durationMs: request.durationMs,
  };
}

async function rescheduleQueue(groupId: string, session: MusicSessionRow): Promise<void> {
  if (!session.current_track_uri || !session.playback_is_playing) return;
  let durationMs = 0;
  try { durationMs = Number(JSON.parse(session.current_track_json || '{}').durationMs || 0); } catch { /* ignore */ }
  const uris = requestRows(session.id).filter((entry) => entry.status === 'queued').map((entry) => entry.trackUri);
  await issueMusicControllerCommand(groupId, 'scheduleQueue', {
    deviceId: session.device_id,
    uris,
    delayMs: Math.max(0, durationMs - currentProgress(session) - 250),
  });
}

function musicChanged(groupId: string): void {
  broadcast(Events.musicChanged, { groupId }, { groupId });
}

musicRouter.get('/status', (req, res) => {
  const groupId = req.group!.id;
  const player = activePlayer(req);
  res.json({
    controller: controllerSummary(groupId),
    session: sessionPayload(activeSession(groupId)),
    canManageController: Boolean(player && mayManageController(req, player)),
  });
});

musicRouter.post('/pairing', ...withBodyPlayerIdentity, (req, res) => {
  const player = activePlayer(req);
  if (!player) return res.status(404).json({ error: 'Spieler nicht gefunden.' });
  if (!mayManageController(req, player)) return res.status(403).json({ error: 'Nur Gruppen-Admins können den Jam-Controller koppeln.' });
  if (activeSession(req.group!.id)) return res.status(409).json({ error: 'Laufenden Jam zuerst beenden.' });
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const code = Array.from(randomBytes(8), (byte) => alphabet[byte % alphabet.length]).join('');
  const now = Date.now();
  db.transaction(() => {
    db.prepare('DELETE FROM music_controller_pairings WHERE expires_at <= ? OR group_id = ?').run(now, req.group!.id);
    db.prepare(
      'INSERT INTO music_controller_pairings (code_hash, group_id, created_by, expires_at, created_at) VALUES (?, ?, ?, ?, ?)',
    ).run(hash(code), req.group!.id, player.id, now + PAIRING_TTL_MS, now);
  })();
  res.json({ code, expiresAt: now + PAIRING_TTL_MS, controllerUrl: 'http://127.0.0.1:43821' });
});

musicRouter.post('/controller-package', ...withBodyPlayerIdentity, (req, res) => {
  const player = activePlayer(req);
  if (!player) return res.status(404).json({ error: 'Spieler nicht gefunden.' });
  if (!mayManageController(req, player)) return res.status(403).json({ error: 'Nur Gruppen-Admins können den Jam-Controller koppeln.' });
  const pairingCode = typeof req.body?.pairingCode === 'string' ? req.body.pairingCode.trim().toUpperCase() : '';
  const pairing = pairingCode
    ? db.prepare(
        `SELECT group_id AS groupId, created_by AS createdBy, expires_at AS expiresAt
         FROM music_controller_pairings WHERE code_hash = ?`,
      ).get(hash(pairingCode)) as { groupId: string; createdBy: string | null; expiresAt: number } | undefined
    : undefined;
  if (
    !pairing || pairing.groupId !== req.group!.id || pairing.createdBy !== player.id || pairing.expiresAt <= Date.now()
  ) {
    return res.status(400).json({ error: 'Kopplungscode ist ungültig oder abgelaufen.' });
  }
  if (!fs.existsSync(CONTROLLER_SCRIPT_PATH)) {
    return res.status(503).json({ error: 'Das Controller-Paket ist auf diesem Server nicht verfügbar.' });
  }

  const setup = buildControllerSetup({
    respawnBaseUrl: resolveAgentServerUrl(req.protocol, req.get('host') ?? ''),
    pairingCode,
    accessToken: config.authMode === 'legacy' ? config.accessToken : '',
  });
  res.attachment('Respawn-Jam-Controller.zip');
  res.set('Content-Type', 'application/zip');
  const archive = archiver('zip', { zlib: { level: 9 } });
  archive.on('error', (error: Error) => {
    // eslint-disable-next-line no-console
    console.error('Fehler beim Erstellen des Jam-Controller-Downloads:', error);
    res.end();
  });
  archive.pipe(res);
  archive.file(CONTROLLER_SCRIPT_PATH, { name: 'jam-controller.mjs' });
  archive.append(JSON.stringify(setup, null, 2), { name: 'controller-setup.json' });
  archive.append(buildUnixLauncher(), { name: 'Start-macOS.command', mode: 0o755 });
  archive.append(buildUnixLauncher(), { name: 'start-linux.sh', mode: 0o755 });
  archive.append(buildWindowsLauncher(), { name: 'Start-Windows.cmd' });
  archive.append(buildWindowsPowerShell(), { name: 'start-windows.ps1' });
  archive.append(buildControllerReadme(), { name: 'README.txt' });
  void archive.finalize();
});

musicRouter.delete('/controller', ...withBodyPlayerIdentity, (req, res) => {
  const player = activePlayer(req);
  if (!player) return res.status(404).json({ error: 'Spieler nicht gefunden.' });
  if (!mayManageController(req, player)) return res.status(403).json({ error: 'Nur Gruppen-Admins können den Jam-Controller entkoppeln.' });
  if (activeSession(req.group!.id)) return res.status(409).json({ error: 'Laufenden Jam zuerst beenden.' });
  db.prepare('DELETE FROM music_controllers WHERE group_id = ?').run(req.group!.id);
  musicChanged(req.group!.id);
  res.status(204).end();
});

musicRouter.get('/devices', asyncRoute(async (req, res) => {
  const data = await issueMusicControllerCommand<{ devices?: unknown[] }>(req.group!.id, 'devices');
  const devices = (Array.isArray(data?.devices) ? data.devices : []).flatMap((value) => {
    if (!value || typeof value !== 'object') return [];
    const item = value as Record<string, unknown>;
    if (typeof item.id !== 'string' || typeof item.name !== 'string') return [];
    return [{ id: item.id, name: item.name, type: typeof item.type === 'string' ? item.type : '', active: Boolean(item.active) }];
  });
  res.json({ devices });
}));

musicRouter.post('/sessions', ...withBodyPlayerIdentity, asyncRoute(async (req, res) => {
  const player = activePlayer(req);
  if (!player) return res.status(404).json({ error: 'Spieler nicht gefunden.' });
  if (!controllerSummary(req.group!.id)?.online) return res.status(409).json({ error: 'Jam-Controller ist nicht erreichbar.' });
  if (activeSession(req.group!.id)) return res.status(409).json({ error: 'Es läuft bereits ein Jam.' });
  const deviceId = req.body?.deviceId;
  if (typeof deviceId !== 'string' || !deviceId) return res.status(400).json({ error: 'Spotify-Gerät auswählen.' });
  const data = await issueMusicControllerCommand<{ devices?: Array<Record<string, unknown>> }>(req.group!.id, 'devices');
  const device = data.devices?.find((entry) => entry.id === deviceId);
  if (!device || typeof device.name !== 'string') return res.status(404).json({ error: 'Spotify-Gerät ist nicht mehr verfügbar.' });
  const session: MusicSessionRow = {
    id: nanoid(), group_id: req.group!.id, host_player_id: player.id, device_id: deviceId,
    device_name: device.name, status: 'active', current_track_uri: null, current_track_json: null,
    playback_is_playing: 0, playback_progress_ms: 0, playback_updated_at: null,
    started_at: Date.now(), ended_at: null,
  };
  db.prepare(
    `INSERT INTO music_sessions (id, group_id, host_player_id, device_id, device_name, status, started_at)
     VALUES (?, ?, ?, ?, ?, 'active', ?)`,
  ).run(session.id, session.group_id, session.host_player_id, session.device_id, session.device_name, session.started_at);
  musicChanged(req.group!.id);
  res.status(201).json(sessionPayload(session));
}));

musicRouter.get('/search', asyncRoute(async (req, res) => {
  if (!activeSession(req.group!.id)) return res.status(409).json({ error: 'Kein Jam aktiv.' });
  const query = typeof req.query.q === 'string' ? req.query.q.trim() : '';
  if (query.length < 2 || query.length > 80) return res.status(400).json({ error: 'Suche muss zwischen 2 und 80 Zeichen lang sein.' });
  const data = await issueMusicControllerCommand<{ tracks?: unknown[] }>(req.group!.id, 'search', { query });
  res.json({ tracks: (data.tracks ?? []).map(validTrack).filter(Boolean) });
}));

musicRouter.post('/requests', ...withBodyPlayerIdentity, asyncRoute(async (req, res) => {
  const player = activePlayer(req);
  const session = activeSession(req.group!.id);
  if (!player || !session) return res.status(404).json({ error: 'Jam nicht gefunden.' });
  const trackId = req.body?.trackId;
  if (typeof trackId !== 'string' || !/^[A-Za-z0-9]{22}$/.test(trackId)) return res.status(400).json({ error: 'Ungültiger Spotify-Titel.' });
  const track = validTrack(await issueMusicControllerCommand(req.group!.id, 'track', { trackId }));
  if (!track) return res.status(404).json({ error: 'Spotify-Titel nicht gefunden.' });
  const requestId = nanoid();
  try {
    db.prepare(
      `INSERT INTO music_requests
       (id, session_id, track_uri, track_id, track_name, artist_name, album_name, image_url, duration_ms,
        requested_by, requested_by_name_snapshot, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'sending', ?)`,
    ).run(requestId, session.id, track.uri, track.id, track.name, track.artist, track.album || null, track.imageUrl,
      track.durationMs, player.id, player.name, nextRequestCreatedAt(session.id));
  } catch (error) {
    if (error instanceof Error && error.message.includes('UNIQUE')) return res.status(409).json({ error: 'Dieser Titel steht bereits in der Warteschlange.' });
    throw error;
  }
  try {
    if (!session.current_track_uri) {
      await issueMusicControllerCommand(req.group!.id, 'playUris', { deviceId: session.device_id, uris: [track.uri] });
      const now = Date.now();
      db.prepare("UPDATE music_requests SET status = 'playing' WHERE id = ?").run(requestId);
      db.prepare(
        `UPDATE music_sessions SET current_track_uri = ?, current_track_json = ?, playback_is_playing = 1,
         playback_progress_ms = 0, playback_updated_at = ? WHERE id = ?`,
      ).run(track.uri, JSON.stringify(track), now, session.id);
      await rescheduleQueue(req.group!.id, activeSession(req.group!.id)!);
    } else {
      await issueMusicControllerCommand(req.group!.id, 'queueTrack', { deviceId: session.device_id, uri: track.uri });
      db.prepare("UPDATE music_requests SET status = 'queued' WHERE id = ?").run(requestId);
      await rescheduleQueue(req.group!.id, activeSession(req.group!.id)!);
    }
  } catch (error) {
    db.prepare("UPDATE music_requests SET status = 'failed' WHERE id = ?").run(requestId);
    throw error;
  }
  musicChanged(req.group!.id);
  res.status(201).json({ requestId, ...track, requestedBy: player.id, requestedByName: player.name });
}));

musicRouter.delete('/requests/:requestId', ...withBodyPlayerIdentity, asyncRoute(async (req, res) => {
  const player = activePlayer(req);
  const session = activeSession(req.group!.id);
  if (!player || !session) return res.status(404).json({ error: 'Jam nicht gefunden.' });
  const row = db.prepare("SELECT id FROM music_requests WHERE id = ? AND session_id = ? AND status = 'queued'")
    .get(req.params.requestId, session.id);
  if (!row) return res.status(404).json({ error: 'Songwunsch nicht gefunden.' });
  db.prepare('DELETE FROM music_requests WHERE id = ? AND session_id = ?').run(req.params.requestId, session.id);
  await rescheduleQueue(req.group!.id, activeSession(req.group!.id)!);
  musicChanged(req.group!.id);
  res.status(204).end();
}));

musicRouter.put('/requests/order', ...withBodyPlayerIdentity, asyncRoute(async (req, res) => {
  const player = activePlayer(req);
  const session = activeSession(req.group!.id);
  if (!player || !session) return res.status(404).json({ error: 'Jam nicht gefunden.' });
  const requestIds = req.body?.requestIds;
  const queued = requestRows(session.id).filter((entry) => entry.status === 'queued');
  const expected = new Set(queued.map((entry) => entry.id));
  if (!Array.isArray(requestIds) || requestIds.some((id) => typeof id !== 'string') ||
      requestIds.length !== expected.size || new Set(requestIds).size !== requestIds.length ||
      requestIds.some((id) => !expected.has(id))) {
    return res.status(409).json({ error: 'Die Warteschlange hat sich geändert. Bitte erneut sortieren.' });
  }
  const base = Date.now() - requestIds.length;
  db.transaction(() => {
    const update = db.prepare('UPDATE music_requests SET created_at = ? WHERE id = ? AND session_id = ?');
    requestIds.forEach((id, index) => update.run(base + index, id, session.id));
  })();
  await rescheduleQueue(req.group!.id, activeSession(req.group!.id)!);
  musicChanged(req.group!.id);
  res.json({ requests: requestRows(session.id) });
}));

musicRouter.post('/skip', ...withBodyPlayerIdentity, asyncRoute(async (req, res) => {
  const player = activePlayer(req);
  const session = activeSession(req.group!.id);
  if (!player || !session) return res.status(404).json({ error: 'Jam nicht gefunden.' });
  const queued = requestRows(session.id).filter((entry) => entry.status === 'queued');
  const now = Date.now();
  db.prepare("UPDATE music_requests SET status = 'played', played_at = ? WHERE session_id = ? AND status = 'playing'").run(now, session.id);
  if (!queued.length) {
    await issueMusicControllerCommand(req.group!.id, 'pause', { deviceId: session.device_id });
    db.prepare(
      `UPDATE music_sessions SET current_track_uri = NULL, current_track_json = NULL, playback_is_playing = 0,
       playback_progress_ms = 0, playback_updated_at = ? WHERE id = ?`,
    ).run(now, session.id);
  } else {
    await issueMusicControllerCommand(req.group!.id, 'playUris', { deviceId: session.device_id, uris: queued.map((entry) => entry.trackUri) });
    const next = queued[0];
    db.prepare("UPDATE music_requests SET status = 'playing' WHERE id = ?").run(next.id);
    db.prepare(
      `UPDATE music_sessions SET current_track_uri = ?, current_track_json = ?, playback_is_playing = 1,
       playback_progress_ms = 0, playback_updated_at = ? WHERE id = ?`,
    ).run(next.trackUri, JSON.stringify(trackFromRequest(next)), now, session.id);
    await rescheduleQueue(req.group!.id, activeSession(req.group!.id)!);
  }
  musicChanged(req.group!.id);
  res.json({ ok: true });
}));

musicRouter.post('/playback', ...withBodyPlayerIdentity, asyncRoute(async (req, res) => {
  const player = activePlayer(req);
  const session = activeSession(req.group!.id);
  if (!player || !session) return res.status(404).json({ error: 'Jam nicht gefunden.' });
  const playing = req.body?.playing;
  if (typeof playing !== 'boolean') return res.status(400).json({ error: 'playing muss true oder false sein.' });
  await issueMusicControllerCommand(req.group!.id, playing ? 'resume' : 'pause', { deviceId: session.device_id });
  db.prepare('UPDATE music_sessions SET playback_is_playing = ?, playback_updated_at = ? WHERE id = ?')
    .run(playing ? 1 : 0, Date.now(), session.id);
  if (playing) await rescheduleQueue(req.group!.id, activeSession(req.group!.id)!);
  musicChanged(req.group!.id);
  res.json({ ok: true, playing });
}));

musicRouter.post('/end', ...withBodyPlayerIdentity, asyncRoute(async (req, res) => {
  const player = activePlayer(req);
  const session = activeSession(req.group!.id);
  if (!player || !session) return res.status(404).json({ error: 'Jam nicht gefunden.' });
  if (!mayControl(req, session, player.id)) return res.status(403).json({ error: 'Nur Host oder Gruppen-Admin.' });
  let warning: string | null = null;
  try {
    await issueMusicControllerCommand(req.group!.id, 'pause', { deviceId: session.device_id });
  } catch (error) {
    warning = 'Jam beendet. Spotify konnte auf dem Wiedergabegerät nicht automatisch pausiert werden.';
    // Ending Respawn's session must not depend on whether the selected Spotify
    // Connect device currently accepts the optional pause command.
    if (!(error instanceof MusicControllerError)) throw error;
  }
  const now = Date.now();
  db.transaction(() => {
    db.prepare("UPDATE music_sessions SET status = 'ended', ended_at = ? WHERE id = ?").run(now, session.id);
    db.prepare("UPDATE music_requests SET status = 'failed' WHERE session_id = ? AND status IN ('sending', 'queued')").run(session.id);
  })();
  musicChanged(req.group!.id);
  res.json({ ok: true, endedAt: now, warning });
}));

musicRouter.get('/kiosk', (req, res) => {
  res.json({ session: sessionPayload(activeSession(req.group!.id)) });
});
