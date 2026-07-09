import { api } from '../api.js';
import { escapeHtml } from '../format.js';
import { openModal } from '../modal.js';
import { showToast } from '../toast.js';
import { getMyId, whoAmICardHtml, wireWhoAmICard } from '../whoami.js';

let cache = null;
let loading = false;
let activeTab = 'catalog';
let sortKey = 'title';
let sortDir = 'asc';

export function invalidateGameCatalog() {
  cache = null;
}

async function load(ctx) {
  if (loading) return;
  loading = true;
  try {
    cache = await api.gameCatalog.list();
  } catch (err) {
    showToast(err.message, { error: true });
    cache = { items: [] };
  } finally {
    loading = false;
    ctx.rerender();
  }
}

function sortValue(item, key) {
  if (key === 'rating') return item.ratingAverage ?? 0;
  if (key === 'platform') return item.platform ?? '';
  return item.title ?? '';
}

function sortedItems(items) {
  return [...items].sort((a, b) => {
    const av = sortValue(a, sortKey);
    const bv = sortValue(b, sortKey);
    const diff = typeof av === 'number' && typeof bv === 'number' ? av - bv : String(av).localeCompare(String(bv), 'de');
    return sortDir === 'asc' ? diff : -diff;
  });
}

function sortButton(key, label) {
  const mark = sortKey === key ? (sortDir === 'asc' ? ' ↑' : ' ↓') : '';
  return `<button type="button" class="btn btn-sm catalog-sort-btn" data-sort="${key}">${label}${mark}</button>`;
}

function linkButton(url, label) {
  if (!url) return `<span class="muted">-</span>`;
  return `<a class="catalog-text-link" href="${escapeHtml(url)}" target="_blank" rel="noopener">${label}</a>`;
}

function platformHtml(item) {
  return item.platformUrl ? linkButton(item.platformUrl, item.platform || 'Plattform') : `<span>${escapeHtml(item.platform || '-')}</span>`;
}

function trailerHtml(item) {
  return item.trailerUrl ? linkButton(item.trailerUrl, 'YouTube') : `<span class="muted">offen</span>`;
}

function ratingHtml(item) {
  const avg = item.ratingAverage === null ? '-' : item.ratingAverage.toFixed(1);
  return `
    <div class="catalog-rating-line">
      ${ratingButtons(item)}
      <span class="muted catalog-rating-meta">Ø ${avg} · ${item.ratingCount}</span>
    </div>`;
}

function catalogRows() {
  const rows = sortedItems((cache?.items ?? []).filter((item) => !item.isSuggestion));
  if (rows.length === 0) return `<tr><td colspan="5" class="muted">Keine Spiele im Katalog.</td></tr>`;
  return rows
    .map((item) => {
      return `
        <tr>
          <td class="catalog-title-cell"><strong>${escapeHtml(item.title)}</strong></td>
          <td>${platformHtml(item)}</td>
          <td>${trailerHtml(item)}</td>
          <td class="catalog-rating-cell">${ratingHtml(item)}</td>
          <td class="catalog-actions">
            <button type="button" class="btn btn-sm" data-edit="${item.id}">Bearbeiten</button>
          </td>
        </tr>`;
    })
    .join('');
}

function ratingButtons(item) {
  const myId = getMyId();
  const mine = item.ratings.find((r) => r.id === myId)?.rating ?? 0;
  return `
    <div class="catalog-rating-bar" aria-label="Bock von 1 bis 5">
      ${[1, 2, 3, 4, 5]
        .map(
          (rating) =>
            `<button type="button" class="${mine >= rating ? 'is-active' : ''}" data-rate="${item.id}" data-rating="${rating}" data-level="${rating}" title="Bock ${rating}/5">${rating}</button>`
        )
        .join('')}
    </div>`;
}

function suggestionRows() {
  const rows = sortedItems((cache?.items ?? []).filter((item) => item.isSuggestion));
  if (rows.length === 0) return `<tr><td colspan="5" class="muted">Noch keine vorgeschlagenen Spiele.</td></tr>`;
  return rows
    .map((item) => {
      return `
        <tr>
          <td class="catalog-title-cell">
            <strong>${escapeHtml(item.title)}</strong>
          </td>
          <td>${platformHtml(item)}</td>
          <td>${trailerHtml(item)}</td>
          <td class="catalog-rating-cell">${ratingHtml(item)}</td>
          <td class="catalog-actions">
            <button type="button" class="btn btn-sm btn-primary" data-promote="${item.id}">In Katalog</button>
            <button type="button" class="btn btn-sm" data-edit="${item.id}">Bearbeiten</button>
            <button type="button" class="btn btn-sm btn-danger" data-delete="${item.id}">Löschen</button>
          </td>
        </tr>`;
    })
    .join('');
}

