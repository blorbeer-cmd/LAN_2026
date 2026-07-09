// Settings view (FR-07, FR-10, FR-30): event management, the invite link,
// and the game catalog + process-name mappings the agent uses to recognize
// what's running. Reached via the ⚙️ icon, not the main bottom nav — this is
// setup work, not something people touch during actual play.

import { api, getToken } from '../api.js';
import { state, gameById } from '../state.js';
import { escapeHtml, gameBadgeHtml } from '../format.js';
import { openModal } from '../modal.js';
import { showToast } from '../toast.js';
import { resizeImageFile } from '../imageUtils.js';
import { suggestProcessNames } from '../gameProcessSuggestions.js';
import { dateTimeFieldHtml, wireDateTimeField } from '../dateTimeField.js';

// The invite link is the shared access token, not tied to any one event —
// same link always leads into whichever event is currently active. Factored
// out so it can be reused both in the Einstellungen page and in the
// "share it now" modal shown right after starting a new event.
function inviteUrl() {
  const token = getToken();
  return token ? `${location.origin}/?token=${encodeURIComponent(token)}` : location.origin;
}

function renderInviteLinkBody() {
  return `
    <div class="row">
      <input type="text" id="invite-link" readonly value="${escapeHtml(inviteUrl())}" style="flex:1;font-family:monospace;font-size:0.8rem;" />
      <button type="button" class="btn btn-sm" id="invite-copy">Kopieren</button>
    </div>
    <button type="button" class="btn btn-sm" id="invite-qr-toggle">📱 QR-Code anzeigen</button>
    <div id="invite-qr" style="text-align:center;" hidden></div>
  `;
}

