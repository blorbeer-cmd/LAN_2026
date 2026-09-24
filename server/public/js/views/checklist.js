// "Checkliste" view: a private per-event packing checklist (Grundstock plus
// freely added/removable custom items) and a shared To-Do pool
// (docs/KONZEPT-PACKLISTE-TICKETS.md). Any active member can create a To-Do
// of either kind (Aufgabe/Mitbring-Anfrage), leave it open for anyone to
// claim, or address it straight at themselves or one/several others; "Mir
// zugewiesen" gives everyone a single place to see what's on their own
// plate, sorted by due date. Claiming is immediate and binding - no
// confirmation step, same as a captain-draft pick.

import { api } from '../api.js';
import { escapeHtml, formatDate, formatDateTime } from '../format.js';
import { openModal, confirmDialog } from '../modal.js';
import { showToast } from '../toast.js';
import { getMyId } from '../whoami.js';
import { emptyStateHtml } from '../emptyState.js';
import { icon } from '../icons.js';
import { dateTimeFieldHtml, wireDateTimeField, parseDatetimeLocalMs } from '../dateTimeField.js';
import { dueDiffDays } from '../checklistDue.js';
import { wireSelectionSearch } from '../selectionSearch.js';
import { wireActionMenus } from '../actionMenu.js';

let tasksCache = null;
let itemsCache = null;
let itemsCacheForId = null;
let loadingTasks = false;
let loadingItems = false;
let tasksStale = false;
let tasksRequestVersion = 0;
// Set when a realtime echo of the signed-in identity's own items arrives
// while a good cache is already showing (see invalidateChecklist below) —
// a background refetch reconciles it without the destructive null-the-cache
// "Lädt…" flash a full invalidateItems() would cause on every checkbox tap.
let itemsStale = false;
let historyOpen = false;
// Packliste: the remove buttons only show while editing, so the everyday
// view is just the list to tick off.
let editingItems = false;
// Rows rendered last, by the id of their first task, for the detail dialog.
let taskEntriesById = new Map();
// One list for every active To-Do; the chips narrow it by who holds it:
// 'all' | 'mine' | 'open' | 'underway' | 'created'.
let statusFilter = 'all';
let kindFilter = 'all'; // 'all' | 'todo' | 'item_request'
let taskSort = 'due'; // 'due' | 'title' | 'who'
let taskQuery = '';
let taskSortMenuOpen = false;
let taskFilterMenuOpen = false;

async function loadTasks(ctx) {
  const version = ++tasksRequestVersion;
  loadingTasks = true;
  tasksStale = false;
  try {
    const res = await api.checklist.tasks();
    if (version === tasksRequestVersion) tasksCache = res.tasks;
  } catch (err) {
    if (version === tasksRequestVersion) {
      showToast(err.message, { error: true });
      if (tasksCache === null) tasksCache = [];
    }
  } finally {
    if (version === tasksRequestVersion) {
      loadingTasks = false;
      ctx.rerender();
    }
  }
}

// `silent: true` (the realtime-echo reconciliation path) keeps whatever is
// currently cached on screen instead of replacing it with a loading/error
// placeholder — the previous list stays correct-looking while this quietly
// retries in the background.
async function loadItems(ctx, playerId, { silent = false } = {}) {
  loadingItems = true;
  itemsStale = false;
  try {
    const res = await api.checklist.items(playerId);
    itemsCache = res.items;
    itemsCacheForId = playerId;
  } catch (err) {
    if (silent) {
      itemsStale = true; // retry on the next trigger instead of giving up quietly
    } else {
      showToast(err.message, { error: true });
      itemsCache = [];
      itemsCacheForId = playerId;
    }
  } finally {
    loadingItems = false;
    ctx.rerender();
  }
}

// Also clears itemsCacheForId (not just itemsCache) so the "already fetched
// for this identity" guard at the top of renderChecklist() actually
// retriggers a refetch, instead of leaving the list stuck on "Lädt…".
function invalidateItems() {
  itemsCache = null;
  itemsCacheForId = null;
  itemsStale = false;
}

// Called from app.js on every checklist:changed socket event, and without a
// payload from the group switch and the reconnect refresh — those two mean
// "everything might be stale".
//
// The server already says which half changed (`scope: 'items' | 'tasks'`, plus
// whose items). Honouring that keeps a To-Do somebody else created from
// throwing away the personal Packliste, which would otherwise drop back to its
// loading state and take a half-typed entry with it.
export function invalidateChecklist(payload, { hard = false } = {}) {
  const scope = payload?.scope;
  if (scope !== 'items') {
    tasksRequestVersion += 1;
    loadingTasks = false;
    tasksStale = true;
    if (hard) tasksCache = null;
  }
  if (scope === 'tasks') return;
  if (scope === 'items' && payload.playerId && payload.playerId !== getMyId()) return;
  // This is the signed-in identity's own items: either this very client just
  // applied the change optimistically (add/remove/toggle below), or another
  // of its own devices did. Either way the currently rendered list is either
  // already correct or only briefly behind — reconcile it quietly instead of
  // nulling the cache and flashing "Lädt…" on every click.
  if (scope === 'items' && itemsCache !== null) {
    itemsStale = true;
    return;
  }
  invalidateItems();
}

