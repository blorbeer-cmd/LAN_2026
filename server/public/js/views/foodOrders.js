// "Essen bestellen" view: Sammelbestellungen. Someone opens an order
// ("Pizza bei Luigi's"), everyone adds their own items (free text, price
// optional) from their own phone. Submitting it ("Abgeschickt") freezes the
// item list into a read-out view grouped per person — the "wer wollte
// nochmal was?" round through the room becomes one glance at the screen —
// but stays reversible: the creator/an admin can reopen it to add a
// forgotten item or fix a price, and paid status/metadata stay editable
// throughout. Only once they close it for good ("Geschlossen") does it lock
// permanently.
//
// Payment goes exclusively through the Warenkorb (cart): positions are
// picked into it (per item or per orderer group), paid together via one
// PayPal link and marked paid as one batch — see docs/plans/
// food-order-cart-concept.md for the full rationale.

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

let cache = null;
let loading = false;
let historyOpen = false;
// Item ids picked into the Warenkorb (cart) — deliberately not tied to who
// added the item: anyone can pick any mix of items across the whole order
// and pay them together. Purely a local UI selection (never sent to the
// server), so it survives re-renders but resets on page reload.
const cartItemIds = new Set();

// Orderer-group expand/collapse state, per Arbeitspaket 3: `orderId ->
// Set<playerId>` of currently expanded groups. Deliberately module state,
// not persisted (same pattern as cartItemIds) — see AP3.7: the start rule
// below runs at most once per order and session, afterwards the state
// belongs to the user and must survive realtime re-renders untouched.
const expandedGroups = new Map();
const groupStartRuleApplied = new Set();

// Whole-order collapse state, only meaningful once more than one order is
// open at a time (see renderOpenOrder's `collapsible` param): orderId ->
// collapsed. A single open order gets no collapse chrome at all, same
// precedent as ensureGroupStartRule's single-group case. Not persisted
// beyond the session, same as the other module-level UI state here.
const collapsedOpenOrders = new Set();

// The consolidated-list dialog (AP4.7) keeps updating while it's open, so a
// live re-render of the underlying view needs to be able to refresh it too.
let consolidatedListDialog = null; // { orderId, el, ctx } | null

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
let fetchInFlight = false;
let refetchPending = false;

async function fetchFoodOrders(ctx) {
  if (fetchInFlight) {
    refetchPending = true;
    return;
  }
  fetchInFlight = true;
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
    try {
      const res = await api.foodOrders.list();
      cache = res.orders;
    } catch (err) {
      showToast(err.message, { error: true });
      if (showPlaceholder) cache = [];
    } finally {
      if (showPlaceholder) loading = false;
      ctx.rerender();
    }
  } while (refetchPending);
  fetchInFlight = false;
}

async function load(ctx) {
  return fetchFoodOrders(ctx);
}

