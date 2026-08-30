import { createHash, randomBytes } from 'crypto';
import { NextFunction, Request, RequestHandler, Response, Router } from 'express';
import fs from 'fs';
import path from 'path';
import archiver from 'archiver';
import { nanoid } from 'nanoid';
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
import { requireGroupEventAccess, resolveRequestGroupEventScope } from '../groupEventScope';

export const musicRouter = Router();

musicRouter.use((req, res, next) => {
  const scope = resolveRequestGroupEventScope(req, req.query.eventId ?? req.body?.eventId);
  if (!scope.ok) return res.status(scope.status).json({ error: scope.error });
  if (!requireGroupEventAccess(req, res, scope.eventId)) return;
  if (!scope.eventId) return res.status(404).json({ error: 'Event nicht gefunden.' });
  res.locals.eventId = scope.eventId;
  next();
});

const PAIRING_TTL_MS = 10 * 60 * 1000;
const PLAYLIST_SEARCH_TTL_MS = 10 * 60 * 1000;
const MAX_CACHED_PLAYLISTS = 200;
const CONTROLLER_SCRIPT_PATH = path.join(__dirname, '..', '..', 'scripts', 'jam-controller.mjs');

interface MusicSessionRow {
  id: string;
  group_id: string;
  event_id: string;
  host_player_id: string;
  device_id: string;
  device_name: string;
  status: 'active' | 'ended';
  current_track_uri: string | null;
  current_track_json: string | null;
  playback_context_json: string | null;
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

interface PublicPlaylist {
  id: string;
  uri: string;
  name: string;
  owner: string;
  imageUrl: string | null;
  trackCount: number;
}

interface PublicPlaybackContext extends PublicPlaylist {
  remainingTrackCount: number;
}

interface CachedPlaylist {
  groupId: string;
  playlist: PublicPlaylist;
  expiresAt: number;
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

const playlistSearchCache = new Map<string, CachedPlaylist>();

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
  return req.player?.id ?? null;
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

function activeSession(groupId: string, eventId: string): MusicSessionRow | undefined {
  return db.prepare("SELECT * FROM music_sessions WHERE group_id = ? AND event_id = ? AND status = 'active'").get(groupId, eventId) as
    | MusicSessionRow
    | undefined;
}

function mayControl(req: Request, session: MusicSessionRow, playerId: string): boolean {
  return session.host_player_id === playerId || req.groupMembership?.role === 'owner' || req.groupMembership?.role === 'admin';
}

function mayManageController(req: Request, _player: { isAdmin: number }): boolean {
  return req.groupMembership?.role === 'owner' || req.groupMembership?.role === 'admin';
}

function optionalImageUrl(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > 2_048) return null;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.toString() : null;
  } catch {
    return null;
  }
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
    imageUrl: optionalImageUrl(track.imageUrl),
    durationMs: Number(track.durationMs),
  };
}

function validPlaylist(value: unknown): PublicPlaylist | null {
  if (!value || typeof value !== 'object') return null;
  const playlist = value as Record<string, unknown>;
  if (
    typeof playlist.id !== 'string' || !/^[A-Za-z0-9]{22}$/.test(playlist.id) ||
    playlist.uri !== `spotify:playlist:${playlist.id}` || typeof playlist.name !== 'string' ||
    typeof playlist.owner !== 'string' || !Number.isSafeInteger(playlist.trackCount) ||
    Number(playlist.trackCount) < 0
  ) return null;
  return {
    id: playlist.id,
    uri: playlist.uri,
    name: playlist.name.slice(0, 300),
    owner: playlist.owner.slice(0, 300),
    imageUrl: optionalImageUrl(playlist.imageUrl),
    trackCount: Number(playlist.trackCount),
  };
}

function playlistCacheKey(groupId: string, playlistId: string): string {
  return `${groupId}:${playlistId}`;
}

function prunePlaylistSearchCache(now = Date.now()): void {
  for (const [key, entry] of playlistSearchCache) {
    if (entry.expiresAt <= now) playlistSearchCache.delete(key);
  }
  while (playlistSearchCache.size > MAX_CACHED_PLAYLISTS) {
    const oldestKey = playlistSearchCache.keys().next().value as string | undefined;
    if (!oldestKey) break;
    playlistSearchCache.delete(oldestKey);
  }
}

