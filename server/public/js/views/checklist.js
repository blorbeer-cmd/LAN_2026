// "Packliste" view: a private per-event packing checklist (Grundstock plus
// freely added/removable custom items) and a shared task/request pool.
// Organizers distribute to-dos (open for anyone to claim, or handed straight
// to one or several people); anyone can post an open "kann mir jemand X
// mitnehmen"-style request. Claiming is immediate and binding - no
// confirmation step, same as a captain-draft pick.

import { api, GROUP_KEY } from '../api.js';
import { state } from '../state.js';
import { escapeHtml, avatarHtml, formatDateTime } from '../format.js';
import { openModal, confirmDialog } from '../modal.js';
import { showToast } from '../toast.js';
import { getMyId, whoAmICardHtml, wireWhoAmICard } from '../whoami.js';
import { icon } from '../icons.js';

let tasksCache = null;
let itemsCache = null;
let itemsCacheForId = null;
let loadingTasks = false;
let loadingItems = false;
let historyOpen = false;

async function loadTasks(ctx) {
  loadingTasks = true;
  try {
    const res = await api.checklist.tasks();
    tasksCache = res.tasks;
  } catch (err) {
    showToast(err.message, { error: true });
    tasksCache = [];
  } finally {
    loadingTasks = false;
    ctx.rerender();
  }
}

