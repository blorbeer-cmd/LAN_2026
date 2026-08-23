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
const pollCacheVersions = new Map();
const responseDrafts = new Map();
const responseDraftSources = new Map();
const dirtyResponseDrafts = new Set();
const expandedPolls = new Set();
const expandedHistories = new Set();
const initializedEvents = new Set();

export function invalidateEventPolls() {
  for (const [eventId, cached] of pollCache) {
    pollCacheVersions.set(eventId, (pollCacheVersions.get(eventId) ?? 0) + 1);
    pollCache.set(eventId, { ...cached, loading: false, loaded: false, error: null });
  }
}

function loadPolls(eventId, ctx) {
  const cached = pollCache.get(eventId);
  if (cached?.loading || cached?.loaded) return;
  const requestVersion = pollCacheVersions.get(eventId) ?? 0;
  pollCache.set(eventId, { loading: true, loaded: false, polls: cached?.polls ?? [] });
  api.eventPolls
    .list(eventId)
    .then((polls) => {
      if ((pollCacheVersions.get(eventId) ?? 0) !== requestVersion) return;
      pollCache.set(eventId, { loading: false, loaded: true, polls, error: null });
      ctx.rerender();
    })
    .catch((error) => {
      if ((pollCacheVersions.get(eventId) ?? 0) !== requestVersion) return;
      pollCache.set(eventId, { loading: false, loaded: true, polls: [], error: error.message });
      ctx.rerender();
    });
}

async function refreshPolls(eventId, ctx) {
  const requestVersion = (pollCacheVersions.get(eventId) ?? 0) + 1;
  pollCacheVersions.set(eventId, requestVersion);
  try {
    const polls = await api.eventPolls.list(eventId);
    if ((pollCacheVersions.get(eventId) ?? 0) !== requestVersion) return;
    pollCache.set(eventId, { loading: false, loaded: true, polls, error: null });
    ctx.rerender();
  } catch (error) {
    if ((pollCacheVersions.get(eventId) ?? 0) !== requestVersion) return;
    showToast(error.message, { error: true });
  }
}

function optionLabel(option) {
  return option.label || (option.startsOn === option.endsOn ? option.startsOn : `${option.startsOn} – ${option.endsOn}`);
}

