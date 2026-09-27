// "Essen bestellen" view: Sammelbestellungen. Someone opens an order
// ("Pizza bei Luigi's"), everyone adds their own items (free text, price
// optional) from their own phone. Submitting it ("Abgeschickt") freezes the
// item list into a read-out view grouped per person — the "wer wollte
// nochmal was?" round through the room becomes one glance at the screen —
// but stays reversible: the creator/an admin can reopen it to add a
// forgotten item or fix a price, and paid status/metadata stay editable
// throughout. Once they lock it for good ("Geschlossen"), no items, paid or
// metadata changes are possible any more — but even that lock itself stays
// reversible through the same "Wieder öffnen" action, one step back at a
// time (Geschlossen -> Abgeschickt -> Offen).
//
// Payment happens at the orderer group: each person sees one complete amount,
// pays it through the order's PayPal link and confirms the whole group.

import { api } from '../api.js';
import { state } from '../state.js';
import { escapeHtml, avatarHtml, formatDateTime } from '../format.js';
import { openModal, confirmDialog } from '../modal.js';
import { showToast } from '../toast.js';
import { getMyId } from '../whoami.js';
import { icon } from '../icons.js';
import { dateTimeFieldHtml, wireDateTimeField } from '../dateTimeField.js';
import { infoTooltipHtml, wireInfoTooltips } from '../infoTooltip.js';
import { emptyStateHtml } from '../emptyState.js';
import { currentPlayerHasAdminRole } from '../adminAccess.js';
import { formatEuroCents as formatCents, normalizePaypalInput, paypalEmailFromLink, paypalPayUrl } from '../paypal.js';
import {
  captureFoodOrderViewState,
  restoreFoodOrderDrafts,
  restoreFoodOrderFocus,
  restoreFoodOrderViewport,
} from '../foodOrderViewState.js';
import {
  addTipToCents,
  buildConsolidatedRows,
  foodOrderDescriptionSuggestions,
  groupPaymentState,
  parsePriceToCents,
} from '../foodOrderModel.js';
import { createDeferredInteractiveRender } from '../deferredInteractiveRender.js';
import { actionMenuHtml, wireActionMenus } from '../actionMenu.js';

export { normalizePaypalInput, paypalEmailFromLink, paypalPayUrl } from '../paypal.js';
export {
  addTipToCents,
  buildConsolidatedRows,
  foodOrderDescriptionSuggestions,
  groupPaymentState,
  parsePriceToCents,
} from '../foodOrderModel.js';

let cache = null;
let loading = false;
let historyOpen = false;

const deferredFoodOrderRender = createDeferredInteractiveRender({
  isInteractive: (container) => Boolean(container.querySelector('[data-desc-suggest].is-open')),
});

function rerenderLocalMutation(ctx) {
  deferredFoodOrderRender.runForced(() => {
    ctx.rerender();
  });
}

// Orderer-group expand/collapse state: `orderId -> Set<playerId>` of currently
// expanded groups. Deliberately module state, not persisted; the start rule
// runs at most once per order and session and realtime renders never reset it.
const expandedGroups = new Map();
const groupStartRuleApplied = new Set();

// Whole-order collapse state, only meaningful once more than one order is
// open at a time: order ids in this set are expanded. A single open order
// gets no collapse chrome at all. Not persisted beyond the session.
const expandedOpenOrders = new Set();
let orderStartRuleApplied = false;

// Same collapse pattern, mirrored for Historie: only meaningful once more
// than one closed/finalized order exists. A single history entry gets no
// collapse chrome either.
const expandedClosedOrders = new Set();
let closedOrderStartRuleApplied = false;
let pendingOrderTargetId = null;
let activeOrderTargetId = null;
let orderTargetStateVersion = 0;

// The consolidated-list dialog (AP4.7) keeps updating while it's open, so a
// live re-render of the underlying view needs to be able to refresh it too.
let consolidatedListDialog = null; // { orderId, el, ctx } | null

// Called by app.js before the Essen view renders a search or push target. The
// id is applied before the first populated render, so a deep link never lands
// on a card that is still collapsed for a moment.
export function prepareFoodOrderTarget(orderId) {
  if (!orderId) return;
  if (activeOrderTargetId !== orderId) orderTargetStateVersion += 1;
  pendingOrderTargetId = orderId;
  activeOrderTargetId = orderId;
  if (cache !== null && !cache.some((order) => order.id === orderId)) cache = null;
  if (fetchInFlight) refetchPending = true;
}

export function clearFoodOrderTarget() {
  if (activeOrderTargetId === null && pendingOrderTargetId === null) return;
  orderTargetStateVersion += 1;
  pendingOrderTargetId = null;
  activeOrderTargetId = null;
  // A target-aware response may contain an older order outside the normal
  // window. Do not let that response become the next un-targeted view after
  // navigating away and back to Essen.
  cache = null;
}

// Single-flight coordinator for GET /api/food-orders. load() (the first
// fetch, or any fetch that starts from a hard-invalidated `cache === null`)
// and refreshFoodOrders() (the silent background refresh used while Essen
// is already open, see below) used to be two independently-guarded fetch
// pipelines - self-review found that a second self-review (after the first
// found a related race) still let them run concurrently: nothing stopped
// load() from firing its own GET while a refreshFoodOrders() one was still
// in flight (e.g. cache forced back to null by an unrelated invalidate -
// event switch, reconnect - while a background refresh was running), and
// two overlapping requests can resolve out of order, letting the
// earlier-issued one overwrite state a later one already applied. One
// shared lock instead: at most one GET is ever in flight, and every caller
// that arrives while one is running just asks for one more round after it
// settles rather than starting a second, independently-resolving request.
let fetchInFlight = null;
let refetchPending = false;
let foodOrderScopeVersion = 0;
let foodOrderWorkspaceVersion = 0;

function invalidateFoodOrderCache() {
  foodOrderScopeVersion += 1;
  foodOrderWorkspaceVersion += 1;
  cache = null;
}

async function fetchFoodOrders(ctx) {
  if (fetchInFlight) {
    refetchPending = true;
    return fetchInFlight;
  }
  const run = (async () => {
    let succeeded = false;
    do {
      refetchPending = false;
      // `loading` (and the "Lädt…" placeholder it drives, see
      // renderFoodOrders) only makes sense for a genuine first load - decided
      // fresh on every iteration since a retry after `cache` was populated by
      // an earlier iteration must stay silent.
      const showPlaceholder = cache === null;
      if (showPlaceholder) loading = true;
      // Caught per iteration, not around the whole loop: a failed fetch must
      // not swallow a `refetchPending` set by another caller that arrived
      // while this one was in flight - the `while` below still has to see it,
      // or that follow-up refresh is silently lost until some unrelated event
      // happens to trigger another one.
      const requestTargetId = activeOrderTargetId;
      const requestTargetStateVersion = orderTargetStateVersion;
      const requestScopeVersion = foodOrderScopeVersion;
      const previousCache = cache;
      let skipRerender = false;
      try {
        const res = await api.foodOrders.list(requestTargetId);
        const responseIsCurrent =
          requestTargetStateVersion === orderTargetStateVersion &&
          requestTargetId === activeOrderTargetId &&
          requestScopeVersion === foodOrderScopeVersion;
        if (responseIsCurrent) {
          // Every mutation endpoint already applies its own authoritative
          // response locally (see reconcileLocalOrderMutation) before this
          // quiet follow-up GET is even sent; that GET exists to pick up
          // concurrent changes from other devices, not to redraw the view
          // for a response it already knows about. Replacing the complete
          // DOM here anyway raced a Playwright read of the paid marker's
          // just-settled layout against this fetch's resolution: the marker
          // got detached between locating it and reading its rect, reporting
          // a spurious ({"left":0,"width":0}) move. Skipping the render when
          // the two payloads already match removes that race and the
          // pointless extra reflow alike; the sort order matches (both the
          // server and sortCachedOrders order by createdAt descending) and
          // every order comes from the same serializeOrder() call, so a
          // plain structural comparison reliably detects "nothing changed".
          skipRerender = !showPlaceholder && previousCache !== null && JSON.stringify(previousCache) === JSON.stringify(res.orders);
          cache = res.orders;
          succeeded = true;
        } else {
          // A navigation/deep-link target or the cache scope changed while
          // this request was in flight. Discard the old response and fetch
          // for the current target/scope, including the global order list.
          refetchPending = true;
          succeeded = false;
        }
      } catch (err) {
        const responseIsCurrent =
          requestTargetStateVersion === orderTargetStateVersion &&
          requestTargetId === activeOrderTargetId &&
          requestScopeVersion === foodOrderScopeVersion;
        succeeded = false;
        if (responseIsCurrent) {
          showToast(err.message, { error: true });
          if (showPlaceholder) cache = [];
        } else {
          refetchPending = true;
        }
      } finally {
        if (showPlaceholder) loading = false;
        if (!skipRerender) ctx.rerender();
      }
    } while (refetchPending);
    return succeeded;
  })();
  fetchInFlight = run;
  run.finally(() => {
    if (fetchInFlight === run) fetchInFlight = null;
  });
  return run;
}

async function load(ctx) {
  return fetchFoodOrders(ctx);
}

// Called from app.js on every foodOrders:changed socket event for a device
// that isn't currently looking at this view - the next time it opens Essen,
// load() runs its normal first-load fetch.
export function invalidateFoodOrders() {
  invalidateFoodOrderCache();
}

// Called from app.js instead of invalidateFoodOrders() while this view is
// the one currently on screen. A live update (someone adding an item,
// marking a position paid - including the echo of this very device's own
// change PATCHing back over the socket) must not go through the hard
// invalidate: renderFoodOrders() shows a "Lädt…" placeholder for as long as
// `cache` is null, which collapses the whole card list to one line and
// clamps its scrollTop to 0 - permanently, since the scroll-restore in
// renderFoodOrders only ever restores the (by then already-zeroed) current
// position. Refetching quietly and only ever swapping in real data keeps
// the DOM - and its scroll position - stable across every realtime update.
export async function refreshFoodOrders(ctx) {
  return fetchFoodOrders(ctx);
}

