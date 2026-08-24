// Shared, themeable date/time input. Call sites keep reading the hidden
// datetime-local value by id, while people edit one date and (when needed)
// one time field. The calendar and manual DD.MM.YYYY / HH:MM entry stay in
// sync and real ranges can link two instances with wireDateTimeRange().

import { toDatetimeLocal, escapeHtml } from './format.js';
import { icon } from './icons.js';

const WEEKDAYS = [
  ['Mo', 'Montag'], ['Di', 'Dienstag'], ['Mi', 'Mittwoch'], ['Do', 'Donnerstag'],
  ['Fr', 'Freitag'], ['Sa', 'Samstag'], ['So', 'Sonntag'],
];
const MONTH_NAMES = [
  'Januar', 'Februar', 'März', 'April', 'Mai', 'Juni',
  'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember',
];
const MINUTE_STEP = 5;

function pad(value) {
  return String(value).padStart(2, '0');
}

function parseMs(value) {
  if (!value) return null;
  const timestamp = new Date(value).getTime();
  return Number.isFinite(timestamp) ? timestamp : null;
}

export const parseDatetimeLocalMs = parseMs;

function snapToStep(ms) {
  const date = new Date(ms);
  const minutes = date.getHours() * 60 + date.getMinutes();
  const snapped = Math.round(minutes / MINUTE_STEP) * MINUTE_STEP;
  return new Date(date.getFullYear(), date.getMonth(), date.getDate(), 0, snapped, 0, 0).getTime();
}

function formatDateInput(ms) {
  if (!ms) return '';
  const date = new Date(ms);
  return `${pad(date.getDate())}.${pad(date.getMonth() + 1)}.${date.getFullYear()}`;
}

function formatTimeInput(ms) {
  if (!ms) return '';
  const date = new Date(ms);
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function parseDateInput(value) {
  const match = /^\s*(\d{1,2})\.(\d{1,2})\.(\d{4})\s*$/.exec(value);
  if (!match) return null;
  const day = Number(match[1]);
  const month = Number(match[2]) - 1;
  const year = Number(match[3]);
  const date = new Date(year, month, day);
  if (date.getFullYear() !== year || date.getMonth() !== month || date.getDate() !== day) return null;
  return { year, month, day };
}

export function parseTimeInput(value) {
  const match = /^\s*(\d{1,2}):(\d{2})\s*$/.exec(value);
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 23 || minute > 59) return null;
  return { hour, minute };
}

function isDeletion(inputType) {
  return typeof inputType === 'string' && inputType.startsWith('delete');
}

export function formatDateTyping(value, inputType = '') {
  if (isDeletion(inputType)) return value;
  if (!/^[\d.]*$/.test(value)) return value;
  const normalized = value.replace(/\.+/g, '.');
  const firstSeparator = normalized.indexOf('.');
  const secondSeparator = firstSeparator === -1 ? -1 : normalized.indexOf('.', firstSeparator + 1);
  // Keep explicitly typed short forms such as 8.7.2026 intact. The automatic
  // mask only owns separators at the canonical two-digit positions.
  if ((firstSeparator !== -1 && firstSeparator !== 2)
    || (secondSeparator !== -1 && secondSeparator !== 5)) return normalized;
  const digits = normalized.replace(/\D/g, '').slice(0, 8);
  if (digits.length < 2) return digits;
  if (digits.length < 4) return `${digits.slice(0, 2)}.${digits.slice(2)}`;
  return `${digits.slice(0, 2)}.${digits.slice(2, 4)}.${digits.slice(4)}`;
}

export function formatTimeTyping(value, inputType = '') {
  if (isDeletion(inputType)) return value;
  if (!/^[\d:]*$/.test(value)) return value;
  const separator = value.indexOf(':');
  // parseTimeInput also accepts 9:05, so do not rewrite a separator the user
  // intentionally entered after a single-digit hour.
  if (separator !== -1 && separator !== 2) return value;
  const digits = value.replace(/\D/g, '').slice(0, 4);
  if (digits.length < 2) return digits;
  return `${digits.slice(0, 2)}:${digits.slice(2)}`;
}

