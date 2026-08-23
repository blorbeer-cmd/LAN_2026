// Integrated event date poll (docs/plans/event-date-poll-concept.md): the
// terminfindung that lives inside a planning event's own card, right below
// its header/info box and above the existing participants/accommodation/
// payment sections. Loaded lazily per event card (its own small cache, same
// pattern as foodOrders.js/etc. — see app.js's invalidateEventScopedCaches),
// since the round list isn't part of the shared events payload.

import { api } from '../api.js';
import { icon } from '../icons.js';
import { escapeHtml, avatarHtml } from '../format.js';
import { showToast } from '../toast.js';
import { openModal, confirmDialog } from '../modal.js';
import { state } from '../state.js';
import { getMyId } from '../whoami.js';
import { wireInfoTooltips } from '../infoTooltip.js';
import { dateTimeFieldHtml, wireDateTimeField } from '../dateTimeField.js';

const RESPONSE_LABELS = { can: 'Kann', if_needed: 'Wenn nötig', cannot: 'Kann nicht' };
const RESPONSE_VALUES = ['can', 'if_needed', 'cannot'];

// eventId -> { loading, polls, error }
const pollCache = new Map();
// pollId -> { optionId: response } — a working draft before "Antwort speichern".
const draftResponses = new Map();
// `${pollId}:${optionId}:${status}` — which people lists are expanded.
const expandedPeopleLists = new Set();
// eventId -> bool
const historyOpen = new Set();

export function invalidateEventDatePolls() {
  pollCache.clear();
  draftResponses.clear();
}

function fetchPolls(eventId, ctx) {
  const entry = pollCache.get(eventId);
  if (entry?.loading) return;
  pollCache.set(eventId, { ...entry, loading: true });
  api.eventDatePolls
    .list(eventId)
    .then((polls) => {
      pollCache.set(eventId, { loading: false, polls, error: null });
      ctx.rerender();
    })
    .catch((err) => {
      pollCache.set(eventId, { loading: false, polls: entry?.polls ?? [], error: err.message });
      ctx.rerender();
    });
}

function formatIsoDate(isoDate) {
  const [y, m, d] = isoDate.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('de-DE', { weekday: 'short', day: '2-digit', month: '2-digit', year: 'numeric' });
}

function optionRangeLabel(option) {
  return option.startsOn === option.endsOn
    ? formatIsoDate(option.startsOn)
    : `${formatIsoDate(option.startsOn)} – ${formatIsoDate(option.endsOn)}`;
}

function currentUndecidedRound(polls) {
  return polls.find((p) => p.status === 'open' || p.status === 'closed') ?? null;
}

// ---------- shared info box ----------

function statusChip(label, tone) {
  return `<span class="badge ${tone}">${escapeHtml(label)}</span>`;
}

function needsReconfirmation(event) {
  const mine = event.myParticipation;
  return Boolean(
    mine && mine.status === 'accepted' && mine.confirmedScheduleRevision !== event.scheduleRevision,
  );
}

export function renderDatePollInfoBox(event, polls) {
  const current = currentUndecidedRound(polls);
  const chips = [];
  if (event.status === 'draft') chips.push(statusChip('In Planung', 'badge-paused'));
  if (current && event.scheduleRevision > 0) chips.push(statusChip('Neuabstimmung läuft', 'badge-paused'));
  else if (current) chips.push(statusChip('Terminabstimmung läuft', 'badge-paused'));
  if (event.scheduleRevision > 0 && current) chips.push(statusChip('Bisheriger Termin', 'badge-online'));
  else if (event.scheduleRevision > 0) chips.push(statusChip('Aktueller Termin', 'badge-playing'));
  if (needsReconfirmation(event)) chips.push(statusChip('Erneute Bestätigung erforderlich', 'badge-paused'));

  const dateLine = event.startsAt
    ? `${new Date(event.startsAt).toLocaleDateString('de-DE')} – ${new Date(event.endsAt - 86_400_000).toLocaleDateString('de-DE')}`
    : 'Noch kein Termin festgelegt';

  let progressLine = '';
  if (current) {
    const answered = current.invitees.filter((i) => i.hasAnswered).length;
    const total = current.invitees.length;
    const dueLabel = new Date(current.responseDueAt).toLocaleDateString('de-DE');
    progressLine = `<span class="muted event-payment-overview">Frist: ${escapeHtml(dueLabel)} · ${answered} von ${total} haben geantwortet</span>`;
  }

  // A stale acceptance drops out of acceptedParticipants (and, deliberately,
  // out of the shared availableEvents workspace list — see routes/events.ts)
  // until reconfirmed, so this is the only place left for the affected
  // member to actually act on the chip above instead of just seeing it.
  const reconfirmRow = needsReconfirmation(event)
    ? `<button type="button" class="btn btn-primary btn-sm" data-reconfirm-event="${escapeHtml(event.id)}">Termin bestätigen</button>`
    : '';

  if (chips.length === 0 && !current) return '';
  return `
    <div class="event-card-detail event-date-poll-info">
      <span class="event-card-detail-icon" aria-hidden="true">${icon('vote')}</span>
      <span class="event-card-detail-content">
        <span class="event-card-detail-label">Termin</span>
        <strong>${escapeHtml(dateLine)}</strong>
        <span class="event-date-poll-chips">${chips.join('')}</span>
        ${progressLine}
        ${reconfirmRow}
      </span>
    </div>`;
}