function reconcileTasks(result) {
  if (tasksCache === null) return;
  const changed = Array.isArray(result?.tasks) ? result.tasks : result?.id ? [result] : [];
  for (const task of changed) {
    const index = tasksCache.findIndex((entry) => entry.id === task.id);
    if (index === -1) tasksCache.push(task);
    else tasksCache[index] = task;
  }
}

function removeTaskFromCache(taskId) {
  if (tasksCache) tasksCache = tasksCache.filter((task) => task.id !== taskId);
}

// How many To-Dos currently sit with the signed-in identity. The Orga area
// shows this on its compact To-Do tab and desktop rail entry, so the count
// stays visible across the app. Returns 0 while nothing is loaded yet — a
// badge must never guess a number.
export function openTaskCount() {
  return assignedTasks()?.length ?? 0;
}

// How many unclaimed To-Dos sit in the shared pool, independent of the
// signed-in identity. Home's "Meine To-Dos" tile treats these "free" To-Dos
// as reason enough to show up even when nothing is assigned to this identity
// yet. Returns 0 while nothing is loaded yet, same as openTaskCount().
export function freeTaskCount() {
  return tasksCache?.filter((task) => task.status === 'open').length ?? 0;
}

// Shared dashboard projection for the signed-in identity. `null` deliberately
// means "still loading", while an empty array is a loaded list without work.
// Keeping the due-date ordering here prevents Home and the full To-Do view
// from drifting apart.
export function assignedTasks() {
  const myId = getMyId();
  if (tasksCache === null) return null;
  if (!myId) return [];
  return tasksCache
    .filter((task) => task.status === 'taken' && isParticipant([task], myId))
    .sort((a, b) => {
      if (a.dueAt && b.dueAt) return a.dueAt - b.dueAt;
      if (a.dueAt) return -1;
      if (b.dueAt) return 1;
      return 0;
    });
}

// The count has to be right on every Orga tab and the desktop rail, not only
// on the route that renders the list. Loading re-renders once it resolves,
// and a filled cache makes this a no-op.
export function ensureTasksLoaded(ctx) {
  if ((tasksCache === null || tasksStale) && !loadingTasks) loadTasks(ctx);
}

// These caches are keyed by player id, not by group - switching the active
// group (see groupContext.js) must drop them too, or the previous group's
// tasks/items keep rendering (and stay clickable) until some unrelated
// checklist:changed socket event happens to arrive.
window.addEventListener('respawn:group-changed', () => invalidateChecklist(undefined, { hard: true }));

// Kept out of the loading branch below so a refresh never unmounts the field:
// the geometry stays stable and a half-typed entry has something to be restored
// into (see renderChecklist's snapshot).
const addItemFormHtml = () => `
    <form class="row" data-add-item-form style="gap:var(--space-2);">
      <input type="text" data-item-label placeholder="Mehrfachsteckdose" maxlength="80" required style="flex:1;" aria-label="Neuer Packlisten-Eintrag" />
      <button type="submit" class="btn">Hinzufügen</button>
    </form>`;

function renderItems(myId) {
  if (!myId) {
    return `<div class="muted" style="font-size:var(--font-size-sm);">Wähle oben, wer du bist, um deine Packliste zu sehen.</div>`;
  }
  if (itemsCache === null || itemsCacheForId !== myId) {
    return `${addItemFormHtml()}${emptyStateHtml('Lädt…')}`;
  }
  if (itemsCache.length === 0) editingItems = false;
  const rowHtml = (item) => `
      <div class="checklist-item-row ${item.checked ? 'is-checked' : ''}">
        <label class="checklist-item-label">
          <input type="checkbox" data-toggle-item="${item.id}" ${item.checked ? 'checked' : ''} />
          <span>${escapeHtml(item.label)}</span>
        </label>
        <button type="button" class="icon-btn checklist-item-remove" data-remove-item="${item.id}" aria-label="${escapeHtml(item.label)} entfernen">${icon('x')}</button>
      </div>`;
  return `
    ${addItemFormHtml()}
    ${
      itemsCache.length === 0
        ? emptyStateHtml('Noch keine Einträge.')
        : `<div class="checklist-item-list${editingItems ? ' is-editing' : ''}">${itemsCache.map(rowHtml).join('')}</div>`
    }`;
}

function packingProgressHtml() {
  if (!itemsCache?.length) return '';
  const done = itemsCache.filter((item) => item.checked).length;
  const pct = Math.round((done / itemsCache.length) * 100);
  return `
    <div class="checklist-progress" role="progressbar" aria-label="Eingepackt" aria-valuemin="0" aria-valuemax="${itemsCache.length}" aria-valuenow="${done}">
      <span class="checklist-progress-fill" style="width:${pct}%;"></span>
    </div>`;
}

function packingCountHtml() {
  if (!itemsCache?.length) return '';
  const done = itemsCache.filter((item) => item.checked).length;
  return `<span class="checklist-progress-count">${done}/${itemsCache.length}</span>`;
}

function packingEditButtonHtml() {
  if (!itemsCache?.length) return '';
  return `<button type="button" class="btn btn-sm" data-toggle-item-editing aria-pressed="${editingItems}">${editingItems ? 'Fertig' : 'Bearbeiten'}</button>`;
}

