// Live-status board (FR-13): who's currently playing what, updated in
// realtime. This is the home view — the thing people check most often.

import { api } from '../api.js';
import { state } from '../state.js';
import { escapeHtml, formatSince, stateLabel, avatarHtml, gameBadgeHtml, gameChipsHtml } from '../format.js';
import { getMyId, whoAmICardHtml, wireWhoAmICard } from '../whoami.js';
import { showToast } from '../toast.js';
import { icon } from '../icons.js';

const STATE_RANK = { playing: 0, paused: 1, offline: 2 };

// "Jetzt zocken" pings live in their own cache (like vote/matchmaking
// history), refreshed from app.js via invalidatePings() on pings:changed.
let pingsCache = null;
let pingsLoading = false;
let pingFormOpen = false;

async function loadPings(ctx) {
  pingsLoading = true;
  try {
    const res = await api.pings.list();
    pingsCache = res.pings;
  } catch {
    pingsCache = [];
  } finally {
    pingsLoading = false;
    ctx.rerender();
  }
}

export function invalidatePings() {
  pingsCache = null;
}

// "Was steht an?" personal digest (open vote / ready tournament match /
// unrated live game). Keyed by which player it was loaded for, so switching
// "who am I" on this device refetches instead of showing someone else's.
let digestCache = null;
let digestLoadedForId = null;
let digestLoading = false;

async function loadDigest(ctx, myId) {
  digestLoading = true;
  try {
    digestCache = await api.digest.get(myId);
    digestLoadedForId = myId;
  } catch {
    digestCache = null;
    digestLoadedForId = null;
  } finally {
    digestLoading = false;
    ctx.rerender();
  }
}

export function invalidateDigest() {
  digestCache = null;
  digestLoadedForId = null;
}

function renderDigest(myId) {
  if (!myId || digestLoading || !digestCache || digestLoadedForId !== myId) return '';
  const items = [];
  if (digestCache.openVote) {
    items.push(`
      <div class="chip" data-navigate="votes" style="cursor:pointer;">
        ${icon('vote')} Abstimmung läuft – du hast noch nicht abgestimmt
      </div>`);
  }
  for (const m of digestCache.readyMatches) {
    items.push(`
      <div class="chip" data-navigate="tournaments" style="cursor:pointer;">
        ${icon('trophy')} ${gameBadgeHtml({ id: m.gameId, icon: m.gameIcon }, 20)} Dein Match ist bereit: ${escapeHtml(m.myTeamName)} vs. ${escapeHtml(m.opponentTeamName)}
      </div>`);
  }
  for (const g of digestCache.missingSkills) {
    items.push(`
      <div class="chip" data-navigate="profile" style="cursor:pointer;">
        ${icon('star')} ${gameBadgeHtml(g, 20)} Bewerte deinen Skill für ${escapeHtml(g.name)} – wird gerade gespielt
      </div>`);
  }
  if (items.length === 0) return '';
  return `
    <div class="section-title">Was steht an?</div>
    <div class="stack" style="gap:6px;margin-bottom:var(--space-4);">${items.join('')}</div>
  `;
}

function formatExpiresIn(expiresAt) {
  const diffMin = Math.round((expiresAt - Date.now()) / 60000);
  if (diffMin <= 0) return 'läuft gleich ab';
  if (diffMin < 60) return `noch ${diffMin} Min.`;
  const h = Math.floor(diffMin / 60);
  const m = diffMin % 60;
  return `noch ${h}h ${m}min`;
}

function renderPingForm() {
  if (!pingFormOpen) return '';
  const options = state.games.map((g) => `<option value="${g.id}">${escapeHtml(g.icon)} ${escapeHtml(g.name)}</option>`).join('');
  return `
    <div class="stack" style="margin-top:10px;gap:var(--space-2);">
      <select id="ping-game">${options}</select>
      <input type="text" id="ping-message" placeholder="Nachricht (optional)" maxlength="140" />
      <button type="button" class="btn btn-primary btn-block" id="ping-submit">Ping senden</button>
    </div>`;
}

