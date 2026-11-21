import { createHash, randomBytes } from 'crypto';
import { NextFunction, Request, Response, Router } from 'express';
import { Server } from 'socket.io';
import { db } from './db';
import { broadcast, Events } from './realtime';

export const musicControllerRouter = Router();

// Heartbeats run every three seconds, but one bounded Spotify refresh plus the
// following Respawn request may legitimately span several seconds on a weak
// LAN. Avoid presenting that recoverable delay as a dead controller.
const ONLINE_MS = 30_000;
const COMMAND_TIMEOUT_MS = 15_000;
// A same-song restart must be clearly earlier than the expected position:
// heartbeats arrive every few seconds and Spotify reports progress coarsely.
const SAME_TRACK_RESTART_MS = 10_000;
// Spotify reports up to 20 queued songs; a few spare entries keep five
// visible after hiding removed requests.
const UPCOMING_TRACKS_REPORTED = 10;
const UPCOMING_TRACKS_SHOWN = 5;
export const MUSIC_CONTROLLER_RETENTION_MS = 24 * 60 * 60 * 1000;
const MUSIC_CONTROLLER_EXPIRY_SWEEP_MS = 6 * 60 * 60 * 1000;

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
  return {
    ...summary,
    connectionStatus,
    online: Date.now() - row.lastSeen <= ONLINE_MS,
    autoDisconnectAt: row.lastSeen + MUSIC_CONTROLLER_RETENTION_MS,
  };
}

export function expireInactiveMusicControllers(now = Date.now()): string[] {
  const rows = db.prepare(
    `SELECT mc.group_id AS groupId
     FROM music_controllers mc
     WHERE mc.last_seen <= ?
       AND NOT EXISTS (
         SELECT 1 FROM music_sessions ms
         WHERE ms.group_id = mc.group_id AND ms.status = 'active'
       )`,
  ).all(now - MUSIC_CONTROLLER_RETENTION_MS) as Array<{ groupId: string }>;
  if (!rows.length) return [];

  db.transaction(() => {
    for (const { groupId } of rows) {
      db.prepare('DELETE FROM music_controller_pairings WHERE group_id = ?').run(groupId);
      db.prepare('DELETE FROM music_controllers WHERE group_id = ?').run(groupId);
    }
  })();
  for (const { groupId } of rows) {
    broadcast(Events.musicChanged, { groupId }, { groupId });
  }
  return rows.map(({ groupId }) => groupId);
}