function rememberPlaylists(groupId: string, playlists: PublicPlaylist[]): void {
  const expiresAt = Date.now() + PLAYLIST_SEARCH_TTL_MS;
  prunePlaylistSearchCache();
  for (const playlist of playlists) {
    playlistSearchCache.set(playlistCacheKey(groupId, playlist.id), { groupId, playlist, expiresAt });
  }
  prunePlaylistSearchCache();
}

function cachedPlaylist(groupId: string, playlistId: string): PublicPlaylist | null {
  prunePlaylistSearchCache();
  const cached = playlistSearchCache.get(playlistCacheKey(groupId, playlistId));
  return cached?.groupId === groupId ? cached.playlist : null;
}

function playbackContext(session: MusicSessionRow): PublicPlaybackContext | null {
  try {
    const stored = session.playback_context_json ? JSON.parse(session.playback_context_json) as Record<string, unknown> : null;
    const playlist = validPlaylist(stored);
    if (!playlist) return null;
    const fallback = Math.max(0, playlist.trackCount - (session.current_track_uri ? 1 : 0));
    const remainingTrackCount = Number.isSafeInteger(stored?.remainingTrackCount)
      ? Math.max(0, Math.min(playlist.trackCount, Number(stored?.remainingTrackCount)))
      : fallback;
    return { ...playlist, remainingTrackCount };
  } catch {
    return null;
  }
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
    playbackContext: playbackContext(session),
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
  if (!session.current_track_uri || !session.playback_is_playing || playbackContext(session)) return;
  let durationMs = 0;
  try { durationMs = Number(JSON.parse(session.current_track_json || '{}').durationMs || 0); } catch { /* ignore */ }
  const uris = requestRows(session.id).filter((entry) => entry.status === 'queued').map((entry) => entry.trackUri);
  await issueMusicControllerCommand(groupId, 'scheduleQueue', {
    deviceId: session.device_id,
    uris,
    delayMs: Math.max(0, durationMs - currentProgress(session) - 250),
  });
}

function musicChanged(groupId: string, eventId: string): void {
  broadcast(Events.musicChanged, { groupId, eventId }, { groupId, eventId });
}

function activeGroupSession(groupId: string): MusicSessionRow | undefined {
  return db.prepare("SELECT * FROM music_sessions WHERE group_id = ? AND status = 'active'").get(groupId) as
    | MusicSessionRow
    | undefined;
}

function activeSessionConflict(groupId: string, eventId: string): string | undefined {
  const session = activeGroupSession(groupId);
  if (!session) return undefined;
  return session.event_id === eventId
    ? 'In diesem Event läuft bereits ein Jam.'
    : 'In einem anderen Event läuft bereits ein Jam. Wechsle dorthin, um ihn zu beenden.';
}

function requestEventId(res: Response): string {
  return res.locals.eventId as string;
}

function requestActiveSession(req: Request, res: Response): MusicSessionRow | undefined {
  return activeSession(req.group!.id, requestEventId(res));
}

musicRouter.get('/status', (req, res) => {
  const groupId = req.group!.id;
  const player = activePlayer(req);
  res.json({
    controller: controllerSummary(groupId),
    session: sessionPayload(activeSession(groupId, requestEventId(res))),
    canManageController: Boolean(player && mayManageController(req, player)),
  });
});

