import test from 'node:test';
import assert from 'node:assert/strict';
import {
  musicActiveSessionHtml,
  musicControllerManagementHtml,
  musicControllerRecoveryHtml,
  musicDevicePickerHtml,
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
  assert.match(tracksHtml, /music-result-type-button is-selected" data-music-result-type="tracks" aria-pressed="true"/);
  assert.match(tracksHtml, /data-music-result-type="playlists" aria-pressed="false"/);
  assert.doesNotMatch(tracksHtml, /btn-primary/);
  assert.doesNotMatch(tracksHtml, /\(1\)/);
  assert.match(tracksHtml, /data-music-add="AAAAAAAAAAAAAAAAAAAAAA">Hinzufügen/);
  assert.doesNotMatch(tracksHtml, /data-music-playlist=/);
  assert.match(tracksHtml, /LAN &lt;Anthem&gt;/);

  assert.match(playlistsHtml, /music-result-type-button is-selected" data-music-result-type="playlists" aria-pressed="true"/);
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
  assert.match(initial, /Musik-PC einrichten/);
  assert.match(initial, /Paket auf dem Musik-PC starten/);
  assert.match(initial, /class="btn btn-sm btn-primary" id="music-download-controller"[^>]*>Paket herunterladen/);
  assert.match(initial, /class="btn btn-sm" id="music-reconnect-controller"[^>]*>Code erzeugen/);
  assert.match(initial, /href="http:\/\/127\.0\.0\.1:43821"[^>]*>http:\/\/127\.0\.0\.1:43821/);
  assert.doesNotMatch(initial, /Controller öffnen/);
  assert.doesNotMatch(initial, /30 Tagen/);

  const repaired = musicSetupHtml(
    { controller: null, canManageController: true },
    { code: 'ABCDEFGH', expiresAt: Date.now() + 60_000 },
  );
  assert.match(repaired, /id="music-pairing-value">ABCDEFGH/);
  assert.match(repaired, /id="music-copy-pairing"/);
  assert.match(repaired, /10 Minuten gültig/);
  assert.doesNotMatch(repaired, /id="music-reconnect-controller"/);
  assert.match(repaired, /class="btn btn-sm" id="music-download-controller"/);

  const expired = musicSetupHtml(
    { controller: null, canManageController: true },
    { code: 'ABCDEFGH', expiresAt: Date.now() - 1 },
  );
  assert.doesNotMatch(expired, /ABCDEFGH/);
  assert.match(expired, /id="music-reconnect-controller"[^>]*>Code erzeugen/);

  const offline = musicSetupHtml(
    { controller: { label: 'Kiosk <Pi>', online: false }, canManageController: true },
    null,
  );
  assert.match(offline, /Musik-PC wieder verbinden/);
  assert.match(offline, /Kiosk &lt;Pi&gt;/);
  assert.match(offline, /class="btn btn-sm btn-primary" id="music-reconnect-controller"/);

  const member = musicSetupHtml({ controller: null, canManageController: false }, null);
  assert.match(member, /Ein Community-Admin richtet den Musik-PC ein\./);
  assert.doesNotMatch(member, /music-setup-steps/);
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
  assert.ok(html.indexOf('Als Nächstes') < html.indexOf('Musik hinzufügen'));
  assert.match(html, /Auf LAN Boxen läuft gerade kein Titel\./);
  assert.match(html, /Noch keine Wünsche\./);

  assert.match(musicControllerManagementHtml({
    controller: { online: false },
    canManageController: true,
    session: null,
  }), /id="music-disconnect">Entkoppeln/);
});

test('music queue shortens long titles and opens full requests from their row', () => {
  const longName = 'Symphony No. 9 in D Minor, Op. 125 <Choral> IV. Presto';
  const html = musicActiveSessionHtml({
    warning: null,
    session: {
      currentTrack: null,
      playbackContext: null,
      requests: [{
        id: 'req-1', status: 'queued', trackUri: 'spotify:track:A', name: longName, artist: 'Beethoven',
        requestedBy: 'p-2', requestedByName: 'Kim', durationMs: 1_520_000, imageUrl: null,
      }],
      hostPlayerId: '',
      isPlaying: true,
      deviceName: 'LAN Boxen',
      progressMs: 0,
      playbackUpdatedAt: null,
    },
  });
  assert.match(html, /data-music-detail="req-1" title="Symphony No\. 9 in D Minor, Op\. 125 &lt;Choral&gt; IV\. Presto">Symphony No\. 9 in D Minor, Op\. 125 &lt;Cho…</);
  assert.match(html, /music-queue-who" role="cell">Kim/);
  assert.match(html, /25:20/);
  assert.doesNotMatch(html, /data-music-remove|data-music-move/);
});

test('music session offers browser recovery after a reload changed the Spotify device id', () => {
  const html = musicActiveSessionHtml({
    warning: null,
    session: {
      deviceId: 'stale-browser-device',
      deviceName: 'Respawn · TV-PC',
      currentTrack: null,
      playbackContext: null,
      requests: [],
      hostPlayerId: '',
      isPlaying: false,
      progressMs: 0,
      playbackUpdatedAt: null,
    },
  }, { ready: true, playerName: 'Respawn · TV-PC', message: null });
  assert.match(html, /Browser-Ton wieder verbinden/);
  assert.match(html, /id="music-recover-local-player"/);
});

test('music queue shows the remaining playlist tracks separately from requests', () => {
  const html = musicActiveSessionHtml({
    warning: null,
    session: {
      currentTrack: null,
      playbackContext: {
        name: 'LAN <Playlist>',
        remainingTrackCount: 4,
        addedByName: 'DJ Bob',
        nextTrack: {
          uri: 'spotify:track:NEXT',
          name: 'Der nächste Song',
          artist: 'Die Band',
          imageUrl: null,
        },
      },
      requests: [],
      hostPlayerId: '',
      isPlaying: true,
      deviceName: 'LAN Boxen',
      progressMs: 0,
      playbackUpdatedAt: null,
    },
  });
  assert.match(html, /Der nächste Song/);
  assert.match(html, /Die Band/);
  assert.match(html, /music-queue-who" role="cell">Playlist/);
  assert.match(html, /3 weitere Titel aus der Playlist/);
  assert.match(html, /Playlist LAN &lt;Playlist&gt; startet auf LAN Boxen\./);
  assert.doesNotMatch(html, /Noch keine Wünsche/);
  assert.doesNotMatch(html, /draggable/);
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
  assert.doesNotMatch(outage, /Skript-Neustart/);
  assert.equal(musicControllerRecoveryHtml({ spotify: 'connected', message: null }), '');
});

test('music device picker offers local browser audio without pretending Bluetooth is Spotify Connect', () => {
  const html = musicDevicePickerHtml(
    [{ id: 'phone-1', name: 'Handy <Bob>', type: 'Smartphone', active: true }],
    { ready: true, playerName: 'Respawn · TV-PC', message: null },
  );

  assert.match(html, /Handy &lt;Bob&gt; · Smartphone/);
  assert.match(html, /id="music-start-local-player"/);
  assert.match(html, /Ton über diesen Browser, TV oder HDMI/);
  assert.match(html, /Bluetooth-Boxen sind kein eigenes Spotify-Gerät/);

  const needsPermission = musicDevicePickerHtml([], {
    ready: false,
    playerName: 'Respawn · TV-PC',
    message: 'Spotify <neu> freigeben.',
  });
  assert.match(needsPermission, /Spotify &lt;neu&gt; freigeben/);
  assert.match(needsPermission, /id="music-authorize-local-player"/);
  assert.match(needsPermission, /Spotify-Freigabe öffnen/);
  assert.doesNotMatch(needsPermission, /id="music-start-local-player"/);
});
