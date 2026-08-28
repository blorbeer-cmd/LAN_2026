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
import { escapeHtml, formatDateTime, stateLabel, avatarHtml, gameChipsHtml } from '../format.js';
import { getMyId } from '../whoami.js';
import { showToast } from '../toast.js';
import { icon } from '../icons.js';
import { renderSeatingPlan } from './seating.js';
import { ensureAktuellLoaded, aktuellItems, dismissAktuellItem } from '../aktuellStatus.js';
import { emptyStateHtml } from '../emptyState.js';
import { isAdmin } from '../admin.js';
import { eventHasFeature, viewIsEnabledForEvent } from '../eventFeatures.js';
import { eventTypeTitle } from '../eventTypes.js';
import { domainIcon } from '../domainIcons.js';
import { formatEuroCents } from '../paypal.js';
import { dueBadgeInfo } from '../checklistDue.js';
import { assignedTasks, ensureTasksLoaded, openTaskCount } from './checklist.js';

const STATE_RANK = { playing: 0, online: 1, paused: 2, offline: 3 };

const GENERAL_EVENT_LINKS = Object.freeze([
  Object.freeze({ view: 'events', title: 'Eventdetails & Kosten', description: 'Zeitraum, Ort, Teilnehmende und Beiträge' }),
  Object.freeze({ view: 'checklist', title: 'To-Dos', description: 'Aufgaben und Mitbring-Anfragen' }),
  Object.freeze({ view: 'arrivals', title: 'An- & Abreise', description: 'Zeiten und Fahrgemeinschaften' }),
  Object.freeze({ view: 'foodOrders', title: 'Essen', description: 'Gemeinsame Bestellungen' }),
  Object.freeze({ view: 'music', title: 'Jam', description: 'Musik und gemeinsame Warteschlange' }),
]);

let seatingCache = null;
let seatingLoading = false;
let seatingStale = false;
let seatingRequestVersion = 0;
let seatingLoadError = false;

window.addEventListener('seating:changed', () => {
  invalidateHomeSeating();
});

// A player's name/real name/avatar can change (players:changed) without the
// seating layout itself changing — the cached board would otherwise keep
// showing the old real name for the rest of the session on any device that
// already loaded it (CLAUDE.md: realtime by default, no manual reload).
export function invalidateHomeSeating({ hard = false } = {}) {
  seatingRequestVersion += 1;
  seatingLoading = false;
  seatingStale = true;
  seatingLoadError = false;
  if (hard) seatingCache = null;
}

async function loadSeating(ctx) {
  const version = ++seatingRequestVersion;
  seatingLoading = true;
  seatingStale = false;
  seatingLoadError = false;
  try {
    const result = await api.seating.layout();
    if (version === seatingRequestVersion) seatingCache = result;
  } catch {
    if (version === seatingRequestVersion) seatingLoadError = seatingCache === null;
  } finally {
    if (version === seatingRequestVersion) {
      seatingLoading = false;
      ctx.rerender();
    }
  }
}

