// Home (formerly "Live-Status"): the landing view and the page everyone
// keeps coming back to during the party. Stacks, in order of urgency: what's
// currently running (open vote / active tournament / open food order /
// waiting arcade lobby — the kiosk content, but tappable), what the signed-in
// account still has to do ("Meine To-Dos", see myTodos.js), the realtime live
// board, a leaderboard snapshot and the seating plan. Notifications live only in
// the header bell (see notificationBanner.js), so Home does not duplicate
// the same content in a second style.

import { rankedListHtml } from '../rankedList.js';
import { api } from '../api.js';
import { state } from '../state.js';
import { escapeHtml, formatDateTime, stateLabel, avatarHtml, gameChipsHtml } from '../format.js';
import { getMyId } from '../whoami.js';
import { showToast } from '../toast.js';
import { icon } from '../icons.js';
import { renderSeatingPlan } from './seating.js';
import { ensureAktuellLoaded, aktuellItems, missingSkillNudges } from '../aktuellStatus.js';
import { emptyStateHtml } from '../emptyState.js';
import { isAdmin } from '../admin.js';
import { eventHasFeature, viewIsEnabledForEvent } from '../eventFeatures.js';
import { eventTypeTitle } from '../eventTypes.js';
import { formatEuroCents } from '../paypal.js';
import { confirmDialog, openModal } from '../modal.js';
import { eventCalendarLinks } from '../calendarExport.js';
import { eventDateRange } from '../eventPresentation.js';
import { ensureTasksLoaded, freeTaskCount } from './checklist.js';
import {
  ensureMyTodosLoaded,
  invalidateMyTodos,
  myTodoRows,
  myTodos,
  MY_TODOS_VISIBLE_LIMIT,
  skillRow,
} from '../myTodos.js';
import {
  answerPendingInvitation,
  confirmEventCalendarEntry,
  downloadEventCalendar,
  handleEventPay,
} from './events.js';
import { markOwnFoodSharePaid, payOwnFoodShare, sendFoodOrder } from './foodOrders.js';
import { finishTournament } from './tournament.js';

const STATE_RANK = { playing: 0, online: 1, paused: 2, offline: 3 };

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
      if (homeIsOpen()) ctx.rerender();
    }
  }
}

const hasSeats = (layout) => layout.topSeats + layout.rightSeats + layout.bottomSeats + layout.leftSeats > 0;

function renderHomeSeating(ctx) {
  if ((seatingCache === null || seatingStale) && !seatingLoading && !seatingLoadError) loadSeating(ctx);
  return `<section class="card grouped-page-section live-seating stack" aria-labelledby="home-seating-title">
    <div class="grouped-page-section-title"><h2 id="home-seating-title">Sitzplan</h2></div>
    ${seatingCache === null
      ? emptyStateHtml(seatingLoadError ? 'Sitzplan konnte nicht geladen werden' : 'Lädt', { className: 'empty-state-compact' })
      : hasSeats(seatingCache.layout)
        ? renderSeatingPlan(seatingCache.layout, seatingCache.players)
        : emptyStateHtml('Noch keine Plätze')}
  </section>`;
}

// "Aktuell" and the missing-skills nudge now live in a shared module
// (aktuellStatus.js) so this view and the always-on header banner
// (notificationBanner.js) read from the same cache instead of each keeping
// their own. This view just re-renders whenever that shared data changes.
let lastCtx = null;

// ctx.rerender() redraws whichever view is open. Live-status broadcasts reload this shared data
// on every connect, disconnect and offline sweep, so only an open Home may be redrawn here;
// rebuilding another view would reset its transient state, such as a running Scribble room.
const homeIsOpen = () => document.getElementById('view-container')?.dataset.view === 'home';

window.addEventListener('respawn:aktuell-changed', () => {
  if (homeIsOpen()) lastCtx?.rerender();
});
window.addEventListener('respawn:my-todos-changed', () => {
  if (homeIsOpen()) lastCtx?.rerender();
});

