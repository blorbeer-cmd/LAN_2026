import { api } from '../api.js';
import { state } from '../state.js';
import { avatarHtml, escapeHtml } from '../format.js';
import { showToast } from '../toast.js';
import { openModal, confirmDialog } from '../modal.js';
import { icon } from '../icons.js';
import { emptyStateHtml } from '../emptyState.js';
import { dateTimeFieldHtml, wireDateTimeField } from '../dateTimeField.js';
import { infoTooltipHtml, wireInfoTooltips } from '../infoTooltip.js';

const RESPONSE_VALUES = ['can', 'if_needed', 'cannot'];
const FEASIBILITY_VALUES = [...RESPONSE_VALUES, 'open'];
const RATING_VALUES = ['1', '2', '3', '4', '5'];
const RESPONSE_LABELS = { can: 'Passt', if_needed: 'Notfalls', cannot: 'Nein', open: 'Offen' };
const MODE_INFO = {
  feasibility: {
    label: 'Jede Option bewerten',
    description: 'Für jede Option wird Passt, Wenn nötig, Passt nicht oder Offen gewählt.',
  },
  single_choice: {
    label: 'Eine Option wählen',
    description: 'Jede Person gibt genau einer Option ihre Stimme.',
  },
  multiple_choice: {
    label: 'Mehrere Optionen wählen',
    description: 'Jede Person kann mehrere passende Optionen auswählen.',
  },
  rating_1_5: {
    label: 'Optionen von 1 bis 5 bewerten',
    description: 'Jede Person vergibt für jede Option eine Bewertung von 1 bis 5.',
  },
};

const pollCache = new Map();
const responseDrafts = new Map();
const resultDrafts = new Map();
const expandedPolls = new Set();
const expandedHistories = new Set();
const initializedEvents = new Set();

