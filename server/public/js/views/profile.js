// "Mein Profil" view: each invited player picks/creates their own identity
// (reusing the whoami.js mechanism already used by the Live view for pausing
// and by Votes for casting a vote — this tool has no real per-person login,
// just a shared access token, so "who am I" is a convenience the browser
// remembers locally, not a security boundary), then can maintain their own
// gamer name (unique across everyone), a profile picture, their own skill
// ratings, and browse their personal stats: playtime per game and per event,
// how much they multitasked, and how much of their playtime was actually
// active vs. just idling/AFK.

import { api } from '../api.js';
import { state } from '../state.js';
import { escapeHtml, avatarHtml, formatDateTime, gameBadgeHtml } from '../format.js';
import { getMyId, setMyId } from '../whoami.js';
import { showToast } from '../toast.js';

let statsCache = null;
let statsLoading = false;
let statsForPlayerId = null;
let statsEventId = '';

// Resizes/compresses a picked image client-side so the DB (a single SQLite
// file synced/backed up as a whole) doesn't balloon from full-resolution
// phone photos — a small square thumbnail is all a profile picture needs.
function resizeImageFile(file, maxSize = 200, quality = 0.8) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Datei konnte nicht gelesen werden.'));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('Das ist kein gültiges Bild.'));
      img.onload = () => {
        const scale = Math.min(1, maxSize / Math.max(img.width, img.height));
        const w = Math.max(1, Math.round(img.width * scale));
        const h = Math.max(1, Math.round(img.height * scale));
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        canvas.getContext('2d').drawImage(img, 0, 0, w, h);
        resolve(canvas.toDataURL('image/jpeg', quality));
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

function renderIdentityPicker(container, ctx) {
  const myId = getMyId();
  container.innerHTML = `
    <h1 class="view-title">👤 Mein Profil</h1>
    <div class="card stack">
      <div>Wer bist du?</div>
      <select id="profile-whoami">
        <option value="">– wählen –</option>
        ${state.players.map((p) => `<option value="${p.id}" ${p.id === myId ? 'selected' : ''}>${escapeHtml(p.name)}</option>`).join('')}
      </select>
      <div class="muted" style="font-size:0.8rem;">Noch nicht dabei? Leg dir unten ein Profil an.</div>
      <form id="profile-new-form" class="row">
        <input type="text" id="profile-new-name" placeholder="Dein Gamer-Name" maxlength="60" style="flex:1;" required />
        <button type="submit" class="btn btn-primary btn-sm">Anlegen</button>
      </form>
    </div>
  `;

  container.querySelector('#profile-whoami').addEventListener('change', (e) => {
    if (!e.target.value) return;
    setMyId(e.target.value);
    ctx.rerender();
  });

  container.querySelector('#profile-new-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = container.querySelector('#profile-new-name').value.trim();
    if (!name) return;
    try {
      const created = await api.players.create({ name });
      await ctx.refresh();
      setMyId(created.id);
      showToast(`Willkommen, ${created.name}!`);
      ctx.rerender();
    } catch (err) {
      showToast(err.message, { error: true });
    }
  });
}

async function loadStats(playerId, eventId, ctx) {
  statsLoading = true;
  ctx.rerender();
  try {
    const params = eventId ? { eventId } : {};
    statsCache = await api.players.stats(playerId, params);
    statsForPlayerId = playerId;
  } catch (err) {
    showToast(err.message, { error: true });
    statsCache = null;
  } finally {
    statsLoading = false;
    ctx.rerender();
  }
}

function ratingFor(playerId, gameId) {
  const entry = state.skills.find((s) => s.player_id === playerId && s.game_id === gameId);
  return entry ? entry.rating : 5;
}

function renderEventOptions() {
  const sorted = [...state.events].sort((a, b) => b.starts_at - a.starts_at);
  const options = sorted
    .map((e) => `<option value="${e.id}" ${e.id === statsEventId ? 'selected' : ''}>${escapeHtml(e.name)}</option>`)
    .join('');
  return `<option value="" ${statsEventId === '' ? 'selected' : ''}>🌐 Gesamt (alle Events)</option>${options}`;
}