// Compact single-line row using the shared list-row component from the
// "Mehr" hub (see more.js).
function statusRowHtml({ id, iconName, title, sub, navigate, target }) {
  const targetAttrs = target?.type && target?.id
    ? `data-navigate-target-type="${escapeHtml(target.type)}" data-navigate-target-id="${escapeHtml(target.id)}"`
    : '';
  return `
    <article class="list-row home-current-row" data-current-item="${id}">
      <button type="button" class="home-current-navigate" data-navigate="${navigate}" ${targetAttrs}>
        <span class="list-row-icon">${icon(iconName)}</span>
        <span class="home-current-copy">
          <span class="player-name">${title}</span>
          ${sub ? `<span class="muted list-row-desc">${sub}</span>` : ''}
        </span>
      </button>
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
    <section class="card grouped-page-section stack home-current home-current--compact" aria-labelledby="home-current-title">
      <div class="grouped-page-section-title"><h2 id="home-current-title">Aktuell</h2></div>
      <div class="home-current-items">${rows.join('')}</div>
    </section>
  `;
}

function eventPeriod(event) {
  const start = formatDateTime(event.startsAt);
  return event.endsAt == null ? `Ab ${start}` : `${start} – ${formatDateTime(event.endsAt)}`;
}

// A general event and a group both need the same orientation on Home — what
// this workspace is, where and who is in it. A group simply has no period and
// no contribution to show, so those two blocks fall away instead of printing
// an empty row.
function renderGeneralEventOverview() {
  const event = state.activeEvent;
  if (!event || (event.eventType !== 'general' && event.eventType !== 'group')) return '';
  const isGroup = event.eventType === 'group';
  const participantCount = Array.isArray(event.participantIds) ? event.participantIds.length : null;
  return `
    <section class="card grouped-page-section stack" aria-labelledby="home-event-overview-title" data-home-event-overview>
      <div class="grouped-page-section-title">
        <h2 id="home-event-overview-title">${isGroup ? 'Gruppenübersicht' : 'Eventübersicht'}</h2>
        <span class="badge">${escapeHtml(eventTypeTitle(event.eventType, state.eventTypeOptions))}</span>
      </div>
      <div class="card stack">
        <strong>${escapeHtml(event.name)}</strong>
        ${isGroup ? '' : `<div class="event-card-detail">
          <span class="event-card-detail-icon" aria-hidden="true">${icon('calendar')}</span>
          <span class="event-card-detail-content">
            <span class="event-card-detail-label">Zeitraum</span>
            <span>${escapeHtml(eventPeriod(event))}</span>
          </span>
        </div>`}
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
        ${participantCount === null ? '' : isGroup ? `<div class="event-card-detail home-group-overview-members">
          <span class="event-card-detail-content">
            <span class="event-card-detail-label">Mitglieder</span>
            <span>${participantCount === 1 ? '1 Mitglied' : `${participantCount} Mitglieder`}</span>
          </span>
          <button type="button" class="home-group-overview-open" data-navigate="events" aria-label="Mitglieder und Gruppeninfos öffnen">
            <span>Mitglieder und Gruppeninfos</span>
            ${icon('chevronRight')}
          </button>
        </div>` : `<div class="event-card-detail">
          <span class="event-card-detail-icon" aria-hidden="true">${icon('users')}</span>
          <span class="event-card-detail-content">
            <span class="event-card-detail-label">Teilnehmende</span>
            <span>${participantCount === 1 ? '1 teilnehmende Person' : `${participantCount} Teilnehmende`}</span>
          </span>
        </div>`}
        ${!isGroup && event.costCents ? `<div class="event-card-detail">
          <span class="event-card-detail-icon" aria-hidden="true">${icon('paypal')}</span>
          <span class="event-card-detail-content">
            <span class="event-card-detail-label">Beitrag pro Person</span>
            <span>${escapeHtml(formatEuroCents(event.costCents))}</span>
          </span>
        </div>` : ''}
      </div>
    </section>`;
}

