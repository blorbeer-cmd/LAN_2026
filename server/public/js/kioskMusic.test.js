import test from 'node:test';
import assert from 'node:assert/strict';
import { kioskMusicQueueHtml, kioskMusicQueueKey } from './kioskMusic.js';

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
  assert.match(kioskMusicQueueKey(session), /spotify:playlist:LAN/);
});

test('kiosk reports an empty request queue without implying an empty playlist', () => {
  const html = kioskMusicQueueHtml({ playbackContext: null, requests: [] });
  assert.match(html, /Keine weiteren Titel eingeplant/);
  assert.doesNotMatch(html, /Noch keine Songwünsche/);
});