function sortCachedOrders(orders) {
  return orders.sort((a, b) => b.createdAt - a.createdAt);
}

// Mutation endpoints return the complete, freshly serialized order. Apply
// that response directly instead of clearing the cache: a hard invalidate
// briefly replaced the whole Essen view with "Lädt…", shrank the scroll
// container and forced its scrollTop to 0. The quiet follow-up GET still
// reconciles concurrent changes from other devices without introducing that
// intermediate empty frame.
function reconcileLocalOrderMutation(nextOrder, ctx, mutationWorkspaceVersion) {
  if (mutationWorkspaceVersion !== foodOrderWorkspaceVersion) {
    void refreshFoodOrders(ctx);
    return;
  }
  foodOrderScopeVersion += 1;
  const nextCache = cache === null ? [] : [...cache];
  const index = nextCache.findIndex((order) => order.id === nextOrder.id);
  if (index === -1) nextCache.push(nextOrder);
  else nextCache[index] = nextOrder;
  cache = sortCachedOrders(nextCache);

  if (nextOrder.open) {
    const openCount = cache.filter((order) => order.open).length;
    if (openCount > 1) {
      // A just-created or reopened order is the thing the user is working
      // with, so keep it visible when the open-order cards are collapsible.
      if (!orderStartRuleApplied) {
        orderStartRuleApplied = true;
        expandedOpenOrders.clear();
      }
      expandedOpenOrders.add(nextOrder.id);
    }
  } else {
    // Closing/finalizing/unfinalizing an order keeps (or moves) its card in
    // Historie. Keep the same card on screen instead of making it disappear
    // into a newly collapsed section or card.
    historyOpen = true;
    expandedOpenOrders.delete(nextOrder.id);
    const closedCount = cache.filter((order) => !order.open).length;
    if (closedCount > 1) {
      if (!closedOrderStartRuleApplied) {
        closedOrderStartRuleApplied = true;
        expandedClosedOrders.clear();
      }
      expandedClosedOrders.add(nextOrder.id);
    }
  }

  rerenderLocalMutation(ctx);
  void refreshFoodOrders(ctx);
}

function reconcileLocalOrderRemoval(orderId, ctx, mutationWorkspaceVersion) {
  if (mutationWorkspaceVersion !== foodOrderWorkspaceVersion) {
    void refreshFoodOrders(ctx);
    return;
  }
  foodOrderScopeVersion += 1;
  if (cache !== null) cache = cache.filter((order) => order.id !== orderId);
  expandedGroups.delete(orderId);
  groupStartRuleApplied.delete(orderId);
  expandedOpenOrders.delete(orderId);
  expandedClosedOrders.delete(orderId);
  rerenderLocalMutation(ctx);
  void refreshFoodOrders(ctx);
}

function refreshFoodOrdersAfterMutationError(ctx) {
  void refreshFoodOrders(ctx);
}

async function copyFoodOrderValue(value, label) {
  if (!navigator.clipboard?.writeText) {
    showToast('Kopieren ist in diesem Browser nicht verfügbar.', { error: true });
    return;
  }
  try {
    await navigator.clipboard.writeText(value);
    showToast(`${label} kopiert: ${value}`);
  } catch {
    showToast(`${label} konnte nicht kopiert werden.`, { error: true });
  }
}

function copyFoodOrderTotal(value) {
  return copyFoodOrderValue(value, 'Summe');
}

// PayPal has no link that pre-fills a recipient by email, so these links
// only open PayPal's generic "send money" page - copying the address here is
// what saves the actual step of typing it in by hand.
function copyPaypalEmailToClipboard(email) {
  return copyFoodOrderValue(email, 'E-Mail-Adresse');
}

function copyPaypalAddressToClipboard(address) {
  return copyFoodOrderValue(address, 'PayPal-Adresse');
}

function itemsGroupedByPlayer(order) {
  const byPlayer = new Map();
  for (const item of order.items) {
    if (!byPlayer.has(item.playerId)) byPlayer.set(item.playerId, []);
    byPlayer.get(item.playerId).push(item);
  }
  return byPlayer;
}

// Sum of an item's own line (quantity × unit price), tip included, or null
// if the item has no price at all.
function lineTotalCents(item, tipPercent) {
  if (item.priceCents === null) return null;
  return addTipToCents(item.priceCents * (item.quantity ?? 1), tipPercent);
}

function sumLineTotals(items, tipPercent) {
  return items.reduce((sum, item) => sum + (lineTotalCents(item, tipPercent) ?? 0), 0);
}

// AP3.6 startup rule, applied at most once per order per session (AP3.7):
// every orderer group starts collapsed, so an order reads as one compact list
// of people and amounts. Adding an own position opens the own group (AP3.8).
function ensureGroupStartRule(order) {
  if (groupStartRuleApplied.has(order.id)) return;
  groupStartRuleApplied.add(order.id);
  // Keep a group opened before the order had several groups, e.g. the own
  // group right after adding the position that created the second group.
  expandedGroups.set(order.id, expandedGroups.get(order.id) ?? new Set());
}

function playerFor(item) {
  return state.players.find((p) => p.id === item.playerId) || { color: item.playerColor };
}

function renderItemRow(order, item, myId, { locked = false } = {}) {
  const tipPercent = order.tipPercent || 0;
  const quantity = item.quantity ?? 1;
  const total = lineTotalCents(item, tipPercent);
  // The tip is named once beside the order total; a row only names the unit
  // price when a quantity makes the line total differ from it. It stays with
  // the description so every amount lines up in one column.
  const unitPriceHtml =
    total !== null && quantity > 1 ? ` <span class="muted food-order-item-unit">je ${formatCents(item.priceCents)}</span>` : '';

  const descriptionHtml = `<span class="food-order-item-description"><strong>${quantity} ×</strong> ${escapeHtml(item.description)}${unitPriceHtml}</span>`;

  // Betrag ist Anzeige, kein Knopf; der einzige Bezahlweg liegt am
  // Gruppenkopf.
  const amountHtml =
    total === null
      ? `<span class="food-order-item-amount muted">Preis fehlt</span>`
      : `<span class="food-order-item-amount"><strong>${formatCents(total)}</strong></span>`;

  const removeTitle = item.paid ? 'Als bezahlt bestätigt, erst die Marke der Person zurückdrehen' : 'Position entfernen';
  // Removing an own position is a small inline action right after its name,
  // so position rows keep a single amount column like an invoice.
  const removeHtml =
    !locked && order.open && item.playerId === myId
      ? `<button type="button" class="icon-btn food-order-item-remove" data-remove-item="${item.id}" data-order="${order.id}" ${item.paid ? 'disabled' : ''} title="${removeTitle}" aria-label="${removeTitle}">${icon('trash')}</button>`
      : '';

  return `
    <div class="row food-order-item${item.paid ? ' is-paid' : ''}">
      <span class="food-order-item-main">${descriptionHtml}${removeHtml}</span>
      ${amountHtml}
    </div>`;
}

function groupPaidNames(items) {
  return [...new Set(items.filter((item) => item.paid).map((item) => item.paidByName).filter(Boolean))];
}

function applyLocalPaidState(items, paid) {
  const player = state.players.find((candidate) => candidate.id === getMyId());
  for (const item of items) {
    item.paid = paid;
    item.paidByName = paid ? player?.name ?? item.paidByName : null;
    item.paidAt = paid ? Date.now() : null;
  }
}

// A successful payment mutation may overlap with the realtime echo's GET.
// Version both sides of the PATCH and reconcile against whichever cache is
// current when it resolves; mutating the pre-PATCH object would let a stale
// response overwrite the local result (and invalidating to null would jump
// the visible Essen view back to its loading placeholder).
function reconcileLocalPaidMutation(orderId, itemIds, paid, ctx, mutationWorkspaceVersion) {
  if (mutationWorkspaceVersion !== foodOrderWorkspaceVersion) {
    void refreshFoodOrders(ctx);
    return;
  }
  foodOrderScopeVersion += 1;
  const currentOrder = cache?.find((candidate) => candidate.id === orderId);
  const currentItems = currentOrder?.items.filter((item) => itemIds.includes(item.id)) ?? [];
  if (!currentOrder || currentItems.length !== itemIds.length) {
    cache = null;
  } else {
    applyLocalPaidState(currentItems, paid);
  }
  ctx.rerender();
  void refreshFoodOrders(ctx);
}

