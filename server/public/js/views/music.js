import { api } from '../api.js';
import { escapeHtml } from '../format.js';
import { icon } from '../icons.js';
import { showToast } from '../toast.js';
import { getMyId } from '../whoami.js';
import { infoTooltipHtml, wireInfoTooltips } from '../infoTooltip.js';
import { emptyStateHtml } from '../emptyState.js';
import { confirmDialog } from '../modal.js';
import { backButtonHtml } from '../backButton.js';
import {
  connectLocalSpotifyPlayer,
  localSpotifyPlaybackStatus,
  preloadSpotifyPlaybackSdk,
  LOCAL_CONTROLLER_URL,
} from '../spotifyBrowserPlayer.js';

const JAM_HELP =
  'Ein Musik-PC oder Kiosk-Pi steuert Spotify lokal; nur dort ist ein Spotify-Premium-Konto nötig. Für Ton über HDMI, TV oder die angeschlossene Soundbar kann dieser Browser selbst als Musikgerät gestartet werden.';

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

export function musicSetupHtml(status, activePairing = pairing) {
  if (!status.controller?.online) {
    const hasKnownController = Boolean(status.controller);
    const reconnecting = hasKnownController;
    return `
      <section class="card stack grouped-page-section music-setup-card" aria-labelledby="music-setup-title">
          <div class="grouped-page-section-title"><h2 id="music-setup-title">${reconnecting ? 'Jam-Controller wieder verbinden' : 'Jam einrichten'}</h2></div>
          ${hasKnownController
            ? `<p><strong>${escapeHtml(status.controller.label)}</strong><span class="muted"> ist nicht erreichbar.</span></p>`
            : ''}
          ${activePairing ? `<div class="music-pairing-panel">
            <div class="music-pairing-header">
              <span class="music-pairing-title"><strong>Kopplungscode</strong><small>Im lokalen Controller eingeben</small></span>
              <span class="badge music-pairing-validity">10 Minuten gültig</span>
            </div>
            <div class="music-pairing-code">
              <strong id="music-pairing-value">${escapeHtml(activePairing.code)}</strong>
              <button type="button" class="icon-btn music-pairing-copy" id="music-copy-pairing" title="Kopplungscode kopieren" aria-label="Kopplungscode kopieren">${icon('copy')}</button>
            </div>
          </div>
          <p class="muted music-pairing-hint">Code im lokalen Controller unter „Wieder verbinden“ eingeben.</p>` : ''}
          ${status.canManageController
            ? `<div class="button-row">
                  <button type="button" class="btn btn-primary" id="music-reconnect-controller" ${getMyId() ? '' : 'disabled'}>${activePairing ? 'Neuen Code erzeugen' : reconnecting ? 'Wiederverbindung vorbereiten' : 'Vorhandenen Controller koppeln'}</button>
                  <a class="btn" href="${LOCAL_CONTROLLER_URL}" target="_blank" rel="noopener">Lokalen Controller öffnen</a>
                </div>
                <button type="button" class="btn btn-sm" id="music-download-controller" ${getMyId() ? '' : 'disabled'}>${hasKnownController ? 'Nur bei fehlender Installation: Controller neu herunterladen' : 'Controller erstmals herunterladen'}</button>`
            : emptyStateHtml('Ein Gruppen-Admin richtet den Jam-Controller ein.')}
      </section>`;
  }
  return '';
}

export function musicControllerRecoveryHtml(connectionStatus) {
  const spotifyState = connectionStatus?.spotify;
  if (!spotifyState || spotifyState === 'connected') return '';
  const needsLogin = spotifyState === 'authorization_required';
  return `<section class="card stack grouped-page-section music-warning">
        <strong>${needsLogin ? 'Spotify-Anmeldung erneuern' : 'Spotify vorübergehend nicht erreichbar'}</strong>
        <p>${escapeHtml(connectionStatus?.message || (needsLogin
          ? 'Der Controller ist erreichbar, benötigt aber eine neue Spotify-Anmeldung.'
          : 'Der Controller bleibt verbunden und versucht es automatisch erneut.'))}</p>
        ${needsLogin
          ? `<a class="btn btn-primary" href="${LOCAL_CONTROLLER_URL}" target="_blank" rel="noopener">Lokalen Controller öffnen</a>`
          : ''}
      </section>`;
}

