// Custom date+time picker: a drop-in replacement for `<input type="datetime-local">`
// that actually matches the app's dark theme. The native control's closed-state
// segments and (worse) its popup calendar are drawn by the browser/OS, not the
// page — they stay a generic light-grey "Windows" widget no matter what CSS or
// `color-scheme` is set, which clashes hard with the rest of the UI. This
// renders a themed trigger button + hour/minute selects (both already styled
// like every other control) and a calendar popover built from the same
// card/button classes as everywhere else.
//
// The hidden <input id="${id}"> keeps the exact `toDatetimeLocal()` string
// format the rest of the app already reads/writes, so call sites only need to
// swap the HTML-producing line for `dateTimeFieldHtml()` + call
// `wireDateTimeField()` after render — `container.querySelector('#id').value`
// keeps working unchanged.

import { toDatetimeLocal } from './format.js';
import { icon } from './icons.js';

const WEEKDAYS = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'];
const MONTH_NAMES = [
  'Januar', 'Februar', 'März', 'April', 'Mai', 'Juni',
  'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember',
];
const MINUTE_STEP = 5;

function pad(n) {
  return String(n).padStart(2, '0');
}

function dateKey(d) {
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

// Rounds a timestamp's minutes to the nearest MINUTE_STEP (Date's setters
// normalize overflow themselves, e.g. minutes=60 rolls into the next hour).
function snapToStep(ms) {
  const d = new Date(ms);
  const total = d.getHours() * 60 + d.getMinutes();
  const snapped = Math.round(total / MINUTE_STEP) * MINUTE_STEP;
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, snapped, 0, 0).getTime();
}

function formatDateLabel(ms) {
  if (!ms) return 'Datum wählen';
  return new Date(ms).toLocaleDateString('de-DE', { weekday: 'short', day: '2-digit', month: '2-digit', year: 'numeric' });
}

function parseMs(value) {
  if (!value) return null;
  const t = new Date(value).getTime();
  return Number.isFinite(t) ? t : null;
}

// Exported so call sites reading the field's hidden input back out (e.g. a
// form's own submit handler) share the exact same parsing as the field
// itself, instead of re-implementing "parse a datetime-local string" locally.
export const parseDatetimeLocalMs = parseMs;

// Only one popover open at a time across the whole page.
let active = null;

function closeActive() {
  if (!active) return;
  const { cleanup } = active;
  active = null;
  cleanup();
}

// opts.dateOnly omits the hour/minute row entirely (e.g. a due date, where a
// specific time of day would be a false affordance - nothing downstream
// reads or displays it). wireDateTimeField() detects this purely from the
// row's absence in the DOM, so it needs no matching opts parameter of its
// own; the stored value's time-of-day is pinned to midnight (see the
// data-dt-day/data-dt-today handlers below) rather than left at whatever
// moment the date happened to be picked.
export function dateTimeFieldHtml(id, rawValueMs, opts = {}) {
  const valueMs = rawValueMs ? (opts.dateOnly ? rawValueMs : snapToStep(rawValueMs)) : rawValueMs;
  const hasValue = Boolean(valueMs);
  const d = hasValue ? new Date(valueMs) : null;
  const timeGroupHtml = opts.dateOnly
    ? ''
    : (() => {
        const hourOptions = Array.from(
          { length: 24 },
          (_, h) => `<option value="${h}"${d && d.getHours() === h ? ' selected' : ''}>${pad(h)}</option>`
        ).join('');
        const minuteOptions = Array.from(
          { length: 60 / MINUTE_STEP },
          (_, i) => i * MINUTE_STEP
        )
          .map((m) => `<option value="${m}"${d && d.getMinutes() === m ? ' selected' : ''}>${pad(m)}</option>`)
          .join('');
        return `
      <div class="dt-time-group">
        <select class="dt-time-select" data-dt-hour ${hasValue ? '' : 'disabled'} ${opts.disabled ? 'disabled' : ''}>${hourOptions}</select>
        <span class="dt-time-sep">:</span>
        <select class="dt-time-select" data-dt-minute ${hasValue ? '' : 'disabled'} ${opts.disabled ? 'disabled' : ''}>${minuteOptions}</select>
      </div>`;
      })();
  return `
    <div class="dt-field" data-dt-field="${id}">
      <input type="hidden" id="${id}" value="${hasValue ? toDatetimeLocal(valueMs) : ''}" />
      <button type="button" class="dt-date-btn" data-dt-trigger ${opts.disabled ? 'disabled' : ''}>
        <span class="dt-date-btn-label">${formatDateLabel(valueMs)}</span>
      </button>
      ${timeGroupHtml}
      ${opts.clearable ? `<button type="button" class="dt-clear-btn icon-btn" data-dt-clear title="Datum löschen" aria-label="Datum löschen" ${hasValue ? '' : 'hidden'} ${opts.disabled ? 'disabled' : ''}>${icon('x')}</button>` : ''}
    </div>`;
}

