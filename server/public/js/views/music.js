import { api } from '../api.js';
import { escapeHtml } from '../format.js';
import { icon } from '../icons.js';
import { showToast } from '../toast.js';
import { getMyId } from '../whoami.js';
import { emptyStateHtml } from '../emptyState.js';
import { confirmDialog, openModal } from '../modal.js';
import {
  connectLocalSpotifyPlayer,
  localSpotifyPlaybackStatus,
  localSpotifyPlayerInfo,
  localSpotifySessionNeedsRecovery,
  preloadSpotifyPlaybackSdk,
  waitForLocalSpotifyPlaybackReady,
  LOCAL_CONTROLLER_URL,
} from '../spotifyBrowserPlayer.js';

let cache = null;
let cacheStale = true;
let loading = false;
let refreshTimer = null;
let progressFrame = null;
let searchQuery = '';
let searchResults = null;
let searchResultType = 'tracks';
let searchLoading = false;
let pairing = null;
let localPlayback = null;
let devicePicker = null;
let connectionOpen = false;

export function invalidateMusic({ hard = false } = {}) {
  cacheStale = true;
  if (hard) cache = null;
}

function scheduleRefresh(container, ctx) {
  if (refreshTimer) clearTimeout(refreshTimer);
  const spotifyState = cache?.controller?.connectionStatus?.spotify;
  if (!cache?.session && cache?.controller?.online && (!spotifyState || spotifyState === 'connected')) return;
  refreshTimer = setTimeout(async () => {
    if (container.dataset.view !== 'music') return;
    await load(ctx, true, container);
  }, 5_000);
}

async function load(ctx, silent = false, container = null) {
  if (loading) return;
  loading = true;
  try {
    cache = await api.music.status();
    localPlayback = cache.session ? await localSpotifyPlaybackStatus() : null;
    cacheStale = false;
  } catch (error) {
    cacheStale = false;
    if (!silent) showToast(error.message, { error: true });
  } finally {
    loading = false;
    const activeElement = document.activeElement;
    const interactionInProgress = Boolean(
      silent && container && activeElement && container.contains(activeElement) &&
      activeElement.matches('input, select, textarea, [contenteditable="true"]'),
    );
    if (interactionInProgress) scheduleRefresh(container, ctx);
    else ctx.rerender();
  }
}

function durationLabel(milliseconds) {
  const totalSeconds = Math.max(0, Math.round(Number(milliseconds || 0) / 1000));
  return `${Math.floor(totalSeconds / 60)}:${String(totalSeconds % 60).padStart(2, '0')}`;
}

function currentProgress(session) {
  const duration = Number(session.currentTrack?.durationMs || 0);
  const elapsed = session.isPlaying && session.playbackUpdatedAt
    ? Date.now() - session.playbackUpdatedAt
    : 0;
  return Math.max(0, Math.min(duration, Number(session.progressMs || 0) + elapsed));
}

function progressPercent(session) {
  const duration = Number(session.currentTrack?.durationMs || 0);
  if (!duration) return 0;
  return Math.max(0, Math.min(100, (currentProgress(session) / duration) * 100));
}

function scheduleProgress(container) {
  if (progressFrame) cancelAnimationFrame(progressFrame);
  progressFrame = null;
  const update = () => {
    if (container.dataset.view !== 'music') {
      progressFrame = null;
      return;
    }
    if (!cache?.session?.currentTrack) return;
    const progress = currentProgress(cache.session);
    const bar = container.querySelector('.music-progress > span');
    const duration = container.querySelector('.music-duration');
    if (bar) bar.style.transform = `scaleX(${progressPercent(cache.session) / 100})`;
    if (duration) duration.textContent = `${durationLabel(progress)} / ${durationLabel(cache.session.currentTrack.durationMs)}`;
    if (cache.session.isPlaying) progressFrame = requestAnimationFrame(update);
  };
  update();
}

const LIST_TEXT_LIMIT = 40;

function shortText(value, limit = LIST_TEXT_LIMIT) {
  const text = String(value ?? '');
  return text.length > limit ? `${text.slice(0, limit - 1).trimEnd()}…` : text;
}

function personHtml(name, playerId) {
  const safe = escapeHtml(name || '');
  return playerId && playerId === getMyId() ? `<strong class="music-me">${safe}</strong>` : safe;
}

function coverHtml(imageUrl, className) {
  return imageUrl
    ? `<img class="${className}" src="${escapeHtml(imageUrl)}" alt="" />`
    : `<span class="${className} music-cover-placeholder">${icon('music')}</span>`;
}