function renderGroupHeader(order, playerId, items, myId, { collapsible, expanded, locked = false }) {
  const player = playerFor(items[0]);
  const tipPercent = order.tipPercent || 0;
  const allPaid = groupPaymentState(items) === 'paid';
  const allPriced = items.every((i) => i.priceCents !== null);
  const totalCents = sumLineTotals(items, tipPercent);

  const headText = `
    ${avatarHtml(player, 24)}
    <span class="food-order-group-headtext">
      <strong>${escapeHtml(items[0].playerName)}${playerId === myId ? ' <span class="muted food-order-group-self-label">(du)</span>' : ''}</strong>
    </span>`;

  const leftHtml = collapsible
    ? `<button type="button" class="food-order-group-toggle" data-group-toggle="${playerId}" data-order="${order.id}" aria-expanded="${expanded ? 'true' : 'false'}">
         ${icon('chevronRight', { className: 'food-order-group-chevron' })}
         ${headText}
       </button>`
    : `<div class="food-order-group-static">${headText}</div>`;

  const hasPriced = items.some((i) => i.priceCents !== null);
  const amountStateClass = allPaid ? ' is-paid' : '';
  const amountInner = allPriced
    ? `<span class="food-order-group-amount${amountStateClass}">${formatCents(totalCents)}</span>`
    : hasPriced
      ? `<span class="food-order-group-amount${amountStateClass} muted" title="Preis fehlt">${formatCents(totalCents)}</span>`
      : `<span class="food-order-group-amount${amountStateClass} muted">Preis fehlt</span>`;

  const paidNames = groupPaidNames(items);
  const paidTitle = allPaid
    ? paidNames.length
      ? `Bezahlt, bestätigt von ${paidNames.join(', ')}. Markierung aufheben`
      : 'Bezahlt. Markierung aufheben'
    : `${items[0].playerName} als bezahlt markieren`;
  const paidMarkerHtml = `<button type="button" class="payment-paid-marker food-order-paid-marker ${allPaid ? 'is-paid' : ''}" data-toggle-group-paid="${playerId}" data-order="${order.id}" ${locked ? 'disabled' : ''} aria-pressed="${allPaid ? 'true' : 'false'}" title="${escapeHtml(paidTitle)}" aria-label="${escapeHtml(paidTitle)}">
    <span class="payment-paid-box" aria-hidden="true">${allPaid ? icon('check') : ''}</span><span>Bezahlt</span>
  </button>`;

  const payDisabledReason = locked
    ? 'Bestellung geschlossen, keine Änderungen mehr möglich'
    : allPaid
      ? 'Bereits bezahlt'
      : !allPriced
        ? 'Betrag unvollständig, erst alle Preise eintragen'
        : null;
  const payTitle = payDisabledReason || `${formatCents(totalCents)} für ${items[0].playerName} über PayPal bezahlen`;
  const payButtonHtml = order.paypalLink
    ? `<button type="button" class="icon-btn payment-paypal-button food-order-item-action food-order-group-pay" data-group-pay="${playerId}" data-order="${order.id}" ${payDisabledReason ? 'disabled' : ''} title="${escapeHtml(payTitle)}" aria-label="${escapeHtml(payTitle)}">${icon('paypal')}</button>`
    : '';

  // Every group row carries the same controls, so the columns never open
  // gaps: copy is disabled rather than missing while no price is known.
  const copyValue = hasPriced ? formatCents(totalCents) : null;
  const copyLabel = copyValue ? `Summe von ${items[0].playerName} kopieren` : 'Noch kein Betrag zum Kopieren';
  const copyHtml = `<button type="button" class="icon-btn food-order-item-action food-order-group-copy" ${copyValue ? `data-copy-food-total="${escapeHtml(copyValue)}"` : 'disabled'} title="${escapeHtml(copyLabel)}" aria-label="${escapeHtml(copyLabel)}">${icon('copy')}</button>`;

  return `
    <div class="row food-order-group-header">
      ${leftHtml}
      <span class="food-order-group-actions">${paidMarkerHtml}${payButtonHtml}</span>
      <span class="food-order-group-amount-wrap">${copyHtml}${amountInner}</span>
    </div>`;
}

function renderItems(order, myId, { locked = false } = {}) {
  if (order.items.length === 0) {
    return emptyStateHtml('Noch keine Positionen.', {
      className: 'empty-state-food-items',
    });
  }
  const grouped = itemsGroupedByPlayer(order);
  return renderGroups(order, myId, grouped, { locked });
}

function renderGroups(order, myId, grouped, { locked }) {
  // AP3.9: a single-group order gets no collapse chrome at all.
  if (grouped.size <= 1) {
    return [...grouped.entries()]
      .map(([playerId, items]) => {
        const rows = items.map((i) => renderItemRow(order, i, myId, { locked })).join('');
        const allPaid = groupPaymentState(items) === 'paid';
        // Its one position already prints the same tip-inclusive total, so the
        // phone layout drops the group's own sum (domains.css, --bp-md block).
        const singlePosition = items.length === 1;
        return `
          <div class="stack food-order-group is-static ${allPaid ? 'is-all-paid' : ''}${singlePosition ? ' is-single-position' : ''}">
            ${renderGroupHeader(order, playerId, items, myId, { collapsible: false, locked })}
            <div class="food-order-group-items">${rows}</div>
          </div>`;
      })
      .join('');
  }

  ensureGroupStartRule(order);
  const expandedSet = expandedGroups.get(order.id) ?? new Set();

  return [...grouped.entries()]
    .map(([playerId, items]) => {
      const expanded = expandedSet.has(playerId);
      const rows = items.map((i) => renderItemRow(order, i, myId, { locked })).join('');
      const allPaid = groupPaymentState(items) === 'paid';
      // Only while the position is actually on screen: a collapsed group hides
      // its rows, so there the sum is the only amount left to show.
      const singlePosition = expanded && items.length === 1;
      return `
        <div class="stack food-order-group ${allPaid ? 'is-all-paid' : ''}${singlePosition ? ' is-single-position' : ''}">
          ${renderGroupHeader(order, playerId, items, myId, { collapsible: true, expanded, locked })}
          <div class="food-order-group-items" ${expanded ? '' : 'hidden'}>${rows}</div>
        </div>`;
    })
    .join('');
}

// "1 Preis fehlt" / "2 Preise fehlen": why a sum is still incomplete.
function missingPriceLabel(items) {
  const missing = items.filter((item) => item.priceCents === null).length;
  if (missing === 0) return null;
  return missing === 1 ? '1 Preis fehlt' : `${missing} Preise fehlen`;
}

// Order-wide summary for the card's meta line: people and what is still
// open. The full total sits in the card's own "Gesamt" row.
function orderSummaryParts(order) {
  if (order.items.length === 0) return [];
  const tipPercent = order.tipPercent || 0;
  const groups = [...itemsGroupedByPlayer(order).values()];
  const openCents = groups
    .filter((items) => !items.every((i) => i.paid))
    .reduce((sum, items) => sum + sumLineTotals(items, tipPercent), 0);
  const parts = [`${groups.length} ${groups.length === 1 ? 'Person' : 'Personen'}`];
  if (groups.every((items) => items.every((i) => i.paid))) parts.push('alle bezahlt');
  else if (openCents > 0) parts.push(`offen ${formatCents(openCents)}`);
  const missing = missingPriceLabel(order.items);
  if (missing) parts.push(missing);
  return parts;
}

// The order-wide total, styled as a real total (not a muted info line) with
// its own copy action directly beside the amount, so the sum sits left of
// the copy button rather than trailing behind unrelated metadata.
function renderOrderSummaryTotal(order) {
  if (order.items.length === 0) return '';
  const tipPercent = order.tipPercent || 0;
  const totalCents = sumLineTotals(order.items, tipPercent);
  const incomplete = order.items.some((item) => item.priceCents === null);
  const notes = [tipPercent > 0 ? `inkl. ${tipPercent} % Trinkgeld` : null, incomplete ? missingPriceLabel(order.items) : null].filter(Boolean);
  return `
    <div class="row-between food-order-total">
      <span class="food-order-total-label">Gesamt${notes.length ? ` <span class="muted food-order-total-note">${notes.join(' · ')}</span>` : ''}</span>
      <span class="food-order-total-value">
        <button type="button" class="icon-btn food-order-item-action food-order-item-copy" data-copy-food-total="${escapeHtml(formatCents(totalCents))}" title="Summe kopieren" aria-label="Summe kopieren">${icon('copy')}</button>
        <strong>${formatCents(totalCents)}</strong>
      </span>
    </div>`;
}

function renderOrderSummary(order) {
  const totalHtml = renderOrderSummaryTotal(order);
  return totalHtml ? `<div class="stack food-order-summary">${totalHtml}</div>` : '';
}

function formatFoodOrderTimestamp(timestamp) {
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return '';
  const pad = (value) => String(value).padStart(2, '0');
  return `${pad(date.getDate())}.${pad(date.getMonth() + 1)}. ${pad(date.getHours())}:${pad(date.getMinutes())} Uhr`;
}

// One compact meta line under the order title: state (only in Historie),
// creator and the send time; without a send time the creation time stands in.
function renderOrderMeta(order, stateLabel = null) {
  const parts = [
    stateLabel,
    `von ${escapeHtml(order.createdByName)}`,
    order.sendAt ? `Versand ${formatFoodOrderTimestamp(order.sendAt)}` : formatDateTime(order.createdAt),
    ...orderSummaryParts(order),
  ].filter(Boolean);
  // Paying happens per person in the group rows, so only the menu link
  // closes the meta line.
  const links = order.link ? [`<a class="food-order-meta-link" href="${escapeHtml(order.link)}" target="_blank" rel="noopener">Speisekarte</a>`] : [];
  return `<span class="muted food-order-meta">${[...parts, ...links].join(' · ')}</span>`;
}

// Free-text info as a plain gray line. The menu link sits at the end
// of the meta line; editing and the Bestellübersicht live in "Aktion".
function renderDetails(order) {
  return order.notes ? `<div class="muted food-order-details-note">${escapeHtml(order.notes)}</div>` : '';
}

// AP3.6: one toggle for all orderer groups, only meaningful while the card is
// open and the order has more than one group. It joins the "Aktion" menu of
// a manager and stands alone as a direct button for everybody else.
function renderGroupToggleAll(order) {
  const grouped = itemsGroupedByPlayer(order);
  if (grouped.size <= 1) return '';
  const expandedSet = expandedGroups.get(order.id) ?? new Set();
  const allExpanded = [...grouped.keys()].every((playerId) => expandedSet.has(playerId));
  const label = allExpanded ? 'Alle einklappen' : 'Alle ausklappen';
  return `<button type="button" class="btn btn-sm" data-toggle-all-groups="${order.id}">${label}</button>`;
}