function renderPings(myId) {
  if (pingsLoading || pingsCache === null) {
    return `<div class="empty-state" style="padding:var(--space-4);">Lädt…</div>`;
  }
  if (pingsCache.length === 0) {
    return `<div class="empty-state" style="padding:var(--space-4);"><span class="emoji">🎮</span>Gerade will niemand spontan spielen.</div>`;
  }
  return pingsCache
    .map((p) => {
      const isCreator = p.playerId === myId;
      const amInterested = myId && p.interested.some((i) => i.id === myId);
      const interestedAvatars = p.interested.length
        ? `<div class="row" style="gap:var(--space-1);margin-top:6px;">${p.interested.map((i) => avatarHtml(i, 24)).join('')}</div>`
        : '';
      const joinBtn =
        myId && !isCreator
          ? `<button type="button" class="btn btn-sm ${amInterested ? '' : 'btn-primary'}" data-ping-join="${p.id}">${amInterested ? 'Bin raus' : 'Ich bin dabei'}</button>`
          : '';
      return `
        <div class="card" style="margin-bottom:var(--space-2);">
          <div class="row-between">
            <span class="row" style="gap:var(--space-2);">${gameBadgeHtml({ id: p.gameId, icon: p.gameIcon }, 24)} <strong>${escapeHtml(p.gameName)}</strong></span>
            <button type="button" class="btn btn-sm btn-danger" data-ping-cancel="${p.id}" title="Ping beenden">✕</button>
          </div>
          <div class="muted" style="font-size:var(--font-size-sm);margin-top:var(--space-1);">
            ${avatarHtml({ color: p.playerColor, avatar: p.playerAvatar }, 18)} ${escapeHtml(p.playerName)}${p.message ? ` – „${escapeHtml(p.message)}"` : ''}
          </div>
          <div class="row-between" style="margin-top:var(--space-2);">
            <span class="muted" style="font-size:var(--font-size-xs);">${formatExpiresIn(p.expiresAt)}</span>
            ${joinBtn}
          </div>
          ${interestedAvatars}
        </div>`;
    })
    .join('');
}

// Groups currently-playing players by game (FR-27): a quick glance at who's
// in the same game right now, complementing the per-player list below.
function renderActiveGroups(players) {
  const byGame = new Map();
  for (const p of players) {
    if (p.state !== 'playing') continue;
    for (const g of p.games) {
      const entry = byGame.get(g.game_id) ?? { id: g.game_id, name: g.game_name, icon: g.game_icon, players: [] };
      entry.players.push(p.name);
      byGame.set(g.game_id, entry);
    }
  }
  if (byGame.size === 0) return '';

  const groups = [...byGame.values()]
    .sort((a, b) => b.players.length - a.players.length)
    .map(
      (g) => `
      <div class="chip" style="flex-wrap:wrap;">${gameBadgeHtml(g, 20)} <strong style="white-space:nowrap;">${escapeHtml(g.name)}</strong>: ${g.players.map(escapeHtml).join(', ')}</div>`
    )
    .join('');

  return `
    <div class="section-title">Gerade aktiv</div>
    <div class="stack" style="gap:6px;margin-bottom:var(--space-4);">${groups}</div>
  `;
}

export function renderLive(container, ctx) {
  const players = [...state.live].sort((a, b) => {
    const rankDiff = STATE_RANK[a.state] - STATE_RANK[b.state];
    if (rankDiff !== 0) return rankDiff;
    return a.name.localeCompare(b.name, 'de');
  });

  if (players.length === 0) {
    container.innerHTML = `
      <h1 class="view-title">Live-Status</h1>
      <div class="empty-state">
        <img src="/img/mascot.svg" alt="" width="72" height="66" class="mascot" />
        Noch keine Spieler angelegt.<br />
        <button type="button" class="btn btn-primary btn-sm" data-navigate="profile" style="margin-top:var(--space-3);">👤 Eigenes Profil anlegen</button>
      </div>`;
    return;
  }

  const myId = getMyId();
  const whoAmI = whoAmICardHtml('live-whoami', { marginBottom: '16px' });

  if (pingsCache === null && !pingsLoading) {
    loadPings(ctx);
  }
  if (myId && digestLoadedForId !== myId && !digestLoading) {
    loadDigest(ctx, myId);
  }

  const cards = players
    .map((p) => {
      const badgeClass = `badge-${p.state}`;
      const games = gameChipsHtml(p.games, p.activity_tracked);

      const noteLine =
        p.state === 'paused' && p.manual_note
          ? `<div class="muted" style="margin-top:var(--space-1);font-size:var(--font-size-sm);">${escapeHtml(p.manual_note)}</div>`
          : '';

      const isMe = p.player_id === myId;
      const pauseToggle = isMe
        ? `<button type="button" class="btn btn-sm" data-toggle-pause="${p.player_id}" data-paused="${p.state === 'paused' ? '1' : '0'}" style="margin-top:var(--space-2);">
            ${p.state === 'paused' ? '▶️ Bin wieder da' : '⏸️ Pause / Essen'}
          </button>`
        : '';

      return `
        <div class="card player-card">
          ${avatarHtml(p, 36)}
          <div class="player-card-main">
            <div class="row-between">
              <span class="player-name">${escapeHtml(p.name)}${isMe ? ' <span class=\"muted\">(du)</span>' : ''}</span>
              <span class="badge ${badgeClass}">${stateLabel(p.state)}</span>
            </div>
            ${games ? `<div class="player-card-games chip-list">${games}</div>` : ''}
            ${noteLine}
            ${pauseToggle}
          </div>
        </div>`;
    })
    .join('');

  container.innerHTML = `
    <h1 class="view-title">Live-Status</h1>
    ${whoAmI}
    ${renderDigest(myId)}
    <div class="card" style="margin-bottom:var(--space-4);">
      <div class="row-between">
        <strong>🎮 Jetzt zocken?</strong>
        ${myId ? `<button type="button" class="btn btn-sm ${pingFormOpen ? '' : 'btn-primary'}" id="ping-toggle">${pingFormOpen ? 'Abbrechen' : '+ Ping'}</button>` : ''}
      </div>
      ${myId ? renderPingForm() : `<div class="muted" style="font-size:var(--font-size-sm);margin-top:var(--space-1);">Wähle oben, wer du bist, um zu pingen.</div>`}
    </div>
    ${renderPings(myId)}
    ${renderActiveGroups(players)}
    <div class="card-grid">${cards}</div>
  `;

  wireWhoAmICard(container, 'live-whoami', ctx);

  const pingToggleBtn = container.querySelector('#ping-toggle');
  if (pingToggleBtn) {
    pingToggleBtn.addEventListener('click', () => {
      pingFormOpen = !pingFormOpen;
      ctx.rerender();
    });
  }

  const pingSubmitBtn = container.querySelector('#ping-submit');
  if (pingSubmitBtn) {
    pingSubmitBtn.addEventListener('click', async () => {
      const gameSelect = container.querySelector('#ping-game');
      const messageInput = container.querySelector('#ping-message');
      if (!gameSelect || !gameSelect.value) return showToast('Bitte ein Spiel auswählen.', { error: true });
      try {
        await api.pings.create({
          playerId: myId,
          gameId: gameSelect.value,
          message: messageInput.value.trim() || undefined,
        });
        pingFormOpen = false;
        showToast('Ping gesendet – viel Spaß beim Zocken!');
      } catch (err) {
        showToast(err.message, { error: true });
      }
    });
  }

  container.querySelectorAll('[data-ping-join]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      try {
        await api.pings.toggleInterested(btn.dataset.pingJoin, myId);
      } catch (err) {
        showToast(err.message, { error: true });
      }
    });
  });

  container.querySelectorAll('[data-ping-cancel]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      try {
        await api.pings.remove(btn.dataset.pingCancel);
      } catch (err) {
        showToast(err.message, { error: true });
      }
    });
  });

  container.querySelectorAll('[data-toggle-pause]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const isPaused = btn.dataset.paused === '1';
      try {
        await api.live.setNote(btn.dataset.togglePause, isPaused ? null : 'Pause / Essen');
        await ctx.refresh();
      } catch (err) {
        showToast(err.message, { error: true });
      }
    });
  });
}
