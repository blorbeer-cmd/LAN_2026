import { api } from '../api.js';
import { state } from '../state.js';
import { escapeHtml } from '../format.js';
import { showToast } from '../toast.js';
import { openModal, confirmDialog } from '../modal.js';
import { getMyId } from '../whoami.js';

const TOPICS = {
  date_range: 'Zeitraum',
  location: 'Ort / Unterkunft',
  duration: 'Dauer',
  budget: 'Budget / Preisrahmen',
  custom: 'Freie Abstimmung',
};
const RESPONSE_LABELS = { can: 'Passt', if_needed: 'Wenn nötig', cannot: 'Passt nicht' };
const pollCache = new Map();
const drafts = new Map();
let selectedEventId = null;

export function selectEventPollsEvent(eventId) {
  selectedEventId = eventId;
}

export function invalidateEventPolls() {
  pollCache.clear();
  drafts.clear();
}

function visibleEvents() {
  const byId = new Map();
  for (const event of [
    ...(state.managedEvents ?? []),
    ...(state.availableEvents ?? []),
    ...(state.plannedEvents ?? []),
    ...(state.eventInvitations ?? []),
  ]) {
    if (event?.id && !event.isBase) byId.set(event.id, event);
  }
  return [...byId.values()].sort((a, b) => a.name.localeCompare(b.name, 'de'));
}

function loadPolls(eventId, ctx) {
  const cached = pollCache.get(eventId);
  if (cached?.loading || cached?.loaded) return;
  pollCache.set(eventId, { loading: true, loaded: false, polls: [] });
  api.eventPolls
    .list(eventId)
    .then((polls) => {
      pollCache.set(eventId, { loading: false, loaded: true, polls, error: null });
      ctx.rerender();
    })
    .catch((error) => {
      pollCache.set(eventId, { loading: false, loaded: true, polls: [], error: error.message });
      ctx.rerender();
    });
}

function optionLabel(option) {
  return option.label || (option.startsOn === option.endsOn ? option.startsOn : `${option.startsOn} – ${option.endsOn}`);
}

function pollStatus(poll) {
  if (poll.status === 'open') return 'Offen';
  if (poll.status === 'closed') return 'Geschlossen';
  if (poll.status === 'scheduled') return 'Entschieden';
  if (poll.status === 'superseded') return 'Ersetzt';
  return 'Abgebrochen';
}

function draftFor(poll) {
  if (!drafts.has(poll.id)) {
    const initial = { ...(poll.myResponses ?? {}) };
    if (poll.responseMode !== 'feasibility') {
      for (const option of poll.options) initial[option.id] ??= 'cannot';
    }
    drafts.set(poll.id, initial);
  }
  return drafts.get(poll.id);
}

function renderResponseControls(poll, option) {
  if (!poll.isInvitee || poll.status !== 'open') return '';
  const draft = draftFor(poll);
  if (poll.responseMode === 'feasibility') {
    return `<div class="event-card-actions">
      ${Object.entries(RESPONSE_LABELS)
        .map(([value, label]) => `<button type="button" class="btn btn-sm${draft[option.id] === value ? ' btn-primary' : ''}"
          data-poll-response="${value}" data-poll-id="${escapeHtml(poll.id)}" data-option-id="${escapeHtml(option.id)}">${label}</button>`)
        .join('')}
    </div>`;
  }
  const checked = draft[option.id] === 'can';
  const type = poll.responseMode === 'single_choice' ? 'radio' : 'checkbox';
  return `<label><input type="${type}" name="poll-${escapeHtml(poll.id)}" data-poll-choice="${escapeHtml(poll.id)}"
    value="${escapeHtml(option.id)}" ${checked ? 'checked' : ''}> Auswählen</label>`;
}

