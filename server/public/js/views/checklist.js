// "Checkliste" view: a private per-event packing checklist (Grundstock plus
// freely added/removable custom items) and a shared To-Do pool
// (docs/KONZEPT-PACKLISTE-TICKETS.md). Any active member can create a To-Do
// of either kind (Aufgabe/Mitbring-Anfrage), leave it open for anyone to
// claim, or address it straight at themselves or one/several others; "Mir
// zugewiesen" gives everyone a single place to see what's on their own
// plate, sorted by due date. Claiming is immediate and binding - no
// confirmation step, same as a captain-draft pick.

import { api, GROUP_KEY } from '../api.js';
import { state } from '../state.js';
import { escapeHtml, avatarHtml, formatDateTime } from '../format.js';
import { openModal, confirmDialog } from '../modal.js';
import { showToast } from '../toast.js';
import { getMyId } from '../whoami.js';
import { emptyStateHtml } from '../emptyState.js';
import { icon } from '../icons.js';
import { dateTimeFieldHtml, wireDateTimeField, parseDatetimeLocalMs } from '../dateTimeField.js';
import { dueBadgeInfo, isOverdue } from '../checklistDue.js';

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
let typeFilter = 'all'; // 'all' | 'todo' | 'item_request', open-pool only
let onlyMineFilter = false; // open-pool only: "von mir erstellt"

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
// shows this on its To-Dos tab, so the count stays visible from every tab of
// the area instead of only from inside the list. Returns 0 while nothing is
// loaded yet — a badge must never guess a number.
export function openTaskCount() {
  return assignedTasks()?.length ?? 0;
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
    .filter((task) => task.status === 'taken' && task.assignee?.id === myId)
    .sort((a, b) => {
      if (a.dueAt && b.dueAt) return a.dueAt - b.dueAt;
      if (a.dueAt) return -1;
      if (b.dueAt) return 1;
      return 0;
    });
}

// The tab count has to be right on every Orga tab, not only on the one that
// happens to render the list — entering the area through Events or a direct
// "/#arrivals" link otherwise leaves the badge permanently blank. Loading
// re-renders once it resolves, and a filled cache makes this a no-op.
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
      <input type="text" data-item-label placeholder="z.B. Skill" maxlength="80" required style="flex:1;" aria-label="Neuer Packlisten-Eintrag" />
      <button type="submit" class="btn">Hinzufügen</button>
    </form>`;

function renderItems(myId) {
  if (!myId) {
    return `<div class="muted" style="font-size:var(--font-size-sm);">Wähle oben, wer du bist, um deine Packliste zu sehen.</div>`;
  }
  if (itemsCache === null || itemsCacheForId !== myId) {
    return `${emptyStateHtml('Lädt…')}${addItemFormHtml()}`;
  }
  const rows = itemsCache
    .map(
      (item) => `
      <div class="row checklist-item-row ${item.checked ? 'is-checked' : ''}">
        <label class="checklist-item-label">
          <input type="checkbox" data-toggle-item="${item.id}" ${item.checked ? 'checked' : ''} />
          <span>${escapeHtml(item.label)}</span>
        </label>
        <button type="button" class="icon-btn" data-remove-item="${item.id}" aria-label="Entfernen">${icon('x')}</button>
      </div>`,
    )
    .join('');
  return `
    <div class="checklist-item-list">${rows}</div>
    ${addItemFormHtml()}`;
}

function taskTypeLabel(task) {
  return task.type === 'todo' ? 'Aufgabe' : 'Mitbring-Anfrage';
}

function dueBadgeHtml(task) {
  const info = dueBadgeInfo(task.dueAt);
  if (!info) return '';
  return `<span class="badge ${info.cls}">${escapeHtml(info.text)}</span>`;
}

// mode drives which footer actions/meta line a card gets: 'open' (in the
// shared pool), 'mine' (taken by the current identity), 'underway' (taken by
// someone else) or 'done' (Historie).
function renderTaskCard(task, myId, mode) {
  const overdue = mode !== 'done' && isOverdue(task.dueAt);
  let footer = '';
  if (mode === 'open') {
    const isOwn = task.createdBy?.id === myId;
    footer =
      myId && !isOwn
        ? `<button type="button" class="btn btn-primary btn-sm" data-claim-task="${task.id}">Übernehmen</button>`
        : isOwn
          ? `<button type="button" class="btn btn-danger btn-sm" data-cancel-task="${task.id}">Zurückziehen</button>`
          : '';
  } else if (mode === 'mine') {
    footer = `
      <div class="row" style="gap:var(--space-2);">
        <button type="button" class="btn btn-sm" data-release-task="${task.id}" style="flex:1;">Freigeben</button>
        <button type="button" class="btn btn-primary btn-sm" data-done-task="${task.id}" style="flex:1;">Erledigt</button>
      </div>`;
  }
  return `
    <div class="card stack ${overdue ? 'checklist-task-overdue' : ''}" data-checklist-task="${task.id}">
      <div class="row-between">
        <strong>${escapeHtml(task.title)}</strong>
        <span class="badge badge-neutral">${taskTypeLabel(task)}</span>
      </div>
      ${task.description ? `<div class="muted" style="font-size:var(--font-size-sm);">${escapeHtml(task.description)}</div>` : ''}
      ${
        mode === 'underway'
          ? `<div class="row" style="gap:var(--space-2);">
               ${avatarHtml(task.assignee, 20)}
               <span class="muted" style="font-size:var(--font-size-sm);">${escapeHtml(task.assignee?.name ?? '?')} kümmert sich darum</span>
             </div>`
          : ''
      }
      ${task.claimComment ? `<div class="muted" style="font-size:var(--font-size-sm);">„${escapeHtml(task.claimComment)}“</div>` : ''}
      <div class="row-between">
        <span class="muted" style="font-size:var(--font-size-xs);">${
          mode === 'done'
            ? `${escapeHtml(task.assignee?.name ?? '?')} · ${formatDateTime(task.doneAt)}`
            : `von ${escapeHtml(task.createdBy?.name ?? '?')}`
        }</span>
        ${mode === 'done' ? '' : dueBadgeHtml(task)}
      </div>
      ${footer}
    </div>`;
}

function openClaimForm(ctx, myId, taskId) {
  const { close } = openModal(
    'To-Do übernehmen',
    `
      <form id="checklist-claim-form" class="stack">
        <input
          type="text"
          id="claim-comment"
          maxlength="200"
          autofocus
          placeholder="Kommentar (optional), z.B. Bringe einen XBOX Controller mit."
        />
        <button type="submit" class="btn btn-primary btn-block">Übernehmen</button>
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
            showToast('Übernommen.');
            ctx.rerender();
          } catch (err) {
            showToast(err.message, { error: true });
          }
        });
      },
    },
  );
}