// Called from app.js on every foodOrders:changed socket event for a device
// that isn't currently looking at this view - the next time it opens Essen,
// load() runs its normal first-load fetch.
export function invalidateFoodOrders() {
  cache = null;
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

// "4,50" / "4.50" / "4" -> 450 cents; null for empty, NaN for garbage.
export function parsePriceToCents(raw) {
  const trimmed = (raw || '').trim().replace('€', '').trim();
  if (!trimmed) return null;
  const normalized = trimmed.replace(',', '.');
  const value = Number(normalized);
  if (!Number.isFinite(value) || value < 0) return NaN;
  return Math.round(value * 100);
}

const euroFormatter = new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' });

function formatCents(cents) {
  return euroFormatter.format(cents / 100);
}

async function copyFoodOrderTotal(value) {
  if (!navigator.clipboard?.writeText) {
    showToast('Kopieren ist in diesem Browser nicht verfügbar.', { error: true });
    return;
  }
  try {
    await navigator.clipboard.writeText(value);
    showToast(`Summe kopiert: ${value}`);
  } catch {
    showToast('Summe konnte nicht kopiert werden.', { error: true });
  }
}

// PayPal has no link that pre-fills a recipient by email, so these links
// only open PayPal's generic "send money" page - copying the address here is
// what saves the actual step of typing it in by hand.
function copyPaypalEmailToClipboard(email) {
  navigator.clipboard?.writeText(email).then(
    () => showToast(`E-Mail-Adresse kopiert: ${email}`),
    () => {}
  );
}

export function addTipToCents(cents, tipPercent) {
  return Math.round(cents * (1 + (tipPercent || 0) / 100));
}

// Turns a stored PayPal(.me) link into a payable one: a bare
// "paypal.me/name" link gets the exact owed amount appended so paying is one
// tap; anything else (already has a path/amount, or some other payment page
// entirely) opens unchanged rather than risk mangling a URL the creator
// typed on purpose.
export function paypalPayUrl(paypalLink, cents) {
  const bareMatch = paypalLink.match(/^(https?:\/\/(?:www\.)?paypal\.me\/[^/?#]+)\/?$/i);
  if (bareMatch && cents > 0) {
    return `${bareMatch[1]}/${(cents / 100).toFixed(2)}EUR`;
  }
  return paypalLink;
}

// PayPal has no public URL that pre-fills a payment's recipient by email
// (the old cmd=_send-money trick is long dead) — so an email address can't
// become a one-tap payment link the way a paypal.me name can. The best we
// can do is send people to PayPal's generic "send money" page and put the
// address on the clipboard so they only have to paste it. The email is
// tucked into the (otherwise unused by PayPal) recipient query param purely
// so paypalEmailFromLink can recover it later for that clipboard copy.
const PAYPAL_EMAIL_LINK_RE = /^https:\/\/www\.paypal\.com\/myaccount\/transfer\/homepage\/pay\?recipient=([^&]+)$/i;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// The email this order's PayPal link was built from, or null if the link
// isn't one of ours (a paypal.me link or some other payment page).
export function paypalEmailFromLink(paypalLink) {
  const match = (paypalLink ?? '').match(PAYPAL_EMAIL_LINK_RE);
  return match ? decodeURIComponent(match[1]) : null;
}

// Lets people type just their paypal.me name ("blorbeer", "@blorbeer",
// pasted "paypal.me/blorbeer" without a scheme, …) instead of having to
// paste the whole https://paypal.me/… URL, or their PayPal email address if
// that's all they have (see paypalEmailFromLink for what that turns into).
// A full http(s) link is passed through untouched so anyone who prefers a
// different payment page can still use it. Returns null for empty input;
// throws a user-facing message for input that's neither a link, an email,
// nor a usable name.
export function normalizePaypalInput(raw) {
  const trimmed = (raw ?? '').trim();
  if (!trimmed) return null;
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  if (EMAIL_RE.test(trimmed)) {
    return `https://www.paypal.com/myaccount/transfer/homepage/pay?recipient=${encodeURIComponent(trimmed)}`;
  }
  const name = trimmed
    .replace(/^@/, '')
    .replace(/^(www\.)?paypal\.me\//i, '')
    .replace(/\/+$/, '');
  if (!name || /\s/.test(name)) {
    throw new Error('PayPal-Link muss eine gültige URL, E-Mail-Adresse oder ein PayPal.me-Name ohne Leerzeichen sein.');
  }
  return `https://paypal.me/${name}`;
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

// AP3.5: derives the group Warenkorb button's three states from which of the
// group's still-unpaid items are currently in the cart. Returns null when
// the group has no unpaid items at all (nothing to add — AP3.3 shows the
// paid marker there instead).
export function groupCartState(unpaidItems, cartIds) {
  if (unpaidItems.length === 0) return null;
  const inCartCount = unpaidItems.filter((i) => cartIds.has(i.id)).length;
  if (inCartCount === 0) return 'none';
  if (inCartCount === unpaidItems.length) return 'all';
  return 'some';
}

// AP3.6 startup rule, applied at most once per order per session (AP3.7):
// the current identity's own group starts open, the creator sees every
// group open, and a fully paid group always starts collapsed regardless.
function ensureGroupStartRule(order, myId, grouped) {
  if (groupStartRuleApplied.has(order.id)) return;
  groupStartRuleApplied.add(order.id);
  const isCreator = Boolean(myId) && order.createdBy === myId;
  const expanded = new Set();
  for (const [playerId, items] of grouped) {
    const allPaid = items.every((i) => i.paid);
    if (allPaid) continue;
    if (isCreator || playerId === myId) expanded.add(playerId);
  }
  expandedGroups.set(order.id, expanded);
}

function playerFor(item) {
  return state.players.find((p) => p.id === item.playerId) || { color: item.playerColor };
}

function renderItemRow(order, item, myId, { locked = false } = {}) {
  const tipPercent = order.tipPercent || 0;
  const quantity = item.quantity ?? 1;
  const total = lineTotalCents(item, tipPercent);
  const lineSubtotal = item.priceCents === null ? null : item.priceCents * quantity;
  const basePriceLabel = quantity > 1 ? `${quantity} × ${formatCents(item.priceCents)}` : formatCents(lineSubtotal);
  const showBasePrice = quantity > 1 || tipPercent > 0;
  const priceBreakdownHtml =
    total === null || !showBasePrice
      ? ''
      : `<span class="muted">${basePriceLabel}${tipPercent > 0 ? ` · inkl. ${tipPercent}% Trinkgeld` : ''}</span>`;

  // Bezahlt-Marke (AP1.3): a button, not a plain checkbox, so it can carry
  // both an icon and the word in either state and stays operable even when
  // the row itself is otherwise locked because it is paid — it is the only
  // way back. Only the finalized-order `locked` flag disables it. Marking
  // paid is no longer creator/admin-only (anyone who can pay into the order
  // can also mark a position paid), so the tooltip names who actually did it.
  const paidTitle = item.paid
    ? `Bezahlt von ${escapeHtml(item.paidByName ?? '?')} – Markierung aufheben`
    : 'Als bezahlt markieren';
  const paidMarkerHtml = `
    <button type="button" class="food-order-paid-marker ${item.paid ? 'is-paid' : ''}" data-toggle-paid="${item.id}" data-order="${order.id}" ${locked ? 'disabled' : ''} aria-pressed="${item.paid ? 'true' : 'false'}" title="${paidTitle}" aria-label="${paidTitle}">
      ${icon(item.paid ? 'check' : 'circleDashed')}<span>${item.paid ? 'Bezahlt' : 'Offen'}</span>
    </button>`;

  const descriptionHtml = `<span class="food-order-item-description"><strong>${quantity} ×</strong> ${escapeHtml(item.description)}</span>`;

  // Betrag ist Anzeige, kein Knopf (AP1.2) — the per-item "Bezahlen" action
  // is gone (Leitentscheidung 1: exactly one Bezahlweg, over the Warenkorb).
  const amountHtml =
    total === null
      ? `<span class="food-order-item-amount muted">Betrag offen</span>`
      : `<span class="food-order-item-amount"><strong>${formatCents(total)}</strong>${priceBreakdownHtml}</span>`;

  const copyHtml =
    total === null
      ? ''
      : `<button type="button" class="icon-btn food-order-item-action food-order-item-copy" data-copy-food-total="${escapeHtml(formatCents(total))}" title="Summe kopieren" aria-label="Summe kopieren">${icon('copy')}</button>`;

  // Warenkorb toggle needs a PayPal link to mean anything — without one,
  // nothing in this order can ever be paid via the cart.
  const inCart = cartItemIds.has(item.id) && !item.paid;
  const cartTitle = locked
    ? 'Bestellung geschlossen – keine Änderungen mehr möglich'
    : item.paid
      ? 'Bereits bezahlt – nicht in den Warenkorb legbar'
      : inCart
        ? 'Aus dem Warenkorb nehmen'
        : 'In den Warenkorb legen';
  const cartToggleHtml = order.paypalLink
    ? `<button type="button" class="icon-btn food-order-item-action food-order-item-cart-toggle" data-toggle-cart="${item.id}" aria-pressed="${inCart ? 'true' : 'false'}" ${locked || item.paid ? 'disabled' : ''} title="${cartTitle}" aria-label="${cartTitle}">${icon('shoppingCart')}</button>`
    : '';

  const actionClusterHtml = `
    <span class="food-order-item-action-cluster">
      ${copyHtml || '<span class="food-order-item-action-spacer" aria-hidden="true"></span>'}
      <span class="food-order-item-action-divider" aria-hidden="true"></span>
      ${cartToggleHtml || '<span class="food-order-item-action-spacer" aria-hidden="true"></span>'}
    </span>`;

  const removeTitle = item.paid ? 'Bezahlte Position kann nicht entfernt werden' : 'Position entfernen';
  const removeHtml =
    !locked && order.open && item.playerId === myId
      ? `<button type="button" class="icon-btn food-order-item-action food-order-item-remove" data-remove-item="${item.id}" data-order="${order.id}" ${item.paid ? 'disabled' : ''} title="${removeTitle}" aria-label="${removeTitle}">${icon('trash')}</button>`
      : '<span class="food-order-item-action-spacer" aria-hidden="true"></span>';

  return `
    <div class="row food-order-item ${item.paid ? 'is-paid' : ''} ${inCart ? 'is-in-cart' : ''}">
      ${paidMarkerHtml}
      ${descriptionHtml}
      ${amountHtml}
      ${actionClusterHtml}
      ${removeHtml}
    </div>`;
}

// One orderer group's meta line (AP3.4): "<n> Positionen · <n> bezahlt ·
// <n> im Korb", trailing parts only when they apply.
function groupMetaLine(items) {
  const totalQty = items.reduce((s, i) => s + (i.quantity ?? 1), 0);
  const paidQty = items.filter((i) => i.paid).reduce((s, i) => s + (i.quantity ?? 1), 0);
  const cartQty = items
    .filter((i) => !i.paid && cartItemIds.has(i.id))
    .reduce((s, i) => s + (i.quantity ?? 1), 0);
  const parts = [`${totalQty} ${totalQty === 1 ? 'Position' : 'Positionen'}`];
  if (paidQty > 0) parts.push(`${paidQty} bezahlt`);
  if (cartQty > 0) parts.push(`${cartQty} im Korb`);
  return parts.join(' · ');
}

function renderGroupHeader(order, playerId, items, { collapsible, expanded, locked = false }) {
  const player = playerFor(items[0]);
  const tipPercent = order.tipPercent || 0;
  const unpaidItems = items.filter((i) => !i.paid);
  const allPaid = unpaidItems.length === 0;
  const allPriced = unpaidItems.every((i) => i.priceCents !== null);
  const openCents = unpaidItems.reduce((sum, i) => sum + (lineTotalCents(i, tipPercent) ?? 0), 0);
  const meta = groupMetaLine(items);

  const headText = `
    ${avatarHtml(player, 20)}
    <span class="food-order-group-headtext">
      <strong>${escapeHtml(items[0].playerName)}</strong>
      <span class="muted food-order-group-meta">${meta}</span>
    </span>`;

  const leftHtml = collapsible
    ? `<button type="button" class="food-order-group-toggle" data-group-toggle="${playerId}" data-order="${order.id}" aria-expanded="${expanded ? 'true' : 'false'}">
         ${icon('chevronRight', { className: 'food-order-group-chevron' })}
         ${headText}
       </button>`
    : `<div class="food-order-group-static">${headText}</div>`;

  // Below the still-open sum, a small muted line repeats the group's whole
  // lifetime total (paid + unpaid positions, tip included) so a partially
  // settled group still shows what it originally added up to, not just
  // what's left to collect.
  const groupAllPriced = items.every((i) => i.priceCents !== null);
  const groupTotalCents = groupAllPriced
    ? addTipToCents(items.reduce((sum, i) => sum + (i.priceCents ?? 0) * (i.quantity ?? 1), 0), tipPercent)
    : null;

  const amountHtml = allPaid
    ? `<span class="food-order-group-paid-badge">${icon('check')}Bezahlt</span>`
    : `<span class="food-order-group-amount-wrap">
         <span class="food-order-group-amount">${allPriced ? formatCents(openCents) : 'Betrag offen'}</span>
         ${groupTotalCents !== null ? `<span class="muted food-order-group-total">Gesamt ${formatCents(groupTotalCents)}</span>` : ''}
       </span>`;

  const cartState = groupCartState(unpaidItems, cartItemIds);
  const cartBtnHtml =
    order.paypalLink && cartState
      ? (() => {
          const title = locked
            ? 'Bestellung geschlossen – keine Änderungen mehr möglich'
            : cartState === 'all'
              ? 'Gruppe aus dem Warenkorb nehmen'
              : cartState === 'some'
                ? 'Restliche offene Positionen in den Warenkorb legen'
                : 'Alle offenen Positionen in den Warenkorb legen';
          return `<button type="button" class="icon-btn food-order-item-action food-order-group-cart-btn is-${cartState}" data-group-cart-toggle="${playerId}" data-order="${order.id}" aria-pressed="${cartState === 'all' ? 'true' : 'false'}" ${locked ? 'disabled' : ''} title="${title}" aria-label="${title}">${icon('shoppingCart')}</button>`;
        })()
      : '';

  return `
    <div class="row food-order-group-header">
      ${leftHtml}
      ${amountHtml}
      ${cartBtnHtml}
    </div>`;
}

function renderItems(order, myId, { locked = false } = {}) {
  if (order.items.length === 0) {
    return `<div class="muted" style="font-size:var(--font-size-sm);padding:var(--space-2) 0;">Noch nichts eingetragen.</div>`;
  }
  const grouped = itemsGroupedByPlayer(order);

  // AP3.9: a single-group order gets no collapse chrome at all.
  if (grouped.size <= 1) {
    return [...grouped.entries()]
      .map(([playerId, items]) => {
        const rows = items.map((i) => renderItemRow(order, i, myId, { locked })).join('');
        const allPaid = items.every((i) => i.paid);
        return `
          <div class="stack food-order-group ${allPaid ? 'is-all-paid' : ''}">
            ${renderGroupHeader(order, playerId, items, { collapsible: false, locked })}
            <div class="food-order-group-items">${rows}</div>
          </div>`;
      })
      .join('');
  }

  ensureGroupStartRule(order, myId, grouped);
  const expandedSet = expandedGroups.get(order.id) ?? new Set();

  return [...grouped.entries()]
    .map(([playerId, items]) => {
      const expanded = expandedSet.has(playerId);
      const rows = items.map((i) => renderItemRow(order, i, myId, { locked })).join('');
      const allPaid = items.every((i) => i.paid);
      return `
        <div class="stack food-order-group ${allPaid ? 'is-all-paid' : ''}">
          ${renderGroupHeader(order, playerId, items, { collapsible: true, expanded, locked })}
          <div class="food-order-group-items" ${expanded ? '' : 'hidden'}>${rows}</div>
        </div>`;
    })
    .join('');
}

// Order-wide "auf einen Blick" summary, directly above the per-person Kästen
// (`.food-order-items`): total positions across everyone and how many people
// ordered, how many are already marked paid, and the tip-inclusive total vs.
// what's still open - all before scrolling into the individual groups. Uses
// the same quantity-weighted counting convention as groupMetaLine (a
// quantity of 2 counts as 2 Positionen, not 1 row).
function renderOrderOverview(order) {
  if (order.items.length === 0) return '';
  const tipPercent = order.tipPercent || 0;
  const peopleCount = itemsGroupedByPlayer(order).size;
  const totalQty = order.items.reduce((s, i) => s + (i.quantity ?? 1), 0);
  const paidQty = order.items.filter((i) => i.paid).reduce((s, i) => s + (i.quantity ?? 1), 0);
  const unpaidItems = order.items.filter((i) => !i.paid);
  const allPriced = order.items.every((i) => i.priceCents !== null);
  const totalLabel = allPriced ? formatCents(addTipToCents(order.totalCents, tipPercent)) : 'Betrag offen';

  const parts = [
    `${totalQty} ${totalQty === 1 ? 'Position' : 'Positionen'} von ${peopleCount} ${peopleCount === 1 ? 'Person' : 'Personen'}`,
    `${paidQty} bezahlt`,
    `Gesamt ${totalLabel}`,
  ];
  if (unpaidItems.length > 0) {
    const unpaidPriced = unpaidItems.every((i) => i.priceCents !== null);
    const openCents = unpaidItems.reduce((sum, i) => sum + (lineTotalCents(i, tipPercent) ?? 0), 0);
    parts.push(`offen ${unpaidPriced ? formatCents(openCents) : 'Betrag offen'}`);
  }

  return `<div class="muted food-order-overview">${parts.join(' · ')}</div>`;
}

// The order-wide total, styled as a real total (not a muted info line) with
// its own copy action directly beside the amount, so the sum sits left of
// the copy button rather than trailing behind unrelated metadata.
function renderOrderSummaryTotal(order) {
  if (order.totalCents <= 0) return '';
  const tipPercent = order.tipPercent || 0;
  const totalCents = addTipToCents(order.totalCents, tipPercent);
  const label = tipPercent > 0 ? `Gesamtsumme inkl. ${tipPercent}% Trinkgeld` : 'Gesamtsumme';
  return `
    <div class="row-between food-order-total">
      <span class="food-order-total-label">${label}</span>
      <span class="food-order-total-value">
        <strong>${formatCents(totalCents)}</strong>
        <button type="button" class="icon-btn food-order-item-action food-order-item-copy" data-copy-food-total="${escapeHtml(formatCents(totalCents))}" title="Summe kopieren" aria-label="Summe kopieren">${icon('copy')}</button>
      </span>
    </div>`;
}

// Warenkorb-Kasten (AP1.5): appears only once something is in it. Lists
// every cart item with a color dot and the original orderer's name, a
// "Summe" row, "Bezahlen · <Summe>" and "Alle als bezahlt markieren" below
// it, and its own X per row to take a single item back out (no confirmation
// — reversible with one tap, per Leitentscheidung 6).
function renderCartBox(order, { locked = false } = {}) {
  if (!order.paypalLink) return '';
  const cartItems = order.items.filter((i) => cartItemIds.has(i.id) && !i.paid);
  if (cartItems.length === 0) return '';

  const tipPercent = order.tipPercent || 0;
  const allPriced = cartItems.every((i) => i.priceCents !== null);
  const rawCents = cartItems.reduce((sum, i) => sum + (i.priceCents ?? 0) * (i.quantity ?? 1), 0);
  const payableCents = allPriced ? addTipToCents(rawCents, tipPercent) : 0;
  const sumLabel = allPriced ? formatCents(payableCents) : 'Betrag offen';

  const rowsHtml = cartItems
    .map((item) => {
      const total = lineTotalCents(item, tipPercent);
      return `
        <div class="row food-order-cart-row">
          ${avatarHtml(playerFor(item), 16)}
          <span class="food-order-cart-row-name">${escapeHtml(item.playerName)}</span>
          <span class="food-order-cart-row-desc">${item.quantity ?? 1} × ${escapeHtml(item.description)}</span>
          <span class="food-order-cart-row-amount">${total === null ? 'Betrag offen' : formatCents(total)}</span>
          <button type="button" class="icon-btn food-order-item-action" data-cart-remove="${item.id}" title="Aus dem Warenkorb nehmen" aria-label="Aus dem Warenkorb nehmen">${icon('x')}</button>
        </div>`;
    })
    .join('');

  return `
    <div class="stack food-order-cart" data-order-cart="${order.id}">
      <div class="row-between food-order-cart-header">
        <strong>Warenkorb</strong>
        <span class="badge badge-playing">${cartItems.length}</span>
      </div>
      <div class="stack food-order-cart-rows">${rowsHtml}</div>
      <div class="row-between food-order-cart-summary">
        <span>Summe</span>
        <strong>${sumLabel}</strong>
      </div>
      <button type="button" class="btn btn-primary btn-sm btn-block food-order-cart-pay" data-cart-pay="${order.id}" ${locked ? 'disabled' : ''}>${icon('wallet')} Bezahlen · ${sumLabel}</button>
      <button type="button" class="btn btn-sm btn-block" data-cart-mark-paid="${order.id}" ${locked ? 'disabled' : ''}>Alle als bezahlt markieren</button>
    </div>`;
}

function renderOrderSummary(order, { locked = false } = {}) {
  const totalHtml = renderOrderSummaryTotal(order);
  const cartHtml = renderCartBox(order, { locked });
  if (!totalHtml && !cartHtml) return '';
  return `<div class="stack food-order-summary">${totalHtml}${cartHtml}</div>`;
}

// Metadata block (send time / notes / menu / payment) shown on both open and closed
// orders, with a single edit affordance — all three are things people
// commonly get wrong or need to correct ("doch erst um 21 Uhr", "Speisekarte
// war falsch"), so they stay editable even after the order closed, unlike the
// items themselves.
function renderDetails(order, { locked = false } = {}) {
  const sendAtLabel = order.sendAt
    ? `Versand ${formatDateTime(order.sendAt)} Uhr`
    : 'Kein Zeitpunkt festgelegt';
  const sendAtHtml = order.sendAt
    ? `<span class="food-order-send-at"><span class="food-order-detail-icon" aria-hidden="true">${icon('clock')}</span>${sendAtLabel}</span>`
    : `<span class="food-order-send-at">${sendAtLabel}</span>`;
  const hasDetails = Boolean(order.sendAt || order.notes || order.link || order.paypalLink || order.tipPercent);
  return `
    <div class="food-order-details">
      <div class="food-order-details-head">
        ${sendAtHtml}
        ${locked ? '' : `<button type="button" class="btn btn-sm" data-edit-details="${order.id}">${hasDetails ? 'Bearbeiten' : 'Info'}</button>`}
      </div>
      ${order.notes ? `<div class="food-order-details-note">${escapeHtml(order.notes)}</div>` : ''}
      ${order.link || order.paypalLink ? `<div class="food-order-detail-links">` : ''}
      ${order.link ? `<a class="btn btn-sm" href="${escapeHtml(order.link)}" target="_blank" rel="noopener">Speisekarte</a>` : ''}
      ${
        order.paypalLink
          ? (() => {
              const email = paypalEmailFromLink(order.paypalLink);
              return `<a
                class="btn btn-sm"
                href="${escapeHtml(order.paypalLink)}"
                target="_blank"
                rel="noopener"
                ${email ? `data-copy-paypal-email="${escapeHtml(email)}" title="Öffnet PayPal und kopiert ${escapeHtml(email)} zum Einfügen."` : ''}
              >PayPal öffnen</a>`;
            })()
          : ''
      }
      ${order.link || order.paypalLink ? '</div>' : ''}
    </div>`;
}

// AP3.6: "Alle ausklappen/einklappen" toggle in the card header — only
// meaningful when the order actually has more than one orderer group.
function renderGroupToggleAll(order) {
  const grouped = itemsGroupedByPlayer(order);
  if (grouped.size <= 1) return '';
  const expandedSet = expandedGroups.get(order.id) ?? new Set();
  const allExpanded = [...grouped.keys()].every((playerId) => expandedSet.has(playerId));
  const label = allExpanded ? 'Alle einklappen' : 'Alle ausklappen';
  return `<button type="button" class="btn btn-sm" data-toggle-all-groups="${order.id}">${label}</button>`;
}

// AP4.1: creator and admins get a "Bestellliste" entry point in the card
// header, on open and closed orders alike.
function renderOrderListButton(order, myId) {
  if (order.createdBy !== myId && !currentPlayerHasAdminRole()) return '';
  return `<button type="button" class="btn btn-sm" data-open-order-list="${order.id}">${icon('listChecks')} Bestellliste</button>`;
}

function renderCardToolbar(order, myId) {
  const groupToggle = renderGroupToggleAll(order);
  const listButton = renderOrderListButton(order, myId);
  if (!groupToggle && !listButton) return '';
  return `<div class="row food-order-card-toolbar">${groupToggle}${listButton}</div>`;
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
    return `<input type="text" class="food-order-desc-field" data-item-desc placeholder="z.B. Margherita groß" maxlength="120" required aria-label="Artikelbezeichnung" autocomplete="off" />`;
  }
  const listId = `food-order-desc-${order.id}`;
  const optionsHtml = suggestions.map((suggestion, index) => descOptionHtml(listId, suggestion, index, false)).join('');
  return `
    <div class="search-select food-order-desc-field" data-desc-suggest>
      <div class="search-select-control">
        <input type="text" data-item-desc placeholder="z.B. Margherita groß" maxlength="120" required autocomplete="off" role="combobox" aria-autocomplete="list" aria-expanded="false" aria-controls="${listId}" aria-label="Artikelbezeichnung – bereits eingetragene Positionen vorschlagen" />
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
  const close = () => {
    list.hidden = true;
    updateExpanded(false);
    input.removeAttribute('aria-activedescendant');
    activeIndex = -1;
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
    if (isOpen() && !wrapper.contains(event.target)) close();
  };
  document.addEventListener('pointerdown', closeFromOutsidePointer);
}

function renderOpenOrder(order, myId, { collapsible = false, collapsed = false } = {}) {
  // renderItems() has to run before renderCardToolbar(): it is the only
  // place that calls ensureGroupStartRule(), which populates expandedGroups
  // for an order on its first render. Computing the toolbar first would read
  // that map before it exists yet, mislabeling "Alle ausklappen/einklappen"
  // on that very first render.
  const itemsHtml = renderItems(order, myId);
  const bodyHtml = `
    <div class="muted food-order-meta">
      von ${escapeHtml(order.createdByName)} · ${formatDateTime(order.createdAt)}
    </div>
    ${renderDetails(order)}
    ${renderCardToolbar(order, myId)}
    ${renderOrderOverview(order)}
    <div class="food-order-items">${itemsHtml}</div>
    ${renderOrderSummary(order)}
    ${
      myId
        ? `<form class="food-order-item-form" data-add-item-form="${order.id}">
             ${renderDescField(order)}
             <label class="food-order-quantity-field">
               <input type="number" class="food-order-quantity-input" data-item-quantity placeholder="Anzahl" min="1" max="99" inputmode="numeric" aria-label="Anzahl" />
             </label>
             <label class="food-order-price-field">
               <input type="text" class="food-order-price-input" data-item-price placeholder="Preis" inputmode="decimal" aria-label="Einzelpreis" />
               <span aria-hidden="true">€</span>
             </label>
             <button type="submit" class="btn food-order-add-button">Hinzufügen</button>
           </form>`
        : `<div class="muted" style="font-size:var(--font-size-sm);">Wähle oben, wer du bist, um dich einzutragen.</div>`
    }
    ${
      order.createdBy === myId
        ? `<div class="food-order-close-action stack" style="gap:var(--space-2);">
             <button type="button" class="btn btn-primary btn-sm btn-block" data-close-order="${order.id}">Bestellung abschicken</button>
             <button type="button" class="btn btn-danger btn-sm btn-block" data-delete-order="${order.id}">Bestellung löschen</button>
           </div>`
        : ''
    }`;

  // Collapse chrome only when more than one order is open at once (mirrors
  // renderItems()'s single-group precedent): with just one open order there
  // is nothing to declutter by collapsing it. `<details>`/`<summary>` gives
  // this native keyboard/toggle-event behavior for free and lets the
  // existing global-search highlight (app.js's `instanceof
  // HTMLDetailsElement` check) auto-expand a collapsed card it jumps to.
  if (!collapsible) {
    return `
      <div class="card stack food-order-card" data-order-card="${order.id}">
        <div class="row-between">
          <strong>${escapeHtml(order.title)}</strong>
          <span class="badge badge-playing">Offen</span>
        </div>
        ${bodyHtml}
      </div>`;
  }

  return `
    <details class="card stack food-order-card" data-order-card="${order.id}" data-order-collapse-toggle="${order.id}" ${collapsed ? '' : 'open'}>
      <summary class="row-between food-order-card-header-toggle">
        <strong>${escapeHtml(order.title)}</strong>
        <span class="food-order-card-header-end">
          <span class="badge badge-playing">Offen</span>
          ${icon('chevronRight', { className: 'food-order-card-chevron' })}
        </span>
      </summary>
      <div class="food-order-card-body stack">${bodyHtml}</div>
    </details>`;
}

// The "Abgeschickt" (submitted) state — items are frozen for others, but the
// creator/an admin can still reopen it and edit metadata, and any group
// member can still toggle paid status — is deliberately kept visually and
// textually distinct from "Geschlossen" (finalized, fully locked): a
// different badge color (badge-paused vs badge-offline, matching the
// amber/gray "pausiert"/"offline" state language used elsewhere) plus
// different wording.
function renderClosedOrder(order, myId) {
  const finalized = Boolean(order.finalizedAt);
  // See renderOpenOrder(): renderItems() must run before renderCardToolbar()
  // so ensureGroupStartRule() has already populated expandedGroups.
  const itemsHtml = renderItems(order, myId, { locked: finalized });
  return `
    <article class="card stack food-order-card" data-closed-order="${order.id}">
      <div class="row-between">
        <strong>${escapeHtml(order.title)}</strong>
        <span class="badge ${finalized ? 'badge-offline' : 'badge-paused'}">${finalized ? 'Geschlossen' : 'Abgeschickt'}</span>
      </div>
      ${renderDetails(order, { locked: finalized })}
      ${renderCardToolbar(order, myId)}
      ${renderOrderOverview(order)}
      <div class="food-order-items">${itemsHtml}</div>
      ${renderOrderSummary(order, { locked: finalized })}
      ${
        order.createdBy === myId
          ? `<div class="food-order-close-action stack" style="gap:var(--space-2);">
               ${
                 finalized
                   ? ''
                   : `<button type="button" class="btn btn-sm btn-block" data-reopen-order="${order.id}">Wieder öffnen</button>
                      <button type="button" class="btn btn-danger btn-sm btn-block" data-finalize-order="${order.id}">Bestellung schließen</button>`
               }
               <button type="button" class="btn btn-danger btn-sm btn-block" data-delete-order="${order.id}">Bestellung löschen</button>
             </div>`
          : ''
      }
    </article>`;
}

// Reusable confirmation dialog for the AP2 flows that need a breakdown list
// of positions beside the message (Bezahlt?, Sammel-Markierung) — built
// directly on openModal per modal.js's own guidance (no new component),
// mirroring confirmDialog's own title/one-sentence/Abbrechen-links/
// Bestätigen-rechts/focus-on-Abbrechen/Escape-cancels structure.
function confirmWithList(title, message, items, { note, confirmText = 'Bestätigen', cancelText = 'Abbrechen', danger = false } = {}) {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      resolve(result);
    };
    const listHtml = items.length
      ? `<ul class="food-order-confirm-list">${items
          .map((i) => `<li>${i.quantity ?? 1} × ${escapeHtml(i.description)} — <span class="muted">${escapeHtml(i.playerName)}</span></li>`)
          .join('')}</ul>`
      : '';
    const { close } = openModal(
      escapeHtml(title),
      `
        <p style="margin:0 0 var(--space-3);">${escapeHtml(message)}</p>
        ${listHtml}
        ${note ? `<p class="muted" style="margin:var(--space-3) 0 0;">${escapeHtml(note)}</p>` : ''}
        <div class="row" style="gap:var(--space-2);justify-content:flex-end;margin-top:var(--space-4);">
          <button type="button" class="btn btn-sm btn-equal" data-confirm-cancel>${escapeHtml(cancelText)}</button>
          <button type="button" class="btn btn-sm btn-equal ${danger ? 'btn-danger' : 'btn-primary'}" data-confirm-ok>${escapeHtml(confirmText)}</button>
        </div>
      `,
      {
        onMount: (el) => {
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

// AP2.1 / AP2.2's shared server contract: re-fetch first (so a position paid
// on another device in the meantime isn't marked twice), skip anything
// that's already settled or gone, then PATCH the rest in parallel. Reports
// the number of positions actually changed, not the number requested.
async function markCartItemsPaid(orderId, itemIds, ctx) {
  let targets;
  try {
    const res = await api.foodOrders.list();
    cache = res.orders;
    const order = cache.find((o) => o.id === orderId);
    targets = order ? order.items.filter((i) => itemIds.includes(i.id) && !i.paid) : [];
  } catch (err) {
    showToast(err.message, { error: true });
    return;
  }
  if (targets.length === 0) {
    // Every requested id is already paid or gone - none of them are valid
    // cart members any more, whatever the reason.
    for (const id of itemIds) cartItemIds.delete(id);
    showToast('Keine offenen Positionen mehr im Warenkorb.', { error: true });
    ctx.rerender();
    return;
  }
  try {
    await Promise.all(targets.map((i) => api.foodOrders.setItemPaid(orderId, i.id, true)));
    for (const i of targets) {
      i.paid = true;
      cartItemIds.delete(i.id);
    }
    showToast(`${targets.length} ${targets.length === 1 ? 'Position' : 'Positionen'} als bezahlt markiert.`);
    ctx.rerender();
  } catch (err) {
    // A partial failure across several requests could leave the local cache
    // disagreeing with the server for some items - reload instead of
    // guessing which ones actually went through. The cart selection itself
    // stays untouched here: whatever did succeed server-side simply drops
    // out of the cart on re-render (a paid item is never shown as selected),
    // and whatever failed stays selected so the user can just retry instead
    // of losing the whole selection to a transient error.
    cache = null;
    showToast(err.message, { error: true });
    ctx.rerender();
  }
}

// AP2.2: cart's "Bezahlen" click. Opens the PayPal tab synchronously (same
// popup-blocking hardening as before PR 444), re-checks freshness, then —
// immediately after the tab is pointed at PayPal — asks "Bezahlt?" before
// actually marking anything paid. No success is ever claimed: Respawn gets
// no callback from PayPal, "Ja, bezahlt" is the user's own assertion.
async function handleCartPay(order, ctx) {
  const cartItems = order.items.filter((i) => cartItemIds.has(i.id) && !i.paid);
  if (cartItems.length === 0) return;
  const tipPercent = order.tipPercent || 0;
  const allPriced = cartItems.every((i) => i.priceCents !== null);
  const rawCents = cartItems.reduce((sum, i) => sum + (i.priceCents ?? 0) * (i.quantity ?? 1), 0);
  const payableCents = allPriced ? addTipToCents(rawCents, tipPercent) : 0;
  const email = paypalEmailFromLink(order.paypalLink);
  const itemIds = cartItems.map((i) => i.id);

  // Open the tab synchronously, as a direct consequence of the click, before
  // the re-check below crosses an async boundary — see the PR 444 hardening
  // notes on the removed per-item handler for why this can't be delayed.
  const popup = window.open('', '_blank');
  if (popup) popup.opener = null;
  if (email) copyPaypalEmailToClipboard(email);

  let freshOrder;
  let items;
  try {
    const res = await api.foodOrders.list();
    cache = res.orders;
    freshOrder = cache.find((o) => o.id === order.id);
    if (!freshOrder) {
      popup?.close();
      showToast('Diese Bestellung existiert nicht mehr.', { error: true });
      ctx.rerender();
      return;
    }
    items = freshOrder.items.filter((i) => itemIds.includes(i.id));
    if (items.length < itemIds.length) {
      popup?.close();
      showToast('Diese Position existiert nicht mehr.', { error: true });
      ctx.rerender();
      return;
    }
  } catch (err) {
    popup?.close();
    showToast(err.message, { error: true });
    return;
  }
  const alreadyPaid = items.filter((i) => i.paid);
  if (alreadyPaid.length > 0) {
    popup?.close();
    for (const i of alreadyPaid) cartItemIds.delete(i.id);
    const names = alreadyPaid.map((i) => i.description).join(', ');
    showToast(
      itemIds.length > 1
        ? `Inzwischen bereits bezahlt und aus dem Warenkorb entfernt: ${names}. Bitte Auswahl und Betrag prüfen.`
        : `„${names}“ ist inzwischen bereits als bezahlt markiert.`,
      { error: true }
    );
    ctx.rerender();
    return;
  }
  // A selection can outlive the PayPal link it was made for — the creator
  // might clear it via "Info bearbeiten" while items are still selected on
  // someone else's device — so bail out before paypalPayUrl(null, …) throws.
  if (!freshOrder.paypalLink) {
    popup?.close();
    showToast('Für diese Bestellung ist kein PayPal-Link mehr hinterlegt.', { error: true });
    ctx.rerender();
    return;
  }

  const payUrl = paypalPayUrl(freshOrder.paypalLink, payableCents);
  if (popup) popup.location = payUrl;
  else window.open(payUrl, '_blank', 'noopener');

  const amountLabel = allPriced ? formatCents(payableCents) : 'ein noch unvollständiger Betrag';
  const confirmed = await confirmWithList(
    'Bezahlt?',
    `${amountLabel} für ${items.length} ${items.length === 1 ? 'Position' : 'Positionen'} an PayPal übergeben.`,
    items,
    { note: 'Der Warenkorb wird danach geleert.', confirmText: 'Ja, bezahlt', cancelText: 'Noch nicht' }
  );
  if (!confirmed) return;
  await markCartItemsPaid(order.id, itemIds, ctx);
}

// AP2.3: "Alle als bezahlt markieren" in the cart — no PayPal involved,
// confirmation stays reversible (blue, not red) since unchecking "Bezahlt"
// again undoes it.
async function handleCartMarkPaid(order, ctx) {
  const cartItems = order.items.filter((i) => cartItemIds.has(i.id) && !i.paid);
  if (cartItems.length === 0) return;
  const tipPercent = order.tipPercent || 0;
  const allPriced = cartItems.every((i) => i.priceCents !== null);
  const rawCents = cartItems.reduce((sum, i) => sum + (i.priceCents ?? 0) * (i.quantity ?? 1), 0);
  const amountLabel = allPriced ? formatCents(addTipToCents(rawCents, tipPercent)) : 'Betrag unvollständig';
  const confirmed = await confirmWithList(
    'Alle als bezahlt markieren?',
    `${cartItems.length} ${cartItems.length === 1 ? 'Position' : 'Positionen'} · ${amountLabel}. Der Warenkorb wird geleert.`,
    cartItems,
    { confirmText: 'Bestätigen', cancelText: 'Abbrechen' }
  );
  if (!confirmed) return;
  await markCartItemsPaid(order.id, cartItems.map((i) => i.id), ctx);
}

// --- AP4: consolidated order list -----------------------------------------

function normalizeDescription(desc) {
  return desc.trim().replace(/\s+/g, ' ').toLowerCase();
}

// Distinct descriptions already entered in this order, for the add-item
// field's suggestion dropdown: same normalized-description dedup as
// buildConsolidatedRows, keeping the first-seen original spelling (and the
// price it was entered with, if any) so picking a suggestion reuses both the
// exact wording the consolidated list already keys on and its price, without
// retyping either. Sorted with the German locale like the consolidated list
// itself.
export function foodOrderDescriptionSuggestions(items) {
  const seen = new Map();
  for (const item of items) {
    const norm = normalizeDescription(item.description);
    if (!seen.has(norm)) {
      seen.set(norm, { label: item.description.trim().replace(/\s+/g, ' '), priceCents: item.priceCents ?? null });
    }
  }
  return [...seen.values()].sort((a, b) => a.label.localeCompare(b.label, 'de'));
}

// AP4.2: groups by normalized description + exact unit price; same name at
// a different price stays its own row (merging it would silently
// undercount or overcount that row's total).
export function buildConsolidatedRows(items) {
  const rows = new Map();
  for (const item of items) {
    const norm = normalizeDescription(item.description);
    const key = `${norm}|${item.priceCents === null ? 'null' : item.priceCents}`;
    if (!rows.has(key)) {
      rows.set(key, {
        description: item.description.trim().replace(/\s+/g, ' '),
        priceCents: item.priceCents,
        quantity: 0,
      });
    }
    rows.get(key).quantity += item.quantity ?? 1;
  }
  return [...rows.values()].sort((a, b) => a.description.localeCompare(b.description, 'de'));
}

function consolidatedTotals(rows, tipPercent) {
  const pricedRows = rows.filter((r) => r.priceCents !== null);
  const incomplete = rows.length > pricedRows.length;
  const subtotalCents = pricedRows.reduce((sum, r) => sum + r.priceCents * r.quantity, 0);
  const totalCents = addTipToCents(subtotalCents, tipPercent);
  return { incomplete, subtotalCents, totalCents };
}

function renderConsolidatedListBody(order) {
  const rows = buildConsolidatedRows(order.items);
  const tipPercent = order.tipPercent || 0;
  const { incomplete, subtotalCents, totalCents } = consolidatedTotals(rows, tipPercent);
  const rowsHtml = rows.length
    ? rows
        .map(
          (r) => `
        <div class="row-between food-order-consolidated-row">
          <span class="food-order-consolidated-row-desc">${r.quantity} × ${escapeHtml(r.description)}</span>
          <span class="muted">${r.priceCents === null ? 'kein Preis' : formatCents(r.priceCents)}</span>
          <span>${r.priceCents === null ? '—' : formatCents(r.priceCents * r.quantity)}</span>
        </div>`
        )
        .join('')
    : emptyStateHtml('Noch nichts eingetragen.');
  return `
    ${order.open ? `<div class="muted food-order-consolidated-open-note">Bestellung ist noch offen.</div>` : ''}
    <div class="stack food-order-consolidated-rows">${rowsHtml}</div>
    <div class="stack food-order-consolidated-totals">
      <div class="row-between"><span>Zwischensumme${incomplete ? ' (unvollständig)' : ''}</span><strong>${formatCents(subtotalCents)}</strong></div>
      ${tipPercent > 0 ? `<div class="row-between muted"><span>+ ${tipPercent}% Trinkgeld</span><span>${formatCents(totalCents - subtotalCents)}</span></div>` : ''}
      <div class="row-between"><span>Gesamt${incomplete ? ' (unvollständig)' : ''}</span><strong>${formatCents(totalCents)}</strong></div>
    </div>
    ${
      order.open && order.createdByCurrentUser
        ? `<div class="row" style="gap:var(--space-2);flex-wrap:wrap;">
             <button type="button" class="btn btn-primary btn-sm" data-close-order-from-list="${order.id}">Bestellung abschicken</button>
           </div>`
        : ''
    }`;
}

function wireConsolidatedListActions(el, order) {
  el.querySelector('[data-close-order-from-list]')?.addEventListener('click', async () => {
    if (!(await confirmDialog('Bestellung abschicken? Danach kann niemand mehr etwas eintragen.', { confirmText: 'Abschicken' }))) return;
    try {
      await api.foodOrders.close(order.id);
      cache = null;
      showToast('Bestellung abgeschickt.');
      consolidatedListDialog?.ctx.rerender();
    } catch (err) {
      showToast(err.message, { error: true });
    }
  });
}

// AP4.1/AP4.7: opens the dialog and keeps a reference so renderFoodOrders
// can refresh its content on every live re-render while it stays open.
function openConsolidatedListDialog(order, myId, ctx) {
  const orderWithFlag = { ...order, createdByCurrentUser: order.createdBy === myId };
  const { el, close } = openModal(
    escapeHtml(`Bestellliste – ${order.title}`),
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

// Called at the end of every render pass so the open Bestellliste dialog
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
        <label for="order-title" class="field-label">Titel</label>
        <input type="text" id="order-title" maxlength="80" required autofocus placeholder="z.B. Pizza bei Luigi's" />
        <div>
          <label for="order-sendat" class="field-label">Versand (optional)</label>
          ${dateTimeFieldHtml('order-sendat', null, { clearable: true, label: 'Versand' })}
        </div>
        <div>
          <label for="order-notes" class="field-label">Info (optional)</label>
          <textarea id="order-notes" rows="1" maxlength="500" placeholder="z.B. Mindestbestellwert 15€, bar zahlen"></textarea>
        </div>
        <div>
          <label for="order-link" class="field-label">Speisekarte (optional)</label>
          <input type="url" id="order-link" maxlength="300" placeholder="https://…" />
        </div>
        <div>
          <div class="food-order-paypal-label">
            <label for="order-paypal" class="field-label">PayPal (optional)</label>
            ${infoTooltipHtml(
              'order-paypal-help',
              'PayPal',
              'E-Mail-Adresse oder vollständigen PayPal.me-Link einfügen. Bei einer E-Mail-Adresse wird sie beim Öffnen von PayPal kopiert; ein Betrag kann nur beim PayPal.me-Link vorausgefüllt werden.',
            )}
          </div>
          <input type="text" id="order-paypal" maxlength="300" placeholder="E-Mail-Adresse oder https://paypal.me/name" />
        </div>
        <div>
          <label for="order-tip" class="field-label">Trinkgeld in % (optional)</label>
          <input type="number" id="order-tip" min="0" max="100" inputmode="numeric" placeholder="z.B. 10" />
        </div>
        <button type="submit" class="btn btn-primary btn-block">Bestellung öffnen</button>
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
            await api.foodOrders.create(myId, title, { sendAt, notes, link, paypalLink, tipPercent });
            close();
            cache = null;
            showToast('Bestellung geöffnet – alle wurden benachrichtigt.');
            ctx.rerender();
          } catch (err) {
            showToast(err.message, { error: true });
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
          <label for="sendat-input" class="field-label">Versand</label>
          ${dateTimeFieldHtml('sendat-input', order.sendAt, { clearable: true, label: 'Versand' })}
        </div>
        <div>
          <label for="notes-input" class="field-label">Info</label>
          <textarea id="notes-input" rows="3" maxlength="500" placeholder="z.B. Mindestbestellwert 15€, bar zahlen">${escapeHtml(order.notes ?? '')}</textarea>
        </div>
        <div>
          <label for="link-input" class="field-label">Speisekarte</label>
          <input type="url" id="link-input" maxlength="300" placeholder="https://…" value="${escapeHtml(order.link ?? '')}" />
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
          <input type="text" id="paypal-input" maxlength="300" placeholder="E-Mail-Adresse oder https://paypal.me/name" value="${escapeHtml(paypalEmailFromLink(order.paypalLink) ?? order.paypalLink ?? '')}" />
        </div>
        <div>
          <label for="tip-input" class="field-label">Trinkgeld in %</label>
          <input type="number" id="tip-input" min="0" max="100" inputmode="numeric" placeholder="z.B. 10" value="${order.tipPercent ?? ''}" />
        </div>
        <button type="submit" class="btn btn-primary btn-block">Speichern</button>
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
            await api.foodOrders.updateDetails(order.id, { sendAt, notes, link, paypalLink, tipPercent });
            close();
            cache = null;
            showToast('Gespeichert.');
            ctx.rerender();
          } catch (err) {
            showToast(err.message, { error: true });
          }
        });
      },
    }
  );
}

export function renderFoodOrders(container, ctx) {
  if (cache === null && !loading) load(ctx);

  const myId = getMyId();

  // Every teammate adding an item fires foodOrders:changed and re-renders
  // this view on all devices — preserve what THIS user is mid-typing in the
  // add-item forms, or their half-written "Margherita" vanishes whenever
  // someone else is faster.
  const prevForms = new Map();
  container.querySelectorAll('[data-add-item-form]').forEach((f) => {
    const desc = f.querySelector('[data-item-desc]');
    const quantity = f.querySelector('[data-item-quantity]');
    const price = f.querySelector('[data-item-price]');
    prevForms.set(f.dataset.addItemForm, {
      desc: desc?.value ?? '',
      quantity: quantity?.value ?? '',
      price: price?.value ?? '',
      focus: document.activeElement === desc ? 'desc' : document.activeElement === quantity ? 'quantity' : document.activeElement === price ? 'price' : null,
    });
  });
  const orders = cache || [];
  const openOrders = orders.filter((o) => o.open);
  const closedOrders = orders.filter((o) => !o.open);

  const openHtml =
    loading || cache === null
      ? emptyStateHtml('Lädt…')
      : openOrders.length === 0
        ? emptyStateHtml('Gerade keine offene Bestellung.')
        : `<div class="two-column-card-grid food-order-grid">${openOrders
            .map((o) => renderOpenOrder(o, myId, { collapsible: openOrders.length > 1, collapsed: collapsedOpenOrders.has(o.id) }))
            .join('')}</div>`;

  // Replacing innerHTML momentarily drops all children, which clamps this
  // scrollable container's own scrollTop to 0 - restoring it below is what
  // keeps e.g. marking several positions paid in a row from jumping the
  // whole view back to the top after every single toggle.
  const scrollTop = container.scrollTop;

  container.innerHTML = `
    <div class="row-between">
      <h1 class="view-title">Essen</h1>
      <button type="button" class="btn btn-primary btn-sm" id="order-new-btn" ${myId ? '' : 'disabled'}>Bestellung öffnen</button>
    </div>
    <div class="grouped-page-sections" style="margin-top:var(--space-3);">
      <section class="card stack grouped-page-section" aria-labelledby="food-open-title">
        <div class="grouped-page-section-title"><h2 id="food-open-title">Offene Bestellungen</h2></div>
        ${openHtml}
      </section>
      ${
        closedOrders.length
          ? `<details class="card grouped-page-section collapsible-section" data-food-history ${historyOpen ? 'open' : ''}>
               <summary class="collapsible-section-header">
                 <h2>Historie</h2>
                 <span class="collapsible-section-summary-end">
                   <span class="badge badge-offline">${closedOrders.length}</span>
                   <span class="collapsible-section-chevron">${icon('chevronRight')}</span>
                 </span>
               </summary>
               <div class="collapsible-section-content">
                 <div class="two-column-card-grid food-order-grid">${closedOrders.map((o) => renderClosedOrder(o, myId)).join('')}</div>
               </div>
             </details>`
          : ''
      }
    </div>
  `;
  container.scrollTop = scrollTop;

  wireInfoTooltips(container);

  container.querySelectorAll('[data-add-item-form]').forEach((f) => {
    const prev = prevForms.get(f.dataset.addItemForm);
    if (!prev) return;
    const desc = f.querySelector('[data-item-desc]');
    const quantity = f.querySelector('[data-item-quantity]');
    const price = f.querySelector('[data-item-price]');
    if (prev.desc) desc.value = prev.desc;
    quantity.value = prev.quantity;
    if (prev.price) price.value = prev.price;
    if (prev.focus === 'desc') desc.focus();
    if (prev.focus === 'quantity') quantity.focus();
    if (prev.focus === 'price') price.focus();
  });

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
        return showToast('Preis bitte als Betrag angeben, z.B. 4,50', { error: true });
      }
      const submitBtn = form.querySelector('button[type="submit"]');
      if (submitBtn.disabled) return;
      submitBtn.disabled = true;
      try {
        await api.foodOrders.addItem(orderId, { playerId: myId, description, quantity, priceCents: priceCents ?? undefined });
        cache = null;
        // AP3.8: adding an own position forces the own group open again, in
        // case it had been collapsed.
        const set = expandedGroups.get(orderId) ?? new Set();
        set.add(myId);
        expandedGroups.set(orderId, set);
        ctx.rerender();
      } catch (err) {
        submitBtn.disabled = false;
        showToast(err.message, { error: true });
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
        await api.foodOrders.removeItem(btn.dataset.order, btn.dataset.removeItem, myId);
        cache = null;
        ctx.rerender();
      } catch (err) {
        showToast(err.message, { error: true });
      }
    });
  });

  container.querySelectorAll('[data-toggle-paid]').forEach((button) => {
    button.addEventListener('click', async () => {
      const wasPaid = button.classList.contains('is-paid');
      const paid = !wasPaid;
      try {
        await api.foodOrders.setItemPaid(button.dataset.order, button.dataset.togglePaid, paid);
        const order = cache?.find((o) => o.id === button.dataset.order);
        const item = order?.items.find((i) => i.id === button.dataset.togglePaid);
        if (item) item.paid = paid;
        // A paid position has nothing left to collect, so a leftover
        // Warenkorb mark on it would be misleading.
        if (paid) cartItemIds.delete(button.dataset.togglePaid);
        ctx.rerender();
      } catch (err) {
        showToast(err.message, { error: true });
      }
    });
  });

  container.querySelectorAll('[data-toggle-cart]').forEach((button) => {
    button.addEventListener('click', () => {
      const itemId = button.dataset.toggleCart;
      if (cartItemIds.has(itemId)) cartItemIds.delete(itemId);
      else cartItemIds.add(itemId);
      ctx.rerender();
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

  container.querySelectorAll('[data-group-cart-toggle]').forEach((button) => {
    button.addEventListener('click', () => {
      const orderId = button.dataset.order;
      const playerId = button.dataset.groupCartToggle;
      const order = cache?.find((o) => o.id === orderId);
      if (!order) return;
      const unpaidItems = order.items.filter((i) => i.playerId === playerId && !i.paid);
      const cartState = groupCartState(unpaidItems, cartItemIds);
      if (cartState === 'all') {
        for (const i of unpaidItems) cartItemIds.delete(i.id);
      } else {
        for (const i of unpaidItems) cartItemIds.add(i.id);
      }
      ctx.rerender();
    });
  });

  container.querySelectorAll('[data-cart-remove]').forEach((button) => {
    button.addEventListener('click', () => {
      cartItemIds.delete(button.dataset.cartRemove);
      ctx.rerender();
    });
  });

  container.querySelectorAll('[data-cart-pay]').forEach((button) => {
    button.addEventListener('click', () => {
      const order = cache?.find((o) => o.id === button.dataset.cartPay);
      if (!order) return;
      button.disabled = true;
      handleCartPay(order, ctx).finally(() => {
        button.disabled = false;
      });
    });
  });

  container.querySelectorAll('[data-cart-mark-paid]').forEach((button) => {
    button.addEventListener('click', () => {
      const order = cache?.find((o) => o.id === button.dataset.cartMarkPaid);
      if (!order) return;
      button.disabled = true;
      handleCartMarkPaid(order, ctx).finally(() => {
        button.disabled = false;
      });
    });
  });

  container.querySelectorAll('[data-open-order-list]').forEach((button) => {
    button.addEventListener('click', () => {
      const order = orders.find((o) => o.id === button.dataset.openOrderList);
      if (order) openConsolidatedListDialog(order, myId, ctx);
    });
  });

  container.querySelectorAll('[data-copy-paypal-email]').forEach((a) => {
    a.addEventListener('click', () => copyPaypalEmailToClipboard(a.dataset.copyPaypalEmail));
  });

  container.querySelectorAll('[data-copy-food-total]').forEach((button) => {
    button.addEventListener('click', () => copyFoodOrderTotal(button.dataset.copyFoodTotal));
  });

  container.querySelector('[data-food-history]')?.addEventListener('toggle', (event) => {
    historyOpen = event.currentTarget.open;
  });

  container.querySelectorAll('[data-order-collapse-toggle]').forEach((details) => {
    details.addEventListener('toggle', () => {
      const orderId = details.dataset.orderCollapseToggle;
      if (details.open) collapsedOpenOrders.delete(orderId);
      else collapsedOpenOrders.add(orderId);
    });
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
        await api.foodOrders.close(btn.dataset.closeOrder);
        cache = null;
        showToast('Bestellung abgeschickt.');
        ctx.rerender();
      } catch (err) {
        showToast(err.message, { error: true });
      }
    });
  });

  container.querySelectorAll('[data-reopen-order]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      try {
        await api.foodOrders.reopen(btn.dataset.reopenOrder);
        cache = null;
        showToast('Bestellung wieder geöffnet.');
        ctx.rerender();
      } catch (err) {
        showToast(err.message, { error: true });
      }
    });
  });

  container.querySelectorAll('[data-finalize-order]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      if (
        !(await confirmDialog(
          'Bestellung schließen? Danach sind keine Änderungen mehr möglich – auch nicht durch erneutes Öffnen.',
          { confirmText: 'Schließen' }
        ))
      )
        return;
      try {
        await api.foodOrders.finalize(btn.dataset.finalizeOrder);
        cache = null;
        showToast('Bestellung geschlossen.');
        ctx.rerender();
      } catch (err) {
        showToast(err.message, { error: true });
      }
    });
  });

  container.querySelectorAll('[data-delete-order]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      if (!(await confirmDialog('Bestellung endgültig löschen? Alle eingetragenen Positionen gehen dabei verloren.', { confirmText: 'Löschen', danger: true }))) return;
      try {
        await api.foodOrders.remove(btn.dataset.deleteOrder);
        cache = null;
        showToast('Bestellung gelöscht.');
        ctx.rerender();
      } catch (err) {
        showToast(err.message, { error: true });
      }
    });
  });

  refreshConsolidatedListDialog(myId);
}