export function musicSetupHtml(status, activePairing = pairing) {
  if (status.controller?.online) return '';
  const hasKnownController = Boolean(status.controller);
  if (!status.canManageController) {
    return `
      <section class="card stack grouped-page-section" aria-labelledby="music-setup-title">
        <div class="grouped-page-section-title"><h2 id="music-setup-title">Musik-PC</h2></div>
        ${emptyStateHtml(hasKnownController ? 'Der Musik-PC ist gerade nicht erreichbar.' : 'Ein Community-Admin richtet den Musik-PC ein.')}
      </section>`;
  }
  const disabled = getMyId() ? '' : 'disabled';
  const code = activePairing && !(activePairing.expiresAt && activePairing.expiresAt <= Date.now()) ? activePairing : null;
  const current = hasKnownController || code ? 1 : 0;
  const downloadSlot = `<button type="button" class="btn btn-sm${current === 0 ? ' btn-primary' : ''}" id="music-download-controller" ${disabled}>Paket herunterladen</button>`;
  const pairingSlot = code
    ? `<span class="music-pairing-code"><strong id="music-pairing-value">${escapeHtml(code.code)}</strong><button type="button" class="icon-btn music-pairing-copy" id="music-copy-pairing" title="Kopplungscode kopieren" aria-label="Kopplungscode kopieren">${icon('copy')}</button></span>`
    : `<button type="button" class="btn btn-sm${hasKnownController ? ' btn-primary' : ''}" id="music-reconnect-controller" ${disabled}>Code erzeugen</button>`;
  const steps = [
    [hasKnownController ? 'Musik-PC starten' : 'Paket auf dem Musik-PC starten',
      hasKnownController
        ? `Die vorhandene Installation auf ${escapeHtml(status.controller.label)} öffnen`
        : 'Entpacken und die Datei für das Betriebssystem öffnen',
      downloadSlot],
    ['Mit Respawn koppeln', `Auf dem Musik-PC <a href="${LOCAL_CONTROLLER_URL}" target="_blank" rel="noopener">${LOCAL_CONTROLLER_URL}</a> öffnen und den Kopplungscode eingeben${code ? ' · 10 Minuten gültig' : ''}`, pairingSlot],
    ['Spotify verbinden', 'Die lokale Seite führt durch Spotify-App, Client-ID und Anmeldung', ''],
    ['Jam starten', 'Erscheint hier, sobald die Verbindung steht', ''],
  ];
  return `
    <section class="card stack grouped-page-section music-setup-card" aria-labelledby="music-setup-title">
      <div class="grouped-page-section-title"><h2 id="music-setup-title">${hasKnownController ? 'Musik-PC wieder verbinden' : 'Musik-PC einrichten'}</h2></div>
      <p class="music-note">${hasKnownController
        ? `${escapeHtml(status.controller.label)} ist nicht erreichbar. Ohne laufenden Jam wird die Verbindung nach 24 Stunden ohne Kontakt entfernt.`
        : 'Ein Musik-PC oder Kiosk-Pi verbindet die Community mit Spotify.'}</p>
      <ol class="music-setup-steps">
        ${steps.map(([title, text, slot], index) => `<li class="${index < current ? 'is-complete' : index === current ? 'is-current' : ''}">
          <span class="music-setup-step-number">${index + 1}</span>
          <span class="music-track-main"><strong>${title}</strong><span class="music-meta">${text}</span></span>
          ${slot ? `<span class="music-setup-step-action">${slot}</span>` : ''}
        </li>`).join('')}
      </ol>
    </section>`;
}

export function musicControllerRecoveryHtml(connectionStatus) {
  const spotifyState = connectionStatus?.spotify;
  if (!spotifyState || spotifyState === 'connected') return '';
  const needsLogin = spotifyState === 'authorization_required';
  return `<section class="card stack grouped-page-section" aria-labelledby="music-recovery-title">
        <div class="grouped-page-section-title">
          <h2 id="music-recovery-title">${needsLogin ? 'Spotify-Anmeldung erneuern' : 'Spotify vorübergehend nicht erreichbar'}</h2>
          ${needsLogin ? `<a class="btn btn-primary btn-sm" href="${LOCAL_CONTROLLER_URL}" target="_blank" rel="noopener">Musik-PC öffnen</a>` : ''}
        </div>
        <p class="music-note">${escapeHtml(connectionStatus?.message || (needsLogin
          ? 'Der Musik-PC ist erreichbar, braucht aber eine neue Spotify-Anmeldung.'
          : 'Der Musik-PC bleibt verbunden und versucht es automatisch erneut.'))}</p>
      </section>`;
}

function connectionHtml(status) {
  const controller = status.controller;
  if (!controller?.online) return '';
  const recovery = musicControllerRecoveryHtml(controller.connectionStatus);
  if (recovery) return recovery;
  if (status.session) return '';
  return `
    <section class="card stack grouped-page-section" aria-labelledby="music-output-title">
      <div class="grouped-page-section-title"><h2 id="music-output-title">Jam starten</h2></div>
      <p class="music-meta music-account">${escapeHtml(controller.label)} · Spotify ${escapeHtml(controller.spotifyDisplayName || 'verbunden')}</p>
      <div id="music-device-area" class="music-device-area">${deviceAreaHtml()}</div>
    </section>`;
}