// Description field with a suggestion dropdown of the order's own already
// entered positions (see foodOrderDescriptionSuggestions): opening it or
// filtering it while typing makes it easy to reuse the exact existing
// spelling instead of accidentally splitting the same item into two
// consolidated-list rows. Unlike the shared search-select combobox, typed
// text is never resolved against or reset to a fixed option — a genuinely
// new item stays exactly as typed, so a brand-new order's first position
// (no suggestions yet) stays a plain text field.
// One suggestion row, shared between the initial render and renderOptions()'s
// re-filtered re-render. The price (when this description already carries
// one) is a plain muted trailing value, not a real option field, so a
// suggestion without a recorded price just omits it instead of showing a
// misleading placeholder.
function descOptionHtml(listId, suggestion, index, selected) {
  return `
      <button type="button" id="${listId}-option-${index}" class="search-select-option" role="option" aria-selected="${selected}" tabindex="-1" data-desc-option-index="${index}" data-desc-option-price="${suggestion.priceCents ?? ''}">
        <span class="search-select-option-label">${escapeHtml(suggestion.label)}</span>
        ${suggestion.priceCents !== null ? `<span class="search-select-option-price">${formatCents(suggestion.priceCents)}</span>` : ''}
      </button>`;
}

function renderDescField(order) {
  const suggestions = foodOrderDescriptionSuggestions(order.items);
  if (suggestions.length === 0) {
    return `<input type="text" class="food-order-desc-field" data-item-desc placeholder="Margherita groß" maxlength="120" required aria-label="Artikelbezeichnung" autocomplete="off" />`;
  }
  const listId = `food-order-desc-${order.id}`;
  const optionsHtml = suggestions.map((suggestion, index) => descOptionHtml(listId, suggestion, index, false)).join('');
  return `
    <div class="search-select food-order-desc-field" data-desc-suggest>
      <div class="search-select-control">
        <input type="text" data-item-desc placeholder="Margherita groß" maxlength="120" required autocomplete="off" role="combobox" aria-autocomplete="list" aria-expanded="false" aria-controls="${listId}" aria-label="Artikelbezeichnung, bereits eingetragene Positionen vorschlagen" />
        <button type="button" class="search-select-toggle" data-desc-toggle aria-controls="${listId}" aria-expanded="false" aria-label="Vorhandene Bezeichnungen anzeigen" tabindex="-1">${icon('chevronDown')}</button>
      </div>
      <div id="${listId}" class="search-select-list" role="listbox" aria-label="Bereits eingetragene Positionen" hidden>${optionsHtml}</div>
    </div>`;
}

// Wires one renderDescField() suggestion dropdown. Deliberately not a call
// into wireSearchSelect(): that shared combobox always resolves the visible
// text back to a known option's value (or clears it), which is right for a
// closed catalog (games, events) but would silently discard a genuinely new,
// unlisted item description here.
function wireDescSuggest(wrapper) {
  const input = wrapper.querySelector('[data-item-desc]');
  const toggle = wrapper.querySelector('[data-desc-toggle]');
  const list = wrapper.querySelector('.search-select-list');
  if (!input || !toggle || !list) return;

  const priceInput = wrapper.closest('form')?.querySelector('[data-item-price]');
  const suggestions = [...list.querySelectorAll('[data-desc-option-index]')].map((el) => ({
    label: el.querySelector('.search-select-option-label').textContent,
    priceCents: el.dataset.descOptionPrice ? Number(el.dataset.descOptionPrice) : null,
  }));
  let filtered = suggestions;
  let activeIndex = -1;

  const isOpen = () => !list.hidden;

  const updateExpanded = (expanded) => {
    wrapper.classList.toggle('is-open', expanded);
    input.setAttribute('aria-expanded', String(expanded));
    toggle.setAttribute('aria-expanded', String(expanded));
    toggle.setAttribute('aria-label', expanded ? 'Vorschlagsliste schließen' : 'Vorhandene Bezeichnungen anzeigen');
  };

  const updateActiveOption = () => {
    const optionElements = [...list.querySelectorAll('[data-desc-option-index]')];
    optionElements.forEach((el, index) => el.classList.toggle('is-active', index === activeIndex));
    const active = optionElements[activeIndex];
    if (active) input.setAttribute('aria-activedescendant', active.id);
    else input.removeAttribute('aria-activedescendant');
    active?.scrollIntoView({ block: 'nearest' });
  };

  const renderOptions = () => {
    const query = input.value.trim().toLocaleLowerCase('de-DE');
    filtered = suggestions.filter((s) => s.label.toLocaleLowerCase('de-DE').includes(query));
    // This field is free text, not a closed catalog - an unmatched query has
    // no actionable suggestion to show, and on a phone an empty-state box
    // would sit directly over the next field (quantity) and eat the next
    // tap. Keep the list closed instead of showing it empty.
    if (filtered.length === 0) {
      close();
      return;
    }
    const typed = input.value.trim();
    list.innerHTML = filtered.map((s, index) => descOptionHtml(list.id, s, index, s.label === typed)).join('');
    activeIndex = -1;
    input.removeAttribute('aria-activedescendant');
  };

  const open = () => {
    list.hidden = false;
    updateExpanded(true);
    renderOptions();
  };
  const close = ({ flush = true } = {}) => {
    const wasOpen = isOpen();
    list.hidden = true;
    updateExpanded(false);
    input.removeAttribute('aria-activedescendant');
    activeIndex = -1;
    if (wasOpen && flush) deferredFoodOrderRender.flush();
  };
  const selectSuggestion = (suggestion) => {
    input.value = suggestion.label;
    // "Übernehmen" also means the price: a description reused from a
    // suggestion carries the price it was last entered with, so re-adding
    // the same item never requires retyping it. Always sync the field to
    // the picked suggestion (clearing it when that suggestion has no
    // recorded price) rather than only ever filling it in - otherwise a
    // price auto-filled by an earlier pick could silently survive picking a
    // different, price-less suggestion afterwards.
    if (priceInput) {
      priceInput.value = suggestion.priceCents === null ? '' : (suggestion.priceCents / 100).toFixed(2).replace('.', ',');
    }
    close();
    input.focus();
  };

  toggle.addEventListener('click', () => {
    if (isOpen()) {
      close();
      input.focus();
      return;
    }
    open();
    input.focus();
  });
  input.addEventListener('input', () => {
    if (!isOpen()) open();
    else renderOptions();
  });
  input.addEventListener('keydown', (event) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (!isOpen()) {
        open();
        return;
      }
      if (filtered.length === 0) return;
      const direction = event.key === 'ArrowDown' ? 1 : -1;
      activeIndex =
        activeIndex === -1 ? (direction === 1 ? 0 : filtered.length - 1) : (activeIndex + direction + filtered.length) % filtered.length;
      updateActiveOption();
    } else if (event.key === 'Enter' && isOpen() && activeIndex >= 0) {
      event.preventDefault();
      selectSuggestion(filtered[activeIndex]);
    } else if (event.key === 'Escape' && isOpen()) {
      event.preventDefault();
      event.stopPropagation();
      close();
    } else if (event.key === 'Tab' && isOpen()) {
      close();
    }
  });
  list.addEventListener('pointermove', (event) => {
    const optionEl = event.target.closest('[data-desc-option-index]');
    if (!optionEl) return;
    const index = Number(optionEl.dataset.descOptionIndex);
    if (index === activeIndex) return;
    activeIndex = index;
    updateActiveOption();
  });
  list.addEventListener('click', (event) => {
    const optionEl = event.target.closest('[data-desc-option-index]');
    if (!optionEl) return;
    selectSuggestion(filtered[Number(optionEl.dataset.descOptionIndex)]);
  });
  wrapper.addEventListener('focusout', (event) => {
    if (!wrapper.contains(event.relatedTarget)) close();
  });
  // renderFoodOrders() rebuilds the whole card on every render (including
  // realtime updates from other players), so this wrapper is replaced far
  // more often than the shared search-select's own call sites. Without
  // deregistering here, every re-render would leave behind another
  // document-level listener for a detached wrapper - see searchSelect.js's
  // closeFromOutsidePointer for the same self-removing pattern.
  const closeFromOutsidePointer = (event) => {
    if (!wrapper.isConnected) {
      document.removeEventListener('pointerdown', closeFromOutsidePointer);
      return;
    }
    if (isOpen() && !wrapper.contains(event.target)) {
      close({ flush: false });
      deferredFoodOrderRender.deferAfterPointer(event.pointerId);
    }
  };
  document.addEventListener('pointerdown', closeFromOutsidePointer);
}

// Header actions of one order card: the next lock step as a compact neutral
// button, every further management action in the shared "Aktion" menu. Only
// the creator or an admin may manage an order (routes/foodOrders.ts).
function renderOrderActions(order, myId, { expanded = true } = {}) {
  const groupToggle = expanded ? renderGroupToggleAll(order) : '';
  if (!myId || (order.createdBy !== myId && !currentPlayerHasAdminRole())) {
    return groupToggle;
  }
  const finalized = Boolean(order.finalizedAt);
  const menuItem = (attr, label) => `<button type="button" class="btn btn-sm" ${attr}="${order.id}">${label}</button>`;
  let primary = '';
  const menu = [];
  if (groupToggle) menu.push(groupToggle);
  menu.push(menuItem('data-open-order-list', 'Bestellübersicht'));
  if (order.open) {
    primary = `<button type="button" class="btn btn-sm" data-close-order="${order.id}">Abschicken</button>`;
    menu.push(menuItem('data-edit-details', 'Info bearbeiten'));
  } else if (!finalized) {
    primary = `<button type="button" class="btn btn-sm" data-finalize-order="${order.id}">Schließen</button>`;
    menu.push(menuItem('data-reopen-order', 'Wieder öffnen'), menuItem('data-edit-details', 'Info bearbeiten'));
  } else {
    menu.push(menuItem('data-reopen-order', 'Wieder öffnen'));
  }
  menu.push(`<button type="button" class="btn btn-sm btn-danger" data-delete-order="${order.id}">Löschen</button>`);
  return `${primary}${actionMenuHtml(menu, `Aktionen für ${order.title}`, { key: `food-order-${order.id}` })}`;
}