function renderPoll(poll) {
  const chosen = new Set(poll.selectedOptionIds ?? (poll.selectedOptionId ? [poll.selectedOptionId] : []));
  const options = poll.options
    .map((option) => `<div class="card stack" data-poll-option-card="${escapeHtml(option.id)}">
      <div class="row-between">
        <strong>${escapeHtml(optionLabel(option))}</strong>
        ${chosen.has(option.id) ? '<span class="badge badge-playing">Gewählt</span>' : ''}
      </div>
      ${option.description ? `<span class="muted">${escapeHtml(option.description)}</span>` : ''}
      <span class="muted">Passt ${option.counts.can} · Wenn nötig ${option.counts.ifNeeded} · Passt nicht ${option.counts.cannot} · Offen ${option.counts.open}</span>
      ${renderResponseControls(poll, option)}
      ${poll.canManage && (poll.status === 'open' || poll.status === 'closed')
        ? `<label><input type="${poll.responseMode === 'multiple_choice' ? 'checkbox' : 'radio'}" name="decision-${escapeHtml(poll.id)}"
            data-decision-option="${escapeHtml(poll.id)}" value="${escapeHtml(option.id)}"> Als Ergebnis wählen</label>`
        : ''}
    </div>`)
    .join('');
  const answered = poll.invitees.filter((invitee) => invitee.hasAnswered).length;
  return `<section class="card stack" data-poll-card="${escapeHtml(poll.id)}">
    <div class="row-between">
      <div class="stack">
        <span class="muted">${escapeHtml(TOPICS[poll.topic] ?? poll.topic)} · Runde ${poll.roundNumber}</span>
        <h2>${escapeHtml(poll.title)}</h2>
      </div>
      <span class="badge ${poll.status === 'open' ? 'badge-playing' : 'badge-paused'}">${pollStatus(poll)}</span>
    </div>
    ${poll.note ? `<p>${escapeHtml(poll.note)}</p>` : ''}
    <span class="muted">Antwortfrist: ${new Date(poll.responseDueAt).toLocaleDateString('de-DE')} · ${answered}/${poll.invitees.length} beantwortet</span>
    <div class="stack">${options}</div>
    ${poll.isInvitee && poll.status === 'open' ? `<button type="button" class="btn btn-primary" data-save-poll="${escapeHtml(poll.id)}">Antwort speichern</button>` : ''}
    ${poll.canManage && (poll.status === 'open' || poll.status === 'closed') ? `<div class="event-card-actions">
      <button type="button" class="btn btn-primary" data-decide-poll="${escapeHtml(poll.id)}">Ergebnis festlegen</button>
      ${poll.status === 'open' ? `<button type="button" class="btn btn-sm" data-close-poll="${escapeHtml(poll.id)}">Schließen</button>` : ''}
      <button type="button" class="btn btn-sm" data-remind-poll="${escapeHtml(poll.id)}">Offene erinnern</button>
    </div>` : ''}
  </section>`;
}

