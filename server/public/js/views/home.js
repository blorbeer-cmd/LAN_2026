// Home (formerly "Live-Status"): the landing view and the page everyone
// keeps coming back to during the party. Stacks, in order of urgency: what's
// currently running and needs you (open vote / active tournament / open food
// order / waiting arcade lobby / an unrated skill for a currently-live game —
// the kiosk content, but tappable and personalized), the realtime live board,
// a leaderboard snapshot and the seating plan. Notifications live only in
// the header bell (see notificationBanner.js), so Home does not duplicate
// the same content in a second style.

import { api } from '../api.js';
import { state } from '../state.js';
import { escapeHtml, stateLabel, avatarHtml, gameChipsHtml } from '../format.js';
import { getMyId, whoAmICardHtml, wireWhoAmICard } from '../whoami.js';
import { showToast } from '../toast.js';
import { icon } from '../icons.js';
import { renderSeatingPlan } from './seating.js';
import { ensureAktuellLoaded, aktuellItems } from '../aktuellStatus.js';

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
  return `<section class="card grouped-page-section live-seating stack" aria-labelledby="home-seating-title">
    <div class="grouped-page-section-title"><h2 id="home-seating-title">Sitzplan</h2></div>
    ${seatingLoading || seatingCache === null
      ? '<div class="empty-state" style="padding:var(--space-4);">Lädt…</div>'
      : renderSeatingPlan(seatingCache.layout, seatingCache.players)}
  </section>`;
}

// "Aktuell" and the missing-skills nudge now live in a shared module
// (aktuellStatus.js) so this view and the always-on header banner
// (notificationBanner.js) read from the same cache instead of each keeping
// their own. This view just re-renders whenever that shared data changes.
let lastCtx = null;

window.addEventListener('respawn:aktuell-changed', () => lastCtx?.rerender());

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
      <span class="muted">${icon('chevronRight')}</span>
    </button>`;
}

function renderStatus() {
  const rows = aktuellItems().map((item) =>
    statusRowHtml({
      iconName: item.iconName,
      title: escapeHtml(item.title),
      sub: item.sub ? escapeHtml(item.sub) : '',
      navigate: item.navigate,
    })
  );

  if (rows.length === 0) return '';
  return `
    <section class="card grouped-page-section stack" aria-labelledby="home-current-title">
      <div class="grouped-page-section-title"><h2 id="home-current-title">Aktuell</h2></div>
      <div class="card-grid">${rows.join('')}</div>
    </section>
  `;
}

// Groups currently-playing players by game (FR-27): a quick glance at what's
// running right now and how many/who — the player names sit in a tooltip so
// the chip row stays compact even with a long roster on one game.
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
    .map((g) => {
      const count = g.players.length;
      const namesList = g.players.slice().sort((a, b) => a.localeCompare(b, 'de')).join(', ');
      return `
      <div class="chip" title="${escapeHtml(namesList)}"><strong>${escapeHtml(g.name)}</strong> <span class="muted">· ${count} Spieler</span></div>`;
    })
    .join('');

  return `
    <div class="home-page-subsection stack">
      <h3>Gerade aktiv</h3>
      <div class="chip-list">${groups}</div>
    </div>
  `;
}

// Leaderboard snapshot: the top six use the otherwise empty card width as
// two compact columns on larger screens and stay a single list on phones.
function renderLeaderboardTop() {
  const standings = state.leaderboard?.standings || [];
  if (standings.length === 0) return '';
  const columns = [standings.slice(0, 3), standings.slice(3, 6)]
    .filter((column) => column.length > 0)
    .map(
      (column, columnIndex) => `<div class="home-leaderboard-column">${column
        .map((s, rowIndex) => {
          const rank = columnIndex * 3 + rowIndex + 1;
          return `
      <div class="lb-row ${rank === 1 ? 'rank-1' : ''}">
        <span class="lb-rank">${rank}</span>
        ${avatarHtml(s, 28)}
        <span class="player-name" style="flex:1;">${escapeHtml(s.name)}</span>
        <span class="lb-points">${s.points} P</span>
      </div>`;
        })
        .join('')}</div>`
    )
    .join('');
  return `
    <section class="card grouped-page-section stack" aria-labelledby="home-leaderboard-title">
      <div class="grouped-page-section-title"><h2 id="home-leaderboard-title">Rangliste</h2></div>
      <div class="home-leaderboard-columns">${columns}</div>
      <button type="button" class="btn btn-sm btn-block" data-navigate="leaderboard">Gesamte Rangliste ${icon('chevronRight')}</button>
    </section>
  `;
}

// "Dein Status": the pause/resume toggle lives here, not inside the player's
// own tile — putting it in the tile made that one card taller than its
// siblings, and since .card-grid stretches every card in a grid row to the
// tallest one, toggling pause visibly resized the whole row.
function renderMyStatus(myId, players) {
  const me = players.find((p) => p.player_id === myId);
  if (!me) return '';
  const badgeClass = `badge-${me.state}`;
  return `
    <div class="card row-between home-my-status">
      <span class="row" style="gap:var(--space-2);">
        <span>Dein Status:</span>
        <span class="badge ${badgeClass}">${stateLabel(me.state)}</span>
      </span>
      <button type="button" class="btn btn-sm" data-toggle-pause="${me.player_id}" data-paused="${me.state === 'paused' ? '1' : '0'}">
        ${me.state === 'paused' ? `${icon('play')} Bin wieder da` : `${icon('pause')} Pause / Essen`}
      </button>
    </div>
  `;
}

export function renderHome(container, ctx) {
  lastCtx = ctx;
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
        <button type="button" class="btn btn-primary btn-sm" data-navigate="profile" style="margin-top:var(--space-3);">Eigenes Profil anlegen</button>
      </div>`;
    return;
  }

  const myId = getMyId();
  const whoAmI = whoAmICardHtml('home-whoami', { marginBottom: 'var(--space-4)' });

  ensureAktuellLoaded();
  const cards = players
    .map((p) => {
      const badgeClass = `badge-${p.state}`;
      const games = gameChipsHtml(p.games, p.activity_tracked);
      const isMe = p.player_id === myId;

      // No note line here on purpose: the only note the UI ever sets is the
      // fixed "Pause / Essen" string (see renderMyStatus's toggle below),
      // which just restates the "Pause" badge already shown — rendering it
      // was the last source of a tile being taller than its siblings, which
      // visibly resized the whole .card-grid row (that stretches every card
      // in a row to the tallest one) the moment someone paused.
      return `
        <div class="card player-card">
          ${avatarHtml(p, 36)}
          <div class="player-card-main">
            <div class="row-between">
              <span class="player-name">${escapeHtml(p.name)}${isMe ? ' <span class="muted">(du)</span>' : ''}</span>
              <span class="badge ${badgeClass}">${stateLabel(p.state)}</span>
            </div>
            ${games ? `<div class="player-card-games chip-list">${games}</div>` : ''}
          </div>
        </div>`;
    })
    .join('');

  container.innerHTML = `
    <h1 class="view-title">Home</h1>
    ${whoAmI}
    <div class="grouped-page-sections">
      ${renderStatus()}
      <section class="card grouped-page-section stack" aria-labelledby="home-live-title">
        <div class="grouped-page-section-title"><h2 id="home-live-title">Live-Status</h2></div>
        ${renderActiveGroups(players)}
        ${renderMyStatus(myId, players)}
        <div class="two-column-card-grid home-live-grid">${cards}</div>
      </section>
      ${renderLeaderboardTop()}
      ${renderHomeSeating(ctx)}
    </div>
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