// ---------- per-option people lists ----------

function renderPeopleList(pollId, option, status, people) {
  const key = `${pollId}:${option.id}:${status}`;
  const isOpen = expandedPeopleLists.has(key);
  const label = status === 'can' ? 'Kann' : status === 'ifNeeded' ? 'Wenn nötig' : status === 'cannot' ? 'Kann nicht' : 'Offen';
  if (people.length === 0) return '';
  return `
    <details class="collapsible-section event-date-poll-people" data-people-key="${escapeHtml(key)}" ${isOpen ? 'open' : ''}>
      <summary class="collapsible-section-header">
        <span class="collapsible-section-chevron" aria-hidden="true">${icon('chevronRight')}</span>
        <span>${label} (${people.length})</span>
      </summary>
      <div class="collapsible-section-content">
        <ul class="event-participant-list">
          ${people
            .map((person) => {
              const player = state.players.find((p) => p.id === person.playerId) ?? person;
              return `<li class="event-participant-row"><span class="player-name">${avatarHtml(player, 20)}${escapeHtml(person.name)}</span></li>`;
            })
            .join('')}
        </ul>
      </div>
    </details>`;
}

// ---------- current round ----------

function myResponseFor(poll, optionId) {
  const draft = draftResponses.get(poll.id);
  if (draft && optionId in draft) return draft[optionId];
  return poll.myResponses?.[optionId] ?? null;
}

function allDraftResponsesComplete(poll) {
  return poll.options.every((o) => myResponseFor(poll, o.id) !== null);
}

function renderOptionRow(poll, option, { canManage, isInvitee }) {
  const myResponse = isInvitee ? myResponseFor(poll, option.id) : null;
  const toggle = isInvitee
    ? `<div class="selection-toolbar event-date-poll-response-toggle" role="group" aria-label="Antwort für ${escapeHtml(optionRangeLabel(option))}">
        ${RESPONSE_VALUES.map(
          (value) =>
            `<button type="button" class="btn btn-sm${myResponse === value ? ' btn-primary' : ''}" data-response-option="${escapeHtml(option.id)}" data-response-value="${value}" aria-pressed="${myResponse === value}">${RESPONSE_LABELS[value]}</button>`,
        ).join('')}
      </div>`
    : '';
  const scheduleBtn =
    canManage && (poll.status === 'open' || poll.status === 'closed')
      ? `<button type="button" class="btn btn-sm btn-primary" data-schedule-option="${escapeHtml(option.id)}" data-schedule-poll="${escapeHtml(poll.id)}">Termin festlegen</button>`
      : '';
  return `
    <div class="tournament-section-panel event-date-poll-option" data-option-id="${escapeHtml(option.id)}">
      <div class="row-between event-date-poll-option-head">
        <strong>${escapeHtml(optionRangeLabel(option))}</strong>
        ${option.isRecommended ? '<span class="badge badge-playing">Beste Abdeckung</span>' : ''}
      </div>
      <div class="muted event-date-poll-counts">
        Kann ${option.counts.can} · Wenn nötig ${option.counts.ifNeeded} · Kann nicht ${option.counts.cannot} · Offen ${option.counts.open}
      </div>
      ${toggle}
      ${scheduleBtn}
      <div class="stack event-date-poll-people-lists">
        ${renderPeopleList(poll.id, option, 'can', option.people.can)}
        ${renderPeopleList(poll.id, option, 'ifNeeded', option.people.ifNeeded)}
        ${renderPeopleList(poll.id, option, 'cannot', option.people.cannot)}
      </div>
    </div>`;
}

