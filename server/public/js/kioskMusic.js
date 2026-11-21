import { escapeHtml } from './format.js';
import { icon } from './icons.js';

const SAME_TRACK_RESTART_GAP_MS = 10_000;

export function estimatedKioskMusicProgress(session, now = Date.now()) {
  if (!session?.currentTrack) return 0;
  const elapsed = session.isPlaying && session.playbackUpdatedAt ? now - session.playbackUpdatedAt : 0;
  return Math.max(
    0,
    Math.min(Number(session.currentTrack.durationMs || 0), Number(session.progressMs || 0) + elapsed),
  );
}

export function stabilizeKioskMusicSession(previousSession, nextSession, now = Date.now()) {
  if (!nextSession?.currentTrack) return nextSession;
  const incomingProgress = estimatedKioskMusicProgress(nextSession, now);
  const sameTrack = previousSession?.currentTrack?.uri === nextSession.currentTrack.uri;
  const previousProgress = sameTrack ? estimatedKioskMusicProgress(previousSession, now) : 0;
  const incomingSourceUpdatedAt = Number(nextSession.playbackUpdatedAt || 0);
  const previousSourceUpdatedAt = Number(
    previousSession?.sourcePlaybackUpdatedAt || previousSession?.playbackUpdatedAt || 0,
  );
  const restartedSameTrack = sameTrack
    && nextSession.isPlaying
    && incomingSourceUpdatedAt > previousSourceUpdatedAt
    && previousProgress - incomingProgress > SAME_TRACK_RESTART_GAP_MS;

  return {
    ...nextSession,
    progressMs: sameTrack && nextSession.isPlaying && !restartedSameTrack
      ? Math.max(previousProgress, incomingProgress)
      : incomingProgress,
    playbackUpdatedAt: now,
    sourcePlaybackUpdatedAt: incomingSourceUpdatedAt,
  };
}

function queuedRequests(session) {
  return (session?.requests || []).filter((entry) => entry.status === 'queued' || entry.status === 'sending');
}

function remainingPlaylistLabel(playlist) {
  if (!Number.isSafeInteger(playlist?.remainingTrackCount)) return 'Weitere Titel folgen';
  const count = Math.max(0, playlist.remainingTrackCount);
  if (count === 0) return 'Keine weiteren Playlist-Titel';
  return `${count} ${count === 1 ? 'Titel verbleibt' : 'Titel verbleiben'}`;
}

function requestCountLabel(count) {
  if (!count) return '';
  return `${count} ${count === 1 ? 'Songwunsch wartet' : 'Songwünsche warten'}`;
}

export function kioskMusicQueueKey(session) {
  const playlist = session?.playbackContext;
  const queued = queuedRequests(session);
  return JSON.stringify({
    next: playlist?.nextTrack?.uri || null,
    remaining: playlist?.remainingTrackCount ?? null,
    playlist: playlist?.uri || null,
    addedByName: playlist?.addedByName || null,
    requests: queued.map((entry) => `${entry.id}:${entry.status}`),
  });
}

export function kioskMusicQueueHtml(session) {
  const playlist = session?.playbackContext;
  const queued = queuedRequests(session);
  const nextTrack = playlist?.nextTrack || null;
  const nextRequest = nextTrack ? queued.find((entry) => entry.trackUri === nextTrack.uri) : null;

  if (nextTrack) {
    return `
      ${nextTrack.imageUrl ? `<img class="kiosk-music-cover" src="${escapeHtml(nextTrack.imageUrl)}" alt="" />` : `<span class="kiosk-music-cover kiosk-music-placeholder">${icon('music')}</span>`}
      <span class="kiosk-music-copy">
        <strong>${escapeHtml(nextTrack.name)}</strong>
        <span class="muted">${escapeHtml(nextTrack.artist)} · ${nextRequest ? `gewünscht von ${escapeHtml(nextRequest.requestedByName)}` : `aus „${escapeHtml(playlist.name)}“${playlist.addedByName ? ` · hinzugefügt von ${escapeHtml(playlist.addedByName)}` : ''}`}</span>
      </span>`;
  }

  if (playlist) {
    const requestLabel = requestCountLabel(queued.length);
    return `
      <span class="kiosk-music-copy">
        <strong>Playlist im Zufallsmodus</strong>
        <span class="muted">„${escapeHtml(playlist.name)}“${playlist.addedByName ? ` · hinzugefügt von ${escapeHtml(playlist.addedByName)}` : ''} · Spotify wählt den nächsten Titel · ${remainingPlaylistLabel(playlist)}${requestLabel ? ` · ${requestLabel}` : ''}</span>
      </span>`;
  }

  if (queued.length) {
    const request = queued[0];
    return `
      ${request.imageUrl ? `<img class="kiosk-music-cover" src="${escapeHtml(request.imageUrl)}" alt="" />` : `<span class="kiosk-music-cover kiosk-music-placeholder">${icon('music')}</span>`}
      <span class="kiosk-music-copy">
        <strong>${escapeHtml(request.name)}</strong>
        <span class="muted">${escapeHtml(request.artist)} · gewünscht von ${escapeHtml(request.requestedByName)}</span>
      </span>`;
  }

  return '<span class="kiosk-music-copy"><span class="muted">Keine weiteren Titel eingeplant.</span></span>';
}
