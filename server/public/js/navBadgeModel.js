// Pure model behind the small counters on navigation entries (bottom nav,
// desktop rail, "Mehr" hub). No DOM access, so it runs under node:test.
//
// A counter sums two kinds of open items that belong to an entry's area:
// - feed: unread, still-active notifications of the open workspace (or of the
//   base workspace, which carries event invitations). They are marked read on
//   the server, so the count clears on every device at once.
// - todo: "Meine To-Dos" rows that can be handled from the open workspace,
//   plus the open Vote rounds without the own ballot. They stay on Home until
//   they are done, but leave the counter once their area has been opened.
// See docs/product/navigation-and-account-rules.md, "Navigationszähler".

import { feedLinkTarget, feedLinkView, isFeedEntryObsolete } from './pushFeed.js';
import { desktopNavTargetForView } from './bottomNav.js';
import { navGroupForView, sectionKeyForView } from './sectionNav.js';

export const NAV_BADGE_MAX = 9;
// The base workspace carries cross-event notifications (event invitations).
export const BASE_WORKSPACE_ID = 'instance-base-event';
// Seen To-Do ids are remembered per account on this device. Ids of settled
// To-Dos simply age out instead of being pruned against a list that differs
// per workspace.
export const SEEN_TODO_LIMIT = 200;

export function navBadgeText(count) {
  return count > NAV_BADGE_MAX ? `${NAV_BADGE_MAX}+` : String(count);
}

export function navBadgeLabel(baseLabel, count) {
  return count > 0 ? `${baseLabel}, ${count} neu` : baseLabel;
}

// Notifications of other workspaces stay off the navigation. The base
// workspace carries the cross-workspace ones (event invitations), but also
// its own Votes or orders; only those leading to pages that belong to no
// workspace count from elsewhere.
const WORKSPACE_INDEPENDENT_VIEWS = new Set(['events', 'profile']);

// The To-Do an unread notification already stands for: a Vote round's
// announcement for its missing ballot, an invitation for its pending answer.
function coveredTodoId(targetId, activeEventId) {
  const vote = /^vote:(\d+)$/.exec(targetId ?? '');
  if (vote) return `todo:vote-ballot:${activeEventId}:${vote[1]}`;
  const invitation = /^event-invitation:([^:]+):/.exec(targetId ?? '');
  if (invitation) return `todo:event-invitation:${invitation[1]}`;
  return null;
}

// Where a notification counts. A betting round is offered on Match's cards,
// so its notification counts there; its own link opens exactly that round on
// the points page, which therefore settles it too, but no other round.
function feedItem(entry, activeEventId) {
  const view = feedLinkView(entry.url);
  if (!view) return null;
  const crossWorkspace = entry.eventId === BASE_WORKSPACE_ID && WORKSPACE_INDEPENDENT_VIEWS.has(view);
  if (entry.eventId !== activeEventId && !crossWorkspace) return null;
  const base = {
    id: `feed:${entry.id}`,
    kind: 'feed',
    entryId: entry.id,
    coversTodoId: coveredTodoId(entry.targetId, activeEventId),
  };
  const target = feedLinkTarget(entry.url);
  if (view === 'points' && target?.type === 'betting-round') {
    return { ...base, view: 'matchmaking', alsoSeenOnRoute: { view: 'points', kind: 'round', id: target.id } };
  }
  return { ...base, view };
}

export function navBadgeItems({
  feedEntries = [],
  todoRows = [],
  pendingVotes = [],
  activeEventId = null,
  now = Date.now(),
} = {}) {
  const feed = (feedEntries ?? [])
    .filter((entry) => !entry.seen && !isFeedEntryObsolete(entry, now))
    .map((entry) => feedItem(entry, activeEventId))
    .filter(Boolean);
  // A Vote round or an invitation counts once: while its notification is
  // unread, that notification stands for the To-Do (see coveredTodoId).
  const covered = new Set(feed.map((item) => item.coversTodoId).filter(Boolean));
  // A row of another workspace leads there first (see myTodoRow), so it
  // belongs to no entry of the navigation that is on screen now.
  const todos = (todoRows ?? [])
    .filter((row) => row && !row.switchesEvent && row.navigate?.view)
    .map((row) => ({ id: `todo:${row.id}`, kind: 'todo', view: row.navigate.view }));
  const votes = (pendingVotes ?? []).map((round) => ({
    id: `todo:vote-ballot:${activeEventId}:${round}`,
    kind: 'todo',
    view: 'votes',
  }));
  return [...feed, ...[...todos, ...votes].filter((item) => !covered.has(item.id))];
}

