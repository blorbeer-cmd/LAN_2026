import { api } from '../api.js';
import { escapeHtml } from '../format.js';
import { icon } from '../icons.js';
import { showToast } from '../toast.js';
import { getMyId, whoAmICardHtml, wireWhoAmICard } from '../whoami.js';

let cache = null;
let loading = false;
let refreshTimer = null;
let progressFrame = null;
let searchQuery = '';
let searchResults = null;
let searchLoading = false;
let pairing = null;

export function invalidateMusic() {
  cache = null;
}

function scheduleRefresh(container, ctx) {
  if (refreshTimer) clearTimeout(refreshTimer);
  if (!cache?.session && cache?.controller?.online) return;
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
  } catch (error) {
    if (!silent) showToast(error.message, { error: true });
  } finally {
    loading = false;
    const searchHasFocus = container?.querySelector('#music-search-input') === document.activeElement;
    if (silent && searchHasFocus) scheduleRefresh(container, ctx);
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

function setupHtml(status) {
  if (!status.controller?.online) {
    return `
      <section class="card stack music-setup-card">
          ${status.controller ? `<p><strong>${escapeHtml(status.controller.label)}</strong><span class="muted"> ist gerade nicht erreichbar.</span></p>` : ''}
          ${pairing ? `<div class="music-pairing-panel">
            <div class="music-pairing-header">
              <span class="music-pairing-title"><strong>Kopplungscode</strong><small>Im Controller-Paket bereits hinterlegt</small></span>
              <span class="badge music-pairing-validity">10 Minuten gültig</span>
            </div>
            <div class="music-pairing-code">
              <strong id="music-pairing-value">${escapeHtml(pairing.code)}</strong>
              <button type="button" class="icon-btn music-pairing-copy" id="music-copy-pairing" title="Kopplungscode kopieren" aria-label="Kopplungscode kopieren">${icon('copy')}</button>
            </div>
          </div>
          <p class="muted music-pairing-hint">ZIP entpacken und die passende Startdatei öffnen.</p>` : ''}
          ${status.canManageController
            ? `<button type="button" class="btn btn-primary btn-block" id="music-download-controller" ${getMyId() ? '' : 'disabled'}>Controller herunterladen</button>`
            : '<div class="empty-state">Ein Gruppen-Admin richtet den Jam-Controller ein.</div>'}
      </section>`;
  }
  return '';
}

function connectionHtml(status) {
  const controller = status.controller;
  if (!controller?.online || status.session) return '';
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

function nowPlayingHtml(session) {
  const track = session.currentTrack;
  const request = session.requests.find((entry) => entry.status === 'playing' && entry.trackUri === track?.uri);
  const hostControls = session.hostPlayerId === getMyId();
  const canControlPlayback = Boolean(getMyId());
  return `
    <section class="card stack grouped-page-section" aria-labelledby="music-now-title">
      <div class="grouped-page-section-title">
        <h2 id="music-now-title">Jetzt läuft</h2>
        <span class="badge badge-playing">${session.isPlaying ? 'Läuft' : 'Pause'}</span>
      </div>
      <div class="card music-now-playing">
        ${track ? `
          ${track.imageUrl ? `<img class="music-cover" src="${escapeHtml(track.imageUrl)}" alt="" />` : `<div class="music-cover music-cover-placeholder">${icon('music')}</div>`}
          <div class="music-track-main">
            <strong class="music-track-title">${escapeHtml(track.name)}</strong>
            <span class="muted">${escapeHtml(track.artist)}</span>
            ${request ? `<span class="muted">gewünscht von ${escapeHtml(request.requestedByName)}</span>` : ''}
            <div class="music-progress" aria-label="Wiedergabefortschritt">
              <span style="transform:scaleX(${progressPercent(session) / 100});"></span>
            </div>
          </div>
          <span class="muted music-duration">${durationLabel(currentProgress(session))} / ${durationLabel(track.durationMs)}</span>
        ` : `
          <div class="empty-state music-no-playback">Auf ${escapeHtml(session.deviceName)} läuft gerade kein Titel.</div>
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
  const editable = Boolean(getMyId());
  const sortable = editable && queued.length > 1;
  return `
    <section class="card stack grouped-page-section" aria-labelledby="music-queue-title">
      <div class="grouped-page-section-title">
        <h2 id="music-queue-title">Als Nächstes</h2>
        <span class="badge">${queued.length}</span>
      </div>
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
        </div>`).join('')}</div>` : '<div class="empty-state">Noch keine Songwünsche.</div>'}
    </section>`;
}

function activeSessionHtml(status) {
  if (!status.session) return '';
  return `
    ${status.warning ? `<div class="card music-warning">${escapeHtml(status.warning)}</div>` : ''}
    ${nowPlayingHtml(status.session)}
    <section class="card stack grouped-page-section" aria-labelledby="music-search-title">
      <div class="grouped-page-section-title"><h2 id="music-search-title">Song hinzufügen</h2></div>
      <form id="music-search-form" class="music-search-form">
        <input type="search" id="music-search-input" minlength="2" maxlength="80" required placeholder="Titel oder Interpret" autocomplete="off" value="${escapeHtml(searchQuery)}" />
        <button type="submit" class="btn btn-primary">Suchen</button>
      </form>
      <div id="music-search-results">${searchResultsHtml()}</div>
    </section>
    ${requestQueueHtml(status.session)}`;
}