export function musicControllerManagementHtml(status) {
  if (!status.controller || !status.canManageController) return '';
  const sessionActive = Boolean(status.session);
  return `<details class="card grouped-page-section collapsible-section music-controller-management" data-music-connection ${connectionOpen ? 'open' : ''}>
    <summary class="collapsible-section-header">
      <h2>Verbindung verwalten</h2><span class="collapsible-section-chevron">${icon('chevronRight')}</span>
    </summary>
    <div class="collapsible-section-content music-management-row">
      <span class="music-meta">${sessionActive
        ? 'Zum Entkoppeln zuerst den laufenden Jam beenden.'
        : 'Ohne laufenden Jam wird der Musik-PC nach 24 Stunden ohne Kontakt automatisch entkoppelt.'}</span>
      ${sessionActive ? '' : '<button type="button" class="btn btn-sm" id="music-disconnect">Entkoppeln</button>'}
    </div>
  </details>`;
}

function deviceAreaHtml() {
  if (!devicePicker || devicePicker.loading) return '<p class="music-note">Geräte werden geladen</p>';
  if (devicePicker.error) {
    return `<div class="music-management-row"><span class="music-meta">${escapeHtml(devicePicker.error)}</span><button type="button" class="btn btn-sm" data-music-reload-devices>Neu laden</button></div>`;
  }
  return musicDevicePickerHtml(devicePicker.devices, devicePicker.localPlayback);
}

export function musicDevicePickerHtml(devices, localPlayback = null) {
  const spotifyDevices = Array.isArray(devices) ? devices : [];
  const spotifyPicker = spotifyDevices.length ? `
    <div class="music-device-picker">
      <label class="music-device-field"><span class="field-label">Musikausgabe</span>
        <select id="music-device-select">
          ${spotifyDevices.map((device) => `<option value="${escapeHtml(device.id)}" ${device.active ? 'selected' : ''}>${escapeHtml(device.name)}${device.type ? ` · ${escapeHtml(device.type)}` : ''}</option>`).join('')}
        </select>
      </label>
      <button type="button" class="btn btn-primary" id="music-start">Starten</button>
    </div>` : `
    <div class="music-management-row">
      <span class="music-meta">Kein Spotify-Gerät gefunden. Spotify auf einem Gerät öffnen oder diese Seite auf dem Musik-PC aufrufen.</span>
      <button type="button" class="btn btn-sm" data-music-reload-devices>Neu laden</button>
    </div>`;
  const localPlayer = localPlayback ? `
    <div class="music-management-row music-local-player">
      <span class="music-track-main">
        <span>Ton über diesen Browser, TV oder HDMI</span>
        <span class="music-meta">${localPlayback.ready
          ? 'Dieser Browser wird selbst zum Spotify-Gerät.'
          : escapeHtml(localPlayback.message || 'Spotify muss für die Browser-Wiedergabe neu freigegeben werden.')}</span>
      </span>
      ${localPlayback.ready
        ? '<button type="button" class="btn btn-sm" id="music-start-local-player">Diesen Browser nutzen</button>'
        : `<a class="btn btn-sm" id="music-authorize-local-player" href="${LOCAL_CONTROLLER_URL}" target="_blank" rel="noopener">Spotify-Freigabe öffnen</a>`}
    </div>` : '';
  return `${spotifyPicker}${localPlayer}
    <p class="music-note">Bluetooth-Boxen sind kein eigenes Spotify-Gerät. Sie laufen über den Audioausgang des gewählten Geräts.</p>`;
}

async function startLocalMusicSession(ctx, button, localPlayback) {
  button.disabled = true;
  button.textContent = 'Browser wird verbunden…';
  try {
    const localPlayer = await connectLocalSpotifyPlayer({ name: localPlayback.playerName });
    let lastError = null;
    for (let attempt = 0; attempt < 5; attempt += 1) {
      try {
        await api.music.start(getMyId(), localPlayer.deviceId);
        lastError = null;
        break;
      } catch (error) {
        lastError = error;
        if (error.status !== 404 || attempt === 4) break;
        await new Promise((resolve) => setTimeout(resolve, 400));
      }
    }
    if (lastError) throw lastError;
    showToast('Jam läuft über den Audioausgang dieses Browsers.');
    invalidateMusic();
    ctx.rerender();
  } catch (error) {
    showToast(error.message, { error: true });
    button.disabled = false;
    button.textContent = 'Diesen Browser nutzen';
  }
}

function playlistLabel(playlist) {
  return `Playlist ${escapeHtml(shortText(playlist.name))}${playlist.addedByName ? ` von ${escapeHtml(playlist.addedByName)}` : ''}`;
}

