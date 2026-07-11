// Home (formerly "Live-Status"): the landing view and the page everyone
// keeps coming back to during the party. Stacks, in order of urgency:
// the personal "Was steht an?" digest, what's currently running (open vote /
// active tournament / open food order — the kiosk content, but tappable),
// the notification feed (recent pushes that concerned this player, each with
// the same deep link the push itself would open), the realtime live board,
// a leaderboard snapshot, and the seating plan.

import { api } from '../api.js';
import { state } from '../state.js';
import { escapeHtml, formatDateTime, stateLabel, avatarHtml, gameBadgeHtml, gameChipsHtml } from '../format.js';
import { getMyId, whoAmICardHtml, wireWhoAmICard } from '../whoami.js';
import { showToast } from '../toast.js';
import { icon } from '../icons.js';
import { renderSeatingPlan } from './seating.js';

const STATE_RANK = { playing: 0, paused: 1, offline: 2 };

let seatingCache = null;
let seatingLoading = false;

window.addEventListener('seating:changed', () => {
  seatingCache = null;
});

// A player's name/real name/avatar can change (players:changed) without the
// seating layout itself changing — the cached board would otherwise keep
// showing the old real name for the rest of the session on any device that
// already loaded it (CLAUDE.md: realtime by default, no manual reload).
export function invalidateHomeSeating() {
  seatingCache = null;
}

async function loadSeating(ctx) {
  seatingLoading = true;
  try {
    seatingCache = await api.seating.layout();
  } catch {
    seatingCache = null;
  } finally {
    seatingLoading = false;
    ctx.rerender();
  }
}

function renderHomeSeating(ctx) {
  if (seatingCache === null && !seatingLoading) loadSeating(ctx);
  return `<section class="live-seating">
    ${seatingLoading || seatingCache === null
      ? '<div class="empty-state" style="padding:var(--space-4);">Lädt…</div>'
      : renderSeatingPlan(seatingCache.layout, seatingCache.players)}
  </section>`;
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
        ${icon('activity')} ${gameBadgeHtml(g, 20)} Bewerte deinen Skill für ${escapeHtml(g.name)} – wird gerade gespielt
      </div>`);
  }
  if (items.length === 0) return '';
  return `
    <div class="section-title">Was steht an?</div>
    <div class="stack" style="gap:var(--space-2);margin-bottom:var(--space-4);">${items.join('')}</div>
  `;
}

// "Aktuell": the kiosk's status cards, but tappable — an open vote, active
// tournaments, open food orders, waiting arcade lobbies. None of these are
// part of the preloaded shared state, so they live in their own cache (like
// the seating plan), refreshed from app.js via invalidateHomeStatus() on
// their socket events.
let statusCache = null;
let statusLoading = false;

export function invalidateHomeStatus() {
  statusCache = null;
}

async function loadStatus(ctx) {
  statusLoading = true;
  try {
    const [tournaments, foodOrders, arcadeLobbies] = await Promise.all([
      api.tournaments.list(),
      api.foodOrders.list(),
      api.arcade.lobbies(),
    ]);
    statusCache = {
      tournaments,
      foodOrders: foodOrders.orders ?? [],
      arcadeLobbies: arcadeLobbies.lobbies ?? [],
    };
  } catch {
    statusCache = { tournaments: [], foodOrders: [], arcadeLobbies: [] };
  } finally {
    statusLoading = false;
    ctx.rerender();
  }
}

const FORMAT_LABELS = {
  single_elimination: 'K.O.-Turnier',
  round_robin: 'Liga',
  group_knockout: 'Gruppen + K.O.',
};

function statusCardHtml({ iconName, title, sub, navigate, action }) {
  return `
    <div class="card row-between" style="gap:var(--space-3);">
      <span class="row" style="gap:var(--space-2);min-width:0;">
        <span class="list-row-icon">${icon(iconName)}</span>
        <span style="min-width:0;">
          <div class="player-name">${title}</div>
          ${sub ? `<div class="muted" style="font-size:var(--font-size-sm);">${sub}</div>` : ''}
        </span>
      </span>
      <button type="button" class="btn btn-sm btn-primary" data-navigate="${navigate}" style="flex-shrink:0;">${action}</button>
    </div>`;
}

function renderStatus() {
  if (statusCache === null) return '';
  const cards = [];

  if (state.votes?.open) {
    const voters = state.votes.totalVoters ?? 0;
    cards.push(
      statusCardHtml({
        iconName: 'vote',
        title: state.votes.title ? escapeHtml(state.votes.title) : 'Abstimmung läuft',
        sub: `${voters} Teilnehmer bisher – Ergebnis nach dem Ende`,
        navigate: 'votes',
        action: 'Abstimmen',
      })
    );
  }

  for (const t of statusCache.tournaments.filter((t) => t.status === 'active')) {
    cards.push(
      statusCardHtml({
        iconName: 'swords',
        title: escapeHtml(t.name),
        sub: `${escapeHtml(t.gameName)} · ${FORMAT_LABELS[t.format] ?? t.format} · ${t.teamCount} Teams`,
        navigate: 'tournaments',
        action: 'Zum Turnier',
      })
    );
  }

  for (const o of statusCache.foodOrders.filter((o) => o.open)) {
    cards.push(
      statusCardHtml({
        iconName: 'hamburger',
        title: `Sammelbestellung „${escapeHtml(o.title)}"`,
        sub: o.sendAt ? `Geht raus um ${formatDateTime(o.sendAt)} Uhr` : 'Zeitpunkt noch offen',
        navigate: 'foodOrders',
        action: 'Eintragen',
      })
    );
  }

  for (const l of statusCache.arcadeLobbies) {
    cards.push(
      statusCardHtml({
        iconName: 'joystick',
        title: `${escapeHtml(l.title)}-Lobby offen`,
        sub: `Von ${escapeHtml(l.hostName)} · ${l.playerCount} ${l.playerCount === 1 ? 'Spieler wartet' : 'Spieler warten'}`,
        navigate: 'arcade',
        action: 'Mitmachen',
      })
    );
  }

  if (cards.length === 0) return '';
  return `
    <div class="section-title">Aktuell</div>
    <div class="stack" style="gap:var(--space-2);margin-bottom:var(--space-4);">${cards.join('')}</div>
  `;
}

