import test from 'node:test';
import assert from 'node:assert/strict';
import {
  musicActiveSessionHtml,
  musicControllerRecoveryHtml,
  musicSearchResultsHtml,
  musicSetupHtml,
} from './views/music.js';

const searchResults = {
  tracks: [{
    id: 'AAAAAAAAAAAAAAAAAAAAAA',
    name: 'LAN <Anthem>',
    artist: 'Respawners',
    imageUrl: null,
  }],
  playlists: [{
    id: 'BBBBBBBBBBBBBBBBBBBBBB',
    name: 'All Night LAN',
    owner: 'DJ & Friends',
    imageUrl: null,
    trackCount: 42,
  }],
};

test('music search keeps tracks and playlists in one filterable result block', () => {
  const tracksHtml = musicSearchResultsHtml(searchResults);
  const playlistsHtml = musicSearchResultsHtml(searchResults, { resultType: 'playlists' });

  assert.match(tracksHtml, /aria-label="Suchergebnisse filtern"/);
  assert.match(tracksHtml, /class="btn music-result-type-button btn-primary" data-music-result-type="tracks" aria-pressed="true"/);
  assert.match(tracksHtml, /data-music-result-type="playlists" aria-pressed="false"/);
  assert.match(tracksHtml, /Titel \(1\)/);
  assert.match(tracksHtml, /Playlists \(1\)/);
  assert.match(tracksHtml, /data-music-add="AAAAAAAAAAAAAAAAAAAAAA">Hinzufügen/);
  assert.doesNotMatch(tracksHtml, /data-music-playlist=/);
  assert.match(tracksHtml, /LAN &lt;Anthem&gt;/);

  assert.match(playlistsHtml, /class="btn music-result-type-button btn-primary" data-music-result-type="playlists" aria-pressed="true"/);
  assert.match(playlistsHtml, /data-music-playlist="BBBBBBBBBBBBBBBBBBBBBB">Abspielen/);
  assert.doesNotMatch(playlistsHtml, /data-music-add=/);
  assert.match(playlistsHtml, /DJ &amp; Friends · 42 Titel/);
});

test('music search distinguishes loading and empty results', () => {
  assert.match(musicSearchResultsHtml(null, { loading: true }), /Spotify wird durchsucht/);
  assert.equal(musicSearchResultsHtml(null), '');
  assert.match(musicSearchResultsHtml({ tracks: [], playlists: [] }), /Keine Titel oder Playlists gefunden/);
});

test('music setup offers a pairing code independently from the controller download', () => {
  const initial = musicSetupHtml({ controller: null, canManageController: true }, null);
  assert.match(initial, /id="music-reconnect-controller"[^>]*>Vorhandenen Controller koppeln/);
  assert.match(initial, /id="music-download-controller"[^>]*>Controller erstmals herunterladen/);

  const repaired = musicSetupHtml(
    { controller: null, canManageController: true },
    { code: 'ABCDEFGH' },
  );
  assert.match(repaired, /id="music-pairing-value">ABCDEFGH/);
  assert.match(repaired, /id="music-reconnect-controller"[^>]*>Neuen Code erzeugen/);
  assert.match(repaired, /Wieder verbinden/);
});

test('music session places the queue directly below the current playback', () => {
  const html = musicActiveSessionHtml({
    warning: null,
    session: {
      currentTrack: null,
      playbackContext: null,
      requests: [],
      hostPlayerId: '',
      isPlaying: false,
      deviceName: 'LAN Boxen',
      progressMs: 0,
      playbackUpdatedAt: null,
    },
  });
  assert.ok(html.indexOf('Jetzt läuft') < html.indexOf('Als Nächstes'));
  assert.ok(html.indexOf('Als Nächstes') < html.indexOf('Musik suchen'));
});

test('music queue shows the remaining playlist tracks separately from requests', () => {
  const html = musicActiveSessionHtml({
    warning: null,
    session: {
      currentTrack: null,
      playbackContext: { name: 'LAN <Playlist>', remainingTrackCount: 4 },
      requests: [],
      hostPlayerId: '',
      isPlaying: true,
      deviceName: 'LAN Boxen',
      progressMs: 0,
      playbackUpdatedAt: null,
    },
  });
  assert.match(html, /4 Titel folgen/);
  assert.match(html, /aus „LAN &lt;Playlist&gt;“/);
  assert.match(html, /Keine zusätzlichen Songwünsche/);
});

test('music controller recovery distinguishes Spotify login from a transient outage', () => {
  const login = musicControllerRecoveryHtml({
    spotify: 'authorization_required',
    message: 'Token <abgelaufen>',
  });
  assert.match(login, /Spotify-Anmeldung erneuern/);
  assert.match(login, /Token &lt;abgelaufen&gt;/);
  assert.match(login, /127\.0\.0\.1:43821/);

  const outage = musicControllerRecoveryHtml({ spotify: 'unavailable', message: null });
  assert.match(outage, /automatisch erneut/);
  assert.match(outage, /Kein Skript-Neustart nötig/);
  assert.equal(musicControllerRecoveryHtml({ spotify: 'connected', message: null }), '');
});