function buildGridRows(viewYear, viewMonth, selectedMs) {
  const firstOfMonth = new Date(viewYear, viewMonth, 1);
  const startOffset = (firstOfMonth.getDay() + 6) % 7; // Monday-first week
  const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();
  const todayKey = dateKey(new Date());
  const selectedKey = selectedMs ? dateKey(new Date(selectedMs)) : null;

  const cells = Array(startOffset).fill(null);
  for (let day = 1; day <= daysInMonth; day++) cells.push(day);
  while (cells.length % 7 !== 0) cells.push(null);

  const rows = [];
  for (let i = 0; i < cells.length; i += 7) rows.push(cells.slice(i, i + 7));

  return rows
    .map(
      (row) =>
        `<tr>${row
          .map((day) => {
            if (day === null) return `<td></td>`;
            const key = dateKey(new Date(viewYear, viewMonth, day));
            const cls = ['dt-day'];
            if (key === todayKey) cls.push('dt-day-today');
            if (key === selectedKey) cls.push('dt-day-selected');
            return `<td><button type="button" class="${cls.join(' ')}" data-dt-day="${day}">${day}</button></td>`;
          })
          .join('')}</tr>`
    )
    .join('');
}

function popoverHtml(viewYear, viewMonth, selectedMs) {
  return `
    <div class="dt-popover card">
      <div class="dt-popover-header">
        <button type="button" class="btn btn-sm" data-dt-nav="-1" aria-label="Vorheriger Monat">‹</button>
        <strong>${MONTH_NAMES[viewMonth]} ${viewYear}</strong>
        <button type="button" class="btn btn-sm" data-dt-nav="1" aria-label="Nächster Monat">›</button>
      </div>
      <table class="dt-calendar">
        <thead><tr>${WEEKDAYS.map((w) => `<th>${w}</th>`).join('')}</tr></thead>
        <tbody>${buildGridRows(viewYear, viewMonth, selectedMs)}</tbody>
      </table>
      <button type="button" class="btn btn-sm btn-block" data-dt-today>Heute</button>
    </div>`;
}

function positionPopover(el, trigger) {
  const rect = trigger.getBoundingClientRect();
  const popRect = el.getBoundingClientRect();
  const margin = 8;
  let top = rect.bottom + margin;
  if (top + popRect.height > window.innerHeight - margin) {
    top = Math.max(margin, rect.top - popRect.height - margin);
  }
  let left = rect.left;
  if (left + popRect.width > window.innerWidth - margin) {
    left = window.innerWidth - popRect.width - margin;
  }
  left = Math.max(margin, left);
  el.style.top = `${top}px`;
  el.style.left = `${left}px`;
}