function connectionHtml(status) {
  const controller = status.controller;
  if (!controller?.online) return '';
  const recovery = musicControllerRecoveryHtml(controller.connectionStatus);
  if (recovery) return recovery;
  if (status.session) return '';
  return `
    <section class="card stack grouped-page-section">
      <div class="card stack">
        <div class="row-between music-account-row">
          <span><strong>${escapeHtml(controller.label)}</strong><span class="muted"> · ${escapeHtml(controller.spotifyDisplayName || 'Spotify verbunden')}</span></span>
          ${status.canManageController ? '<button type="button" class="btn btn-sm" id="music-disconnect">Entkoppeln</button>' : ''}
        </div>
        <div id="music-device-area" class="music-device-area">
          <button type="button" class="btn btn-primary btn-block" id="music-load-devices">Gerät auswählen</button>
        </div>
      </div>
    </section>`;
}

export function musicDevicePickerHtml(devices, localPlayback = null) {
  const spotifyDevices = Array.isArray(devices) ? devices : [];
  if (!spotifyDevices.length && !localPlayback) {
    return emptyStateHtml('Spotify auf einem Connect-Gerät öffnen oder diese Seite direkt auf dem Musik-PC/Kiosk aufrufen.');
  }
  const spotifyPicker = spotifyDevices.length ? `
    <div class="card stack">
      <strong>Vorhandenes Spotify-Gerät</strong>
      <div class="music-device-picker">
        <select id="music-device-select" aria-label="Spotify-Gerät">
          ${spotifyDevices.map((device) => `<option value="${escapeHtml(device.id)}" ${device.active ? 'selected' : ''}>${escapeHtml(device.name)}${device.type ? ` · ${escapeHtml(device.type)}` : ''}</option>`).join('')}
        </select>
        <button type="button" class="btn btn-primary" id="music-start">Session starten</button>
      </div>
    </div>` : '';
  const localPlayer = localPlayback ? `
    <div class="card stack">
      <strong>Ton über diesen Browser, TV oder HDMI</strong>
      <p class="muted">Der Browser auf dem Musik-PC wird selbst zum Spotify-Gerät. Der Ton folgt dem Audioausgang dieses Computers; das Handy wird nicht benötigt.</p>
      ${localPlayback.ready
        ? '<button type="button" class="btn btn-primary btn-block" id="music-start-local-player">Diesen Browser als Musikgerät starten</button>'
        : `<p class="muted">${escapeHtml(localPlayback.message || 'Spotify muss für die Browser-Wiedergabe neu freigegeben werden.')}</p><a class="btn btn-primary" href="${LOCAL_CONTROLLER_URL}" target="_blank" rel="noopener">Spotify-Freigabe öffnen</a>`}
    </div>` : '';
  return `${spotifyPicker}${localPlayer}
    <p class="muted">Hinweis: Eine reine Bluetooth-Soundbar ist kein eigenes Spotify-Gerät. Sie wird als Audioausgang des Handys oder Computers verwendet.</p>`;
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
    button.textContent = 'Diesen Browser als Musikgerät starten';
  }
}