function openCreatePoll(event, ctx) {
  const invitees = (state.players ?? []).map((player) =>
    `<label><input type="checkbox" name="invitee" value="${escapeHtml(player.id)}" checked> ${escapeHtml(player.name)}</label>`).join('');
  const { close } = openModal('Abstimmung starten', `<form id="event-poll-form" class="stack">
    <label>Thema<select id="poll-topic">
      ${Object.entries(TOPICS).map(([value, label]) => `<option value="${value}">${label}</option>`).join('')}
    </select></label>
    <label>Titel<input id="poll-title" maxlength="100" required value="Termin / Zeitraum"></label>
    <label>Antwortart<select id="poll-mode">
      <option value="feasibility">Passt / wenn nötig / passt nicht</option>
      <option value="single_choice">Eine Option</option>
      <option value="multiple_choice">Mehrere Optionen</option>
    </select></label>
    <label>Optionen <span class="muted">(eine pro Zeile; Zeitraum: YYYY-MM-DD bis YYYY-MM-DD)</span>
      <textarea id="poll-options" rows="5" required></textarea></label>
    <label>Antwortfrist<input id="poll-due" type="date" required></label>
    <label>Notiz (optional)<textarea id="poll-note" maxlength="500" rows="2"></textarea></label>
    <fieldset class="stack"><legend>Eingeladene</legend>${invitees}</fieldset>
    <button class="btn btn-primary" type="submit">Abstimmung starten</button>
  </form>`, {
    onMount: (modal) => {
      const due = new Date(Date.now() + 7 * 86_400_000);
      modal.querySelector('#poll-due').value = due.toISOString().slice(0, 10);
      modal.querySelector('#poll-topic').addEventListener('change', (e) => {
        const defaults = { date_range: 'Termin / Zeitraum', location: 'Ort / Unterkunft', duration: 'Dauer', budget: 'Budget / Preisrahmen', custom: '' };
        modal.querySelector('#poll-title').value = defaults[e.target.value];
      });
      modal.querySelector('#event-poll-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const topic = modal.querySelector('#poll-topic').value;
        const lines = modal.querySelector('#poll-options').value.split('\n').map((line) => line.trim()).filter(Boolean);
        if (lines.length < 2) return showToast('Mindestens zwei Optionen sind erforderlich.', { error: true });
        let options;
        if (topic === 'date_range') {
          options = lines.map((line) => {
            const match = line.match(/^(\d{4}-\d{2}-\d{2})\s+(?:bis|–|-)\s+(\d{4}-\d{2}-\d{2})$/i);
            return match ? { startsOn: match[1], endsOn: match[2], label: line } : null;
          });
          if (options.some((option) => !option)) return showToast('Zeiträume bitte als YYYY-MM-DD bis YYYY-MM-DD eingeben.', { error: true });
        } else options = lines.map((label) => ({ label }));
        try {
          await api.eventPolls.create(event.id, {
            topic,
            decisionKey: topic === 'custom' ? `custom_${Date.now()}` : topic === 'date_range' ? 'date' : topic,
            title: modal.querySelector('#poll-title').value.trim(),
            responseMode: modal.querySelector('#poll-mode').value,
            options,
            responseDueOn: modal.querySelector('#poll-due').value,
            note: modal.querySelector('#poll-note').value.trim() || null,
            inviteePlayerIds: [...modal.querySelectorAll('[name="invitee"]:checked')].map((input) => input.value),
          });
          invalidateEventPolls();
          close();
          await ctx.refresh();
          showToast('Abstimmung gestartet.');
        } catch (error) { showToast(error.message, { error: true }); }
      });
    },
  });
}