function nowPlayingHtml(session, canManageController = false) {
  const track = session.currentTrack;
  const playlist = session.playbackContext;
  const request = session.requests.find((entry) => entry.status === 'playing' && entry.trackUri === track?.uri);
  const hostControls = session.hostPlayerId === getMyId() || canManageController;
  const canControlPlayback = Boolean(getMyId());
  const meta = track
    ? [escapeHtml(track.artist),
      request ? `gewünscht von ${personHtml(request.requestedByName, request.requestedBy)}` : '',
      playlist ? playlistLabel(playlist) : ''].filter(Boolean).join(' · ')
    : '';
  return `
    <section class="card stack grouped-page-section" aria-labelledby="music-now-title">
      <div class="grouped-page-section-title">
        <h2 id="music-now-title">Jetzt läuft</h2>
        ${hostControls ? '<button type="button" class="btn btn-sm" id="music-end">Beenden</button>' : ''}
      </div>
      ${track ? `
        <div class="music-now-playing">
          ${coverHtml(track.imageUrl, 'music-cover')}
          <div class="music-track-main">
            <strong class="music-track-title">${escapeHtml(track.name)}</strong>
            <span class="music-meta">${meta}</span>
            <div class="music-progress-row">
              <div class="music-progress" aria-label="Wiedergabefortschritt"><span style="transform:scaleX(${progressPercent(session) / 100});"></span></div>
              <span class="music-meta music-duration-row">${session.isPlaying ? '' : 'Pausiert · '}<span class="music-duration">${durationLabel(currentProgress(session))} / ${durationLabel(track.durationMs)}</span></span>
            </div>
          </div>
        </div>` : emptyStateHtml(playlist
          ? `Playlist ${shortText(playlist.name)} startet auf ${session.deviceName}.`
          : `Auf ${session.deviceName} läuft gerade kein Titel.`, { className: 'music-idle' })}
      ${canControlPlayback ? `
        <div class="music-host-actions">
          <button type="button" class="btn btn-sm" id="music-toggle-playback">${session.isPlaying ? 'Pausieren' : 'Fortsetzen'}</button>
          <button type="button" class="btn btn-sm" id="music-skip">Überspringen</button>
        </div>` : ''}
    </section>`;
}

function queueRowHtml({ position, imageUrl, name, artist, who, durationMs, requestId = null, draggable = false }) {
  return `<div class="music-queue-row" role="row"${requestId ? ` data-music-request="${escapeHtml(requestId)}"` : ''}${draggable ? ' draggable="true"' : ''}>
    <span class="music-queue-position" role="cell">${position}</span>
    <span role="cell">${coverHtml(imageUrl, 'music-queue-cover')}</span>
    <span class="music-track-main" role="cell">
      ${requestId
        ? `<button type="button" class="music-queue-open" data-music-detail="${escapeHtml(requestId)}" title="${escapeHtml(name)}">${escapeHtml(shortText(name))}</button>`
        : `<span class="music-queue-title" title="${escapeHtml(name)}">${escapeHtml(shortText(name))}</span>`}
      <span class="music-meta music-queue-artist">${escapeHtml(artist)}<span class="music-queue-who-inline"> · ${who}</span></span>
    </span>
    <span class="music-meta music-queue-who" role="cell">${who}</span>
    <span class="music-meta music-queue-duration" role="cell">${durationMs ? durationLabel(durationMs) : ''}</span>
  </div>`;
}

function queuedRequests(session) {
  return session.requests.filter((entry) => entry.status === 'queued' || entry.status === 'sending');
}

function requestQueueHtml(session) {
  const queued = queuedRequests(session);
  const playlist = session.playbackContext;
  const playlistMode = Boolean(playlist);
  const nextTrack = playlist?.nextTrack || null;
  const nextRequest = nextTrack
    ? queued.find((entry) => entry.trackUri === nextTrack.uri) || null
    : null;
  const remainingRequests = nextRequest ? queued.filter((entry) => entry.id !== nextRequest.id) : queued;
  const remainingPlaylistTracks = Number.isSafeInteger(playlist?.remainingTrackCount)
    ? Math.max(0, playlist.remainingTrackCount)
    : null;
  const playlistTracksAfterNext = remainingPlaylistTracks !== null && nextTrack && !nextRequest
    ? Math.max(0, remainingPlaylistTracks - 1)
    : remainingPlaylistTracks;
  const sortable = Boolean(getMyId()) && !playlistMode && queued.length > 1;
  const rows = [];
  if (nextTrack) {
    rows.push(queueRowHtml({
      position: 1,
      imageUrl: nextTrack.imageUrl,
      name: nextTrack.name,
      artist: nextTrack.artist,
      who: nextRequest ? personHtml(nextRequest.requestedByName, nextRequest.requestedBy) : 'Playlist',
      durationMs: nextTrack.durationMs,
      requestId: nextRequest?.id ?? null,
    }));
  }
  remainingRequests.forEach((entry, index) => rows.push(queueRowHtml({
    position: index + (nextTrack ? 2 : 1),
    imageUrl: entry.imageUrl,
    name: entry.name,
    artist: entry.artist,
    who: personHtml(entry.requestedByName, entry.requestedBy),
    durationMs: entry.durationMs,
    requestId: entry.id,
    draggable: sortable,
  })));
  if (playlistTracksAfterNext) {
    rows.push(`<div class="music-queue-row music-queue-more" role="row"><span role="cell"></span><span class="music-meta" role="cell">${playlistTracksAfterNext} ${playlistTracksAfterNext === 1 ? 'weiterer Titel' : 'weitere Titel'} aus der Playlist</span></div>`);
  }
  return `
    <section class="card stack grouped-page-section" aria-labelledby="music-queue-title">
      <div class="grouped-page-section-title"><h2 id="music-queue-title">Als Nächstes</h2></div>
      ${rows.length
        ? `<div class="music-queue-list${sortable ? ' is-sortable' : ''}" role="table" aria-label="Als Nächstes">${rows.join('')}</div>`
        : emptyStateHtml('Noch keine Wünsche.')}
    </section>`;
}