function renderAddItemForm(order, myId) {
  if (!myId) return `<div class="muted" style="font-size:var(--font-size-sm);">Wähle oben, wer du bist, um dich einzutragen.</div>`;
  return `<form class="food-order-item-form" data-add-item-form="${order.id}">
      ${renderDescField(order)}
      <label class="food-order-quantity-field">
        <input type="number" class="food-order-quantity-input" data-item-quantity placeholder="Anzahl" min="1" max="99" inputmode="numeric" aria-label="Anzahl" />
      </label>
      <label class="food-order-price-field">
        <input type="text" class="food-order-price-input" data-item-price placeholder="Preis" inputmode="decimal" aria-label="Einzelpreis" />
        <span aria-hidden="true">€</span>
      </label>
      <button type="submit" class="btn btn-sm food-order-add-button">Hinzufügen</button>
    </form>`;
}

// Open, "Abgeschickt" (submitted) and "Geschlossen" (finalized) orders share
// one card. Submitted freezes the items for others but keeps paid status and
// metadata editable; finalized locks everything until "Wieder öffnen" steps
// back one level (Geschlossen -> Abgeschickt -> Offen). In Historie the state
// leads the meta line as text. Once more than one card shares a list, each
// card collapses to its header, meta and overview line.
function renderOrderCard(order, myId, { collapsible = false } = {}) {
  const finalized = Boolean(order.finalizedAt);
  const locked = !order.open && finalized;
  const itemsHtml = renderItems(order, myId, { locked });
  const expanded = !collapsible || (order.open ? expandedOpenOrders : expandedClosedOrders).has(order.id);
  const stateLabel = order.open ? null : finalized ? 'Geschlossen' : 'Abgeschickt';
  const titleHtml = `<strong class="food-order-card-title">${escapeHtml(order.title)}</strong>`;
  const headerLeft = collapsible
    ? `<button type="button" class="food-order-card-header-toggle" data-order-toggle="${order.id}" aria-expanded="${expanded ? 'true' : 'false'}" aria-controls="food-order-card-body-${order.id}" aria-label="Bestellung ${escapeHtml(order.title)} ${expanded ? 'einklappen' : 'ausklappen'}">
         ${icon('chevronRight', { className: 'food-order-card-chevron' })}
         ${titleHtml}
       </button>`
    : titleHtml;
  const actionsHtml = renderOrderActions(order, myId, { expanded });
  const tag = order.open ? 'div' : 'article';
  const dataAttr = order.open ? 'data-order-card' : 'data-closed-order';
  return `
    <${tag} class="card stack food-order-card${order.paypalLink ? ' has-paypal' : ''}" ${dataAttr}="${order.id}">
      <div class="food-order-card-header">
        ${headerLeft}
        ${actionsHtml ? `<span class="food-order-card-header-end">${actionsHtml}</span>` : ''}
      </div>
      <div class="food-order-card-lead">
        ${renderOrderMeta(order, stateLabel)}
        ${expanded ? renderDetails(order) : ''}
      </div>
      <div id="food-order-card-body-${order.id}" class="food-order-card-body stack" ${expanded ? '' : 'hidden'}>
        ${order.open ? renderAddItemForm(order, myId) : ''}
        <div class="food-order-items">${itemsHtml}</div>
        ${renderOrderSummary(order)}
      </div>
    </${tag}>`;
}

// Reusable confirmation dialog for the payment and delete flows that need a
// breakdown list of positions beside the message — built
// directly on openModal per modal.js's own guidance (no new component),
// mirroring confirmDialog's own title/one-sentence/Abbrechen-links/
// Bestätigen-rechts/focus-on-Abbrechen/Escape-cancels structure.
function confirmWithList(
  title,
  message,
  items,
  { note, copyValue = null, paypalValue = null, confirmText = 'Bestätigen', cancelText = 'Abbrechen', danger = false } = {}
) {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      resolve(result);
    };
    const listHtml = items.length
      ? `<ul class="food-order-confirm-list">${items
          .map(
            (i) =>
              `<li>${i.quantity ?? 1} × ${escapeHtml(i.description)}${i.amount ? `, ${escapeHtml(i.amount)}` : ''} <span class="muted">${escapeHtml(i.playerName)}</span></li>`,
          )
          .join('')}</ul>`
      : '';
    const copyActions = [
      copyValue ? { value: copyValue, label: 'Summe kopieren', kind: 'total' } : null,
      paypalValue ? { value: paypalValue, label: 'PayPal-Adresse kopieren', kind: 'paypal' } : null,
    ].filter(Boolean);
    const { close } = openModal(
      title,
      `
        <p style="margin:0 0 var(--space-3);">${escapeHtml(message)}</p>
        ${listHtml}
        ${copyActions.length
          ? `<div class="row" style="gap:var(--space-2);margin-top:var(--space-3);">${copyActions
              .map(
                (action) =>
                  `<button type="button" class="btn btn-sm" data-confirm-copy="${escapeHtml(action.value)}" data-confirm-copy-kind="${action.kind}">${icon('copy')} ${action.label}</button>`,
              )
              .join('')}</div>`
          : ''}
        ${note ? `<p class="muted" style="margin:var(--space-3) 0 0;">${escapeHtml(note)}</p>` : ''}
        <div class="row" style="gap:var(--space-2);justify-content:flex-end;margin-top:var(--space-4);">
          <button type="button" class="btn btn-sm btn-equal" data-confirm-cancel>${escapeHtml(cancelText)}</button>
          <button type="button" class="btn btn-sm btn-equal ${danger ? 'btn-danger' : 'btn-primary'}" data-confirm-ok>${escapeHtml(confirmText)}</button>
        </div>
      `,
      {
        onMount: (el) => {
          el.querySelectorAll('[data-confirm-copy]').forEach((copyButton) => {
            copyButton.addEventListener('click', () => {
              const value = copyButton.dataset.confirmCopy;
              if (!value) return;
              if (copyButton.dataset.confirmCopyKind === 'paypal') copyPaypalAddressToClipboard(value);
              else copyFoodOrderTotal(value);
            });
          });
          el.querySelector('[data-confirm-cancel]').addEventListener('click', () => {
            finish(false);
            close();
          });
          el.querySelector('[data-confirm-ok]').addEventListener('click', () => {
            finish(true);
            close();
          });
          el.querySelector('[data-confirm-cancel]').focus();
        },
        onClose: () => finish(false),
      }
    );
  });
}

// Group payment always works on a fresh list. This keeps the amount and paid
// state aligned with what is shown immediately before the PayPal handoff.
async function markGroupItemsPaid(orderId, playerId, itemIds, ctx) {
  let targets;
  if (!(await fetchFoodOrders(ctx))) return;
  const order = cache?.find((o) => o.id === orderId);
  if (!order) {
    showToast('Diese Bestellung existiert nicht mehr.', { error: true });
    ctx.rerender();
    return;
  }
  const groupItems = order.items.filter((i) => i.playerId === playerId);
  const missing = itemIds.some((id) => !groupItems.some((i) => i.id === id));
  if (missing) {
    showToast('Eine Position existiert nicht mehr. Bitte Betrag prüfen.', { error: true });
    ctx.rerender();
    return;
  }
  const alreadyPaid = itemIds.some((id) => groupItems.some((i) => i.id === id && i.paid));
  if (alreadyPaid) {
    showToast('Eine Position wurde inzwischen bereits als bezahlt markiert.', { error: true });
    ctx.rerender();
    return;
  }
  targets = groupItems.filter((i) => itemIds.includes(i.id) && !i.paid);
  try {
    // Invalidate GETs that may start while this PATCH is in flight. The
    // completion helper bumps the version once more before applying the
    // result to the current cache.
    const mutationWorkspaceVersion = foodOrderWorkspaceVersion;
    foodOrderScopeVersion += 1;
    await api.foodOrders.setGroupPaid(orderId, targets.map((item) => item.id), true);
    reconcileLocalPaidMutation(orderId, targets.map((item) => item.id), true, ctx, mutationWorkspaceVersion);
    showToast(`${targets.length} ${targets.length === 1 ? 'Position' : 'Positionen'} als bezahlt markiert.`);
  } catch (err) {
    showToast(err.message, { error: true });
    refreshFoodOrdersAfterMutationError(ctx);
  }
}

async function handleGroupPay(order, playerId, ctx) {
  const groupItems = order.items.filter((item) => item.playerId === playerId);
  if (groupItems.length === 0 || !order.paypalLink) return;

  const initialItemIds = groupItems.map((item) => item.id);
  const initialUnpaidItemIds = groupItems.filter((item) => !item.paid).map((item) => item.id);
  const email = paypalEmailFromLink(order.paypalLink);
  const popup = window.open('', '_blank');
  if (popup) popup.opener = null;
  if (email) copyPaypalEmailToClipboard(email);

  let freshOrder;
  let items;
  if (!(await fetchFoodOrders(ctx))) {
    popup?.close();
    return;
  }
  freshOrder = cache?.find((candidate) => candidate.id === order.id);
  if (!freshOrder) {
    popup?.close();
    showToast('Diese Bestellung existiert nicht mehr.', { error: true });
    ctx.rerender();
    return;
  }
  if (freshOrder.finalizedAt) {
    popup?.close();
    showToast('Bestellung geschlossen, keine Änderungen mehr möglich.', { error: true });
    ctx.rerender();
    return;
  }
  const freshGroupItems = freshOrder.items.filter((item) => item.playerId === playerId);
  if (initialItemIds.some((id) => !freshGroupItems.some((item) => item.id === id))) {
    popup?.close();
    showToast('Eine Position existiert nicht mehr. Bitte Betrag prüfen.', { error: true });
    ctx.rerender();
    return;
  }
  // The handoff always charges the complete current sum for this person,
  // including already-paid positions and positions added while PayPal was
  // opening. Only the follow-up mark-paid mutation below remains limited to
  // positions that are still open.
  items = freshGroupItems;

  if (initialUnpaidItemIds.some((id) => freshGroupItems.some((item) => item.id === id && item.paid))) {
    popup?.close();
    showToast('Diese Person wurde inzwischen bereits als bezahlt markiert.', { error: true });
    ctx.rerender();
    return;
  }
  if (!freshOrder.paypalLink) {
    popup?.close();
    showToast('Für diese Bestellung ist kein PayPal-Link mehr hinterlegt.', { error: true });
    ctx.rerender();
    return;
  }
  if (items.some((item) => item.priceCents === null)) {
    popup?.close();
    showToast('Betrag unvollständig, erst alle Preise eintragen.', { error: true });
    ctx.rerender();
    return;
  }

  const tipPercent = freshOrder.tipPercent || 0;
  const payableCents = items.reduce((sum, item) => sum + lineTotalCents(item, tipPercent), 0);
  const payUrl = paypalPayUrl(freshOrder.paypalLink, payableCents);
  const amountPassedToPaypal = payUrl !== freshOrder.paypalLink;
  if (popup) popup.location = payUrl;
  else window.open(payUrl, '_blank', 'noopener');

  const confirmed = await confirmWithList(
    'Bezahlt?',
    amountPassedToPaypal
      ? `${formatCents(payableCents)} für ${items[0].playerName} an PayPal übergeben (paypal.me).`
      : `PayPal geöffnet. Die Summe ${formatCents(payableCents)} für ${items[0].playerName} wird dort nicht vorausgefüllt.`,
    items.map((item) => ({ ...item, amount: formatCents(lineTotalCents(item, tipPercent)) })),
    {
      copyValue: formatCents(payableCents),
      paypalValue: paypalEmailFromLink(freshOrder.paypalLink) ?? freshOrder.paypalLink,
      confirmText: 'Ja, bezahlt',
      cancelText: 'Noch nicht',
    },
  );
  if (!confirmed) {
    ctx.rerender();
    return;
  }
  await markGroupItemsPaid(order.id, playerId, items.filter((item) => !item.paid).map((item) => item.id), ctx);
}