function renderCreatorActions(poll) {
  const actions = [];
  if (poll.status === 'open') {
    actions.push(`<button type="button" class="btn btn-sm" data-remind-poll="${escapeHtml(poll.id)}">${icon('bell')} Offene erinnern</button>`);
    actions.push(`<button type="button" class="btn btn-sm" data-close-poll="${escapeHtml(poll.id)}">Schließen</button>`);
  }
  if (poll.status === 'closed') {
    actions.push(`<button type="button" class="btn btn-sm btn-primary" data-reopen-poll="${escapeHtml(poll.id)}">Wieder öffnen</button>`);
  }
  actions.push(`<button type="button" class="btn btn-sm btn-danger" data-cancel-poll="${escapeHtml(poll.id)}">Abbrechen</button>`);
  return `<div class="event-card-actions event-date-poll-actions">${actions.join('')}</div>`;
}

function renderCurrentRound(poll) {
  const canManage = poll.canManage;
  const isInvitee = poll.isInvitee;
  const optionsHtml = poll.options.map((option) => renderOptionRow(poll, option, { canManage, isInvitee })).join('');
  const saveRow = isInvitee
    ? `<button type="button" class="btn btn-primary btn-block" data-save-responses="${escapeHtml(poll.id)}" ${allDraftResponsesComplete(poll) ? '' : 'disabled'}>Antwort speichern</button>`
    : '';
  return `
    <div class="stack event-date-poll-round" data-poll-id="${escapeHtml(poll.id)}">
      <div class="row-between">
        <strong>Runde ${poll.roundNumber}${poll.note ? ` – ${escapeHtml(poll.note)}` : ''}</strong>
        <span class="badge ${poll.status === 'open' ? 'badge-playing' : 'badge-paused'}">${poll.status === 'open' ? 'Offen' : 'Geschlossen'}</span>
      </div>
      ${optionsHtml}
      ${saveRow}
      ${canManage ? renderCreatorActions(poll) : ''}
    </div>`;
}

// ---------- history ----------

function pollStatusLabel(poll) {
  if (poll.status === 'scheduled') return 'Termin gewählt';
  if (poll.status === 'superseded') return 'Ersetzt';
  if (poll.status === 'cancelled') return 'Abgebrochen';
  if (poll.status === 'closed') return 'Geschlossen ohne Auswahl';
  return 'Offen';
}

function renderHistoryRound(poll) {
  const selected = poll.options.find((o) => o.id === poll.selectedOptionId);
  return `
    <div class="tournament-section-panel event-date-poll-history-round">
      <div class="row-between">
        <strong>Runde ${poll.roundNumber}</strong>
        <span class="badge badge-offline">${pollStatusLabel(poll)}</span>
      </div>
      ${selected ? `<span class="muted">Gewählt: ${escapeHtml(optionRangeLabel(selected))}</span>` : ''}
    </div>`;
}

function renderHistory(event, polls) {
  const history = polls.filter((p) => p.status !== 'open' && p.status !== 'closed');
  if (history.length === 0) return '';
  const isOpen = historyOpen.has(event.id);
  return `
    <details class="collapsible-section event-date-poll-history" data-history-event="${escapeHtml(event.id)}" ${isOpen ? 'open' : ''}>
      <summary class="collapsible-section-header">
        <span class="collapsible-section-chevron" aria-hidden="true">${icon('chevronRight')}</span>
        <span>Frühere Abstimmungen (${history.length})</span>
      </summary>
      <div class="collapsible-section-content stack">
        ${history.map(renderHistoryRound).join('')}
      </div>
    </details>`;
}

// ---------- creator: start/reschedule action + form ----------

function canStartNewRound(event) {
  if (event.status === 'cancelled' || event.status === 'ended') return false;
  if (event.trackingEnabled) return false;
  return true;
}