export function musicActiveSessionHtml(status, browserPlayback = localPlayback) {
  if (!status.session) return '';
  const needsBrowserRecovery = localSpotifySessionNeedsRecovery(
    status.session,
    browserPlayback,
    localSpotifyPlayerInfo(),
  );
  return `
    ${status.warning ? `<section class="card stack grouped-page-section"><p class="music-note">${escapeHtml(status.warning)}</p></section>` : ''}
    ${needsBrowserRecovery ? `<section class="card stack grouped-page-section" aria-labelledby="music-recover-title">
      <div class="grouped-page-section-title">
        <h2 id="music-recover-title">Browser-Ton wieder verbinden</h2>
        <button type="button" class="btn btn-primary btn-sm" id="music-recover-local-player">Verbinden</button>
      </div>
      <p class="music-note">Dieser Jam lief über den Browser. Nach dem Neuladen muss Spotify einmal wieder verbunden werden.</p>
    </section>` : ''}
    ${nowPlayingHtml(status.session, status.canManageController)}
    ${requestQueueHtml(status.session)}
    <section class="card stack grouped-page-section" aria-labelledby="music-search-title">
      <div class="grouped-page-section-title"><h2 id="music-search-title">Musik hinzufügen</h2></div>
      <form id="music-search-form" class="music-search-form">
        <input type="search" id="music-search-input" minlength="2" maxlength="80" required aria-label="Spotify durchsuchen" placeholder="Titel oder Playlist suchen" autocomplete="off" value="${escapeHtml(searchQuery)}" />
        <button type="submit" class="btn">Suchen</button>
      </form>
      <div id="music-search-results">${searchResultsHtml()}</div>
    </section>`;
}

function resolvedResultType(tracks, playlists, preferredType) {
  if (preferredType === 'playlists' && playlists.length) return 'playlists';
  if (preferredType === 'tracks' && tracks.length) return 'tracks';
  return playlists.length ? 'playlists' : 'tracks';
}

function searchRowHtml({ imageUrl, name, meta, button }) {
  return `<div class="music-queue-row music-search-row" role="row">
    <span role="cell">${coverHtml(imageUrl, 'music-queue-cover')}</span>
    <span class="music-track-main" role="cell">
      <span class="music-queue-title" title="${escapeHtml(name)}">${escapeHtml(shortText(name))}</span>
      <span class="music-meta music-queue-artist">${meta}</span>
    </span>
    <span class="music-search-action" role="cell">${button}</span>
  </div>`;
}

export function musicSearchResultsHtml(results, { loading: resultsLoading = false, resultType = 'tracks' } = {}) {
  if (resultsLoading) return '<p class="music-meta music-search-status">Spotify wird durchsucht</p>';
  if (results === null) return '';
  const tracks = Array.isArray(results?.tracks) ? results.tracks : [];
  const playlists = Array.isArray(results?.playlists) ? results.playlists : [];
  if (!tracks.length && !playlists.length) return '<p class="music-meta music-search-status">Keine Titel oder Playlists gefunden.</p>';
  const activeType = resolvedResultType(tracks, playlists, resultType);
  const entries = activeType === 'playlists'
    ? playlists.map((playlist) => searchRowHtml({
        imageUrl: playlist.imageUrl,
        name: playlist.name,
        meta: `${escapeHtml(playlist.owner)} · ${escapeHtml(playlist.trackCount)} Titel`,
        button: `<button type="button" class="btn btn-sm" data-music-playlist="${escapeHtml(playlist.id)}">Abspielen</button>`,
      })).join('')
    : tracks.map((track) => searchRowHtml({
        imageUrl: track.imageUrl,
        name: track.name,
        meta: escapeHtml(track.artist),
        button: `<button type="button" class="btn btn-sm" data-music-add="${escapeHtml(track.id)}">Hinzufügen</button>`,
      })).join('');
  const typeButton = (type, label, count) => `<button type="button" class="btn btn-sm music-result-type-button${activeType === type ? ' is-selected' : ''}" data-music-result-type="${type}" aria-pressed="${activeType === type}" ${count ? '' : 'disabled'}>${label}</button>`;
  return `<div class="music-search-results">
    <div class="music-result-type-switch" role="group" aria-label="Suchergebnisse filtern">
      ${typeButton('tracks', 'Titel', tracks.length)}${typeButton('playlists', 'Playlists', playlists.length)}
    </div>
    <div class="music-queue-list" role="table" aria-label="Suchergebnisse">${entries}</div>
  </div>`;
}

function searchResultsHtml() {
  return musicSearchResultsHtml(searchResults, { loading: searchLoading, resultType: searchResultType });
}