// "Mitteilungen": the recent push notifications that concerned this player
// (Durchsagen, neue Abstimmung, Turnier-Events, Bestellungen, ...), straight
// from the server's push log — so someone coming back from AFK sees what
// they missed even if their phone never showed the push. Each entry links
// into the same view the push notification itself would open.
let feedCache = null;
let feedLoadedForId = null;
let feedLoading = false;

export function invalidatePushFeed() {
  feedCache = null;
  feedLoadedForId = null;
}

async function loadFeed(ctx, myId) {
  feedLoading = true;
  try {
    const res = await api.push.log(myId);
    feedCache = res.entries;
    feedLoadedForId = myId;
  } catch {
    feedCache = [];
    feedLoadedForId = myId;
  } finally {
    feedLoading = false;
    ctx.rerender();
  }
}

const FEED_LIMIT = 8;
const FEED_LINK_LABELS = {
  votes: 'Zur Abstimmung',
  tournaments: 'Zum Turnier',
  matchmaking: 'Zu den Teams',
  foodOrders: 'Zur Bestellung',
  arcade: 'Zur Arcade',
  broadcast: 'Zu den Durchsagen',
};

// A push url like "/#votes" deep-links into a view; anything else (or a
// hash we don't know) just gets no jump-off button.
function feedLinkView(url) {
  const hashIndex = (url || '').indexOf('#');
  if (hashIndex === -1) return null;
  const view = url.slice(hashIndex + 1);
  return FEED_LINK_LABELS[view] ? view : null;
}