// Wires the copy button + QR toggle within whichever root contains
// renderInviteLinkBody()'s markup (the settings page, or a modal).
function wireInviteLinkBody(root) {
  root.querySelector('#invite-copy').addEventListener('click', async () => {
    const value = root.querySelector('#invite-link').value;
    try {
      await navigator.clipboard.writeText(value);
      showToast('Einladungslink kopiert.');
    } catch {
      showToast('Kopieren nicht möglich – bitte manuell markieren.', { error: true });
    }
  });

  root.querySelector('#invite-qr-toggle').addEventListener('click', async (e) => {
    const qrEl = root.querySelector('#invite-qr');
    if (!qrEl.hidden) {
      qrEl.hidden = true;
      e.target.textContent = '📱 QR-Code anzeigen';
      return;
    }
    e.target.textContent = '📱 QR-Code ausblenden';
    qrEl.hidden = false;
    if (!qrEl.dataset.loaded) {
      const url = root.querySelector('#invite-link').value;
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
}

// Shown right after starting a new event — the whole point of asking for a
// time frame/location up front is to immediately hand over a link that's
// ready to send, instead of making the admin go find "Einladungslink" again.
function openShareLinkModal(eventName) {
  const { el } = openModal(
    `🎉 ${escapeHtml(eventName)} gestartet`,
    `
      <div class="stack">
        ${renderInviteLinkBody()}
        <p class="muted" style="font-size:0.8rem;">
          Diesen Link verschicken (oder den QR-Code zeigen/aushängen) – öffnet die Seite direkt
          eingeloggt und führt neue Leute direkt zur Profil-Erstellung. Name, Bild, Skills und der
          eigene Agent-Key richten sich alle selbst ein.
        </p>
      </div>
    `,
    { onMount: (modalEl) => wireInviteLinkBody(modalEl) }
  );
  void el;
}

function renderInviteSection() {
  const token = getToken();
  return `
    <div class="section-title">🔗 Einladungslink</div>
    <div class="card stack">
      ${renderInviteLinkBody()}
      <p class="muted" style="font-size:0.8rem;">
        Diesen Link verschicken (oder den QR-Code zeigen/aushängen) – öffnet die Seite direkt
        eingeloggt und führt neue Leute direkt zur Profil-Erstellung. Name, Bild, Skills und der
        eigene Agent-Key richten sich alle selbst ein.
      </p>
    </div>

    <div class="section-title">🖥️ TV-/Kiosk-Ansicht</div>
    <div class="card stack">
      <a href="/kiosk.html${token ? `?token=${encodeURIComponent(token)}` : ''}" target="_blank" rel="noopener" class="btn btn-block">Kiosk-Ansicht öffnen</a>
      <p class="muted" style="font-size:0.8rem;">
        Für einen gemeinsamen Bildschirm/Beamer im Raum: Live-Status, Abstimmung, Rangliste und
        laufendes Turnier, aktualisiert sich von selbst. Keine Bedienung nötig.
      </p>
    </div>
  `;
}

function eventStatusBadge(e) {
  if (e.isEnded) return `<span class="badge badge-offline">✅ Beendet</span>`;
  if (e.trackingEnabled) return `<span class="badge badge-playing">🔴 Trackt gerade</span>`;
  return `<span class="badge badge-paused">⏸ Nicht aktiv</span>`;
}

function renderEventCard(e) {
  const dateRange = `${new Date(e.starts_at).toLocaleDateString('de-DE')} – ${new Date(e.ends_at).toLocaleDateString('de-DE')}`;
  const participantCount = e.participantIds?.length ?? 0;

  const trackingBtn = e.isEnded
    ? ''
    : e.trackingEnabled
      ? `<button type="button" class="btn btn-sm" data-stop-tracking="${e.id}">⏸ Tracking stoppen</button>`
      : `<button type="button" class="btn btn-sm btn-primary" data-start-tracking="${e.id}">▶️ Tracking starten</button>`;
  const endBtn = e.isEnded
    ? ''
    : `<button type="button" class="btn btn-sm btn-danger" data-end-event="${e.id}">🏁 Beenden</button>`;

  return `
    <div class="card stack" style="gap:12px;">
      <div class="row-between">
        <strong>${escapeHtml(e.name)}</strong>
        ${eventStatusBadge(e)}
      </div>
      <div class="stack" style="gap:5px;">
        ${e.location ? `<div class="muted" style="font-size:0.82rem;">📍 ${escapeHtml(e.location)}</div>` : ''}
        <div class="muted" style="font-size:0.82rem;">🗓️ ${dateRange} · 👥 ${participantCount} Teilnehmer</div>
        ${e.description ? `<div class="muted" style="font-size:0.82rem;">${escapeHtml(e.description)}</div>` : ''}
      </div>
      <div class="row event-card-actions" style="gap:8px;flex-wrap:wrap;">
        ${trackingBtn}
        ${endBtn}
        <button type="button" class="btn btn-sm" data-participants-event="${e.id}">👥 Teilnehmer</button>
        <button type="button" class="btn btn-sm" data-edit-event="${e.id}">✏️ Bearbeiten</button>
        <button type="button" class="btn btn-sm" data-export-event="${e.id}" title="Als PDF exportieren">📄 PDF</button>
      </div>
    </div>
  `;
}

function renderEventSection() {
  const realEvents = (state.events || []).filter((e) => !e.isOutsideEvents);
  const cards = realEvents.map(renderEventCard).join('');

  return `
    <div class="row-between" style="margin-top:20px;">
      <div class="section-title" style="margin:0 0 8px;">🎪 Events</div>
      <button type="button" class="btn btn-primary btn-sm" id="new-event-btn">+ Event</button>
    </div>
    <p class="muted" style="font-size:0.8rem;margin:0 0 14px;">
      Mehrere Events können nebeneinander bestehen, aber nur eines gleichzeitig „tracken" (Live-Status
      und Spielzeit automatisch erfassen). Was außerhalb eines getrackten Events passiert, läuft unter
      „Außerhalb von Events" – ganz normal nutzbar, nur ohne festes Event zugeordnet.
    </p>
    ${
      realEvents.length === 0
        ? `<div class="empty-state"><span class="emoji">🎪</span>Noch keine Events angelegt.</div>`
        : `<div class="card-grid" style="gap:16px;">${cards}</div>`
    }
  `;
}

// Triggers a browser download of the event's PDF "Andenken" — a designed
// keepsake (Rangliste, Spielzeit, Awards, Turnier-Champions), not raw data.
// Goes through api.export.pdf()'s Blob (a plain <a href="/api/export/pdf">
// couldn't carry the access-token header).
async function downloadExport(eventId) {
  try {
    const { blob, filename } = await api.export.pdf(eventId);
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  } catch (err) {
    showToast(err.message, { error: true });
  }
}

// existing === null: create a new (not-yet-tracking) event. existing !==
// null: metadata-only edit of that event (any event, ended or not) — never
// touches tracking state.
function openEventForm(ctx, existing) {
  const isEdit = Boolean(existing);
  const now = Date.now();
  const defaultEnd = now + 24 * 60 * 60 * 1000;

  const { close } = openModal(
    isEdit ? 'Event bearbeiten' : 'Neues Event',
    `
      <form id="event-form" class="stack">
        <div>
          <label for="event-name" class="field-label">Name</label>
          <input type="text" id="event-name" maxlength="80" required autofocus value="${escapeHtml(existing?.name ?? '')}" placeholder="z.B. LAN Winter 2027" />
        </div>
        <div class="field-row">
          <div>
            <label for="event-starts" class="field-label">Beginnt am</label>
            ${dateTimeFieldHtml('event-starts', existing?.starts_at ?? now, { clearable: false })}
          </div>
          <div>
            <label for="event-ends" class="field-label">Endet am</label>
            ${dateTimeFieldHtml('event-ends', existing?.ends_at ?? defaultEnd, { clearable: isEdit })}
          </div>
        </div>
        <div>
          <label for="event-location" class="field-label">Ort (optional)</label>
          <input type="text" id="event-location" maxlength="80" placeholder="z.B. bei Tim" value="${escapeHtml(existing?.location ?? '')}" />
        </div>
        <div>
          <label for="event-description" class="field-label">Notiz (optional)</label>
          <textarea id="event-description" maxlength="500" rows="2" placeholder="z.B. Fokus: AoE2-Turnier">${escapeHtml(existing?.description ?? '')}</textarea>
        </div>
        ${
          !isEdit
            ? `<p class="muted" style="font-size:0.78rem;">Legt das Event an, aber startet noch kein Tracking – das machst du danach gezielt über „▶️ Tracking starten".</p>`
            : ''
        }
        <button type="submit" class="btn btn-primary btn-block">${isEdit ? 'Speichern' : 'Event anlegen'}</button>
      </form>
    `,
    {
      onMount: (modalEl) => {
        wireDateTimeField(modalEl, 'event-starts');
        wireDateTimeField(modalEl, 'event-ends');

        modalEl.querySelector('#event-form').addEventListener('submit', async (e) => {
          e.preventDefault();
          const name = modalEl.querySelector('#event-name').value.trim();
          if (!name) return;
          const startsVal = modalEl.querySelector('#event-starts').value;
          const endsVal = modalEl.querySelector('#event-ends').value;
          const location = modalEl.querySelector('#event-location').value.trim();
          const description = modalEl.querySelector('#event-description').value.trim();

          const payload = {
            name,
            startsAt: startsVal ? new Date(startsVal).getTime() : undefined,
            endsAt: endsVal ? new Date(endsVal).getTime() : null,
            location: location || null,
            description: description || null,
          };

          try {
            if (isEdit) {
              await api.events.update(existing.id, payload);
              close();
              await ctx.refresh();
              showToast('Event aktualisiert.');
            } else {
              await api.events.create(payload);
              close();
              await ctx.refresh();
              showToast('Event angelegt.');
              openShareLinkModal(name);
            }
          } catch (err) {
            showToast(err.message, { error: true });
          }
        });
      },
    }
  );
}

// Replaces an event's whole roster in one go — who counts as "in" the
// event, so tracking (once started) only follows them.
function openParticipantsForm(ctx, event) {
  const checked = new Set(event.participantIds ?? []);
  const rows = state.players
    .map(
      (p) => `
      <label class="check-row">
        <input type="checkbox" data-participant="${p.id}" ${checked.has(p.id) ? 'checked' : ''} />
        <span style="flex:1;">${escapeHtml(p.name)}</span>
      </label>`
    )
    .join('');

  const { close } = openModal(
    `👥 Teilnehmer – ${escapeHtml(event.name)}`,
    `
      <div class="stack">
        <p class="muted" style="font-size:0.8rem;">
          Nur diese Spieler werden getrackt, sobald dieses Event Tracking aktiv hat.
        </p>
        ${state.players.length === 0 ? `<div class="empty-state">Noch keine Spieler.</div>` : rows}
        <button type="button" class="btn btn-primary btn-block" id="participants-save">Speichern</button>
      </div>
    `,
    {
      onMount: (modalEl) => {
        modalEl.querySelector('#participants-save').addEventListener('click', async () => {
          const ids = [...modalEl.querySelectorAll('[data-participant]:checked')].map((cb) => cb.dataset.participant);
          try {
            await api.events.setParticipants(event.id, ids);
            close();
            await ctx.refresh();
            showToast('Teilnehmer gespeichert.');
          } catch (err) {
            showToast(err.message, { error: true });
          }
        });
      },
    }
  );
}

export function renderGames(container, ctx) {
  const rows = state.games
    .map(
      (g) => `
      <button type="button" class="card row list-row" data-game="${g.id}">
        ${gameBadgeHtml(g, 36)}
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
    <div class="row-between" style="margin-top:20px;">
      <div class="section-title" style="margin:0 0 8px;">🎮 Spiele verwalten</div>
      <button type="button" class="btn btn-primary btn-sm" id="add-game-btn">+ Spiel</button>
    </div>
    ${
      state.games.length === 0
        ? `<div class="empty-state"><span class="emoji">🎮</span>Noch keine Spiele.</div>`
        : `<div class="card-grid">${rows}</div>`
    }
  `;

  container.querySelectorAll('[data-export-event]').forEach((btn) => {
    btn.addEventListener('click', () => downloadExport(btn.dataset.exportEvent));
  });

  wireInviteLinkBody(container);

  container.querySelector('#new-event-btn').addEventListener('click', () => openEventForm(ctx, null));
  container.querySelectorAll('[data-edit-event]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const event = (state.events || []).find((e) => e.id === btn.dataset.editEvent);
      if (event) openEventForm(ctx, event);
    });
  });
  container.querySelectorAll('[data-participants-event]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const event = (state.events || []).find((e) => e.id === btn.dataset.participantsEvent);
      if (event) openParticipantsForm(ctx, event);
    });
  });
  container.querySelectorAll('[data-start-tracking]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const event = (state.events || []).find((e) => e.id === btn.dataset.startTracking);
      if (!event) return;
      if (!confirm(`Tracking für „${event.name}" starten? Live-Status und Spielzeit werden ab jetzt für die Teilnehmer erfasst.`)) return;
      try {
        await api.events.startTracking(event.id);
        await ctx.refresh();
        showToast('Tracking gestartet.');
      } catch (err) {
        showToast(err.message, { error: true });
      }
    });
  });
  container.querySelectorAll('[data-stop-tracking]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const event = (state.events || []).find((e) => e.id === btn.dataset.stopTracking);
      if (!event) return;
      if (!confirm(`Tracking für „${event.name}" stoppen? Es läuft dann wieder alles unter „Außerhalb von Events".`)) return;
      try {
        await api.events.stopTracking(event.id);
        await ctx.refresh();
        showToast('Tracking gestoppt.');
      } catch (err) {
        showToast(err.message, { error: true });
      }
    });
  });
  container.querySelectorAll('[data-end-event]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const event = (state.events || []).find((e) => e.id === btn.dataset.endEvent);
      if (!event) return;
      if (!confirm(`Event „${event.name}" endgültig beenden? Das lässt sich nicht rückgängig machen.`)) return;
      try {
        await api.events.end(event.id);
        await ctx.refresh();
        showToast('Event beendet.');
      } catch (err) {
        showToast(err.message, { error: true });
      }
    });
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
        <p class="muted" id="new-game-process-hint" style="font-size:0.78rem;margin-top:-6px;" hidden></p>
        <div class="row" style="align-items:flex-start;">
          <div style="flex:1;">
            <label for="new-game-min" class="field-label">Min. Teamgröße</label>
            <input type="number" id="new-game-min" min="1" max="20" value="1" />
          </div>
          <div style="flex:1;">
            <label for="new-game-max" class="field-label">Max. Teamgröße</label>
            <input type="number" id="new-game-max" min="1" max="20" value="5" />
          </div>
        </div>
        <p class="muted" style="font-size:0.78rem;margin-top:-6px;">
          Wie groß darf ein Team bei diesem Spiel sein? Wird beim „Teams auslosen" verwendet –
          z. B. 1-1 für 1-gegen-1, 1-5 für Squads bis zu fünft.
        </p>
        <button type="submit" class="btn btn-primary btn-block">Anlegen</button>
      </form>
    `,
    {
      onMount: (el) => {
        const nameInput = el.querySelector('#new-game-name');
        const hint = el.querySelector('#new-game-process-hint');
        nameInput.addEventListener('input', () => {
          const suggested = suggestProcessNames(nameInput.value);
          hint.hidden = suggested.length === 0;
          hint.textContent = suggested.length
            ? `💡 Bekannter Prozessname wird automatisch ergänzt: ${suggested.join(', ')}`
            : '';
        });

        el.querySelector('#add-game-form').addEventListener('submit', async (e) => {
          e.preventDefault();
          const name = el.querySelector('#new-game-name').value.trim();
          const icon = el.querySelector('#new-game-icon').value.trim() || '🎮';
          const minTeamSize = parseInt(el.querySelector('#new-game-min').value, 10) || 1;
          const maxTeamSize = parseInt(el.querySelector('#new-game-max').value, 10) || 5;
          if (!name) return;
          try {
            const game = await api.games.create({ name, icon, minTeamSize, maxTeamSize });
            // Best-effort only: a suggested name might already be taken by
            // another game (e.g. shared engine process) — that must never
            // block or cast doubt on the game that just got created fine.
            const suggested = suggestProcessNames(name);
            const added = [];
            for (const processName of suggested) {
              try {
                await api.games.addProcess(game.id, processName);
                added.push(processName);
              } catch {
                // ignore, admin can still add it manually in the game details
              }
            }
            close();
            await ctx.refresh();
            showToast(
              added.length
                ? `${name} wurde hinzugefügt, inkl. Prozessname ${added.join(', ')} (in den Spieldetails anpassbar).`
                : `${name} wurde hinzugefügt.`
            );
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

  // Only offer the suggestion for games created before this feature existed
  // (or renamed since) — once at least one process name is set, the admin
  // has already handled it themselves.
  const suggestedProcessNames =
    game.processNames.length === 0 ? suggestProcessNames(game.name) : [];

  const { close } = openModal(
    escapeHtml(game.name),
    `
      <div class="stack">
        <div class="row" style="align-items:center;">
          <label for="edit-icon-image-input" style="cursor:pointer;" title="Eigenes Icon/Logo hochladen">
            ${gameBadgeHtml(game, 56)}
          </label>
          <input type="file" id="edit-icon-image-input" accept="image/*" hidden />
          <input type="text" id="edit-icon" value="${escapeHtml(game.icon)}" maxlength="8" style="width:56px;" title="Emoji-Icon (Fallback ohne eigenes Bild)" />
          <input type="text" id="edit-name" value="${escapeHtml(game.name)}" maxlength="60" style="flex:1;" />
        </div>
        ${
          game.icon_image
            ? `<button type="button" class="btn btn-sm" id="edit-icon-image-remove" style="align-self:flex-start;">🗑️ Eigenes Icon entfernen</button>`
            : `<p class="muted" style="font-size:0.78rem;margin-top:-4px;">Tipp: Badge antippen, um ein eigenes Icon/Logo hochzuladen (z. B. Spiel-Artwork).</p>`
        }
        <div class="row" style="align-items:flex-start;">
          <div style="flex:1;">
            <label for="edit-min" class="field-label">Min. Teamgröße</label>
            <input type="number" id="edit-min" min="1" max="20" value="${game.min_team_size}" />
          </div>
          <div style="flex:1;">
            <label for="edit-max" class="field-label">Max. Teamgröße</label>
            <input type="number" id="edit-max" min="1" max="20" value="${game.max_team_size}" />
          </div>
        </div>
        <p class="muted" style="font-size:0.78rem;margin-top:-6px;">
          Wie groß darf ein Team bei diesem Spiel sein? Wird beim „Teams auslosen" verwendet –
          z. B. 1-1 für 1-gegen-1, 1-5 für Squads bis zu fünft.
        </p>
        <button type="button" class="btn btn-primary" id="edit-save">Speichern</button>

        <div class="section-title">Prozessnamen (für den Agent)</div>
        <div class="chip-list">${processChips || '<span class="muted">Noch keine.</span>'}</div>
        ${
          suggestedProcessNames.length
            ? `<button type="button" class="btn btn-sm" id="use-suggested-process" style="align-self:flex-start;">💡 Vorschlag übernehmen: ${escapeHtml(suggestedProcessNames.join(', '))}</button>`
            : ''
        }
        <div class="row">
          <input type="text" id="new-process" placeholder="z.B. cs2.exe" style="flex:1;" />
          <button type="button" class="btn btn-sm" id="add-process">+</button>
        </div>

        <button type="button" class="btn btn-danger btn-block" id="edit-delete">Spiel löschen</button>
      </div>
    `,
    {
      onMount: (el) => {
        el.querySelector('#edit-icon-image-input').addEventListener('change', async (e) => {
          const file = e.target.files[0];
          if (!file) return;
          try {
            const iconImage = await resizeImageFile(file, 128);
            await api.games.update(gameId, { iconImage });
            close();
            await ctx.refresh();
            showToast('Icon aktualisiert.');
            openGameDetail(gameId, ctx);
          } catch (err) {
            showToast(err.message, { error: true });
          }
        });

        const removeIconBtn = el.querySelector('#edit-icon-image-remove');
        if (removeIconBtn) {
          removeIconBtn.addEventListener('click', async () => {
            try {
              await api.games.update(gameId, { iconImage: null });
              close();
              await ctx.refresh();
              showToast('Eigenes Icon entfernt.');
              openGameDetail(gameId, ctx);
            } catch (err) {
              showToast(err.message, { error: true });
            }
          });
        }

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

        const suggestBtn = el.querySelector('#use-suggested-process');
        if (suggestBtn) {
          suggestBtn.addEventListener('click', async () => {
            try {
              for (const processName of suggestedProcessNames) {
                await api.games.addProcess(gameId, processName);
              }
              close();
              await ctx.refresh();
              openGameDetail(gameId, ctx);
            } catch (err) {
              showToast(err.message, { error: true });
            }
          });
        }

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