function dateKey(date) {
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
}

function dayMs(year, month, day) {
  return new Date(year, month, day, 0, 0, 0, 0).getTime();
}

export function calendarMonthTargetMs(focusedMs, delta, minimumMs = null, keepDay = true) {
  const current = new Date(focusedMs);
  const targetMonth = new Date(current.getFullYear(), current.getMonth() + delta, 1);
  const targetYear = targetMonth.getFullYear();
  const targetMonthIndex = targetMonth.getMonth();
  const lastTargetDay = new Date(targetYear, targetMonthIndex + 1, 0).getDate();
  const targetDay = keepDay ? Math.min(current.getDate(), lastTargetDay) : 1;
  let candidate = dayMs(targetYear, targetMonthIndex, targetDay);

  if (minimumMs !== null) {
    const lastMomentInTargetMonth = new Date(targetYear, targetMonthIndex + 1, 0, 23, 59, 59, 999).getTime();
    if (lastMomentInTargetMonth < minimumMs) return focusedMs;
    const minimum = new Date(minimumMs);
    if (targetYear === minimum.getFullYear() && targetMonthIndex === minimum.getMonth()) {
      candidate = Math.max(candidate, dayMs(targetYear, targetMonthIndex, minimum.getDate()));
    }
  }

  return candidate;
}

let active = null;

function closeActive({ restoreFocus = false } = {}) {
  if (!active) return;
  const previous = active;
  active = null;
  previous.cleanup();
  if (restoreFocus) previous.trigger.focus();
}

export function dateTimeFieldHtml(id, rawValueMs, opts = {}) {
  const valueMs = rawValueMs ? (opts.dateOnly ? rawValueMs : snapToStep(rawValueMs)) : null;
  const hasValue = valueMs !== null;
  const label = escapeHtml(opts.label || 'Datum');
  const disabled = opts.disabled ? ' disabled' : '';
  const required = opts.clearable ? '' : ' required';
  const errorId = `${id}-error`;
  const clearLabel = opts.label ? `${opts.label} löschen` : 'Datum löschen';

  return `
    <div class="dt-field" data-dt-field="${id}" data-dt-date-only="${opts.dateOnly ? 'true' : 'false'}" data-dt-clearable="${opts.clearable ? 'true' : 'false'}">
      <input type="hidden" id="${id}" value="${hasValue ? toDatetimeLocal(valueMs) : ''}" />
      <div class="dt-inputs">
        <div class="dt-date-control">
          <input class="dt-date-input" type="text" id="${id}-date" data-dt-date inputmode="numeric" autocomplete="off" placeholder="TT.MM.JJJJ" value="${formatDateInput(valueMs)}" aria-label="${label}, Datum" aria-describedby="${errorId}"${required}${disabled} />
          <button type="button" class="dt-calendar-btn icon-btn" data-dt-trigger aria-label="Kalender für ${label} öffnen" aria-haspopup="dialog" aria-expanded="false"${disabled}>${icon('calendar')}</button>
        </div>
        ${opts.dateOnly ? '' : `<input class="dt-time-input" type="text" id="${id}-time" data-dt-time inputmode="numeric" autocomplete="off" placeholder="HH:MM" value="${formatTimeInput(valueMs)}" aria-label="${label}, Uhrzeit" aria-describedby="${errorId}"${required}${disabled} />`}
        ${opts.clearable ? `<button type="button" class="dt-clear-btn icon-btn" data-dt-clear title="${escapeHtml(clearLabel)}" aria-label="${escapeHtml(clearLabel)}"${hasValue ? '' : ' hidden'}${disabled}>${icon('x')}</button>` : ''}
      </div>
      <p class="dt-error" id="${errorId}" data-dt-error aria-live="polite" hidden></p>
    </div>`;
}

