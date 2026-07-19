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
import { getMyId, whoAmICardHtml, wireWhoAmICard } from '../whoami.js';
import { icon } from '../icons.js';
import { dateTimeFieldHtml, wireDateTimeField } from '../dateTimeField.js';

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

// Lets people type just their paypal.me name ("blorbeer", "@blorbeer",
// pasted "paypal.me/blorbeer" without a scheme, …) instead of having to
// paste the whole https://paypal.me/… URL. A full http(s) link is passed
// through untouched so anyone who prefers a different payment page can
// still use it. Returns null for empty input; throws a user-facing message
// for input that's neither a link nor a usable name.
export function normalizePaypalInput(raw) {
  const trimmed = (raw ?? '').trim();
  if (!trimmed) return null;
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  const name = trimmed
    .replace(/^@/, '')
    .replace(/^(www\.)?paypal\.me\//i, '')
    .replace(/\/+$/, '');
  if (!name || /\s/.test(name)) {
    throw new Error('PayPal-Link muss eine gültige URL oder ein PayPal.me-Name ohne Leerzeichen sein.');
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
  return [...grouped.entries()]
    .map(([playerId, items]) => {
      const first = items[0];
      const playerSum = items.reduce((sum, i) => sum + (i.priceCents ?? 0) * (i.quantity ?? 1), 0);
      const player = state.players.find((p) => p.id === playerId) || { color: first.playerColor };
      const rows = items
        .map((i) => {
          const quantity = i.quantity ?? 1;
          const lineTotal = i.priceCents === null ? null : i.priceCents * quantity;
          const priceHtml = lineTotal === null
            ? ''
            : `<span class="food-order-item-price">
                <strong>${formatCents(lineTotal)}</strong>
                ${quantity > 1 ? `<span class="muted">${quantity} × ${formatCents(i.priceCents)}</span>` : ''}
              </span>`;
          const selected = selectedForPayment.has(i.id);
          return `
          <div class="row food-order-item ${i.paid ? 'is-paid' : ''} ${selected ? 'is-selected-for-payment' : ''}">
            <label class="food-order-item-paid-toggle">
              <input type="checkbox" data-toggle-paid="${i.id}" data-order="${order.id}" ${i.paid ? 'checked' : ''} ${locked ? 'disabled' : ''} aria-label="Als bezahlt markieren" />
            </label>
            <span style="flex:1;"><strong>${quantity} ×</strong> ${escapeHtml(i.description)}</span>
            ${priceHtml}
            ${
              order.paypalLink
                ? `<label class="food-order-item-pay-select">
                     <input type="checkbox" data-select-pay="${i.id}" ${selected ? 'checked' : ''} aria-label="Für gemeinsame Zahlung auswählen" />
                   </label>`
                : ''
            }
            ${
              !locked && order.open && i.playerId === myId
                ? `<button type="button" class="icon-btn food-order-item-remove" data-remove-item="${i.id}" data-order="${order.id}" aria-label="Entfernen">${icon('x')}</button>`
                : ''
            }
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
          ${
            playerSum > 0
              ? `<div class="row-between food-order-player-total"><span class="muted">Zwischensumme</span><strong>${formatCents(playerSum)}</strong></div>`
              : ''
          }
        </div>`;
    })
    .join('');
}

// Lets anyone build a combined PayPal payment out of any mix of items —
// their own, someone else's, or both — via the per-item checkboxes above.
// Tip is applied to the selected subtotal, not the whole order. If any
// selected item has no price, the sum would silently undercount it, so the
// amount is withheld entirely and the raw PayPal link opens instead
// (paypalPayUrl only appends an amount when cents > 0).
function renderPaymentSelector(order) {
  // A selection can outlive the PayPal link it was made for — the creator
  // might clear it via "Info bearbeiten" while items are still selected on
  // someone else's device — so bail out before paypalPayUrl(null, …) throws.
  if (!order.paypalLink) return '';
  const selectedItems = order.items.filter((i) => selectedForPayment.has(i.id));
  if (selectedItems.length === 0) return '';

  const allPriced = selectedItems.every((i) => i.priceCents !== null);
  const rawCents = selectedItems.reduce((sum, i) => sum + (i.priceCents ?? 0) * (i.quantity ?? 1), 0);
  const tipPercent = order.tipPercent || 0;
  const payableCents = allPriced ? Math.round(rawCents * (1 + tipPercent / 100)) : 0;
  const amountLabel = allPriced
    ? `${formatCents(payableCents)}${tipPercent > 0 ? ` (inkl. ${tipPercent}% Trinkgeld)` : ''}`
    : 'Preis unvollständig – Betrag manuell eingeben';

  return `
    <div class="row-between food-order-payment-selector">
      <span class="muted">${selectedItems.length} ${selectedItems.length === 1 ? 'Position' : 'Positionen'} ausgewählt · ${amountLabel}</span>
      <a class="btn btn-sm btn-primary" href="${escapeHtml(paypalPayUrl(order.paypalLink, payableCents))}" target="_blank" rel="noopener">Bezahlen</a>
    </div>`;
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
      ${order.paypalLink ? `<a href="${escapeHtml(order.paypalLink)}" target="_blank" rel="noopener" style="font-size:var(--font-size-sm);">PayPal öffnen</a>` : ''}
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
      ${order.totalCents > 0 ? `<div class="row-between food-order-total"><strong>Gesamtsumme</strong><strong>${formatCents(order.totalCents)}</strong></div>` : ''}
      ${renderPaymentSelector(order)}
      ${
        myId
          ? `<form class="food-order-item-form" data-add-item-form="${order.id}">
               <input type="text" data-item-desc placeholder="z.B. Margherita groß" maxlength="120" required />
               <label class="food-order-quantity-field">
                 <input type="number" class="food-order-quantity-input" data-item-quantity placeholder="Anzahl" min="1" max="99" inputmode="numeric" aria-label="Anzahl" />
                 <span aria-hidden="true">×</span>
               </label>
               <label class="food-order-price-field">
                 <input type="text" class="food-order-price-input" data-item-price placeholder="Preis" inputmode="decimal" aria-label="Einzelpreis" />
                 <span aria-hidden="true">€</span>
               </label>
               <button type="submit" class="btn btn-sm food-order-add-button">Hinzufügen</button>
             </form>`
          : `<div class="muted" style="font-size:var(--font-size-sm);">Wähle oben, wer du bist, um dich einzutragen.</div>`
      }
      <div class="food-order-close-action">
        <button type="button" class="btn btn-primary btn-sm btn-block" data-close-order="${order.id}">Bestellung abschicken</button>
      </div>
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
  return `
    <article class="card stack food-order-card" data-closed-order="${order.id}">
      <div class="row-between">
        <strong>${escapeHtml(order.title)}</strong>
        <span class="badge ${finalized ? 'badge-offline' : 'badge-paused'}">${finalized ? 'Geschlossen' : 'Abgeschickt'}</span>
      </div>
      <div class="muted food-order-meta">
        ${itemCount} ${itemCount === 1 ? 'Position' : 'Positionen'}${order.totalCents > 0 ? ` · ${formatCents(order.totalCents)}` : ''}
      </div>
      ${renderDetails(order, { locked: finalized })}
      <div class="food-order-items">${renderItems(order, myId, { locked: finalized })}</div>
      ${renderPaymentSelector(order)}
      ${
        finalized
          ? ''
          : `<div class="food-order-close-action stack" style="gap:var(--space-2);">
               <button type="button" class="btn btn-sm btn-block" data-reopen-order="${order.id}">Wieder öffnen</button>
               <button type="button" class="btn btn-danger btn-sm btn-block" data-finalize-order="${order.id}">Bestellung schließen</button>
             </div>`
      }
    </article>`;
}

function openNewOrderForm(ctx, myId) {
  const { close } = openModal(
    'Neue Sammelbestellung',
    `
      <form id="order-form" class="stack">
        <input type="text" id="order-title" maxlength="80" required autofocus placeholder="z.B. Pizza bei Luigi's" />
        <div>
          <label for="order-sendat" class="field-label">Versand (optional)</label>
          ${dateTimeFieldHtml('order-sendat', null, { clearable: true })}
        </div>
        <div>
          <label for="order-notes" class="field-label">Info (optional)</label>
          <textarea id="order-notes" rows="2" maxlength="500" placeholder="z.B. Mindestbestellwert 15€, bar zahlen"></textarea>
        </div>
        <div>
          <label for="order-link" class="field-label">Link (optional)</label>
          <input type="url" id="order-link" maxlength="300" placeholder="https://…" />
        </div>
        <div>
          <label for="order-paypal" class="field-label">PayPal.me-Name oder -Link (optional)</label>
          <input type="text" id="order-paypal" maxlength="300" placeholder="z.B. deinname oder https://paypal.me/deinname" />
        </div>
        <div>
          <label for="order-tip" class="field-label">Trinkgeld in % (optional)</label>
          <input type="number" id="order-tip" min="0" max="100" inputmode="numeric" placeholder="z.B. 10" />
        </div>
        <p class="muted" style="font-size:var(--font-size-xs);margin:0;">
          Alle bekommen eine Benachrichtigung und können sich dann selbst eintragen. Alles lässt
          sich später jederzeit ändern.
        </p>
        <button type="submit" class="btn btn-primary btn-block">Bestellung öffnen</button>
      </form>
    `,
    {
      onMount: (el) => {
        wireDateTimeField(el, 'order-sendat');
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
  const { close } = openModal(
    'Info bearbeiten',
    `
      <form id="details-form" class="stack">
        <div>
          <label for="sendat-input" class="field-label">Versand</label>
          ${dateTimeFieldHtml('sendat-input', order.sendAt, { clearable: true })}
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
          <label for="paypal-input" class="field-label">PayPal.me-Name oder -Link</label>
          <input type="text" id="paypal-input" maxlength="300" placeholder="z.B. deinname oder https://paypal.me/deinname" value="${escapeHtml(order.paypalLink ?? '')}" />
        </div>
        <div>
          <label for="tip-input" class="field-label">Trinkgeld in %</label>
          <input type="number" id="tip-input" min="0" max="100" inputmode="numeric" placeholder="z.B. 10" value="${order.tipPercent ?? ''}" />
        </div>
        <button type="submit" class="btn btn-primary btn-block">Speichern</button>
      </form>
    `,
    {
      onMount: (el) => {
        wireDateTimeField(el, 'sendat-input');
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
      ? `<div class="empty-state">Lädt…</div>`
      : openOrders.length === 0
        ? `<div class="empty-state">Gerade keine offene Bestellung.<br />
           <span class="muted" style="font-size:var(--font-size-sm);">Starte eine, wenn ihr was bestellen wollt – alle können sich dann selbst eintragen.</span></div>`
        : `<div class="two-column-card-grid food-order-grid">${openOrders.map((o) => renderOpenOrder(o, myId)).join('')}</div>`;

  container.innerHTML = `
    <button type="button" class="btn btn-sm" data-navigate="more">${icon('chevronLeft')} Zurück</button>
    <div class="row-between">
      <h1 class="view-title">Essen</h1>
      <button type="button" class="btn btn-primary btn-sm" id="order-new-btn" ${myId ? '' : 'disabled'}>Bestellung öffnen</button>
    </div>
    ${whoAmICardHtml('food-whoami')}
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

  wireWhoAmICard(container, 'food-whoami', ctx);

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
    checkbox.addEventListener('change', async (e) => {
      const paid = e.currentTarget.checked;
      try {
        await api.foodOrders.setItemPaid(checkbox.dataset.order, checkbox.dataset.togglePaid, paid);
        cache = null;
        ctx.rerender();
      } catch (err) {
        e.currentTarget.checked = !paid;
        showToast(err.message, { error: true });
      }
    });
  });

  container.querySelectorAll('[data-select-pay]').forEach((checkbox) => {
    checkbox.addEventListener('change', (e) => {
      const itemId = checkbox.dataset.selectPay;
      if (e.currentTarget.checked) selectedForPayment.add(itemId);
      else selectedForPayment.delete(itemId);
      ctx.rerender();
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
      if (!(await confirmDialog('Bestellung abschicken? Danach kann niemand mehr etwas eintragen.'))) return;
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
          'Bestellung schließen? Danach sind keine Änderungen mehr möglich – auch nicht durch erneutes Öffnen.'
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
}
