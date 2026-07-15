// "Durchsage" view: one message out to everyone at once ("Essen ist
// da!") — lands as a toast on every open device, as a banner on the kiosk
// screen, and as a push notification on opted-in phones. Needs an identity
// (the sender's name is always attached), reuses the shared whoami card.

import { api } from '../api.js';
import { escapeHtml, formatDateTime } from '../format.js';
import { showToast } from '../toast.js';
import { getMyId, whoAmICardHtml, wireWhoAmICard } from '../whoami.js';
import { dateTimeFieldHtml, wireDateTimeField } from '../dateTimeField.js';
import { icon } from '../icons.js';
import { domainIcon } from '../domainIcons.js';

let historyCache = null;
let historyLoading = false;

async function loadHistory(ctx) {
  historyLoading = true;
  try {
    const res = await api.broadcasts.list();
    historyCache = res.broadcasts;
  } catch {
    historyCache = [];
  } finally {
    historyLoading = false;
    ctx.rerender();
  }
}

// Called from app.js on every broadcast:new socket event so the history
// list is fresh next time this view renders.
export function invalidateBroadcasts() {
  historyCache = null;
}

function renderHistory(myId) {
  if (historyLoading || historyCache === null) {
    return `<div class="empty-state" style="padding:var(--space-4);">Lädt…</div>`;
  }
  if (historyCache.length === 0) {
    return `<div class="empty-state"><span class="empty-state-icon">${icon(domainIcon('broadcast'))}</span>Noch keine Durchsagen.</div>`;
  }
  const now = Date.now();
  return historyCache
    .map((b) => {
      const active = !b.endedAt && b.endsAt > now;
      const status = b.endedAt
        ? `Beendet am ${formatDateTime(b.endedAt)} Uhr`
        : active
          ? `Sichtbar bis ${formatDateTime(b.endsAt)} Uhr`
          : `Abgelaufen am ${formatDateTime(b.endsAt)} Uhr`;
      return `
      <div class="lb-row" style="align-items:flex-start;" data-broadcast="${b.id}">
        <div class="stack" style="gap:var(--space-1);flex:1;">
          <div><strong>${escapeHtml(b.playerName)}</strong>: ${escapeHtml(b.message)}</div>
          <span class="muted" style="font-size:var(--font-size-xs);">${formatDateTime(b.createdAt)} Uhr · ${status}</span>
        </div>
        ${active && b.playerId === myId ? `<button type="button" class="btn btn-sm btn-danger" data-end-broadcast="${b.id}">Beenden</button>` : ''}
      </div>`;
    })
    .join('');
}

export function renderBroadcast(container, ctx) {
  if (historyCache === null && !historyLoading) loadHistory(ctx);

  const myId = getMyId();

  // Re-renders arrive asynchronously (history load, socket events) and
  // replace the whole view — preserve whatever the user is mid-typing, or
  // the message field silently empties under their thumbs.
  const prevInput = container.querySelector('#broadcast-message');
  const prevValue = prevInput?.value ?? '';
  const hadFocus = prevInput && document.activeElement === prevInput;
  const prevEndsAtValue = container.querySelector('#broadcast-ends-at')?.value ?? '';
  const parsedEndsAt = prevEndsAtValue ? new Date(prevEndsAtValue).getTime() : NaN;
  const displayEndsAt = Number.isFinite(parsedEndsAt) ? parsedEndsAt : Date.now() + 60 * 60 * 1000;

  container.innerHTML = `
    <button type="button" class="btn btn-sm" data-navigate="more">${icon('chevronLeft')} Zurück</button>
    <h1 class="view-title">Durchsage</h1>
    ${whoAmICardHtml('broadcast-whoami', { marginBottom: '12px' })}
    <div class="grouped-page-sections">
      <section class="card stack grouped-page-section" aria-labelledby="broadcast-new-title">
        <div class="grouped-page-section-title"><h2 id="broadcast-new-title">Neue Durchsage</h2></div>
        <form id="broadcast-form" class="stack">
          <div>
            <label for="broadcast-message" class="field-label">Nachricht</label>
            <input type="text" id="broadcast-message" placeholder="z.B. Essen ist da!" maxlength="200" ${myId ? '' : 'disabled'} />
          </div>
          <div>
            <label for="broadcast-ends-at" class="field-label">Sichtbar bis</label>
            ${dateTimeFieldHtml('broadcast-ends-at', displayEndsAt, { disabled: !myId })}
          </div>
          <button type="submit" class="btn btn-primary" ${myId ? '' : 'disabled'}>Senden</button>
        </form>
        <p class="muted" style="font-size:var(--font-size-xs);margin:0;">
          Erscheint sofort auf allen offenen Geräten, auf dem Kiosk-Bildschirm und als
          Push-Benachrichtigung bei allen, die Push aktiviert haben.
        </p>
      </section>
      <section class="card stack grouped-page-section" aria-labelledby="broadcast-history-title">
        <div class="grouped-page-section-title"><h2 id="broadcast-history-title">Letzte Durchsagen</h2></div>
        ${renderHistory(myId)}
      </section>
    </div>
  `;

  wireWhoAmICard(container, 'broadcast-whoami', ctx);
  wireDateTimeField(container, 'broadcast-ends-at');

  const messageInput = container.querySelector('#broadcast-message');
  if (prevValue) messageInput.value = prevValue;
  if (hadFocus) messageInput.focus();

  container.querySelector('#broadcast-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const input = container.querySelector('#broadcast-message');
    const message = input.value.trim();
    const endsAtInput = container.querySelector('#broadcast-ends-at');
    const endsAt = new Date(endsAtInput.value).getTime();
    if (!message) return;
    if (!myId) return showToast('Bitte zuerst auswählen, wer du bist.', { error: true });
    if (!Number.isFinite(endsAt) || endsAt <= Date.now()) {
      return showToast('Bitte einen Endzeitpunkt in der Zukunft wählen.', { error: true });
    }
    const submitBtn = container.querySelector('#broadcast-form button[type="submit"]');
    if (submitBtn.disabled) return;
    submitBtn.disabled = true;
    try {
      await api.broadcasts.send(myId, message, endsAt);
      // A broadcast:new socket event may have re-rendered the form while the
      // request was in flight, so clear the currently mounted fields rather
      // than only the now-detached references captured before await.
      const currentInput = container.querySelector('#broadcast-message');
      const currentEndsAtInput = container.querySelector('#broadcast-ends-at');
      if (currentInput) currentInput.value = '';
      if (currentEndsAtInput) currentEndsAtInput.value = '';
      historyCache = null;
      showToast('Durchsage gesendet.');
      ctx.rerender();
    } catch (err) {
      submitBtn.disabled = false;
      showToast(err.message, { error: true });
    }
  });

  container.querySelectorAll('[data-end-broadcast]').forEach((button) => {
    button.addEventListener('click', async () => {
      if (!myId || button.disabled) return;
      button.disabled = true;
      try {
        await api.broadcasts.end(button.dataset.endBroadcast, myId);
        historyCache = null;
        showToast('Durchsage beendet.');
        ctx.rerender();
      } catch (err) {
        button.disabled = false;
        showToast(err.message, { error: true });
      }
    });
  });
}