function renderStats(me) {
  if (statsLoading || !statsCache) {
    return `<div class="empty-state" style="padding:20px;">Lädt…</div>`;
  }
  const s = statsCache;

  const activeHint =
    s.activePercent !== null
      ? `<div class="muted" style="font-size:0.8rem;">davon aktiv gespielt: ${escapeHtml(s.activeFormatted)} (${s.activePercent}%)</div>`
      : '';

  const kpis = `
    <div class="grid" style="grid-template-columns:repeat(auto-fit, minmax(140px, 1fr));">
      <div class="card">
        <div class="muted" style="font-size:0.8rem;">Gesamtspielzeit</div>
        <div class="lb-points">${escapeHtml(s.formatted)}</div>
        ${activeHint}
      </div>
      <div class="card">
        <div class="muted" style="font-size:0.8rem;">Sessions</div>
        <div class="lb-points">${s.sessionCount}</div>
      </div>
      <div class="card">
        <div class="muted" style="font-size:0.8rem;">Verschiedene Spiele</div>
        <div class="lb-points">${s.distinctGamesCount}</div>
      </div>
      <div class="card">
        <div class="muted" style="font-size:0.8rem;">Mehrere Spiele gleichzeitig</div>
        <div class="lb-points">${escapeHtml(s.simultaneous.multiGameFormatted)}</div>
        ${s.simultaneous.maxSimultaneous > 0 ? `<div class="muted" style="font-size:0.8rem;">max. ${s.simultaneous.maxSimultaneous} gleichzeitig</div>` : ''}
      </div>
    </div>
  `;

  const awardsHtml = s.awards.length
    ? `<div class="grid" style="grid-template-columns:repeat(auto-fit, minmax(160px, 1fr));">
        ${s.awards
          .map(
            (a) => `
          <div class="card">
            <div class="row-between">
              <span style="font-size:1.4rem;">${escapeHtml(a.emoji)}</span>
              <span class="lb-points">${escapeHtml(a.value)}</span>
            </div>
            <div class="player-name">${escapeHtml(a.title)}</div>
            <div class="muted" style="font-size:0.8rem;">${escapeHtml(a.description)}</div>
          </div>`
          )
          .join('')}
      </div>`
    : `<div class="empty-state" style="padding:20px;"><span class="emoji">🏅</span>Noch keine eigenen Awards.</div>`;

  const gamesHtml = s.games.length
    ? s.games
        .map(
          (g) => `
        <div class="lb-row">
          <span>${escapeHtml(g.gameIcon)}</span>
          <span style="flex:1;">
            ${escapeHtml(g.gameName)}
            ${g.activeMs > 0 && g.activeMs < g.totalMs ? `<div class="muted" style="font-size:0.75rem;">davon aktiv: ${escapeHtml(g.activeFormatted)}</div>` : ''}
          </span>
          <span class="lb-points">${escapeHtml(g.formatted)}</span>
        </div>`
        )
        .join('')
    : `<div class="empty-state" style="padding:20px;">Noch keine Spielzeit erfasst.</div>`;

  const eventsHtml = s.events.length
    ? s.events
        .map(
          (e) => `
        <div class="lb-row">
          <span style="flex:1;">${escapeHtml(e.eventName)}</span>
          <span class="lb-points">${escapeHtml(e.formatted)}</span>
        </div>`
        )
        .join('')
    : `<div class="empty-state" style="padding:20px;">Noch keine Events mit Spielzeit.</div>`;

  const longestHtml = s.longestSessions.length
    ? s.longestSessions
        .map(
          (l) => `
        <div class="lb-row">
          <span style="flex:1;">
            ${escapeHtml(l.gameIcon)} ${escapeHtml(l.gameName)}
            <div class="muted" style="font-size:0.75rem;">${formatDateTime(l.startedAt)} – ${l.endedAt ? formatDateTime(l.endedAt) : 'läuft noch'}</div>
          </span>
          <span class="lb-points">${escapeHtml(l.formatted)}</span>
        </div>`
        )
        .join('')
    : `<div class="empty-state" style="padding:20px;">Noch keine Sessions.</div>`;

  return `
    <div class="card stack">
      <select id="profile-stats-event">${renderEventOptions()}</select>
    </div>
    ${kpis}

    <div class="section-title">🏅 Meine Erfolge</div>
    ${awardsHtml}

    <div class="section-title">🎮 Spielzeit pro Spiel</div>
    <div class="card">${gamesHtml}</div>

    <div class="section-title">📅 Spielzeit pro Event</div>
    <div class="card">${eventsHtml}</div>

    <div class="section-title">🏃 Meine längsten Sessions</div>
    <div class="card">${longestHtml}</div>
  `;
}