function renderGroupMembers() {
  const memberIds = new Set(state.activeEvent?.participantIds ?? []);
  const members = state.players.filter((player) => memberIds.has(player.id));
  return `
    <section class="card grouped-page-section stack" aria-labelledby="home-group-members-title">
      <div class="grouped-page-section-title">
        <h2 id="home-group-members-title">Mitglieder</h2>
        <span class="badge">${members.length === 1 ? '1 Mitglied' : `${members.length} Mitglieder`}</span>
      </div>
      <div class="two-column-card-grid home-group-members">
        ${members.map((member) => {
          const isOwnProfile = member.id === getMyId();
          const action = isOwnProfile
            ? 'data-navigate="profile"'
            : `data-open-player-detail="${escapeHtml(member.id)}"`;
          const actionLabel = isOwnProfile ? 'Mein Profil öffnen' : 'Profil öffnen';
          return `
          <button type="button" class="card player-card home-group-member" ${action} aria-label="${escapeHtml(`${member.name}: ${actionLabel}`)}">
            ${avatarHtml(member, 36)}
            <span class="player-card-main">
              <span class="row-between">
                <span class="player-name">${escapeHtml(member.name)}</span>
                <span class="muted">${member.is_admin ? 'Gruppenverwaltung' : 'Mitglied'}</span>
              </span>
            </span>
          </button>`;
        }).join('')}
      </div>
    </section>`;
}

// "Meine To-Dos": everything the signed-in account still has to do, across
// every open event (see myTodos.js), in the compact divided rows of "Aktuell".
// A row itself navigates to where the To-Do lives — switching the workspace
// first when it belongs to another event — while its trailing actions settle
// it right here: pay, mark paid, add to the calendar, answer an invitation,
// finish a To-Do, or end what has been left open too long.
let showAllTodos = false;
let renderedTodoRows = new Map();

// Literal class lists keep both button variants visible to the component
// contract check (frontend-contracts), which cannot follow composed classes.
function todoActionButton(row, action, label, { primary = false, extra = '' } = {}) {
  const attrs = `data-todo-action="${action}" data-todo-id="${escapeHtml(row.id)}" ${extra}`;
  return primary
    ? `<button type="button" class="btn btn-primary btn-sm" ${attrs}>${label}</button>`
    : `<button type="button" class="btn btn-sm" ${attrs}>${label}</button>`;
}

function paidMarkerHtml(row) {
  const label = 'Als bezahlt markieren';
  return `<button type="button" class="payment-paid-marker" data-todo-action="paid" data-todo-id="${escapeHtml(row.id)}" aria-pressed="false" title="${label}" aria-label="${label}"><span class="payment-paid-box" aria-hidden="true"></span><span>Bezahlt</span></button>`;
}

function todoActionsHtml(row, todo) {
  if (!row.inline) return '';
  switch (row.kind) {
    case 'food-payment':
    case 'event-payment':
      return `${todo?.hasPaypal ? todoActionButton(row, 'pay', 'Bezahlen', { primary: true }) : ''}${paidMarkerHtml(row)}`;
    case 'event-calendar':
      return todoActionButton(row, 'calendar', 'Eintragen');
    case 'event-invitation':
      return `${todoActionButton(row, 'decline', 'Ablehnen', { extra: `data-decline-invitation="${escapeHtml(row.eventId)}"` })}${todoActionButton(row, 'accept', 'Annehmen', { primary: true, extra: `data-accept-invitation="${escapeHtml(row.eventId)}"` })}`;
    case 'task':
      return todoActionButton(row, 'done', 'Erledigt');
    case 'food-order-send':
      return todoActionButton(row, 'send-order', 'Abschicken');
    case 'event-end':
    case 'vote-close':
    case 'tournament-finish':
      return todoActionButton(row, 'end', 'Beenden');
    default:
      return '';
  }
}