async function loadItems(ctx, playerId) {
  loadingItems = true;
  try {
    const res = await api.checklist.items(playerId);
    itemsCache = res.items;
    itemsCacheForId = playerId;
  } catch (err) {
    showToast(err.message, { error: true });
    itemsCache = [];
    itemsCacheForId = playerId;
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
}

// Called from app.js on every checklist:changed socket event.
export function invalidateChecklist() {
  tasksCache = null;
  invalidateItems();
}

// These caches are keyed by player id, not by group - switching the active
// group (see groupContext.js) must drop them too, or the previous group's
// tasks/items keep rendering (and stay clickable) until some unrelated
// checklist:changed socket event happens to arrive.
window.addEventListener('respawn:group-changed', invalidateChecklist);

function renderItems(myId) {
  if (!myId) {
    return `<div class="muted" style="font-size:var(--font-size-sm);">Wähle oben, wer du bist, um deine Packliste zu sehen.</div>`;
  }
  if (itemsCache === null || itemsCacheForId !== myId) {
    return `<div class="empty-state">Lädt…</div>`;
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
    <div class="stack checklist-item-list">${rows}</div>
    <form class="row" data-add-item-form style="gap:var(--space-2);">
      <input type="text" data-item-label placeholder="z.B. Ersatzbrille" maxlength="80" required style="flex:1;" />
      <button type="submit" class="btn btn-sm">Hinzufügen</button>
    </form>`;
}

function taskTypeLabel(task) {
  return task.type === 'todo' ? 'Aufgabe' : 'Mitbring-Anfrage';
}

function renderOpenTask(task, myId) {
  const isOwn = task.createdBy?.id === myId;
  return `
    <div class="card stack" data-checklist-task="${task.id}">
      <div class="row-between">
        <strong>${escapeHtml(task.title)}</strong>
        <span class="badge">${taskTypeLabel(task)}</span>
      </div>
      ${task.description ? `<div class="muted" style="font-size:var(--font-size-sm);">${escapeHtml(task.description)}</div>` : ''}
      <div class="row-between">
        <span class="muted" style="font-size:var(--font-size-xs);">von ${escapeHtml(task.createdBy?.name ?? '?')}</span>
        ${
          myId && !isOwn
            ? `<button type="button" class="btn btn-primary btn-sm" data-claim-task="${task.id}">Übernehmen</button>`
            : isOwn
              ? `<button type="button" class="btn btn-danger btn-sm" data-cancel-task="${task.id}">Zurückziehen</button>`
              : ''
        }
      </div>
    </div>`;
}

function renderTakenTask(task, myId) {
  const isMine = task.assignee?.id === myId;
  return `
    <div class="card stack" data-checklist-task="${task.id}">
      <div class="row-between">
        <strong>${escapeHtml(task.title)}</strong>
        <span class="badge">${taskTypeLabel(task)}</span>
      </div>
      ${task.description ? `<div class="muted" style="font-size:var(--font-size-sm);">${escapeHtml(task.description)}</div>` : ''}
      <div class="row" style="gap:var(--space-2);">
        ${avatarHtml(task.assignee, 20)}
        <span class="muted" style="font-size:var(--font-size-sm);">${escapeHtml(task.assignee?.name ?? '?')} kümmert sich darum</span>
      </div>
      ${
        isMine
          ? `<div class="row" style="gap:var(--space-2);">
               <button type="button" class="btn btn-sm" data-release-task="${task.id}" style="flex:1;">Freigeben</button>
               <button type="button" class="btn btn-primary btn-sm" data-done-task="${task.id}" style="flex:1;">Erledigt</button>
             </div>`
          : ''
      }
    </div>`;
}

function renderDoneTask(task) {
  return `
    <div class="card stack" data-checklist-task="${task.id}">
      <div class="row-between">
        <strong>${escapeHtml(task.title)}</strong>
        <span class="badge badge-offline">Erledigt</span>
      </div>
      <div class="muted" style="font-size:var(--font-size-xs);">
        ${escapeHtml(task.assignee?.name ?? '?')} · ${formatDateTime(task.doneAt)}
      </div>
    </div>`;
}

function openRequestForm(ctx, myId) {
  const { close } = openModal(
    'Mitbring-Anfrage stellen',
    `
      <form id="checklist-request-form" class="stack">
        <input type="text" id="request-title" maxlength="80" required autofocus placeholder="z.B. Kann mir jemand einen Controller mitnehmen?" />
        <textarea id="request-description" rows="2" maxlength="300" placeholder="Details (optional)"></textarea>
        <button type="submit" class="btn btn-primary btn-block">Anfrage stellen</button>
      </form>
    `,
    {
      onMount: (el) => {
        el.querySelector('#checklist-request-form').addEventListener('submit', async (e) => {
          e.preventDefault();
          const title = el.querySelector('#request-title').value.trim();
          if (!title) return;
          const description = el.querySelector('#request-description').value.trim() || undefined;
          try {
            await api.checklist.createRequest(myId, title, description);
            close();
            tasksCache = null;
            showToast('Anfrage gestellt.');
            ctx.rerender();
          } catch (err) {
            showToast(err.message, { error: true });
          }
        });
      },
    },
  );
}

// state.players is the whole instance's roster, not the selected group's
// membership - in required multi-group mode that would let an organizer
// pick someone from a different group, and the create request 404s server-
// side (activeGroupPlayers only accepts the current group's active
// members). Group-scoped membership needs a real session, so this quietly
// falls back to the global roster wherever that's unavailable (legacy mode
// has no session at all, and there's only ever the one implicit group).
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

async function openTodoForm(ctx, myId) {
  const candidates = await assigneeCandidates();
  const playerOptions = candidates
    .filter((p) => p.id !== myId)
    .map(
      (p) => `
      <label class="row checklist-assignee-option" style="gap:var(--space-2);">
        <input type="checkbox" value="${p.id}" data-todo-assignee />
        ${avatarHtml(p, 20)}
        <span>${escapeHtml(p.name)}</span>
      </label>`,
    )
    .join('');

  const { close } = openModal(
    'Aufgabe verteilen',
    `
      <form id="checklist-todo-form" class="stack">
        <input type="text" id="todo-title" maxlength="80" required autofocus placeholder="z.B. Mehrfachsteckdosen mitbringen" />
        <textarea id="todo-description" rows="2" maxlength="300" placeholder="Details (optional)"></textarea>
        <div>
          <p class="field-label">Direkt zuweisen (optional)</p>
          <p class="muted" style="font-size:var(--font-size-xs);margin:0 0 var(--space-2);">
            Ohne Auswahl landet die Aufgabe offen im Pool, und alle können sie übernehmen.
          </p>
          <div class="stack" style="gap:var(--space-1);max-height:240px;overflow-y:auto;">${playerOptions}</div>
        </div>
        <button type="submit" class="btn btn-primary btn-block">Aufgabe anlegen</button>
      </form>
    `,
    {
      onMount: (el) => {
        el.querySelector('#checklist-todo-form').addEventListener('submit', async (e) => {
          e.preventDefault();
          const title = el.querySelector('#todo-title').value.trim();
          if (!title) return;
          const description = el.querySelector('#todo-description').value.trim() || undefined;
          const assigneePlayerIds = [...el.querySelectorAll('[data-todo-assignee]:checked')].map((c) => c.value);
          try {
            await api.checklist.createTodo(myId, title, description, assigneePlayerIds.length ? assigneePlayerIds : undefined);
            close();
            tasksCache = null;
            showToast('Aufgabe angelegt.');
            ctx.rerender();
          } catch (err) {
            showToast(err.message, { error: true });
          }
        });
      },
    },
  );
}

export function renderChecklist(container, ctx) {
  if (tasksCache === null && !loadingTasks) loadTasks(ctx);
  const myId = getMyId();
  if (myId && itemsCacheForId !== myId && !loadingItems) loadItems(ctx, myId);

  const prevItemLabel = container.querySelector('[data-add-item-form] [data-item-label]')?.value ?? '';
  const prevItemFocused = document.activeElement?.matches('[data-add-item-form] [data-item-label]');

  const tasks = tasksCache || [];
  const openTasks = tasks.filter((t) => t.status === 'open');
  const takenTasks = tasks.filter((t) => t.status === 'taken');
  const doneTasks = tasks.filter((t) => t.status === 'done');

  const openHtml =
    loadingTasks && tasksCache === null
      ? `<div class="empty-state">Lädt…</div>`
      : openTasks.length === 0
        ? `<div class="empty-state">Gerade nichts Offenes.</div>`
        : `<div class="two-column-card-grid">${openTasks.map((t) => renderOpenTask(t, myId)).join('')}</div>`;

  const takenHtml =
    takenTasks.length === 0
      ? ''
      : `<div class="two-column-card-grid">${takenTasks.map((t) => renderTakenTask(t, myId)).join('')}</div>`;

  container.innerHTML = `
    <button type="button" class="btn btn-sm" data-navigate="more">${icon('chevronLeft')} Zurück</button>
    <h1 class="view-title">Packliste</h1>
    ${whoAmICardHtml('checklist-whoami')}
    <div class="grouped-page-sections" style="margin-top:var(--space-3);">
      <section class="card stack grouped-page-section" aria-labelledby="checklist-items-title">
        <div class="grouped-page-section-title"><h2 id="checklist-items-title">Meine Packliste</h2></div>
        ${renderItems(myId)}
      </section>
      <section class="card stack grouped-page-section" aria-labelledby="checklist-tasks-title">
        <div class="row-between grouped-page-section-title">
          <h2 id="checklist-tasks-title">Aufgaben &amp; Anfragen</h2>
        </div>
        <div class="row" style="gap:var(--space-2);">
          <button type="button" class="btn btn-sm" id="checklist-new-request-btn" ${myId ? '' : 'disabled'} style="flex:1;">Anfrage stellen</button>
          <button type="button" class="btn btn-sm" id="checklist-new-todo-btn" ${myId ? '' : 'disabled'} style="flex:1;">Aufgabe verteilen</button>
        </div>
        <div class="section-title">Offen</div>
        ${openHtml}
        ${takenTasks.length ? `<div class="section-title">Unterwegs</div>${takenHtml}` : ''}
      </section>
      ${
        doneTasks.length
          ? `<details class="card grouped-page-section collapsible-section" data-checklist-history ${historyOpen ? 'open' : ''}>
               <summary class="collapsible-section-header">
                 <h2>Historie</h2>
                 <span class="collapsible-section-summary-end">
                   <span class="badge badge-offline">${doneTasks.length}</span>
                   <span class="collapsible-section-chevron">${icon('chevronRight')}</span>
                 </span>
               </summary>
               <div class="collapsible-section-content">
                 <div class="two-column-card-grid">${doneTasks.map(renderDoneTask).join('')}</div>
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

  wireWhoAmICard(container, 'checklist-whoami', ctx);

  container.querySelector('[data-checklist-history]')?.addEventListener('toggle', (event) => {
    historyOpen = event.currentTarget.open;
  });

  container.querySelector('#checklist-new-request-btn')?.addEventListener('click', () => {
    if (!myId) return showToast('Bitte zuerst auswählen, wer du bist.', { error: true });
    openRequestForm(ctx, myId);
  });
  container.querySelector('#checklist-new-todo-btn')?.addEventListener('click', () => {
    if (!myId) return showToast('Bitte zuerst auswählen, wer du bist.', { error: true });
    openTodoForm(ctx, myId);
  });

  container.querySelector('[data-add-item-form]')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const input = e.currentTarget.querySelector('[data-item-label]');
    const label = input.value.trim();
    if (!label) return;
    try {
      await api.checklist.addItem(myId, label);
      invalidateItems();
      ctx.rerender();
    } catch (err) {
      showToast(err.message, { error: true });
    }
  });

  container.querySelectorAll('[data-toggle-item]').forEach((checkbox) => {
    checkbox.addEventListener('change', async (e) => {
      const checked = e.currentTarget.checked;
      try {
        await api.checklist.setItemChecked(checkbox.dataset.toggleItem, myId, checked);
        invalidateItems();
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
        invalidateItems();
        ctx.rerender();
      } catch (err) {
        showToast(err.message, { error: true });
      }
    });
  });

  container.querySelectorAll('[data-claim-task]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      try {
        await api.checklist.claim(btn.dataset.claimTask, myId);
        tasksCache = null;
        showToast('Übernommen.');
        ctx.rerender();
      } catch (err) {
        showToast(err.message, { error: true });
      }
    });
  });

  container.querySelectorAll('[data-release-task]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      try {
        await api.checklist.release(btn.dataset.releaseTask, myId);
        tasksCache = null;
        ctx.rerender();
      } catch (err) {
        showToast(err.message, { error: true });
      }
    });
  });

  container.querySelectorAll('[data-done-task]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      try {
        await api.checklist.setDone(btn.dataset.doneTask, myId);
        tasksCache = null;
        showToast('Als erledigt markiert.');
        ctx.rerender();
      } catch (err) {
        showToast(err.message, { error: true });
      }
    });
  });

  container.querySelectorAll('[data-cancel-task]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      if (!(await confirmDialog('Zurückziehen? Die Aufgabe/Anfrage verschwindet aus dem Pool.'))) return;
      try {
        await api.checklist.cancel(btn.dataset.cancelTask, myId);
        tasksCache = null;
        ctx.rerender();
      } catch (err) {
        showToast(err.message, { error: true });
      }
    });
  });
}