export function captureDateTimeFieldDraft(container, id) {
  const field = container.querySelector(`[data-dt-field="${id}"]`);
  if (!field) return null;
  return {
    date: field.querySelector('[data-dt-date]')?.value ?? '',
    time: field.querySelector('[data-dt-time]')?.value ?? null,
  };
}

export function restoreDateTimeFieldDraft(container, id, draft) {
  if (!draft) return;
  const field = container.querySelector(`[data-dt-field="${id}"]`);
  const dateInput = field?.querySelector('[data-dt-date]');
  const timeInput = field?.querySelector('[data-dt-time]');
  if (dateInput) dateInput.value = draft.date;
  if (timeInput && draft.time !== null) timeInput.value = draft.time;
}

function buildGridRows(viewYear, viewMonth, selectedMs, focusedMs, minMs, rangeStartMs, rangeEndMs) {
  const startOffset = (new Date(viewYear, viewMonth, 1).getDay() + 6) % 7;
  const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();
  const todayKey = dateKey(new Date());
  const selectedKey = selectedMs ? dateKey(new Date(selectedMs)) : null;
  const focusedKey = dateKey(new Date(focusedMs));
  const toDayStart = (ms) => {
    const date = new Date(ms);
    return dayMs(date.getFullYear(), date.getMonth(), date.getDate());
  };
  const rangeStartDay = rangeStartMs ? toDayStart(rangeStartMs) : null;
  const rangeEndDay = rangeEndMs ? toDayStart(rangeEndMs) : null;
  const cells = Array(startOffset).fill(null);
  for (let day = 1; day <= daysInMonth; day += 1) cells.push(day);
  while (cells.length % 7 !== 0) cells.push(null);
  const rows = [];
  for (let index = 0; index < cells.length; index += 7) rows.push(cells.slice(index, index + 7));

  return rows.map((row) => `<tr role="row">${row.map((day) => {
    if (day === null) return '<td role="gridcell"></td>';
    const currentDayMs = dayMs(viewYear, viewMonth, day);
    const key = dateKey(new Date(currentDayMs));
    const classes = ['dt-day'];
    const disabled = minMs !== null && new Date(viewYear, viewMonth, day, 23, 59, 59, 999).getTime() < minMs;
    if (key === todayKey) classes.push('dt-day-today');
    if (rangeStartDay !== null && rangeEndDay !== null && currentDayMs >= rangeStartDay && currentDayMs <= rangeEndDay) classes.push('dt-day-in-range');
    if (key === selectedKey) classes.push('dt-day-selected');
    return `<td role="gridcell"><button type="button" class="${classes.join(' ')}" data-dt-day="${day}" tabindex="${key === focusedKey && !disabled ? '0' : '-1'}"${disabled ? ' disabled' : ''} aria-label="${day}. ${MONTH_NAMES[viewMonth]} ${viewYear}"${key === selectedKey ? ' aria-selected="true"' : ''}>${day}</button></td>`;
  }).join('')}</tr>`).join('');
}

function popoverHtml(viewYear, viewMonth, selectedMs, focusedMs, minMs, rangeStartMs, rangeEndMs, label) {
  return `
    <div class="dt-popover card" role="dialog" aria-label="Kalender für ${escapeHtml(label)}">
      <div class="dt-popover-header">
        <button type="button" class="btn btn-sm icon-btn" data-dt-nav="-1" aria-label="Vorheriger Monat">${icon('chevronLeft')}</button>
        <strong data-dt-month aria-live="polite">${MONTH_NAMES[viewMonth]} ${viewYear}</strong>
        <button type="button" class="btn btn-sm icon-btn" data-dt-nav="1" aria-label="Nächster Monat">${icon('chevronRight')}</button>
      </div>
      <table class="dt-calendar" role="grid">
        <thead><tr role="row">${WEEKDAYS.map(([short, full]) => `<th role="columnheader"><abbr title="${full}">${short}</abbr></th>`).join('')}</tr></thead>
        <tbody>${buildGridRows(viewYear, viewMonth, selectedMs, focusedMs, minMs, rangeStartMs, rangeEndMs)}</tbody>
      </table>
      <button type="button" class="btn btn-sm btn-block" data-dt-today>Heute</button>
    </div>`;
}

