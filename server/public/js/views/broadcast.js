// "Durchsage" view: sends a time-limited message to the current group/event
// through the shared in-app, kiosk and Web Push delivery pipeline.

import { api } from '../api.js';
import { escapeHtml, formatDateTime } from '../format.js';
import { showToast } from '../toast.js';
import { getMyId } from '../whoami.js';
import {
  captureDateTimeFieldDraft,
  dateTimeFieldHtml,
  restoreDateTimeFieldDraft,
  wireDateTimeField,
} from '../dateTimeField.js';
import { icon } from '../icons.js';
import { emptyStateHtml } from '../emptyState.js';
import { openModal } from '../modal.js';

let historyCache = null;
let historyLoading = false;
let historyStale = false;
let historyRequestVersion = 0;
let historyOpen = false;

async function loadHistory(ctx) {
  const version = ++historyRequestVersion;
  historyLoading = true;
  historyStale = false;
  try {
    const res = await api.broadcasts.list();
    if (version === historyRequestVersion) historyCache = res.broadcasts;
  } catch {
    if (version === historyRequestVersion && historyCache === null) historyCache = [];
  } finally {
    if (version === historyRequestVersion) {
      historyLoading = false;
      ctx.rerender();
    }
  }
}

// Called from app.js on every broadcast lifecycle event so the history list
// is fresh next time this view renders.
export function invalidateBroadcasts({ hard = false } = {}) {
  historyRequestVersion += 1;
  historyLoading = false;
  historyStale = true;
  if (hard) historyCache = null;
}

function isActive(b, now = Date.now()) {
  return !b.endedAt && b.endsAt > now;
}

function sameDay(a, b) {
  const da = new Date(a);
  const db = new Date(b);
  return da.getFullYear() === db.getFullYear() && da.getMonth() === db.getMonth() && da.getDate() === db.getDate();
}

function clockTime(timestampMs) {
  return new Date(timestampMs).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
}

// Short state text for the table row: a running broadcast names only its end
// (the clock time alone while that is still today), a past one says how it ended.
function whenText(b, now = Date.now()) {
  if (b.endedAt) return `Beendet ${formatDateTime(b.endedAt)} Uhr`;
  if (b.endsAt <= now) return `Abgelaufen ${formatDateTime(b.endsAt)} Uhr`;
  return `Bis ${sameDay(b.endsAt, now) ? clockTime(b.endsAt) : formatDateTime(b.endsAt)} Uhr`;
}

// The row shows one calm line like the To-Do table: line breaks become
// separators and long messages are cut at a fixed length. The detail dialog
// shows the full text.
const MESSAGE_PREVIEW_LENGTH = 40;
function previewText(message) {
  const line = message.replace(/\s*\n\s*/g, ' · ');
  return line.length > MESSAGE_PREVIEW_LENGTH ? `${line.slice(0, MESSAGE_PREVIEW_LENGTH).trimEnd()}…` : line;
}

function canEnd(b, myId) {
  return Boolean(myId) && b.playerId === myId && isActive(b);
}

// One table row per broadcast: message, sender, time and one fixed action
// column. The whole row opens the detail dialog.
function renderRow(b, myId) {
  const past = !isActive(b);
  const sender = b.playerId === myId
    ? `<strong class="broadcast-table-me">${escapeHtml(b.playerName)}</strong>`
    : escapeHtml(b.playerName);
  const action = canEnd(b, myId)
    ? `<button type="button" class="btn btn-sm" data-end-broadcast="${b.id}">Beenden</button>`
    : '';
  return `
    <div class="broadcast-table-row${past ? ' is-past' : ''}" role="row" data-broadcast="${b.id}">
      <div class="broadcast-table-message" role="cell">
        <button type="button" class="broadcast-table-open" data-broadcast-detail="${b.id}" title="${escapeHtml(b.message)}">${escapeHtml(previewText(b.message))}</button>
      </div>
      <div class="broadcast-table-sender" role="cell"><span>${sender}</span></div>
      <div class="broadcast-table-when" role="cell">${whenText(b)}</div>
      <div class="broadcast-table-action" role="cell">${action}</div>
    </div>`;
}