function taskTypeLabel(task) {
  return task.type === 'todo' ? 'Aufgabe' : 'Mitbring-Anfrage';
}

// Self-explaining due text (the table has no column headers); an empty cell
// means no due date.
function dueCellHtml(task) {
  if (!task.dueAt) return '';
  const diff = dueDiffDays(task.dueAt);
  if (diff < 0) return 'Überfällig';
  if (diff === 0) return 'Fällig heute';
  if (diff === 1) return 'Fällig morgen';
  if (diff <= 3) return `Fällig in ${diff} Tagen`;
  return `Fällig am ${escapeHtml(formatDate(task.dueAt))}`;
}

// Everyone signed up for these task rows (a legacy multi-assign batch is
// several rows), each with the comment they left when signing up.
function taskPeople(tasks) {
  return tasks.flatMap((t) =>
    t.assignees?.length ? t.assignees : t.assignee ? [{ ...t.assignee, comment: t.claimComment }] : [],
  );
}

function isParticipant(tasks, myId) {
  return !!myId && taskPeople(tasks).some((p) => p.id === myId);
}

function whoText(tasks) {
  return taskPeople(tasks)
    .map((p) => p.name)
    .join(', ');
}

// At most two names in the row, the rest as "+N"; the tooltip and the
// detail dialog list everyone.
const WHO_PREVIEW_COUNT = 2;
function whoCellHtml(tasks, who) {
  const names = taskPeople(tasks).map((p) => p.name);
  const rest = names.length - WHO_PREVIEW_COUNT;
  return `<span title="${escapeHtml(who)}">${escapeHtml(names.slice(0, WHO_PREVIEW_COUNT).join(', '))}</span>${
    rest > 0 ? `<span class="checklist-table-who-more">+${rest}</span>` : ''
  }`;
}

// Long titles are cut at a fixed length so the list reads calmly; the
// detail dialog shows the full title.
const TITLE_PREVIEW_LENGTH = 40;
function shortTitle(title) {
  return title.length > TITLE_PREVIEW_LENGTH ? `${title.slice(0, TITLE_PREVIEW_LENGTH).trimEnd()}…` : title;
}

// One table row per To-Do (or per legacy multi-assign batch).
// mode: 'open' (nobody signed up), 'mine' (the current identity is signed
// up), 'underway' (only others are signed up), 'done' (finished, still in
// the list) or 'archived' (Historie).
function renderTaskRow(tasks, myId, mode) {
  const task = tasks[0];
  const who = whoText(tasks);
  const isDone = mode === 'done' || mode === 'archived';
  // Signing up is the one action in the row, in its own column so names and
  // buttons stay flush; everything else lives in the detail dialog, which
  // the whole row opens.
  const action =
    !isDone && myId && !isParticipant(tasks, myId)
      ? `<button type="button" class="btn btn-sm" data-claim-task="${task.id}">Eintragen</button>`
      : '';
  return `
    <div class="checklist-table-row${isDone ? ' is-done' : ''}" role="row" data-checklist-task="${task.id}" data-checklist-task-item data-selection-search="${escapeHtml(`${task.title} ${who}`)}">
      <div class="checklist-table-task" role="cell">
        <button type="button" class="checklist-task-title" data-task-detail="${task.id}" title="${escapeHtml(task.title)}">${escapeHtml(shortTitle(task.title))}</button>
      </div>
      <div class="checklist-table-who" role="cell">${who ? whoCellHtml(tasks, who) : '<span class="muted">offen</span>'}</div>
      <div class="checklist-table-due" role="cell">${
        isDone ? `Erledigt am ${escapeHtml(formatDate(task.doneAt))}` : dueCellHtml(task)
      }</div>
      <div class="checklist-table-action" role="cell">${action}</div>
    </div>`;
}

// Due dates carry meaning, so dated To-Dos come first (soonest on top); the
// rest follow alphabetically.
function byDueThenTitle(a, b) {
  if (a.dueAt && b.dueAt && a.dueAt !== b.dueAt) return a.dueAt - b.dueAt;
  if (a.dueAt && !b.dueAt) return -1;
  if (!a.dueAt && b.dueAt) return 1;
  return a.title.localeCompare(b.title, 'de');
}

function taskTableHtml(entries, myId, { label }) {
  return `<div class="checklist-table" role="table" aria-label="${label}">
    ${entries.map(({ tasks, mode }) => renderTaskRow(tasks, myId, mode)).join('')}
  </div>`;
}

const TASK_SORTS = [
  ['due', 'Fälligkeit'],
  ['title', 'Titel · A–Z'],
  ['who', 'Wer · A–Z'],
];
const TASK_STATUS_FILTERS = [
  ['all', 'Alle'],
  ['mine', 'Meine'],
  ['open', 'Offen'],
  ['underway', 'Unterwegs'],
  ['done', 'Erledigt'],
  ['created', 'Von mir erstellt'],
];
const TASK_KIND_FILTERS = [
  ['all', 'Alle'],
  ['todo', 'Aufgaben'],
  ['item_request', 'Mitbring-Anfragen'],
];