function positionPopover(popover, trigger) {
  if (window.matchMedia('(max-width: 640px)').matches) {
    popover.style.removeProperty('top');
    popover.style.removeProperty('left');
    return;
  }
  const triggerRect = trigger.getBoundingClientRect();
  const popoverRect = popover.getBoundingClientRect();
  const margin = 8;
  let top = triggerRect.bottom + margin;
  if (top + popoverRect.height > window.innerHeight - margin) top = Math.max(margin, triggerRect.top - popoverRect.height - margin);
  const left = Math.max(margin, Math.min(triggerRect.left, window.innerWidth - popoverRect.width - margin));
  popover.style.top = `${top}px`;
  popover.style.left = `${left}px`;
}

export function wireDateTimeField(container, id) {
  if (active && !document.contains(active.field)) closeActive();
  const field = container.querySelector(`[data-dt-field="${id}"]`);
  if (!field) return null;
  const hidden = field.querySelector(`#${id}`);
  const dateInput = field.querySelector('[data-dt-date]');
  const timeInput = field.querySelector('[data-dt-time]');
  const trigger = field.querySelector('[data-dt-trigger]');
  const clearButton = field.querySelector('[data-dt-clear]');
  const error = field.querySelector('[data-dt-error]');
  if (!hidden || !dateInput || !trigger || !error) return null;
  const dateOnly = field.dataset.dtDateOnly === 'true';
  const clearable = field.dataset.dtClearable === 'true';
  const label = dateInput.getAttribute('aria-label')?.replace(/, Datum$/, '') || 'Datum';
  let minimumMs = null;
  let rangeStartMs = null;
  let rangeEndMs = null;

  function currentMs() {
    return parseMs(hidden.value);
  }

  function setError(message = '') {
    error.textContent = message;
    error.hidden = !message;
    dateInput.setCustomValidity(message);
    timeInput?.setCustomValidity(message);
    dateInput.setAttribute('aria-invalid', message ? 'true' : 'false');
    timeInput?.setAttribute('aria-invalid', message ? 'true' : 'false');
  }

  function applyMs(ms, { dispatch = true } = {}) {
    const normalized = ms === null ? null : (dateOnly ? ms : snapToStep(ms));
    hidden.value = normalized === null ? '' : toDatetimeLocal(normalized);
    dateInput.value = formatDateInput(normalized);
    if (timeInput) timeInput.value = formatTimeInput(normalized);
    if (clearButton) clearButton.hidden = normalized === null;
    setError();
    if (dispatch) hidden.dispatchEvent(new Event('input', { bubbles: true }));
  }

  function commitManualInput() {
    const parsedDate = parseDateInput(dateInput.value);
    const parsedTime = dateOnly ? { hour: 0, minute: 0 } : parseTimeInput(timeInput.value);
    if (!dateInput.value.trim() && clearable) {
      applyMs(null);
      return true;
    }
    if (!parsedDate) {
      setError('Bitte ein gültiges Datum im Format TT.MM.JJJJ eingeben.');
      return false;
    }
    if (!parsedTime) {
      setError('Bitte eine gültige Uhrzeit im Format HH:MM eingeben.');
      return false;
    }
    applyMs(new Date(parsedDate.year, parsedDate.month, parsedDate.day, parsedTime.hour, parsedTime.minute, 0, 0).getTime());
    return true;
  }

  function openCalendar() {
    if (active?.field === field) {
      closeActive({ restoreFocus: true });
      return;
    }
    closeActive();
    const baseMs = Math.max(currentMs() ?? Date.now(), minimumMs ?? 0);
    let focusedMs = baseMs;
    let focusedDate = new Date(focusedMs);
    let viewYear = focusedDate.getFullYear();
    let viewMonth = focusedDate.getMonth();
    const wrapper = document.createElement('div');
    wrapper.innerHTML = popoverHtml(viewYear, viewMonth, currentMs(), focusedMs, minimumMs, rangeStartMs, rangeEndMs, label);
    const popover = wrapper.firstElementChild;
    popover.style.position = 'fixed';
    // Keep a modal's calendar inside its backdrop so modal.js includes all
    // calendar controls in the focus trap. Outside modals, body remains the
    // least surprising fixed-position host.
    (field.closest('.modal-backdrop') || document.body).appendChild(popover);
    trigger.setAttribute('aria-expanded', 'true');
    positionPopover(popover, trigger);

    function rerender({ focus = false } = {}) {
      popover.querySelector('[data-dt-month]').textContent = `${MONTH_NAMES[viewMonth]} ${viewYear}`;
      popover.querySelector('.dt-calendar tbody').innerHTML = buildGridRows(viewYear, viewMonth, currentMs(), focusedMs, minimumMs, rangeStartMs, rangeEndMs);
      positionPopover(popover, trigger);
      if (focus) popover.querySelector('[data-dt-day][tabindex="0"]')?.focus();
    }

    function selectDay(year, month, day) {
      const previous = new Date(currentMs() ?? snapToStep(Date.now()));
      const hour = dateOnly ? 0 : previous.getHours();
      const minute = dateOnly ? 0 : previous.getMinutes();
      applyMs(new Date(year, month, day, hour, minute, 0, 0).getTime());
      closeActive({ restoreFocus: true });
    }

    function moveFocus(days) {
      focusedDate = new Date(focusedMs);
      focusedDate.setDate(focusedDate.getDate() + days);
      const candidate = dayMs(focusedDate.getFullYear(), focusedDate.getMonth(), focusedDate.getDate());
      if (minimumMs !== null && new Date(focusedDate.getFullYear(), focusedDate.getMonth(), focusedDate.getDate(), 23, 59, 59, 999).getTime() < minimumMs) return;
      focusedMs = candidate;
      viewYear = focusedDate.getFullYear();
      viewMonth = focusedDate.getMonth();
      rerender({ focus: true });
    }

    function changeMonth(delta, keepDay = true) {
      focusedMs = calendarMonthTargetMs(focusedMs, delta, minimumMs, keepDay);
      const target = new Date(focusedMs);
      viewYear = target.getFullYear();
      viewMonth = target.getMonth();
      rerender({ focus: true });
    }

    function onClick(event) {
      const navigation = event.target.closest('[data-dt-nav]');
      if (navigation) return changeMonth(Number(navigation.dataset.dtNav), false);
      const day = event.target.closest('[data-dt-day]');
      if (day && !day.disabled) return selectDay(viewYear, viewMonth, Number(day.dataset.dtDay));
      if (event.target.closest('[data-dt-today]')) {
        const today = new Date();
        const todayEnd = new Date(today.getFullYear(), today.getMonth(), today.getDate(), 23, 59, 59, 999).getTime();
        if (minimumMs === null || todayEnd >= minimumMs) selectDay(today.getFullYear(), today.getMonth(), today.getDate());
      }
    }

    function onKeydown(event) {
      const day = event.target.closest('[data-dt-day]');
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        closeActive({ restoreFocus: true });
      } else if (day && event.key === 'Enter') {
        event.preventDefault();
        selectDay(viewYear, viewMonth, Number(day.dataset.dtDay));
      } else if (day && ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End', 'PageUp', 'PageDown'].includes(event.key)) {
        event.preventDefault();
        if (event.key === 'ArrowLeft') moveFocus(-1);
        if (event.key === 'ArrowRight') moveFocus(1);
        if (event.key === 'ArrowUp') moveFocus(-7);
        if (event.key === 'ArrowDown') moveFocus(7);
        if (event.key === 'Home') moveFocus(-((new Date(focusedMs).getDay() + 6) % 7));
        if (event.key === 'End') moveFocus(6 - ((new Date(focusedMs).getDay() + 6) % 7));
        if (event.key === 'PageUp') changeMonth(event.shiftKey ? -12 : -1);
        if (event.key === 'PageDown') changeMonth(event.shiftKey ? 12 : 1);
      }
    }

    function onOutside(event) {
      if (!popover.contains(event.target) && !trigger.contains(event.target)) closeActive();
    }
    function onReposition() {
      positionPopover(popover, trigger);
    }

    popover.addEventListener('click', onClick);
    popover.addEventListener('keydown', onKeydown);
    document.addEventListener('mousedown', onOutside, true);
    window.addEventListener('resize', onReposition);
    window.addEventListener('scroll', onReposition, true);
    active = {
      field,
      trigger,
      cleanup() {
        trigger.setAttribute('aria-expanded', 'false');
        document.removeEventListener('mousedown', onOutside, true);
        window.removeEventListener('resize', onReposition);
        window.removeEventListener('scroll', onReposition, true);
        popover.remove();
      },
    };
    popover.querySelector('[data-dt-day][tabindex="0"]')?.focus();
  }

  dateInput.addEventListener('input', (event) => {
    dateInput.value = formatDateTyping(dateInput.value, event.inputType);
  });
  timeInput?.addEventListener('input', (event) => {
    timeInput.value = formatTimeTyping(timeInput.value, event.inputType);
  });
  dateInput.addEventListener('blur', commitManualInput);
  dateInput.addEventListener('change', commitManualInput);
  timeInput?.addEventListener('blur', commitManualInput);
  timeInput?.addEventListener('change', commitManualInput);
  trigger.addEventListener('click', (event) => {
    event.stopPropagation();
    if (!trigger.disabled) openCalendar();
  });
  clearButton?.addEventListener('click', () => applyMs(null));

  const controller = {
    hidden,
    currentMs,
    applyMs,
    setError,
    setMinimum(ms) { minimumMs = ms; },
    setRange(startMs, endMs) { rangeStartMs = startMs; rangeEndMs = endMs; },
  };
  field.dateTimeController = controller;
  return controller;
}

