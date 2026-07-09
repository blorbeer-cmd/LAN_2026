import { api } from '../api.js';
import { escapeHtml, avatarHtml } from '../format.js';
import { openModal } from '../modal.js';
import { showToast } from '../toast.js';
import { getMyId, whoAmICardHtml, wireWhoAmICard } from '../whoami.js';

let cache = null;
let loading = false;
let sortMode = 'interest';
let onlyOpenUploads = false;

const RATE_WEIGHT = { hoch: 3, mittel: 2, niedrig: 1 };
const RATE_LABEL = { hoch: 'hoch', mittel: 'mittel', niedrig: 'niedrig' };

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

function moneyLabel(cents) {
  if (cents === null || cents === undefined) return '';
  return `${(cents / 100).toLocaleString('de-DE', { style: 'currency', currency: 'EUR' })}`;
}

function sortedItems() {
  const items = [...(cache?.items ?? [])].filter((item) => !onlyOpenUploads || !item.uploadDone);
  items.sort((a, b) => {
    if (sortMode === 'az') return a.title.localeCompare(b.title, 'de');
    if (sortMode === 'rate') {
      const rateDiff = (RATE_WEIGHT[b.playRate] ?? 0) - (RATE_WEIGHT[a.playRate] ?? 0);
      return rateDiff || a.title.localeCompare(b.title, 'de');
    }
    const interestDiff = b.interestCount - a.interestCount;
    return interestDiff || a.title.localeCompare(b.title, 'de');
  });
  return items;
}

function rateChip(rate) {
  if (!rate) return `<span class="chip">Rate offen</span>`;
  const color = rate === 'hoch' ? '#1f8f4a' : rate === 'mittel' ? '#a36b00' : '#777';
  return `<span class="chip" style="border-color:${color};color:${color};">Rate ${escapeHtml(RATE_LABEL[rate])}</span>`;
}

function interestedHtml(item) {
  if (!item.interestedPlayers.length) return `<span class="muted" style="font-size:0.78rem;">Noch niemand</span>`;
  return item.interestedPlayers
    .slice(0, 6)
    .map((p) => `<span class="chip">${avatarHtml(p, 18)} ${escapeHtml(p.name)}</span>`)
    .join('');
}

function itemCard(item) {
  const myId = getMyId();
  const mine = myId && item.interestedPlayerIds.includes(myId);
  const trailer = item.trailerUrl
    ? `<a class="btn btn-sm" href="${escapeHtml(item.trailerUrl)}" target="_blank" rel="noopener">Trailer</a>`
    : '';
  const price = moneyLabel(item.priceCents);
  return `
    <div class="card stack" style="gap:10px;">
      <div class="row-between" style="align-items:flex-start;gap:12px;">
        <div style="min-width:0;">
          <div class="player-name" style="font-size:1rem;">${escapeHtml(item.title)}</div>
          <div class="muted" style="font-size:0.8rem;">${escapeHtml(item.platform || 'Plattform offen')}${price ? ` · ${escapeHtml(price)}` : ''}</div>
        </div>
        <span class="badge ${item.uploadDone ? 'badge-playing' : 'badge-paused'}">${item.uploadDone ? 'Upload fertig' : 'Upload offen'}</span>
      </div>
      <div class="row" style="gap:8px;flex-wrap:wrap;">
        ${rateChip(item.playRate)}
        <span class="chip">🔥 ${item.interestCount}</span>
        ${trailer}
      </div>
      <div class="chip-list">${interestedHtml(item)}</div>
      <div class="row" style="gap:8px;flex-wrap:wrap;">
        <button type="button" class="btn btn-sm ${mine ? 'btn-primary' : ''}" data-interest="${item.id}">${mine ? 'Bock entfernt?' : 'Bock'}</button>
        <button type="button" class="btn btn-sm" data-upload="${item.id}" data-upload-next="${item.uploadDone ? 'false' : 'true'}">${item.uploadDone ? 'Upload öffnen' : 'Upload fertig'}</button>
        <button type="button" class="btn btn-sm" data-edit="${item.id}">Bearbeiten</button>
        <button type="button" class="btn btn-sm btn-danger" data-delete="${item.id}">Löschen</button>
      </div>
    </div>`;
}

