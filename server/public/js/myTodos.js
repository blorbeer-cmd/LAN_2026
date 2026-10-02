// Shared data for Home's "Meine To-Dos": the server's personal and orga
// To-Dos across every open event (GET /api/me/todos, see myTodos.ts) plus
// the two personal nudges the client already holds — pending event
// invitations (state.eventInvitations) and unrated skills for a game that is
// being played right now (aktuellStatus.js). Returns plain row models via
// myTodoRows(); home.js turns them into markup and wires the actions.

import { api } from './api.js';
import { state } from './state.js';
import { formatDate, formatDateTime } from './format.js';
import { formatEuroCents } from './paypal.js';
import { dueText } from './checklistDue.js';
import { domainIcon } from './domainIcons.js';
import { eventDateRange } from './eventPresentation.js';

// Left-behind workflows turn stale purely by time passing, with no realtime
// signal. A visible Home refetches once its copy is older than this.
export const MY_TODOS_MAX_AGE_MS = 60 * 1000;
export const MY_TODOS_VISIBLE_LIMIT = 5;

let cache = null; // { todos, pendingVoteRounds }
let loadedAt = 0;
let stale = false;
let request = null;
let generation = 0;

const homeIsOpen = () => document.getElementById('view-container')?.dataset.view === 'home';

function notifyChanged() {
  window.dispatchEvent(new CustomEvent('respawn:my-todos-changed'));
}

function load() {
  if (request) return request;
  const requestGeneration = generation;
  const run = (async () => {
    try {
      const result = await api.myTodos.get();
      if (requestGeneration !== generation) return;
      cache = { todos: result.todos ?? [], pendingVoteRounds: result.pendingVoteRounds ?? [] };
      loadedAt = Date.now();
      stale = false;
    } catch {
      // Keep the last known list; the next render or signal retries. A first
      // failure leaves the tile hidden instead of showing a broken state.
    } finally {
      if (request === run) request = null;
      if (requestGeneration === generation) notifyChanged();
      else if (homeIsOpen()) void load();
    }
  })();
  request = run;
  return run;
}

// Safe to call from every Home render: a no-op while fresh or in flight.
export function ensureMyTodosLoaded(now = Date.now()) {
  if (request) return;
  if (cache === null || stale || now - loadedAt >= MY_TODOS_MAX_AGE_MS) void load();
}

// Called for every realtime signal that can add or settle a To-Do (see the
// home lifecycle in viewLifecycle.js) and after Home's own actions. An open
// Home refetches right away; otherwise the next render does.
export function invalidateMyTodos({ hard = false } = {}) {
  generation += 1;
  request = null;
  stale = true;
  if (hard) cache = null;
  if (homeIsOpen()) void load();
}

// Open Vote rounds of the active workspace without this account's ballot.
export function pendingVoteRounds() {
  return cache?.pendingVoteRounds ?? [];
}

// `null` while nothing is loaded yet, so Home can stay quiet instead of
// flashing an empty tile.
export function myTodos() {
  return cache?.todos ?? null;
}

const quote = (text) => `„${text}“`;

function plural(count, one, many) {
  return count === 1 ? `1 ${one}` : `${count} ${many}`;
}

// The event a row belongs to, named only where it is not the workspace the
// reader is in anyway.
function withEvent(sub, todo, activeEventId) {
  if (!todo.eventId || todo.eventId === activeEventId) return sub;
  return [sub, todo.eventName].filter(Boolean).join(' · ');
}

function overdue(sub, todo) {
  return todo.overdue ? ['Überfällig', sub].filter(Boolean).join(' · ') : sub;
}