async function handleGroupPaid(orderId, playerId, paid, ctx) {
  if (!(await fetchFoodOrders(ctx))) return;
  const order = cache?.find((candidate) => candidate.id === orderId);
  const items = order?.items.filter((item) => item.playerId === playerId) ?? [];
  if (!order || items.length === 0) {
    showToast('Diese Personengruppe existiert nicht mehr.', { error: true });
    ctx.rerender();
    return;
  }
  const targets = items.filter((item) => item.paid !== paid);
  if (targets.length === 0) return;
  try {
    const mutationWorkspaceVersion = foodOrderWorkspaceVersion;
    foodOrderScopeVersion += 1;
    await api.foodOrders.setGroupPaid(orderId, targets.map((item) => item.id), paid);
    reconcileLocalPaidMutation(orderId, targets.map((item) => item.id), paid, ctx, mutationWorkspaceVersion);
    showToast(paid ? `${items[0].playerName} als bezahlt markiert.` : `${items[0].playerName} wieder als offen markiert.`);
  } catch (err) {
    showToast(err.message, { error: true });
    refreshFoodOrdersAfterMutationError(ctx);
  }
}

// --- AP4: consolidated order list -----------------------------------------

// Distinct descriptions already entered in this order, for the add-item
// field's suggestion dropdown: same normalized-description dedup as
// buildConsolidatedRows, keeping the first-seen original spelling (and the
// price it was entered with, if any) so picking a suggestion reuses both the
// exact wording the consolidated list already keys on and its price, without
// retyping either. Sorted with the German locale like the consolidated list
// itself.
// AP4.2: groups by normalized description + exact unit price; same name at
// a different price stays its own row (merging it would silently
// undercount or overcount that row's total).
function consolidatedTotals(items, tipPercent) {
  const pricedItems = items.filter((item) => item.priceCents !== null);
  const incomplete = items.length > pricedItems.length;
  const subtotalCents = pricedItems.reduce((sum, item) => sum + item.priceCents * (item.quantity ?? 1), 0);
  const totalCents = sumLineTotals(items, tipPercent);
  return { incomplete, subtotalCents, totalCents };
}

function renderConsolidatedListBody(order) {
  const rows = buildConsolidatedRows(order.items);
  const tipPercent = order.tipPercent || 0;
  const { incomplete, subtotalCents, totalCents } = consolidatedTotals(order.items, tipPercent);
  const missing = incomplete ? missingPriceLabel(order.items) : null;
  const rowsHtml = rows
    .map(
      (r) => `
        <tr>
          <td class="food-order-consolidated-row-desc">${r.quantity} × ${escapeHtml(r.description)}</td>
          <td class="muted">${r.priceCents === null ? 'Preis fehlt' : formatCents(r.priceCents)}</td>
          <td>${r.priceCents === null ? '' : formatCents(r.priceCents * r.quantity)}</td>
        </tr>`
    )
    .join('');
  const tableHtml = rows.length
    ? `<div class="food-order-consolidated-rows">
        <table class="food-order-consolidated-table">
          <thead><tr><th scope="col">Gericht</th><th scope="col">Einzeln</th><th scope="col">Summe</th></tr></thead>
          <tbody>${rowsHtml}</tbody>
          <tfoot>
            <tr><th scope="row" colspan="2">Zwischensumme</th><td>${formatCents(subtotalCents)}</td></tr>
            ${tipPercent > 0 ? `<tr class="muted"><th scope="row" colspan="2">${tipPercent} % Trinkgeld</th><td>${formatCents(totalCents - subtotalCents)}</td></tr>` : ''}
            <tr class="food-order-consolidated-total"><th scope="row" colspan="2">Gesamt${missing ? ` <span class="muted food-order-total-note">${missing}</span>` : ''}</th><td>${formatCents(totalCents)}</td></tr>
          </tfoot>
        </table>
      </div>`
    : emptyStateHtml('Noch keine Positionen.');
  return `
    ${tableHtml}
    ${
      order.open && order.createdByCurrentUser
        ? `<div class="food-order-form-footer">
             <button type="button" class="btn btn-primary btn-sm" data-close-order-from-list="${order.id}">Bestellung abschicken</button>
           </div>`
        : ''
    }`;
}

function wireConsolidatedListActions(el, order) {
  el.querySelector('[data-close-order-from-list]')?.addEventListener('click', async () => {
    if (!(await confirmDialog('Bestellung abschicken? Danach kann niemand mehr etwas eintragen.', { confirmText: 'Abschicken' }))) return;
    const ctx = consolidatedListDialog?.ctx;
    try {
      const mutationWorkspaceVersion = foodOrderWorkspaceVersion;
      const updatedOrder = await api.foodOrders.close(order.id);
      showToast('Bestellung abgeschickt.');
      if (ctx) reconcileLocalOrderMutation(updatedOrder, ctx, mutationWorkspaceVersion);
    } catch (err) {
      showToast(err.message, { error: true });
      if (ctx) refreshFoodOrdersAfterMutationError(ctx);
    }
  });
}

// AP4.1/AP4.7: opens the dialog and keeps a reference so renderFoodOrders
// can refresh its content on every live re-render while it stays open.
function openConsolidatedListDialog(order, myId, ctx) {
  const orderWithFlag = { ...order, createdByCurrentUser: order.createdBy === myId };
  const { el, close } = openModal(
    `Bestellübersicht: ${order.title}`,
    `<div data-consolidated-body>${renderConsolidatedListBody(orderWithFlag)}</div>`,
    {
      onMount: (mountEl) => {
        consolidatedListDialog = { orderId: order.id, el: mountEl, ctx };
        wireConsolidatedListActions(mountEl, orderWithFlag);
      },
      onClose: () => {
        consolidatedListDialog = null;
      },
    }
  );
  return { el, close };
}

// Called at the end of every render pass so the open Bestellübersicht dialog
// (if any) reflects the latest realtime state instead of freezing at the
// moment it was opened.
function refreshConsolidatedListDialog(myId) {
  if (!consolidatedListDialog) return;
  const order = (cache || []).find((o) => o.id === consolidatedListDialog.orderId);
  if (!order) return;
  const orderWithFlag = { ...order, createdByCurrentUser: order.createdBy === myId };
  const body = consolidatedListDialog.el.querySelector('[data-consolidated-body]');
  if (!body) return;
  body.innerHTML = renderConsolidatedListBody(orderWithFlag);
  wireConsolidatedListActions(consolidatedListDialog.el, orderWithFlag);
}

// --- forms -----------------------------------------------------------------

