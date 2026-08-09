import { createHash, randomBytes } from 'crypto';
import { NextFunction, Request, Response, Router } from 'express';
import { db } from './db';
import { broadcast, Events } from './realtime';

export const musicControllerRouter = Router();

// Heartbeats run every three seconds, but one bounded Spotify refresh plus the
// following Respawn request may legitimately span several seconds on a weak
// LAN. Avoid presenting that recoverable delay as a dead controller.
const ONLINE_MS = 30_000;
const COMMAND_TIMEOUT_MS = 15_000;

interface ControllerRow {
  group_id: string;
  id: string;
  token_hash: string;
  label: string;
  spotify_display_name: string | null;
  last_seen: number;
  playback_json: string | null;
  connection_status_json: string | null;
}

interface ControllerConnectionStatus {
  spotify: 'connected' | 'authorization_required' | 'unavailable';
  message: string | null;
}

interface PendingCommand {
  id: string;
  groupId: string;
  type: string;
  payload: unknown;
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

const commandQueues = new Map<string, PendingCommand[]>();
const commandsById = new Map<string, PendingCommand>();

export class MusicControllerError extends Error {
  constructor(message: string, readonly status = 503) {
    super(message);
  }
}

function hash(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function controllerByToken(token: string | undefined): ControllerRow | undefined {
  if (!token) return undefined;
  return db.prepare('SELECT * FROM music_controllers WHERE token_hash = ?').get(hash(token)) as ControllerRow | undefined;
}

function controllerAuth(req: Request, res: Response, next: NextFunction): void {
  const row = controllerByToken(req.header('x-music-controller-token'));
  if (!row) {
    res.status(401).json({ error: 'Jam-Controller ist nicht autorisiert.' });
    return;
  }
  res.locals.musicController = row;
  next();
}

export function controllerSummary(groupId: string) {
  const row = db.prepare(
    `SELECT id, label, spotify_display_name AS spotifyDisplayName, last_seen AS lastSeen,
            connection_status_json AS connectionStatusJson
     FROM music_controllers WHERE group_id = ?`,
  ).get(groupId) as {
    id: string;
    label: string;
    spotifyDisplayName: string | null;
    lastSeen: number;
    connectionStatusJson: string | null;
  } | undefined;
  if (!row) return null;
  let connectionStatus: ControllerConnectionStatus | null = null;
  try { connectionStatus = validConnectionStatus(JSON.parse(row.connectionStatusJson || 'null')); } catch { /* old/stale status */ }
  const { connectionStatusJson: _connectionStatusJson, ...summary } = row;
  return { ...summary, connectionStatus, online: Date.now() - row.lastSeen <= ONLINE_MS };
}

function validConnectionStatus(value: unknown): ControllerConnectionStatus | null {
  if (!value || typeof value !== 'object') return null;
  const status = value as Record<string, unknown>;
  if (!['connected', 'authorization_required', 'unavailable'].includes(String(status.spotify))) return null;
  return {
    spotify: status.spotify as ControllerConnectionStatus['spotify'],
    message: typeof status.message === 'string' ? status.message.trim().slice(0, 240) || null : null,
  };
}

export function issueMusicControllerCommand<T = unknown>(groupId: string, type: string, payload: unknown = {}): Promise<T> {
  const controller = controllerSummary(groupId);
  if (!controller?.online) {
    return Promise.reject(new MusicControllerError('Der Jam-Controller ist nicht erreichbar.'));
  }
  return new Promise<T>((resolve, reject) => {
    const id = randomBytes(18).toString('base64url');
    const command: PendingCommand = {
      id,
      groupId,
      type,
      payload,
      resolve: resolve as (value: unknown) => void,
      reject,
      timer: setTimeout(() => {
        commandsById.delete(id);
        const queue = commandQueues.get(groupId);
        if (queue) commandQueues.set(groupId, queue.filter((entry) => entry.id !== id));
        reject(new MusicControllerError('Der Jam-Controller antwortet nicht.'));
      }, COMMAND_TIMEOUT_MS),
    };
    command.timer.unref();
    commandsById.set(id, command);
    commandQueues.set(groupId, [...(commandQueues.get(groupId) ?? []), command]);
  });
}

musicControllerRouter.post('/register', (req, res) => {
  const pairingCode = typeof req.body?.pairingCode === 'string' ? req.body.pairingCode.trim().toUpperCase() : '';
  const label = typeof req.body?.label === 'string' ? req.body.label.trim().slice(0, 80) : '';
  const spotifyDisplayName = typeof req.body?.spotifyDisplayName === 'string'
    ? req.body.spotifyDisplayName.trim().slice(0, 120)
    : null;
  if (!pairingCode || !label) return res.status(400).json({ error: 'Kopplungscode und Gerätename fehlen.' });
  const now = Date.now();
  const pairing = db.prepare(
    'SELECT group_id AS groupId, expires_at AS expiresAt FROM music_controller_pairings WHERE code_hash = ?',
  ).get(hash(pairingCode)) as { groupId: string; expiresAt: number } | undefined;
  if (!pairing || pairing.expiresAt <= now) return res.status(400).json({ error: 'Kopplungscode ist ungültig oder abgelaufen.' });

  const id = randomBytes(18).toString('base64url');
  const token = randomBytes(36).toString('base64url');
  db.transaction(() => {
    db.prepare(
      `INSERT INTO music_controllers
         (group_id, id, token_hash, label, spotify_display_name, last_seen, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(group_id) DO UPDATE SET
         id = excluded.id, token_hash = excluded.token_hash, label = excluded.label,
         spotify_display_name = excluded.spotify_display_name, last_seen = excluded.last_seen,
         playback_json = NULL, connection_status_json = NULL, updated_at = excluded.updated_at`,
    ).run(pairing.groupId, id, hash(token), label, spotifyDisplayName, now, now, now);
    db.prepare('DELETE FROM music_controller_pairings WHERE group_id = ?').run(pairing.groupId);
  })();
  broadcast(Events.musicChanged, { groupId: pairing.groupId }, { groupId: pairing.groupId });
  res.status(201).json({ controllerId: id, controllerToken: token, groupId: pairing.groupId });
});

musicControllerRouter.post('/heartbeat', controllerAuth, (req, res) => {
  const controller = res.locals.musicController as ControllerRow;
  const now = Date.now();
  const hasPlayback = Object.prototype.hasOwnProperty.call(req.body ?? {}, 'playback');
  const playback = hasPlayback ? req.body.playback ?? null : undefined;
  const connectionStatus = validConnectionStatus(req.body?.connectionStatus);
  const connectionStatusJson = connectionStatus ? JSON.stringify(connectionStatus) : controller.connection_status_json;
  const connectionStatusChanged = Boolean(connectionStatus) && connectionStatusJson !== controller.connection_status_json;
  const spotifyDisplayName = typeof req.body?.spotifyDisplayName === 'string'
    ? req.body.spotifyDisplayName.trim().slice(0, 120)
    : controller.spotify_display_name;
  if (hasPlayback) {
    db.prepare(
      `UPDATE music_controllers SET last_seen = ?, playback_json = ?, connection_status_json = ?,
       spotify_display_name = ?, updated_at = ? WHERE id = ?`,
    ).run(
      now,
      JSON.stringify(playback),
      connectionStatusJson,
      spotifyDisplayName,
      now,
      controller.id,
    );
    syncSessionPlayback(controller.group_id, playback, now);
  } else {
    db.prepare(
      `UPDATE music_controllers SET last_seen = ?, connection_status_json = ?,
       spotify_display_name = ?, updated_at = ? WHERE id = ?`,
    ).run(
      now,
      connectionStatusJson,
      spotifyDisplayName,
      now,
      controller.id,
    );
  }
  if (connectionStatusChanged) {
    broadcast(Events.musicChanged, { groupId: controller.group_id }, { groupId: controller.group_id });
  }
  res.json({ ok: true, serverTime: now });
});

musicControllerRouter.get('/commands', controllerAuth, (_req, res) => {
  const controller = res.locals.musicController as ControllerRow;
  const queue = commandQueues.get(controller.group_id) ?? [];
  const command = queue.shift();
  commandQueues.set(controller.group_id, queue);
  res.json({ command: command ? { id: command.id, type: command.type, payload: command.payload } : null });
});

musicControllerRouter.post('/commands/:id/result', controllerAuth, (req, res) => {
  const controller = res.locals.musicController as ControllerRow;
  const command = commandsById.get(req.params.id);
  if (!command || command.groupId !== controller.group_id) return res.status(404).json({ error: 'Befehl nicht gefunden.' });
  clearTimeout(command.timer);
  commandsById.delete(command.id);
  if (req.body?.ok === false) command.reject(new MusicControllerError(String(req.body?.error || 'Spotify-Befehl fehlgeschlagen.'), 502));
  else command.resolve(req.body?.data ?? null);
  res.status(204).end();
});

function syncSessionPlayback(groupId: string, playback: unknown, now: number): void {
  const session = db.prepare(
    "SELECT id, device_id, current_track_uri, playback_context_json FROM music_sessions WHERE group_id = ? AND status = 'active'",
  ).get(groupId) as
    | { id: string; device_id: string; current_track_uri: string | null; playback_context_json: string | null }
    | undefined;
  if (!session) return;
  const value = playback && typeof playback === 'object' ? playback as Record<string, unknown> : null;
  if (typeof value?.deviceId === 'string' && value.deviceId !== session.device_id) return;
  const track = value?.track && typeof value.track === 'object' ? value.track as Record<string, unknown> : null;
  const uri = typeof track?.uri === 'string' ? track.uri : null;
  const context = value?.context && typeof value.context === 'object' ? value.context as Record<string, unknown> : null;
  const matchingRequest = uri
    ? db.prepare(
        "SELECT id FROM music_requests WHERE session_id = ? AND track_uri = ? AND status IN ('sending', 'queued', 'playing') ORDER BY created_at LIMIT 1",
      ).get(session.id, uri) as { id: string } | undefined
    : undefined;
  let playbackContextJson = session.playback_context_json;
  if (playbackContextJson) {
    try {
      const stored = JSON.parse(playbackContextJson) as Record<string, unknown>;
      if (context?.type !== 'playlist' || context.uri !== stored.uri) {
        playbackContextJson = null;
      } else {
        const trackCount = Number.isSafeInteger(stored.trackCount) && Number(stored.trackCount) >= 0
          ? Number(stored.trackCount)
          : 0;
        let remainingTrackCount = Number.isSafeInteger(stored.remainingTrackCount)
          ? Math.max(0, Math.min(trackCount, Number(stored.remainingTrackCount)))
          : Math.max(0, trackCount - (session.current_track_uri ? 1 : 0));
        const observedTrackUri = typeof stored.observedTrackUri === 'string'
          ? stored.observedTrackUri
          : session.current_track_uri;
        if (uri && !matchingRequest && uri !== observedTrackUri) remainingTrackCount = Math.max(0, remainingTrackCount - 1);
        stored.remainingTrackCount = remainingTrackCount;
        stored.observedTrackUri = uri && !matchingRequest ? uri : observedTrackUri;
        playbackContextJson = JSON.stringify(stored);
      }
    } catch {
      playbackContextJson = null;
    }
  }
  db.transaction(() => {
    if (session.current_track_uri && session.current_track_uri !== uri) {
      db.prepare("UPDATE music_requests SET status = 'played', played_at = ? WHERE session_id = ? AND status = 'playing'")
        .run(now, session.id);
    }
    if (uri) {
      if (matchingRequest) db.prepare("UPDATE music_requests SET status = 'playing' WHERE id = ?").run(matchingRequest.id);
    }
    db.prepare(
      `UPDATE music_sessions SET current_track_uri = ?, current_track_json = ?, playback_is_playing = ?,
       playback_progress_ms = ?, playback_updated_at = ?, playback_context_json = ? WHERE id = ?`,
    ).run(
      uri,
      track ? JSON.stringify(track) : null,
      value?.isPlaying ? 1 : 0,
      Number.isSafeInteger(value?.progressMs) ? value?.progressMs : 0,
      now,
      playbackContextJson,
      session.id,
    );
  })();
  broadcast(Events.musicChanged, { groupId }, { groupId });
}