function wireSearchResults(container) {
  container.querySelectorAll('[data-music-result-type]').forEach((button) => {
    button.addEventListener('click', () => {
      searchResultType = button.dataset.musicResultType;
      const target = container.querySelector('#music-search-results');
      target.innerHTML = searchResultsHtml();
      wireSearchResults(container);
    });
  });
  container.querySelectorAll('[data-music-add]').forEach((button) => {
    button.addEventListener('click', async () => {
      button.disabled = true;
      try {
        await api.music.request(getMyId(), button.dataset.musicAdd);
        showToast('Zur Warteschlange hinzugefügt.');
        invalidateMusic();
        window.dispatchEvent(new CustomEvent('respawn:rerender'));
      } catch (error) {
        showToast(error.message, { error: true });
        button.disabled = false;
      }
    });
  });
  container.querySelectorAll('[data-music-playlist]').forEach((button) => {
    button.addEventListener('click', async () => {
      const playlist = searchResults?.playlists?.find((entry) => entry.id === button.dataset.musicPlaylist);
      if (!playlist) return;
      const session = cache?.session;
      if (session?.currentTrack || session?.playbackContext || session?.requests?.length) {
        const confirmed = await confirmDialog(
          'Playlist starten? Die aktuelle Wiedergabe und alle Songwünsche werden ersetzt.',
          { confirmText: 'Playlist starten' },
        );
        if (!confirmed) return;
      }
      button.disabled = true;
      try {
        await api.music.playPlaylist(getMyId(), playlist.id);
        showToast(`Playlist „${playlist.name}“ wird abgespielt.`);
        invalidateMusic();
        window.dispatchEvent(new CustomEvent('respawn:rerender'));
      } catch (error) {
        showToast(error.message, { error: true });
        button.disabled = false;
      }
    });
  });
}

function openRequestDetail(requestId, ctx) {
  const session = cache?.session;
  const entry = session?.requests.find((request) => request.id === requestId);
  if (!session || !entry) return;
  const queuedIds = queuedRequests(session).map((request) => request.id);
  const index = queuedIds.indexOf(requestId);
  const editable = Boolean(getMyId()) && !session.playbackContext && entry.status === 'queued';
  const facts = [
    ['Interpret', escapeHtml(entry.artist)],
    entry.album ? ['Album', escapeHtml(entry.album)] : null,
    ['Gewünscht von', personHtml(entry.requestedByName, entry.requestedBy)],
    ['Dauer', durationLabel(entry.durationMs)],
    index >= 0 ? ['Position', String(index + 1)] : null,
  ].filter(Boolean);
  const { close } = openModal(
    'Wunsch',
    `<div class="stack">
       <div class="music-detail-head">
         ${coverHtml(entry.imageUrl, 'music-cover')}
         <strong class="music-detail-title">${escapeHtml(entry.name)}</strong>
       </div>
       <dl class="music-detail-facts">${facts.map(([label, value]) => `<dt>${label}</dt><dd>${value}</dd>`).join('')}</dl>
       ${editable ? `<div class="music-detail-footer">
         <button type="button" class="btn btn-sm" data-detail-move="up" ${index <= 0 ? 'disabled' : ''}>Nach oben</button>
         <button type="button" class="btn btn-sm" data-detail-move="down" ${index < 0 || index >= queuedIds.length - 1 ? 'disabled' : ''}>Nach unten</button>
         <button type="button" class="btn btn-sm" data-detail-remove>Entfernen</button>
       </div>` : ''}
     </div>`,
    {
      onMount: (el) => {
        el.querySelector('.modal')?.classList.add('music-detail-modal');
        el.querySelectorAll('[data-detail-move]').forEach((button) => {
          button.addEventListener('click', async () => {
            const ids = [...queuedIds];
            const target = button.dataset.detailMove === 'up' ? index - 1 : index + 1;
            [ids[index], ids[target]] = [ids[target], ids[index]];
            close();
            await saveQueueOrder(ids, ctx);
          });
        });
        el.querySelector('[data-detail-remove]')?.addEventListener('click', async (event) => {
          const button = event.currentTarget;
          button.disabled = true;
          try {
            await api.music.removeRequest(getMyId(), requestId);
            close();
            invalidateMusic();
            ctx.rerender();
          } catch (error) {
            showToast(error.message, { error: true });
            button.disabled = false;
          }
        });
      },
    },
  );
}

async function saveQueueOrder(requestIds, ctx) {
  try {
    await api.music.reorder(getMyId(), requestIds);
  } catch (error) {
    showToast(error.message, { error: true });
  }
  invalidateMusic();
  ctx.rerender();
}