function menuOptionsHtml(options, current, attr) {
  return options
    .map(
      ([value, label]) =>
        `<button type="button" class="btn btn-sm game-catalog-sort-option${value === current ? ' is-active' : ''}" ${attr}="${value}" aria-pressed="${value === current}">${label}</button>`,
    )
    .join('');
}

function taskToolbarHtml() {
  const activeFilters = (statusFilter !== 'all' ? 1 : 0) + (kindFilter !== 'all' ? 1 : 0);
  return `<section class="game-catalog-toolbar checklist-task-toolbar" aria-label="To-Dos durchsuchen, sortieren und filtern">
    <input type="search" id="checklist-task-search" value="${escapeHtml(taskQuery)}" placeholder="To-Do suchen" aria-label="To-Dos suchen" autocomplete="off" />
    <details class="action-menu game-catalog-sort-menu checklist-task-sort-menu" ${taskSortMenuOpen ? 'open' : ''}>
      <summary class="btn btn-sm game-catalog-sort-trigger" aria-label="To-Dos sortieren">
        ${TASK_SORTS.find(([key]) => key === taskSort)[1]} ${icon('chevronDown')}
      </summary>
      <div class="action-menu-panel game-catalog-sort-panel" role="group" aria-label="To-Dos sortieren">
        ${menuOptionsHtml(TASK_SORTS, taskSort, 'data-task-sort')}
      </div>
    </details>
    <details class="action-menu game-catalog-filter-menu checklist-task-filter-menu" ${taskFilterMenuOpen ? 'open' : ''}>
      <summary class="btn btn-sm game-catalog-filter-trigger" aria-label="Filter öffnen${activeFilters ? `, ${activeFilters} aktiv` : ''}">
        Filter${activeFilters ? ` (${activeFilters})` : ''} ${icon('chevronDown')}
      </summary>
      <div class="action-menu-panel game-catalog-filter-panel">
        <div class="stack game-catalog-filter-section" role="group" aria-label="Nach Zuständigkeit filtern">
          <span class="game-catalog-filter-heading">Wer</span>
          <div class="checklist-filter-options">${menuOptionsHtml(TASK_STATUS_FILTERS, statusFilter, 'data-task-status-filter')}</div>
        </div>
        <div class="stack game-catalog-filter-section" role="group" aria-label="Nach Art filtern">
          <span class="game-catalog-filter-heading">Art</span>
          <div class="checklist-filter-options">${menuOptionsHtml(TASK_KIND_FILTERS, kindFilter, 'data-task-kind-filter')}</div>
        </div>
      </div>
    </details>
    <button type="button" class="btn btn-primary btn-sm" id="checklist-new-todo-btn" ${getMyId() ? '' : 'disabled'}>To-Do erstellen</button>
  </section>`;
}

// "Unterwegs" folds one multi-assign batch into a single row with all
// assignees, so "Stühle mitbringen" for three people reads as one To-Do.
function groupByBatch(tasks) {
  const groups = [];
  const byBatch = new Map();
  for (const task of tasks) {
    if (task.batchId && byBatch.has(task.batchId)) {
      byBatch.get(task.batchId).push(task);
      continue;
    }
    const group = [task];
    if (task.batchId) byBatch.set(task.batchId, group);
    groups.push(group);
  }
  return groups;
}

async function markTaskDone(ctx, myId, taskId) {
  try {
    reconcileTasks(await api.checklist.setDone(taskId, myId));
    showToast('Als erledigt markiert.');
    ctx.rerender();
    return true;
  } catch (err) {
    showToast(err.message, { error: true });
    return false;
  }
}

async function archiveTask(ctx, myId, taskId) {
  try {
    reconcileTasks(await api.checklist.archive(taskId, myId));
    showToast('Archiviert.');
    ctx.rerender();
    return true;
  } catch (err) {
    showToast(err.message, { error: true });
    return false;
  }
}

async function returnTask(ctx, myId, taskId) {
  try {
    reconcileTasks(await api.checklist.release(taskId, myId));
    showToast('Ausgetragen.');
    ctx.rerender();
    return true;
  } catch (err) {
    showToast(err.message, { error: true });
    return false;
  }
}

async function deleteTask(ctx, myId, taskId) {
  if (!(await confirmDialog('To-Do löschen?', { confirmText: 'Löschen' }))) return false;
  try {
    await api.checklist.cancel(taskId, myId);
    removeTaskFromCache(taskId);
    ctx.rerender();
    return true;
  } catch (err) {
    showToast(err.message, { error: true });
    return false;
  }
}

// "Morgen · 25.09.": relative day plus the date itself for the detail view.
function dueDetailText(dueAt) {
  const diff = dueDiffDays(dueAt);
  const date = escapeHtml(formatDate(dueAt));
  if (diff < 0) return `Überfällig seit ${date}`;
  if (diff === 0) return `Heute · ${date}`;
  if (diff === 1) return `Morgen · ${date}`;
  return `In ${diff} Tagen · ${date}`;
}