export function startMusicControllerExpiry(_io: Server): () => void {
  expireInactiveMusicControllers();
  const timer = setInterval(() => expireInactiveMusicControllers(), MUSIC_CONTROLLER_EXPIRY_SWEEP_MS);
  timer.unref();
  return () => clearInterval(timer);
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
  // Lets the controller ask Spotify for live playback only while a Jam runs:
  // every idle request still counts against the app's Spotify quota.
  const sessionActive = Boolean(
    db.prepare("SELECT 1 FROM music_sessions WHERE group_id = ? AND status = 'active' LIMIT 1").get(controller.group_id),
  );
  res.json({ ok: true, serverTime: now, sessionActive });
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

// One correction at a time per group: heartbeats keep reporting the foreign
// song until Spotify has actually paused or moved on, and each must not queue
// another command. A correction pauses, skips a removed request, or switches
// from a removed playlist to the waiting requests.
const foreignCorrectionsPending = new Set<string>();

function replaceForeignPlayback(groupId: string, type: 'pause' | 'next' | 'playUris', payload: Record<string, unknown>): void {
  if (foreignCorrectionsPending.has(groupId)) return;
  foreignCorrectionsPending.add(groupId);
  issueMusicControllerCommand(groupId, type, payload)
    .catch(() => { /* best effort: the next heartbeat retries */ })
    .finally(() => foreignCorrectionsPending.delete(groupId));
}

function syncSessionPlayback(groupId: string, playback: unknown, now: number): void {
  const session = db.prepare(
    `SELECT id, device_id, current_track_uri, playback_context_json, playback_progress_ms, playback_updated_at,
            playback_is_playing FROM music_sessions WHERE group_id = ? AND status = 'active'`,
  ).get(groupId) as
    | {
        id: string; device_id: string; current_track_uri: string | null; playback_context_json: string | null;
        playback_progress_ms: number; playback_updated_at: number | null; playback_is_playing: number;
      }
    | undefined;
  if (!session) return;
  const value = playback && typeof playback === 'object' ? playback as Record<string, unknown> : null;
  if (typeof value?.deviceId === 'string' && value.deviceId !== session.device_id) return;
  const track = value?.track && typeof value.track === 'object' ? value.track as Record<string, unknown> : null;
  const uri = typeof track?.uri === 'string' ? track.uri : null;
  const context = value?.context && typeof value.context === 'object' ? value.context as Record<string, unknown> : null;
  const reportedProgress = Number.isSafeInteger(value?.progressMs) ? Number(value?.progressMs) : 0;
  // The same song may be requested twice in a row. Its second copy starts
  // with the same URI, so a jump back to the start of a song that was well
  // underway, while another copy still waits, counts as the next request.
  const expectedProgress = session.playback_progress_ms +
    (session.playback_is_playing && session.playback_updated_at ? Math.max(0, now - session.playback_updated_at) : 0);
  const restartedSameTrack = Boolean(uri) && uri === session.current_track_uri &&
    reportedProgress + SAME_TRACK_RESTART_MS < expectedProgress &&
    Boolean(db.prepare(
      "SELECT 1 FROM music_requests WHERE session_id = ? AND track_uri = ? AND status IN ('sending', 'queued') LIMIT 1",
    ).get(session.id, uri));
  // The copy already playing keeps matching; after a restart the oldest
  // waiting copy takes over.
  const matchingRequest = uri
    ? db.prepare(
        `SELECT id FROM music_requests WHERE session_id = ? AND track_uri = ?
           AND status IN ('sending', 'queued', 'playing') AND (? = 0 OR status != 'playing')
         ORDER BY CASE status WHEN 'playing' THEN 0 ELSE 1 END, created_at LIMIT 1`,
      ).get(session.id, uri, restartedSameTrack ? 1 : 0) as { id: string } | undefined
    : undefined;
  let playbackContextJson = session.playback_context_json;
  // A playlist removed from the queue keeps a marker until Spotify has left
  // it: only the song that was playing at the removal may still finish.
  let removedPlaylistTrack = false;
  // A request removed during the playlist may already sit in Spotify's queue.
  let skipRemovedRequest = false;
  if (playbackContextJson) {
    try {
      const stored = JSON.parse(playbackContextJson) as Record<string, unknown>;
      const removed = stored.removedPlaylist && typeof stored.removedPlaylist === 'object'
        ? stored.removedPlaylist as { uri?: unknown; keepTrackUri?: unknown }
        : null;
      if (removed) {
        if (context?.type !== 'playlist' || context.uri !== removed.uri) playbackContextJson = null;
        else removedPlaylistTrack = Boolean(uri) && !matchingRequest && uri !== removed.keepTrackUri;
      } else if (context?.type !== 'playlist' || context.uri !== stored.uri) {
        playbackContextJson = null;
      } else if (uri && !matchingRequest && Array.isArray(stored.skipUris) && stored.skipUris.includes(uri)) {
        skipRemovedRequest = true;
        stored.skipUris = stored.skipUris.filter((entry) => entry !== uri);
        playbackContextJson = JSON.stringify(stored);
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
        // Requests removed during the playlist may still sit in Spotify's
        // queue; unless another copy is still wanted they are hidden here
        // too, so the preview shows what will actually be heard.
        const skipUris = new Set((Array.isArray(stored.skipUris) ? stored.skipUris : [])
          .filter((entry): entry is string => typeof entry === 'string')
          .filter((entry) => !db.prepare(
            "SELECT 1 FROM music_requests WHERE session_id = ? AND track_uri = ? AND status IN ('sending', 'queued') LIMIT 1",
          ).get(session.id, entry)));
        const visible = (entry: unknown): entry is Record<string, unknown> =>
          Boolean(entry) && typeof entry === 'object' && !skipUris.has(String((entry as Record<string, unknown>).uri));
        // Newer controllers report the next songs of Spotify's queue; older
        // ones only the next one.
        if (Array.isArray(value?.upcomingTracks)) {
          stored.upcomingTracks = value.upcomingTracks.slice(0, UPCOMING_TRACKS_REPORTED).filter(visible).slice(0, UPCOMING_TRACKS_SHOWN);
          stored.nextTrack = (stored.upcomingTracks as unknown[])[0] ?? null;
        } else {
          delete stored.upcomingTracks;
          stored.nextTrack = visible(value?.nextTrack) ? value?.nextTrack : null;
        }
        playbackContextJson = JSON.stringify(stored);
      }
    } catch {
      playbackContextJson = null;
    }
  }
  // A Jam plays only requests and a playlist started from Respawn. Anything
  // else on the Jam device while nothing is waiting (typically Spotify's own
  // autoplay after the last request, or after a controller restart lost the
  // planned pause) is stopped and not shown as the Jam's current song.
  const waitingRequests = (db.prepare(
    "SELECT COUNT(*) AS count FROM music_requests WHERE session_id = ? AND status IN ('sending', 'queued')",
  ).get(session.id) as { count: number }).count;
  const foreignTrack = removedPlaylistTrack || skipRemovedRequest || (Boolean(uri) && !matchingRequest &&
    !playbackContextJson && context?.type !== 'playlist' && waitingRequests === 0);
  if (foreignTrack && value?.isPlaying) {
    if (skipRemovedRequest) {
      replaceForeignPlayback(groupId, 'next', { deviceId: session.device_id });
    } else if (removedPlaylistTrack && waitingRequests > 0) {
      const uris = (db.prepare(
        "SELECT track_uri FROM music_requests WHERE session_id = ? AND status IN ('sending', 'queued') ORDER BY created_at",
      ).all(session.id) as Array<{ track_uri: string }>).map((row) => row.track_uri);
      replaceForeignPlayback(groupId, 'playUris', { deviceId: session.device_id, uris });
    } else {
      replaceForeignPlayback(groupId, 'pause', { deviceId: session.device_id });
    }
  }
  db.transaction(() => {
    if (session.current_track_uri && (session.current_track_uri !== uri || restartedSameTrack)) {
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
      foreignTrack ? null : uri,
      track && !foreignTrack ? JSON.stringify(track) : null,
      value?.isPlaying && !foreignTrack ? 1 : 0,
      Number.isSafeInteger(value?.progressMs) ? value?.progressMs : 0,
      now,
      playbackContextJson,
      session.id,
    );
  })();
  broadcast(Events.musicChanged, { groupId }, { groupId });
}