function optionRowHtml(index, value = { startsOn: '', endsOn: '' }) {
  const startId = `poll-option-${index}-starts`;
  const endId = `poll-option-${index}-ends`;
  return `
    <div class="field-row event-date-poll-option-form-row" data-option-row="${index}">
      <div>
        <label for="${startId}" class="field-label">Beginn</label>
        ${dateTimeFieldHtml(startId, value.startsOn ? Date.parse(value.startsOn) : null, { clearable: false, dateOnly: true, label: 'Beginn' })}
      </div>
      <div>
        <label for="${endId}" class="field-label">Ende</label>
        ${dateTimeFieldHtml(endId, value.endsOn ? Date.parse(value.endsOn) : null, { clearable: false, dateOnly: true, label: 'Ende' })}
      </div>
      <button type="button" class="btn btn-sm btn-danger" data-remove-option-row="${index}" aria-label="Zeitraum entfernen">${icon('x')}</button>
    </div>`;
}

function readIsoDateFromField(modalEl, id) {
  const raw = modalEl.querySelector(`#${id}`)?.value;
  return raw ? raw.slice(0, 10) : null;
}

function openRoundForm(event, ctx, { reschedule = false } = {}) {
  let rowCount = 2;
  let capturedEl;
  const inviteeOptions = (state.players ?? [])
    .map((p) => `<label class="event-date-poll-invitee-option"><input type="checkbox" value="${escapeHtml(p.id)}" checked /> ${avatarHtml(p, 20)}<span class="player-name">${escapeHtml(p.name)}</span></label>`)
    .join('');

  const { close } = openModal(
    reschedule ? 'Neuen Termin abstimmen' : 'Termin abstimmen',
    `
      <form id="date-poll-form" class="stack">
        <div class="stack" id="date-poll-options">
          ${optionRowHtml(0)}${optionRowHtml(1)}
        </div>
        <button type="button" class="btn btn-sm" id="date-poll-add-option">+ Zeitraum</button>
        <div>
          <label for="poll-due" class="field-label">Antwortfrist</label>
          ${dateTimeFieldHtml('poll-due', Date.now() + 7 * 86_400_000, { clearable: false, dateOnly: true, label: 'Antwortfrist' })}
        </div>
        <div>
          <label for="poll-note" class="field-label">Notiz (optional)</label>
          <textarea id="poll-note" maxlength="500" rows="2"></textarea>
        </div>
        <div class="stack">
          <span class="field-label">Eingeladen</span>
          <div class="event-date-poll-invitee-picker">${inviteeOptions}</div>
        </div>
        <button type="submit" class="btn btn-primary btn-block">${reschedule ? 'Neue Runde starten' : 'Abstimmung starten'}</button>
      </form>
    `,
    {
      onMount: (modalEl) => {
        capturedEl = modalEl;
        wireDateTimeField(modalEl, 'poll-option-0-starts');
        wireDateTimeField(modalEl, 'poll-option-0-ends');
        wireDateTimeField(modalEl, 'poll-option-1-starts');
        wireDateTimeField(modalEl, 'poll-option-1-ends');
        wireDateTimeField(modalEl, 'poll-due');

        modalEl.querySelector('#date-poll-add-option').addEventListener('click', () => {
          if (rowCount >= 8) return;
          const container = modalEl.querySelector('#date-poll-options');
          container.insertAdjacentHTML('beforeend', optionRowHtml(rowCount));
          wireDateTimeField(modalEl, `poll-option-${rowCount}-starts`);
          wireDateTimeField(modalEl, `poll-option-${rowCount}-ends`);
          rowCount += 1;
        });
        modalEl.querySelector('#date-poll-options').addEventListener('click', (e) => {
          const btn = e.target.closest('[data-remove-option-row]');
          if (!btn) return;
          if (modalEl.querySelectorAll('[data-option-row]').length <= 2) {
            showToast('Mindestens zwei Zeiträume sind erforderlich.', { error: true });
            return;
          }
          btn.closest('[data-option-row]').remove();
        });

        modalEl.querySelector('#date-poll-form').addEventListener('submit', async (e) => {
          e.preventDefault();
          const rows = [...modalEl.querySelectorAll('[data-option-row]')];
          const options = [];
          for (const row of rows) {
            const idx = row.dataset.optionRow;
            const startsOn = readIsoDateFromField(modalEl, `poll-option-${idx}-starts`);
            const endsOn = readIsoDateFromField(modalEl, `poll-option-${idx}-ends`);
            if (!startsOn || !endsOn) {
              showToast('Jeder Zeitraum benötigt Beginn und Ende.', { error: true });
              return;
            }
            options.push({ startsOn, endsOn });
          }
          const responseDueOn = readIsoDateFromField(modalEl, 'poll-due');
          if (!responseDueOn) {
            showToast('Eine Antwortfrist ist erforderlich.', { error: true });
            return;
          }
          const note = modalEl.querySelector('#poll-note').value.trim();
          const inviteePlayerIds = [...modalEl.querySelectorAll('.event-date-poll-invitee-picker input:checked')].map((i) => i.value);

          try {
            await api.eventDatePolls.create(event.id, { options, responseDueOn, note: note || null, inviteePlayerIds });
            invalidateEventDatePolls();
            close();
            await ctx.refresh();
            showToast('Terminabstimmung gestartet.');
          } catch (err) {
            showToast(err.message, { error: true });
          }
        });
      },
      confirmClose: () => (capturedEl ? 'Die eingegebene Terminabstimmung geht verloren.' : null),
    },
  );
}