export function invalidateEventPolls() {
  pollCache.clear();
  responseDrafts.clear();
  resultDrafts.clear();
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

function formatDate(timestamp) {
  return new Date(timestamp).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

function pollStatusInfo(status) {
  if (status === 'open') return { label: 'Abstimmung läuft', badge: 'badge-playing' };
  if (status === 'closed') return { label: 'Abstimmung beendet', badge: 'badge-paused' };
  if (status === 'scheduled') return { label: 'Ergebnis festgehalten', badge: 'badge-online' };
  if (status === 'superseded') return { label: 'Frühere Runde', badge: 'badge-offline' };
  return { label: 'Abstimmung abgebrochen', badge: 'badge-offline' };
}

function groupPolls(polls) {
  const groups = new Map();
  for (const poll of polls) {
    if (!groups.has(poll.decisionKey)) groups.set(poll.decisionKey, []);
    groups.get(poll.decisionKey).push(poll);
  }
  return [...groups.entries()]
    .map(([key, rounds]) => ({ key, rounds: rounds.sort((a, b) => b.roundNumber - a.roundNumber) }))
    .sort((a, b) => (b.rounds[0]?.updatedAt ?? 0) - (a.rounds[0]?.updatedAt ?? 0));
}

function responseDraftFor(poll) {
  if (!responseDrafts.has(poll.id)) {
    const initial = { ...(poll.myResponses ?? {}) };
    if (poll.responseMode === 'feasibility') {
      for (const option of poll.options) initial[option.id] ??= 'open';
    } else if (poll.responseMode === 'rating_1_5') {
      for (const option of poll.options) initial[option.id] ??= '';
    } else {
      for (const option of poll.options) initial[option.id] ??= 'cannot';
    }
    responseDrafts.set(poll.id, initial);
  }
  return responseDrafts.get(poll.id);
}

function selectedResponseCount(poll) {
  return Object.values(responseDraftFor(poll)).filter((value) => value === 'can').length;
}

function responseDraftIsValid(poll) {
  const draft = responseDraftFor(poll);
  const allowedValues = poll.responseMode === 'feasibility'
    ? FEASIBILITY_VALUES
    : poll.responseMode === 'rating_1_5'
      ? RATING_VALUES
      : RESPONSE_VALUES;
  if (poll.options.some((option) => !allowedValues.includes(draft[option.id]))) return false;
  const selected = selectedResponseCount(poll);
  if (poll.responseMode === 'single_choice') return selected === 1;
  if (poll.responseMode === 'multiple_choice') {
    return selected >= 1 && (poll.maxSelections === null || selected <= poll.maxSelections);
  }
  return true;
}

function resultDraftFor(poll) {
  if (!resultDrafts.has(poll.id)) resultDrafts.set(poll.id, new Set(poll.selectedOptionIds ?? []));
  return resultDrafts.get(poll.id);
}

function optionUrl(option) {
  const url = option.payload?.url;
  return typeof url === 'string' && /^https?:\/\/[^\s]+$/i.test(url) ? url : null;
}

function responsePeopleGroups(poll, option) {
  if (poll.responseMode === 'rating_1_5') {
    return RATING_VALUES.map((value) => ({ label: `${value} von 5`, people: option.people.ratings?.[value] ?? [] }));
  }
  if (poll.responseMode === 'feasibility') {
    return [
      { label: 'Passt', people: option.people.can },
      { label: 'Wenn nötig', people: option.people.ifNeeded },
      { label: 'Passt nicht', people: option.people.cannot },
    ];
  }
  return [{ label: 'Gewählt', people: option.people.can }];
}

function renderResponseDetails(poll, option) {
  const groups = responsePeopleGroups(poll, option).filter((group) => group.people?.length);
  if (!groups.length) return '';
  const count = groups.reduce((sum, group) => sum + group.people.length, 0);
  return `
    <details class="event-poll-response-details">
      <summary>Antworten (${count})</summary>
      <div class="stack event-poll-response-groups">
        ${groups.map((group) => `
          <div class="stack event-poll-response-group">
            <strong>${escapeHtml(group.label)}</strong>
            <ul class="event-participant-list">
              ${group.people.map((person) => {
                const player = state.players?.find((entry) => entry.id === person.playerId) ?? person;
                return `<li class="event-participant-row"><span class="player-name">${avatarHtml(player, 20)}${escapeHtml(person.name)}</span></li>`;
              }).join('')}
            </ul>
          </div>`).join('')}
      </div>
    </details>`;
}

function renderResponseControl(poll, option) {
  if (!poll.isInvitee || poll.status !== 'open') return '';
  const draft = responseDraftFor(poll);
  if (poll.responseMode === 'rating_1_5') {
    return `
      <div class="selection-toolbar event-poll-response-toolbar" role="group" aria-label="Bewertung für ${escapeHtml(optionLabel(option))}">
        ${RATING_VALUES.map((value) => `
          <button type="button" class="btn btn-sm${draft[option.id] === value ? ' btn-primary' : ''}"
            data-poll-response="${value}" data-poll-id="${escapeHtml(poll.id)}" data-option-id="${escapeHtml(option.id)}"
            aria-label="${value} von 5" aria-pressed="${draft[option.id] === value}">${value}</button>`).join('')}
      </div>`;
  }
  if (poll.responseMode === 'feasibility') {
    const fullLabels = { can: 'Passt', if_needed: 'Wenn nötig', cannot: 'Passt nicht', open: 'Offen' };
    return `
      <div class="selection-toolbar event-poll-response-toolbar" role="group" aria-label="Bewertung für ${escapeHtml(optionLabel(option))}">
        ${FEASIBILITY_VALUES.map((value) => `
          <button type="button" class="btn btn-sm${draft[option.id] === value ? ' btn-primary' : ''}"
            data-poll-response="${value}" data-poll-id="${escapeHtml(poll.id)}" data-option-id="${escapeHtml(option.id)}"
            aria-label="${fullLabels[value]}" aria-pressed="${draft[option.id] === value}">${RESPONSE_LABELS[value]}</button>`).join('')}
      </div>`;
  }
  const selected = draft[option.id] === 'can';
  const label = poll.responseMode === 'single_choice'
    ? (selected ? 'Ausgewählt' : 'Diese Option wählen')
    : (selected ? 'Ausgewählt' : 'Option auswählen');
  return `
    <div class="selection-toolbar event-poll-response-toolbar">
      <button type="button" class="btn btn-sm${selected ? ' btn-primary' : ''}" data-poll-choice="${escapeHtml(poll.id)}"
        data-option-id="${escapeHtml(option.id)}" aria-pressed="${selected}">${selected ? `${icon('check')} ` : ''}${label}</button>
    </div>`;
}

function renderCounts(poll, option) {
  if (poll.responseMode === 'rating_1_5') {
    const ratingCount = RATING_VALUES.reduce((sum, value) => sum + (option.counts.ratings?.[value] ?? 0), 0);
    const average = option.counts.average === null ? '–' : option.counts.average.toLocaleString('de-DE', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
    return `Ø ${average} · ${ratingCount} ${ratingCount === 1 ? 'Bewertung' : 'Bewertungen'} · ${option.counts.open} offen`;
  }
  if (poll.responseMode === 'feasibility') {
    return `Passt ${option.counts.can} · Notfalls ${option.counts.ifNeeded} · Nein ${option.counts.cannot} · Offen ${option.counts.open}`;
  }
  return `${option.counts.can} ${option.counts.can === 1 ? 'Stimme' : 'Stimmen'} · ${option.counts.open} offen`;
}

function renderOption(poll, option, selectedResults) {
  const isResult = selectedResults.has(option.id);
  const link = optionUrl(option);
  return `
    <div class="event-poll-option" data-poll-option="${escapeHtml(option.id)}">
      <div class="row-between event-poll-option-header">
        <span class="stack event-poll-option-copy"><strong>${escapeHtml(optionLabel(option))}</strong>${option.description ? `<span class="muted">${escapeHtml(option.description)}</span>` : ''}</span>
        <span class="row event-poll-option-badges">
          ${isResult ? '<span class="badge badge-playing">Ergebnis</span>' : ''}
          ${option.isRecommended && poll.status !== 'cancelled' ? `<span class="badge badge-online">${['feasibility', 'rating_1_5'].includes(poll.responseMode) ? 'Beste Bewertung' : 'Meiste Stimmen'}</span>` : ''}
          ${link ? `<a class="btn btn-sm event-poll-option-link" href="${escapeHtml(link)}" target="_blank" rel="noopener noreferrer">${icon('squareArrowOutUpRight')} Link</a>` : ''}
        </span>
      </div>
      <div class="event-poll-option-response-row">
        <span class="muted event-poll-counts">${renderCounts(poll, option)}</span>
        ${renderResponseControl(poll, option)}
        ${renderResponseDetails(poll, option)}
      </div>
    </div>`;
}

function renderResultPicker(poll) {
  const selected = resultDraftFor(poll);
  const multiple = poll.responseMode === 'multiple_choice';
  return `
    <div class="event-poll-management tournament-section-panel stack">
      <div class="stack event-poll-management-copy">
        <strong>Ergebnis dieser Runde festhalten</strong>
        <span class="muted">Wähle ${multiple ? 'die Ergebnisoptionen' : 'eine Ergebnisoption'} für die Historie. Eventdaten werden dadurch nicht geändert.</span>
      </div>
      <div class="stack event-poll-result-options">
        ${poll.options.map((option) => {
          const active = selected.has(option.id);
          return `<button type="button" class="btn event-poll-result-option${active ? ' btn-primary' : ''}"
            data-result-poll="${escapeHtml(poll.id)}" data-result-option="${escapeHtml(option.id)}" aria-pressed="${active}">
            <span>${escapeHtml(optionLabel(option))}</span><span>${active ? icon('check') : ''}</span>
          </button>`;
        }).join('')}
      </div>
      <button type="button" class="btn btn-primary btn-block" data-decide-poll="${escapeHtml(poll.id)}">Ergebnis festhalten</button>
    </div>`;
}

function renderManagerHeaderActions(poll) {
  if (!poll.canManage) return '';
  const unanswered = poll.invitees.filter((invitee) => !invitee.hasAnswered).length;
  if (poll.status === 'open') {
    return `
      <div class="event-poll-header-actions">
        <button type="button" class="btn btn-sm" data-remind-poll="${escapeHtml(poll.id)}" ${unanswered === 0 ? 'disabled' : ''}>Erinnerung versenden (${unanswered})</button>
        <button type="button" class="btn btn-sm" data-close-poll="${escapeHtml(poll.id)}">Beenden</button>
        <button type="button" class="btn btn-sm btn-danger" data-cancel-poll="${escapeHtml(poll.id)}">Abbrechen</button>
      </div>`;
  }
  if (poll.status === 'closed') {
    return `
      <div class="event-poll-header-actions">
        <button type="button" class="btn btn-sm" data-reopen-poll="${escapeHtml(poll.id)}">Wieder öffnen</button>
        <button type="button" class="btn btn-sm btn-danger" data-cancel-poll="${escapeHtml(poll.id)}">Abbrechen</button>
      </div>`;
  }
  return '';
}

function renderManagerContent(poll) {
  return poll.canManage && poll.status === 'closed' ? renderResultPicker(poll) : '';
}

function renderRound(poll) {
  const answered = poll.invitees.filter((invitee) => invitee.hasAnswered).length;
  const selectedResults = new Set(poll.selectedOptionIds ?? (poll.selectedOptionId ? [poll.selectedOptionId] : []));
  const mode = MODE_INFO[poll.responseMode] ?? MODE_INFO.feasibility;
  const maxCopy = poll.responseMode === 'multiple_choice' && poll.maxSelections ? ` · höchstens ${poll.maxSelections}` : '';
  return `
    <section class="stack event-poll-round" data-poll-round="${escapeHtml(poll.id)}">
      <span class="muted">${escapeHtml(mode.label)}${maxCopy}</span>
      ${poll.note ? `<p class="event-poll-note">${escapeHtml(poll.note)}</p>` : ''}
      <div class="event-poll-progress row-between">
        <span>${answered} von ${poll.invitees.length} haben abgestimmt</span><span>Frist: ${formatDate(poll.responseDueAt)}</span>
      </div>
      <div class="stack event-poll-options">${poll.options.map((option) => renderOption(poll, option, selectedResults)).join('')}</div>
      ${poll.isInvitee && poll.status === 'open'
        ? `<div class="row event-poll-save-row"><button type="button" class="btn btn-primary btn-sm" data-save-poll="${escapeHtml(poll.id)}" ${responseDraftIsValid(poll) ? '' : 'disabled'}>Speichern</button></div>`
        : ''}
      ${poll.decisionNote ? `<p class="muted">Notiz zum Ergebnis: ${escapeHtml(poll.decisionNote)}</p>` : ''}
      ${renderManagerContent(poll)}
    </section>`;
}

function renderHistoryRound(poll) {
  const status = pollStatusInfo(poll.status);
  const selected = new Set(poll.selectedOptionIds ?? []);
  const result = poll.options.filter((option) => selected.has(option.id)).map(optionLabel).join(', ');
  return `
    <div class="tournament-section-panel event-poll-history-round">
      <div class="row-between"><strong>Runde ${poll.roundNumber}</strong><span class="badge ${status.badge}">${status.label}</span></div>
      <span class="muted">Frist: ${formatDate(poll.responseDueAt)} · ${poll.invitees.filter((entry) => entry.hasAnswered).length} von ${poll.invitees.length} abgestimmt</span>
      ${result ? `<span>Ergebnis: <strong>${escapeHtml(result)}</strong></span>` : ''}
    </div>`;
}

function renderHistory(group) {
  const history = group.rounds.slice(1);
  if (!history.length) return '';
  const key = `${group.key}:history`;
  return `
    <details class="collapsible-section event-poll-history" data-poll-history="${escapeHtml(key)}" ${expandedHistories.has(key) ? 'open' : ''}>
      <summary class="collapsible-section-header">
        <span class="collapsible-section-chevron" aria-hidden="true">${icon('chevronRight')}</span><span>Frühere Runden (${history.length})</span>
      </summary>
      <div class="collapsible-section-content stack">${history.map(renderHistoryRound).join('')}</div>
    </details>`;
}

function renderPollGroup(group) {
  const latest = group.rounds[0];
  const status = pollStatusInfo(latest.status);
  const answered = latest.invitees.filter((invitee) => invitee.hasAnswered).length;
  const canStartRound = latest.canManage && ['scheduled', 'superseded', 'cancelled'].includes(latest.status);
  const expanded = expandedPolls.has(group.key);
  return `
    <article class="card event-poll-card" data-poll-group="${escapeHtml(group.key)}">
      <header class="event-poll-card-header">
        <button type="button" class="event-poll-card-toggle" data-toggle-poll="${escapeHtml(group.key)}" aria-expanded="${expanded}">
          <span class="collapsible-section-chevron" aria-hidden="true">${icon('chevronRight')}</span>
          <span class="event-poll-card-title"><strong>${escapeHtml(latest.title)}</strong><span class="muted">von ${escapeHtml(latest.createdByName ?? 'Unbekannt')} · Runde ${latest.roundNumber}</span></span>
          <span class="event-poll-card-meta"><span class="badge ${status.badge}">${status.label}</span><span class="muted">${answered}/${latest.invitees.length} abgestimmt</span></span>
        </button>
        ${renderManagerHeaderActions(latest)}
      </header>
      <div class="stack event-poll-card-content" ${expanded ? '' : 'hidden'}>
        ${renderRound(latest)}
        ${canStartRound ? `<button type="button" class="btn btn-sm" data-new-poll-round="${escapeHtml(latest.id)}">+ Neue Runde starten</button>` : ''}
        ${renderHistory(group)}
      </div>
    </article>`;
}

function optionRowHtml(index, value = {}) {
  const showDetails = Boolean(value.description || value.url);
  return `
    <div class="event-poll-form-option" data-poll-option-row="${index}">
      <div class="row-between">
        <label for="poll-option-${index}" class="field-label">Option ${index + 1}</label>
        <button type="button" class="icon-btn" data-remove-poll-option aria-label="Option entfernen" title="Option entfernen">${icon('trash')}</button>
      </div>
      <input type="text" id="poll-option-${index}" data-poll-option-input maxlength="120" required value="${escapeHtml(value.label ?? '')}" placeholder="z. B. Ferienhaus am See" />
      <details class="event-poll-form-option-details" ${showDetails ? 'open' : ''}>
        <summary>Notiz oder Link hinzufügen</summary>
        <div class="field-row event-poll-option-extra-fields">
          <div><label for="poll-option-note-${index}" class="field-label">Kurze Notiz (optional)</label><input type="text" id="poll-option-note-${index}" data-poll-option-note maxlength="240" value="${escapeHtml(value.description ?? '')}" placeholder="Zusätzliche Information" /></div>
          <div><label for="poll-option-url-${index}" class="field-label">Link (optional)</label><input type="url" id="poll-option-url-${index}" data-poll-option-url maxlength="500" value="${escapeHtml(value.url ?? '')}" placeholder="https://…" /></div>
        </div>
      </details>
    </div>`;
}

function readIsoDate(modal, id) {
  return modal.querySelector(`#${id}`)?.value?.slice(0, 10) || null;
}

function openPollForm(event, ctx, previousRound = null) {
  const initialMode = previousRound?.responseMode ?? 'feasibility';
  const initialOptions = previousRound?.options?.map((option) => ({
    label: optionLabel(option),
    description: option.description ?? '',
    url: optionUrl(option) ?? '',
  })) ?? [{}, {}];
  let nextOptionIndex = initialOptions.length;
  let dirty = false;
  let capturedModal;
  const { close } = openModal(previousRound ? `Neue Runde · ${previousRound.title}` : 'Abstimmung starten', `
    <form id="event-poll-form" class="stack">
      <div><label for="poll-title" class="field-label">Titel</label><input type="text" id="poll-title" maxlength="100" required value="${escapeHtml(previousRound?.title ?? '')}" placeholder="Worüber möchtet ihr abstimmen?" autofocus /></div>
      <div><label for="poll-note" class="field-label">Beschreibung (optional)</label><textarea id="poll-note" maxlength="500" rows="2" placeholder="Kurzer Kontext für alle Teilnehmer">${escapeHtml(previousRound?.note ?? '')}</textarea></div>
      <div>
        <div class="title-with-info">
          <label for="poll-mode" class="field-label">Antwortart</label>
          ${infoTooltipHtml('poll-mode-help', 'Antwortart', 'Wähle Einzel- oder Mehrfachauswahl, eine Bewertung jeder Option als Passt/Wenn nötig/Passt nicht oder eine Punktzahl von 1 bis 5.')}
        </div>
        <select id="poll-mode">
          ${Object.entries(MODE_INFO).map(([value, info]) => `<option value="${value}" ${initialMode === value ? 'selected' : ''}>${escapeHtml(info.label)}</option>`).join('')}
        </select>
      </div>
      <div id="poll-max-wrap" ${initialMode === 'multiple_choice' ? '' : 'hidden'}>
        <label for="poll-max" class="field-label">Stimmen pro Person</label>
        <div class="field-row event-poll-max-field"><input id="poll-max" type="number" min="1" max="8" value="${previousRound?.maxSelections ?? ''}" placeholder="Unbegrenzt" /><span class="muted">Leer lassen, wenn alle Optionen gewählt werden dürfen.</span></div>
      </div>
      <div class="stack">
        <div class="row-between"><span class="field-label">Optionen</span><span class="muted">2 bis 8</span></div>
        <div class="stack" id="poll-option-rows">${initialOptions.map((value, index) => optionRowHtml(index, value)).join('')}</div>
        <button type="button" class="btn btn-sm" id="poll-add-option">+ Option hinzufügen</button>
      </div>
      <div>
        <div class="title-with-info">
          <label for="poll-due" class="field-label">Abstimmungsfrist</label>
          ${infoTooltipHtml('poll-due-help', 'Abstimmungsfrist', 'Teilnehmer mit noch offener Antwort werden automatisch zwei Tage und zwei Stunden vor Fristende erinnert.')}
        </div>
        ${dateTimeFieldHtml('poll-due', Date.now() + 7 * 86_400_000, { dateOnly: true, clearable: false, label: 'Abstimmungsfrist' })}
      </div>
      <button type="submit" class="btn btn-primary btn-block">${previousRound ? 'Neue Runde starten' : 'Abstimmung starten'}</button>
    </form>`, {
    confirmClose: () => (dirty && capturedModal ? 'Die eingegebenen Angaben gehen verloren.' : null),
    onMount: (modal) => {
      capturedModal = modal;
      wireDateTimeField(modal, 'poll-due');
      wireInfoTooltips(modal);
      const markDirty = () => { dirty = true; };
      modal.querySelector('#event-poll-form').addEventListener('input', markDirty);
      modal.querySelector('#event-poll-form').addEventListener('change', markDirty);
      modal.querySelector('#poll-mode').addEventListener('change', (eventChange) => {
        dirty = true;
        modal.querySelector('#poll-max-wrap').hidden = eventChange.target.value !== 'multiple_choice';
      });
      modal.querySelector('#poll-add-option').addEventListener('click', () => {
        if (modal.querySelectorAll('[data-poll-option-row]').length >= 8) return showToast('Höchstens acht Optionen sind möglich.', { error: true });
        dirty = true;
        modal.querySelector('#poll-option-rows').insertAdjacentHTML('beforeend', optionRowHtml(nextOptionIndex));
        modal.querySelector(`#poll-option-${nextOptionIndex}`)?.focus();
        nextOptionIndex += 1;
      });
      modal.querySelector('#poll-option-rows').addEventListener('click', (eventClick) => {
        const button = eventClick.target.closest('[data-remove-poll-option]');
        if (!button) return;
        if (modal.querySelectorAll('[data-poll-option-row]').length <= 2) return showToast('Mindestens zwei Optionen sind erforderlich.', { error: true });
        dirty = true;
        button.closest('[data-poll-option-row]').remove();
      });
      modal.querySelector('#event-poll-form').addEventListener('submit', async (submitEvent) => {
        submitEvent.preventDefault();
        const submitButton = submitEvent.submitter;
        const title = modal.querySelector('#poll-title').value.trim();
        const optionRows = [...modal.querySelectorAll('[data-poll-option-row]')];
        const options = optionRows.map((row) => ({
          label: row.querySelector('[data-poll-option-input]').value.trim(),
          description: row.querySelector('[data-poll-option-note]').value.trim() || null,
          url: row.querySelector('[data-poll-option-url]').value.trim(),
        }));
        const labels = options.map((option) => option.label);
        if (!title) return showToast('Bitte einen Titel eingeben.', { error: true });
        if (labels.some((label) => !label)) return showToast('Bitte alle Optionen benennen.', { error: true });
        if (new Set(labels.map((label) => label.toLocaleLowerCase('de'))).size !== labels.length) return showToast('Optionen dürfen nicht doppelt vorkommen.', { error: true });
        if (options.some((option) => option.url && !/^https?:\/\/[^\s]+$/i.test(option.url))) return showToast('Links müssen mit http:// oder https:// beginnen.', { error: true });
        const responseDueOn = readIsoDate(modal, 'poll-due');
        if (!responseDueOn) return showToast('Bitte eine Abstimmungsfrist wählen.', { error: true });
        const responseMode = modal.querySelector('#poll-mode').value;
        const rawMax = modal.querySelector('#poll-max').value;
        const maxSelections = responseMode === 'multiple_choice' && rawMax ? Number(rawMax) : null;
        if (maxSelections !== null && (!Number.isInteger(maxSelections) || maxSelections < 1 || maxSelections > labels.length)) return showToast(`Die Stimmenzahl muss zwischen 1 und ${labels.length} liegen.`, { error: true });
        submitButton.disabled = true;
        try {
          const createdPoll = await api.eventPolls.create(event.id, {
            topic: 'custom', ...(previousRound ? { decisionKey: previousRound.decisionKey } : {}), title,
            note: modal.querySelector('#poll-note').value.trim() || null, responseMode, maxSelections,
            options: options.map((option) => ({
              label: option.label,
              description: option.description,
              payload: option.url ? { url: option.url } : {},
            })), responseDueOn,
          });
          expandedPolls.add(createdPoll.decisionKey);
          dirty = false;
          invalidateEventPolls();
          close();
          await ctx.refresh();
          showToast(previousRound ? 'Neue Runde gestartet.' : 'Abstimmung gestartet.');
        } catch (error) {
          submitButton.disabled = false;
          showToast(error.message, { error: true });
        }
      });
    },
  });
}

function openReopenForm(event, poll, ctx) {
  let dirty = false;
  const { close } = openModal('Abstimmung wieder öffnen', `
    <form id="reopen-poll-form" class="stack">
      <p class="muted">Lege eine neue Frist fest. Danach können alle bestätigten Eventteilnehmer ihre Antwort wieder ändern.</p>
      <div><label for="reopen-poll-due" class="field-label">Neue Abstimmungsfrist</label>${dateTimeFieldHtml('reopen-poll-due', Date.now() + 7 * 86_400_000, { dateOnly: true, clearable: false, label: 'Neue Abstimmungsfrist' })}</div>
      <button type="submit" class="btn btn-primary btn-block">Abstimmung wieder öffnen</button>
    </form>`, {
    confirmClose: () => (dirty ? 'Die gewählte Frist geht verloren.' : null),
    onMount: (modal) => {
      wireDateTimeField(modal, 'reopen-poll-due');
      modal.querySelector('#reopen-poll-form').addEventListener('change', () => { dirty = true; });
      modal.querySelector('#reopen-poll-form').addEventListener('submit', async (eventSubmit) => {
        eventSubmit.preventDefault();
        const responseDueOn = readIsoDate(modal, 'reopen-poll-due');
        if (!responseDueOn) return;
        eventSubmit.submitter.disabled = true;
        try {
          await api.eventPolls.reopen(event.id, poll.id, responseDueOn);
          dirty = false;
          invalidateEventPolls();
          close();
          await ctx.refresh();
          showToast('Abstimmung wieder geöffnet.');
        } catch (error) {
          eventSubmit.submitter.disabled = false;
          showToast(error.message, { error: true });
        }
      });
    },
  });
}

function findPoll(polls, pollId) {
  return polls.find((poll) => poll.id === pollId);
}

function wirePollActions(container, event, polls, ctx) {
  container.querySelectorAll('[data-toggle-poll]').forEach((button) => button.addEventListener('click', () => {
    const key = button.dataset.togglePoll;
    if (expandedPolls.has(key)) expandedPolls.delete(key);
    else expandedPolls.add(key);
    ctx.rerender();
  }));
  container.querySelectorAll('[data-poll-history]').forEach((details) => details.addEventListener('toggle', () => {
    if (details.open) expandedHistories.add(details.dataset.pollHistory);
    else expandedHistories.delete(details.dataset.pollHistory);
  }));
  container.querySelectorAll('[data-poll-response]').forEach((button) => button.addEventListener('click', () => {
    const poll = findPoll(polls, button.dataset.pollId);
    if (!poll) return;
    responseDraftFor(poll)[button.dataset.optionId] = button.dataset.pollResponse;
    ctx.rerender();
  }));
  container.querySelectorAll('[data-poll-choice]').forEach((button) => button.addEventListener('click', () => {
    const poll = findPoll(polls, button.dataset.pollChoice);
    if (!poll) return;
    const draft = responseDraftFor(poll);
    const optionId = button.dataset.optionId;
    if (poll.responseMode === 'single_choice') {
      poll.options.forEach((option) => { draft[option.id] = option.id === optionId ? 'can' : 'cannot'; });
    } else {
      const nextSelected = draft[optionId] !== 'can';
      if (nextSelected && poll.maxSelections !== null && selectedResponseCount(poll) >= poll.maxSelections) return showToast(`Du kannst höchstens ${poll.maxSelections} Optionen auswählen.`, { error: true });
      draft[optionId] = nextSelected ? 'can' : 'cannot';
    }
    ctx.rerender();
  }));
  container.querySelectorAll('[data-save-poll]').forEach((button) => button.addEventListener('click', async () => {
    const poll = findPoll(polls, button.dataset.savePoll);
    if (!poll || !responseDraftIsValid(poll)) return showToast('Bitte die Abstimmung vollständig beantworten.', { error: true });
    button.disabled = true;
    const draft = responseDraftFor(poll);
    try {
      const responses = poll.options.flatMap((option) =>
        poll.responseMode === 'feasibility' && draft[option.id] === 'open'
          ? []
          : [{ optionId: option.id, response: draft[option.id] }]
      );
      await api.eventPolls.submitMyResponses(event.id, poll.id, responses);
      responseDrafts.delete(poll.id);
      invalidateEventPolls();
      await ctx.refresh();
      showToast('Antwort gespeichert.');
    } catch (error) {
      button.disabled = false;
      showToast(error.message, { error: true });
    }
  }));
  container.querySelectorAll('[data-result-option]').forEach((button) => button.addEventListener('click', () => {
    const poll = findPoll(polls, button.dataset.resultPoll);
    if (!poll) return;
    const selected = resultDraftFor(poll);
    const optionId = button.dataset.resultOption;
    if (poll.responseMode !== 'multiple_choice') {
      selected.clear();
      selected.add(optionId);
    } else if (selected.has(optionId)) selected.delete(optionId);
    else {
      if (poll.maxSelections !== null && selected.size >= poll.maxSelections) return showToast(`Höchstens ${poll.maxSelections} Ergebnisoptionen sind möglich.`, { error: true });
      selected.add(optionId);
    }
    ctx.rerender();
  }));
  container.querySelectorAll('[data-decide-poll]').forEach((button) => button.addEventListener('click', async () => {
    const poll = findPoll(polls, button.dataset.decidePoll);
    const optionIds = poll ? [...resultDraftFor(poll)] : [];
    if (!poll || !optionIds.length) return showToast('Bitte mindestens eine Ergebnisoption auswählen.', { error: true });
    const confirmed = await confirmDialog('Das Ergebnis wird nur in der Rundenhistorie gespeichert. Ort, Termin, Kosten und andere Eventdaten bleiben unverändert.', { title: 'Ergebnis festhalten?', confirmText: 'Ergebnis festhalten' });
    if (!confirmed) return;
    button.disabled = true;
    try {
      await api.eventPolls.decide(event.id, poll.id, optionIds);
      invalidateEventPolls();
      await ctx.refresh();
      showToast('Ergebnis in der Rundenhistorie festgehalten.');
    } catch (error) {
      button.disabled = false;
      showToast(error.message, { error: true });
    }
  }));
  container.querySelectorAll('[data-close-poll]').forEach((button) => button.addEventListener('click', async () => {
    const confirmed = await confirmDialog('Danach können keine Stimmen mehr abgegeben werden. Du kannst die Abstimmung später mit einer neuen Frist wieder öffnen oder ein Ergebnis festhalten.', { title: 'Abstimmung beenden?', confirmText: 'Abstimmung beenden' });
    if (!confirmed) return;
    button.disabled = true;
    try {
      await api.eventPolls.close(event.id, button.dataset.closePoll);
      invalidateEventPolls();
      await ctx.refresh();
      showToast('Abstimmung beendet.');
    } catch (error) {
      button.disabled = false;
      showToast(error.message, { error: true });
    }
  }));
  container.querySelectorAll('[data-remind-poll]').forEach((button) => button.addEventListener('click', async () => {
    button.disabled = true;
    try {
      const result = await api.eventPolls.sendReminders(event.id, button.dataset.remindPoll);
      showToast(result.remindedPlayerIds.length ? `${result.remindedPlayerIds.length} noch nicht abgestimmte Person(en) erinnert.` : 'Aktuell musste niemand erinnert werden.');
    } catch (error) {
      showToast(error.message, { error: true });
    } finally {
      button.disabled = false;
    }
  }));
  container.querySelectorAll('[data-reopen-poll]').forEach((button) => button.addEventListener('click', () => {
    const poll = findPoll(polls, button.dataset.reopenPoll);
    if (poll) openReopenForm(event, poll, ctx);
  }));
  container.querySelectorAll('[data-cancel-poll]').forEach((button) => button.addEventListener('click', async () => {
    const confirmed = await confirmDialog('Die Abstimmung wird als abgebrochen in der Historie gespeichert. Abgegebene Stimmen bleiben dort nachvollziehbar.', { title: 'Abstimmung abbrechen?', confirmText: 'Abstimmung abbrechen', danger: true });
    if (!confirmed) return;
    button.disabled = true;
    try {
      await api.eventPolls.cancel(event.id, button.dataset.cancelPoll);
      invalidateEventPolls();
      await ctx.refresh();
      showToast('Abstimmung abgebrochen.');
    } catch (error) {
      button.disabled = false;
      showToast(error.message, { error: true });
    }
  }));
  container.querySelectorAll('[data-new-poll-round]').forEach((button) => button.addEventListener('click', () => {
    const poll = findPoll(polls, button.dataset.newPollRound);
    if (poll) openPollForm(event, ctx, poll);
  }));
}

export function renderEventPolls(container, ctx) {
  const event = state.activeEvent;
  if (!event || event.isBase || event.id === 'base') {
    container.innerHTML = emptyStateHtml('<h2>Event auswählen</h2><p class="muted">Lege das Event zuerst an und wähle es oben rechts aus. Alle Abstimmungen in diesem Tab gehören anschließend zum aktiven Event.</p>', { icon: icon('vote') });
    return;
  }
  loadPolls(event.id, ctx);
  const cached = pollCache.get(event.id);
  const polls = cached?.polls ?? [];
  const groups = groupPolls(polls);
  if (cached?.loaded && !initializedEvents.has(event.id)) {
    initializedEvents.add(event.id);
    const preferred = groups.find((group) => ['open', 'closed'].includes(group.rounds[0]?.status)) ?? groups[0];
    if (preferred) expandedPolls.add(preferred.key);
  }
  let content;
  if (cached?.loading) content = emptyStateHtml('Abstimmungen werden geladen…');
  else if (cached?.error) content = `<div class="card stack"><p class="muted">${escapeHtml(cached.error)}</p><button type="button" class="btn btn-sm" id="retry-event-polls">Erneut versuchen</button></div>`;
  else if (!groups.length) content = emptyStateHtml('<h2>Noch keine Abstimmung</h2><p class="muted">Starte eine Abstimmung mit freien Optionen. Sie verändert das Event nicht.</p>', { icon: icon('vote') });
  else content = `<div class="stack event-poll-list">${groups.map(renderPollGroup).join('')}</div>`;
  container.innerHTML = `
    <div class="stack event-polls-page" data-event-polls-event="${escapeHtml(event.id)}">
      <div class="row view-actions event-polls-page-actions">
        <button type="button" class="btn btn-primary btn-sm" id="new-event-poll">Abstimmung starten</button>
      </div>
      ${content}
    </div>`;
  container.querySelector('#new-event-poll')?.addEventListener('click', () => openPollForm(event, ctx));
  container.querySelector('#retry-event-polls')?.addEventListener('click', () => {
    pollCache.delete(event.id);
    ctx.rerender();
  });
  wirePollActions(container, event, polls, ctx);
}