function nowPlayingHtml(session) {
  const track = session.currentTrack;
  const playlist = session.playbackContext;
  const request = session.requests.find((entry) => entry.status === 'playing' && entry.trackUri === track?.uri);
  const hostControls = session.hostPlayerId === getMyId();
  const canControlPlayback = Boolean(getMyId());
  return `
    <section class="card stack grouped-page-section" aria-labelledby="music-now-title">
      <div class="grouped-page-section-title">
        <h2 id="music-now-title">Jetzt läuft</h2>
        <span class="badge badge-playing">${playlist ? 'Playlist · ' : ''}${session.isPlaying ? 'Läuft' : 'Pause'}</span>
      </div>
      <div class="card music-now-playing">
        ${track ? `
          ${track.imageUrl ? `<img class="music-cover" src="${escapeHtml(track.imageUrl)}" alt="" />` : `<div class="music-cover music-cover-placeholder">${icon('music')}</div>`}
          <div class="music-track-main">
            <strong class="music-track-title">${escapeHtml(track.name)}</strong>
            <span class="muted">${escapeHtml(track.artist)}</span>
            ${playlist ? `<span class="muted">Playlist · ${escapeHtml(playlist.name)}</span>` : ''}
            ${request ? `<span class="muted">gewünscht von ${escapeHtml(request.requestedByName)}</span>` : ''}
            <div class="music-progress" aria-label="Wiedergabefortschritt">
              <span style="transform:scaleX(${progressPercent(session) / 100});"></span>
            </div>
          </div>
          <span class="muted music-duration">${durationLabel(currentProgress(session))} / ${durationLabel(track.durationMs)}</span>
        ` : `
          ${emptyStateHtml(playlist
            ? `Playlist „${escapeHtml(playlist.name)}“ wird auf ${escapeHtml(session.deviceName)} gestartet…`
            : `Auf ${escapeHtml(session.deviceName)} läuft gerade kein Titel.`, { className: 'music-no-playback' })}
        `}
      </div>
      ${canControlPlayback ? `
        <div class="music-host-actions">
          <button type="button" class="btn" id="music-toggle-playback">${session.isPlaying ? 'Pausieren' : 'Fortsetzen'}</button>
          <button type="button" class="btn" id="music-skip">Überspringen</button>
          ${hostControls ? '<button type="button" class="btn btn-danger" id="music-end">Session beenden</button>' : ''}
        </div>` : ''}
    </section>`;
}

function requestQueueHtml(session) {
  const queued = session.requests.filter((entry) => entry.status === 'queued' || entry.status === 'sending');
  const playlist = session.playbackContext;
  const playlistMode = Boolean(playlist);
  const remainingPlaylistTracks = Number.isSafeInteger(playlist?.remainingTrackCount)
    ? Math.max(0, playlist.remainingTrackCount)
    : null;
  const followingCount = queued.length + (remainingPlaylistTracks ?? 0);
  const editable = Boolean(getMyId()) && !playlistMode;
  const sortable = editable && queued.length > 1;
  return `
    <section class="card stack grouped-page-section" aria-labelledby="music-queue-title">
      <div class="grouped-page-section-title">
        <h2 id="music-queue-title">Als Nächstes</h2>
        <span class="badge">${followingCount}</span>
      </div>
      ${remainingPlaylistTracks !== null ? `
        <div class="card row-between">
          <span class="music-track-main">
            <strong>${remainingPlaylistTracks} ${remainingPlaylistTracks === 1 ? 'Titel folgt' : 'Titel folgen'}</strong>
            <span class="muted">aus „${escapeHtml(playlist.name)}“</span>
          </span>
          <span class="badge">Playlist</span>
        </div>` : ''}
      ${queued.length ? `<div class="music-queue-list${sortable ? ' is-sortable' : ''}">${queued.map((entry, index) => `
        <div class="card music-queue-row" data-music-request="${escapeHtml(entry.id)}" ${sortable ? 'draggable="true"' : ''}>
          ${sortable ? `<span class="music-queue-drag" aria-hidden="true">${icon('gripVertical')}</span>` : ''}
          <span class="music-queue-position">${index + 1}</span>
          ${entry.imageUrl ? `<img class="music-queue-cover" src="${escapeHtml(entry.imageUrl)}" alt="" />` : ''}
          <span class="music-track-main">
            <strong class="music-track-title">${escapeHtml(entry.name)}</strong>
            <span class="muted">${escapeHtml(entry.artist)} · ${escapeHtml(entry.requestedByName)}</span>
          </span>
          <span class="muted music-queue-duration">${durationLabel(entry.durationMs)}</span>
          ${editable ? `<span class="music-queue-order-actions">
            ${sortable ? `<button type="button" class="icon-btn" data-music-move="up" aria-label="${escapeHtml(entry.name)} nach oben" ${index === 0 ? 'disabled' : ''}>${icon('arrowUp')}</button>
            <button type="button" class="icon-btn" data-music-move="down" aria-label="${escapeHtml(entry.name)} nach unten" ${index === queued.length - 1 ? 'disabled' : ''}>${icon('arrowDown')}</button>` : ''}
            <button type="button" class="icon-btn" data-music-remove aria-label="${escapeHtml(entry.name)} entfernen">${icon('trash')}</button>
          </span>` : ''}
        </div>`).join('')}</div>` : emptyStateHtml(playlistMode ? 'Keine zusätzlichen Songwünsche.' : 'Noch keine Songwünsche.')}
    </section>`;
}