function formatDate(timestamp) {
  return new Date(timestamp).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

function formatDateTime(timestamp) {
  return new Date(timestamp).toLocaleString('de-DE', {
    day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}

function pollStatusInfo(status) {
  if (status === 'open') return { label: 'Abstimmung läuft', badge: 'badge-playing' };
  if (status === 'closed') return { label: 'Abstimmung beendet', badge: 'badge-paused' };
  if (status === 'scheduled') return { label: 'Abstimmung beendet', badge: 'badge-paused' };
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

function responseDraftSource(poll) {
  return JSON.stringify(poll.options.map((option) => [option.id, poll.myResponses?.[option.id] ?? null]));
}

function defaultResponseValue(poll) {
  if (poll.responseMode === 'feasibility') return 'open';
  if (poll.responseMode === 'rating_1_5') return '';
  return 'cannot';
}

function freshResponseDraft(poll) {
  const initial = { ...(poll.myResponses ?? {}) };
  for (const option of poll.options) initial[option.id] ??= defaultResponseValue(poll);
  return initial;
}

function resetResponseDraft(poll) {
  const draft = freshResponseDraft(poll);
  responseDrafts.set(poll.id, draft);
  responseDraftSources.set(poll.id, responseDraftSource(poll));
  dirtyResponseDrafts.delete(poll.id);
  return draft;
}

function responseDraftFor(poll) {
  const source = responseDraftSource(poll);
  if (
    !responseDrafts.has(poll.id) ||
    (!dirtyResponseDrafts.has(poll.id) && responseDraftSources.get(poll.id) !== source)
  ) {
    return resetResponseDraft(poll);
  }
  const draft = responseDrafts.get(poll.id);
  const optionIds = new Set(poll.options.map((option) => option.id));
  for (const option of poll.options) draft[option.id] ??= defaultResponseValue(poll);
  for (const optionId of Object.keys(draft)) {
    if (!optionIds.has(optionId)) delete draft[optionId];
  }
  return draft;
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

function optionUrl(option) {
  const url = option.payload?.url;
  return typeof url === 'string' && /^https?:\/\/[^\s]+$/i.test(url) ? url : null;
}

function responsePeopleGroups(poll, option) {
  if (poll.responseMode === 'rating_1_5') {
    return [...RATING_VALUES].reverse().map((value) => ({ label: `${value} von 5`, people: option.people.ratings?.[value] ?? [] }));
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

function resultSortValues(poll, option) {
  if (poll.responseMode === 'rating_1_5') return [option.counts.average ?? -1, -option.counts.open];
  if (poll.responseMode === 'feasibility') return [option.counts.can, option.counts.ifNeeded, -option.counts.cannot];
  return [option.counts.can, -option.counts.open];
}

function optionsByResult(poll) {
  return [...poll.options].sort((left, right) => {
    const leftValues = resultSortValues(poll, left);
    const rightValues = resultSortValues(poll, right);
    for (let index = 0; index < Math.max(leftValues.length, rightValues.length); index += 1) {
      if ((rightValues[index] ?? 0) !== (leftValues[index] ?? 0)) return (rightValues[index] ?? 0) - (leftValues[index] ?? 0);
    }
    return left.position - right.position;
  });
}

function bestResultLabel(poll) {
  if (poll.status === 'open') return '';
  const best = poll.options.find((option) => option.isRecommended);
  return best ? optionLabel(best) : '';
}

function openVoteDetails(poll) {
  if (!poll.responseDetailsVisible || poll.anonymous || poll.status === 'open') return;
  const options = optionsByResult(poll);
  const hasResponses = options.some((option) => responsePeopleGroups(poll, option).some((group) => group.people?.length));
  openModal(`Stimmen · ${poll.title}`, hasResponses ? `
    <div class="stack event-poll-vote-details">
      ${options.map((option, index) => {
        const groups = responsePeopleGroups(poll, option).filter((group) => group.people?.length);
        if (!groups.length) return '';
        return `
          <section class="event-poll-vote-option stack">
            <div class="row-between"><strong>${index + 1}. ${escapeHtml(optionLabel(option))}</strong><span class="muted">${escapeHtml(renderCounts(poll, option))}</span></div>
            ${groups.map((group) => `
              <div class="event-poll-vote-group stack">
                <span class="muted">${escapeHtml(group.label)}</span>
                ${group.people
                  .slice()
                  .sort((left, right) => right.updatedAt - left.updatedAt)
                  .map((person) => {
                    const player = state.players?.find((entry) => entry.id === person.playerId) ?? person;
                    return `<div class="event-poll-vote-person row-between"><span class="player-name">${avatarHtml(player, 20)}${escapeHtml(person.name)}</span><time class="muted" datetime="${new Date(person.updatedAt).toISOString()}">${escapeHtml(formatDateTime(person.updatedAt))}</time></div>`;
                  }).join('')}
              </div>`).join('')}
          </section>`;
      }).join('')}
    </div>` : '<p class="muted">Für diese Runde wurden keine Stimmen abgegeben.</p>');
}

function renderResponseControl(poll, option) {
  if (!poll.isInvitee || poll.status !== 'open') return '';
  const draft = responseDraftFor(poll);
  if (poll.responseMode === 'rating_1_5') {
    return `
      <div class="selection-toolbar event-poll-response-toolbar event-poll-rating-toolbar" role="group" aria-label="Bewertung für ${escapeHtml(optionLabel(option))}">
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
  const label = selected ? 'Ausgewählt' : 'Wählen';
  return `
    <div class="event-poll-choice-control">
      <div class="selection-toolbar event-poll-response-toolbar">
        <button type="button" class="btn btn-sm event-poll-choice-btn${selected ? ' btn-primary' : ''}" data-poll-choice="${escapeHtml(poll.id)}"
          data-option-id="${escapeHtml(option.id)}" aria-pressed="${selected}">${label}</button>
      </div>
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

function renderOption(poll, option) {
  const link = optionUrl(option);
  const label = optionLabel(option);
  const recommendation = option.isRecommended && poll.status !== 'cancelled'
    ? `<span class="badge badge-online">${['feasibility', 'rating_1_5'].includes(poll.responseMode) ? 'Beste Bewertung' : 'Meiste Stimmen'}</span>`
    : '';
  return `
    <div class="event-poll-option${recommendation ? ' has-recommendation' : ''}" data-poll-option="${escapeHtml(option.id)}">
      <div class="row-between event-poll-option-header">
        <span class="event-poll-option-title-row">
          <strong>${escapeHtml(label)}</strong>
          ${option.description ? infoTooltipHtml(`poll-option-note-${poll.id}-${option.id}`, `Notiz zu ${label}`, option.description) : ''}
          ${link ? `<a class="icon-btn event-poll-option-link" href="${escapeHtml(link)}" target="_blank" rel="noopener noreferrer" aria-label="Link zu ${escapeHtml(label)} öffnen" title="Link öffnen">${icon('squareArrowOutUpRight')}</a>` : ''}
        </span>
        <span class="row event-poll-option-badges">
          ${recommendation}
        </span>
      </div>
      <div class="event-poll-option-response-row">
        <span class="muted event-poll-counts">${renderCounts(poll, option)}</span>
        ${renderResponseControl(poll, option)}
      </div>
    </div>`;
}

function renderPollActions(poll) {
  const unanswered = poll.invitees.filter((invitee) => !invitee.hasAnswered).length;
  const actions = [];
  if (poll.status === 'open') {
    if (poll.canManage) {
      actions.push(`<button type="button" data-edit-poll="${escapeHtml(poll.id)}">Bearbeiten</button>`);
      actions.push(`<button type="button" data-remind-poll="${escapeHtml(poll.id)}" ${unanswered === 0 ? 'disabled' : ''}>Erinnerung versenden (${unanswered})</button>`);
      actions.push(`<button type="button" data-close-poll="${escapeHtml(poll.id)}">Beenden</button>`);
      actions.push(`<button type="button" class="is-danger" data-delete-poll="${escapeHtml(poll.id)}">Löschen</button>`);
    }
  } else {
    if (poll.responseDetailsVisible && !poll.anonymous) {
      actions.push(`<button type="button" data-view-poll-votes="${escapeHtml(poll.id)}">Stimmen ansehen</button>`);
    }
    if (poll.canManage) {
      actions.push(`<button type="button" data-reopen-poll="${escapeHtml(poll.id)}">Wieder öffnen</button>`);
      actions.push(`<button type="button" data-new-poll-round="${escapeHtml(poll.id)}">Erneut abstimmen</button>`);
      actions.push(`<button type="button" class="is-danger" data-delete-poll="${escapeHtml(poll.id)}">Löschen</button>`);
    }
  }
  if (!actions.length) return '';
  return `
    <details class="event-poll-action-menu">
      <summary class="btn btn-sm">Aktion</summary>
      <div class="event-poll-action-menu-panel">${actions.join('')}</div>
    </details>`;
}

function renderRound(poll) {
  const answered = poll.invitees.filter((invitee) => invitee.hasAnswered).length;
  const mode = MODE_INFO[poll.responseMode] ?? MODE_INFO.feasibility;
  const maxCopy = poll.responseMode === 'multiple_choice' && poll.maxSelections ? ` · höchstens ${poll.maxSelections}` : '';
  const anonymousCopy = poll.anonymous ? ' · Anonym' : '';
  const modeCopy = poll.responseMode === 'rating_1_5' ? (poll.anonymous ? 'Anonym' : '') : `${mode.label}${maxCopy}${anonymousCopy}`;
  return `
    <section class="stack event-poll-round" data-poll-round="${escapeHtml(poll.id)}">
      ${modeCopy ? `<span class="muted">${escapeHtml(modeCopy)}</span>` : ''}
      ${poll.note ? `<p class="event-poll-note">${escapeHtml(poll.note)}</p>` : ''}
      <div class="event-poll-progress row-between">
        <span>${answered} von ${poll.invitees.length} haben abgestimmt</span><span>Frist: ${formatDate(poll.responseDueAt)}</span>
      </div>
      ${poll.status !== 'open' && poll.status !== 'cancelled' ? '<div class="section-title event-poll-result-title">Ergebnis</div>' : ''}
      <div class="stack event-poll-options">${poll.options.map((option) => renderOption(poll, option)).join('')}</div>
      ${poll.isInvitee && poll.status === 'open'
        ? `<div class="row event-poll-save-row"><button type="button" class="btn btn-primary btn-sm" data-save-poll="${escapeHtml(poll.id)}" ${responseDraftIsValid(poll) ? '' : 'disabled'}>Speichern</button></div>`
        : ''}
    </section>`;
}

function renderHistoryRound(poll) {
  const status = pollStatusInfo(poll.status);
  return `
    <div class="tournament-section-panel event-poll-history-round">
      <div class="row-between"><strong>Runde ${poll.roundNumber}</strong><span class="badge ${status.badge}">${status.label}</span></div>
      <span class="muted">Frist: ${formatDate(poll.responseDueAt)} · ${poll.invitees.filter((entry) => entry.hasAnswered).length} von ${poll.invitees.length} abgestimmt${poll.anonymous ? ' · Anonym' : ''}</span>
      <details class="event-poll-history-details">
        <summary>Optionen und Antworten</summary>
        <div class="stack event-poll-options">${poll.options.map((option) => renderOption(poll, option)).join('')}</div>
      </details>
    </div>`;
}

function renderHistory(group) {
  const history = group.rounds.slice(1);
  if (!history.length) return '';
  const key = `${group.key}:history`;
  return `
    <details class="collapsible-section event-poll-history" data-poll-history="${escapeHtml(key)}" ${expandedHistories.has(key) ? 'open' : ''}>
      <summary class="collapsible-section-header">
        <span class="row"><span class="collapsible-section-chevron" aria-hidden="true">${icon('chevronRight')}</span><span>Frühere Runden (${history.length})</span></span>
      </summary>
      <div class="collapsible-section-content stack">${history.map(renderHistoryRound).join('')}</div>
    </details>`;
}

function renderEndedPolls(groups, eventId) {
  if (!groups.length) return '';
  const key = `${eventId}:ended-polls`;
  return `
    <details class="collapsible-section event-poll-ended-history" data-poll-history="${escapeHtml(key)}" ${expandedHistories.has(key) ? 'open' : ''}>
      <summary class="collapsible-section-header">
        <span class="row"><span class="collapsible-section-chevron" aria-hidden="true">${icon('chevronRight')}</span><span>Beendete Abstimmungen (${groups.length})</span></span>
      </summary>
      <div class="collapsible-section-content stack event-poll-list">${groups.map(renderPollGroup).join('')}</div>
    </details>`;
}

function renderPollGroup(group) {
  const latest = group.rounds[0];
  const status = pollStatusInfo(latest.status);
  const answered = latest.invitees.filter((invitee) => invitee.hasAnswered).length;
  const expanded = expandedPolls.has(group.key);
  const bestResult = bestResultLabel(latest);
  return `
    <article class="card event-poll-card" data-poll-group="${escapeHtml(group.key)}" data-poll-card="${escapeHtml(latest.id)}">
      <header class="event-poll-card-header">
        <button type="button" class="event-poll-card-toggle" data-toggle-poll="${escapeHtml(group.key)}" aria-expanded="${expanded}">
          <span class="collapsible-section-chevron" aria-hidden="true">${icon('chevronRight')}</span>
          <span class="event-poll-card-title"><strong>${escapeHtml(latest.title)}</strong><span class="muted">von ${escapeHtml(latest.createdByName ?? 'Unbekannt')} · Runde ${latest.roundNumber}</span><span class="muted">Gestartet: ${formatDate(latest.createdAt)} · Frist: ${formatDate(latest.responseDueAt)}</span></span>
        </button>
        <div class="event-poll-card-side">
          <span class="event-poll-card-meta"><span class="badge ${status.badge}">${status.label}</span><span class="muted">${answered}/${latest.invitees.length} abgestimmt</span>${bestResult ? `<span class="event-poll-best-result" title="Bestes Ergebnis: ${escapeHtml(bestResult)}">Ergebnis: ${escapeHtml(bestResult)}</span>` : ''}</span>
          ${renderPollActions(latest)}
        </div>
      </header>
      <div class="stack event-poll-card-content" ${expanded ? '' : 'hidden'}>
        ${renderRound(latest)}
        ${renderHistory(group)}
      </div>
    </article>`;
}

function optionRowHtml(index, value = {}) {
  const showDetails = Boolean(value.description || value.url);
  return `
    <div class="event-poll-form-option" data-poll-option-row="${index}"${value.id ? ` data-poll-option-id="${escapeHtml(value.id)}"` : ''}>
      <div class="row-between">
        <label for="poll-option-${index}" class="field-label">Option ${index + 1}</label>
        ${value.id ? '' : `<button type="button" class="icon-btn" data-remove-poll-option aria-label="Option entfernen" title="Option entfernen">${icon('trash')}</button>`}
      </div>
      <input type="text" id="poll-option-${index}" data-poll-option-input maxlength="120" required value="${escapeHtml(value.label ?? '')}" placeholder="z. B. Ferienhaus am See" />
      <details class="event-poll-form-option-details" ${showDetails ? 'open' : ''}>
        <summary>Notiz oder Link hinzufügen</summary>
        <div class="field-row event-poll-option-extra-fields">
          <div><label for="poll-option-note-${index}" class="field-label">Kurze Notiz (optional)</label><input type="text" id="poll-option-note-${index}" data-poll-option-note maxlength="500" value="${escapeHtml(value.description ?? '')}" placeholder="Zusätzliche Information" /></div>
          <div><label for="poll-option-url-${index}" class="field-label">Link (optional)</label><input type="url" id="poll-option-url-${index}" data-poll-option-url maxlength="500" value="${escapeHtml(value.url ?? '')}" placeholder="https://…" /></div>
        </div>
      </details>
    </div>`;
}

function optionValuesFromForm(modal) {
  return [...modal.querySelectorAll('[data-poll-option-row]')].map((row) => ({
    ...(row.dataset.pollOptionId ? { id: row.dataset.pollOptionId } : {}),
    label: row.querySelector('[data-poll-option-input]').value.trim(),
    description: row.querySelector('[data-poll-option-note]').value.trim() || null,
    url: row.querySelector('[data-poll-option-url]').value.trim(),
  }));
}

function validateOptionValues(options) {
  const labels = options.map((option) => option.label);
  if (labels.some((label) => !label)) return 'Bitte alle Optionen benennen.';
  if (new Set(labels.map((label) => label.toLocaleLowerCase('de'))).size !== labels.length) return 'Optionen dürfen nicht doppelt vorkommen.';
  if (options.some((option) => option.url && !/^https?:\/\/[^\s]+$/i.test(option.url))) return 'Links müssen mit http:// oder https:// beginnen.';
  return null;
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
  const { close } = openModal(previousRound ? `Erneut abstimmen · ${previousRound.title}` : 'Abstimmung starten', `
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
      <div class="check-row">
        <input type="checkbox" id="poll-anonymous" ${previousRound?.anonymous ? 'checked' : ''} />
        <span class="title-with-info tournament-option-label">
          <label for="poll-anonymous">Anonyme Abstimmung</label>
          ${infoTooltipHtml('poll-anonymous-help', 'Anonyme Abstimmung', 'Stimmen bleiben dauerhaft anonym. Auch nach Ende der Abstimmung ist nicht sichtbar, wer wie abgestimmt hat.')}
        </span>
      </div>
      <div class="stack">
        <div class="row-between"><span class="field-label">Optionen</span><span class="muted">2 bis 8</span></div>
        <div class="stack" id="poll-option-rows">${initialOptions.map((value, index) => optionRowHtml(index, value)).join('')}</div>
        <button type="button" class="btn btn-sm" id="poll-add-option">Option hinzufügen</button>
      </div>
      <div>
        <div class="title-with-info">
          <label for="poll-due" class="field-label">Abstimmungsfrist</label>
          ${infoTooltipHtml('poll-due-help', 'Abstimmungsfrist', 'Teilnehmer mit noch offener Antwort werden automatisch zwei Tage und zwei Stunden vor Fristende erinnert.')}
        </div>
        ${dateTimeFieldHtml('poll-due', Date.now() + 7 * 86_400_000, { dateOnly: true, clearable: false, label: 'Abstimmungsfrist' })}
      </div>
      <button type="submit" class="btn btn-primary btn-block">${previousRound ? 'Erneut abstimmen' : 'Abstimmung starten'}</button>
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
        const options = optionValuesFromForm(modal);
        const labels = options.map((option) => option.label);
        if (!title) return showToast('Bitte einen Titel eingeben.', { error: true });
        const optionError = validateOptionValues(options);
        if (optionError) return showToast(optionError, { error: true });
        const responseDueOn = readIsoDate(modal, 'poll-due');
        if (!responseDueOn) return showToast('Bitte eine Abstimmungsfrist wählen.', { error: true });
        const responseMode = modal.querySelector('#poll-mode').value;
        const rawMax = modal.querySelector('#poll-max').value;
        const maxSelections = responseMode === 'multiple_choice' && rawMax ? Number(rawMax) : null;
        if (maxSelections !== null && (!Number.isInteger(maxSelections) || maxSelections < 1 || maxSelections > labels.length)) return showToast(`Die Stimmenzahl muss zwischen 1 und ${labels.length} liegen.`, { error: true });
        submitButton.disabled = true;
        try {
          const createdPoll = await api.eventPolls.create(event.id, {
            topic: 'custom', ...(previousRound ? { previousPollId: previousRound.id } : {}), title,
            note: modal.querySelector('#poll-note').value.trim() || null, responseMode, maxSelections,
            anonymous: modal.querySelector('#poll-anonymous').checked,
            options: options.map((option) => ({
              label: option.label,
              description: option.description,
              payload: option.url ? { url: option.url } : {},
            })), responseDueOn,
          });
          expandedPolls.add(createdPoll.decisionKey);
          await replaceCachedPoll(event.id, createdPoll, ctx);
          dirty = false;
          close();
          showToast(previousRound ? 'Neue Abstimmungsrunde gestartet.' : 'Abstimmung gestartet.');
        } catch (error) {
          submitButton.disabled = false;
          showToast(error.message, { error: true });
        }
      });
    },
  });
}

function openEditPollForm(event, poll, ctx) {
  const initialOptions = poll.options.map((option) => ({
    id: option.id,
    label: optionLabel(option),
    description: option.description ?? '',
    url: optionUrl(option) ?? '',
  }));
  let nextOptionIndex = initialOptions.length;
  let dirty = false;
  let capturedModal;
  const mode = MODE_INFO[poll.responseMode] ?? MODE_INFO.feasibility;
  const { close } = openModal('Abstimmung bearbeiten', `
    <form id="event-poll-edit-form" class="stack">
      <div><label for="poll-edit-title" class="field-label">Titel</label><input type="text" id="poll-edit-title" maxlength="100" required value="${escapeHtml(poll.title)}" autofocus /></div>
      <div><label for="poll-edit-note" class="field-label">Beschreibung (optional)</label><textarea id="poll-edit-note" maxlength="500" rows="2" placeholder="Kurzer Kontext für alle Teilnehmer">${escapeHtml(poll.note ?? '')}</textarea></div>
      <div class="stack event-poll-edit-mode">
        <span class="field-label">Antwortart</span>
        <span class="muted">${escapeHtml(mode.label)}${poll.anonymous ? ' · Anonym' : ''}</span>
      </div>
      <div class="stack">
        <div class="row-between"><span class="field-label">Optionen</span><span class="muted">2 bis 8</span></div>
        <div class="stack" id="poll-option-rows">${initialOptions.map((value, index) => optionRowHtml(index, value)).join('')}</div>
        <button type="button" class="btn btn-sm" id="poll-add-option">Option hinzufügen</button>
      </div>
      <div>
        <div class="title-with-info">
          <label for="poll-edit-due" class="field-label">Abstimmungsfrist</label>
          ${infoTooltipHtml(`poll-edit-due-help-${poll.id}`, 'Abstimmungsfrist', 'Teilnehmer mit noch offener Antwort werden automatisch zwei Tage und zwei Stunden vor Fristende erinnert.')}
        </div>
        ${dateTimeFieldHtml('poll-edit-due', poll.responseDueAt, { dateOnly: true, clearable: false, label: 'Abstimmungsfrist' })}
      </div>
      <button type="submit" class="btn btn-primary btn-block">Speichern</button>
    </form>`, {
    confirmClose: () => (dirty && capturedModal ? 'Die Änderungen gehen verloren.' : null),
    onMount: (modal) => {
      capturedModal = modal;
      wireDateTimeField(modal, 'poll-edit-due');
      wireInfoTooltips(modal);
      const markDirty = () => { dirty = true; };
      modal.querySelector('#event-poll-edit-form').addEventListener('input', markDirty);
      modal.querySelector('#event-poll-edit-form').addEventListener('change', markDirty);
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
        dirty = true;
        button.closest('[data-poll-option-row]').remove();
      });
      modal.querySelector('#event-poll-edit-form').addEventListener('submit', async (submitEvent) => {
        submitEvent.preventDefault();
        const title = modal.querySelector('#poll-edit-title').value.trim();
        const options = optionValuesFromForm(modal);
        if (!title) return showToast('Bitte einen Titel eingeben.', { error: true });
        const optionError = validateOptionValues(options);
        if (optionError) return showToast(optionError, { error: true });
        const responseDueOn = readIsoDate(modal, 'poll-edit-due');
        if (!responseDueOn) return showToast('Bitte eine Abstimmungsfrist wählen.', { error: true });
        submitEvent.submitter.disabled = true;
        try {
          const updatedPoll = await api.eventPolls.update(event.id, poll.id, {
            title,
            note: modal.querySelector('#poll-edit-note').value.trim() || null,
            responseDueOn,
            options: options.map((option) => ({
              ...(option.id ? { id: option.id } : {}),
              label: option.label,
              description: option.description,
              payload: option.url ? { url: option.url } : {},
            })),
          });
          const addedOptionCount = updatedPoll.options.length - poll.options.length;
          await replaceCachedPoll(event.id, updatedPoll, ctx);
          dirty = false;
          close();
          showToast(addedOptionCount > 0
            ? 'Abstimmung gespeichert. Bereits abgestimmte Teilnehmer wurden informiert.'
            : 'Abstimmung gespeichert.');
        } catch (error) {
          submitEvent.submitter.disabled = false;
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
          const updatedPoll = await api.eventPolls.reopen(event.id, poll.id, responseDueOn);
          await replaceCachedPoll(event.id, updatedPoll, ctx);
          dirty = false;
          close();
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

function replaceCachedPoll(eventId, updatedPoll, ctx, { resetResponses = false } = {}) {
  pollCacheVersions.set(eventId, (pollCacheVersions.get(eventId) ?? 0) + 1);
  const cached = pollCache.get(eventId);
  const polls = [...(cached?.polls ?? [])];
  const index = polls.findIndex((poll) => poll.id === updatedPoll.id);
  if (index === -1) polls.push(updatedPoll);
  else polls[index] = updatedPoll;
  pollCache.set(eventId, { loading: false, loaded: true, polls, error: null });
  if (resetResponses) resetResponseDraft(updatedPoll);
  ctx.rerender();
  return refreshPolls(eventId, ctx);
}

function removeCachedPollSeries(eventId, decisionKey, ctx) {
  pollCacheVersions.set(eventId, (pollCacheVersions.get(eventId) ?? 0) + 1);
  const cached = pollCache.get(eventId);
  pollCache.set(eventId, {
    loading: false,
    loaded: true,
    polls: (cached?.polls ?? []).filter((poll) => poll.decisionKey !== decisionKey),
    error: null,
  });
  expandedPolls.delete(decisionKey);
  ctx.rerender();
  return refreshPolls(eventId, ctx);
}

function wirePollActions(container, event, polls, ctx) {
  container.querySelectorAll('.event-poll-action-menu-panel button').forEach((button) => button.addEventListener('click', () => {
    button.closest('.event-poll-action-menu').open = false;
  }));
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
    dirtyResponseDrafts.add(poll.id);
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
    dirtyResponseDrafts.add(poll.id);
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
      const updatedPoll = await api.eventPolls.submitMyResponses(event.id, poll.id, responses);
      await replaceCachedPoll(event.id, updatedPoll, ctx, { resetResponses: true });
      showToast('Antwort gespeichert.');
    } catch (error) {
      button.disabled = false;
      showToast(error.message, { error: true });
    }
  }));
  container.querySelectorAll('[data-edit-poll]').forEach((button) => button.addEventListener('click', () => {
    const poll = findPoll(polls, button.dataset.editPoll);
    if (poll) openEditPollForm(event, poll, ctx);
  }));
  container.querySelectorAll('[data-close-poll]').forEach((button) => button.addEventListener('click', async () => {
    const confirmed = await confirmDialog('Danach können keine Stimmen mehr abgegeben werden. Das Ergebnis bleibt in dieser Runde sichtbar und die Abstimmung kann später wieder geöffnet werden.', { title: 'Abstimmung beenden?', confirmText: 'Beenden' });
    if (!confirmed) return;
    button.disabled = true;
    try {
      const updatedPoll = await api.eventPolls.close(event.id, button.dataset.closePoll);
      await replaceCachedPoll(event.id, updatedPoll, ctx);
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
  container.querySelectorAll('[data-view-poll-votes]').forEach((button) => button.addEventListener('click', () => {
    const poll = findPoll(polls, button.dataset.viewPollVotes);
    if (poll) openVoteDetails(poll);
  }));
  container.querySelectorAll('[data-delete-poll]').forEach((button) => button.addEventListener('click', async () => {
    const poll = findPoll(polls, button.dataset.deletePoll);
    if (!poll) return;
    const confirmed = await confirmDialog('Die Abstimmung wird einschließlich aller Runden und abgegebenen Stimmen dauerhaft gelöscht.', { title: 'Abstimmung löschen?', confirmText: 'Löschen', danger: true });
    if (!confirmed) return;
    button.disabled = true;
    try {
      await api.eventPolls.remove(event.id, poll.id);
      await removeCachedPollSeries(event.id, poll.decisionKey, ctx);
      showToast('Abstimmung gelöscht.');
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

function visiblePollViewportAnchors(container) {
  const viewport = container.getBoundingClientRect();
  return [...container.querySelectorAll('[data-poll-group]')]
    .map((element) => {
      const rect = element.getBoundingClientRect();
      return {
        id: element.dataset.pollGroup,
        offset: rect.top - viewport.top,
        visible: rect.bottom > viewport.top && rect.top < viewport.bottom,
      };
    })
    .filter((anchor) => anchor.id && anchor.visible)
    .sort((a, b) => Math.abs(a.offset) - Math.abs(b.offset));
}

function restorePollViewportAnchor(container, anchors, previousScrollTop) {
  container.scrollTop = previousScrollTop;
  const viewportTop = container.getBoundingClientRect().top;
  const cards = [...container.querySelectorAll('[data-poll-group]')];
  for (const anchor of anchors) {
    const element = cards.find((card) => card.dataset.pollGroup === anchor.id);
    if (!element || element.getClientRects().length === 0) continue;
    container.scrollTop += element.getBoundingClientRect().top - viewportTop - anchor.offset;
    return;
  }
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
  const activeGroups = groups.filter((group) => group.rounds[0]?.status === 'open');
  const endedGroups = groups.filter((group) => group.rounds[0]?.status !== 'open');
  if (cached?.loaded && !initializedEvents.has(event.id)) {
    initializedEvents.add(event.id);
    const preferred = activeGroups[0];
    if (preferred) expandedPolls.add(preferred.key);
  }
  let content;
  if (cached?.loading && !groups.length) content = emptyStateHtml('Abstimmungen werden geladen…');
  else if (cached?.error) content = `<div class="card stack"><p class="muted">${escapeHtml(cached.error)}</p><button type="button" class="btn btn-sm" id="retry-event-polls">Erneut versuchen</button></div>`;
  else if (!groups.length) content = emptyStateHtml('<h2>Noch keine Abstimmung</h2><p class="muted">Starte eine Abstimmung mit freien Optionen. Sie verändert das Event nicht.</p>', { icon: icon('vote') });
  else content = `
    ${activeGroups.length ? `<div class="stack event-poll-list">${activeGroups.map(renderPollGroup).join('')}</div>` : ''}
    ${renderEndedPolls(endedGroups, event.id)}`;
  const scrollTop = container.scrollTop;
  const viewportAnchors = visiblePollViewportAnchors(container);
  container.innerHTML = `
    <div class="stack event-polls-page" data-event-polls-event="${escapeHtml(event.id)}">
      <div class="row view-actions event-polls-page-actions">
        <button type="button" class="btn btn-primary btn-sm" id="new-event-poll">Abstimmung starten</button>
      </div>
      ${content}
    </div>`;
  restorePollViewportAnchor(container, viewportAnchors, scrollTop);
  wireInfoTooltips(container);
  container.querySelector('#new-event-poll')?.addEventListener('click', () => openPollForm(event, ctx));
  container.querySelector('#retry-event-polls')?.addEventListener('click', () => {
    pollCache.delete(event.id);
    ctx.rerender();
  });
  wirePollActions(container, event, polls, ctx);
}