function todoRowHtml(row, todo) {
  const navigation = row.switchesEvent && row.eventId
    ? `data-todo-event-navigate="${escapeHtml(row.id)}"`
    : `data-navigate="${escapeHtml(row.navigate.view)}"${row.navigate.target
      ? ` data-navigate-target-type="${escapeHtml(row.navigate.target.type)}" data-navigate-target-id="${escapeHtml(row.navigate.target.id)}"`
      : ''}`;
  const actions = todoActionsHtml(row, todo);
  return `
    <article class="list-row home-current-row home-todo-row" data-home-todo="${escapeHtml(row.id)}">
      <button type="button" class="home-current-navigate home-todo-navigate" ${navigation}>
        <span class="list-row-icon">${icon(row.iconName)}</span>
        <span class="home-current-copy">
          <span class="player-name">${escapeHtml(row.title)}</span>
          ${row.sub ? `<span class="muted list-row-desc">${escapeHtml(row.sub)}</span>` : ''}
        </span>
      </button>
      ${actions ? `<span class="home-todo-actions">${actions}</span>` : ''}
    </article>`;
}

// A row nudging toward the shared pool's still-open To-Dos of the active
// event while this account has taken none of them yet.
function freeTodosRow(count) {
  return {
    id: 'free-tasks',
    kind: 'free-tasks',
    eventId: null,
    switchesEvent: false,
    iconName: 'listChecks',
    title: count === 1 ? 'Ein offenes To-Do' : `${count} offene To-Dos`,
    sub: '',
    navigate: { view: 'checklist' },
    inline: false,
  };
}

// Only worth a tile when there is something to act on. Nothing is known yet
// while the list is still loading, so the tile stays out entirely rather than
// flashing a placeholder that may immediately disappear again.
function renderMyTodos() {
  const myId = getMyId();
  if (!myId) return '';
  const rows = myTodoRows({ skillNudges: missingSkillNudges().map(({ game, id }) => skillRow(game, id)) });
  if (rows === null) return '';
  const tasksEnabled = eventHasFeature(state.activeEvent, 'tasks');
  const freeCount = tasksEnabled ? freeTaskCount() : 0;
  const allRows = freeCount > 0 && !rows.some((row) => row.kind === 'task' && !row.switchesEvent)
    ? [...rows, freeTodosRow(freeCount)]
    : rows;
  if (allRows.length === 0) return '';

  const todosById = new Map((myTodos() ?? []).map((todo) => [todo.id, todo]));
  renderedTodoRows = new Map(allRows.map((row) => [row.id, { row, todo: todosById.get(row.id) }]));
  const collapsible = allRows.length > MY_TODOS_VISIBLE_LIMIT;
  const visibleRows = collapsible && !showAllTodos ? allRows.slice(0, MY_TODOS_VISIBLE_LIMIT) : allRows;
  return `
    <section class="card grouped-page-section stack home-current home-current--compact" aria-labelledby="home-todos-title" data-home-assigned-todos>
      <div class="grouped-page-section-title">
        <h2 id="home-todos-title" tabindex="-1">Meine To-Dos</h2>
        ${collapsible
          ? `<button type="button" class="btn btn-sm" data-todos-toggle aria-expanded="${showAllTodos}">${showAllTodos ? 'Weniger anzeigen' : `Alle anzeigen (${allRows.length})`}</button>`
          : ''}
      </div>
      <div class="home-current-items">${visibleRows.map((row) => todoRowHtml(row, todosById.get(row.id))).join('')}</div>
    </section>`;
}