function renderHomeSeating(ctx) {
  if ((seatingCache === null || seatingStale) && !seatingLoading && !seatingLoadError) loadSeating(ctx);
  return `<section class="card grouped-page-section live-seating stack" aria-labelledby="home-seating-title">
    <div class="grouped-page-section-title"><h2 id="home-seating-title">Sitzplan</h2></div>
    ${seatingCache === null
      ? emptyStateHtml(seatingLoadError ? 'Sitzplan konnte nicht geladen werden.' : 'Lädt…', { style: 'padding:var(--space-4);' })
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
// more.js). Navigation and dismissal are sibling buttons so both remain
// semantic, keyboard-operable controls without nesting one button in another.
function statusRowHtml({ id, iconName, title, sub, navigate, target }) {
  const targetAttrs = target?.type && target?.id
    ? `data-navigate-target-type="${escapeHtml(target.type)}" data-navigate-target-id="${escapeHtml(target.id)}"`
    : '';
  return `
    <article class="card list-row home-current-row" data-current-item="${id}">
      <button type="button" class="home-current-navigate" data-navigate="${navigate}" ${targetAttrs}>
        <span class="list-row-icon">${icon(iconName)}</span>
        <span class="home-current-copy">
          <span class="player-name">${title}</span>
          ${sub ? `<span class="muted list-row-desc">${sub}</span>` : ''}
        </span>
        <span class="muted">${icon('chevronRight')}</span>
      </button>
      <button type="button" class="icon-btn home-current-dismiss" data-dismiss-current="${id}" aria-label="${title} ausblenden" title="Meldung ausblenden">${icon('x')}</button>
    </article>`;
}

function renderStatus() {
  const rows = aktuellItems()
    .filter((item) => viewIsEnabledForEvent(item.navigate, state.activeEvent))
    .map((item) =>
    statusRowHtml({
      id: escapeHtml(item.id),
      iconName: item.iconName,
      title: escapeHtml(item.title),
      sub: item.sub ? escapeHtml(item.sub) : '',
      navigate: item.navigate,
      target: item.target,
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

function eventPeriod(event) {
  const start = formatDateTime(event.startsAt);
  return event.endsAt == null ? `Ab ${start}` : `${start} – ${formatDateTime(event.endsAt)}`;
}

function generalEventLinkHtml(item) {
  const taskCount = item.view === 'checklist' ? openTaskCount() : 0;
  const description = taskCount > 0
    ? `${taskCount} ${taskCount === 1 ? 'To-Do ist' : 'To-Dos sind'} dir zugewiesen`
    : item.description;
  return `
    <button type="button" class="card row list-row" data-navigate="${item.view}">
      <span class="list-row-icon">${icon(domainIcon(item.view))}</span>
      <span class="home-current-copy">
        <span class="player-name">${escapeHtml(item.title)}</span>
        <span class="muted list-row-desc">${escapeHtml(description)}</span>
      </span>
      <span class="muted">${icon('chevronRight')}</span>
    </button>`;
}

function renderGeneralEventOverview() {
  const event = state.activeEvent;
  if (!event || event.eventType !== 'general') return '';
  const participantCount = Array.isArray(event.participantIds) ? event.participantIds.length : null;
  return `
    <section class="card grouped-page-section stack" aria-labelledby="home-event-overview-title" data-home-event-overview>
      <div class="grouped-page-section-title">
        <h2 id="home-event-overview-title">Eventübersicht</h2>
        <span class="badge">${escapeHtml(eventTypeTitle(event.eventType, state.eventTypeOptions))}</span>
      </div>
      <div class="card stack">
        <strong>${escapeHtml(event.name)}</strong>
        <div class="event-card-detail">
          <span class="event-card-detail-icon" aria-hidden="true">${icon('calendar')}</span>
          <span class="event-card-detail-content">
            <span class="event-card-detail-label">Zeitraum</span>
            <span>${escapeHtml(eventPeriod(event))}</span>
          </span>
        </div>
        ${event.location ? `<div class="event-card-detail">
          <span class="event-card-detail-icon" aria-hidden="true">${icon('mapPin')}</span>
          <span class="event-card-detail-content">
            <span class="event-card-detail-label">Ort</span>
            <span>${escapeHtml(event.location)}</span>
          </span>
        </div>` : ''}
        ${event.description ? `<div class="event-card-detail">
          <span class="event-card-detail-icon" aria-hidden="true">${icon('file')}</span>
          <span class="event-card-detail-content">
            <span class="event-card-detail-label">Hinweis</span>
            <span>${escapeHtml(event.description)}</span>
          </span>
        </div>` : ''}
        ${participantCount === null ? '' : `<div class="event-card-detail">
          <span class="event-card-detail-icon" aria-hidden="true">${icon('users')}</span>
          <span class="event-card-detail-content">
            <span class="event-card-detail-label">Teilnehmende</span>
            <span>${participantCount === 1 ? '1 teilnehmende Person' : `${participantCount} Teilnehmende`}</span>
          </span>
        </div>`}
        ${event.costCents ? `<div class="event-card-detail">
          <span class="event-card-detail-icon" aria-hidden="true">${icon('paypal')}</span>
          <span class="event-card-detail-content">
            <span class="event-card-detail-label">Beitrag pro Person</span>
            <span>${escapeHtml(formatEuroCents(event.costCents))}</span>
          </span>
        </div>` : ''}
      </div>
    </section>`;
}

function renderGeneralEventOrganisation() {
  const event = state.activeEvent;
  if (!event || event.eventType !== 'general') return '';
  const links = GENERAL_EVENT_LINKS
    .filter((item) => viewIsEnabledForEvent(item.view, event))
    .map(generalEventLinkHtml)
    .join('');
  return `
    <section class="card grouped-page-section stack" aria-labelledby="home-organisation-title">
      <div class="grouped-page-section-title"><h2 id="home-organisation-title">Organisation</h2></div>
      <div class="card-grid">${links}</div>
    </section>`;
}

function homeTaskHtml(task) {
  const due = dueBadgeInfo(task.dueAt);
  return `
    <button type="button" class="card row list-row" data-navigate="checklist" data-home-assigned-task="${escapeHtml(task.id)}">
      <span class="list-row-icon">${icon('check')}</span>
      <span class="home-current-copy">
        <span class="player-name">${escapeHtml(task.title)}</span>
        <span class="muted list-row-desc">${task.type === 'item_request' ? 'Mitbring-Anfrage' : 'Aufgabe'}</span>
      </span>
      ${due ? `<span class="badge ${due.cls}">${escapeHtml(due.text)}</span>` : `<span class="muted">${icon('chevronRight')}</span>`}
    </button>`;
}

function renderAssignedTodos() {
  if (!eventHasFeature(state.activeEvent, 'tasks')) return '';
  const tasks = assignedTasks();
  const myId = getMyId();
  let content;
  if (tasks === null) content = emptyStateHtml('Lädt…');
  else if (!myId) content = '<p class="muted">Wähle oben, wer du bist, um deine To-Dos zu sehen.</p>';
  else if (tasks.length === 0) content = '<p class="muted">Noch keine To-Dos für dich.</p>';
  else {
    const visibleTasks = tasks.slice(0, 3);
    const remaining = tasks.length - visibleTasks.length;
    content = `
      <div class="card-grid">${visibleTasks.map(homeTaskHtml).join('')}</div>
      ${remaining > 0 ? `<p class="muted">${remaining === 1 ? 'Ein weiteres To-Do' : `${remaining} weitere To-Dos`} findest du in der vollständigen Liste.</p>` : ''}`;
  }
  return `
    <section class="card grouped-page-section stack" aria-labelledby="home-todos-title" data-home-assigned-todos>
      <div class="grouped-page-section-title">
        <h2 id="home-todos-title">Meine To-Dos</h2>
        <button type="button" class="btn btn-sm" data-navigate="checklist">Alle To-Dos</button>
      </div>
      ${content}
    </section>`;
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

// Leaderboard snapshot: the top six become a compact three-column overview
// on wide desktops and stay a linear ranking on smaller screens.
function renderLeaderboardTop() {
  // The Auswertung area (leaderboard/analytics/hallOfFame) is only reachable
  // with the device-local Admin mode active (see app.js's switchView()) — a
  // preview here would otherwise offer a "Gesamte Rangliste" link that
  // silently redirects a regular member to Essen instead.
  if (!isAdmin()) return '';
  const standings = state.leaderboard?.standings || [];
  if (standings.length === 0) return '';
  const rows = standings.slice(0, 6)
    .map((s, index) => {
      const rank = index + 1;
      return `
      <div class="lb-row ${rank === 1 ? 'rank-1' : ''}">
        <span class="lb-rank">${rank}</span>
        ${avatarHtml(s, 28)}
        <span class="player-name" style="flex:1;">${escapeHtml(s.name)}</span>
        <span class="lb-points">${s.points} P</span>
      </div>`;
    })
    .join('');
  return `
    <section class="card grouped-page-section stack" aria-labelledby="home-leaderboard-title">
      <div class="grouped-page-section-title"><h2 id="home-leaderboard-title">Rangliste</h2></div>
      <div class="leaderboard-list-grid home-leaderboard-grid">${rows}</div>
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
      <button type="button" class="btn btn-primary btn-sm" data-toggle-pause="${me.player_id}" data-paused="${me.state === 'paused' ? '1' : '0'}">
        ${me.state === 'paused' ? 'Bin wieder da' : 'Pause'}
      </button>
    </div>
  `;
}

export function renderHome(container, ctx) {
  lastCtx = ctx;
  const trackingEnabled = eventHasFeature(state.activeEvent, 'tracking');
  const seatingEnabled = eventHasFeature(state.activeEvent, 'seating');
  const players = [...state.live].sort((a, b) => {
    const rankDiff = STATE_RANK[a.state] - STATE_RANK[b.state];
    if (rankDiff !== 0) return rankDiff;
    return a.name.localeCompare(b.name, 'de');
  });

  if (eventHasFeature(state.activeEvent, 'tasks')) ensureTasksLoaded(ctx);

  if (players.length === 0 && trackingEnabled) {
    container.innerHTML = `
      <h1 class="view-title">Home</h1>
      <div class="grouped-page-sections home-desktop-layout">
        <div class="home-priority-grid">${renderAssignedTodos()}</div>
        ${emptyStateHtml({
          title: 'Noch keine Spieler angelegt',
          illustration: { src: '/img/mascot.svg', alt: '', width: 72, height: 66, className: 'mascot' },
          action: { label: 'Eigenes Profil anlegen', navigate: 'profile' },
        })}
      </div>`;
    return;
  }

  const myId = getMyId();
  ensureAktuellLoaded();
  const cards = players
    .map((p) => {
      const badgeClass = `badge-${p.state}`;
      const games = gameChipsHtml(p.games, p.activity_tracked);
      const isMe = p.player_id === myId;

      // No note line here on purpose: the only note the UI ever sets is the
      // fixed "Pause" string (see renderMyStatus's toggle below),
      // which just restates the "Pause" badge already shown — rendering it
      // was the last source of a tile being taller than its siblings, which
      // visibly resized the whole .card-grid row (that stretches every card
      // in a row to the tallest one) the moment someone paused.
      //
      // The card is the roster: tapping it opens that participant's read-only
      // profile (or "Mein Profil" for the own row). The separate "Spieler"
      // area that used to hold the same list is gone — the live board already
      // shows everyone, so a second identical list was pure detour.
      const action = isMe
        ? 'data-navigate="profile"'
        : `data-open-player-detail="${p.player_id}"`;
      // A button's descendants are presentational to assistive technology, so
      // the live state and the running games would silently disappear from the
      // card the moment it became tappable. They are the card's whole point —
      // spell them into its accessible name instead. Children are <span>s for
      // the same reason a button may not wrap flow content; the layout classes
      // supply their own display.
      const runningGames = p.games.map((g) => g.game_name).join(', ');
      const label = `${p.name}${isMe ? ' (du)' : ''}, ${stateLabel(p.state)}${runningGames ? `, ${runningGames}` : ''}. ${
        isMe ? 'Mein Profil öffnen' : 'Profil ansehen'
      }`;
      return `
        <button type="button" class="card player-card" data-player="${p.player_id}" ${action}
          aria-label="${escapeHtml(label)}">
          ${avatarHtml(p, 36)}
          <span class="player-card-main">
            <span class="row-between">
              <span class="player-name">${escapeHtml(p.name)}${isMe ? ' <span class="muted">(du)</span>' : ''}</span>
              <span class="badge ${badgeClass}">${stateLabel(p.state)}</span>
            </span>
            ${games ? `<span class="player-card-games chip-list">${games}</span>` : ''}
          </span>
        </button>`;
    })
    .join('');

  container.innerHTML = `
    <h1 class="view-title">Home</h1>
    <div class="grouped-page-sections home-desktop-layout">
      <div class="home-priority-grid">
        ${renderAssignedTodos()}
        ${renderStatus()}
      </div>
      ${renderGeneralEventOverview()}
      ${renderGeneralEventOrganisation()}
      ${
        trackingEnabled
          ? `<section class="card grouped-page-section stack" aria-labelledby="home-live-title">
               <div class="grouped-page-section-title"><h2 id="home-live-title">Live-Status</h2></div>
               ${renderActiveGroups(players)}
               ${renderMyStatus(myId, players)}
               <div class="two-column-card-grid home-live-grid">${cards}</div>
             </section>`
          : ''
      }
      ${seatingEnabled ? renderHomeSeating(ctx) : ''}
      ${trackingEnabled ? renderLeaderboardTop() : ''}
    </div>
  `;

  container.querySelectorAll('[data-toggle-pause]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const isPaused = btn.dataset.paused === '1';
      try {
        await api.live.setNote(btn.dataset.togglePause, isPaused ? null : 'Pause');
        await ctx.refresh();
      } catch (err) {
        showToast(err.message, { error: true });
      }
    });
  });

  container.querySelectorAll('[data-dismiss-current]').forEach((btn) => {
    btn.addEventListener('click', () => {
      if (!dismissAktuellItem(btn.dataset.dismissCurrent)) return;
      showToast('Meldung ausgeblendet.');
      ctx.rerender();
    });
  });
}
