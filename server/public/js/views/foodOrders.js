// "Essen bestellen" view: Sammelbestellungen. Someone opens an order
// ("Pizza bei Luigi's"), everyone adds their own items (free text, price
// optional) from their own phone, closing freezes the list into a read-out
// view grouped per person — the "wer wollte nochmal was?" round through the
// room becomes one glance at the screen.

import { api } from '../api.js';
import { state } from '../state.js';
import { escapeHtml, avatarHtml, formatDateTime, toDatetimeLocal } from '../format.js';
import { openModal } from '../modal.js';
import { showToast } from '../toast.js';
import { getMyId, whoAmICardHtml, wireWhoAmICard } from '../whoami.js';

let cache = null;
let loading = false;

// Which closed orders are expanded. Module-level rather than read off the
// DOM: any mutation clears `cache` before calling ctx.rerender(), which
// synchronously re-renders once with an empty list (cache still null) and
// only picks up the reload's result on a second, later rerender — reading
// "current DOM state" at render time would see nothing on that second pass,
// since the first pass already wiped the <details> elements out.
const expandedClosedOrderIds = new Set();

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

function formatCents(cents) {
  return `${(cents / 100).toFixed(2).replace('.', ',')} €`;
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
    return `<div class="muted" style="font-size:0.85rem;padding:6px 0;">Noch nichts eingetragen.</div>`;
  }
  const grouped = itemsGroupedByPlayer(order);
  return [...grouped.entries()]
    .map(([playerId, items]) => {
      const first = items[0];
      const playerSum = items.reduce((sum, i) => sum + (i.priceCents ?? 0), 0);
      const player = state.players.find((p) => p.id === playerId) || { color: first.playerColor };
      const rows = items
        .map(
          (i) => `
          <div class="row" style="padding:2px 0;">
            <span style="flex:1;">${escapeHtml(i.description)}</span>
            ${i.priceCents !== null ? `<span class="muted" style="font-variant-numeric:tabular-nums;">${formatCents(i.priceCents)}</span>` : ''}
            ${
              order.open && i.playerId === myId
                ? `<button type="button" class="icon-btn" data-remove-item="${i.id}" data-order="${order.id}" aria-label="Entfernen" style="font-size:0.8rem;padding:0 4px;">✕</button>`
                : ''
            }
          </div>`
        )
        .join('');
      return `
        <div class="stack" style="gap:2px;padding:8px 0;border-bottom:1px solid var(--border);">
          <div class="row" style="gap:8px;">
            ${avatarHtml(player, 20)}
            <strong style="flex:1;">${escapeHtml(first.playerName)}</strong>
            ${playerSum > 0 ? `<span class="muted" style="font-size:0.8rem;">${formatCents(playerSum)}</span>` : ''}
          </div>
          <div style="padding-left:28px;">${rows}</div>
        </div>`;
    })
    .join('');
}

// "Geht raus um ..." line shown on both open and closed orders, with an
// edit affordance — the deadline is metadata people commonly get wrong or
// need to shift ("doch erst um 21 Uhr"), so it stays correctable even after
// the order closed, unlike the items themselves.
function renderSendAt(order) {
  const label = order.sendAt
    ? `🕒 Geht raus um ${formatDateTime(order.sendAt)} Uhr`
    : '🕒 Kein Zeitpunkt festgelegt';
  return `
    <div class="row-between">
      <span class="muted" style="font-size:0.82rem;">${label}</span>
      <button type="button" class="btn btn-sm" data-edit-sendat="${order.id}">${order.sendAt ? 'Ändern' : '+ Zeitpunkt'}</button>
    </div>`;
}

