import test from 'node:test';
import assert from 'node:assert/strict';
import {
  estimatedKioskMusicProgress,
  kioskMusicQueueHtml,
  kioskMusicQueueKey,
  stabilizeKioskMusicSession,
} from './kioskMusic.js';

const TRACK = {
  uri: 'spotify:track:SAME',
  name: 'Same song',
  artist: 'Same artist',
  durationMs: 200_000,
};

test('kiosk keeps normal Spotify progress jitter monotonic', () => {
  const previous = {
    currentTrack: TRACK,
    isPlaying: true,
    progressMs: 50_000,
    playbackUpdatedAt: 1_000,
    sourcePlaybackUpdatedAt: 900,
  };
  const next = {
    currentTrack: TRACK,
    isPlaying: true,
    progressMs: 48_000,
    playbackUpdatedAt: 1_100,
  };

  const stabilized = stabilizeKioskMusicSession(previous, next, 1_100);

  assert.equal(stabilized.progressMs, 50_100);
  assert.equal(stabilized.sourcePlaybackUpdatedAt, 1_100);
  assert.equal(estimatedKioskMusicProgress(stabilized, 1_600), 50_600);
});

test('kiosk accepts a newer restart of the same Spotify track', () => {
  const previous = {
    currentTrack: TRACK,
    isPlaying: true,
    progressMs: 180_000,
    playbackUpdatedAt: 1_000,
    sourcePlaybackUpdatedAt: 900,
  };
  const next = {
    currentTrack: TRACK,
    isPlaying: true,
    progressMs: 2_000,
    playbackUpdatedAt: 1_100,
  };

  const stabilized = stabilizeKioskMusicSession(previous, next, 1_100);

  assert.equal(stabilized.progressMs, 2_000);
  assert.equal(stabilized.playbackUpdatedAt, 1_100);
});

test('kiosk does not treat an older same-track snapshot as a restart', () => {
  const previous = {
    currentTrack: TRACK,
    isPlaying: true,
    progressMs: 180_000,
    playbackUpdatedAt: 1_000,
    sourcePlaybackUpdatedAt: 900,
  };
  const next = {
    currentTrack: TRACK,
    isPlaying: true,
    progressMs: 2_000,
    playbackUpdatedAt: 800,
  };

  assert.equal(stabilizeKioskMusicSession(previous, next, 1_100).progressMs, 180_100);
});

test('kiosk names the live next track when Spotify exposes one', () => {
  const html = kioskMusicQueueHtml({
      playbackContext: {
        name: 'LAN Playlist',
        addedByName: 'DJ Bob',
        nextTrack: {
        uri: 'spotify:track:NEXT',
        name: 'Der nächste Song',
        artist: 'Die Band',
        imageUrl: null,
      },
    },
    requests: [],
  });

  assert.match(html, /Der nächste Song/);
  assert.match(html, /aus „LAN Playlist“/);
  assert.match(html, /hinzugefügt von DJ Bob/);
  assert.doesNotMatch(html, /Zufallsmodus/);
  assert.doesNotMatch(html, /Als Nächstes/);
});

test('kiosk explains playlist shuffle when no next track is available', () => {
  const session = {
    playbackContext: {
      uri: 'spotify:playlist:LAN',
      name: 'LAN Playlist',
      remainingTrackCount: 7,
      nextTrack: null,
      addedByName: 'DJ Bob',
    },
    requests: [{ id: 'request-1', status: 'queued' }],
  };
  const html = kioskMusicQueueHtml(session);

  assert.match(html, /Playlist im Zufallsmodus/);
  assert.match(html, /Spotify wählt den nächsten Titel/);
  assert.match(html, /hinzugefügt von DJ Bob/);
  assert.match(html, /7 Titel verbleiben/);
  assert.match(html, /1 Songwunsch wartet/);
  assert.doesNotMatch(html, /Noch keine Songwünsche/);
  assert.doesNotMatch(html, /Als Nächstes/);
  assert.match(kioskMusicQueueKey(session), /spotify:playlist:LAN/);
});

test('kiosk reports an empty request queue without implying an empty playlist', () => {
  const html = kioskMusicQueueHtml({ playbackContext: null, requests: [] });
  assert.match(html, /Keine weiteren Titel eingeplant/);
  assert.doesNotMatch(html, /Noch keine Songwünsche/);
});
