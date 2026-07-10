// "Durchsage" view: one message out to everyone at once ("🍕 Essen ist
// da!") — lands as a toast on every open device, as a banner on the kiosk
// screen, and as a push notification on opted-in phones. Needs an identity
// (the sender's name is always attached), reuses the shared whoami card.

import { api } from '../api.js';
import { escapeHtml, formatDateTime } from '../format.js';
import { showToast } from '../toast.js';
import { getMyId, whoAmICardHtml, wireWhoAmICard } from '../whoami.js';

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

function renderHistory() {
  if (historyLoading || historyCache === null) {
    return `<div class="empty-state" style="padding:var(--space-4);">Lädt…</div>`;
  }
  if (historyCache.length === 0) {
    return `<div class="empty-state"><span class="emoji">📢</span>Noch keine Durchsagen.</div>`;
  }
  return historyCache
    .map(
      (b) => `
      <div class="lb-row" style="align-items:flex-start;">
        <div class="stack" style="gap:2px;flex:1;">
          <div><strong>${escapeHtml(b.playerName)}</strong>: ${escapeHtml(b.message)}</div>
          <span class="muted" style="font-size:var(--font-size-xs);">${formatDateTime(b.createdAt)}</span>
        </div>
      </div>`
    )
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

  container.innerHTML = `
    <button type="button" class="btn btn-sm" data-navigate="more">‹ Zurück</button>
    <h1 class="view-title">📢 Durchsage</h1>
    ${whoAmICardHtml('broadcast-whoami', { marginBottom: '12px' })}
    <div class="card stack">
      <form id="broadcast-form" class="row">
        <input type="text" id="broadcast-message" placeholder="z.B. Essen ist da!" maxlength="200" style="flex:1;" ${myId ? '' : 'disabled'} />
        <button type="submit" class="btn btn-primary" ${myId ? '' : 'disabled'}>Senden</button>
      </form>
      <p class="muted" style="font-size:var(--font-size-xs);margin:0;">
        Erscheint sofort auf allen offenen Geräten, auf dem Kiosk-Bildschirm und als
        Push-Benachrichtigung bei allen, die Push aktiviert haben.
      </p>
    </div>

    <div class="section-title">🕓 Letzte Durchsagen</div>
    <div class="card">${renderHistory()}</div>
  `;

  wireWhoAmICard(container, 'broadcast-whoami', ctx);

  const messageInput = container.querySelector('#broadcast-message');
  if (prevValue) messageInput.value = prevValue;
  if (hadFocus) messageInput.focus();

  container.querySelector('#broadcast-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const input = container.querySelector('#broadcast-message');
    const message = input.value.trim();
    if (!message) return;
    if (!myId) return showToast('Bitte zuerst auswählen, wer du bist.', { error: true });
    const submitBtn = container.querySelector('#broadcast-form button[type="submit"]');
    if (submitBtn.disabled) return;
    submitBtn.disabled = true;
    try {
      await api.broadcasts.send(myId, message);
      input.value = '';
      historyCache = null;
      showToast('Durchsage gesendet.');
      ctx.rerender();
    } catch (err) {
      submitBtn.disabled = false;
      showToast(err.message, { error: true });
    }
  });
}