function renderFeed(myId) {
  if (!myId || feedLoading || feedCache === null || feedLoadedForId !== myId) return '';
  if (feedCache.length === 0) return '';

  const rows = feedCache
    .slice(0, FEED_LIMIT)
    .map((e, i) => {
      const view = feedLinkView(e.url);
      const directBadge = e.audience === 'direct' ? `<span class="badge badge-playing">Für dich</span>` : '';
      return `
        <div class="stack" style="gap:var(--space-1);${i > 0 ? 'border-top:1px solid var(--border);padding-top:var(--space-3);' : ''}">
          <div class="row-between" style="gap:var(--space-2);">
            <span class="row" style="gap:var(--space-2);min-width:0;"><strong>${escapeHtml(e.title)}</strong>${directBadge}</span>
            <span class="muted" style="font-size:var(--font-size-xs);flex-shrink:0;">${formatDateTime(e.createdAt)}</span>
          </div>
          <div class="muted" style="font-size:var(--font-size-sm);">${escapeHtml(e.body)}</div>
          ${view ? `<div><button type="button" class="btn btn-sm" data-navigate="${view}">${FEED_LINK_LABELS[view]} ${icon('chevronRight')}</button></div>` : ''}
        </div>`;
    })
    .join('');

  return `
    <div class="section-title">${icon('bell')} Mitteilungen</div>
    <div class="card stack" style="gap:var(--space-3);margin-bottom:var(--space-4);">${rows}</div>
  `;
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
    <div class="stack" style="gap:var(--space-2);margin-bottom:var(--space-4);">${groups}</div>
  `;
}

// Leaderboard snapshot (kiosk parity): the top three, one tap from the full
// standings.
function renderLeaderboardTop() {
  const standings = state.leaderboard?.standings || [];
  if (standings.length === 0) return '';
  const rows = standings
    .slice(0, 3)
    .map(
      (s, i) => `
      <div class="lb-row ${i === 0 ? 'rank-1' : ''}">
        <span class="lb-rank">${i + 1}</span>
        ${avatarHtml(s, 28)}
        <span style="flex:1;">${escapeHtml(s.name)}</span>
        <span class="lb-points">${s.points} P</span>
      </div>`
    )
    .join('');
  return `
    <div class="section-title">Rangliste</div>
    <div class="card" style="margin-bottom:var(--space-4);">
      ${rows}
      <button type="button" class="btn btn-sm btn-block" data-navigate="leaderboard" style="margin-top:var(--space-3);">Ganze Rangliste ${icon('chevronRight')}</button>
    </div>
  `;
}

export function renderHome(container, ctx) {
  const players = [...state.live].sort((a, b) => {
    const rankDiff = STATE_RANK[a.state] - STATE_RANK[b.state];
    if (rankDiff !== 0) return rankDiff;
    return a.name.localeCompare(b.name, 'de');
  });

  if (players.length === 0) {
    container.innerHTML = `
      <h1 class="view-title">Home</h1>
      <div class="empty-state">
        <img src="/img/mascot.svg" alt="" width="72" height="66" class="mascot" />
        Noch keine Spieler angelegt.<br />
        <button type="button" class="btn btn-primary btn-sm" data-navigate="profile" style="margin-top:var(--space-3);">${icon('user')} Eigenes Profil anlegen</button>
      </div>`;
    return;
  }

  const myId = getMyId();
  const whoAmI = whoAmICardHtml('home-whoami', { marginBottom: '16px' });

  if (myId && digestLoadedForId !== myId && !digestLoading) {
    loadDigest(ctx, myId);
  }
  if (myId && feedLoadedForId !== myId && !feedLoading) {
    loadFeed(ctx, myId);
  }
  if (statusCache === null && !statusLoading) {
    loadStatus(ctx);
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
            ${p.state === 'paused' ? `${icon('play')} Bin wieder da` : `${icon('pause')} Pause / Essen`}
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
    <h1 class="view-title">Home</h1>
    ${whoAmI}
    ${renderDigest(myId)}
    ${renderStatus()}
    ${renderFeed(myId)}
    ${renderActiveGroups(players)}
    <div class="section-title">Live-Status</div>
    <div class="card-grid">${cards}</div>
    ${renderLeaderboardTop()}
    ${renderHomeSeating(ctx)}
  `;

  wireWhoAmICard(container, 'home-whoami', ctx);

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