musicRouter.post('/pairing', ...withBodyPlayerIdentity, (req, res) => {
  const player = activePlayer(req);
  if (!player) return res.status(404).json({ error: 'Spieler nicht gefunden.' });
  if (!mayManageController(req, player)) return res.status(403).json({ error: 'Nur Gruppen-Admins können den Jam-Controller koppeln.' });
  if (activeGroupSession(req.group!.id) && controllerSummary(req.group!.id)?.online) {
    return res.status(409).json({ error: 'Der verbundene Jam-Controller ist bereits erreichbar.' });
  }
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
    accessToken: '',
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
  if (activeGroupSession(req.group!.id)) return res.status(409).json({ error: 'Laufenden Jam zuerst beenden.' });
  db.prepare('DELETE FROM music_controllers WHERE group_id = ?').run(req.group!.id);
  musicChanged(req.group!.id, requestEventId(res));
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
  const conflict = activeSessionConflict(req.group!.id, requestEventId(res));
  if (conflict) return res.status(409).json({ error: conflict });
  const deviceId = req.body?.deviceId;
  if (typeof deviceId !== 'string' || !deviceId) return res.status(400).json({ error: 'Spotify-Gerät auswählen.' });
  const data = await issueMusicControllerCommand<{ devices?: Array<Record<string, unknown>> }>(req.group!.id, 'devices');
  const device = data.devices?.find((entry) => entry.id === deviceId);
  if (!device || typeof device.name !== 'string') return res.status(404).json({ error: 'Spotify-Gerät ist nicht mehr verfügbar.' });
  const deviceName = device.name;
  const eventId = requestEventId(res);
  // The controller round trip above is a real await: the requested event can
  // end (and release its own session, see endActiveMusicSession in
  // events.ts) or another request can grab the group-wide session lock while
  // this one is suspended. Recheck both and insert inside one synchronous
  // transaction so nothing can interleave between the recheck and the write.
  const session = db.transaction((): MusicSessionRow | null => {
    const event = db.prepare('SELECT ended_at FROM events WHERE id = ?').get(eventId) as { ended_at: number | null } | undefined;
    if (!event || event.ended_at !== null) return null;
    if (activeSessionConflict(req.group!.id, eventId)) return null;
    const row: MusicSessionRow = {
      id: nanoid(), group_id: req.group!.id, event_id: eventId, host_player_id: player.id, device_id: deviceId,
      device_name: deviceName, status: 'active', current_track_uri: null, current_track_json: null,
      playback_context_json: null,
      playback_is_playing: 0, playback_progress_ms: 0, playback_updated_at: null,
      started_at: Date.now(), ended_at: null,
    };
    db.prepare(
      `INSERT INTO music_sessions (id, group_id, event_id, host_player_id, device_id, device_name, status, started_at)
       VALUES (?, ?, ?, ?, ?, ?, 'active', ?)`,
    ).run(row.id, row.group_id, row.event_id, row.host_player_id, row.device_id, row.device_name, row.started_at);
    return row;
  })();
  if (!session) return res.status(409).json({ error: 'Event ist inzwischen beendet oder es läuft bereits ein anderer Jam.' });
  musicChanged(req.group!.id, eventId);
  res.status(201).json(sessionPayload(session));
}));

musicRouter.patch('/sessions/device', asyncRoute(async (req, res) => {
  const session = requestActiveSession(req, res);
  if (!session) return res.status(404).json({ error: 'Jam nicht gefunden.' });
  if (!controllerSummary(req.group!.id)?.online) return res.status(409).json({ error: 'Jam-Controller ist nicht erreichbar.' });
  const deviceId = req.body?.deviceId;
  if (typeof deviceId !== 'string' || !deviceId) return res.status(400).json({ error: 'Spotify-Gerät auswählen.' });
  if (deviceId === session.device_id) return res.json(sessionPayload(session));

  const data = await issueMusicControllerCommand<{ devices?: Array<Record<string, unknown>> }>(req.group!.id, 'devices');
  const device = data.devices?.find((entry) => entry.id === deviceId);
  if (!device || typeof device.name !== 'string') return res.status(404).json({ error: 'Spotify-Gerät ist nicht mehr verfügbar.' });
  if (device.name !== session.device_name) {
    return res.status(409).json({ error: 'Nur das bisherige Browser-Musikgerät kann wieder verbunden werden.' });
  }
  const currentSession = requestActiveSession(req, res);
  if (currentSession?.id !== session.id) return res.status(409).json({ error: 'Der Jam wurde inzwischen beendet.' });

  await issueMusicControllerCommand(req.group!.id, 'transfer', {
    deviceId,
    playing: Boolean(currentSession.playback_is_playing),
  });
  const updated = db.prepare(
    "UPDATE music_sessions SET device_id = ?, device_name = ? WHERE id = ? AND status = 'active'",
  ).run(deviceId, device.name, session.id);
  if (updated.changes !== 1) {
    try { await issueMusicControllerCommand(req.group!.id, 'pause', { deviceId }); } catch { /* best effort */ }
    return res.status(409).json({ error: 'Der Jam wurde inzwischen beendet.' });
  }
  const recoveredSession = requestActiveSession(req, res)!;
  await rescheduleQueue(req.group!.id, recoveredSession);
  musicChanged(req.group!.id, requestEventId(res));
  res.json(sessionPayload(recoveredSession));
}));