// To-Do ids settled by `items`: their own, plus the To-Dos their
// notifications stand for, so a count does not jump back once the
// notification is read.
export function todoIdsSettledBy(items) {
  return items.flatMap((item) => {
    if (item.kind === 'todo') return [item.id];
    return item.coversTodoId ? [item.coversTodoId] : [];
  });
}

export function unseenNavBadgeItems(items, seenTodoIds) {
  return items.filter((item) => item.kind !== 'todo' || !seenTodoIds.has(item.id));
}

// The rail entry, and the page an item counts as seen on: tournaments live
// inside Match, Admin's tools inside Admin.
export function navTargetForView(view) {
  return desktopNavTargetForView(view);
}

// A "Mehr" card stands for a whole area (Orga holds To-Do and Umfragen).
function moreAreaKey(view) {
  return sectionKeyForView(view) ?? navTargetForView(view);
}

export function countForBottomNav(items, buttonView, event) {
  const group = navGroupForView(buttonView, event);
  return items.filter((item) => navGroupForView(item.view, event) === group).length;
}

export function countForDesktopNav(items, buttonView) {
  return items.filter((item) => navTargetForView(item.view) === buttonView).length;
}

export function countForMoreCard(items, cardView) {
  const key = moreAreaKey(cardView);
  return items.filter((item) => moreAreaKey(item.view) === key).length;
}

// Items a reader has seen by opening `view` (with its local `route`, such as
// one betting round). The "Mehr" hub itself is a list of areas, not one of
// them, so opening it settles nothing.
export function itemsSeenByOpening(items, view, route = null) {
  if (!view || view === 'more') return [];
  const target = navTargetForView(view);
  return items.filter((item) => {
    if (navTargetForView(item.view) === target) return true;
    const exact = item.alsoSeenOnRoute;
    return Boolean(exact) && exact.view === view && route?.kind === exact.kind && route?.id === exact.id;
  });
}

// Settling the opened area waits until the feed and the open workspace are
// both known: before that, the workspace filter would hide the very
// notifications the reader is looking at. Returns the notifications to mark
// read now and the area still waiting to be settled.
export function settleOpenedArea({ pendingView, openView, openRoute = null, feedReady, items }) {
  if (!pendingView || pendingView !== openView) return { feedEntryIds: [], pendingView: null };
  if (!feedReady) return { feedEntryIds: [], pendingView };
  const feedEntryIds = itemsSeenByOpening(items, pendingView, openRoute)
    .filter((item) => item.kind === 'feed')
    .map((item) => item.entryId);
  return { feedEntryIds, pendingView: null };
}

// A To-Do keeps its id when it is reopened (a task taken again), so the
// "seen" mark must end with the open phase it was given in: once the full
// list is loaded, ids of To-Dos that are no longer open are forgotten and a
// To-Do that comes back counts again. Missing ballots only exist for the open
// workspace, so another workspace's ballot ids are kept.
export function pruneSeenTodoIds(seenIds, openTodoIds, activeEventId) {
  const open = new Set(openTodoIds);
  const activeBallotPrefix = `todo:vote-ballot:${activeEventId}:`;
  return seenIds.filter((id) => open.has(id) || (id.startsWith('todo:vote-ballot:') && !id.startsWith(activeBallotPrefix)));
}

export function rememberSeenTodoIds(previousIds, newIds) {
  const merged = [...previousIds.filter((id) => !newIds.includes(id)), ...newIds];
  return merged.slice(-SEEN_TODO_LIMIT);
}