function tableHtml(entries, myId, label) {
  return `<div class="broadcast-table" role="table" aria-label="${label}">${entries.map((b) => renderRow(b, myId)).join('')}</div>`;
}

async function endBroadcast(id, myId, ctx) {
  await api.broadcasts.end(id, myId);
  invalidateBroadcasts();
  showToast('Durchsage beendet.');
  ctx.rerender();
}

function openDetail(b, myId, ctx) {
  const facts = [
    ['Von', b.playerId === myId ? `<strong>${escapeHtml(b.playerName)}</strong>` : escapeHtml(b.playerName)],
    ['Gesendet', `${formatDateTime(b.createdAt)} Uhr`],
    b.endedAt
      ? ['Beendet', `${formatDateTime(b.endedAt)} Uhr`]
      : [isActive(b) ? 'Sichtbar bis' : 'Abgelaufen', `${formatDateTime(b.endsAt)} Uhr`],
  ];
  const { close } = openModal(
    'Durchsage',
    `<div class="stack">
       <p class="broadcast-detail-message">${escapeHtml(b.message)}</p>
       <dl class="broadcast-detail-facts">
         ${facts.map(([label, value]) => `<dt>${label}</dt><dd>${value}</dd>`).join('')}
       </dl>
       ${canEnd(b, myId) ? '<div class="broadcast-detail-footer"><button type="button" class="btn btn-sm" data-detail-end>Beenden</button></div>' : ''}
     </div>`,
    {
      onMount: (el) => {
        el.querySelector('.modal')?.classList.add('broadcast-detail-modal');
        el.querySelector('[data-detail-end]')?.addEventListener('click', async (event) => {
          const button = event.currentTarget;
          if (button.disabled) return;
          button.disabled = true;
          try {
            await endBroadcast(b.id, myId, ctx);
            close();
          } catch (err) {
            button.disabled = false;
            showToast(err.message, { error: true });
          }
        });
      },
    }
  );
}