function renderOpenOrder(order, myId) {
  return `
    <div class="card stack" data-order-card="${order.id}">
      <div class="row-between">
        <strong>🍕 ${escapeHtml(order.title)}</strong>
        <span class="badge badge-playing">Offen</span>
      </div>
      <div class="muted" style="font-size:0.78rem;margin-top:-6px;">
        von ${escapeHtml(order.createdByName)} · ${formatDateTime(order.createdAt)}
      </div>
      ${renderSendAt(order)}
      <div>${renderItems(order, myId)}</div>
      ${order.totalCents > 0 ? `<div class="row-between"><strong>Summe</strong><strong>${formatCents(order.totalCents)}</strong></div>` : ''}
      ${
        myId
          ? `<form class="row" data-add-item-form="${order.id}">
               <input type="text" data-item-desc placeholder="z.B. 1x Margherita groß" maxlength="120" required style="flex:1;" />
               <input type="text" data-item-price placeholder="€" inputmode="decimal" style="width:70px;flex-shrink:0;" />
               <button type="submit" class="btn btn-primary btn-sm">+</button>
             </form>`
          : `<div class="muted" style="font-size:0.85rem;">Wähle oben, wer du bist, um dich einzutragen.</div>`
      }
      <button type="button" class="btn btn-sm" data-close-order="${order.id}">✅ Bestellung schließen</button>
    </div>`;
}

function renderClosedOrder(order) {
  return `
    <details class="card" style="margin-bottom:12px;" data-closed-order="${order.id}" ${expandedClosedOrderIds.has(order.id) ? 'open' : ''}>
      <summary style="cursor:pointer;" class="row-between">
        <span><strong>${escapeHtml(order.title)}</strong> <span class="muted" style="font-size:0.8rem;">· ${order.items.length} Position(en)${order.totalCents > 0 ? ` · ${formatCents(order.totalCents)}` : ''}</span></span>
        <span class="badge badge-offline">Geschlossen</span>
      </summary>
      <div style="margin-top:10px;">${renderSendAt(order)}</div>
      <div style="margin-top:10px;">${renderItems(order, null)}</div>
    </details>`;
}