function openNewOrderForm(ctx, myId) {
  let modalEl;
  const { close } = openModal(
    'Neue Sammelbestellung',
    `
      <form id="order-form" class="stack">
        <div>
          <label for="order-title" class="field-label is-required">Titel</label>
          <input type="text" id="order-title" maxlength="80" required autofocus placeholder="Pizza bei Luigi's" />
        </div>
        <div>
          <label for="order-sendat-date" class="field-label">Versand</label>
          ${dateTimeFieldHtml('order-sendat', null, { clearable: true, label: 'Versand' })}
        </div>
        <div>
          <label for="order-notes" class="field-label">Info</label>
          <textarea id="order-notes" rows="1" maxlength="500" placeholder="Mindestbestellwert 15 €"></textarea>
        </div>
        <div>
          <label for="order-link" class="field-label">Speisekarte</label>
          <input type="url" id="order-link" maxlength="300" placeholder="https://" />
        </div>
        <div>
          <div class="food-order-paypal-label">
            <label for="order-paypal" class="field-label">PayPal</label>
            ${infoTooltipHtml(
              'order-paypal-help',
              'PayPal',
              'E-Mail-Adresse oder vollständigen PayPal.me-Link einfügen. Bei einer E-Mail-Adresse wird sie beim Öffnen von PayPal kopiert; ein Betrag kann nur beim PayPal.me-Link vorausgefüllt werden.',
            )}
          </div>
          <input type="text" id="order-paypal" maxlength="300" placeholder="https://paypal.me/luigi" />
        </div>
        <div>
          <label for="order-tip" class="field-label">Trinkgeld in %</label>
          <input type="number" id="order-tip" min="0" max="100" inputmode="numeric" placeholder="10" />
        </div>
        <div class="food-order-form-footer"><button type="submit" class="btn btn-primary btn-sm">Bestellung öffnen</button></div>
      </form>
    `,
    {
      confirmClose: () => {
        if (!modalEl) return null;
        const values = ['#order-title', '#order-notes', '#order-link', '#order-paypal', '#order-tip', '#order-sendat'].map(
          (sel) => modalEl.querySelector(sel).value.trim(),
        );
        return values.some(Boolean)
          ? 'Die neue Sammelbestellung mit allen eingegebenen Angaben (Titel, Speisekarte, PayPal, Trinkgeld …) geht verloren.'
          : null;
      },
      onMount: (el) => {
        modalEl = el;
        wireDateTimeField(el, 'order-sendat');
        wireInfoTooltips(el);
        el.querySelector('#order-form').addEventListener('submit', async (e) => {
          e.preventDefault();
          const title = el.querySelector('#order-title').value.trim();
          if (!title) return;
          const sendAtRaw = el.querySelector('#order-sendat').value;
          const sendAt = sendAtRaw ? new Date(sendAtRaw).getTime() : undefined;
          const notes = el.querySelector('#order-notes').value.trim() || undefined;
          const linkRaw = el.querySelector('#order-link').value.trim();
          if (linkRaw && !/^https?:\/\//i.test(linkRaw)) {
            return showToast('Die Speisekarten-Adresse muss mit http:// oder https:// beginnen.', { error: true });
          }
          const link = linkRaw || undefined;
          let paypalLink;
          try {
            paypalLink = normalizePaypalInput(el.querySelector('#order-paypal').value) ?? undefined;
          } catch (err) {
            return showToast(err.message, { error: true });
          }
          const tipRaw = el.querySelector('#order-tip').value.trim();
          if (tipRaw && (!/^\d+$/.test(tipRaw) || Number(tipRaw) > 100)) {
            return showToast('Trinkgeld muss zwischen 0 und 100 Prozent liegen.', { error: true });
          }
          const tipPercent = tipRaw ? Number(tipRaw) : undefined;
          try {
            const mutationWorkspaceVersion = foodOrderWorkspaceVersion;
            const createdOrder = await api.foodOrders.create(myId, title, { sendAt, notes, link, paypalLink, tipPercent });
            close();
            showToast('Bestellung geöffnet, alle wurden benachrichtigt.');
            reconcileLocalOrderMutation(createdOrder, ctx, mutationWorkspaceVersion);
          } catch (err) {
            showToast(err.message, { error: true });
            refreshFoodOrdersAfterMutationError(ctx);
          }
        });
      },
    }
  );
}

function openDetailsForm(ctx, order) {
  let modalEl;
  const { close } = openModal(
    'Info bearbeiten',
    `
      <form id="details-form" class="stack">
        <div>
          <label for="sendat-input-date" class="field-label">Versand</label>
          ${dateTimeFieldHtml('sendat-input', order.sendAt, { clearable: true, label: 'Versand' })}
        </div>
        <div>
          <label for="notes-input" class="field-label">Info</label>
          <textarea id="notes-input" rows="1" maxlength="500" placeholder="Mindestbestellwert 15 €">${escapeHtml(order.notes ?? '')}</textarea>
        </div>
        <div>
          <label for="link-input" class="field-label">Speisekarte</label>
          <input type="url" id="link-input" maxlength="300" placeholder="https://" value="${escapeHtml(order.link ?? '')}" />
        </div>
        <div>
          <div class="food-order-paypal-label">
            <label for="paypal-input" class="field-label">PayPal</label>
            ${infoTooltipHtml(
              'paypal-input-help',
              'PayPal',
              'E-Mail-Adresse oder vollständigen PayPal.me-Link einfügen. Bei einer E-Mail-Adresse wird sie beim Öffnen von PayPal kopiert; ein Betrag kann nur beim PayPal.me-Link vorausgefüllt werden.',
            )}
          </div>
          <input type="text" id="paypal-input" maxlength="300" placeholder="https://paypal.me/luigi" value="${escapeHtml(paypalEmailFromLink(order.paypalLink) ?? order.paypalLink ?? '')}" />
        </div>
        <div>
          <label for="tip-input" class="field-label">Trinkgeld in %</label>
          <input type="number" id="tip-input" min="0" max="100" inputmode="numeric" placeholder="10" value="${order.tipPercent ?? ''}" />
        </div>
        <div class="food-order-form-footer"><button type="submit" class="btn btn-primary btn-sm">Speichern</button></div>
      </form>
    `,
    {
      confirmClose: () => {
        if (!modalEl) return null;
        const notes = modalEl.querySelector('#notes-input').value.trim();
        const link = modalEl.querySelector('#link-input').value.trim();
        const paypal = modalEl.querySelector('#paypal-input').value.trim();
        const tip = modalEl.querySelector('#tip-input').value.trim();
        const sendAt = modalEl.querySelector('#sendat-input').value;
        const dirty =
          notes !== (order.notes ?? '') ||
          link !== (order.link ?? '') ||
          paypal !== (paypalEmailFromLink(order.paypalLink) ?? order.paypalLink ?? '') ||
          tip !== String(order.tipPercent ?? '') ||
          Boolean(sendAt) !== Boolean(order.sendAt);
        return dirty ? 'Deine Änderungen an Info, Speisekarte, PayPal oder Trinkgeld werden nicht gespeichert.' : null;
      },
      onMount: (el) => {
        modalEl = el;
        wireDateTimeField(el, 'sendat-input');
        wireInfoTooltips(el);
        el.querySelector('#details-form').addEventListener('submit', async (e) => {
          e.preventDefault();
          const sendAtRaw = el.querySelector('#sendat-input').value;
          const sendAt = sendAtRaw ? new Date(sendAtRaw).getTime() : null;
          const notes = el.querySelector('#notes-input').value.trim() || null;
          const linkRaw = el.querySelector('#link-input').value.trim();
          if (linkRaw && !/^https?:\/\//i.test(linkRaw)) {
            return showToast('Die Speisekarten-Adresse muss mit http:// oder https:// beginnen.', { error: true });
          }
          const link = linkRaw || null;
          let paypalLink;
          try {
            paypalLink = normalizePaypalInput(el.querySelector('#paypal-input').value);
          } catch (err) {
            return showToast(err.message, { error: true });
          }
          const tipRaw = el.querySelector('#tip-input').value.trim();
          if (tipRaw && (!/^\d+$/.test(tipRaw) || Number(tipRaw) > 100)) {
            return showToast('Trinkgeld muss zwischen 0 und 100 Prozent liegen.', { error: true });
          }
          const tipPercent = tipRaw ? Number(tipRaw) : null;
          try {
            const mutationWorkspaceVersion = foodOrderWorkspaceVersion;
            const updatedOrder = await api.foodOrders.updateDetails(order.id, { sendAt, notes, link, paypalLink, tipPercent });
            close();
            showToast('Gespeichert.');
            reconcileLocalOrderMutation(updatedOrder, ctx, mutationWorkspaceVersion);
          } catch (err) {
            showToast(err.message, { error: true });
            refreshFoodOrdersAfterMutationError(ctx);
          }
        });
      },
    }
  );
}