// Row model for one server To-Do. `inline` says whether the row's own actions
// can run from here: event-level actions work from any workspace, workspace
// data (orders, To-Dos, Votes, tournaments) only inside its own event, so a
// row of another event leads there first instead.
export function myTodoRow(todo, { activeEventId = state.activeEvent?.id ?? null, now = Date.now() } = {}) {
  const inWorkspace = todo.eventId === activeEventId;
  const base = {
    id: todo.id,
    kind: todo.kind,
    audience: todo.audience,
    eventId: todo.eventId,
    switchesEvent: !inWorkspace,
  };
  switch (todo.kind) {
    case 'food-payment':
      return {
        ...base,
        iconName: domainIcon('foodOrders'),
        title: `${quote(todo.orderTitle)} bezahlen`,
        sub: withEvent(`${plural(todo.unpaidCount, 'Position', 'Positionen')} offen`, todo, activeEventId),
        navigate: { view: 'foodOrders', target: { type: 'order', id: todo.orderId } },
        inline: inWorkspace,
      };
    case 'event-payment':
      return {
        ...base,
        switchesEvent: false,
        iconName: domainIcon('events'),
        title: `Beitrag für ${quote(todo.eventName)} bezahlen`,
        sub: overdue(
          [formatEuroCents(todo.costCents), todo.paymentDueAt ? `bis ${formatDate(todo.paymentDueAt)}` : '']
            .filter(Boolean)
            .join(' · '),
          todo,
        ),
        navigate: { view: 'events', target: { type: 'event', id: todo.eventId } },
        inline: true,
      };
    case 'event-calendar':
      return {
        ...base,
        switchesEvent: false,
        iconName: 'calendar',
        title: `${quote(todo.eventName)} in den Kalender eintragen`,
        sub: eventDateRange(todo),
        navigate: { view: 'events', target: { type: 'event', id: todo.eventId } },
        inline: true,
      };
    case 'arrival':
      return {
        ...base,
        iconName: domainIcon('arrivals'),
        title: `An- und Abreise für ${quote(todo.eventName)} eintragen`,
        sub: `Beginn ${formatDateTime(todo.startsAt)}`,
        navigate: { view: 'arrivals' },
        inline: false,
      };
    case 'task':
      return {
        ...base,
        iconName: 'listChecks',
        title: todo.title,
        sub: withEvent(dueText(todo.dueAt, now), todo, activeEventId),
        navigate: { view: 'checklist' },
        inline: inWorkspace,
      };
    case 'task-unclaimed':
      return {
        ...base,
        iconName: 'listChecks',
        title: `Niemand hat ${quote(todo.title)} übernommen`,
        sub: withEvent(dueText(todo.dueAt, now), todo, activeEventId),
        navigate: { view: 'checklist' },
        inline: false,
      };
    case 'event-end':
      return {
        ...base,
        switchesEvent: false,
        iconName: domainIcon('events'),
        title: `${quote(todo.eventName)} beenden`,
        sub: `Zeitraum endete ${formatDateTime(todo.endsAt)}`,
        navigate: { view: 'events', target: { type: 'event', id: todo.eventId } },
        inline: true,
      };
    case 'event-contributions':
      return {
        ...base,
        switchesEvent: false,
        iconName: domainIcon('events'),
        title: `Beiträge für ${quote(todo.eventName)} prüfen`,
        sub: `${plural(todo.unpaidCount, 'Beitrag', 'Beiträge')} offen seit ${formatDate(todo.paymentDueAt)}`,
        navigate: { view: 'events', target: { type: 'event', id: todo.eventId } },
        inline: false,
      };
    case 'food-order-send':
      return {
        ...base,
        iconName: domainIcon('foodOrders'),
        title: `Sammelbestellung ${quote(todo.orderTitle)} abschicken`,
        sub: withEvent(
          todo.sendAt ? `Geplant war ${formatDateTime(todo.sendAt)}` : `Offen seit ${formatDateTime(todo.createdAt)}`,
          todo,
          activeEventId,
        ),
        navigate: { view: 'foodOrders', target: { type: 'order', id: todo.orderId } },
        inline: inWorkspace,
      };
    case 'food-order-settle':
      return {
        ...base,
        iconName: domainIcon('foodOrders'),
        title: `Sammelbestellung ${quote(todo.orderTitle)} abrechnen`,
        sub: withEvent(
          `${todo.unpaidPeople === 1 ? '1 Person hat' : `${todo.unpaidPeople} Personen haben`} noch nicht bezahlt`,
          todo,
          activeEventId,
        ),
        navigate: { view: 'foodOrders', target: { type: 'order', id: todo.orderId } },
        inline: false,
      };
    case 'vote-close':
      return {
        ...base,
        iconName: domainIcon('votes'),
        title: `Abstimmung ${quote(todo.title || 'ohne Titel')} beenden`,
        sub: withEvent(`Läuft seit ${formatDateTime(todo.startedAt)}`, todo, activeEventId),
        navigate: { view: 'votes' },
        inline: inWorkspace,
      };
    case 'tournament-finish':
      return {
        ...base,
        iconName: domainIcon('tournaments'),
        title: `Turnier ${quote(todo.name)} beenden`,
        sub: withEvent('Das Event ist vorbei', todo, activeEventId),
        navigate: { view: 'tournaments', target: { type: 'tournament', id: todo.tournamentId } },
        inline: inWorkspace,
      };
    default:
      return null;
  }
}

// Pending invitations are answered right here (Annehmen/Ablehnen).
export function invitationRow(invitation) {
  return {
    id: `event-invitation:${invitation.id}`,
    kind: 'event-invitation',
    audience: 'personal',
    eventId: invitation.id,
    switchesEvent: false,
    iconName: domainIcon('events'),
    title: `Einladung: ${invitation.name}`,
    sub: [eventDateRange(invitation), invitation.location].filter(Boolean).join(' · '),
    navigate: { view: 'profile' },
    inline: true,
  };
}

export function skillRow(game, id) {
  return {
    id,
    kind: 'skill',
    audience: 'personal',
    eventId: null,
    switchesEvent: false,
    iconName: domainIcon('skill'),
    title: `Skill für ${game.name} bewerten`,
    sub: 'Wird gerade gespielt',
    navigate: { view: 'gameCatalog' },
    inline: false,
  };
}

// Server rows keep their urgency order; invitations come first (they block
// everything else about that event) and skill nudges, which only matter while
// the game runs, follow the overdue entries.
export function myTodoRows({
  todos = myTodos(),
  skillNudges = [],
  invitations = state.eventInvitations ?? [],
  activeEventId,
  now,
} = {}) {
  if (todos === null) return null;
  const serverRows = todos
    .map((todo) => ({ todo, row: myTodoRow(todo, { activeEventId, now }) }))
    .filter((entry) => entry.row);
  const overdueRows = serverRows.filter((entry) => entry.todo.overdue).map((entry) => entry.row);
  const otherRows = serverRows.filter((entry) => !entry.todo.overdue).map((entry) => entry.row);
  return [...invitations.map(invitationRow), ...overdueRows, ...skillNudges, ...otherRows];
}