export function musicActiveSessionHtml(status) {
  if (!status.session) return '';
  return `
    ${status.warning ? `<div class="card music-warning">${escapeHtml(status.warning)}</div>` : ''}
    ${nowPlayingHtml(status.session)}
    ${requestQueueHtml(status.session)}
    <section class="card stack grouped-page-section" aria-labelledby="music-search-title">
      <div class="grouped-page-section-title"><h2 id="music-search-title">Musik suchen</h2></div>
      <form id="music-search-form" class="music-search-form">
        <input type="search" id="music-search-input" minlength="2" maxlength="80" required aria-label="Spotify durchsuchen" placeholder="Titel, Interpret oder Playlist" autocomplete="off" value="${escapeHtml(searchQuery)}" />
        <button type="submit" class="btn btn-primary">Suchen</button>
      </form>
      <div id="music-search-results">${searchResultsHtml()}</div>
    </section>`;
}

function resolvedResultType(tracks, playlists, preferredType) {
  if (preferredType === 'playlists' && playlists.length) return 'playlists';
  if (preferredType === 'tracks' && tracks.length) return 'tracks';
  return playlists.length ? 'playlists' : 'tracks';
}

export function musicSearchResultsHtml(results, { loading: resultsLoading = false, resultType = 'tracks' } = {}) {
  if (resultsLoading) return emptyStateHtml('Spotify wird durchsucht…');
  if (results === null) return '';
  const tracks = Array.isArray(results?.tracks) ? results.tracks : [];
  const playlists = Array.isArray(results?.playlists) ? results.playlists : [];
  if (!tracks.length && !playlists.length) return emptyStateHtml('Keine Titel oder Playlists gefunden.');
  const activeType = resolvedResultType(tracks, playlists, resultType);
  const entries = activeType === 'playlists'
    ? playlists.map((playlist) => `
        <div class="card music-search-result">
          ${playlist.imageUrl ? `<img class="music-search-cover" src="${escapeHtml(playlist.imageUrl)}" alt="" />` : ''}
          <span class="music-track-main">
            <strong class="music-track-title">${escapeHtml(playlist.name)}</strong>
            <span class="muted">${escapeHtml(playlist.owner)} · ${escapeHtml(playlist.trackCount)} Titel</span>
          </span>
          <button type="button" class="btn btn-sm" data-music-playlist="${escapeHtml(playlist.id)}">Abspielen</button>
        </div>`).join('')
    : tracks.map((track) => `
        <div class="card music-search-result">
          ${track.imageUrl ? `<img class="music-search-cover" src="${escapeHtml(track.imageUrl)}" alt="" />` : ''}
          <span class="music-track-main">
            <strong class="music-track-title">${escapeHtml(track.name)}</strong>
            <span class="muted">${escapeHtml(track.artist)}</span>
          </span>
          <button type="button" class="btn btn-sm" data-music-add="${escapeHtml(track.id)}">Hinzufügen</button>
        </div>`).join('');
  return `<div class="stack music-search-results">
    <div class="music-result-type-switch" role="group" aria-label="Suchergebnisse filtern">
      <button type="button" class="btn music-result-type-button${activeType === 'tracks' ? ' btn-primary' : ''}" data-music-result-type="tracks" aria-pressed="${activeType === 'tracks'}">${icon('music')}<span>Titel (${tracks.length})</span></button>
      <button type="button" class="btn music-result-type-button${activeType === 'playlists' ? ' btn-primary' : ''}" data-music-result-type="playlists" aria-pressed="${activeType === 'playlists'}">${icon('library')}<span>Playlists (${playlists.length})</span></button>
    </div>
    <div class="two-column-card-grid">${entries}</div>
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

function wireQueue(container, ctx) {
  const list = container.querySelector('.music-queue-list');
  if (!list) return;
  let draggedId = null;

  async function saveOrder(requestIds) {
    try {
      await api.music.reorder(getMyId(), requestIds);
      invalidateMusic();
      ctx.rerender();
    } catch (error) {
      showToast(error.message, { error: true });
      invalidateMusic();
      ctx.rerender();
    }
  }

  function currentIds() {
    return [...list.querySelectorAll('[data-music-request]')].map((row) => row.dataset.musicRequest);
  }

  list.querySelectorAll('[data-music-remove]').forEach((button) => {
    button.addEventListener('click', async () => {
      const row = button.closest('[data-music-request]');
      button.disabled = true;
      try {
        await api.music.removeRequest(getMyId(), row.dataset.musicRequest);
        invalidateMusic();
        ctx.rerender();
      } catch (error) {
        showToast(error.message, { error: true });
        button.disabled = false;
      }
    });
  });

  if (!list.classList.contains('is-sortable')) return;

  list.querySelectorAll('[data-music-request]').forEach((row) => {
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
      void saveOrder(ids);
    });
  });

  list.querySelectorAll('[data-music-move]').forEach((button) => {
    button.addEventListener('click', () => {
      const row = button.closest('[data-music-request]');
      const ids = currentIds();
      const index = ids.indexOf(row.dataset.musicRequest);
      const target = button.dataset.musicMove === 'up' ? index - 1 : index + 1;
      if (target < 0 || target >= ids.length) return;
      [ids[index], ids[target]] = [ids[target], ids[index]];
      void saveOrder(ids);
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

function wireSetup(container, ctx) {
  container.querySelector('#music-copy-pairing')?.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(pairing.code);
      showToast('Kopplungscode kopiert.');
    } catch {
      showToast('Kopieren nicht möglich – bitte den Code manuell markieren.', { error: true });
    }
  });
  container.querySelector('#music-reconnect-controller')?.addEventListener('click', async (event) => {
    const button = event.currentTarget;
    button.disabled = true;
    try {
      pairing = await api.music.createPairing(getMyId());
      showToast('Kopplungscode für den vorhandenen Controller erzeugt.');
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
      showToast('Controller-Paket wird heruntergeladen.');
      ctx.rerender();
    } catch (error) {
      showToast(error.message, { error: true });
      button.disabled = false;
    }
  });
}

function wireConnection(container, ctx) {
  container.querySelector('#music-disconnect')?.addEventListener('click', async () => {
    try {
      await api.music.disconnectController(getMyId());
      pairing = null;
      cache = { ...cache, controller: null };
      cacheStale = false;
      try {
        pairing = await api.music.createPairing(getMyId());
        showToast('Controller entkoppelt. Neuer Kopplungscode wurde erzeugt.');
      } catch (error) {
        showToast(`Controller entkoppelt. ${error.message}`, { error: true });
      }
      ctx.rerender();
    } catch (error) {
      showToast(error.message, { error: true });
    }
  });
  container.querySelector('#music-load-devices')?.addEventListener('click', async () => {
    const area = container.querySelector('#music-device-area');
    area.innerHTML = emptyStateHtml('Geräte werden geladen…');
    try {
      const [{ devices }, localPlayback] = await Promise.all([
        api.music.devices(),
        localSpotifyPlaybackStatus(),
      ]);
      if (localPlayback?.ready) void preloadSpotifyPlaybackSdk().catch(() => {});
      area.innerHTML = musicDevicePickerHtml(devices, localPlayback);
      area.querySelector('#music-start')?.addEventListener('click', async () => {
        try {
          await api.music.start(getMyId(), area.querySelector('#music-device-select').value);
          invalidateMusic();
          ctx.rerender();
        } catch (error) {
          showToast(error.message, { error: true });
        }
      });
      area.querySelector('#music-start-local-player')?.addEventListener('click', (event) => {
        void startLocalMusicSession(ctx, event.currentTarget, localPlayback);
      });
    } catch (error) {
      area.innerHTML = emptyStateHtml(error.message);
    }
  });
}

function wireSession(container, ctx) {
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
        ${backButtonHtml({ view: 'more' })}
        <h1 class="view-title title-with-info" data-music-view-root>
          <span>Jam</span>
          ${infoTooltipHtml('music-help', 'Jam', JAM_HELP)}
        </h1>
      </div>
    </div>
    <div class="grouped-page-sections">
      ${cache ? `${musicSetupHtml(cache)}${connectionHtml(cache)}${musicActiveSessionHtml(cache)}` : `<section class="card grouped-page-section">${emptyStateHtml('Lädt…')}</section>`}
    </div>`;
  container.scrollTop = scrollTop;
  if (!cache) {
    scheduleProgress(container);
    return;
  }
  wireInfoTooltips(container);
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