export function renderBroadcast(container, ctx) {
  if ((historyCache === null || historyStale) && !historyLoading) loadHistory(ctx);

  const myId = getMyId();

  // Re-renders arrive asynchronously (history load, socket events) and
  // replace the whole view — preserve whatever the user is mid-typing, or
  // the message field silently empties under their thumbs.
  const prevInput = container.querySelector('#broadcast-message');
  const prevValue = prevInput?.value ?? '';
  const hadFocus = prevInput && document.activeElement === prevInput;
  const previousDateTimeField = container.querySelector('[data-dt-field="broadcast-ends-at"]');
  const previousDateTimeFocus = previousDateTimeField?.contains(document.activeElement)
    ? document.activeElement.matches('[data-dt-date]')
      ? '[data-dt-date]'
      : document.activeElement.matches('[data-dt-time]')
        ? '[data-dt-time]'
        : document.activeElement.matches('[data-dt-trigger]')
          ? '[data-dt-trigger]'
          : null
    : null;
  const endsAtDraft = previousDateTimeFocus
    ? captureDateTimeFieldDraft(container, 'broadcast-ends-at')
    : null;
  const prevEndsAtValue = container.querySelector('#broadcast-ends-at')?.value ?? '';
  const parsedEndsAt = prevEndsAtValue ? new Date(prevEndsAtValue).getTime() : NaN;
  const displayEndsAt = Number.isFinite(parsedEndsAt) ? parsedEndsAt : Date.now() + 60 * 60 * 1000;

  const now = Date.now();
  const active = historyCache?.filter((b) => isActive(b, now)) ?? [];
  const past = historyCache?.filter((b) => !isActive(b, now)) ?? [];
  const activeContent = historyCache === null
    ? emptyStateHtml('Lädt…')
    : active.length === 0
      ? emptyStateHtml('Keine laufende Durchsage')
      : tableHtml(active, myId, 'Aktuelle Durchsagen');

  container.innerHTML = `
    <div class="more-subpage-header">
      <div class="more-subpage-title-row">
        <h1 class="view-title">Durchsage</h1>
      </div>
    </div>
    <div class="grouped-page-sections">
      <section class="card stack grouped-page-section" aria-labelledby="broadcast-new-title">
        <div class="grouped-page-section-title">
          <h2 id="broadcast-new-title">Neue Durchsage</h2>
        </div>
        <form id="broadcast-form" class="stack">
          <div class="broadcast-form-row">
            <div>
              <label for="broadcast-message" class="field-label">Nachricht</label>
              <textarea id="broadcast-message" rows="1" placeholder="Essen ist da" maxlength="200" ${myId ? '' : 'disabled'}></textarea>
            </div>
            <div>
              <label for="broadcast-ends-at-date" class="field-label">Sichtbar bis</label>
              ${dateTimeFieldHtml('broadcast-ends-at', displayEndsAt, { disabled: !myId, label: 'Sichtbar bis' })}
            </div>
          </div>
          <div class="broadcast-form-footer">
            <button type="submit" class="btn btn-primary btn-sm" ${myId ? '' : 'disabled'}>Senden</button>
          </div>
        </form>
      </section>
      <section class="card stack grouped-page-section" aria-labelledby="broadcast-active-title">
        <div class="grouped-page-section-title">
          <h2 id="broadcast-active-title">Aktuell</h2>
        </div>
        ${activeContent}
      </section>
      ${past.length > 0 ? `
      <details class="card grouped-page-section collapsible-section" data-broadcast-history ${historyOpen ? 'open' : ''}>
        <summary class="collapsible-section-header">
          <h2>Historie</h2>
          <span class="collapsible-section-summary-end">
            <span class="badge badge-offline">${past.length}</span>
            <span class="collapsible-section-chevron">${icon('chevronRight')}</span>
          </span>
        </summary>
        <div class="collapsible-section-content">${tableHtml(past, myId, 'Historie')}</div>
      </details>` : ''}
    </div>
  `;

  wireDateTimeField(container, 'broadcast-ends-at');
  restoreDateTimeFieldDraft(container, 'broadcast-ends-at', endsAtDraft);

  container.querySelector('[data-broadcast-history]')?.addEventListener('toggle', (event) => {
    historyOpen = event.currentTarget.open;
  });

  const messageInput = container.querySelector('#broadcast-message');
  if (prevValue) messageInput.value = prevValue;
  if (hadFocus) messageInput.focus();
  if (previousDateTimeFocus) {
    container.querySelector(`[data-dt-field="broadcast-ends-at"] ${previousDateTimeFocus}`)?.focus();
  }

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
      window.dispatchEvent(new CustomEvent('respawn:notifications-refresh'));
      const currentInput = container.querySelector('#broadcast-message');
      const currentEndsAtInput = container.querySelector('#broadcast-ends-at');
      if (currentInput) currentInput.value = '';
      if (currentEndsAtInput) currentEndsAtInput.value = '';
      invalidateBroadcasts();
      showToast('Durchsage gesendet.');
      ctx.rerender();
    } catch (err) {
      submitBtn.disabled = false;
      showToast(err.message, { error: true });
    }
  });

  // A textarea keeps Enter for line breaks; Ctrl/Cmd+Enter sends.
  messageInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      container.querySelector('#broadcast-form').requestSubmit();
    }
  });

  container.querySelectorAll('[data-broadcast-detail]').forEach((button) => {
    button.addEventListener('click', () => {
      const entry = historyCache?.find((b) => b.id === button.dataset.broadcastDetail);
      if (entry) openDetail(entry, myId, ctx);
    });
  });

  container.querySelectorAll('[data-end-broadcast]').forEach((button) => {
    button.addEventListener('click', async () => {
      if (!myId || button.disabled) return;
      button.disabled = true;
      try {
        await endBroadcast(button.dataset.endBroadcast, myId, ctx);
      } catch (err) {
        button.disabled = false;
        showToast(err.message, { error: true });
      }
    });
  });
}
