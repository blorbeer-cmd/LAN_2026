// Settings view (FR-07, FR-10, FR-30): event management, the invite link,
// and the game catalog + process-name mappings the agent uses to recognize
// what's running. Reached via the ⚙️ icon, not the main bottom nav — this is
// setup work, not something people touch during actual play.

import { api, getToken } from '../api.js';
import { state, gameById } from '../state.js';
import { escapeHtml, gameBadgeHtml } from '../format.js';
import { openModal } from '../modal.js';
import { showToast } from '../toast.js';

function renderInviteSection() {
  const token = getToken();
  const url = token ? `${location.origin}/?token=${encodeURIComponent(token)}` : location.origin;
  return `
    <div class="section-title">🔗 Einladungslink</div>
    <div class="card stack">
      <div class="row">
        <input type="text" id="invite-link" readonly value="${escapeHtml(url)}" style="flex:1;font-family:monospace;font-size:0.8rem;" />
        <button type="button" class="btn btn-sm" id="invite-copy">Kopieren</button>
      </div>
      <button type="button" class="btn btn-sm" id="invite-qr-toggle">📱 QR-Code anzeigen</button>
      <div id="invite-qr" style="text-align:center;" hidden></div>
      <p class="muted" style="font-size:0.8rem;">
        Diesen Link verschicken (oder den QR-Code zeigen/aushängen) – öffnet die Seite direkt
        eingeloggt und führt neue Leute direkt zur Profil-Erstellung. Name, Bild, Skills und der
        eigene Agent-Key richten sich alle selbst ein.
      </p>
    </div>
  `;
}

function renderEventSection() {
  const active = state.events?.find((e) => e.isActive);
  const past = (state.events || []).filter((e) => !e.isActive);
  const pastRows = past
    .map(
      (e) => `
      <div class="lb-row">
        <span style="flex:1;">${escapeHtml(e.name)}</span>
        <span class="muted" style="font-size:0.78rem;">${new Date(e.starts_at).toLocaleDateString('de-DE')} – ${e.ends_at ? new Date(e.ends_at).toLocaleDateString('de-DE') : '?'}</span>
      </div>`
    )
    .join('');

  return `
    <div class="section-title">🎪 Event</div>
    <div class="card stack">
      <div class="row-between">
        <span>Aktuell: <strong>${escapeHtml(active ? active.name : '–')}</strong></span>
        <button type="button" class="btn btn-sm" id="new-event-btn">Neues Event starten</button>
      </div>
      ${past.length > 0 ? `<div class="muted" style="font-size:0.78rem;margin-top:4px;">Vergangene Events</div>${pastRows}` : ''}
    </div>
  `;
}

export function renderGames(container, ctx) {
  const rows = state.games
    .map(
      (g) => `
      <button type="button" class="card row" style="width:100%;text-align:left;cursor:pointer;" data-game="${g.id}">
        ${gameBadgeHtml(g, 40)}
        <span style="flex:1;">
          <div class="player-name">${escapeHtml(g.name)}</div>
          <div class="muted" style="font-size:0.8rem;">Team: ${g.min_team_size}-${g.max_team_size} · ${g.processNames.length} Prozess(e)</div>
        </span>
        <span class="muted">›</span>
      </button>`
    )
    .join('');

  container.innerHTML = `
    <h1 class="view-title">Einstellungen</h1>
    ${renderEventSection()}
    ${renderInviteSection()}
    <div class="row-between">
      <div class="section-title" style="margin:0;">🎮 Spiele verwalten</div>
      <button type="button" class="btn btn-primary btn-sm" id="add-game-btn">+ Spiel</button>
    </div>
    ${
      state.games.length === 0
        ? `<div class="empty-state"><span class="emoji">🎮</span>Noch keine Spiele.</div>`
        : `<div class="stack">${rows}</div>`
    }
  `;

  container.querySelector('#invite-copy').addEventListener('click', async () => {
    const value = container.querySelector('#invite-link').value;
    try {
      await navigator.clipboard.writeText(value);
      showToast('Einladungslink kopiert.');
    } catch {
      showToast('Kopieren nicht möglich – bitte manuell markieren.', { error: true });
    }
  });

  container.querySelector('#invite-qr-toggle').addEventListener('click', async (e) => {
    const qrEl = container.querySelector('#invite-qr');
    if (!qrEl.hidden) {
      qrEl.hidden = true;
      e.target.textContent = '📱 QR-Code anzeigen';
      return;
    }
    e.target.textContent = '📱 QR-Code ausblenden';
    qrEl.hidden = false;
    if (!qrEl.dataset.loaded) {
      const url = container.querySelector('#invite-link').value;
      try {
        // Rendered server-side and injected as trusted markup (our own
        // /api/qrcode response, not user input) so it displays inline
        // without a network round trip to a third-party QR service that
        // would otherwise see the access token embedded in the link.
        qrEl.innerHTML = await api.qrcode.svg(url);
        qrEl.dataset.loaded = '1';
      } catch (err) {
        qrEl.textContent = 'QR-Code konnte nicht geladen werden.';
        showToast(err.message, { error: true });
      }
    }
  });

  container.querySelector('#new-event-btn').addEventListener('click', async () => {
    const name = prompt('Name für das neue Event (z.B. "LAN Winter 2027"):');
    if (!name || !name.trim()) return;
    if (!confirm(`Neues Event "${name.trim()}" starten? Das aktuelle Event wird beendet und der Live-Status zurückgesetzt.`)) {
      return;
    }
    try {
      await api.events.create(name.trim());
      await ctx.refresh();
      showToast('Neues Event gestartet.');
    } catch (err) {
      showToast(err.message, { error: true });
    }
  });

  container.querySelector('#add-game-btn').addEventListener('click', () => openGameForm(ctx));
  container.querySelectorAll('[data-game]').forEach((btn) => {
    btn.addEventListener('click', () => openGameDetail(btn.dataset.game, ctx));
  });
}