function openNewOrderForm(ctx, myId) {
  const { close } = openModal(
    'Neue Sammelbestellung',
    `
      <form id="order-form" class="stack">
        <input type="text" id="order-title" maxlength="80" required autofocus placeholder="z.B. Pizza bei Luigi's" />
        <div>
          <label for="order-sendat" class="field-label">Geht raus um (optional)</label>
          <input type="datetime-local" id="order-sendat" />
        </div>
        <p class="muted" style="font-size:0.8rem;margin:0;">
          Alle bekommen eine Benachrichtigung und können sich dann selbst eintragen. Der Zeitpunkt
          lässt sich später jederzeit ändern.
        </p>
        <button type="submit" class="btn btn-primary btn-block">Bestellung öffnen</button>
      </form>
    `,
    {
      onMount: (el) => {
        el.querySelector('#order-form').addEventListener('submit', async (e) => {
          e.preventDefault();
          const title = el.querySelector('#order-title').value.trim();
          if (!title) return;
          const sendAtRaw = el.querySelector('#order-sendat').value;
          const sendAt = sendAtRaw ? new Date(sendAtRaw).getTime() : undefined;
          try {
            await api.foodOrders.create(myId, title, sendAt);
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

function openSendAtForm(ctx, order) {
  const { close } = openModal(
    'Zeitpunkt festlegen',
    `
      <form id="sendat-form" class="stack">
        <div>
          <label for="sendat-input" class="field-label">Geht raus um</label>
          <input type="datetime-local" id="sendat-input" value="${order.sendAt ? toDatetimeLocal(order.sendAt) : ''}" />
        </div>
        <button type="submit" class="btn btn-primary btn-block">Speichern</button>
        ${order.sendAt ? `<button type="button" class="btn btn-danger btn-block" id="sendat-clear">Zeitpunkt entfernen</button>` : ''}
      </form>
    `,
    {
      onMount: (el) => {
        el.querySelector('#sendat-form').addEventListener('submit', async (e) => {
          e.preventDefault();
          const raw = el.querySelector('#sendat-input').value;
          if (!raw) return showToast('Bitte einen Zeitpunkt wählen (oder „Entfernen" nutzen).', { error: true });
          try {
            await api.foodOrders.setSendAt(order.id, new Date(raw).getTime());
            close();
            cache = null;
            showToast('Zeitpunkt gespeichert.');
            ctx.rerender();
          } catch (err) {
            showToast(err.message, { error: true });
          }
        });
        const clearBtn = el.querySelector('#sendat-clear');
        if (clearBtn) {
          clearBtn.addEventListener('click', async () => {
            try {
              await api.foodOrders.setSendAt(order.id, null);
              close();
              cache = null;
              showToast('Zeitpunkt entfernt.');
              ctx.rerender();
            } catch (err) {
              showToast(err.message, { error: true });
            }
          });
        }
      },
    }
  );
}

export function renderFoodOrders(container, ctx) {
  if (cache === null && !loading) load(ctx);

  const myId = getMyId();

  // Every teammate adding an item fires foodOrders:changed and re-renders
  // this view on all devices — preserve what THIS user is mid-typing in the
  // add-item forms, or their half-written "1x Margherita" vanishes whenever
  // someone else is faster.
  const prevForms = new Map();
  container.querySelectorAll('[data-add-item-form]').forEach((f) => {
    const desc = f.querySelector('[data-item-desc]');
    const price = f.querySelector('[data-item-price]');
    prevForms.set(f.dataset.addItemForm, {
      desc: desc?.value ?? '',
      price: price?.value ?? '',
      focus: document.activeElement === desc ? 'desc' : document.activeElement === price ? 'price' : null,
    });
  });
  const orders = cache || [];
  const openOrders = orders.filter((o) => o.open);
  const closedOrders = orders.filter((o) => !o.open);

  const openHtml =
    loading || cache === null
      ? `<div class="empty-state">Lädt…</div>`
      : openOrders.length === 0
        ? `<div class="empty-state"><span class="emoji">🍕</span>Gerade keine offene Bestellung.<br />
           <span class="muted" style="font-size:0.85rem;">Starte eine, wenn ihr was bestellen wollt – alle können sich dann selbst eintragen.</span></div>`
        : `<div class="stack">${openOrders.map((o) => renderOpenOrder(o, myId)).join('')}</div>`;

  container.innerHTML = `
    <button type="button" class="btn btn-sm" data-navigate="more">‹ Zurück</button>
    <div class="row-between">
      <h1 class="view-title">🍕 Essen bestellen</h1>
      <button type="button" class="btn btn-primary btn-sm" id="order-new-btn" ${myId ? '' : 'disabled'}>+ Bestellung</button>
    </div>
    ${whoAmICardHtml('food-whoami', { marginBottom: '12px' })}
    ${openHtml}
    ${closedOrders.length ? `<div class="section-title">🕓 Frühere Bestellungen</div>${closedOrders.map(renderClosedOrder).join('')}` : ''}
  `;

  wireWhoAmICard(container, 'food-whoami', ctx);

  container.querySelectorAll('[data-add-item-form]').forEach((f) => {
    const prev = prevForms.get(f.dataset.addItemForm);
    if (!prev) return;
    const desc = f.querySelector('[data-item-desc]');
    const price = f.querySelector('[data-item-price]');
    if (prev.desc) desc.value = prev.desc;
    if (prev.price) price.value = prev.price;
    if (prev.focus === 'desc') desc.focus();
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
      const priceInput = form.querySelector('[data-item-price]');
      const description = descInput.value.trim();
      if (!description) return;
      const priceCents = parsePriceToCents(priceInput.value);
      if (Number.isNaN(priceCents)) {
        return showToast('Preis bitte als Betrag angeben, z.B. 4,50', { error: true });
      }
      const submitBtn = form.querySelector('button[type="submit"]');
      if (submitBtn.disabled) return;
      submitBtn.disabled = true;
      try {
        await api.foodOrders.addItem(orderId, { playerId: myId, description, priceCents: priceCents ?? undefined });
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

  container.querySelectorAll('[data-closed-order]').forEach((details) => {
    details.addEventListener('toggle', () => {
      if (details.open) expandedClosedOrderIds.add(details.dataset.closedOrder);
      else expandedClosedOrderIds.delete(details.dataset.closedOrder);
    });
  });

  container.querySelectorAll('[data-edit-sendat]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const order = orders.find((o) => o.id === btn.dataset.editSendat);
      if (order) openSendAtForm(ctx, order);
    });
  });

  container.querySelectorAll('[data-close-order]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      if (!confirm('Bestellung schließen? Danach kann niemand mehr etwas eintragen.')) return;
      try {
        await api.foodOrders.close(btn.dataset.closeOrder);
        cache = null;
        showToast('Bestellung geschlossen.');
        ctx.rerender();
      } catch (err) {
        showToast(err.message, { error: true });
      }
    });
  });
}
