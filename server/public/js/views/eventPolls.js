import { actionMenuHtml, wireActionMenus } from '../actionMenu.js';
import { api } from '../api.js';
import { state } from '../state.js';
import { escapeHtml } from '../format.js';
import { showToast } from '../toast.js';
import { openModal, confirmDialog } from '../modal.js';
import { icon } from '../icons.js';
import { emptyStateHtml } from '../emptyState.js';
import { dateTimeFieldHtml, wireDateTimeField } from '../dateTimeField.js';
import { infoTooltipHtml, wireInfoTooltips } from '../infoTooltip.js';
import { ratingScaleHtml } from '../ratingScale.js';
import { voteBreakdownHtml, voterNamesText, voterStackHtml, WIN_CHIP } from '../voteBreakdown.js';

const RESPONSE_VALUES = ['can', 'if_needed', 'cannot'];
const FEASIBILITY_VALUES = [...RESPONSE_VALUES, 'open'];
const RATING_VALUES = ['0', '1', '2', '3', '4', '5'];
const RESPONSE_LABELS = { can: 'Passt', if_needed: 'Notfalls', cannot: 'Nein', open: 'Offen' };
const MODE_INFO = {
  feasibility: {
    label: 'Jede Option bewerten',
    description: 'Für jede Option wird Passt, Wenn nötig, Passt nicht oder Offen gewählt.',
  },
  single_choice: {
    label: 'Einzelauswahl',
    description: 'Jede Person gibt genau einer Option ihre Stimme.',
  },
  multiple_choice: {
    label: 'Mehrfachauswahl',
    description: 'Jede Person kann mehrere passende Optionen auswählen.',
  },
  rating_1_5: {
    label: 'Bewertung 0 bis 5',
    description: 'Jede Person vergibt für jede Option eine Bewertung von 0 bis 5; 0 lehnt die Option ab.',
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
// Polls that waited for the viewer's answer when the page first loaded stay
// on top for the whole visit; answering never reorders the list under the
// viewer's finger.
const waitingAtLoad = new Map();
let pendingAnchorFrame;

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

function formatShortDate(timestamp) {
  return new Date(timestamp).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' });
}

// Running and ended polls are already told apart by their section, so only an
// exceptional state earns a badge of its own.
function pollStatusBadge(status) {
  if (status === 'cancelled') return '<span class="badge badge-offline">Abgebrochen</span>';
  return '';
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
  return JSON.stringify(poll.options.filter((option) => option.active).map((option) => [option.id, poll.myResponses?.[option.id] ?? null]));
}

function defaultResponseValue(poll) {
  if (poll.responseMode === 'feasibility') return 'open';
  if (poll.responseMode === 'rating_1_5') return '';
  return 'cannot';
}

function freshResponseDraft(poll) {
  const initial = {};
  for (const option of poll.options.filter((entry) => entry.active)) initial[option.id] = poll.myResponses?.[option.id] ?? defaultResponseValue(poll);
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
  const optionIds = new Set(poll.options.filter((option) => option.active).map((option) => option.id));
  for (const option of poll.options.filter((entry) => entry.active)) draft[option.id] ??= defaultResponseValue(poll);
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
  if (poll.options.some((option) => option.active && !allowedValues.includes(draft[option.id]))) return false;
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

// Which answer an option's avatar row stands for. Choice and feasibility
// rounds show the people the option actually won over, because every other
// answer is stored for every option and would make all rows look identical.
// A rating round has no single positive value, so it shows everyone who rated
// the option together with their score.
function optionVoters(poll, option) {
  if (!poll.responseDetailsVisible) return { label: '', people: [] };
  if (poll.responseMode === 'rating_1_5') {
    return {
      label: 'Bewertet von',
      people: [...RATING_VALUES].reverse().flatMap((value) => option.people.ratings?.[value] ?? []),
    };
  }
  return {
    label: poll.responseMode === 'feasibility' ? 'Passt' : 'Gewählt von',
    people: option.people.can ?? [],
  };
}

function renderVoterStack(poll, option) {
  const voters = optionVoters(poll, option);
  return voterStackHtml({
    people: voters.people,
    label: `Stimmen zu ${optionLabel(option)} ansehen · ${voters.label}: ${voterNamesText(voters.people)}`,
    attributes: `data-view-poll-votes="${escapeHtml(poll.id)}"`,
  });
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

// Who answered what, as one compact table: one row per person (alphabetical),
// one numbered column per option. The legend above names each number, so the
// column heads stay equally narrow no matter how long an option label is.
const VOTE_CELL_SYMBOLS = {
  can: { icon: 'check', state: 'can', label: 'Passt' },
  if_needed: { icon: 'minus', state: 'if-needed', label: 'Notfalls' },
  cannot: { icon: 'x', state: 'cannot', label: 'Nein' },
};

function voteDetailAnswers(poll, options) {
  const names = new Map();
  const answers = new Map();
  const remember = (option, value, people) => {
    for (const person of people ?? []) {
      names.set(person.playerId, person.name);
      if (!answers.has(person.playerId)) answers.set(person.playerId, new Map());
      answers.get(person.playerId).set(option.id, value);
    }
  };
  for (const option of options) {
    if (poll.responseMode === 'rating_1_5') {
      for (const value of RATING_VALUES) remember(option, String(value), option.people.ratings?.[value]);
    } else if (poll.responseMode === 'feasibility') {
      remember(option, 'can', option.people.can);
      remember(option, 'if_needed', option.people.ifNeeded);
      remember(option, 'cannot', option.people.cannot);
    } else {
      remember(option, 'can', option.people.can);
    }
  }
  const people = [...names.entries()]
    .map(([playerId, name]) => ({ playerId, name }))
    .sort((left, right) => left.name.localeCompare(right.name, 'de', { sensitivity: 'base' }));
  return { people, answers };
}

// A 0 in a rating round rejects the option, shown like Vote's "Spielt nicht".
const REJECT_CELL = `<span class="event-poll-vote-cell is-cannot" role="img" aria-label="Lehnt ab" title="Lehnt ab">${icon('x')}</span>`;

function voteDetailCell(poll, value) {
  if (value === undefined) {
    return poll.responseMode === 'feasibility' || poll.responseMode === 'rating_1_5'
      ? '<span class="event-poll-vote-cell is-empty" aria-label="Offen">–</span>'
      : '<span class="event-poll-vote-cell is-empty" aria-hidden="true"></span>';
  }
  if (poll.responseMode === 'rating_1_5') {
    return value === '0' ? REJECT_CELL : `<span class="event-poll-vote-cell is-rating">${escapeHtml(value)}</span>`;
  }
  const symbol = VOTE_CELL_SYMBOLS[value];
  const label = poll.responseMode === 'feasibility' ? symbol.label : 'Gewählt';
  return `<span class="event-poll-vote-cell is-${symbol.state}" role="img" aria-label="${label}" title="${label}">${icon(symbol.icon)}</span>`;
}

function voteDetailSummary(poll, option) {
  if (!option.counts) return '';
  if (poll.responseMode === 'rating_1_5') {
    return option.counts.average === null
      ? ''
      : `Ø ${option.counts.average.toLocaleString('de-DE', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}`;
  }
  if (poll.responseMode === 'feasibility') return `${option.counts.can}× Passt`;
  return `${option.counts.can} ${option.counts.can === 1 ? 'Stimme' : 'Stimmen'}`;
}

function openVoteDetails(poll, { showRound = false } = {}) {
  const options = optionsByResult(poll);
  const decided = poll.status !== 'open' && poll.status !== 'cancelled';
  const { people, answers } = poll.responseDetailsVisible ? voteDetailAnswers(poll, options) : { people: [], answers: new Map() };
  const hasResponses = people.length > 0 || options.some((option) => option.counts?.can || option.counts?.average != null);
  const title = `Stimmen · ${poll.title}${showRound ? ` · Runde ${poll.roundNumber}` : ''}`;
  const hasRejections = poll.responseMode === 'rating_1_5' && people.some((person) => [...(answers.get(person.playerId)?.values() ?? [])].includes('0'));
  const keyHtml = poll.responseMode === 'feasibility' && people.length
    ? `<div class="muted event-poll-vote-key">
         ${Object.values(VOTE_CELL_SYMBOLS).map((symbol) => `<span><span class="event-poll-vote-cell is-${symbol.state}" aria-hidden="true">${icon(symbol.icon)}</span>${symbol.label}</span>`).join('')}
       </div>`
    : hasRejections
      ? `<div class="muted event-poll-vote-key"><span><span class="event-poll-vote-cell is-cannot" aria-hidden="true">${icon('x')}</span>Lehnt ab</span></div>`
      : '';
  const body = voteBreakdownHtml({
    columns: options.map((option) => ({
      label: optionLabel(option),
      win: option.isRecommended && decided,
      summary: voteDetailSummary(poll, option),
    })),
    people,
    keyHtml,
    cellHtml: (person, index) => voteDetailCell(poll, answers.get(person.playerId)?.get(options[index].id)),
  });
  openModal(title, hasResponses ? body : '<p class="muted">Für diese Runde wurden keine Stimmen abgegeben.</p>');
}

function renderResponseControl(poll, option) {
  if (!poll.isInvitee || poll.status !== 'open' || !option.active) return '';
  const draft = responseDraftFor(poll);
  if (poll.responseMode === 'rating_1_5') {
    return ratingScaleHtml({
      selected: draft[option.id],
      groupLabel: `Bewertung für ${optionLabel(option)}`,
      valueLabel: (value) => (value === 0 ? '0 von 5, lehne ab' : `${value} von 5`),
      attributes: (value) => `data-poll-response="${value}" data-poll-id="${escapeHtml(poll.id)}" data-option-id="${escapeHtml(option.id)}"`,
    });
  }
  if (poll.responseMode === 'feasibility') {
    const fullLabels = { can: 'Passt', if_needed: 'Wenn nötig', cannot: 'Passt nicht' };
    return `
      <div class="selection-toolbar event-poll-response-toolbar" role="group" aria-label="Bewertung für ${escapeHtml(optionLabel(option))}">
        ${RESPONSE_VALUES.map((value) => `
          <button type="button" class="btn btn-sm${draft[option.id] === value ? ' is-selected' : ''}"
            data-poll-response="${value}" data-poll-id="${escapeHtml(poll.id)}" data-option-id="${escapeHtml(option.id)}"
            aria-label="${fullLabels[value]}" aria-pressed="${draft[option.id] === value}">${RESPONSE_LABELS[value]}</button>`).join('')}
      </div>`;
  }
  const selected = draft[option.id] === 'can';
  const label = selected ? 'Ausgewählt' : 'Wählen';
  return `
    <div class="event-poll-choice-control">
      <div class="selection-toolbar event-poll-response-toolbar">
        <button type="button" class="btn btn-sm event-poll-choice-btn${selected ? ' is-selected' : ''}" data-poll-choice="${escapeHtml(poll.id)}"
          data-option-id="${escapeHtml(option.id)}" aria-pressed="${selected}">${label}</button>
      </div>
    </div>`;
}

function renderCounts(poll, option) {
  if (!option.counts) return '';
  if (poll.responseMode === 'rating_1_5') {
    const ratingCount = RATING_VALUES.reduce((sum, value) => sum + (option.counts.ratings?.[value] ?? 0), 0);
    const average = option.counts.average === null ? '–' : option.counts.average.toLocaleString('de-DE', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
    const rejected = option.counts.ratings?.['0'] ?? 0;
    return `Ø ${average} · ${ratingCount} ${ratingCount === 1 ? 'Bewertung' : 'Bewertungen'}${rejected ? ` · ${rejected} ${rejected === 1 ? 'lehnt' : 'lehnen'} ab` : ''}${option.active ? ` · ${option.counts.open} offen` : ''}`;
  }
  if (poll.responseMode === 'feasibility') {
    return `${option.counts.can} Passt · ${option.counts.ifNeeded} Notfalls · ${option.counts.cannot} Nein${option.active ? ` · ${option.counts.open} offen` : ''}`;
  }
  return `${option.counts.can} ${option.counts.can === 1 ? 'Stimme' : 'Stimmen'}${option.active ? ` · ${option.counts.open} offen` : ''}`;
}

const percent = (value, total) => `${Math.round((Math.max(0, value) / Math.max(1, total)) * 1000) / 10}%`;

// Interim or final result as one bar in the middle of the option row. The
// fill is a soft gradient in the brand colors: for "Jede Option bewerten" the
// colors of Passt, Notfalls and Nein meet at the middle of their segments, so
// each answer keeps its hue while neighbours blend instead of hard edges.
function renderResultBar(poll, option) {
  // An empty cell keeps the avatar and answer columns in place.
  if (!option.counts) return '<span class="event-poll-result"></span>';
  const total = poll.invitees.length;
  let fill = '';
  if (poll.responseMode === 'feasibility') {
    const parts = [
      ['var(--accent)', option.counts.can],
      ['var(--accent-2)', option.counts.ifNeeded],
      ['var(--accent-3)', option.counts.cannot],
    ].filter(([, count]) => count > 0);
    const answered = parts.reduce((sum, [, count]) => sum + count, 0);
    if (answered) {
      let offset = 0;
      const stops = parts.map(([color, count]) => {
        const middle = offset + count / 2;
        offset += count;
        return `${color} ${percent(middle, answered)}`;
      });
      const background = stops.length === 1 ? parts[0][0] : `linear-gradient(90deg, ${stops.join(', ')})`;
      fill = `<span class="event-poll-bar-fill" style="width:${percent(answered, total)};background:${background};"></span>`;
    }
  } else if (poll.responseMode === 'rating_1_5') {
    if (option.counts.average !== null) fill = `<span class="event-poll-bar-fill is-choice" style="width:${percent(option.counts.average, 5)};"></span>`;
  } else if (option.counts.can) {
    fill = `<span class="event-poll-bar-fill is-choice" style="width:${percent(option.counts.can, total)};"></span>`;
  }
  return `
    <span class="event-poll-result">
      <span class="event-poll-bar" aria-hidden="true">${fill}</span>
      <span class="event-poll-counts">${renderLegend(poll, option)}</span>
    </span>`;
}

function renderLegend(poll, option) {
  if (poll.responseMode !== 'feasibility') return escapeHtml(renderCounts(poll, option));
  const item = (key, count, label) => `<span class="event-poll-legend-item"><span class="event-poll-legend-dot is-${key}" aria-hidden="true"></span>${count} ${label}</span>`;
  return [
    item('can', option.counts.can, 'Passt'),
    item('if-needed', option.counts.ifNeeded, 'Notfalls'),
    item('cannot', option.counts.cannot, 'Nein'),
    option.active ? item('open', option.counts.open, 'offen') : '',
  ].join('');
}

// Mirrors the server's hasAnsweredDatePoll on the viewer's own saved answers.
function myAnswerComplete(poll) {
  const active = poll.options.filter((option) => option.active);
  const mine = poll.myResponses ?? {};
  if (!active.length || active.some((option) => !mine[option.id])) return false;
  const selected = active.filter((option) => mine[option.id] === 'can').length;
  if (poll.responseMode === 'single_choice') return selected === 1;
  if (poll.responseMode === 'multiple_choice') return selected >= 1;
  return true;
}

function answerStatusChip(poll) {
  if (poll.status !== 'open' || !poll.isInvitee) return '';
  return myAnswerComplete(poll)
    ? `<span class="badge badge-playing event-poll-answer-chip">${icon('check')}Beantwortet</span>`
    : '<span class="badge event-poll-answer-chip is-missing">Deine Antwort fehlt</span>';
}

function draftProgress(poll) {
  const draft = responseDraftFor(poll);
  const active = poll.options.filter((option) => option.active);
  if (poll.responseMode === 'feasibility' || poll.responseMode === 'rating_1_5') {
    const done = active.filter((option) => draft[option.id] && draft[option.id] !== 'open').length;
    return `${done} von ${active.length} bewertet`;
  }
  const selected = selectedResponseCount(poll);
  if (poll.responseMode === 'multiple_choice' && poll.maxSelections) return `${selected} von ${poll.maxSelections} gewählt`;
  return `${selected} gewählt`;
}

function renderOption(poll, option) {
  const link = optionUrl(option);
  const label = optionLabel(option);
  const win = option.isRecommended && poll.status !== 'open' && poll.status !== 'cancelled';
  const badges = `${renderVoterStack(poll, option)}${!option.active ? '<span class="badge badge-paused">Deaktiviert</span>' : ''}`;
  // Fixed columns: name and note, result bar, voter avatars, answer buttons.
  return `
    <div class="event-poll-option${win ? ' is-winner' : ''}" data-poll-option="${escapeHtml(option.id)}">
      <div class="event-poll-option-info">
        <span class="event-poll-option-title-row">
          <strong>${escapeHtml(label)}</strong>
          ${win ? WIN_CHIP : ''}
          ${option.descriptionEditedAt ? '<span class="badge badge-offline">Bearbeitet</span>' : ''}
          ${link ? `<a class="icon-btn event-poll-option-link" href="${escapeHtml(link)}" target="_blank" rel="noopener noreferrer" aria-label="Link zu ${escapeHtml(label)} öffnen" title="Link öffnen">${icon('squareArrowOutUpRight')}</a>` : ''}
        </span>
        ${option.description ? `<span class="muted event-poll-option-note">${escapeHtml(option.description)}</span>` : ''}
      </div>
      ${renderResultBar(poll, option)}
      <span class="event-poll-option-badges">${badges}</span>
      ${renderResponseControl(poll, option)}
    </div>`;
}

function renderPollSideAction(poll) {
  if (!poll.canManage) return '';
  if (poll.status === 'open') return `<button type="button" class="btn btn-sm" data-close-poll="${escapeHtml(poll.id)}">Beenden</button>`;
  return `<button type="button" class="btn btn-sm" data-new-poll-round="${escapeHtml(poll.id)}">Neue Runde</button>`;
}

function renderPollActions(poll) {
  const unanswered = poll.invitees.filter((invitee) => !invitee.hasAnswered).length;
  const actions = [];
  if (poll.responseDetailsVisible) {
    actions.push(`<button type="button" class="btn btn-sm" data-view-poll-votes="${escapeHtml(poll.id)}">Stimmen ansehen</button>`);
  }
  if (poll.canManage) {
    if (poll.status === 'open') {
      actions.push(`<button type="button" class="btn btn-sm" data-edit-poll="${escapeHtml(poll.id)}">Bearbeiten</button>`);
      actions.push(`<button type="button" class="btn btn-sm" data-remind-poll="${escapeHtml(poll.id)}" ${unanswered === 0 ? 'disabled' : ''}>Erinnern (${unanswered})</button>`);
    } else {
      actions.push(`<button type="button" class="btn btn-sm" data-reopen-poll="${escapeHtml(poll.id)}">Wieder öffnen</button>`);
    }
    actions.push(`<button type="button" class="btn btn-sm btn-danger" data-delete-poll="${escapeHtml(poll.id)}">Löschen</button>`);
  }
  if (!actions.length) return '';
  return actionMenuHtml(actions.join(''), `Aktionen für Umfrage ${poll.title}`);
}

function renderRound(poll) {
  const mode = MODE_INFO[poll.responseMode] ?? MODE_INFO.feasibility;
  const tags = [mode.label];
  if (poll.responseMode === 'multiple_choice' && poll.maxSelections) tags.push(`höchstens ${poll.maxSelections}`);
  if (poll.anonymous) tags.push('Anonym');
  // Said once for the whole round instead of repeating it in every option row.
  if (poll.status === 'open' && poll.liveResultsHidden) {
    tags.push(poll.resultsVisible ? 'Zwischenstand nur für dich' : 'Zwischenstand verborgen');
  }
  const canAnswer = poll.isInvitee && poll.status === 'open';
  return `
    <section class="stack event-poll-round" data-poll-round="${escapeHtml(poll.id)}">
      <div class="event-poll-tags">${tags.map((tag) => `<span class="event-poll-tag">${escapeHtml(tag)}</span>`).join('')}</div>
      ${poll.note ? `<p class="event-poll-note">${escapeHtml(poll.note)}</p>` : ''}
      <div class="stack event-poll-options${canAnswer ? ' has-answers' : ''}">${(poll.status === 'open' ? poll.options : optionsByResult(poll)).map((option) => renderOption(poll, option)).join('')}</div>
      ${canAnswer
        ? `<div class="event-poll-save-row event-poll-footer"><span class="muted">${escapeHtml(draftProgress(poll))}</span><button type="button" class="btn btn-primary btn-sm" data-save-poll="${escapeHtml(poll.id)}" ${responseDraftIsValid(poll) ? '' : 'disabled'}>Speichern</button></div>`
        : ''}
    </section>`;
}

function renderHistoryRound(poll) {
  const bestResult = bestResultLabel(poll);
  const answered = poll.invitees.filter((entry) => entry.hasAnswered).length;
  const meta = [`Runde ${poll.roundNumber}`, formatShortDate(poll.updatedAt), `${answered}/${poll.invitees.length} beantwortet`].join(' · ');
  return `
    <div class="event-poll-history-round">
      <span class="event-poll-history-main">
        <span class="event-poll-history-meta">${escapeHtml(meta)}</span>
        ${bestResult ? `<span class="event-poll-history-result">${WIN_CHIP}<span>${escapeHtml(bestResult)}</span></span>` : '<span class="muted">Keine Stimmen</span>'}
        ${pollStatusBadge(poll.status)}
      </span>
      <button type="button" class="btn btn-sm" data-view-poll-votes="${escapeHtml(poll.id)}">Details</button>
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
      <div class="collapsible-section-content event-poll-history-list">${history.map(renderHistoryRound).join('')}</div>
    </details>`;
}

function renderEndedPolls(groups, eventId) {
  if (!groups.length) return '';
  const key = `${eventId}:ended-polls`;
  return `
    <details class="card grouped-page-section history-details collapsible-section event-poll-ended-history" data-poll-history="${escapeHtml(key)}" ${expandedHistories.has(key) ? 'open' : ''}>
      <summary class="collapsible-section-header">
        <h2>Historie</h2>
        <span class="collapsible-section-summary-end">
          <span class="badge badge-offline">${groups.length}</span>
          <span class="collapsible-section-chevron" aria-hidden="true">${icon('chevronRight')}</span>
        </span>
      </summary>
      <div class="collapsible-section-content stack event-poll-list">${groups.map(renderPollGroup).join('')}</div>
    </details>`;
}

function renderPollGroup(group) {
  const latest = group.rounds[0];
  const answered = latest.invitees.filter((invitee) => invitee.hasAnswered).length;
  const expanded = expandedPolls.has(group.key);
  const bestResult = bestResultLabel(latest);
  const meta = [
    latest.createdByName,
    latest.roundNumber > 1 ? `Runde ${latest.roundNumber}` : null,
    `${answered}/${latest.invitees.length} beantwortet`,
    latest.status === 'open' && latest.responseDueAt !== null ? `Frist ${formatShortDate(latest.responseDueAt)}` : null,
  ].filter(Boolean).map(escapeHtml).join(' · ');
  return `
    <article class="card event-poll-card" data-poll-group="${escapeHtml(group.key)}" data-poll-card="${escapeHtml(latest.id)}">
      <header class="event-poll-card-header">
        <button type="button" class="event-poll-card-toggle" data-toggle-poll="${escapeHtml(group.key)}" aria-expanded="${expanded}">
          <span class="collapsible-section-chevron" aria-hidden="true">${icon('chevronRight')}</span>
          <span class="event-poll-card-title">
            <strong>${escapeHtml(latest.title)}</strong>
            <span class="event-poll-card-meta-line"><span class="muted">${meta}</span>${bestResult ? `<span class="event-poll-best-result">${WIN_CHIP}<span>${escapeHtml(bestResult)}</span></span>` : ''}${pollStatusBadge(latest.status)}<span class="event-poll-answer-inline">${answerStatusChip(latest)}</span></span>
          </span>
        </button>
        <div class="event-poll-card-side">
          <span class="event-poll-answer-side">${answerStatusChip(latest)}</span>
          ${renderPollSideAction(latest)}
          ${renderPollActions(latest)}
        </div>
      </header>
      <div class="stack event-poll-card-content" ${expanded ? '' : 'hidden'}>
        ${renderRound(latest)}
        ${renderHistory(group)}
      </div>
    </article>`;
}

// One compact line per option: name, note/link toggle, selectable switch and
// remove. Note and link open below the line only when asked for or filled.
function optionRowHtml(index, value = {}) {
  const showDetails = Boolean(value.description || value.url);
  const name = `Option ${index + 1}`;
  return `
    <div class="event-poll-form-option" data-poll-option-row="${index}"${value.id ? ` data-poll-option-id="${escapeHtml(value.id)}"` : ''}>
      <div class="event-poll-form-option-main">
        <input type="text" id="poll-option-${index}" data-poll-option-input maxlength="120" required value="${escapeHtml(value.label ?? '')}" placeholder="${name}" aria-label="${name}" />
        <button type="button" class="icon-btn event-poll-option-extra-toggle" data-toggle-option-extra aria-expanded="${showDetails}" aria-label="Notiz oder Link zu ${name}" title="Notiz oder Link">${icon('link')}</button>
        <input class="poll-option-switch" type="checkbox" role="switch" data-poll-option-active aria-label="${name} wählbar" title="Wählbar" ${value.active !== false ? 'checked' : ''} />
        <button type="button" class="icon-btn" data-remove-poll-option aria-label="${name} entfernen" title="Option entfernen">${icon('trash')}</button>
      </div>
      <div class="field-row event-poll-option-extra-fields" data-poll-option-extra ${showDetails ? '' : 'hidden'}>
        <div><label for="poll-option-note-${index}" class="field-label">Notiz</label><input type="text" id="poll-option-note-${index}" data-poll-option-note maxlength="500" value="${escapeHtml(value.description ?? '')}" placeholder="12 Betten, schnelles WLAN" /></div>
        <div><label for="poll-option-url-${index}" class="field-label">Link</label><input type="url" id="poll-option-url-${index}" data-poll-option-url maxlength="500" value="${escapeHtml(value.url ?? '')}" placeholder="https://" /></div>
      </div>
    </div>`;
}

function renumberOptionRows(modal) {
  modal.querySelectorAll('[data-poll-option-row]').forEach((row, index) => {
    const name = `Option ${index + 1}`;
    row.dataset.pollOptionRow = String(index);
    const input = row.querySelector('[data-poll-option-input]');
    input.placeholder = name;
    input.setAttribute('aria-label', name);
    row.querySelector('[data-toggle-option-extra]').setAttribute('aria-label', `Notiz oder Link zu ${name}`);
    row.querySelector('[data-poll-option-active]').setAttribute('aria-label', `${name} wählbar`);
    row.querySelector('[data-remove-poll-option]').setAttribute('aria-label', `${name} entfernen`);
    for (const [selector, id] of [
      ['[data-poll-option-input]', 'poll-option'],
      ['[data-poll-option-note]', 'poll-option-note'],
      ['[data-poll-option-url]', 'poll-option-url'],
    ]) {
      row.querySelector(selector).id = `${id}-${index}`;
    }
    row.querySelector('label[for^="poll-option-note-"]').htmlFor = `poll-option-note-${index}`;
    row.querySelector('label[for^="poll-option-url-"]').htmlFor = `poll-option-url-${index}`;
  });
}

function toggleOptionExtra(eventClick) {
  const toggle = eventClick.target.closest('[data-toggle-option-extra]');
  if (!toggle) return false;
  const extra = toggle.closest('[data-poll-option-row]').querySelector('[data-poll-option-extra]');
  extra.hidden = !extra.hidden;
  toggle.setAttribute('aria-expanded', String(!extra.hidden));
  if (!extra.hidden) extra.querySelector('input')?.focus();
  return true;
}

const DUE_HELP = 'Ohne Frist läuft die Umfrage, bis sie manuell beendet wird. Ist eine Frist gesetzt, werden Teilnehmer mit noch offener Antwort automatisch zwei Tage und zwei Stunden vor Fristende erinnert.';

function dueFieldHtml(id, helpId, value) {
  return `
    <div>
      <div class="title-with-info">
        <label for="${id}-date" class="field-label">Antwortfrist</label>
        ${infoTooltipHtml(helpId, 'Antwortfrist', DUE_HELP)}
      </div>
      ${dateTimeFieldHtml(id, value, { dateOnly: true, clearable: true, label: 'Antwortfrist' })}
    </div>`;
}

function optionsBlockHtml(initialOptions) {
  return `
    <div class="stack event-poll-form-options">
      <span class="field-label is-required">Optionen</span>
      <div class="stack event-poll-form-option-list" id="poll-option-rows">${initialOptions.map((value, index) => optionRowHtml(index, value)).join('')}</div>
      <div class="row"><button type="button" class="btn btn-sm" id="poll-add-option">Option hinzufügen</button></div>
    </div>`;
}

function optionValuesFromForm(modal) {
  return [...modal.querySelectorAll('[data-poll-option-row]')].map((row) => ({
    ...(row.dataset.pollOptionId ? { id: row.dataset.pollOptionId } : {}),
    label: row.querySelector('[data-poll-option-input]').value.trim(),
    description: row.querySelector('[data-poll-option-note]').value.trim() || null,
    url: row.querySelector('[data-poll-option-url]').value.trim(),
    active: row.querySelector('[data-poll-option-active]')?.checked ?? true,
  }));
}

function validateOptionValues(options) {
  const labels = options.map((option) => option.label);
  if (labels.some((label) => !label)) return 'Bitte alle Optionen benennen.';
  if (!options.some((option) => option.active)) return 'Mindestens eine Option muss aktiv bleiben.';
  if (new Set(labels.map((label) => label.toLocaleLowerCase('de'))).size !== labels.length) return 'Optionen dürfen nicht doppelt vorkommen.';
  if (options.some((option) => option.url && !/^https?:\/\/[^\s]+$/i.test(option.url))) return 'Links müssen mit http:// oder https:// beginnen.';
  return null;
}

function readIsoDate(modal, id) {
  return modal.querySelector(`#${id}`)?.value?.slice(0, 10) || null;
}

function openPollForm(event, ctx, previousRound = null) {
  const initialMode = previousRound?.responseMode ?? 'feasibility';
  const initialOptions = previousRound?.options?.filter((option) => option.active).map((option) => ({
    label: optionLabel(option),
    description: option.description ?? '',
    url: optionUrl(option) ?? '',
  })) ?? [{}, {}];
  let dirty = false;
  let capturedModal;
  const { close } = openModal(previousRound ? `Neue Runde · ${previousRound.title}` : 'Umfrage starten', `
    <form id="event-poll-form" class="stack event-poll-form">
      <div><label for="poll-title" class="field-label is-required">Titel</label><input type="text" id="poll-title" maxlength="100" required value="${escapeHtml(previousRound?.title ?? '')}" placeholder="Termin für die Sommer-LAN" autofocus /></div>
      <div><label for="poll-note" class="field-label">Beschreibung</label><textarea id="poll-note" class="event-poll-note-input" maxlength="500" rows="1" placeholder="Bitte bis Freitag abstimmen">${escapeHtml(previousRound?.note ?? '')}</textarea></div>
      <div class="field-row event-poll-form-pair">
        <div>
          <label for="poll-mode" class="field-label is-required">Antwortart</label>
          <select id="poll-mode">
            ${Object.entries(MODE_INFO).map(([value, info]) => `<option value="${value}" ${initialMode === value ? 'selected' : ''}>${escapeHtml(info.label)}</option>`).join('')}
          </select>
        </div>
        ${dueFieldHtml('poll-due', 'poll-due-help', Date.now() + 7 * 86_400_000)}
      </div>
      <div class="field-row event-poll-form-pair" id="poll-max-wrap" ${initialMode === 'multiple_choice' ? '' : 'hidden'}>
        <div><label for="poll-max" class="field-label">Stimmen pro Person</label><input id="poll-max" type="number" min="1" value="${previousRound?.maxSelections ?? ''}" placeholder="Unbegrenzt" /></div>
        <div aria-hidden="true"></div>
      </div>
      <div class="event-poll-form-flags">
        <div class="event-poll-flag">
          <input type="checkbox" id="poll-anonymous" ${previousRound?.anonymous ? 'checked' : ''} />
          <label for="poll-anonymous">Anonym</label>
          ${infoTooltipHtml('poll-anonymous-help', 'Anonym', 'Antworten bleiben dauerhaft anonym. Auch nach Ende der Umfrage ist nicht sichtbar, wer wie geantwortet hat.')}
        </div>
        <div class="event-poll-flag">
          <input type="checkbox" id="poll-hide-live-results" ${(previousRound?.liveResultsHidden ?? true) ? 'checked' : ''} />
          <label for="poll-hide-live-results">Zwischenstand verbergen</label>
          ${infoTooltipHtml('poll-live-results-help', 'Zwischenstand verbergen', 'Solange die Umfrage läuft, sehen nur die Verwaltenden der Umfrage die Stimmen und die Namen. Alle anderen sehen nur ihre eigene Antwort. Nach dem Ende sind Stimmen und Namen für alle sichtbar.')}
        </div>
      </div>
      ${optionsBlockHtml(initialOptions)}
      <div class="row event-poll-save-row"><button type="submit" class="btn btn-primary btn-sm">${previousRound ? 'Neue Runde starten' : 'Umfrage starten'}</button></div>
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
        dirty = true;
        const index = modal.querySelectorAll('[data-poll-option-row]').length;
        modal.querySelector('#poll-option-rows').insertAdjacentHTML('beforeend', optionRowHtml(index));
        modal.querySelector(`#poll-option-${index}`)?.focus();
      });
      modal.querySelector('#poll-option-rows').addEventListener('click', (eventClick) => {
        if (toggleOptionExtra(eventClick)) return;
        const button = eventClick.target.closest('[data-remove-poll-option]');
        if (!button) return;
        if (modal.querySelectorAll('[data-poll-option-row]').length <= 1) return showToast('Mindestens eine Option ist erforderlich.', { error: true });
        dirty = true;
        button.closest('[data-poll-option-row]').remove();
        renumberOptionRows(modal);
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
            hideLiveResults: modal.querySelector('#poll-hide-live-results').checked,
            options: options.map((option) => ({
              label: option.label,
              description: option.description,
              payload: option.url ? { url: option.url } : {},
              active: option.active,
            })), responseDueOn,
          });
          expandedPolls.add(createdPoll.decisionKey);
          await replaceCachedPoll(event.id, createdPoll, ctx);
          dirty = false;
          close();
          showToast(previousRound ? 'Neue Umfragerunde gestartet.' : 'Umfrage gestartet.');
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
    active: option.active,
  }));
  let dirty = false;
  let capturedModal;
  const mode = MODE_INFO[poll.responseMode] ?? MODE_INFO.feasibility;
  const { close } = openModal('Umfrage bearbeiten', `
    <form id="event-poll-edit-form" class="stack event-poll-form">
      <div><label for="poll-edit-title" class="field-label is-required">Titel</label><input type="text" id="poll-edit-title" maxlength="100" required value="${escapeHtml(poll.title)}" placeholder="Termin für die Sommer-LAN" autofocus /></div>
      <div><label for="poll-edit-note" class="field-label">Beschreibung</label><textarea id="poll-edit-note" class="event-poll-note-input" maxlength="500" rows="1" placeholder="Bitte bis Freitag abstimmen">${escapeHtml(poll.note ?? '')}</textarea></div>
      <div class="field-row event-poll-form-pair">
        <div>
          <label for="poll-edit-mode" class="field-label">Antwortart</label>
          <select id="poll-edit-mode" disabled><option>${escapeHtml([mode.label, poll.anonymous ? 'Anonym' : null].filter(Boolean).join(' · '))}</option></select>
        </div>
        ${dueFieldHtml('poll-edit-due', `poll-edit-due-help-${poll.id}`, poll.responseDueAt)}
      </div>
      ${optionsBlockHtml(initialOptions)}
      <div class="row event-poll-save-row"><button type="submit" class="btn btn-primary btn-sm">Speichern</button></div>
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
        dirty = true;
        const index = modal.querySelectorAll('[data-poll-option-row]').length;
        modal.querySelector('#poll-option-rows').insertAdjacentHTML('beforeend', optionRowHtml(index));
        modal.querySelector(`#poll-option-${index}`)?.focus();
      });
      modal.querySelector('#poll-option-rows').addEventListener('click', (eventClick) => {
        if (toggleOptionExtra(eventClick)) return;
        const button = eventClick.target.closest('[data-remove-poll-option]');
        if (!button) return;
        if (modal.querySelectorAll('[data-poll-option-row]').length <= 1) return showToast('Mindestens eine Option ist erforderlich.', { error: true });
        dirty = true;
        button.closest('[data-poll-option-row]').remove();
        renumberOptionRows(modal);
      });
      modal.querySelector('#event-poll-edit-form').addEventListener('submit', async (submitEvent) => {
        submitEvent.preventDefault();
        const title = modal.querySelector('#poll-edit-title').value.trim();
        const options = optionValuesFromForm(modal);
        if (!title) return showToast('Bitte einen Titel eingeben.', { error: true });
        const optionError = validateOptionValues(options);
        if (optionError) return showToast(optionError, { error: true });
        const removedOptions = poll.options.filter((option) => !options.some((entry) => entry.id === option.id));
        if (removedOptions.length) {
          const confirmed = await confirmDialog('Die entfernten Optionen und ihre bisherigen Stimmen werden dauerhaft gelöscht.', { title: 'Optionen löschen?', confirmText: 'Löschen' });
          if (!confirmed) return;
        }
        const responseDueOn = readIsoDate(modal, 'poll-edit-due');
        submitEvent.submitter.disabled = true;
        try {
          const updatedPoll = await api.eventPolls.update(event.id, poll.id, {
            title,
            note: modal.querySelector('#poll-edit-note').value.trim() || null,
            responseDueOn,
            knownOptionIds: poll.options.map((option) => option.id),
            options: options.map((option) => ({
              ...(option.id ? { id: option.id } : {}),
              label: option.label,
              description: option.description,
              payload: option.url ? { url: option.url } : {},
              active: option.active,
            })),
          });
          const addedOptionCount = updatedPoll.options.filter((option) => !poll.options.some((previous) => previous.id === option.id)).length;
          await replaceCachedPoll(event.id, updatedPoll, ctx);
          dirty = false;
          close();
          showToast(addedOptionCount > 0
            ? 'Umfrage gespeichert. Personen mit geänderter Antwort wurden informiert.'
            : 'Umfrage gespeichert.');
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
  const { close } = openModal('Umfrage wieder öffnen', `
    <form id="reopen-poll-form" class="stack">
      <p class="muted">Danach können alle bestätigten Eventteilnehmer ihre Antwort wieder ändern.</p>
      <div><label for="reopen-poll-due-date" class="field-label">Neue Antwortfrist</label>${dateTimeFieldHtml('reopen-poll-due', Date.now() + 7 * 86_400_000, { dateOnly: true, clearable: true, label: 'Neue Antwortfrist' })}</div>
      <div class="row event-poll-save-row"><button type="submit" class="btn btn-primary btn-sm">Wieder öffnen</button></div>
    </form>`, {
    confirmClose: () => (dirty ? 'Die gewählte Frist geht verloren.' : null),
    onMount: (modal) => {
      wireDateTimeField(modal, 'reopen-poll-due');
      modal.querySelector('#reopen-poll-form').addEventListener('change', () => { dirty = true; });
      modal.querySelector('#reopen-poll-form').addEventListener('submit', async (eventSubmit) => {
        eventSubmit.preventDefault();
        const responseDueOn = readIsoDate(modal, 'reopen-poll-due');
        eventSubmit.submitter.disabled = true;
        try {
          const updatedPoll = await api.eventPolls.reopen(event.id, poll.id, responseDueOn);
          await replaceCachedPoll(event.id, updatedPoll, ctx);
          dirty = false;
          close();
          showToast('Umfrage wieder geöffnet.');
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
  wireActionMenus(container);
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
    const draft = responseDraftFor(poll);
    const optionId = button.dataset.optionId;
    // Choosing the current answer again clears it back to "offen".
    draft[optionId] = draft[optionId] === button.dataset.pollResponse
      ? defaultResponseValue(poll)
      : button.dataset.pollResponse;
    dirtyResponseDrafts.add(poll.id);
    ctx.rerender();
  }));
  container.querySelectorAll('[data-poll-choice]').forEach((button) => button.addEventListener('click', () => {
    const poll = findPoll(polls, button.dataset.pollChoice);
    if (!poll) return;
    const draft = responseDraftFor(poll);
    const optionId = button.dataset.optionId;
    if (poll.responseMode === 'single_choice') {
      poll.options.filter((option) => option.active).forEach((option) => { draft[option.id] = option.id === optionId ? 'can' : 'cannot'; });
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
    if (!poll || !responseDraftIsValid(poll)) return showToast('Bitte die Umfrage vollständig beantworten.', { error: true });
    const viewportAnchor = pollViewportAnchor(container, button.closest('[data-poll-group]')?.dataset.pollGroup);
    button.disabled = true;
    const draft = responseDraftFor(poll);
    try {
      const responses = poll.options.filter((option) => option.active).flatMap((option) =>
        poll.responseMode === 'feasibility' && draft[option.id] === 'open'
          ? []
          : [{ optionId: option.id, response: draft[option.id] }]
      );
      const updatedPoll = await api.eventPolls.submitMyResponses(event.id, poll.id, responses);
      await replaceCachedPoll(event.id, updatedPoll, ctx, { resetResponses: true });
      if (viewportAnchor) {
        schedulePollViewportAnchorRestore(container, [viewportAnchor], pollScrollContainer(container).scrollTop);
      }
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
    const confirmed = await confirmDialog('Danach können keine Antworten mehr abgegeben werden. Das Ergebnis bleibt in dieser Runde sichtbar und die Umfrage kann später wieder geöffnet werden.', { title: 'Umfrage beenden?', confirmText: 'Beenden' });
    if (!confirmed) return;
    button.disabled = true;
    try {
      const updatedPoll = await api.eventPolls.close(event.id, button.dataset.closePoll);
      await replaceCachedPoll(event.id, updatedPoll, ctx);
      showToast('Umfrage beendet.');
    } catch (error) {
      button.disabled = false;
      showToast(error.message, { error: true });
    }
  }));
  container.querySelectorAll('[data-remind-poll]').forEach((button) => button.addEventListener('click', async () => {
    button.disabled = true;
    try {
      const result = await api.eventPolls.sendReminders(event.id, button.dataset.remindPoll);
      showToast(result.remindedPlayerIds.length ? `${result.remindedPlayerIds.length} Person(en) mit offener Antwort erinnert.` : 'Aktuell musste niemand erinnert werden.');
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
    if (poll) openVoteDetails(poll, { showRound: polls.some((entry) => entry.decisionKey === poll.decisionKey && entry.id !== poll.id) });
  }));
  container.querySelectorAll('[data-delete-poll]').forEach((button) => button.addEventListener('click', async () => {
    const poll = findPoll(polls, button.dataset.deletePoll);
    if (!poll) return;
    const confirmed = await confirmDialog('Die Umfrage wird einschließlich aller Runden und abgegebenen Antworten dauerhaft gelöscht.', { title: 'Umfrage löschen?', confirmText: 'Löschen', danger: true });
    if (!confirmed) return;
    button.disabled = true;
    try {
      await api.eventPolls.remove(event.id, poll.id);
      await removeCachedPollSeries(event.id, poll.decisionKey, ctx);
      showToast('Umfrage gelöscht.');
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
  const viewport = pollScrollContainer(container).getBoundingClientRect();
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

function pollScrollContainer(container) {
  return container.closest('.view-container') ?? container;
}

function restorePollViewportAnchor(container, anchors, previousScrollTop) {
  const scrollContainer = pollScrollContainer(container);
  scrollContainer.scrollTop = previousScrollTop;
  const viewportTop = scrollContainer.getBoundingClientRect().top;
  const cards = [...container.querySelectorAll('[data-poll-group]')];
  for (const anchor of anchors) {
    const element = cards.find((card) => card.dataset.pollGroup === anchor.id);
    if (!element || element.getClientRects().length === 0) continue;
    scrollContainer.scrollTop += element.getBoundingClientRect().top - viewportTop - anchor.offset;
    return;
  }
}

function pollViewportAnchor(container, decisionKey) {
  if (!decisionKey) return null;
  const viewportTop = pollScrollContainer(container).getBoundingClientRect().top;
  const element = [...container.querySelectorAll('[data-poll-group]')]
    .find((card) => card.dataset.pollGroup === decisionKey);
  if (!element) return null;
  return { id: decisionKey, offset: element.getBoundingClientRect().top - viewportTop };
}

function schedulePollViewportAnchorRestore(container, anchors, previousScrollTop) {
  restorePollViewportAnchor(container, anchors, previousScrollTop);
  if (pendingAnchorFrame) cancelAnimationFrame(pendingAnchorFrame);
  pendingAnchorFrame = requestAnimationFrame(() => {
    pendingAnchorFrame = requestAnimationFrame(() => {
      pendingAnchorFrame = undefined;
      if (container.isConnected) restorePollViewportAnchor(container, anchors, previousScrollTop);
    });
  });
}

export function renderEventPolls(container, ctx) {
  const event = state.activeEvent;
  if (!event) {
    container.innerHTML = emptyStateHtml('Umfragen werden geladen…');
    return;
  }
  loadPolls(event.id, ctx);
  const cached = pollCache.get(event.id);
  const polls = cached?.polls ?? [];
  const groups = groupPolls(polls);
  const waitsForMe = (group) => group.rounds[0].isInvitee && !myAnswerComplete(group.rounds[0]);
  const openGroups = groups.filter((group) => group.rounds[0]?.status === 'open');
  if (cached?.loaded && !waitingAtLoad.has(event.id)) {
    waitingAtLoad.set(event.id, new Set(openGroups.filter(waitsForMe).map((group) => group.key)));
  }
  const waitingKeys = waitingAtLoad.get(event.id) ?? new Set();
  const activeGroups = openGroups
    .sort((left, right) => Number(waitingKeys.has(right.key)) - Number(waitingKeys.has(left.key)));
  const endedGroups = groups.filter((group) => group.rounds[0]?.status !== 'open');
  if (cached?.loaded && !initializedEvents.has(event.id)) {
    initializedEvents.add(event.id);
    const waiting = activeGroups.filter((group) => waitingKeys.has(group.key));
    for (const group of waiting.length ? waiting : activeGroups.slice(0, 1)) expandedPolls.add(group.key);
  }
  let currentContent;
  if (cached?.loading && !groups.length) currentContent = emptyStateHtml('Umfragen werden geladen…');
  else if (cached?.error) currentContent = `<div class="card stack"><p class="muted">${escapeHtml(cached.error)}</p><button type="button" class="btn btn-sm" id="retry-event-polls">Erneut versuchen</button></div>`;
  else if (!activeGroups.length) currentContent = emptyStateHtml('Noch keine Umfrage.');
  else currentContent = `<div class="stack event-poll-list">${activeGroups.map(renderPollGroup).join('')}</div>`;
  const scrollTop = pollScrollContainer(container).scrollTop;
  const viewportAnchors = visiblePollViewportAnchors(container);
  container.innerHTML = `
    <div class="grouped-page-sections event-polls-page" data-event-polls-event="${escapeHtml(event.id)}">
      <section class="card stack grouped-page-section primary-collection-section event-poll-current-section" aria-labelledby="event-poll-current-title">
        <div class="grouped-page-section-title">
          <h2 id="event-poll-current-title">Aktuelle Umfragen</h2>
          <button type="button" class="btn btn-primary btn-sm" id="new-event-poll">Umfrage starten</button>
        </div>
        ${currentContent}
      </section>
      ${renderEndedPolls(endedGroups, event.id)}
    </div>`;
  schedulePollViewportAnchorRestore(container, viewportAnchors, scrollTop);
  wireInfoTooltips(container);
  container.querySelector('#new-event-poll')?.addEventListener('click', () => openPollForm(event, ctx));
  container.querySelector('#retry-event-polls')?.addEventListener('click', () => {
    pollCache.delete(event.id);
    ctx.rerender();
  });
  wirePollActions(container, event, polls, ctx);
}
