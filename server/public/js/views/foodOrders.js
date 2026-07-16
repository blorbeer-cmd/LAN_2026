// "Essen bestellen" view: Sammelbestellungen. Someone opens an order
// ("Pizza bei Luigi's"), everyone adds their own items (free text, price
// optional) from their own phone, closing freezes the list into a read-out
// view grouped per person — the "wer wollte nochmal was?" round through the
// room becomes one glance at the screen.

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

function itemsGroupedByPlayer(order) {
  const byPlayer = new Map();
  for (const item of order.items) {
    if (!byPlayer.has(item.playerId)) byPlayer.set(item.playerId, []);
    byPlayer.get(item.playerId).push(item);
  }
  return byPlayer;
}

function renderItems(order, myId) {
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
          return `
          <div class="row food-order-item">
            <span style="flex:1;"><strong>${quantity} ×</strong> ${escapeHtml(i.description)}</span>
            ${priceHtml}
            ${
              order.open && i.playerId === myId
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
          ${playerSum > 0 ? `<div class="row-between food-order-player-total"><span class="muted">Zwischensumme</span><strong>${formatCents(playerSum)}</strong></div>` : ''}
        </div>`;
    })
    .join('');
}

// Metadata block (send time / notes / link) shown on both open and closed
// orders, with a single edit affordance — all three are things people
// commonly get wrong or need to correct ("doch erst um 21 Uhr", "Link war
// falsch"), so they stay editable even after the order closed, unlike the
// items themselves.
function renderDetails(order) {
  const sendAtLabel = order.sendAt
    ? `Versand ${formatDateTime(order.sendAt)} Uhr`
    : 'Kein Zeitpunkt festgelegt';
  const hasDetails = Boolean(order.sendAt || order.notes || order.link);
  return `
    <div class="stack food-order-details">
      <div class="row-between">
        <span class="muted" style="font-size:var(--font-size-sm);">${sendAtLabel}</span>
        <button type="button" class="btn btn-sm" data-edit-details="${order.id}">${hasDetails ? 'Bearbeiten' : 'Info'}</button>
      </div>
      ${order.notes ? `<div class="muted" style="font-size:var(--font-size-sm);white-space:pre-wrap;word-break:break-word;">${escapeHtml(order.notes)}</div>` : ''}
      ${order.link ? `<a href="${escapeHtml(order.link)}" target="_blank" rel="noopener" style="font-size:var(--font-size-sm);">Link öffnen</a>` : ''}
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
      ${
        myId
          ? `<form class="food-order-item-form" data-add-item-form="${order.id}">
               <input type="text" data-item-desc placeholder="z.B. Margherita groß" maxlength="120" required />
               <input type="number" class="food-order-quantity-input" data-item-quantity value="1" min="1" max="99" inputmode="numeric" aria-label="Anzahl" />
               <label class="food-order-price-field">
                 <input type="text" class="food-order-price-input" data-item-price placeholder="Preis" inputmode="decimal" aria-label="Einzelpreis" />
                 <span aria-hidden="true">€</span>
               </label>
               <button type="submit" class="btn btn-sm food-order-add-button">Hinzufügen</button>
             </form>`
          : `<div class="muted" style="font-size:var(--font-size-sm);">Wähle oben, wer du bist, um dich einzutragen.</div>`
      }
      <div class="food-order-close-action">
        <button type="button" class="btn btn-primary btn-sm btn-block" data-close-order="${order.id}">Bestellung abschließen</button>
      </div>
    </div>`;
}

function renderClosedOrder(order) {
  const itemCount = order.items.reduce((sum, item) => sum + (item.quantity ?? 1), 0);
  return `
    <article class="card stack food-order-card">
      <div class="row-between">
        <strong>${escapeHtml(order.title)}</strong>
        <span class="badge badge-offline">Geschlossen</span>
      </div>
      <div class="muted food-order-meta">
        ${itemCount} ${itemCount === 1 ? 'Position' : 'Positionen'}${order.totalCents > 0 ? ` · ${formatCents(order.totalCents)}` : ''}
      </div>
      ${renderDetails(order)}
      <div class="food-order-items">${renderItems(order, null)}</div>
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
          try {
            await api.foodOrders.create(myId, title, { sendAt, notes, link });
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
          try {
            await api.foodOrders.updateDetails(order.id, { sendAt, notes, link });
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
      quantity: quantity?.value ?? '1',
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
                 <div class="two-column-card-grid food-order-grid">${closedOrders.map(renderClosedOrder).join('')}</div>
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
      if (!(await confirmDialog('Bestellung abschließen? Danach kann niemand mehr etwas eintragen.'))) return;
      try {
        await api.foodOrders.close(btn.dataset.closeOrder);
        cache = null;
        showToast('Bestellung abgeschlossen.');
        ctx.rerender();
      } catch (err) {
        showToast(err.message, { error: true });
      }
    });
  });
}