function openCatalogForm(ctx, item = null) {
  const priceValue = item?.priceCents != null ? (item.priceCents / 100).toFixed(2) : '';
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
          <input type="text" id="catalog-platform" maxlength="80" value="${escapeHtml(item?.platform ?? '')}" placeholder="Steam, Gamepass, NAS…" />
        </div>
        <div class="row" style="align-items:flex-start;">
          <div style="flex:1;">
            <label class="field-label" for="catalog-rate">Spielrate</label>
            <select id="catalog-rate">
              <option value="" ${!item?.playRate ? 'selected' : ''}>offen</option>
              <option value="niedrig" ${item?.playRate === 'niedrig' ? 'selected' : ''}>niedrig</option>
              <option value="mittel" ${item?.playRate === 'mittel' ? 'selected' : ''}>mittel</option>
              <option value="hoch" ${item?.playRate === 'hoch' ? 'selected' : ''}>hoch</option>
            </select>
          </div>
          <div style="flex:1;">
            <label class="field-label" for="catalog-price">Preis</label>
            <input type="number" id="catalog-price" min="0" step="0.01" value="${escapeHtml(priceValue)}" placeholder="0,00" />
          </div>
        </div>
        <div>
          <label class="field-label" for="catalog-trailer">Trailer-Link</label>
          <input type="url" id="catalog-trailer" maxlength="500" value="${escapeHtml(item?.trailerUrl ?? '')}" placeholder="https://…" />
        </div>
        <label class="check-row">
          <input type="checkbox" id="catalog-upload" ${item?.uploadDone ? 'checked' : ''} />
          <span>Upload auf NAS / Bereitstellung fertig</span>
        </label>
        <button type="submit" class="btn btn-primary btn-block">${item ? 'Speichern' : 'Eintragen'}</button>
      </form>
    `,
    {
      onMount: (modalEl) => {
        modalEl.querySelector('#catalog-form').addEventListener('submit', async (e) => {
          e.preventDefault();
          const priceRaw = modalEl.querySelector('#catalog-price').value;
          const payload = {
            title: modalEl.querySelector('#catalog-title').value.trim(),
            platform: modalEl.querySelector('#catalog-platform').value.trim() || null,
            playRate: modalEl.querySelector('#catalog-rate').value || null,
            priceCents: priceRaw ? Math.round(Number(priceRaw.replace(',', '.')) * 100) : null,
            trailerUrl: modalEl.querySelector('#catalog-trailer').value.trim() || null,
            uploadDone: modalEl.querySelector('#catalog-upload').checked,
          };
          if (!item) payload.playerId = getMyId() || null;
          try {
            cache = item ? await api.gameCatalog.update(item.id, payload) : await api.gameCatalog.create(payload);
            close();
            ctx.rerender();
            showToast(item ? 'Spiel aktualisiert.' : 'Spiel eingetragen.');
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
  const items = sortedItems();

  container.innerHTML = `
    <h1 class="view-title">Spiele-Liste</h1>
    ${whoAmICardHtml('whoami')}
    <div class="row-between" style="margin-top:12px;gap:10px;align-items:center;">
      <div class="row" style="gap:8px;flex-wrap:wrap;">
        <select id="catalog-sort" aria-label="Sortierung">
          <option value="interest" ${sortMode === 'interest' ? 'selected' : ''}>Bock</option>
          <option value="rate" ${sortMode === 'rate' ? 'selected' : ''}>Spielrate</option>
          <option value="az" ${sortMode === 'az' ? 'selected' : ''}>A-Z</option>
        </select>
        <label class="check-row" style="padding:8px 10px;">
          <input type="checkbox" id="catalog-open-only" ${onlyOpenUploads ? 'checked' : ''} />
          <span>Upload offen</span>
        </label>
      </div>
      <button type="button" class="btn btn-primary btn-sm" id="catalog-new">+ Spiel</button>
    </div>
    ${
      loading && !cache
        ? `<div class="empty-state" style="margin-top:12px;">Lädt…</div>`
        : items.length === 0
          ? `<div class="empty-state" style="margin-top:12px;"><span class="emoji">🎲</span>Keine Spiele gefunden.</div>`
          : `<div class="card-grid" style="margin-top:12px;">${items.map(itemCard).join('')}</div>`
    }
  `;

  wireWhoAmICard(container, 'whoami', ctx);

  container.querySelector('#catalog-sort')?.addEventListener('change', (e) => {
    sortMode = e.target.value;
    ctx.rerender();
  });
  container.querySelector('#catalog-open-only')?.addEventListener('change', (e) => {
    onlyOpenUploads = e.target.checked;
    ctx.rerender();
  });
  container.querySelector('#catalog-new')?.addEventListener('click', () => openCatalogForm(ctx));

  container.querySelectorAll('[data-interest]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const playerId = getMyId();
      if (!playerId) return showToast('Bitte zuerst auswählen, wer du bist.', { error: true });
      try {
        cache = await api.gameCatalog.toggleInterest(btn.dataset.interest, playerId);
        ctx.rerender();
      } catch (err) {
        showToast(err.message, { error: true });
      }
    });
  });

  container.querySelectorAll('[data-upload]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      try {
        cache = await api.gameCatalog.update(btn.dataset.upload, { uploadDone: btn.dataset.uploadNext === 'true' });
        ctx.rerender();
        showToast('Upload-Status aktualisiert.');
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
}