export function renderFoodOrders(container, ctx) {
  if (deferredFoodOrderRender.deferIfNeeded(container, ctx)) return;

  if (cache === null && !loading) load(ctx);

  const myId = getMyId();

  const renderState = captureFoodOrderViewState(container);
  const orders = cache || [];
  const openOrders = orders.filter((o) => o.open);
  const closedOrders = orders.filter((o) => !o.open);

  // Open-order cards become collapsible only once there is more than one of
  // them. At that first multi-card render, start them all collapsed, except
  // for a requested search/push target which must be visible immediately.
  if (cache !== null && openOrders.length > 1 && !orderStartRuleApplied) {
    orderStartRuleApplied = true;
    expandedOpenOrders.clear();
  }
  // Same rule, mirrored for Historie entries.
  if (cache !== null && closedOrders.length > 1 && !closedOrderStartRuleApplied) {
    closedOrderStartRuleApplied = true;
    expandedClosedOrders.clear();
  }

  // A direct search/push/Home target must be visible regardless of whether
  // the order is still open or already lives in the collapsed history.
  if (cache !== null && pendingOrderTargetId) {
    const targetOrder = orders.find((order) => order.id === pendingOrderTargetId);
    if (targetOrder?.open && openOrders.length > 1) expandedOpenOrders.add(targetOrder.id);
    if (targetOrder && !targetOrder.open) {
      historyOpen = true;
      if (closedOrders.length > 1) expandedClosedOrders.add(targetOrder.id);
    }
    pendingOrderTargetId = null;
  }

  const openHtml =
    loading || cache === null
      ? emptyStateHtml('Lädt…')
      : openOrders.length === 0
        ? emptyStateHtml('Noch keine Bestellungen.')
        : `<div class="two-column-card-grid food-order-grid">${openOrders
            .map((o) => renderOrderCard(o, myId, { collapsible: openOrders.length > 1 }))
            .join('')}</div>`;

  // Replacing innerHTML momentarily drops all children, which clamps this
  // scrollable container's own scrollTop to 0 - restoring it below is what
  // keeps e.g. marking several positions paid in a row from jumping the
  // whole view back to the top after every single toggle.
  container.innerHTML = `
    <h1 class="view-title">Essen</h1>
    <div class="grouped-page-sections">
      <section class="card stack grouped-page-section primary-collection-section food-order-open-section" aria-labelledby="food-open-title">
        <div class="grouped-page-section-title">
          <h2 id="food-open-title">Offene Bestellungen</h2>
          <button type="button" class="btn btn-primary btn-sm" id="order-new-btn" ${myId ? '' : 'disabled'}>Bestellung öffnen</button>
        </div>
        ${openHtml}
      </section>
      ${
        closedOrders.length
          ? `<details class="card grouped-page-section collapsible-section" data-food-history="history" ${historyOpen ? 'open' : ''}>
               <summary class="collapsible-section-header">
                 <h2>Historie</h2>
                 <span class="collapsible-section-summary-end">
                   <span class="badge badge-offline">${closedOrders.length}</span>
                   <span class="collapsible-section-chevron">${icon('chevronRight')}</span>
                 </span>
               </summary>
               <div class="collapsible-section-content">
                 <div class="two-column-card-grid food-order-grid">${closedOrders.map((o) => renderOrderCard(o, myId, { collapsible: closedOrders.length > 1 })).join('')}</div>
               </div>
             </details>`
          : ''
      }
    </div>
  `;
  restoreFoodOrderViewport(container, renderState);

  wireInfoTooltips(container);
  wireActionMenus(container);
  restoreFoodOrderDrafts(container, renderState);

  container.querySelectorAll('[data-desc-suggest]').forEach((wrapper) => wireDescSuggest(wrapper));

  container.querySelector('#order-new-btn').addEventListener('click', () => {
    if (!myId) return showToast('Bitte zuerst auswählen, wer du bist.', { error: true });
    openNewOrderForm(ctx, myId);
  });

  container.querySelectorAll('[data-add-item-form]').forEach((form) => {
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const orderId = form.dataset.addItemForm;
      const descInput = form.querySelector('[data-item-desc]');
      const quantityInput = form.querySelector('[data-item-quantity]');
      const priceInput = form.querySelector('[data-item-price]');
      const description = descInput.value.trim();
      if (!description) return;
      const quantity = Number(quantityInput.value);
      if (!Number.isInteger(quantity) || quantity < 1 || quantity > 99) {
        return showToast('Anzahl muss zwischen 1 und 99 liegen.', { error: true });
      }
      const priceCents = parsePriceToCents(priceInput.value);
      if (Number.isNaN(priceCents)) {
        return showToast('Preis bitte als Betrag angeben, etwa 4,50', { error: true });
      }
      const submitBtn = form.querySelector('button[type="submit"]');
      if (submitBtn.disabled) return;
      // A submit started by the pointer interaction that just closed the
      // dropdown will reconcile and render from its own response. Do not let
      // the older deferred background render replace the form mid-request.
      deferredFoodOrderRender.clear(container);
      submitBtn.disabled = true;
      try {
        const mutationWorkspaceVersion = foodOrderWorkspaceVersion;
        const updatedOrder = await api.foodOrders.addItem(orderId, { playerId: myId, description, quantity, priceCents: priceCents ?? undefined });
        descInput.value = '';
        quantityInput.value = '';
        priceInput.value = '';
        // AP3.8: adding an own position forces the own group open again, in
        // case it had been collapsed.
        const set = expandedGroups.get(orderId) ?? new Set();
        set.add(myId);
        expandedGroups.set(orderId, set);
        reconcileLocalOrderMutation(updatedOrder, ctx, mutationWorkspaceVersion);
      } catch (err) {
        submitBtn.disabled = false;
        showToast(err.message, { error: true });
        refreshFoodOrdersAfterMutationError(ctx);
      }
    });
  });

  container.querySelectorAll('[data-remove-item]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const order = cache?.find((o) => o.id === btn.dataset.order);
      const item = order?.items.find((i) => i.id === btn.dataset.removeItem);
      const title = item ? `${item.quantity ?? 1} × ${item.description} löschen?` : 'Position löschen?';
      if (!(await confirmDialog('Lässt sich nicht rückgängig machen.', { title, confirmText: 'Löschen', danger: true }))) return;
      try {
        const mutationWorkspaceVersion = foodOrderWorkspaceVersion;
        const updatedOrder = await api.foodOrders.removeItem(btn.dataset.order, btn.dataset.removeItem, myId);
        reconcileLocalOrderMutation(updatedOrder, ctx, mutationWorkspaceVersion);
      } catch (err) {
        showToast(err.message, { error: true });
        refreshFoodOrdersAfterMutationError(ctx);
      }
    });
  });

  container.querySelectorAll('[data-group-toggle]').forEach((button) => {
    button.addEventListener('click', () => {
      const orderId = button.dataset.order;
      const playerId = button.dataset.groupToggle;
      const set = expandedGroups.get(orderId) ?? new Set();
      if (set.has(playerId)) set.delete(playerId);
      else set.add(playerId);
      expandedGroups.set(orderId, set);
      ctx.rerender();
    });
  });

  container.querySelectorAll('[data-toggle-all-groups]').forEach((button) => {
    button.addEventListener('click', () => {
      const orderId = button.dataset.toggleAllGroups;
      const order = cache?.find((o) => o.id === orderId);
      if (!order) return;
      const grouped = itemsGroupedByPlayer(order);
      const expandedSet = expandedGroups.get(orderId) ?? new Set();
      const allExpanded = [...grouped.keys()].every((playerId) => expandedSet.has(playerId));
      expandedGroups.set(orderId, allExpanded ? new Set() : new Set(grouped.keys()));
      ctx.rerender();
    });
  });

  container.querySelectorAll('[data-toggle-group-paid]').forEach((button) => {
    button.addEventListener('click', () => {
      const order = cache?.find((candidate) => candidate.id === button.dataset.order);
      if (!order) return;
      const paid = button.getAttribute('aria-pressed') !== 'true';
      button.disabled = true;
      handleGroupPaid(order.id, button.dataset.toggleGroupPaid, paid, ctx).finally(() => {
        button.disabled = false;
      });
    });
  });

  container.querySelectorAll('[data-group-pay]').forEach((button) => {
    button.addEventListener('click', () => {
      const order = cache?.find((candidate) => candidate.id === button.dataset.order);
      if (!order) return;
      button.disabled = true;
      handleGroupPay(order, button.dataset.groupPay, ctx).finally(() => {
        button.disabled = false;
      });
    });
  });

  container.querySelectorAll('[data-order-toggle]').forEach((button) => {
    button.addEventListener('click', () => {
      const orderId = button.dataset.orderToggle;
      const order = orders.find((o) => o.id === orderId);
      const set = order?.open ? expandedOpenOrders : expandedClosedOrders;
      if (set.has(orderId)) set.delete(orderId);
      else set.add(orderId);
      ctx.rerender();
    });
  });

  container.querySelectorAll('[data-open-order-list]').forEach((button) => {
    button.addEventListener('click', () => {
      const order = orders.find((o) => o.id === button.dataset.openOrderList);
      if (order) openConsolidatedListDialog(order, myId, ctx);
    });
  });

  container.querySelectorAll('[data-copy-food-total]').forEach((button) => {
    button.addEventListener('click', () => copyFoodOrderTotal(button.dataset.copyFoodTotal));
  });

  container.querySelector('[data-food-history]')?.addEventListener('toggle', (event) => {
    historyOpen = event.currentTarget.open;
  });

  container.querySelectorAll('[data-edit-details]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const order = orders.find((o) => o.id === btn.dataset.editDetails);
      if (order) openDetailsForm(ctx, order);
    });
  });

  container.querySelectorAll('[data-close-order]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      if (!(await confirmDialog('Bestellung abschicken? Danach kann niemand mehr etwas eintragen.', { confirmText: 'Abschicken' }))) return;
      try {
        const mutationWorkspaceVersion = foodOrderWorkspaceVersion;
        const updatedOrder = await api.foodOrders.close(btn.dataset.closeOrder);
        showToast('Bestellung abgeschickt.');
        reconcileLocalOrderMutation(updatedOrder, ctx, mutationWorkspaceVersion);
      } catch (err) {
        showToast(err.message, { error: true });
        refreshFoodOrdersAfterMutationError(ctx);
      }
    });
  });

  container.querySelectorAll('[data-reopen-order]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      // Reopening steps back exactly one lock level per request (see the route
      // comment in routes/foodOrders.ts); disabling here stops a fast double-
      // click/tap from firing a second request before the first response
      // re-renders this button, which would otherwise skip a level.
      btn.disabled = true;
      try {
        const mutationWorkspaceVersion = foodOrderWorkspaceVersion;
        const updatedOrder = await api.foodOrders.reopen(btn.dataset.reopenOrder);
        showToast(updatedOrder.open ? 'Bestellung wieder geöffnet.' : 'Bestellung wieder freigegeben (Abgeschickt).');
        reconcileLocalOrderMutation(updatedOrder, ctx, mutationWorkspaceVersion);
      } catch (err) {
        showToast(err.message, { error: true });
        refreshFoodOrdersAfterMutationError(ctx);
      } finally {
        btn.disabled = false;
      }
    });
  });

  container.querySelectorAll('[data-finalize-order]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      if (
        !(await confirmDialog(
          'Bestellung schließen? Danach sind keine Änderungen mehr möglich, bis sie wieder geöffnet wird.',
          { confirmText: 'Schließen' }
        ))
      )
        return;
      try {
        const mutationWorkspaceVersion = foodOrderWorkspaceVersion;
        const updatedOrder = await api.foodOrders.finalize(btn.dataset.finalizeOrder);
        showToast('Bestellung geschlossen.');
        reconcileLocalOrderMutation(updatedOrder, ctx, mutationWorkspaceVersion);
      } catch (err) {
        showToast(err.message, { error: true });
        refreshFoodOrdersAfterMutationError(ctx);
      }
    });
  });

  container.querySelectorAll('[data-delete-order]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      if (!(await confirmDialog('Bestellung endgültig löschen? Alle eingetragenen Positionen gehen dabei verloren.', { confirmText: 'Löschen', danger: true }))) return;
      try {
        const mutationWorkspaceVersion = foodOrderWorkspaceVersion;
        await api.foodOrders.remove(btn.dataset.deleteOrder);
        showToast('Bestellung gelöscht.');
        reconcileLocalOrderRemoval(btn.dataset.deleteOrder, ctx, mutationWorkspaceVersion);
      } catch (err) {
        showToast(err.message, { error: true });
        refreshFoodOrdersAfterMutationError(ctx);
      }
    });
  });

  restoreFoodOrderFocus(container, renderState);
  refreshConsolidatedListDialog(myId);
}