function openCalendarDialog(todo, ctx) {
  const links = eventCalendarLinks({ ...todo, name: todo.eventName });
  if (!links) return;
  const event = { id: todo.eventId, name: todo.eventName, startsAt: todo.startsAt, endsAt: todo.endsAt, location: todo.location, description: todo.description };
  const { el, close } = openModal(
    'In den Kalender eintragen',
    `<div class="stack">
       <p><strong>${escapeHtml(todo.eventName)}</strong><br><span class="muted">${escapeHtml(eventDateRange(todo))}</span></p>
       <div class="event-calendar-action-buttons" role="group" aria-label="Kalender wählen">
         <a class="btn btn-sm" href="${escapeHtml(links.google)}" target="_blank" rel="noopener noreferrer">Google Kalender</a>
         <a class="btn btn-sm" href="${escapeHtml(links.outlook)}" target="_blank" rel="noopener noreferrer">Outlook</a>
         <button type="button" class="btn btn-sm" data-todo-calendar-file>Kalenderdatei</button>
       </div>
       <div class="row" style="justify-content:flex-end;">
         <button type="button" class="btn btn-primary btn-sm" data-todo-calendar-confirm>Eingetragen</button>
       </div>
     </div>`,
  );
  el.querySelector('[data-todo-calendar-file]').addEventListener('click', () => downloadEventCalendar(event));
  el.querySelector('[data-todo-calendar-confirm]').addEventListener('click', async (clickEvent) => {
    const confirmed = await confirmEventCalendarEntry(todo.eventId, {
      needsExtraCheck: Boolean(todo.needsExtraCheck),
      button: clickEvent.currentTarget,
      ctx,
    });
    if (!confirmed) return;
    close();
    invalidateMyTodos();
  });
}

const END_CONFIRMATIONS = {
  'event-end': (todo) => ({
    question: `Event „${todo.eventName}“ beenden? Das Event wird in die Historie verschoben, laufendes Tracking endet.`,
    run: () => api.events.end(todo.eventId),
    done: 'Event beendet.',
  }),
  'vote-close': (todo) => ({
    question: `Abstimmung „${todo.title || 'ohne Titel'}“ beenden? Das aktuelle Ergebnis wird festgehalten.`,
    run: () => api.votes.close(todo.round),
    done: 'Abstimmung beendet.',
  }),
};

async function runTodoAction(button, ctx) {
  const entry = renderedTodoRows.get(button.dataset.todoId);
  if (!entry) return;
  const { row, todo } = entry;
  const action = button.dataset.todoAction;
  const settle = async (work) => {
    button.disabled = true;
    try {
      const result = await work();
      if (result !== false) invalidateMyTodos();
    } finally {
      if (button.isConnected) button.disabled = false;
    }
  };

  if (action === 'pay' && row.kind === 'event-payment') return settle(() => handleEventPay(row.eventId, ctx));
  // Opens PayPal synchronously inside this click (popup blockers), then
  // re-reads the order before handing over the amount.
  if (action === 'pay' && row.kind === 'food-payment') {
    return settle(() => payOwnFoodShare({ id: todo.orderId, paypalLink: todo.paypalLink, items: todo.items }, ctx));
  }
  if (action === 'paid' && row.kind === 'food-payment') return settle(() => markOwnFoodSharePaid(todo.orderId, ctx));
  if (action === 'paid' && row.kind === 'event-payment') {
    return settle(async () => {
      try {
        await api.events.setParticipantPaid(row.eventId, getMyId(), true);
        await ctx.refresh();
        showToast('Event-Beitrag als bezahlt markiert.');
        return true;
      } catch (err) {
        showToast(err.message, { error: true });
        return false;
      }
    });
  }
  if (action === 'calendar') return openCalendarDialog(todo, ctx);
  if (action === 'accept' || action === 'decline') return settle(() => answerPendingInvitation(button, ctx));
  if (action === 'done') {
    return settle(async () => {
      try {
        await api.checklist.setDone(todo.taskId, getMyId());
        showToast('To-Do erledigt.');
        return true;
      } catch (err) {
        showToast(err.message, { error: true });
        return false;
      }
    });
  }
  if (action === 'send-order') return settle(() => sendFoodOrder(todo.orderId));
  if (action === 'end' && row.kind === 'tournament-finish') {
    return settle(() => finishTournament({ id: todo.tournamentId, name: todo.name }));
  }
  if (action === 'end') {
    const plan = END_CONFIRMATIONS[row.kind]?.(todo);
    if (!plan || !(await confirmDialog(plan.question, { confirmText: 'Beenden', danger: true }))) return;
    return settle(async () => {
      try {
        await plan.run();
        await ctx.refresh();
        showToast(plan.done);
        return true;
      } catch (err) {
        showToast(err.message, { error: true });
        return false;
      }
    });
  }
}

