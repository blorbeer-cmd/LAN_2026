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

// Where a notification counts. A betting round is offered on Match's cards,
// so its notification counts there; its own link opens the round on the
// points page, which therefore settles it as well.
function feedItem(entry) {
  const view = feedLinkView(entry.url);
  if (!view) return null;
  const base = { id: `feed:${entry.id}`, kind: 'feed', entryId: entry.id, targetId: entry.targetId ?? null };
  if (view === 'points' && feedLinkTarget(entry.url)?.type === 'betting-round') {
    return { ...base, view: 'matchmaking', alsoSeenOn: ['points'] };
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
    .filter((entry) => entry.eventId === activeEventId || entry.eventId === BASE_WORKSPACE_ID)
    .map(feedItem)
    .filter(Boolean);
  // A row of another workspace leads there first (see myTodoRow), so it
  // belongs to no entry of the navigation that is on screen now.
  const todos = (todoRows ?? [])
    .filter((row) => row && !row.switchesEvent && row.navigate?.view)
    .map((row) => ({ id: `todo:${row.id}`, kind: 'todo', view: row.navigate.view }));
  // A Vote round counts once: its unread announcement ("Neue Abstimmung",
  // target `vote:<round>`) already stands for that round's missing ballot.
  const announcedRounds = new Set(feed.map((item) => item.targetId).filter(Boolean));
  const votes = (pendingVotes ?? []).filter((round) => !announcedRounds.has(`vote:${round}`)).map((round) => ({
    id: `todo:vote-ballot:${activeEventId}:${round}`,
    kind: 'todo',
    view: 'votes',
  }));
  return [...feed, ...todos, ...votes];
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

// Items a reader has seen by opening `view`. The "Mehr" hub itself is a
// list of areas, not one of them, so opening it settles nothing.
export function itemsSeenByOpening(items, view) {
  if (!view || view === 'more') return [];
  const target = navTargetForView(view);
  return items.filter((item) => [item.view, ...(item.alsoSeenOn ?? [])].some((itemView) => navTargetForView(itemView) === target));
}

// Settling the opened area waits until the feed and the open workspace are
// both known: before that, the workspace filter would hide the very
// notifications the reader is looking at. Returns the notifications to mark
// read now and the area still waiting to be settled.
export function settleOpenedArea({ pendingView, openView, feedReady, items }) {
  if (!pendingView || pendingView !== openView) return { feedEntryIds: [], pendingView: null };
  if (!feedReady) return { feedEntryIds: [], pendingView };
  const feedEntryIds = itemsSeenByOpening(items, pendingView)
    .filter((item) => item.kind === 'feed')
    .map((item) => item.entryId);
  return { feedEntryIds, pendingView: null };
}

export function rememberSeenTodoIds(previousIds, newIds) {
  const merged = [...previousIds.filter((id) => !newIds.includes(id)), ...newIds];
  return merged.slice(-SEEN_TODO_LIMIT);
}