async function startNewRound(event, ctx) {
  const reschedule = event.scheduleRevision > 0;
  if (reschedule) {
    const settlement = event.accommodationCostCents || (event.participants ?? []).some((p) => p.paid);
    const confirmed = await confirmDialog(
      settlement
        ? 'Es gibt bereits Unterkunftskosten oder Zahlungen. Der bisherige Termin bleibt bis zur Auswahl eines neuen gültig; bereits erfasste Zahlungen bleiben erhalten.'
        : 'Der bisherige Termin bleibt bis zur Auswahl eines neuen gültig.',
      { title: 'Neuen Termin abstimmen?', confirmText: 'Neue Runde starten' },
    );
    if (!confirmed) return;
  }
  openRoundForm(event, ctx, { reschedule });
}

// ---------- top-level render/wire ----------

export function renderDatePollSection(event, ctx) {
  const entry = pollCache.get(event.id);
  if (!entry) {
    fetchPolls(event.id, ctx);
    return event.status === 'draft' ? '<p class="muted event-card-empty-copy">Lädt Terminabstimmung…</p>' : '';
  }
  const polls = entry.polls ?? [];
  const current = currentUndecidedRound(polls);
  const canManageAny = current?.canManage ?? polls[0]?.canManage ?? false;

  if (polls.length === 0) {
    if (event.status !== 'draft') return '';
    return canManageAny || event.createdBy === getMyId()
      ? '<button type="button" class="btn btn-primary btn-block" data-start-date-poll="' + escapeHtml(event.id) + '">Termin abstimmen</button>'
      : '<p class="muted event-card-empty-copy">Der Termin wird noch abgestimmt.</p>';
  }

  const infoBox = renderDatePollInfoBox(event, polls);
  const currentHtml = current ? renderCurrentRound(current) : '';
  const startRow =
    !current && canStartNewRound(event) && (polls[0]?.canManage || event.createdBy === getMyId())
      ? `<button type="button" class="btn btn-sm" data-start-date-poll="${escapeHtml(event.id)}">Neuen Termin abstimmen</button>`
      : '';
  const historyHtml = renderHistory(event, polls);

  return `${infoBox}${currentHtml}${startRow}${historyHtml}`;
}

