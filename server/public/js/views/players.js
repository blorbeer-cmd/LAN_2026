// Players view (FR-05..08, FR-15): roster management + per-game skill
// ratings. Tapping a player opens their detail sheet (rename, recolor, copy
// their agent API key, adjust skills, delete).

import { api } from '../api.js';
import { state, playerById } from '../state.js';
import { escapeHtml, avatarHtml } from '../format.js';
import { openModal } from '../modal.js';
import { showToast } from '../toast.js';

const PALETTE = ['#5b8cff', '#22c55e', '#f59e0b', '#ef4444', '#a855f7', '#06b6d4', '#ec4899', '#84cc16'];

function randomColor() {
  return PALETTE[Math.floor(Math.random() * PALETTE.length)];
}

function ratingFor(playerId, gameId) {
  const entry = state.skills.find((s) => s.player_id === playerId && s.game_id === gameId);
  return entry ? entry.rating : 5;
}

export function renderPlayers(container, ctx) {
  const rows = state.players
    .map(
      (p) => `
      <button type="button" class="card row" style="width:100%;text-align:left;cursor:pointer;" data-player="${p.id}">
        ${avatarHtml(p, 28)}
        <span class="player-name" style="flex:1;">${escapeHtml(p.name)}</span>
        <span class="muted">›</span>
      </button>`
    )
    .join('');

  container.innerHTML = `
    <div class="row-between">
      <h1 class="view-title">Spieler</h1>
      <button type="button" class="btn btn-primary btn-sm" id="add-player-btn">+ Spieler</button>
    </div>
    ${
      state.players.length === 0
        ? `<div class="empty-state"><span class="emoji">🧑‍🤝‍🧑</span>Noch keine Spieler.<br />Leg den ersten an.</div>`
        : `<div class="stack">${rows}</div>`
    }
  `;

  container.querySelector('#add-player-btn').addEventListener('click', () => openAddPlayerModal(ctx));
  container.querySelectorAll('[data-player]').forEach((btn) => {
    btn.addEventListener('click', () => openPlayerDetail(btn.dataset.player, ctx));
  });
}

function openAddPlayerModal(ctx) {
  const color = randomColor();
  const { close } = openModal(
    'Spieler hinzufügen',
    `
      <form id="add-player-form" class="stack">
        <div class="row">
          <input type="color" id="new-player-color" value="${color}" />
          <input type="text" id="new-player-name" placeholder="Name" maxlength="60" autofocus required style="flex:1;" />
        </div>
        <button type="submit" class="btn btn-primary btn-block">Anlegen</button>
      </form>
    `,
    {
      onMount: (el) => {
        el.querySelector('#add-player-form').addEventListener('submit', async (e) => {
          e.preventDefault();
          const name = el.querySelector('#new-player-name').value.trim();
          const playerColor = el.querySelector('#new-player-color').value;
          if (!name) return;
          try {
            await api.players.create({ name, color: playerColor });
            close();
            await ctx.refresh();
            showToast(`${name} wurde hinzugefügt.`);
          } catch (err) {
            showToast(err.message, { error: true });
          }
        });
      },
    }
  );
}

function openPlayerDetail(playerId, ctx) {
  const player = playerById(playerId);
  if (!player) return;

  const skillRows = state.games
    .map((g) => {
      const rating = ratingFor(playerId, g.id);
      return `
        <div class="skill-row" data-game="${g.id}">
          <span>${escapeHtml(g.icon)} ${escapeHtml(g.name)}</span>
          <span class="skill-value">${rating}</span>
          <input type="range" class="skill-row-slider" min="1" max="10" step="1" value="${rating}" />
        </div>`;
    })
    .join('');

  const { close } = openModal(
    escapeHtml(player.name),
    `
      <div class="stack">
        <div class="row">
          <input type="color" id="detail-color" value="${player.color}" />
          <input type="text" id="detail-name" value="${escapeHtml(player.name)}" maxlength="60" style="flex:1;" />
        </div>
        <button type="button" class="btn btn-primary" id="detail-save">Speichern</button>

        <div class="section-title">Agent-API-Key</div>
        <div class="row">
          <input type="text" id="detail-apikey" readonly value="Laden…" style="flex:1;font-family:monospace;" />
          <button type="button" class="btn btn-sm" id="detail-copy-key">Kopieren</button>
        </div>
        <p class="muted" style="font-size:0.8rem;">Diesen Key in die Config des Agenten auf dem PC des Spielers eintragen.</p>

        ${state.games.length > 0 ? `<div class="section-title">Skill-Ratings</div>${skillRows}` : ''}

        <button type="button" class="btn btn-danger btn-block" id="detail-delete">Spieler löschen</button>
      </div>
    `,
    {
      onMount: async (el) => {
        // Fetch the API key lazily (list view intentionally omits it).
        try {
          const full = await api.players.get(playerId);
          el.querySelector('#detail-apikey').value = full.api_key;
        } catch {
          el.querySelector('#detail-apikey').value = 'Fehler beim Laden';
        }

        el.querySelector('#detail-copy-key').addEventListener('click', async () => {
          const value = el.querySelector('#detail-apikey').value;
          try {
            await navigator.clipboard.writeText(value);
            showToast('API-Key kopiert.');
          } catch {
            showToast('Kopieren nicht möglich – bitte manuell markieren.', { error: true });
          }
        });

        el.querySelector('#detail-save').addEventListener('click', async () => {
          const name = el.querySelector('#detail-name').value.trim();
          const color = el.querySelector('#detail-color').value;
          if (!name) return showToast('Name darf nicht leer sein.', { error: true });
          try {
            await api.players.update(playerId, { name, color });
            close();
            await ctx.refresh();
            showToast('Gespeichert.');
          } catch (err) {
            showToast(err.message, { error: true });
          }
        });

        el.querySelectorAll('.skill-row').forEach((row) => {
          const gameId = row.dataset.game;
          const slider = row.querySelector('input[type="range"]');
          const valueEl = row.querySelector('.skill-value');
          let debounceTimer = null;
          slider.addEventListener('input', () => {
            valueEl.textContent = slider.value;
            clearTimeout(debounceTimer);
            debounceTimer = setTimeout(async () => {
              try {
                await api.skills.set(playerId, gameId, parseInt(slider.value, 10));
                await ctx.refresh();
              } catch (err) {
                showToast(err.message, { error: true });
              }
            }, 250);
          });
        });

        el.querySelector('#detail-delete').addEventListener('click', async () => {
          if (!confirm(`${player.name} wirklich löschen?`)) return;
          try {
            await api.players.remove(playerId);
            close();
            await ctx.refresh();
            showToast('Spieler gelöscht.');
          } catch (err) {
            showToast(err.message, { error: true });
          }
        });
      },
    }
  );
}
