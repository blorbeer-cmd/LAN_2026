// Home (formerly "Live-Status"): the landing view and the page everyone
// keeps coming back to during the party. Stacks, in order of urgency: what's
// currently running and needs you (open vote / active tournament / open food
// order / waiting arcade lobby / an unrated skill for a currently-live game —
// the kiosk content, but tappable and personalized), the realtime live board,
// a leaderboard snapshot, the seating plan, and — at the very bottom, as a
// history rather than something needing attention — the full notification
// log. The single most recent notification is additionally always visible
// in the app header (see notificationBanner.js), on every view, not just
// this one.

import { api } from '../api.js';
import { state } from '../state.js';
import { escapeHtml, formatDateTime, stateLabel, avatarHtml, gameBadgeHtml, gameChipsHtml } from '../format.js';
import { getMyId, whoAmICardHtml, wireWhoAmICard } from '../whoami.js';
import { showToast } from '../toast.js';
import { icon } from '../icons.js';
import { renderSeatingPlan } from './seating.js';
import { feedLinkView, FEED_LINK_LABELS } from '../pushFeed.js';

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

// "Missing skill rating" nudge (games currently live that this player
// hasn't rated their own skill for yet) — folded into "Aktuell" below as
// just another status card, rather than its own section. Used to also cover
// an open vote not yet cast and a ready tournament match, but both of those
// are already visible via the other "Aktuell" cards and the always-on
// header notification banner (see notificationBanner.js), so keeping a
// separate "Was steht an?" section around just duplicated them. Keyed by
// which player it was loaded for, so switching "who am I" on this device
// refetches instead of showing someone else's.
let missingSkillsCache = null;
let missingSkillsLoadedForId = null;
let missingSkillsLoading = false;

async function loadMissingSkills(ctx, myId) {
  missingSkillsLoading = true;
  try {
    const res = await api.digest.get(myId);
    missingSkillsCache = res.missingSkills;
    missingSkillsLoadedForId = myId;
  } catch {
    missingSkillsCache = null;
    missingSkillsLoadedForId = null;
  } finally {
    missingSkillsLoading = false;
    ctx.rerender();
  }
}

export function invalidateMissingSkills() {
  missingSkillsCache = null;
  missingSkillsLoadedForId = null;
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

// Compact single-line row (the "Mehr" hub's list-row component, see
// more.js) instead of a full card with its own button: the prominent header
// banner (notificationBanner.js) already covers the "look at me" job for
// the single latest thing, so these just need to be scannable at a glance,
// with the whole row (not a separate button) as the tap target.
function statusRowHtml({ iconName, title, sub, navigate }) {
  return `
    <button type="button" class="card row list-row" data-navigate="${navigate}">
      <span class="list-row-icon">${icon(iconName)}</span>
      <span style="flex:1;min-width:0;">
        <div class="player-name">${title}</div>
        ${sub ? `<div class="muted list-row-desc">${sub}</div>` : ''}
      </span>
      <span class="muted">›</span>
    </button>`;
}

function renderStatus() {
  const rows = [];

  // Personal nudge first — unlike the shared status rows below, nobody else
  // would otherwise learn you still owe a rating for a game everyone can
  // already see running on Home.
  for (const g of missingSkillsCache ?? []) {
    rows.push(
      statusRowHtml({
        iconName: 'star',
        title: `Skill für ${escapeHtml(g.name)} bewerten`,
        sub: 'Wird gerade gespielt',
        navigate: 'gameCatalog',
      })
    );
  }

  if (state.votes?.open) {
    const voters = state.votes.totalVoters ?? 0;
    rows.push(
      statusRowHtml({
        iconName: 'vote',
        title: state.votes.title ? escapeHtml(state.votes.title) : 'Abstimmung läuft',
        sub: `${voters} Teilnehmer bisher`,
        navigate: 'votes',
      })
    );
  }

  for (const t of (statusCache?.tournaments ?? []).filter((t) => t.status === 'active')) {
    rows.push(
      statusRowHtml({
        iconName: 'swords',
        title: escapeHtml(t.name),
        sub: `${escapeHtml(t.gameName)} · ${FORMAT_LABELS[t.format] ?? t.format}`,
        navigate: 'tournaments',
      })
    );
  }

  for (const o of (statusCache?.foodOrders ?? []).filter((o) => o.open)) {
    rows.push(
      statusRowHtml({
        iconName: 'hamburger',
        title: `Sammelbestellung „${escapeHtml(o.title)}"`,
        sub: o.sendAt ? `Geht raus um ${formatDateTime(o.sendAt)} Uhr` : 'Zeitpunkt noch offen',
        navigate: 'foodOrders',
      })
    );
  }

  for (const l of statusCache?.arcadeLobbies ?? []) {
    rows.push(
      statusRowHtml({
        iconName: 'joystick',
        title: `${escapeHtml(l.title)}-Lobby offen`,
        sub: `Von ${escapeHtml(l.hostName)} · ${l.playerCount} ${l.playerCount === 1 ? 'wartet' : 'warten'}`,
        navigate: 'arcade',
      })
    );
  }

  if (rows.length === 0) return '';
  return `
    <div class="section-title">Aktuell</div>
    <div class="card-grid" style="margin-bottom:var(--space-4);">${rows.join('')}</div>
  `;
}

// "Mitteilungen": history of recent push notifications that concerned this
// player (Durchsagen, neue Abstimmung, Turnier-Events, Bestellungen, ...),
// straight from the server's push log. The single most recent one is always
// visible up in the app header on every view (see notificationBanner.js);
// this is the full recent history, further down the page since (once read)
// it's a look-back, not something needing attention right now.
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

  if (myId && missingSkillsLoadedForId !== myId && !missingSkillsLoading) {
    loadMissingSkills(ctx, myId);
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
    ${renderStatus()}
    ${renderActiveGroups(players)}
    <div class="section-title">Live-Status</div>
    <div class="card-grid">${cards}</div>
    ${renderLeaderboardTop()}
    ${renderHomeSeating(ctx)}
    ${renderFeed(myId)}
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
