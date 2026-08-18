// "Essen bestellen" view: Sammelbestellungen. Someone opens an order
// ("Pizza bei Luigi's"), everyone adds their own items (free text, price
// optional) from their own phone. Submitting it ("Abgeschickt") freezes the
// item list into a read-out view grouped per person — the "wer wollte
// nochmal was?" round through the room becomes one glance at the screen —
// but stays reversible: the creator/an admin can reopen it to add a
// forgotten item or fix a price, and paid status/metadata stay editable
// throughout. Only once they close it for good ("Geschlossen") does it lock
// permanently.

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

let cache = null;
let loading = false;
let historyOpen = false;
// Item ids picked for a combined PayPal payment — deliberately not tied to
// who added the item: "pay for others too" means anyone can pick any mix of
// items across the whole order. Purely a local UI selection (never sent to
// the server), so it survives re-renders but resets on page reload.
const selectedForPayment = new Set();

async function load(ctx) {
  loading = true;
  try {
    const res = await api.foodOrders.list();
    cache = res.orders;
  } catch (err) {
    showToast(err.message, { error: true });
    cache = [];
  } finally {
    loading = false;
    ctx.rerender();
  }
}

// Called from app.js on every foodOrders:changed socket event.
export function invalidateFoodOrders() {
  cache = null;
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

function renderItems(order, myId, { locked = false } = {}) {
  if (order.items.length === 0) {
    return `<div class="muted" style="font-size:var(--font-size-sm);padding:var(--space-2) 0;">Noch nichts eingetragen.</div>`;
  }
  const grouped = itemsGroupedByPlayer(order);
  const paypalEmail = order.paypalLink ? paypalEmailFromLink(order.paypalLink) : null;
  return [...grouped.entries()]
    .map(([playerId, items]) => {
      const first = items[0];
      const tipPercent = order.tipPercent || 0;
      const player = state.players.find((p) => p.id === playerId) || { color: first.playerColor };
      const rows = items
        .map((i) => {
          const quantity = i.quantity ?? 1;
          const lineSubtotal = i.priceCents === null ? null : i.priceCents * quantity;
          const lineTotal = lineSubtotal === null ? null : addTipToCents(lineSubtotal, tipPercent);
          const basePriceLabel = quantity > 1 ? `${quantity} × ${formatCents(i.priceCents)}` : formatCents(lineSubtotal);
          const showBasePrice = quantity > 1 || tipPercent > 0;
          const priceBreakdownHtml =
            lineTotal === null || !showBasePrice
              ? ''
              : `<span class="muted">${basePriceLabel}${tipPercent > 0 ? ` · inkl. ${tipPercent}% Trinkgeld` : ''}</span>`;
          const copyHtml = lineTotal === null
            ? ''
            : `<button type="button" class="icon-btn food-order-item-action food-order-item-copy" data-copy-food-total="${escapeHtml(formatCents(lineTotal))}" title="Summe kopieren" aria-label="Summe kopieren">${icon('copy')}</button>`;
          // A paid position is fully locked - only the copy action stays
          // usable on it, so removing it is blocked the same way the
          // Sammelzahlung and Bezahlen controls already are.
          const removeTitle = i.paid ? 'Bezahlte Position kann nicht entfernt werden' : 'Position entfernen';
          const removeHtml =
            !locked && order.open && i.playerId === myId
              ? `<button type="button" class="icon-btn food-order-item-action food-order-item-remove" data-remove-item="${i.id}" data-order="${order.id}" ${i.paid ? 'disabled' : ''} title="${removeTitle}" aria-label="${removeTitle}">${icon('trash')}</button>`
              : '';
          // The copy/remove slot each reserve their own width even when empty
          // (unpriced item, someone else's position) so the two actions stay
          // aligned across every row in the card instead of drifting per row.
          const actionsHtml = `
            <div class="row food-order-item-actions">
              ${copyHtml || '<span class="food-order-item-action-spacer" aria-hidden="true"></span>'}
              ${removeHtml || '<span class="food-order-item-action-spacer" aria-hidden="true"></span>'}
            </div>`;
          // A paid position is settled - it can't be picked for the combined
          // Sammelzahlung anymore until "Bezahlt" is unmarked again. The
          // `!i.paid` guard also protects against a stale local selection
          // (e.g. an item another device already marked paid) ever rendering
          // as selected.
          const selected = selectedForPayment.has(i.id) && !i.paid;
          const selectPayTitle = i.paid
            ? 'Bereits bezahlt – für Sammelzahlung nicht auswählbar'
            : selected
              ? 'Für Sammelzahlung ausgewählt – Auswahl aufheben'
              : 'Für Sammelzahlung auswählen';
          const paidTitle = i.paid ? 'Bezahlt – Markierung aufheben' : 'Als bezahlt markieren';
          // The amount itself is the "Bezahlen" action - opens PayPal for
          // exactly this position's own tip-inclusive share, so settling a
          // single item never requires building a Sammelzahlung first. An
          // unpriced position still gets the action ("Betrag offen") and
          // falls back to the bare link (paypalPayUrl only appends an amount
          // when cents > 0); a settled position keeps the same element as a
          // disabled button so the row's geometry does not shift. Without a
          // PayPal link at all there is nothing to pay, so the price stays
          // the plain, non-interactive display it always was.
          const priceBlockHtml = !order.paypalLink
            ? lineTotal === null
              ? ''
              : `<span class="food-order-item-price"><strong>${formatCents(lineTotal)}</strong>${priceBreakdownHtml}</span>`
            : (() => {
                const label = lineTotal === null ? 'Betrag offen' : formatCents(lineTotal);
                const payTitle = lineTotal === null
                  ? 'Position per PayPal bezahlen – Betrag in PayPal eingeben'
                  : `Position per PayPal bezahlen (${formatCents(lineTotal)})`;
                if (i.paid) {
                  return `<button type="button" class="food-order-item-price food-order-pay-button" disabled title="Bereits bezahlt" aria-label="Bereits bezahlt"><strong>${icon('creditCard')}${label}</strong>${priceBreakdownHtml}</button>`;
                }
                return `<a
                    class="food-order-item-price food-order-pay-button"
                    href="${escapeHtml(paypalPayUrl(order.paypalLink, lineTotal ?? 0))}"
                    target="_blank"
                    rel="noopener"
                    title="${escapeHtml(paypalEmail ? `${payTitle} – ${paypalEmail} wird kopiert` : payTitle)}"
                    aria-label="${escapeHtml(payTitle)}"
                    data-pay-order="${order.id}"
                    data-pay-items="${i.id}"
                    ${paypalEmail ? `data-pay-email="${escapeHtml(paypalEmail)}"` : ''}
                  ><strong>${icon('creditCard')}${label}</strong>${priceBreakdownHtml}</a>`;
              })();
          return `
          <div class="row food-order-item ${i.paid ? 'is-paid' : ''} ${selected ? 'is-selected-for-payment' : ''}">
            <input type="checkbox" class="food-order-item-paid-checkbox" data-toggle-paid="${i.id}" data-order="${order.id}" ${i.paid ? 'checked' : ''} ${locked ? 'disabled' : ''} title="${paidTitle}" aria-label="${paidTitle}" />
            ${
              order.paypalLink
                ? `<button type="button" class="icon-btn food-order-item-action food-order-item-toggle" data-select-pay="${i.id}" aria-pressed="${selected ? 'true' : 'false'}" ${i.paid ? 'disabled' : ''} title="${selectPayTitle}" aria-label="${selectPayTitle}">${icon('listChecks')}</button>`
                : ''
            }
            <span class="food-order-item-description"><strong>${quantity} ×</strong> ${escapeHtml(i.description)}</span>
            ${priceBlockHtml}
            ${actionsHtml}
          </div>`;
        })
        .join('');
      return `
        <div class="stack food-order-player">
          <div class="row food-order-player-head">
            ${avatarHtml(player, 20)}
            <strong style="flex:1;">${escapeHtml(first.playerName)}</strong>
          </div>
          <div class="food-order-player-items">${rows}</div>
        </div>`;
    })
    .join('');
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

// Lets anyone build a combined PayPal payment out of any mix of items —
// their own, someone else's, or both — via the per-item checkboxes above.
// Tip is applied to the selected subtotal, not the whole order. If any
// selected item has no price, the sum would silently undercount it, so the
// amount is withheld entirely and the raw PayPal link opens instead
// (paypalPayUrl only appends an amount when cents > 0). The selection is
// broken down item by item so it is clear at a glance what is actually being
// combined, and a bulk action settles every still-unpaid selected item at
// once — either path clears that item's own Sammelzahlung mark, same as the
// per-item "Bezahlt" toggle, since a paid position has nothing left to pay.
function renderPaymentSelector(order, { locked = false } = {}) {
  // A selection can outlive the PayPal link it was made for — the creator
  // might clear it via "Info bearbeiten" while items are still selected on
  // someone else's device — so bail out before paypalPayUrl(null, …) throws.
  if (!order.paypalLink) return '';
  // A paid position can no longer be selected (see renderItems), and the
  // same !i.paid guard here protects against a stale selection left over
  // from another device already having settled the item.
  const selectedItems = order.items.filter((i) => selectedForPayment.has(i.id) && !i.paid);
  if (selectedItems.length === 0) return '';

  const tipPercent = order.tipPercent || 0;
  const allPriced = selectedItems.every((i) => i.priceCents !== null);
  const rawCents = selectedItems.reduce((sum, i) => sum + (i.priceCents ?? 0) * (i.quantity ?? 1), 0);
  const payableCents = allPriced ? addTipToCents(rawCents, tipPercent) : 0;
  const email = paypalEmailFromLink(order.paypalLink);

  const breakdownHtml = `
    <ul class="food-order-selection-breakdown">
      ${selectedItems
        .map((i) => {
          const quantity = i.quantity ?? 1;
          const lineTotal = i.priceCents === null ? null : addTipToCents(i.priceCents * quantity, tipPercent);
          return `<li>${quantity} × ${escapeHtml(i.description)}${lineTotal === null ? '' : ` — ${formatCents(lineTotal)}`}</li>`;
        })
        .join('')}
    </ul>`;

  // The combined total reuses the exact same "amount is the Bezahlen action"
  // component as a single position's own price (see renderItems), so paying
  // one item or several selected ones reads and behaves identically.
  const payLabel = allPriced ? formatCents(payableCents) : 'Betrag offen';
  const payNoteHtml = allPriced
    ? tipPercent > 0
      ? `<span class="muted">inkl. ${tipPercent}% Trinkgeld</span>`
      : ''
    : `<span class="muted">Preis unvollständig – Betrag manuell eingeben</span>`;
  const payTitle = allPriced
    ? `Ausgewählte Positionen per PayPal bezahlen (${formatCents(payableCents)})`
    : 'Ausgewählte Positionen per PayPal bezahlen – Betrag in PayPal eingeben';

  return `
    <div class="stack food-order-payment-selector">
      <div class="row-between">
        <span class="muted">${selectedItems.length} ${selectedItems.length === 1 ? 'Position' : 'Positionen'} ausgewählt</span>
        <span class="food-order-payment-actions">
          ${
            allPriced
              ? `<button type="button" class="icon-btn food-order-item-action food-order-item-copy" data-copy-food-total="${escapeHtml(formatCents(payableCents))}" title="Summe kopieren" aria-label="Summe kopieren">${icon('copy')}</button>`
              : ''
          }
          <a
            class="food-order-item-price food-order-pay-button"
            href="${escapeHtml(paypalPayUrl(order.paypalLink, payableCents))}"
            target="_blank"
            rel="noopener"
            title="${escapeHtml(email ? `${payTitle} – ${email} wird kopiert` : payTitle)}"
            aria-label="${escapeHtml(payTitle)}"
            data-pay-order="${order.id}"
            data-pay-items="${selectedItems.map((i) => i.id).join(',')}"
            ${email ? `data-pay-email="${escapeHtml(email)}"` : ''}
          ><strong>${icon('creditCard')}${payLabel}</strong>${payNoteHtml}</a>
        </span>
      </div>
      ${breakdownHtml}
      ${
        !locked
          ? `<button type="button" class="btn btn-sm btn-block" data-mark-selected-paid="${order.id}">Ausgewählte als bezahlt markieren</button>`
          : ''
      }
    </div>`;
}

function renderOrderSummary(order, { locked = false } = {}) {
  const totalHtml = renderOrderSummaryTotal(order);
  const selectorHtml = renderPaymentSelector(order, { locked });
  if (!totalHtml && !selectorHtml) return '';
  return `<div class="stack food-order-summary">${totalHtml}${selectorHtml}</div>`;
}

// Metadata block (send time / notes / link) shown on both open and closed
// orders, with a single edit affordance — all three are things people
// commonly get wrong or need to correct ("doch erst um 21 Uhr", "Link war
// falsch"), so they stay editable even after the order closed, unlike the
// items themselves.
function renderDetails(order, { locked = false } = {}) {
  const sendAtLabel = order.sendAt
    ? `Versand ${formatDateTime(order.sendAt)} Uhr`
    : 'Kein Zeitpunkt festgelegt';
  const hasDetails = Boolean(order.sendAt || order.notes || order.link || order.paypalLink || order.tipPercent);
  return `
    <div class="stack food-order-details">
      <div class="row-between">
        <span class="muted" style="font-size:var(--font-size-sm);">${sendAtLabel}</span>
        ${locked ? '' : `<button type="button" class="btn btn-sm" data-edit-details="${order.id}">${hasDetails ? 'Bearbeiten' : 'Info'}</button>`}
      </div>
      ${order.notes ? `<div class="muted" style="font-size:var(--font-size-sm);white-space:pre-wrap;word-break:break-word;">${escapeHtml(order.notes)}</div>` : ''}
      ${order.link ? `<a href="${escapeHtml(order.link)}" target="_blank" rel="noopener" style="font-size:var(--font-size-sm);">Link öffnen</a>` : ''}
      ${
        order.paypalLink
          ? (() => {
              const email = paypalEmailFromLink(order.paypalLink);
              return `<a
                href="${escapeHtml(order.paypalLink)}"
                target="_blank"
                rel="noopener"
                style="font-size:var(--font-size-sm);"
                ${email ? `data-copy-paypal-email="${escapeHtml(email)}" title="Öffnet PayPal und kopiert ${escapeHtml(email)} zum Einfügen."` : ''}
              >PayPal öffnen</a>`;
            })()
          : ''
      }
    </div>`;
}

function renderOpenOrder(order, myId) {
  return `
    <div class="card stack food-order-card" data-order-card="${order.id}">
      <div class="row-between">
        <strong>${escapeHtml(order.title)}</strong>
        <span class="badge badge-playing">Offen</span>
      </div>
      <div class="muted food-order-meta">
        von ${escapeHtml(order.createdByName)} · ${formatDateTime(order.createdAt)}
      </div>
      ${renderDetails(order)}
      <div class="food-order-items">${renderItems(order, myId)}</div>
      ${renderOrderSummary(order)}
      ${
        myId
          ? `<form class="food-order-item-form" data-add-item-form="${order.id}">
               <input type="text" data-item-desc placeholder="z.B. Margherita groß" maxlength="120" required aria-label="Artikelbezeichnung" />
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
      }
    </div>`;
}

// The "Abgeschickt" (submitted) state — items are frozen for others, but the
// creator/an admin can still reopen it, toggle paid status, and edit
// metadata — is deliberately kept visually and textually distinct from
// "Geschlossen" (finalized, fully locked): a different badge color
// (badge-paused vs badge-offline, matching the amber/gray "pausiert"/
// "offline" state language used elsewhere) plus different wording.
function renderClosedOrder(order, myId) {
  const itemCount = order.items.reduce((sum, item) => sum + (item.quantity ?? 1), 0);
  const finalized = Boolean(order.finalizedAt);
  const totalCents = addTipToCents(order.totalCents, order.tipPercent);
  return `
    <article class="card stack food-order-card" data-closed-order="${order.id}">
      <div class="row-between">
        <strong>${escapeHtml(order.title)}</strong>
        <span class="badge ${finalized ? 'badge-offline' : 'badge-paused'}">${finalized ? 'Geschlossen' : 'Abgeschickt'}</span>
      </div>
      <div class="muted food-order-meta">
        ${itemCount} ${itemCount === 1 ? 'Position' : 'Positionen'}${totalCents > 0 ? ` · ${formatCents(totalCents)}${order.tipPercent ? ' inkl. Trinkgeld' : ''}` : ''}
      </div>
      ${renderDetails(order, { locked: finalized })}
      <div class="food-order-items">${renderItems(order, myId, { locked: finalized })}</div>
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
          <label for="order-link" class="field-label">Link (optional)</label>
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
          ? 'Die neue Sammelbestellung mit allen eingegebenen Angaben (Titel, Link, PayPal, Trinkgeld …) geht verloren.'
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
            return showToast('Link muss mit http:// oder https:// beginnen.', { error: true });
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
          <label for="link-input" class="field-label">Link</label>
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
        return dirty ? 'Deine Änderungen an Info, Link, PayPal oder Trinkgeld werden nicht gespeichert.' : null;
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
            return showToast('Link muss mit http:// oder https:// beginnen.', { error: true });
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
        : `<div class="two-column-card-grid food-order-grid">${openOrders.map((o) => renderOpenOrder(o, myId)).join('')}</div>`;

  container.innerHTML = `
    <button type="button" class="btn btn-sm" data-navigate="more">${icon('chevronLeft')} Zurück</button>
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
        ctx.rerender();
      } catch (err) {
        submitBtn.disabled = false;
        showToast(err.message, { error: true });
      }
    });
  });

  container.querySelectorAll('[data-remove-item]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      try {
        await api.foodOrders.removeItem(btn.dataset.order, btn.dataset.removeItem, myId);
        cache = null;
        ctx.rerender();
      } catch (err) {
        showToast(err.message, { error: true });
      }
    });
  });

  container.querySelectorAll('[data-toggle-paid]').forEach((checkbox) => {
    checkbox.addEventListener('change', async () => {
      const paid = checkbox.checked;
      try {
        await api.foodOrders.setItemPaid(checkbox.dataset.order, checkbox.dataset.togglePaid, paid);
        const order = cache?.find((o) => o.id === checkbox.dataset.order);
        const item = order?.items.find((i) => i.id === checkbox.dataset.togglePaid);
        if (item) item.paid = paid;
        // A paid position has nothing left to collect, so a leftover
        // Sammelzahlung mark on it would be misleading.
        if (paid) selectedForPayment.delete(checkbox.dataset.togglePaid);
        ctx.rerender();
      } catch (err) {
        // The native checkbox already flipped its own visual state on click;
        // undo that so it doesn't disagree with the server after a failure.
        checkbox.checked = !paid;
        showToast(err.message, { error: true });
      }
    });
  });

  container.querySelectorAll('[data-select-pay]').forEach((button) => {
    button.addEventListener('click', () => {
      const itemId = button.dataset.selectPay;
      if (selectedForPayment.has(itemId)) selectedForPayment.delete(itemId);
      else selectedForPayment.add(itemId);
      ctx.rerender();
    });
  });

  container.querySelectorAll('[data-mark-selected-paid]').forEach((button) => {
    button.addEventListener('click', async () => {
      const order = cache?.find((o) => o.id === button.dataset.markSelectedPaid);
      const targets = order?.items.filter((i) => selectedForPayment.has(i.id) && !i.paid) ?? [];
      if (targets.length === 0) return;
      button.disabled = true;
      try {
        await Promise.all(targets.map((i) => api.foodOrders.setItemPaid(order.id, i.id, true)));
        for (const i of targets) {
          i.paid = true;
          selectedForPayment.delete(i.id);
        }
        ctx.rerender();
      } catch (err) {
        // A partial failure across several requests could leave the local
        // cache disagreeing with the server for some items - reload instead
        // of guessing which ones actually went through.
        cache = null;
        showToast(err.message, { error: true });
        ctx.rerender();
      }
    });
  });

  container.querySelectorAll('[data-copy-paypal-email]').forEach((a) => {
    a.addEventListener('click', () => copyPaypalEmailToClipboard(a.dataset.copyPaypalEmail));
  });

  container.querySelectorAll('[data-copy-food-total]').forEach((button) => {
    button.addEventListener('click', () => copyFoodOrderTotal(button.dataset.copyFoodTotal));
  });

  // A "Bezahlen" link (single position or the combined Sammelzahlung) always
  // re-checks with the server right before opening PayPal - the local view
  // only updates when its own realtime event arrives, and someone else could
  // have marked one of these exact positions paid in the meantime. Opening
  // PayPal for money that's already settled would be worse than a moment's
  // delay, so the link never navigates on the stale, already-rendered state.
  container.querySelectorAll('[data-pay-order]').forEach((link) => {
    link.addEventListener('click', async (event) => {
      event.preventDefault();
      // Open the tab synchronously, as a direct consequence of the click,
      // before the re-check below crosses an async boundary: Safari/iOS (and
      // increasingly other browsers) only allow window.open() to succeed
      // within that same synchronous user-gesture window and silently block
      // it afterwards - with no error, PayPal would just never open. The tab
      // starts blank and is only pointed at PayPal, or closed again, once
      // the check resolves. Passing 'noopener' here would make window.open()
      // always return null per spec, regardless of whether a tab actually
      // opened, leaving nothing to redirect later - severing .opener by hand
      // once we have the reference keeps the same "destination can't reach
      // back into this page" protection without losing that reference.
      // Copying the PayPal email (if any) is subject to the same
      // synchronous-activation rule as Clipboard writes, so it happens here
      // too rather than after the await.
      const popup = window.open('', '_blank');
      if (popup) popup.opener = null;
      if (link.dataset.payEmail) copyPaypalEmailToClipboard(link.dataset.payEmail);
      const orderId = link.dataset.payOrder;
      const itemIds = link.dataset.payItems.split(',').filter(Boolean);
      let alreadyPaid;
      try {
        const res = await api.foodOrders.list();
        cache = res.orders;
        const order = cache.find((o) => o.id === orderId);
        if (!order) {
          popup?.close();
          showToast('Diese Bestellung existiert nicht mehr.', { error: true });
          ctx.rerender();
          return;
        }
        const items = order.items.filter((i) => itemIds.includes(i.id));
        if (items.length < itemIds.length) {
          popup?.close();
          showToast('Diese Position existiert nicht mehr.', { error: true });
          ctx.rerender();
          return;
        }
        alreadyPaid = items.filter((i) => i.paid);
      } catch (err) {
        popup?.close();
        showToast(err.message, { error: true });
        return;
      }
      if (alreadyPaid.length > 0) {
        popup?.close();
        for (const i of alreadyPaid) selectedForPayment.delete(i.id);
        const names = alreadyPaid.map((i) => i.description).join(', ');
        showToast(
          itemIds.length > 1
            ? `Inzwischen bereits bezahlt und aus der Auswahl entfernt: ${names}. Bitte Auswahl und Betrag prüfen.`
            : `„${names}“ ist inzwischen bereits als bezahlt markiert.`,
          { error: true }
        );
        ctx.rerender();
        return;
      }
      if (popup) popup.location = link.href;
      else window.open(link.href, '_blank', 'noopener');
    });
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
}