// Everything about one To-Do plus its rarer actions: signing out again
// ("Austragen"), editing or deleting an own one and archiving a done one.
function openTaskDetail(ctx, myId, taskId) {
  const entry = taskEntriesById.get(taskId);
  if (!entry) return;
  const { tasks, mode } = entry;
  const task = tasks[0];
  const isOwn = task.createdBy?.id === myId;
  const isDone = mode === 'done' || mode === 'archived';
  const joined = isParticipant(tasks, myId);
  // Names flow as one list; only the comments people left get lines of
  // their own, so a long sign-up list stays compact.
  const people = taskPeople(tasks);
  const commentLines = people
    .filter((p) => p.comment)
    .map((p) => `<span>${escapeHtml(p.name)}: „${escapeHtml(p.comment)}“</span>`);
  const facts = [
    ['Art', escapeHtml(taskTypeLabel(task))],
    ['Erstellt von', `${escapeHtml(task.createdBy?.name ?? '?')} · ${escapeHtml(formatDate(task.createdAt))}`],
    ['Eingetragen', people.length ? escapeHtml(people.map((p) => p.name).join(', ')) : '<span class="muted">offen</span>'],
    commentLines.length ? ['Kommentare', commentLines.join('')] : null,
    !isDone && task.dueAt ? ['Fällig', dueDetailText(task.dueAt)] : null,
    isDone ? ['Erledigt', escapeHtml(formatDateTime(task.doneAt))] : null,
  ].filter(Boolean);
  const canManage = isOwn && !isDone;
  const canArchive = mode === 'done' && (isOwn || joined);
  const secondary = [
    canManage ? '<button type="button" class="btn btn-sm" data-detail-delete>Löschen</button>' : '',
    joined && !isDone ? '<button type="button" class="btn btn-sm" data-detail-return>Austragen</button>' : '',
    canManage ? '<button type="button" class="btn btn-sm" data-detail-edit>Bearbeiten</button>' : '',
  ].join('');
  const primary =
    joined && !isDone
      ? '<button type="button" class="btn btn-primary btn-sm" data-detail-done>Erledigt</button>'
      : !isDone && myId
        ? '<button type="button" class="btn btn-primary btn-sm" data-detail-claim>Eintragen</button>'
        : canArchive
          ? '<button type="button" class="btn btn-primary btn-sm" data-detail-archive>Archivieren</button>'
          : '';
  const { close } = openModal(
    task.title,
    `<div class="stack">
       ${task.description ? `<p class="checklist-detail-description">${escapeHtml(task.description)}</p>` : ''}
       <dl class="checklist-detail-facts">
         ${facts.map(([label, value]) => `<dt>${label}</dt><dd>${value}</dd>`).join('')}
       </dl>
       ${secondary || primary ? `<div class="checklist-form-footer">${secondary}${primary}</div>` : ''}
     </div>`,
    {
      onMount: (el) => {
        (el.closest('.modal') ?? el.querySelector('.modal'))?.classList.add('checklist-detail-modal');
        el.querySelector('[data-detail-done]')?.addEventListener('click', async () => {
          if (await markTaskDone(ctx, myId, task.id)) close();
        });
        el.querySelector('[data-detail-archive]')?.addEventListener('click', async () => {
          if (await archiveTask(ctx, myId, task.id)) close();
        });
        el.querySelector('[data-detail-return]')?.addEventListener('click', async () => {
          if (await returnTask(ctx, myId, task.id)) close();
        });
        el.querySelector('[data-detail-delete]')?.addEventListener('click', async () => {
          if (await deleteTask(ctx, myId, task.id)) close();
        });
        el.querySelector('[data-detail-edit]')?.addEventListener('click', () => {
          close();
          openCreateTodoForm(ctx, myId, task);
        });
        el.querySelector('[data-detail-claim]')?.addEventListener('click', () => {
          close();
          openClaimForm(ctx, myId, task.id);
        });
      },
    },
  );
}

function openClaimForm(ctx, myId, taskId) {
  const { close } = openModal(
    'Eintragen',
    `
      <form id="checklist-claim-form" class="stack">
        <div>
          <label for="claim-comment" class="field-label">Kommentar</label>
          <input
            type="text"
            id="claim-comment"
            maxlength="200"
            autofocus
            placeholder="Bringe zwei mit"
          />
        </div>
        <div class="checklist-form-footer">
          <button type="submit" class="btn btn-primary btn-sm">Eintragen</button>
        </div>
      </form>
    `,
    {
      onMount: (el) => {
        el.querySelector('#checklist-claim-form').addEventListener('submit', async (e) => {
          e.preventDefault();
          const comment = el.querySelector('#claim-comment').value.trim() || undefined;
          try {
            const updated = await api.checklist.claim(taskId, myId, comment);
            reconcileTasks(updated);
            close();
            showToast('Eingetragen.');
            ctx.rerender();
          } catch (err) {
            showToast(err.message, { error: true });
          }
        });
      },
    },
  );
}