export function wireDatePollSection(container, eventsProvider, ctx) {
  container.querySelectorAll('[data-reconfirm-event]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const eventId = btn.dataset.reconfirmEvent;
      btn.disabled = true;
      try {
        await api.events.acceptInvitation(eventId);
        invalidateEventDatePolls();
        await ctx.refresh();
        showToast('Termin bestätigt.');
      } catch (err) {
        btn.disabled = false;
        showToast(err.message, { error: true });
      }
    });
  });

  container.querySelectorAll('[data-people-key]').forEach((details) => {
    details.addEventListener('toggle', () => {
      if (details.open) expandedPeopleLists.add(details.dataset.peopleKey);
      else expandedPeopleLists.delete(details.dataset.peopleKey);
    });
  });
  container.querySelectorAll('[data-history-event]').forEach((details) => {
    details.addEventListener('toggle', () => {
      if (details.open) historyOpen.add(details.dataset.historyEvent);
      else historyOpen.delete(details.dataset.historyEvent);
    });
  });

  container.querySelectorAll('[data-response-option]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const round = btn.closest('[data-poll-id]');
      const pollId = round?.dataset.pollId;
      if (!pollId) return;
      const optionId = btn.dataset.responseOption;
      const value = btn.dataset.responseValue;
      const draft = draftResponses.get(pollId) ?? {};
      draft[optionId] = value;
      draftResponses.set(pollId, draft);
      ctx.rerender();
    });
  });

  container.querySelectorAll('[data-save-responses]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const pollId = btn.dataset.saveResponses;
      const eventId = btn.closest('[data-event-card]')?.dataset.eventCard;
      const polls = eventId ? pollCache.get(eventId)?.polls ?? [] : [];
      const poll = polls.find((p) => p.id === pollId);
      if (!poll) return;
      const responses = poll.options.map((o) => ({ optionId: o.id, response: myResponseFor(poll, o.id) }));
      if (responses.some((r) => !r.response)) return;
      btn.disabled = true;
      try {
        await api.eventDatePolls.submitMyResponses(eventId, pollId, responses);
        draftResponses.delete(pollId);
        invalidateEventDatePolls();
        await ctx.refresh();
        showToast('Antwort gespeichert.');
      } catch (err) {
        btn.disabled = false;
        showToast(err.message, { error: true });
      }
    });
  });

  container.querySelectorAll('[data-schedule-option]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const eventId = btn.closest('[data-event-card]')?.dataset.eventCard;
      const pollId = btn.dataset.schedulePoll;
      const optionId = btn.dataset.scheduleOption;
      if (!eventId) return;
      const confirmed = await confirmDialog(
        'Der Termin wird für alle festgelegt. Bereits Zugesagte müssen ihn danach erneut bestätigen.',
        { title: 'Termin festlegen?', confirmText: 'Termin festlegen' },
      );
      if (!confirmed) return;
      btn.disabled = true;
      try {
        await api.eventDatePolls.schedule(eventId, pollId, optionId);
        invalidateEventDatePolls();
        await ctx.refresh();
        showToast('Termin festgelegt.');
      } catch (err) {
        btn.disabled = false;
        showToast(err.message, { error: true });
      }
    });
  });

  container.querySelectorAll('[data-remind-poll]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const eventId = btn.closest('[data-event-card]')?.dataset.eventCard;
      if (!eventId) return;
      btn.disabled = true;
      try {
        const res = await api.eventDatePolls.sendReminders(eventId, btn.dataset.remindPoll);
        showToast(
          res.remindedPlayerIds.length > 0
            ? `${res.remindedPlayerIds.length} Person(en) erinnert.`
            : 'Niemand musste gerade erinnert werden.',
        );
      } catch (err) {
        showToast(err.message, { error: true });
      } finally {
        btn.disabled = false;
      }
    });
  });

  container.querySelectorAll('[data-close-poll]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const eventId = btn.closest('[data-event-card]')?.dataset.eventCard;
      if (!eventId) return;
      btn.disabled = true;
      try {
        await api.eventDatePolls.close(eventId, btn.dataset.closePoll);
        invalidateEventDatePolls();
        await ctx.refresh();
        showToast('Abstimmung geschlossen.');
      } catch (err) {
        btn.disabled = false;
        showToast(err.message, { error: true });
      }
    });
  });

  container.querySelectorAll('[data-reopen-poll]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const eventId = btn.closest('[data-event-card]')?.dataset.eventCard;
      if (!eventId) return;
      btn.disabled = true;
      try {
        await api.eventDatePolls.reopen(eventId, btn.dataset.reopenPoll);
        invalidateEventDatePolls();
        await ctx.refresh();
        showToast('Abstimmung wieder geöffnet.');
      } catch (err) {
        btn.disabled = false;
        showToast('Zum Wiederöffnen wird ggf. eine neue Frist benötigt: ' + err.message, { error: true });
      }
    });
  });

  container.querySelectorAll('[data-cancel-poll]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const eventId = btn.closest('[data-event-card]')?.dataset.eventCard;
      if (!eventId) return;
      const confirmed = await confirmDialog('Diese Runde wirklich abbrechen? Ein bisheriger Termin bleibt unverändert.', {
        title: 'Runde abbrechen?',
        confirmText: 'Abbrechen',
        danger: true,
      });
      if (!confirmed) return;
      btn.disabled = true;
      try {
        await api.eventDatePolls.cancel(eventId, btn.dataset.cancelPoll);
        invalidateEventDatePolls();
        await ctx.refresh();
        showToast('Runde abgebrochen.');
      } catch (err) {
        btn.disabled = false;
        showToast(err.message, { error: true });
      }
    });
  });

  container.querySelectorAll('[data-start-date-poll]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const event = eventsProvider().find((e) => e.id === btn.dataset.startDatePoll);
      if (event) startNewRound(event, ctx);
    });
  });

  wireInfoTooltips(container);
}