musicRouter.get('/search', asyncRoute(async (req, res) => {
  if (!requestActiveSession(req, res)) return res.status(409).json({ error: 'Kein Jam aktiv.' });
  const query = typeof req.query.q === 'string' ? req.query.q.trim() : '';
  if (query.length < 2 || query.length > 80) return res.status(400).json({ error: 'Suche muss zwischen 2 und 80 Zeichen lang sein.' });
  const data = await issueMusicControllerCommand<{ tracks?: unknown[]; playlists?: unknown[] }>(req.group!.id, 'search', { query });
  const tracks = (Array.isArray(data?.tracks) ? data.tracks : []).map(validTrack).filter((track): track is PublicTrack => Boolean(track));
  const playlists = (Array.isArray(data?.playlists) ? data.playlists : [])
    .map(validPlaylist)
    .filter((playlist): playlist is PublicPlaylist => Boolean(playlist));
  rememberPlaylists(req.group!.id, playlists);
  res.json({ tracks, playlists });
}));

musicRouter.post('/playlists/:playlistId/play', ...withBodyPlayerIdentity, asyncRoute(async (req, res) => {
  const player = activePlayer(req);
  const session = requestActiveSession(req, res);
  if (!player || !session) return res.status(404).json({ error: 'Jam nicht gefunden.' });
  const playlistId = req.params.playlistId;
  if (!/^[A-Za-z0-9]{22}$/.test(playlistId)) return res.status(400).json({ error: 'Ungültige Spotify-Playlist.' });
  const playlist = cachedPlaylist(req.group!.id, playlistId);
  if (!playlist) return res.status(404).json({ error: 'Playlist bitte erneut suchen.' });

  await issueMusicControllerCommand(req.group!.id, 'playContext', {
    deviceId: session.device_id,
    uri: playlist.uri,
  });
  const now = Date.now();
  db.transaction(() => {
    db.prepare("UPDATE music_requests SET status = 'played', played_at = ? WHERE session_id = ? AND status = 'playing'")
      .run(now, session.id);
    db.prepare("UPDATE music_requests SET status = 'failed' WHERE session_id = ? AND status IN ('sending', 'queued')")
      .run(session.id);
    db.prepare(
      `UPDATE music_sessions SET current_track_uri = NULL, current_track_json = NULL,
       playback_context_json = ?, playback_is_playing = 1, playback_progress_ms = 0,
       playback_updated_at = ? WHERE id = ?`,
    ).run(JSON.stringify({
      ...playlist,
      remainingTrackCount: playlist.trackCount,
      observedTrackUri: null,
    }), now, session.id);
  })();
  musicChanged(req.group!.id, requestEventId(res));
  res.json({ playlist });
}));

musicRouter.post('/requests', ...withBodyPlayerIdentity, asyncRoute(async (req, res) => {
  const player = activePlayer(req);
  const session = requestActiveSession(req, res);
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
    if (!session.current_track_uri && !playbackContext(session)) {
      await issueMusicControllerCommand(req.group!.id, 'playUris', { deviceId: session.device_id, uris: [track.uri] });
      const now = Date.now();
      db.prepare("UPDATE music_requests SET status = 'playing' WHERE id = ?").run(requestId);
      db.prepare(
        `UPDATE music_sessions SET current_track_uri = ?, current_track_json = ?, playback_is_playing = 1,
         playback_progress_ms = 0, playback_updated_at = ? WHERE id = ?`,
      ).run(track.uri, JSON.stringify(track), now, session.id);
      await rescheduleQueue(req.group!.id, requestActiveSession(req, res)!);
    } else {
      await issueMusicControllerCommand(req.group!.id, 'queueTrack', { deviceId: session.device_id, uri: track.uri });
      db.prepare("UPDATE music_requests SET status = 'queued' WHERE id = ?").run(requestId);
      await rescheduleQueue(req.group!.id, requestActiveSession(req, res)!);
    }
  } catch (error) {
    db.prepare("UPDATE music_requests SET status = 'failed' WHERE id = ?").run(requestId);
    throw error;
  }
  musicChanged(req.group!.id, requestEventId(res));
  res.status(201).json({ requestId, ...track, requestedBy: player.id, requestedByName: player.name });
}));