export function wireDateTimeField(container, id) {
  // A previous render may have torn down its field (e.g. a socket-triggered
  // rerender elsewhere on the page) while its popover was open — that leaves
  // an orphaned node appended to <body>. Clean it up before wiring the fresh
  // one; this runs synchronously right after the destructive rerender, so it
  // never has a chance to show up on screen.
  if (active && !document.contains(active.field)) {
    active.cleanup();
    active = null;
  }

  const field = container.querySelector(`[data-dt-field="${id}"]`);
  if (!field) return;
  const hidden = field.querySelector(`#${id}`);
  const trigger = field.querySelector('[data-dt-trigger]');
  const hourSel = field.querySelector('[data-dt-hour]');
  const minuteSel = field.querySelector('[data-dt-minute]');
  const clearBtn = field.querySelector('[data-dt-clear]');
  if (!hidden || !trigger) return;
  const dateOnly = !hourSel && !minuteSel;

  function currentMs() {
    return parseMs(hidden.value);
  }

  function applyMs(ms) {
    hidden.value = ms ? toDatetimeLocal(ms) : '';
    trigger.querySelector('.dt-date-btn-label').textContent = formatDateLabel(ms);
    if (hourSel) hourSel.disabled = !ms;
    if (minuteSel) minuteSel.disabled = !ms;
    if (ms) {
      const d = new Date(ms);
      if (hourSel) hourSel.value = String(d.getHours());
      if (minuteSel) minuteSel.value = String(d.getMinutes());
    }
    if (clearBtn) clearBtn.hidden = !ms;
  }

  function openCalendar() {
    if (active && active.field === field) {
      closeActive();
      return;
    }
    closeActive();

    const base = currentMs() ? new Date(currentMs()) : new Date();
    let viewYear = base.getFullYear();
    let viewMonth = base.getMonth();

    const wrapper = document.createElement('div');
    wrapper.innerHTML = popoverHtml(viewYear, viewMonth, currentMs());
    const popoverEl = wrapper.firstElementChild;
    popoverEl.style.position = 'fixed';
    document.body.appendChild(popoverEl);
    positionPopover(popoverEl, trigger);

    function rerenderGrid() {
      popoverEl.querySelector('.dt-popover-header strong').textContent = `${MONTH_NAMES[viewMonth]} ${viewYear}`;
      popoverEl.querySelector('.dt-calendar tbody').innerHTML = buildGridRows(viewYear, viewMonth, currentMs());
      positionPopover(popoverEl, trigger);
    }

    function onPopoverClick(e) {
      const nav = e.target.closest('[data-dt-nav]');
      if (nav) {
        viewMonth += Number(nav.dataset.dtNav);
        if (viewMonth < 0) {
          viewMonth = 11;
          viewYear -= 1;
        } else if (viewMonth > 11) {
          viewMonth = 0;
          viewYear += 1;
        }
        rerenderGrid();
        return;
      }
      const day = e.target.closest('[data-dt-day]');
      if (day) {
        const prevMs = currentMs();
        const prevDate = new Date(prevMs ?? snapToStep(Date.now()));
        const [h, m] = dateOnly ? [0, 0] : [prevDate.getHours(), prevDate.getMinutes()];
        applyMs(new Date(viewYear, viewMonth, Number(day.dataset.dtDay), h, m).getTime());
        closeActive();
        return;
      }
      if (e.target.closest('[data-dt-today]')) {
        const now = new Date();
        const prevMs = currentMs();
        const prevDate = new Date(prevMs ?? snapToStep(now.getTime()));
        const [h, m] = dateOnly ? [0, 0] : [prevDate.getHours(), prevDate.getMinutes()];
        applyMs(new Date(now.getFullYear(), now.getMonth(), now.getDate(), h, m).getTime());
        closeActive();
      }
    }

    function onOutside(e) {
      if (popoverEl.contains(e.target) || trigger.contains(e.target)) return;
      closeActive();
    }
    function onKey(e) {
      if (e.key === 'Escape') closeActive();
    }
    function onReposition() {
      positionPopover(popoverEl, trigger);
    }

    popoverEl.addEventListener('click', onPopoverClick);
    document.addEventListener('mousedown', onOutside, true);
    document.addEventListener('keydown', onKey);
    window.addEventListener('resize', onReposition);
    window.addEventListener('scroll', onReposition, true);

    active = {
      field,
      cleanup() {
        document.removeEventListener('mousedown', onOutside, true);
        document.removeEventListener('keydown', onKey);
        window.removeEventListener('resize', onReposition);
        window.removeEventListener('scroll', onReposition, true);
        popoverEl.remove();
      },
    };
  }

  trigger.addEventListener('click', (e) => {
    e.stopPropagation();
    if (!trigger.disabled) openCalendar();
  });

  hourSel?.addEventListener('change', () => {
    const ms = currentMs();
    if (ms === null) return;
    const d = new Date(ms);
    d.setHours(Number(hourSel.value));
    hidden.value = toDatetimeLocal(d.getTime());
  });

  minuteSel?.addEventListener('change', () => {
    const ms = currentMs();
    if (ms === null) return;
    const d = new Date(ms);
    d.setMinutes(Number(minuteSel.value));
    hidden.value = toDatetimeLocal(d.getTime());
  });

  clearBtn?.addEventListener('click', () => applyMs(null));
}