export function renderEventPolls(container, ctx) {
  const events = visibleEvents();
  for (const visibleEvent of events) loadPolls(visibleEvent.id, ctx);
  const targetPollId = String(location.hash || '').match(/^#eventPolls\/(.+)$/)?.[1];
  if (targetPollId) {
    const matchingEvent = events.find((entry) => pollCache.get(entry.id)?.polls?.some((poll) => poll.id === targetPollId));
    if (matchingEvent) selectedEventId = matchingEvent.id;
  }
  if (!selectedEventId || !events.some((event) => event.id === selectedEventId)) selectedEventId = events[0]?.id ?? null;
  const event = events.find((entry) => entry.id === selectedEventId);
  if (!event) {
    container.innerHTML = '<div class="empty-state"><h2>Noch keine Abstimmungen</h2><p class="muted">Sobald du ein Event verwaltest oder eingeladen wirst, erscheint es hier.</p></div>';
    return;
  }
  const cached = pollCache.get(event.id);
  const pollsHtml = cached?.loading
    ? '<p class="muted">Abstimmungen werden geladen…</p>'
    : cached?.error
      ? `<p class="muted">${escapeHtml(cached.error)}</p>`
      : (cached?.polls ?? []).map(renderPoll).join('') || '<p class="muted">Für dieses Event gibt es noch keine Abstimmung.</p>';
  const canCreate = cached?.polls?.some((poll) => poll.canManage) || event.createdBy === getMyId() || state.managedEvents?.some((entry) => entry.id === event.id);
  container.innerHTML = `<div class="stack">
    <div class="row-between">
      <label>Event<select id="poll-event-select">${events.map((entry) => `<option value="${escapeHtml(entry.id)}" ${entry.id === event.id ? 'selected' : ''}>${escapeHtml(entry.name)}</option>`).join('')}</select></label>
      ${canCreate ? '<button type="button" class="btn btn-primary" id="new-event-poll">+ Abstimmung</button>' : ''}
    </div>
    <div class="card stack">
      <strong>Deine Teilnahme</strong>
      <span class="muted">„Interessiert“ ist unverbindlich. Du kannst später jederzeit zu- oder absagen.</span>
      <div class="event-card-actions">
        <button class="btn btn-sm" data-participation="interested">Interessiert</button>
        <button class="btn btn-sm" data-participation="accepted">Zusagen</button>
        <button class="btn btn-sm btn-danger" data-participation="declined">Absagen</button>
      </div>
    </div>
    ${pollsHtml}
  </div>`;
  container.querySelector('#poll-event-select').addEventListener('change', (e) => { selectedEventId = e.target.value; ctx.rerender(); });
  container.querySelector('#new-event-poll')?.addEventListener('click', () => openCreatePoll(event, ctx));
  container.querySelectorAll('[data-participation]').forEach((button) => button.addEventListener('click', async () => {
    try {
      await api.events.setMyParticipation(event.id, button.dataset.participation);
      await ctx.refresh();
      showToast('Teilnahmestatus aktualisiert.');
    } catch (error) { showToast(error.message, { error: true }); }
  }));
  container.querySelectorAll('[data-poll-response]').forEach((button) => button.addEventListener('click', () => {
    draftFor(cached.polls.find((poll) => poll.id === button.dataset.pollId))[button.dataset.optionId] = button.dataset.pollResponse;
    ctx.rerender();
  }));
  container.querySelectorAll('[data-poll-choice]').forEach((input) => input.addEventListener('change', () => {
    const poll = cached.polls.find((entry) => entry.id === input.dataset.pollChoice);
    const draft = draftFor(poll);
    if (poll.responseMode === 'single_choice') poll.options.forEach((option) => { draft[option.id] = option.id === input.value ? 'can' : 'cannot'; });
    else draft[input.value] = input.checked ? 'can' : 'cannot';
  }));
  container.querySelectorAll('[data-save-poll]').forEach((button) => button.addEventListener('click', async () => {
    const poll = cached.polls.find((entry) => entry.id === button.dataset.savePoll);
    const draft = draftFor(poll);
    if (poll.options.some((option) => !draft[option.id])) return showToast('Bitte jede Option beantworten.', { error: true });
    try {
      await api.eventPolls.submitMyResponses(event.id, poll.id, poll.options.map((option) => ({ optionId: option.id, response: draft[option.id] })));
      invalidateEventPolls(); await ctx.refresh(); showToast('Antwort gespeichert.');
    } catch (error) { showToast(error.message, { error: true }); }
  }));
  container.querySelectorAll('[data-decide-poll]').forEach((button) => button.addEventListener('click', async () => {
    const optionIds = [...container.querySelectorAll(`[data-decision-option="${CSS.escape(button.dataset.decidePoll)}"]:checked`)].map((input) => input.value);
    if (!optionIds.length) return showToast('Bitte ein Ergebnis auswählen.', { error: true });
    if (!(await confirmDialog('Das Ergebnis wird festgelegt und alle Betroffenen werden informiert.', { title: 'Ergebnis festlegen?', confirmText: 'Festlegen' }))) return;
    try { await api.eventPolls.decide(event.id, button.dataset.decidePoll, optionIds); invalidateEventPolls(); await ctx.refresh(); showToast('Ergebnis festgelegt.'); }
    catch (error) { showToast(error.message, { error: true }); }
  }));
  container.querySelectorAll('[data-close-poll]').forEach((button) => button.addEventListener('click', async () => {
    try { await api.eventPolls.close(event.id, button.dataset.closePoll); invalidateEventPolls(); await ctx.refresh(); }
    catch (error) { showToast(error.message, { error: true }); }
  }));
  container.querySelectorAll('[data-remind-poll]').forEach((button) => button.addEventListener('click', async () => {
    try { const result = await api.eventPolls.sendReminders(event.id, button.dataset.remindPoll); showToast(`${result.remindedPlayerIds.length} Person(en) erinnert.`); }
    catch (error) { showToast(error.message, { error: true }); }
  }));
}