musicRouter.delete('/requests/:requestId', ...withBodyPlayerIdentity, asyncRoute(async (req, res) => {
  const player = activePlayer(req);
  const session = requestActiveSession(req, res);
  if (!player || !session) return res.status(404).json({ error: 'Jam nicht gefunden.' });
  if (playbackContext(session)) {
    return res.status(409).json({ error: 'Songwünsche können während einer Playlist nicht entfernt werden.' });
  }
  const row = db.prepare("SELECT id FROM music_requests WHERE id = ? AND session_id = ? AND status = 'queued'")
    .get(req.params.requestId, session.id);
  if (!row) return res.status(404).json({ error: 'Songwunsch nicht gefunden.' });
  db.prepare('DELETE FROM music_requests WHERE id = ? AND session_id = ?').run(req.params.requestId, session.id);
  await rescheduleQueue(req.group!.id, requestActiveSession(req, res)!);
  musicChanged(req.group!.id, requestEventId(res));
  res.status(204).end();
}));

musicRouter.put('/requests/order', ...withBodyPlayerIdentity, asyncRoute(async (req, res) => {
  const player = activePlayer(req);
  const session = requestActiveSession(req, res);
  if (!player || !session) return res.status(404).json({ error: 'Jam nicht gefunden.' });
  if (playbackContext(session)) {
    return res.status(409).json({ error: 'Songwünsche laufen während einer Playlist in Eingangsreihenfolge.' });
  }
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
  await rescheduleQueue(req.group!.id, requestActiveSession(req, res)!);
  musicChanged(req.group!.id, requestEventId(res));
  res.json({ requests: requestRows(session.id) });
}));

musicRouter.post('/skip', ...withBodyPlayerIdentity, asyncRoute(async (req, res) => {
  const player = activePlayer(req);
  const session = requestActiveSession(req, res);
  if (!player || !session) return res.status(404).json({ error: 'Jam nicht gefunden.' });
  if (playbackContext(session)) {
    await issueMusicControllerCommand(req.group!.id, 'next', { deviceId: session.device_id });
    const now = Date.now();
    db.transaction(() => {
      db.prepare("UPDATE music_requests SET status = 'played', played_at = ? WHERE session_id = ? AND status = 'playing'")
        .run(now, session.id);
      db.prepare(
        `UPDATE music_sessions SET current_track_uri = NULL, current_track_json = NULL,
         playback_is_playing = 1, playback_progress_ms = 0, playback_updated_at = ? WHERE id = ?`,
      ).run(now, session.id);
    })();
    musicChanged(req.group!.id, requestEventId(res));
    res.json({ ok: true });
    return;
  }
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
    await rescheduleQueue(req.group!.id, requestActiveSession(req, res)!);
  }
  musicChanged(req.group!.id, requestEventId(res));
  res.json({ ok: true });
}));

musicRouter.post('/playback', ...withBodyPlayerIdentity, asyncRoute(async (req, res) => {
  const player = activePlayer(req);
  const session = requestActiveSession(req, res);
  if (!player || !session) return res.status(404).json({ error: 'Jam nicht gefunden.' });
  const playing = req.body?.playing;
  if (typeof playing !== 'boolean') return res.status(400).json({ error: 'playing muss true oder false sein.' });
  await issueMusicControllerCommand(req.group!.id, playing ? 'resume' : 'pause', { deviceId: session.device_id });
  db.prepare('UPDATE music_sessions SET playback_is_playing = ?, playback_updated_at = ? WHERE id = ?')
    .run(playing ? 1 : 0, Date.now(), session.id);
  if (playing) await rescheduleQueue(req.group!.id, requestActiveSession(req, res)!);
  musicChanged(req.group!.id, requestEventId(res));
  res.json({ ok: true, playing });
}));

musicRouter.post('/end', ...withBodyPlayerIdentity, asyncRoute(async (req, res) => {
  const player = activePlayer(req);
  const session = requestActiveSession(req, res);
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
  musicChanged(req.group!.id, requestEventId(res));
  res.json({ ok: true, endedAt: now, warning });
}));

musicRouter.get('/kiosk', (req, res) => {
  res.json({ session: sessionPayload(requestActiveSession(req, res)) });
});