function openCatalogForm(ctx, item = null) {
  const { close } = openModal(
    item ? 'Spiel bearbeiten' : 'Spiel vorschlagen',
    `
      <form id="catalog-form" class="stack">
        <div>
          <label class="field-label" for="catalog-title">Titel</label>
          <input type="text" id="catalog-title" maxlength="80" required value="${escapeHtml(item?.title ?? '')}" />
        </div>
        <div>
          <label class="field-label" for="catalog-platform">Plattform</label>
          <input type="text" id="catalog-platform" maxlength="80" value="${escapeHtml(item?.platform ?? '')}" placeholder="Steam, Epic, Battle.net…" />
        </div>
        <div>
          <label class="field-label" for="catalog-platform-url">Plattform-Link</label>
          <input type="url" id="catalog-platform-url" maxlength="500" value="${escapeHtml(item?.platformUrl ?? '')}" placeholder="https://…" />
        </div>
        <div>
          <label class="field-label" for="catalog-trailer">Gameplay-Trailer</label>
          <input type="url" id="catalog-trailer" maxlength="500" value="${escapeHtml(item?.trailerUrl ?? '')}" placeholder="https://…" />
        </div>
        <button type="submit" class="btn btn-primary btn-block">${item ? 'Speichern' : 'Vorschlagen'}</button>
      </form>
    `,
    {
      onMount: (modalEl) => {
        modalEl.querySelector('#catalog-form').addEventListener('submit', async (e) => {
          e.preventDefault();
          const payload = {
            title: modalEl.querySelector('#catalog-title').value.trim(),
            platform: modalEl.querySelector('#catalog-platform').value.trim() || null,
            platformUrl: modalEl.querySelector('#catalog-platform-url').value.trim() || null,
            trailerUrl: modalEl.querySelector('#catalog-trailer').value.trim() || null,
          };
          if (!item) payload.playerId = getMyId() || null;
          try {
            cache = item ? await api.gameCatalog.update(item.id, payload) : await api.gameCatalog.create(payload);
            close();
            ctx.rerender();
            showToast(item ? 'Spiel aktualisiert.' : 'Vorschlag eingetragen.');
          } catch (err) {
            showToast(err.message, { error: true });
          }
        });
      },
    }
  );
}

export function renderGameCatalog(container, ctx) {
  if (!cache && !loading) load(ctx);

  container.innerHTML = `
    <h1 class="view-title">Spiele-Liste</h1>
    ${whoAmICardHtml('whoami')}
    <div class="row-between" style="margin-top:12px;gap:10px;align-items:center;">
      <div class="tabs" style="display:flex;gap:8px;flex-wrap:wrap;">
        <button type="button" class="btn btn-sm ${activeTab === 'catalog' ? 'btn-primary' : ''}" data-tab="catalog">Katalog</button>
        <button type="button" class="btn btn-sm ${activeTab === 'suggestions' ? 'btn-primary' : ''}" data-tab="suggestions">Vorschläge</button>
      </div>
      <div class="row" style="gap:8px;flex-wrap:wrap;justify-content:flex-end;">
        <button type="button" class="btn btn-primary btn-sm" id="catalog-new">+ Vorschlag</button>
      </div>
    </div>
    <div class="card stack catalog-card" style="margin-top:12px;gap:10px;">
      <div class="row" style="gap:8px;flex-wrap:wrap;">
        ${sortButton('title', 'Name')}
        ${sortButton('rating', 'Bock')}
        ${sortButton('platform', 'Plattform')}
      </div>
      ${
        loading && !cache
          ? `<div class="empty-state">Lädt…</div>`
          : `
            <div class="catalog-table-wrap">
              <table class="catalog-table" style="min-width:${activeTab === 'catalog' ? '820px' : '940px'};">
                <thead>
                  <tr><th>Name</th><th>Plattform</th><th>YouTube</th><th>Bock</th><th></th></tr>
                </thead>
                <tbody>${activeTab === 'catalog' ? catalogRows() : suggestionRows()}</tbody>
              </table>
            </div>`
      }
    </div>
  `;

  wireWhoAmICard(container, 'whoami', ctx);

  container.querySelectorAll('[data-tab]').forEach((btn) => {
    btn.addEventListener('click', () => {
      activeTab = btn.dataset.tab;
      sortKey = activeTab === 'catalog' ? 'title' : 'rating';
      sortDir = activeTab === 'catalog' ? 'asc' : 'desc';
      ctx.rerender();
    });
  });

  container.querySelectorAll('[data-sort]').forEach((btn) => {
    btn.addEventListener('click', () => {
      if (sortKey === btn.dataset.sort) {
        sortDir = sortDir === 'asc' ? 'desc' : 'asc';
      } else {
        sortKey = btn.dataset.sort;
        sortDir = sortKey === 'rating' ? 'desc' : 'asc';
      }
      ctx.rerender();
    });
  });

  container.querySelector('#catalog-new')?.addEventListener('click', () => openCatalogForm(ctx));

  container.querySelectorAll('[data-rate]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const playerId = getMyId();
      if (!playerId) return showToast('Bitte zuerst auswählen, wer du bist.', { error: true });
      try {
        cache = await api.gameCatalog.rate(btn.dataset.rate, playerId, Number(btn.dataset.rating));
        ctx.rerender();
      } catch (err) {
        showToast(err.message, { error: true });
      }
    });
  });

  container.querySelectorAll('[data-edit]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const item = cache.items.find((i) => i.id === btn.dataset.edit);
      if (item) openCatalogForm(ctx, item);
    });
  });

  container.querySelectorAll('[data-delete]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const item = cache.items.find((i) => i.id === btn.dataset.delete);
      if (!item || !confirm(`"${item.title}" wirklich löschen?`)) return;
      try {
        await api.gameCatalog.remove(item.id);
        cache = await api.gameCatalog.list();
        ctx.rerender();
        showToast('Spiel gelöscht.');
      } catch (err) {
        showToast(err.message, { error: true });
      }
    });
  });

  container.querySelectorAll('[data-promote]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const item = cache.items.find((i) => i.id === btn.dataset.promote);
      if (!item || !confirm(`"${item.title}" in den normalen Katalog übernehmen?`)) return;
      try {
        cache = await api.gameCatalog.promote(item.id);
        activeTab = 'catalog';
        sortKey = 'title';
        sortDir = 'asc';
        ctx.rerender();
        showToast('Spiel in den Katalog übernommen.');
      } catch (err) {
        showToast(err.message, { error: true });
      }
    });
  });
}