function searchResultsHtml() {
  if (searchLoading) return '<div class="empty-state">Spotify wird durchsucht…</div>';
  if (searchResults === null) return '';
  return searchResults.length ? `<div class="two-column-card-grid music-search-results">${searchResults.map((track) => `
    <div class="card music-search-result">
      ${track.imageUrl ? `<img class="music-search-cover" src="${escapeHtml(track.imageUrl)}" alt="" />` : ''}
      <span class="music-track-main">
        <strong class="music-track-title">${escapeHtml(track.name)}</strong>
        <span class="muted">${escapeHtml(track.artist)}</span>
      </span>
      <button type="button" class="btn btn-sm" data-music-add="${escapeHtml(track.id)}">Hinzufügen</button>
    </div>`).join('')}</div>` : '<div class="empty-state">Keine Titel gefunden.</div>';
}

function wireSearchResults(container) {
  container.querySelectorAll('[data-music-add]').forEach((button) => {
    button.addEventListener('click', async () => {
      button.disabled = true;
      try {
        await api.music.request(getMyId(), button.dataset.musicAdd);
        showToast('Zur Warteschlange hinzugefügt.');
        cache = null;
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
      cache = null;
      ctx.rerender();
    } catch (error) {
      showToast(error.message, { error: true });
      cache = null;
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
        cache = null;
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
      cache = null;
      ctx.rerender();
    } catch (error) {
      showToast(error.message, { error: true });
    }
  });
  container.querySelector('#music-load-devices')?.addEventListener('click', async () => {
    const area = container.querySelector('#music-device-area');
    area.innerHTML = '<div class="empty-state">Geräte werden geladen…</div>';
    try {
      const { devices } = await api.music.devices();
      if (!devices.length) {
        area.innerHTML = '<div class="empty-state">Spotify auf dem gewünschten Gerät öffnen und dort kurz Musik starten.</div>';
        return;
      }
      area.innerHTML = `
        <div class="music-device-picker">
          <select id="music-device-select" aria-label="Spotify-Gerät">
            ${devices.map((device) => `<option value="${escapeHtml(device.id)}" ${device.active ? 'selected' : ''}>${escapeHtml(device.name)}${device.type ? ` · ${escapeHtml(device.type)}` : ''}</option>`).join('')}
          </select>
          <button type="button" class="btn btn-primary" id="music-start">Session starten</button>
        </div>`;
      area.querySelector('#music-start').addEventListener('click', async () => {
        try {
          await api.music.start(getMyId(), area.querySelector('#music-device-select').value);
          cache = null;
          ctx.rerender();
        } catch (error) {
          showToast(error.message, { error: true });
        }
      });
    } catch (error) {
      area.innerHTML = `<div class="empty-state">${escapeHtml(error.message)}</div>`;
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
      const { tracks } = await api.music.search(query);
      searchResults = tracks;
      searchLoading = false;
      target.innerHTML = searchResultsHtml();
      wireSearchResults(container);
    } catch (error) {
      searchResults = null;
      searchLoading = false;
      target.innerHTML = `<div class="empty-state">${escapeHtml(error.message)}</div>`;
    }
  });
  container.querySelector('#music-toggle-playback')?.addEventListener('click', async () => {
    try {
      await api.music.setPlaying(getMyId(), !cache.session.isPlaying);
      cache = null;
      ctx.rerender();
    } catch (error) {
      showToast(error.message, { error: true });
    }
  });
  container.querySelector('#music-skip')?.addEventListener('click', async () => {
    try {
      await api.music.skip(getMyId());
      cache = null;
      ctx.rerender();
    } catch (error) {
      showToast(error.message, { error: true });
    }
  });
  container.querySelector('#music-end')?.addEventListener('click', async () => {
    try {
      const result = await api.music.end(getMyId());
      if (result?.warning) showToast(result.warning);
      cache = null;
      ctx.rerender();
    } catch (error) {
      showToast(error.message, { error: true });
    }
  });
}

export function renderMusic(container, ctx) {
  const activeSearch = container.querySelector('#music-search-input');
  const restoreSearchFocus = activeSearch === document.activeElement;
  const selectionStart = restoreSearchFocus ? activeSearch.selectionStart : null;
  const selectionEnd = restoreSearchFocus ? activeSearch.selectionEnd : null;
  if (restoreSearchFocus) searchQuery = activeSearch.value;
  if (cache === null && !loading) void load(ctx);
  container.innerHTML = `
    <button type="button" class="btn btn-sm" data-navigate="more">${icon('chevronLeft')} Zurück</button>
    <h1 class="view-title">Jam</h1>
    ${whoAmICardHtml('music-whoami')}
    <div class="grouped-page-sections">
      ${cache ? `${setupHtml(cache)}${connectionHtml(cache)}${activeSessionHtml(cache)}` : '<section class="card grouped-page-section"><div class="empty-state">Lädt…</div></section>'}
    </div>`;
  wireWhoAmICard(container, 'music-whoami', ctx);
  if (!cache) {
    scheduleProgress(container);
    return;
  }
  wireSetup(container, ctx);
  wireConnection(container, ctx);
  wireSession(container, ctx);
  wireSearchResults(container);
  wireQueue(container, ctx);
  if (restoreSearchFocus) {
    const nextSearch = container.querySelector('#music-search-input');
    nextSearch?.focus();
    if (selectionStart !== null && selectionEnd !== null) {
      nextSearch?.setSelectionRange(selectionStart, selectionEnd);
    }
  }
  scheduleProgress(container);
  scheduleRefresh(container, ctx);
}