function wireQueue(container, ctx) {
  const list = container.querySelector('.music-queue-list[aria-label="Als Nächstes"]');
  if (!list) return;
  list.querySelectorAll('[data-music-detail]').forEach((button) => {
    button.addEventListener('click', () => openRequestDetail(button.dataset.musicDetail, ctx));
  });
  if (!list.classList.contains('is-sortable')) return;
  let draggedId = null;
  const currentIds = () => [...list.querySelectorAll('[data-music-request][draggable]')].map((row) => row.dataset.musicRequest);
  list.querySelectorAll('[data-music-request][draggable]').forEach((row) => {
    row.addEventListener('dragstart', (event) => {
      draggedId = row.dataset.musicRequest;
      row.classList.add('is-dragging');
      event.dataTransfer.effectAllowed = 'move';
      event.dataTransfer.setData('text/plain', draggedId);
    });
    row.addEventListener('dragend', () => {
      draggedId = null;
      list.querySelectorAll('[data-music-request]').forEach((entry) => entry.classList.remove('is-dragging', 'is-drag-target'));
    });
    row.addEventListener('dragover', (event) => {
      if (!draggedId || draggedId === row.dataset.musicRequest) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = 'move';
      row.classList.add('is-drag-target');
    });
    row.addEventListener('dragleave', () => row.classList.remove('is-drag-target'));
    row.addEventListener('drop', (event) => {
      event.preventDefault();
      row.classList.remove('is-drag-target');
      const sourceId = draggedId || event.dataTransfer.getData('text/plain');
      const targetId = row.dataset.musicRequest;
      if (!sourceId || sourceId === targetId) return;
      const ids = currentIds().filter((id) => id !== sourceId);
      const targetIndex = ids.indexOf(targetId);
      const after = event.clientY > row.getBoundingClientRect().top + row.getBoundingClientRect().height / 2;
      ids.splice(targetIndex + (after ? 1 : 0), 0, sourceId);
      void saveQueueOrder(ids, ctx);
    });
  });
}

function triggerDownload(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

let pairingExpiryTimer = null;

function wireSetup(container, ctx) {
  if (pairingExpiryTimer) clearTimeout(pairingExpiryTimer);
  pairingExpiryTimer = null;
  if (pairing?.expiresAt && pairing.expiresAt > Date.now()) {
    pairingExpiryTimer = setTimeout(() => {
      if (container.dataset.view === 'music') ctx.rerender();
    }, pairing.expiresAt - Date.now() + 250);
  }
  container.querySelector('#music-copy-pairing')?.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(pairing.code);
      showToast('Kopplungscode kopiert.');
    } catch {
      showToast('Kopieren nicht möglich. Bitte den Code manuell markieren.', { error: true });
    }
  });
  container.querySelector('#music-reconnect-controller')?.addEventListener('click', async (event) => {
    const button = event.currentTarget;
    button.disabled = true;
    try {
      pairing = await api.music.createPairing(getMyId());
      showToast('Kopplungscode erzeugt.');
      ctx.rerender();
    } catch (error) {
      showToast(error.message, { error: true });
      button.disabled = false;
    }
  });
  container.querySelector('#music-download-controller')?.addEventListener('click', async (event) => {
    const button = event.currentTarget;
    button.disabled = true;
    try {
      pairing = await api.music.createPairing(getMyId());
      const { blob, filename } = await api.music.controllerPackage(getMyId(), pairing.code);
      triggerDownload(blob, filename);
      showToast('Paket wird heruntergeladen.');
      ctx.rerender();
    } catch (error) {
      showToast(error.message, { error: true });
      button.disabled = false;
    }
  });
}

async function loadDevices(ctx) {
  devicePicker = { loading: true };
  try {
    const [{ devices }, browserPlayback] = await Promise.all([
      api.music.devices(),
      localSpotifyPlaybackStatus(),
    ]);
    devicePicker = { devices, localPlayback: browserPlayback };
    if (browserPlayback?.ready) void preloadSpotifyPlaybackSdk().catch(() => {});
  } catch (error) {
    devicePicker = { error: error.message };
  }
  ctx.rerender();
}

function wireDevicePicker(area, ctx) {
  area.querySelectorAll('[data-music-reload-devices]').forEach((button) => {
    button.addEventListener('click', () => void loadDevices(ctx));
  });
  area.querySelector('#music-start')?.addEventListener('click', async (event) => {
    const button = event.currentTarget;
    button.disabled = true;
    try {
      await api.music.start(getMyId(), area.querySelector('#music-device-select').value);
      invalidateMusic();
      ctx.rerender();
    } catch (error) {
      showToast(error.message, { error: true });
      button.disabled = false;
    }
  });
  area.querySelector('#music-start-local-player')?.addEventListener('click', (event) => {
    void startLocalMusicSession(ctx, event.currentTarget, devicePicker.localPlayback);
  });
  area.querySelector('#music-authorize-local-player')?.addEventListener('click', (event) => {
    event.currentTarget.textContent = 'Status wird geprüft';
    void waitForLocalSpotifyPlaybackReady().then((readyPlayback) => {
      if (readyPlayback && devicePicker) {
        showToast('Browser-Wiedergabe ist jetzt freigegeben.');
        devicePicker = { ...devicePicker, localPlayback: readyPlayback };
      }
      ctx.rerender();
    });
  });
}