function openGameForm(ctx) {
  const { close } = openModal(
    'Spiel hinzufügen',
    `
      <form id="add-game-form" class="stack">
        <input type="text" id="new-game-icon" placeholder="Icon (Emoji)" maxlength="8" value="🎮" />
        <input type="text" id="new-game-name" placeholder="Name" maxlength="60" required autofocus />
        <div class="row">
          <input type="number" id="new-game-min" placeholder="Min. Teamgröße" min="1" max="20" value="1" style="flex:1;" />
          <input type="number" id="new-game-max" placeholder="Max. Teamgröße" min="1" max="20" value="5" style="flex:1;" />
        </div>
        <button type="submit" class="btn btn-primary btn-block">Anlegen</button>
      </form>
    `,
    {
      onMount: (el) => {
        el.querySelector('#add-game-form').addEventListener('submit', async (e) => {
          e.preventDefault();
          const name = el.querySelector('#new-game-name').value.trim();
          const icon = el.querySelector('#new-game-icon').value.trim() || '🎮';
          const minTeamSize = parseInt(el.querySelector('#new-game-min').value, 10) || 1;
          const maxTeamSize = parseInt(el.querySelector('#new-game-max').value, 10) || 5;
          if (!name) return;
          try {
            await api.games.create({ name, icon, minTeamSize, maxTeamSize });
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

function openGameDetail(gameId, ctx) {
  const game = gameById(gameId);
  if (!game) return;

  const processChips = game.processNames
    .map(
      (pn) => `
      <span class="chip">${escapeHtml(pn)} <button type="button" class="icon-btn" data-remove-proc="${escapeHtml(pn)}" aria-label="Entfernen" style="font-size:0.8rem;padding:0 2px;">✕</button></span>`
    )
    .join('');

  const { close } = openModal(
    escapeHtml(game.name),
    `
      <div class="stack">
        <div class="row">
          <input type="text" id="edit-icon" value="${escapeHtml(game.icon)}" maxlength="8" style="width:70px;" />
          <input type="text" id="edit-name" value="${escapeHtml(game.name)}" maxlength="60" style="flex:1;" />
        </div>
        <div class="row">
          <input type="number" id="edit-min" min="1" max="20" value="${game.min_team_size}" placeholder="Min. Team" style="flex:1;" />
          <input type="number" id="edit-max" min="1" max="20" value="${game.max_team_size}" placeholder="Max. Team" style="flex:1;" />
        </div>
        <button type="button" class="btn btn-primary" id="edit-save">Speichern</button>

        <div class="section-title">Prozessnamen (für den Agent)</div>
        <div class="chip-list">${processChips || '<span class="muted">Noch keine.</span>'}</div>
        <div class="row">
          <input type="text" id="new-process" placeholder="z.B. cs2.exe" style="flex:1;" />
          <button type="button" class="btn btn-sm" id="add-process">+</button>
        </div>

        <button type="button" class="btn btn-danger btn-block" id="edit-delete">Spiel löschen</button>
      </div>
    `,
    {
      onMount: (el) => {
        el.querySelector('#edit-save').addEventListener('click', async () => {
          const name = el.querySelector('#edit-name').value.trim();
          const icon = el.querySelector('#edit-icon').value.trim() || '🎮';
          const minTeamSize = parseInt(el.querySelector('#edit-min').value, 10);
          const maxTeamSize = parseInt(el.querySelector('#edit-max').value, 10);
          try {
            await api.games.update(gameId, { name, icon, minTeamSize, maxTeamSize });
            close();
            await ctx.refresh();
            showToast('Gespeichert.');
          } catch (err) {
            showToast(err.message, { error: true });
          }
        });

        el.querySelector('#add-process').addEventListener('click', async () => {
          const input = el.querySelector('#new-process');
          const value = input.value.trim();
          if (!value) return;
          try {
            await api.games.addProcess(gameId, value);
            input.value = '';
            close();
            await ctx.refresh();
            openGameDetail(gameId, ctx);
          } catch (err) {
            showToast(err.message, { error: true });
          }
        });

        el.querySelectorAll('[data-remove-proc]').forEach((btn) => {
          btn.addEventListener('click', async () => {
            try {
              await api.games.removeProcess(gameId, btn.dataset.removeProc);
              close();
              await ctx.refresh();
              openGameDetail(gameId, ctx);
            } catch (err) {
              showToast(err.message, { error: true });
            }
          });
        });

        el.querySelector('#edit-delete').addEventListener('click', async () => {
          if (!confirm(`${game.name} wirklich löschen? Skill-Ratings und Ergebnisse dazu gehen verloren.`)) return;
          try {
            await api.games.remove(gameId);
            close();
            await ctx.refresh();
            showToast('Spiel gelöscht.');
          } catch (err) {
            showToast(err.message, { error: true });
          }
        });
      },
    }
  );
}