function wireMyTodos(container, ctx) {
  container.querySelector('[data-todos-toggle]')?.addEventListener('click', () => {
    showAllTodos = !showAllTodos;
    ctx.rerender();
    document.querySelector('[data-todos-toggle]')?.focus();
  });
  container.querySelectorAll('[data-todo-event-navigate]').forEach((button) => {
    button.addEventListener('click', () => {
      const entry = renderedTodoRows.get(button.dataset.todoEventNavigate);
      if (!entry) return;
      window.dispatchEvent(new CustomEvent('respawn:event-navigate', {
        detail: { eventId: entry.row.eventId, view: entry.row.navigate.view, target: entry.row.navigate.target ?? null },
      }));
    });
  });
  container.querySelectorAll('[data-todo-action]').forEach((button) => {
    button.addEventListener('click', () => {
      void runTodoAction(button, ctx);
    });
  });
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

// Leaderboard snapshot: the top six as a RankedList, read top to bottom.
function renderLeaderboardTop() {
  // The Auswertung area (leaderboard/analytics/hallOfFame) is only reachable
  // with the device-local Admin mode active (see app.js's switchView()) — a
  // preview here would otherwise offer a "Gesamte Rangliste" link that
  // silently redirects a regular member to Essen instead.
  if (!isAdmin()) return '';
  const standings = state.leaderboard?.standings || [];
  if (standings.length === 0) return '';
  const items = standings.slice(0, 6).map((s) => ({
    lead: avatarHtml(s, 28),
    title: escapeHtml(s.name),
    value: `${s.points} P`,
  }));
  return `
    <section class="card grouped-page-section stack" aria-labelledby="home-leaderboard-title">
      <div class="grouped-page-section-title">
        <h2 id="home-leaderboard-title">Rangliste</h2>
        <button type="button" class="btn btn-sm" data-navigate="leaderboard">Alle ansehen</button>
      </div>
      ${rankedListHtml(items, { ranked: true, label: 'Rangliste' })}
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
  ensureAktuellLoaded();
  ensureMyTodosLoaded();

  if (players.length === 0 && trackingEnabled) {
    container.innerHTML = `
      <h1 class="view-title">Home</h1>
      <div class="grouped-page-sections home-desktop-layout">
        ${renderStatus()}
        ${renderMyTodos()}
        ${emptyStateHtml({
          text: 'Noch keine Spieler.',
          illustration: { src: '/img/mascot.svg', alt: '', width: 72, height: 66, className: 'mascot' },
          action: { label: 'Eigenes Profil anlegen', navigate: 'profile' },
        })}
      </div>`;
    wireMyTodos(container, ctx);
    return;
  }

  const myId = getMyId();
  const isEventlessGroup = state.activeEvent?.eventType === 'group';
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
      ${renderGeneralEventOverview()}
      ${isEventlessGroup ? `${renderMyTodos()}${renderGroupMembers()}` : `${renderStatus()}${renderMyTodos()}`}
      ${
        trackingEnabled
          ? `<section class="card grouped-page-section stack" aria-labelledby="home-live-title">
               <div class="grouped-page-section-title"><h2 id="home-live-title">Live-Status</h2></div>
               ${renderActiveGroups(players)}
               ${renderMyStatus(myId, players)}
               <div class="two-column-card-grid home-live-grid" style="--home-live-rows-2:${Math.ceil(players.length / 2)};--home-live-rows-3:${Math.ceil(players.length / 3)}">${cards}</div>
             </section>`
          : ''
      }
      ${seatingEnabled ? renderHomeSeating(ctx) : ''}
      ${trackingEnabled ? renderLeaderboardTop() : ''}
    </div>
  `;

  wireMyTodos(container, ctx);

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

}