function wireConnection(container, ctx) {
  container.querySelector('[data-music-connection]')?.addEventListener('toggle', (event) => {
    connectionOpen = event.currentTarget.open;
  });
  container.querySelector('#music-disconnect')?.addEventListener('click', async () => {
    const confirmed = await confirmDialog(
      'Die Spotify-Anmeldung bleibt auf dem Musik-PC erhalten. Für Respawn wird beim nächsten Start ein neuer Kopplungscode benötigt.',
      { title: 'Musik-PC entkoppeln?', confirmText: 'Entkoppeln', danger: true },
    );
    if (!confirmed) return;
    try {
      await api.music.disconnectController(getMyId());
      pairing = null;
      devicePicker = null;
      cache = { ...cache, controller: null };
      cacheStale = false;
      try {
        pairing = await api.music.createPairing(getMyId());
        showToast('Musik-PC entkoppelt. Neuer Kopplungscode wurde erzeugt.');
      } catch (error) {
        showToast(`Musik-PC entkoppelt. ${error.message}`, { error: true });
      }
      ctx.rerender();
    } catch (error) {
      showToast(error.message, { error: true });
    }
  });
  const area = container.querySelector('#music-device-area');
  if (!area) return;
  if (!devicePicker) void loadDevices(ctx);
  else wireDevicePicker(area, ctx);
}

function wireSession(container, ctx) {
  container.querySelector('#music-recover-local-player')?.addEventListener('click', async (event) => {
    const button = event.currentTarget;
    button.disabled = true;
    button.textContent = 'Browser wird wieder verbunden…';
    try {
      const localPlayer = await connectLocalSpotifyPlayer({ name: localPlayback.playerName });
      cache = { ...cache, session: await api.music.recoverDevice(localPlayer.deviceId) };
      showToast('Der laufende Jam ist wieder mit diesem Browser verbunden.');
      ctx.rerender();
    } catch (error) {
      showToast(error.message, { error: true });
      button.disabled = false;
      button.textContent = 'Erneut versuchen';
    }
  });
  container.querySelector('#music-search-input')?.addEventListener('input', (event) => {
    searchQuery = event.currentTarget.value;
  });
  container.querySelector('#music-search-form')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const query = container.querySelector('#music-search-input').value.trim();
    const target = container.querySelector('#music-search-results');
    searchQuery = query;
    searchLoading = true;
    target.innerHTML = searchResultsHtml();
    try {
      searchResults = await api.music.search(query);
      searchLoading = false;
      target.innerHTML = searchResultsHtml();
      wireSearchResults(container);
    } catch (error) {
      searchResults = null;
      searchLoading = false;
      target.innerHTML = emptyStateHtml(error.message);
    }
  });
  container.querySelector('#music-toggle-playback')?.addEventListener('click', async () => {
    try {
      await api.music.setPlaying(getMyId(), !cache.session.isPlaying);
      invalidateMusic();
      ctx.rerender();
    } catch (error) {
      showToast(error.message, { error: true });
    }
  });
  container.querySelector('#music-skip')?.addEventListener('click', async () => {
    try {
      await api.music.skip(getMyId());
      invalidateMusic();
      ctx.rerender();
    } catch (error) {
      showToast(error.message, { error: true });
    }
  });
  container.querySelector('#music-end')?.addEventListener('click', async () => {
    const confirmed = await confirmDialog(
      'Die Wiedergabe stoppt und offene Wünsche verfallen.',
      { title: 'Jam beenden?', confirmText: 'Beenden', danger: true },
    );
    if (!confirmed) return;
    try {
      const result = await api.music.end(getMyId());
      if (result?.warning) showToast(result.warning);
      invalidateMusic();
      ctx.rerender();
    } catch (error) {
      showToast(error.message, { error: true });
    }
  });
}

export function renderMusic(container, ctx) {
  const scrollTop = container.scrollTop;
  const activeSearch = container.querySelector('#music-search-input');
  const restoreSearchFocus = activeSearch === document.activeElement;
  const selectionStart = restoreSearchFocus ? activeSearch.selectionStart : null;
  const selectionEnd = restoreSearchFocus ? activeSearch.selectionEnd : null;
  if (restoreSearchFocus) searchQuery = activeSearch.value;
  const existingMusicView = Boolean(container.querySelector('[data-music-view-root]'));
  if ((cache === null || cacheStale) && !loading) {
    const silent = cache !== null;
    void load(ctx, silent, container);
    if (silent && existingMusicView) return;
  }
  container.innerHTML = `
    <div class="more-subpage-header">
      <div class="more-subpage-title-row">
        <h1 class="view-title" data-music-view-root>Jam</h1>
      </div>
    </div>
    <div class="grouped-page-sections">
      ${cache ? `${musicSetupHtml(cache)}${connectionHtml(cache)}${musicActiveSessionHtml(cache)}${musicControllerManagementHtml(cache)}` : `<section class="card stack grouped-page-section">${emptyStateHtml('Lädt…')}</section>`}
    </div>`;
  container.scrollTop = scrollTop;
  if (!cache) {
    scheduleProgress(container);
    return;
  }
  if (cache.session) devicePicker = null;
  wireSetup(container, ctx);
  wireConnection(container, ctx);
  wireSession(container, ctx);
  wireSearchResults(container);
  wireQueue(container, ctx);
  if (restoreSearchFocus) {
    const nextSearch = container.querySelector('#music-search-input');
    nextSearch?.focus({ preventScroll: true });
    if (selectionStart !== null && selectionEnd !== null) {
      nextSearch?.setSelectionRange(selectionStart, selectionEnd);
    }
  }
  scheduleProgress(container);
  scheduleRefresh(container, ctx);
}