// Use the start group's active memberships because activeGroupPlayers
// validates the same retained group_id boundary on creation.
async function assigneeCandidates() {
  const groupId = sessionStorage.getItem(GROUP_KEY);
  if (!groupId) return state.players;
  try {
    const members = await api.groups.members(groupId);
    return members.map((m) => ({ id: m.playerId, name: m.name, color: m.color, avatar: m.avatar }));
  } catch {
    return state.players;
  }
}

// Single unified "To-Do erstellen" dialog replacing the old separate
// "Anfrage stellen"/"Aufgabe verteilen" flows: kind, assignment and due date
// are all one form now (docs/KONZEPT-PACKLISTE-TICKETS.md Abschnitt 6).
// Switching kind/assignment rebuilds the assignee grid, so already-typed
// title/description/due-date fields are snapshotted and written straight
// back into the regenerated markup - the same pattern renderChecklist()
// itself uses to survive its own re-renders (see prevItemLabel below).
async function openCreateTodoForm(ctx, myId) {
  const candidates = (await assigneeCandidates()).filter((p) => p.id !== myId);
  const form = { kind: 'todo', assignMode: 'none', selected: new Set() };

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
    if (el.dataset.todoAssignMode !== undefined) return `[data-todo-assign-mode="${el.dataset.todoAssignMode}"]`;
    if (el.hasAttribute('data-todo-select-all')) return '[data-todo-select-all]';
    if (el.hasAttribute('data-todo-select-none')) return '[data-todo-select-none]';
    return null;
  }

  function renderForm() {
    const isFreshOpen = !bodyEl.querySelector('#todo-title');
    const prev = isFreshOpen ? { title: '', description: '', dueAtMs: null } : fieldValues();
    const restoreSelector = isFreshOpen
      ? null
      : focusRestoreSelector(bodyEl.contains(document.activeElement) ? document.activeElement : null);

    const assigneeOptions = candidates
      .map(
        (p) => `
        <label class="check-row">
          <input type="checkbox" value="${p.id}" data-todo-assignee ${form.selected.has(p.id) ? 'checked' : ''} />
          ${avatarHtml(p, 20)}
          <span class="player-name" style="flex:1;">${escapeHtml(p.name)}</span>
        </label>`,
      )
      .join('');

    bodyEl.innerHTML = `
      <form id="checklist-todo-form" class="stack">
        <div class="selection-toolbar" role="group" aria-labelledby="todo-kind-label">
          <span class="field-label" id="todo-kind-label">Art</span>
          <button type="button" class="btn btn-sm${form.kind === 'todo' ? ' btn-primary' : ''}" data-todo-kind="todo" aria-pressed="${form.kind === 'todo'}">Aufgabe</button>
          <button type="button" class="btn btn-sm${form.kind === 'item_request' ? ' btn-primary' : ''}" data-todo-kind="item_request" aria-pressed="${form.kind === 'item_request'}">Mitbring-Anfrage</button>
        </div>
        <div>
          <span class="field-label">Titel</span>
          <input type="text" id="todo-title" maxlength="80" required value="${escapeHtml(prev.title)}" placeholder="${
            form.kind === 'todo' ? 'z.B. Mehrfachsteckdosen mitbringen' : 'z.B. Kann mir jemand einen Controller mitnehmen?'
          }" />
        </div>
        <div>
          <span class="field-label">Beschreibung (optional)</span>
          <textarea id="todo-description" rows="2" maxlength="300">${escapeHtml(prev.description)}</textarea>
        </div>
        <div class="checklist-assignment-section">
          <div class="selection-toolbar" role="group" aria-labelledby="todo-assign-label">
            <span class="field-label" id="todo-assign-label">Zuweisen an</span>
            <button type="button" class="btn btn-sm${form.assignMode === 'none' ? ' btn-primary' : ''}" data-todo-assign-mode="none" aria-pressed="${form.assignMode === 'none'}">Niemand (offen)</button>
            <button type="button" class="btn btn-sm${form.assignMode === 'self' ? ' btn-primary' : ''}" data-todo-assign-mode="self" aria-pressed="${form.assignMode === 'self'}">Ich</button>
            <button type="button" class="btn btn-sm${form.assignMode === 'pick' ? ' btn-primary' : ''}" data-todo-assign-mode="pick" aria-pressed="${form.assignMode === 'pick'}">Personen wählen…</button>
          </div>
          ${
            form.assignMode === 'pick'
              ? `<div class="checklist-assignment-actions" style="margin-top:var(--space-2);">
                   <button type="button" class="btn btn-sm" data-todo-select-all>Alle auswählen</button>
                   <button type="button" class="btn btn-sm" data-todo-select-none>Alle abwählen</button>
                 </div>
                 <div class="player-selection-grid tournament-player-grid" style="margin-top:var(--space-2);">${assigneeOptions}</div>`
              : ''
          }
        </div>
        <div>
          <label for="todo-due-date" class="field-label">Fällig bis (optional)</label>
          ${dateTimeFieldHtml('todo-due', prev.dueAtMs, { dateOnly: true, clearable: true, label: 'Fällig bis' })}
        </div>
        <button type="submit" class="btn btn-primary btn-block">To-Do erstellen</button>
      </form>`;

    wireDateTimeField(bodyEl, 'todo-due');

    bodyEl.querySelectorAll('[data-todo-kind]').forEach((btn) => {
      btn.addEventListener('click', () => {
        form.kind = btn.dataset.todoKind;
        renderForm();
      });
    });
    bodyEl.querySelectorAll('[data-todo-assign-mode]').forEach((btn) => {
      btn.addEventListener('click', () => {
        form.assignMode = btn.dataset.todoAssignMode;
        renderForm();
      });
    });
    bodyEl.querySelectorAll('[data-todo-assignee]').forEach((checkbox) => {
      checkbox.addEventListener('change', () => {
        if (checkbox.checked) form.selected.add(checkbox.value);
        else form.selected.delete(checkbox.value);
      });
    });
    bodyEl.querySelector('[data-todo-select-all]')?.addEventListener('click', () => {
      candidates.forEach((p) => form.selected.add(p.id));
      renderForm();
    });
    bodyEl.querySelector('[data-todo-select-none]')?.addEventListener('click', () => {
      form.selected.clear();
      renderForm();
    });
    bodyEl.querySelector('#checklist-todo-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const { title, description, dueAtMs } = fieldValues();
      const trimmedTitle = title.trim();
      if (!trimmedTitle) return;
      const trimmedDescription = description.trim() || undefined;
      const assigneePlayerIds =
        form.assignMode === 'self' ? [myId] : form.assignMode === 'pick' && form.selected.size ? [...form.selected] : undefined;
      try {
        const created = form.kind === 'todo'
          ? await api.checklist.createTodo(myId, trimmedTitle, trimmedDescription, assigneePlayerIds, dueAtMs ?? undefined)
          : await api.checklist.createRequest(myId, trimmedTitle, trimmedDescription, assigneePlayerIds, dueAtMs ?? undefined);
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

  const { close } = openModal('To-Do erstellen', '<div data-todo-form-body></div>', {
    confirmClose: () => (anyFieldEverTouched ? 'Das To-Do mit den bisherigen Angaben geht verloren.' : null),
    onMount: (el) => {
      bodyEl = el.querySelector('[data-todo-form-body]');
      // Attached once on the stable wrapper (never replaced by renderForm()'s
      // innerHTML rewrites, unlike its children) so it survives every
      // kind/assignment toggle without stacking duplicate listeners. Both
      // events are needed: 'input' for the text fields and the due-date
      // picker (see its own dispatched 'input' in dateTimeField.js), 'change'
      // for the assignee checkboxes, which never fire 'input'.
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
  const openAll = tasks.filter((t) => t.status === 'open');
  const mineTasks = assignedTasks() ?? [];
  const underwayTasks = tasks.filter((t) => t.status === 'taken' && t.assignee?.id !== myId);
  const doneTasks = tasks.filter((t) => t.status === 'done');
  const openFiltered = openAll
    .filter((t) => (typeFilter === 'all' ? true : t.type === typeFilter))
    .filter((t) => (onlyMineFilter ? t.createdBy?.id === myId : true));

  const mineHtml =
    tasksCache === null
      ? emptyStateHtml('Lädt…')
      : mineTasks.length === 0
        ? emptyStateHtml('Aktuell liegt nichts bei dir.')
        : `<div class="two-column-card-grid">${mineTasks.map((t) => renderTaskCard(t, myId, 'mine')).join('')}</div>`;

  const openHtml =
    tasksCache === null
      ? emptyStateHtml('Lädt…')
      : openFiltered.length === 0
        ? emptyStateHtml('Gerade nichts Offenes.')
        : `<div class="two-column-card-grid">${openFiltered.map((t) => renderTaskCard(t, myId, 'open')).join('')}</div>`;

  const underwayHtml =
    underwayTasks.length === 0
      ? ''
      : `<div class="section-title">Unterwegs</div><div class="two-column-card-grid">${underwayTasks
          .map((t) => renderTaskCard(t, myId, 'underway'))
          .join('')}</div>`;

  container.innerHTML = `
    <div class="grouped-page-sections">
      ${
        activeTab === 'packliste'
          ? `<section class="card stack grouped-page-section" aria-label="Meine Packliste">
               ${renderItems(myId)}
             </section>`
          : `<section class="card stack grouped-page-section" aria-label="To-Do">
               <button type="button" class="btn btn-primary btn-sm" id="checklist-new-todo-btn" ${myId ? '' : 'disabled'}>To-Do erstellen</button>
               <div class="section-title" style="margin-top:0;">Mir zugewiesen</div>
               ${mineHtml}
               <div class="section-title">Offen</div>
               <div class="chip-list">
                 <button type="button" class="chip${typeFilter === 'all' ? ' is-active' : ''}" aria-pressed="${typeFilter === 'all'}" data-checklist-type-filter="all">Alle</button>
                 <button type="button" class="chip${typeFilter === 'todo' ? ' is-active' : ''}" aria-pressed="${typeFilter === 'todo'}" data-checklist-type-filter="todo">Aufgaben</button>
                 <button type="button" class="chip${typeFilter === 'item_request' ? ' is-active' : ''}" aria-pressed="${typeFilter === 'item_request'}" data-checklist-type-filter="item_request">Mitbring-Anfragen</button>
                 <button type="button" class="chip${onlyMineFilter ? ' is-active' : ''}" aria-pressed="${onlyMineFilter}" data-checklist-only-mine>Von mir erstellt</button>
               </div>
               ${openHtml}
               ${underwayHtml}
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
                 <div class="two-column-card-grid">${doneTasks.map((t) => renderTaskCard(t, myId, 'done')).join('')}</div>
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


  container.querySelectorAll('[data-checklist-type-filter]').forEach((btn) => {
    btn.addEventListener('click', () => {
      typeFilter = btn.dataset.checklistTypeFilter;
      ctx.rerender();
    });
  });
  container.querySelector('[data-checklist-only-mine]')?.addEventListener('click', () => {
    onlyMineFilter = !onlyMineFilter;
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
    btn.addEventListener('click', () => {
      openClaimForm(ctx, myId, btn.dataset.claimTask);
    });
  });

  container.querySelectorAll('[data-release-task]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      try {
        const updated = await api.checklist.release(btn.dataset.releaseTask, myId);
        reconcileTasks(updated);
        ctx.rerender();
      } catch (err) {
        showToast(err.message, { error: true });
      }
    });
  });

  container.querySelectorAll('[data-done-task]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      try {
        const updated = await api.checklist.setDone(btn.dataset.doneTask, myId);
        reconcileTasks(updated);
        showToast('Als erledigt markiert.');
        ctx.rerender();
      } catch (err) {
        showToast(err.message, { error: true });
      }
    });
  });

  container.querySelectorAll('[data-cancel-task]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      if (!(await confirmDialog('Zurückziehen? Das To-Do verschwindet aus dem Pool.', { confirmText: 'Zurückziehen' }))) return;
      try {
        await api.checklist.cancel(btn.dataset.cancelTask, myId);
        removeTaskFromCache(btn.dataset.cancelTask);
        ctx.rerender();
      } catch (err) {
        showToast(err.message, { error: true });
      }
    });
  });
}