// Single "To-Do erstellen" dialog: kind, title, description and due date.
// Nobody is assigned on creation; people sign up themselves ("Eintragen").
// Switching the kind rebuilds the form, so already-typed fields are
// snapshotted and written straight back into the regenerated markup - the
// same pattern renderChecklist() uses to survive its own re-renders.
// `existing` (a task) turns the same form into "To-Do bearbeiten".
async function openCreateTodoForm(ctx, myId, existing = null) {
  const form = { kind: existing?.type ?? 'todo' };

  let bodyEl;
  let anyFieldEverTouched = false;

  function fieldValues() {
    const title = bodyEl.querySelector('#todo-title')?.value ?? '';
    const description = bodyEl.querySelector('#todo-description')?.value ?? '';
    const dueHidden = bodyEl.querySelector('#todo-due');
    const dueAtMs = dueHidden?.value ? parseDatetimeLocalMs(dueHidden.value) : null;
    return { title, description, dueAtMs };
  }

  // A selector that will match the *replacement* of a toggle button after
  // renderForm() rebuilds the form - lets focus survive a click on one of
  // these even though the element itself gets torn down and recreated with
  // the same identifying data-attribute/value.
  function focusRestoreSelector(el) {
    if (!el) return null;
    if (el.dataset.todoKind !== undefined) return `[data-todo-kind="${el.dataset.todoKind}"]`;
    return null;
  }

  function renderForm() {
    const isFreshOpen = !bodyEl.querySelector('#todo-title');
    const prev = !isFreshOpen
      ? fieldValues()
      : existing
        ? { title: existing.title, description: existing.description ?? '', dueAtMs: existing.dueAt ?? null }
        : { title: '', description: '', dueAtMs: null };
    const restoreSelector = isFreshOpen
      ? null
      : focusRestoreSelector(bodyEl.contains(document.activeElement) ? document.activeElement : null);

    const choice = (attr, value, current, label) =>
      `<button type="button" class="btn btn-sm${current === value ? ' is-selected' : ''}" ${attr}="${value}" aria-pressed="${current === value}">${label}</button>`;

    bodyEl.innerHTML = `
      <form id="checklist-todo-form" class="stack">
        <div>
          <span class="field-label" id="todo-kind-label">Art</span>
          <div class="checklist-choice-toolbar" role="group" aria-labelledby="todo-kind-label">
            ${choice('data-todo-kind', 'todo', form.kind, 'Aufgabe')}
            ${choice('data-todo-kind', 'item_request', form.kind, 'Mitbring-Anfrage')}
          </div>
        </div>
        <div>
          <span class="field-label is-required">Titel</span>
          <input type="text" id="todo-title" maxlength="80" required value="${escapeHtml(prev.title)}" placeholder="${
            form.kind === 'todo' ? 'Mehrfachsteckdosen mitbringen' : 'Xbox-Controller'
          }" />
        </div>
        <div>
          <span class="field-label">Beschreibung</span>
          <textarea id="todo-description" rows="1" maxlength="300" placeholder="${
            form.kind === 'todo' ? 'Mindestens 6 Plätze' : 'Gern kabellos'
          }">${escapeHtml(prev.description)}</textarea>
        </div>
        <div>
          <label for="todo-due-date" class="field-label">Fällig bis</label>
          ${dateTimeFieldHtml('todo-due', prev.dueAtMs, { dateOnly: true, clearable: true, label: 'Fällig bis' })}
        </div>
        <div class="checklist-form-footer">
          <button type="submit" class="btn btn-primary btn-sm">${existing ? 'Speichern' : 'To-Do erstellen'}</button>
        </div>
      </form>`;

    wireDateTimeField(bodyEl, 'todo-due');

    bodyEl.querySelectorAll('[data-todo-kind]').forEach((btn) => {
      btn.addEventListener('click', () => {
        form.kind = btn.dataset.todoKind;
        renderForm();
      });
    });
    bodyEl.querySelector('#checklist-todo-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const { title, description, dueAtMs } = fieldValues();
      const trimmedTitle = title.trim();
      if (!trimmedTitle) return;
      const trimmedDescription = description.trim() || undefined;
      if (existing) {
        try {
          const updated = await api.checklist.updateTask(existing.id, myId, {
            type: form.kind,
            title: trimmedTitle,
            description: trimmedDescription ?? null,
            dueAt: dueAtMs ?? null,
          });
          reconcileTasks(updated);
          close();
          showToast('Gespeichert.');
          ctx.rerender();
        } catch (err) {
          showToast(err.message, { error: true });
        }
        return;
      }
      try {
        const created = form.kind === 'todo'
          ? await api.checklist.createTodo(myId, trimmedTitle, trimmedDescription, undefined, dueAtMs ?? undefined)
          : await api.checklist.createRequest(myId, trimmedTitle, trimmedDescription, undefined, dueAtMs ?? undefined);
        reconcileTasks(created);
        close();
        showToast('To-Do erstellt.');
        ctx.rerender();
      } catch (err) {
        showToast(err.message, { error: true });
      }
    });

    if (isFreshOpen) {
      bodyEl.querySelector('#todo-title').focus();
    } else if (restoreSelector) {
      bodyEl.querySelector(restoreSelector)?.focus();
    }
  }

  const { close } = openModal(existing ? 'To-Do bearbeiten' : 'To-Do erstellen', '<div data-todo-form-body></div>', {
    confirmClose: () =>
      anyFieldEverTouched ? (existing ? 'Die Änderungen gehen verloren.' : 'Das To-Do mit den bisherigen Angaben geht verloren.') : null,
    onMount: (el) => {
      bodyEl = el.querySelector('[data-todo-form-body]');
      // Attached once on the stable wrapper (never replaced by renderForm()'s
      // innerHTML rewrites, unlike its children) so it survives every
      // kind toggle without stacking duplicate listeners. 'input' covers the
      // text fields and the due-date picker (see its own dispatched 'input'
      // in dateTimeField.js); 'change' stays as a safety net.
      const markTouched = () => {
        anyFieldEverTouched = true;
      };
      bodyEl.addEventListener('input', markTouched);
      bodyEl.addEventListener('change', markTouched);
      renderForm();
    },
  });
}