export function wireDateTimeRange(container, startId, endId, opts = {}) {
  const start = container.querySelector(`[data-dt-field="${startId}"]`)?.dateTimeController;
  const end = container.querySelector(`[data-dt-field="${endId}"]`)?.dateTimeController;
  if (!start || !end) return null;
  const minimumGapMs = opts.minimumGapMs ?? 0;
  const message = opts.message || (minimumGapMs > 0
    ? 'Das Ende muss nach dem Beginn liegen.'
    : 'Das Ende darf nicht vor dem Beginn liegen.');
  let previousStart = start.currentMs();
  let previousEnd = end.currentMs();
  let adjusting = false;

  function refreshRange() {
    const startMs = start.currentMs();
    const endMs = end.currentMs();
    end.setMinimum(startMs === null ? null : startMs + minimumGapMs);
    start.setRange(startMs, endMs);
    end.setRange(startMs, endMs);
    const invalid = startMs !== null && endMs !== null && endMs < startMs + minimumGapMs;
    end.setError(invalid ? message : '');
    return !invalid;
  }

  function onStartInput() {
    if (adjusting) return;
    const nextStart = start.currentMs();
    const currentEnd = end.currentMs();
    if (nextStart !== null && currentEnd !== null && currentEnd < nextStart + minimumGapMs) {
      const hadValidDuration = previousStart !== null && previousEnd !== null && previousEnd >= previousStart + minimumGapMs;
      const duration = hadValidDuration ? previousEnd - previousStart : minimumGapMs;
      adjusting = true;
      end.applyMs(nextStart + Math.max(duration, minimumGapMs));
      adjusting = false;
    }
    previousStart = nextStart;
    previousEnd = end.currentMs();
    refreshRange();
  }

  function onEndInput() {
    if (adjusting) return;
    previousEnd = end.currentMs();
    refreshRange();
  }

  start.hidden.addEventListener('input', onStartInput);
  end.hidden.addEventListener('input', onEndInput);
  refreshRange();
  return { refresh: refreshRange };
}