export function renderProfile(container, ctx) {
  const myId = getMyId();
  const me = state.players.find((p) => p.id === myId);
  if (!me) {
    renderIdentityPicker(container, ctx);
    return;
  }

  if (statsForPlayerId !== myId && !statsLoading) {
    loadStats(myId, statsEventId, ctx);
  }

  const skillRows = state.games
    .map((g) => {
      const rating = ratingFor(myId, g.id);
      return `
        <div class="skill-row" data-game="${g.id}">
          <span class="row" style="gap:8px;">${gameBadgeHtml(g, 24)} ${escapeHtml(g.name)}</span>
          <span class="skill-value">${rating}</span>
          <input type="range" class="skill-row-slider" min="1" max="10" step="1" value="${rating}" />
        </div>`;
    })
    .join('');

  container.innerHTML = `
    <div class="row-between">
      <h1 class="view-title">👤 Mein Profil</h1>
      <button type="button" class="btn btn-sm" id="profile-not-me">Nicht du?</button>
    </div>

    <div class="card stack">
      <div class="row" style="align-items:center;">
        <label for="profile-avatar-input" style="cursor:pointer;">
          ${avatarHtml(me, 64)}
        </label>
        <input type="file" id="profile-avatar-input" accept="image/*" hidden />
        <div class="stack" style="flex:1;gap:6px;">
          <div class="row">
            <input type="color" id="profile-color" value="${me.color}" />
            <input type="text" id="profile-name" value="${escapeHtml(me.name)}" maxlength="60" style="flex:1;" />
          </div>
          <button type="button" class="btn btn-primary btn-sm" id="profile-save">Speichern</button>
        </div>
      </div>
      <div class="muted" style="font-size:0.8rem;">Bild antippen zum Ändern. Name muss über alle Spieler eindeutig sein.</div>
    </div>

    ${state.games.length > 0 ? `<div class="section-title">Skill-Ratings</div><div class="card">${skillRows}</div>` : ''}

    <div class="section-title">📊 Meine Statistiken</div>
    <div id="profile-stats">${renderStats(me)}</div>
  `;

  container.querySelector('#profile-not-me').addEventListener('click', () => {
    setMyId('');
    statsForPlayerId = null;
    ctx.rerender();
  });

  container.querySelector('#profile-save').addEventListener('click', async () => {
    const name = container.querySelector('#profile-name').value.trim();
    const color = container.querySelector('#profile-color').value;
    if (!name) return showToast('Name darf nicht leer sein.', { error: true });
    try {
      await api.players.update(myId, { name, color });
      await ctx.refresh();
      showToast('Gespeichert.');
    } catch (err) {
      showToast(err.message, { error: true });
    }
  });

  container.querySelector('#profile-avatar-input').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      const avatar = await resizeImageFile(file);
      await api.players.update(myId, { avatar });
      await ctx.refresh();
      showToast('Profilbild aktualisiert.');
    } catch (err) {
      showToast(err.message, { error: true });
    }
  });

  container.querySelectorAll('.skill-row').forEach((row) => {
    const gameId = row.dataset.game;
    const slider = row.querySelector('input[type="range"]');
    const valueEl = row.querySelector('.skill-value');
    let debounceTimer = null;
    slider.addEventListener('input', () => {
      valueEl.textContent = slider.value;
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(async () => {
        try {
          await api.skills.set(myId, gameId, parseInt(slider.value, 10));
          await ctx.refresh();
        } catch (err) {
          showToast(err.message, { error: true });
        }
      }, 250);
    });
  });

  const statsEventSelect = container.querySelector('#profile-stats-event');
  if (statsEventSelect) {
    statsEventSelect.addEventListener('change', (e) => {
      statsEventId = e.target.value;
      statsForPlayerId = null;
      ctx.rerender();
    });
  }
}