// `activeTab` comes from the route: the Orga area exposes To-Dos and Packliste
// as two of its own tabs (see sectionNav.js), so this view no longer carries a
// second tab row of its own.
export function renderChecklist(container, ctx, activeTab = 'todos') {
  if ((tasksCache === null || tasksStale) && !loadingTasks) loadTasks(ctx);
  const myId = getMyId();
  if (myId && itemsCacheForId !== myId && !loadingItems) loadItems(ctx, myId);
  else if (myId && itemsStale && !loadingItems) loadItems(ctx, myId, { silent: true });

  const prevItemLabel = container.querySelector('[data-add-item-form] [data-item-label]')?.value ?? '';
  const prevItemFocused = document.activeElement?.matches('[data-add-item-form] [data-item-label]');

  const tasks = tasksCache || [];
  const mineTasks = assignedTasks() ?? [];
  const openTasks = tasks.filter((t) => t.status === 'open');
  const underwayTasks = tasks.filter((t) => t.status === 'taken' && !isParticipant([t], myId));
  const byDoneDesc = (a, b) => (b.doneAt ?? 0) - (a.doneAt ?? 0);
  // Done To-Dos stay in the list, marked, until someone archives them.
  const finishedTasks = tasks.filter((t) => t.status === 'done' && !t.archivedAt).sort(byDoneDesc);
  const doneTasks = tasks.filter((t) => t.status === 'done' && t.archivedAt).sort(byDoneDesc);
  const activeEntries = [
    ...mineTasks.map((t) => ({ tasks: [t], mode: 'mine' })),
    ...openTasks.map((t) => ({ tasks: [t], mode: 'open' })),
    ...groupByBatch(underwayTasks).map((group) => ({ tasks: group, mode: 'underway' })),
    ...finishedTasks.map((t) => ({ tasks: [t], mode: 'done' })),
  ];
  const matchesStatus = (e) =>
    statusFilter === 'all' ||
    (statusFilter === 'created' ? e.tasks[0].createdBy?.id === myId : e.mode === statusFilter);
  const whoKey = (e) => whoText(e.tasks) || '\uffff';
  const sorters = {
    due: (a, b) => byDueThenTitle(a.tasks[0], b.tasks[0]),
    title: (a, b) => a.tasks[0].title.localeCompare(b.tasks[0].title, 'de'),
    who: (a, b) => whoKey(a).localeCompare(whoKey(b), 'de') || byDueThenTitle(a.tasks[0], b.tasks[0]),
  };
  // Done To-Dos always follow the open work, newest first.
  const visibleEntries = activeEntries
    .filter(matchesStatus)
    .filter((e) => kindFilter === 'all' || e.tasks[0].type === kindFilter)
    .sort((a, b) =>
      a.mode === 'done' || b.mode === 'done'
        ? Number(a.mode === 'done') - Number(b.mode === 'done') || byDoneDesc(a.tasks[0], b.tasks[0])
        : sorters[taskSort](a, b),
    );
  const archivedEntries = doneTasks.map((t) => ({ tasks: [t], mode: 'archived' }));
  taskEntriesById = new Map([...activeEntries, ...archivedEntries].map((e) => [e.tasks[0].id, e]));

  const todoListHtml =
    tasksCache === null
      ? emptyStateHtml('Lädt…')
      : `${taskToolbarHtml()}
           ${activeEntries.length === 0 ? emptyStateHtml('Noch keine To-Dos.') : visibleEntries.length ? taskTableHtml(visibleEntries, myId, { label: 'To-Dos' }) : emptyStateHtml('Keine To-Dos für diese Filter.')}
           <p class="muted" data-checklist-task-search-empty role="status" style="font-size:var(--font-size-xs);" hidden>Keine passenden To-Dos gefunden.</p>`;

  container.innerHTML = `
    <div class="grouped-page-sections">
      ${
        activeTab === 'packliste'
          ? `<section class="card stack grouped-page-section" aria-labelledby="checklist-packing-title">
               <div class="grouped-page-section-title">
                 <h2 id="checklist-packing-title">Eingepackt ${myId && itemsCacheForId === myId ? packingCountHtml() : ''}</h2>
                 ${myId && itemsCacheForId === myId ? packingEditButtonHtml() : ''}
               </div>
               ${myId && itemsCacheForId === myId ? packingProgressHtml() : ''}
               ${renderItems(myId)}
             </section>`
          : `<section class="card stack grouped-page-section" aria-label="To-Dos">
               ${todoListHtml}
             </section>`
      }
      ${
        activeTab === 'todos' && doneTasks.length
          ? `<details class="card grouped-page-section collapsible-section" data-checklist-history ${historyOpen ? 'open' : ''}>
               <summary class="collapsible-section-header">
                 <h2>Historie</h2>
                 <span class="collapsible-section-summary-end">
                   <span class="badge badge-offline">${doneTasks.length}</span>
                   <span class="collapsible-section-chevron">${icon('chevronRight')}</span>
                 </span>
               </summary>
               <div class="collapsible-section-content">
                 ${taskTableHtml(archivedEntries, myId, { label: 'Historie' })}
               </div>
             </details>`
          : ''
      }
    </div>
  `;

  const labelInput = container.querySelector('[data-add-item-form] [data-item-label]');
  if (labelInput && prevItemLabel) {
    labelInput.value = prevItemLabel;
    if (prevItemFocused) labelInput.focus();
  }


  wireActionMenus(container);
  const taskSortMenu = container.querySelector('.checklist-task-sort-menu');
  taskSortMenu?.addEventListener('toggle', () => {
    taskSortMenuOpen = taskSortMenu.open;
  });
  const taskFilterMenu = container.querySelector('.checklist-task-filter-menu');
  taskFilterMenu?.addEventListener('toggle', () => {
    taskFilterMenuOpen = taskFilterMenu.open;
  });
  wireSelectionSearch(container, {
    inputId: 'checklist-task-search',
    itemSelector: '[data-checklist-task-item]',
    emptySelector: '[data-checklist-task-search-empty]',
    onQueryChange: (query) => {
      taskQuery = query;
    },
  });
  container.querySelectorAll('[data-task-sort]').forEach((btn) => {
    btn.addEventListener('click', () => {
      taskSort = btn.dataset.taskSort;
      taskSortMenuOpen = false;
      ctx.rerender();
    });
  });
  container.querySelectorAll('[data-task-status-filter]').forEach((btn) => {
    btn.addEventListener('click', () => {
      statusFilter = btn.dataset.taskStatusFilter;
      ctx.rerender();
    });
  });
  container.querySelectorAll('[data-task-kind-filter]').forEach((btn) => {
    btn.addEventListener('click', () => {
      kindFilter = btn.dataset.taskKindFilter;
      ctx.rerender();
    });
  });

  container.querySelector('[data-toggle-item-editing]')?.addEventListener('click', () => {
    editingItems = !editingItems;
    ctx.rerender();
  });

  container.querySelector('[data-checklist-history]')?.addEventListener('toggle', (event) => {
    historyOpen = event.currentTarget.open;
  });

  container.querySelector('#checklist-new-todo-btn')?.addEventListener('click', () => {
    if (!myId) return showToast('Bitte zuerst auswählen, wer du bist.', { error: true });
    openCreateTodoForm(ctx, myId);
  });

  container.querySelector('[data-add-item-form]')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const input = e.currentTarget.querySelector('[data-item-label]');
    const label = input.value.trim();
    if (!label) return;
    try {
      await api.checklist.addItem(myId, label);
      // Clear the field for the next entry. Re-query it live instead of reusing
      // `input`: the checklist:changed echo can re-render the form while the add
      // request is in flight, leaving `input` detached. Clearing the live field
      // now - before the next render - is what makes both the checklist's own
      // draft snapshot and the generic viewRenderState capture (see app.js's
      // renderCurrent) record an empty draft instead of restoring the just-added
      // label. Keep focus so the next item can be typed straight away.
      const liveField = document.querySelector('[data-add-item-form] [data-item-label]');
      if (liveField) {
        liveField.value = '';
        liveField.focus();
      }
      // Refetch to pick up the server-assigned id, but keep showing the
      // current list meanwhile instead of flashing "Lädt…" (see loadItems).
      loadItems(ctx, myId, { silent: true });
    } catch (err) {
      showToast(err.message, { error: true });
    }
  });

  container.querySelectorAll('[data-toggle-item]').forEach((checkbox) => {
    checkbox.addEventListener('change', async (e) => {
      const checked = e.currentTarget.checked;
      try {
        await api.checklist.setItemChecked(checkbox.dataset.toggleItem, myId, checked);
        const item = itemsCache?.find((it) => it.id === checkbox.dataset.toggleItem);
        if (item) item.checked = checked;
        ctx.rerender();
      } catch (err) {
        e.currentTarget.checked = !checked;
        showToast(err.message, { error: true });
      }
    });
  });

  container.querySelectorAll('[data-remove-item]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      try {
        await api.checklist.removeItem(btn.dataset.removeItem, myId);
        // Same quiet refetch as adding an item — the row is gone from the
        // still-visible list immediately below, no loading flash needed.
        loadItems(ctx, myId, { silent: true });
      } catch (err) {
        showToast(err.message, { error: true });
      }
    });
  });

  container.querySelectorAll('[data-claim-task]').forEach((btn) => {
    btn.addEventListener('click', () => openClaimForm(ctx, myId, btn.dataset.claimTask));
  });

  container.querySelectorAll('[data-task-detail]').forEach((btn) => {
    btn.addEventListener('click', () => openTaskDetail(ctx, myId, btn.dataset.taskDetail));
  });
}
