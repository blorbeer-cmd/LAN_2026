// "Mein Profil" view: each invited player picks/creates their own identity
// (reusing the whoami.js mechanism already used by the Live view for pausing
// and by Votes for casting a vote — this tool has no real per-person login,
// just a shared access token, so "who am I" is a convenience the browser
// remembers locally, not a security boundary), then can maintain their own
// gamer name (unique across everyone), a profile picture and seat neighbors.
// Bock/Skill-Ratings moved to the Spiele view (see server/CLAUDE.md games
// reorg) — that's where the group averages live too, so this page just
// points there instead of duplicating the sliders. Personal playtime/awards
// stats live on their own view (myStats.js) — kept separate so this setup
// page doesn't turn into an ever-longer scroll mixing one-time setup with an
// open-ended dashboard.

import { api } from '../api.js';
import { state } from '../state.js';
import { escapeHtml, avatarHtml } from '../format.js';
import { getMyId, setMyId } from '../whoami.js';
import { showToast } from '../toast.js';
import { getPushSubscriptionState, enablePush, disablePush } from '../push.js';
import { invalidateMyStats } from './myStats.js';
import { resizeImageFile } from '../imageUtils.js';
import { icon } from '../icons.js';
import { domainIcon } from '../domainIcons.js';
import { infoTooltipHtml, wireInfoTooltips } from '../infoTooltip.js';
import { openModal } from '../modal.js';

const TRACKING_PAUSE_HELP = 'Pausiert Live-Status und Spielzeit. Agent und Steuerung bleiben verbunden; beide Schalter zeigen denselben Stand.';
const ACTIVITY_TRACKING_HELP = 'Erfasst zusätzlich, ob das Spielfenster im Vordergrund ist. Der Wert lässt sich später in der Agent-Steuerung ändern.';
const PUSH_HELP = 'Benachrichtigt dich auch, wenn Respawn nicht geöffnet ist.';

function normalizedProfileColor(value) {
  return /^#[0-9a-f]{6}$/i.test(value ?? '')
    ? value.toLowerCase()
    : getComputedStyle(document.documentElement).getPropertyValue('--accent').trim();
}

function parsedProfileColor(value) {
  const trimmed = String(value ?? '').trim();
  const withHash = trimmed.startsWith('#') ? trimmed : `#${trimmed}`;
  return /^#[0-9a-f]{6}$/i.test(withHash) ? withHash.toLowerCase() : null;
}

function hexToHsv(value) {
  const hex = normalizedProfileColor(value).slice(1);
  const [red, green, blue] = [0, 2, 4].map((offset) => parseInt(hex.slice(offset, offset + 2), 16) / 255);
  const max = Math.max(red, green, blue);
  const min = Math.min(red, green, blue);
  const delta = max - min;
  let hue = 0;
  if (delta > 0) {
    if (max === red) hue = 60 * (((green - blue) / delta) % 6);
    else if (max === green) hue = 60 * ((blue - red) / delta + 2);
    else hue = 60 * ((red - green) / delta + 4);
  }
  return { hue: (hue + 360) % 360, saturation: max === 0 ? 0 : delta / max };
}

function hsvToHex(hue, saturation) {
  const chroma = saturation;
  const section = hue / 60;
  const secondary = chroma * (1 - Math.abs((section % 2) - 1));
  const [red, green, blue] =
    section < 1 ? [chroma, secondary, 0]
      : section < 2 ? [secondary, chroma, 0]
        : section < 3 ? [0, chroma, secondary]
          : section < 4 ? [0, secondary, chroma]
            : section < 5 ? [secondary, 0, chroma]
              : [chroma, 0, secondary];
  const match = 1 - chroma;
  return `#${[red, green, blue]
    .map((channel) => Math.round((channel + match) * 255).toString(16).padStart(2, '0'))
    .join('')}`;
}

function openProfileColorPicker(colorInput, colorTrigger) {
  let selectedColor = normalizedProfileColor(colorInput.value);
  openModal(
    'Profilfarbe wählen',
    `<div class="profile-color-picker">
       <div class="profile-color-picker-wheel" role="slider" tabindex="0" aria-label="Farbton und Sättigung wählen" aria-valuetext="${selectedColor}">
         <span class="profile-color-picker-marker"></span>
       </div>
       <div class="profile-color-picker-preview-row">
         <span class="profile-color-picker-preview" style="--profile-color:${selectedColor};"></span>
         <input type="text" class="profile-color-picker-value" value="${selectedColor.toUpperCase()}" maxlength="7" spellcheck="false" aria-label="Hex-Farbwert" aria-describedby="profile-color-picker-error" />
         <button type="button" class="icon-btn profile-color-picker-copy" title="Farbwert kopieren" aria-label="Farbwert kopieren">${icon('copy')}</button>
       </div>
       <span id="profile-color-picker-error" class="profile-color-picker-error" hidden>Bitte einen sechsstelligen Hex-Farbwert eingeben.</span>
       <div class="profile-color-picker-actions">
         <button type="button" class="btn btn-equal" data-profile-color-cancel>Abbrechen</button>
         <button type="button" class="btn btn-primary btn-equal" data-profile-color-apply>Übernehmen</button>
       </div>
     </div>`,
    {
      onMount(backdrop, close) {
        backdrop.classList.add('profile-color-picker-modal');
        const wheel = backdrop.querySelector('.profile-color-picker-wheel');
        const marker = backdrop.querySelector('.profile-color-picker-marker');
        const preview = backdrop.querySelector('.profile-color-picker-preview');
        const valueInput = backdrop.querySelector('.profile-color-picker-value');
        const copyButton = backdrop.querySelector('.profile-color-picker-copy');
        const applyButton = backdrop.querySelector('[data-profile-color-apply]');
        const error = backdrop.querySelector('.profile-color-picker-error');

        const setValidity = (valid) => {
          valueInput.setAttribute('aria-invalid', String(!valid));
          copyButton.disabled = !valid;
          applyButton.disabled = !valid;
          error.hidden = valid;
        };

        const updateSelection = (color) => {
          selectedColor = normalizedProfileColor(color);
          const { hue, saturation } = hexToHsv(selectedColor);
          const angle = ((hue - 90) * Math.PI) / 180;
          marker.style.left = `${50 + Math.cos(angle) * saturation * 46}%`;
          marker.style.top = `${50 + Math.sin(angle) * saturation * 46}%`;
          preview.style.setProperty('--profile-color', selectedColor);
          valueInput.value = selectedColor.toUpperCase();
          wheel.setAttribute('aria-valuetext', selectedColor);
          setValidity(true);
        };
        const updateFromPointer = (event) => {
          const box = wheel.getBoundingClientRect();
          const x = event.clientX - (box.left + box.width / 2);
          const y = event.clientY - (box.top + box.height / 2);
          const hue = (Math.atan2(y, x) * 180 / Math.PI + 90 + 360) % 360;
          const saturation = Math.min(1, Math.hypot(x, y) / (box.width / 2));
          updateSelection(hsvToHex(hue, saturation));
        };

        wheel.addEventListener('pointerdown', (event) => {
          wheel.setPointerCapture(event.pointerId);
          updateFromPointer(event);
        });
        wheel.addEventListener('pointermove', (event) => {
          if (wheel.hasPointerCapture(event.pointerId)) updateFromPointer(event);
        });
        wheel.addEventListener('keydown', (event) => {
          if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
          event.preventDefault();
          const current = hexToHsv(selectedColor);
          if (event.key === 'ArrowLeft') current.hue = (current.hue + 355) % 360;
          if (event.key === 'ArrowRight') current.hue = (current.hue + 5) % 360;
          if (event.key === 'ArrowUp') current.saturation = Math.min(1, current.saturation + 0.05);
          if (event.key === 'ArrowDown') current.saturation = Math.max(0, current.saturation - 0.05);
          updateSelection(hsvToHex(current.hue, current.saturation));
        });
        valueInput.addEventListener('input', () => {
          const parsed = parsedProfileColor(valueInput.value);
          setValidity(Boolean(parsed));
          if (parsed) updateSelection(parsed);
        });
        valueInput.addEventListener('blur', () => {
          const parsed = parsedProfileColor(valueInput.value);
          if (parsed) valueInput.value = parsed.toUpperCase();
        });
        copyButton.addEventListener('click', async () => {
          try {
            await navigator.clipboard.writeText(selectedColor.toUpperCase());
            showToast('Farbwert kopiert.');
          } catch {
            showToast('Kopieren nicht möglich – bitte manuell markieren.', { error: true });
          }
        });
        backdrop.querySelector('[data-profile-color-cancel]').addEventListener('click', close);
        applyButton.addEventListener('click', () => {
          colorInput.value = selectedColor;
          colorTrigger.style.setProperty('--profile-color', selectedColor);
          colorTrigger.setAttribute('aria-label', `Profilfarbe wählen, aktuell ${selectedColor}`);
          close();
        });
        updateSelection(selectedColor);
      },
    }
  );
}

// Whose monitor you've declared you can see ("Sichtbare Monitore") for the
// active event (FR-18 extension) — pre-filled from same-edge seat placements
// in the seating plan, plus anything checked here manually. Fetched lazily,
// reset whenever the active identity changes.
let neighborsCache = null;
let neighborsLoading = false;
let neighborsForPlayerId = null;

// 'unsupported' | 'denied' | 'unsubscribed' | 'subscribed' | null (not yet
// checked). Re-checked whenever the view renders fresh (cheap local
// permission/registration lookups, no network round trip).
let pushState = null;
let pushBusy = false;

function renderIdentityPicker(container, ctx) {
  const myId = getMyId();
  container.innerHTML = `
    <h1 class="view-title">Willkommen bei Respawn</h1>
    <div class="grouped-page-sections">
      <section class="card stack grouped-page-section" aria-labelledby="profile-create-title">
        <div class="grouped-page-section-title"><h2 id="profile-create-title">Profil anlegen</h2></div>
        <form id="profile-new-form" class="field-row">
          <input type="text" id="profile-new-name" placeholder="Dein Gamer-Name" maxlength="60" required autofocus />
          <button type="submit" class="btn btn-primary">Los geht's</button>
        </form>
        <div class="muted" style="font-size:var(--font-size-xs);">Profilbild, Skills und dein Agent-Key richtest du direkt im Anschluss ein.</div>
      </section>
      <section class="card stack grouped-page-section" aria-labelledby="profile-existing-title">
        <div class="grouped-page-section-title"><h2 id="profile-existing-title">Schon dabei?</h2></div>
        <select id="profile-whoami">
          <option value="">– deinen Namen wählen –</option>
          ${state.players.map((p) => `<option value="${p.id}" ${p.id === myId ? 'selected' : ''}>${escapeHtml(p.name)}</option>`).join('')}
        </select>
      </section>
    </div>
  `;

  container.querySelector('#profile-whoami').addEventListener('change', (e) => {
    if (!e.target.value) return;
    setMyId(e.target.value);
    ctx.rerender();
  });

  container.querySelector('#profile-new-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = container.querySelector('#profile-new-name').value.trim();
    if (!name) return;
    try {
      const created = await api.players.create({ name });
      await ctx.refresh();
      setMyId(created.id);
      showToast(`Willkommen, ${created.name}!`);
      ctx.rerender();
    } catch (err) {
      showToast(err.message, { error: true });
    }
  });
}

// The seating plan editor (seating.js) may have just auto-filled/updated our
// own visible-monitor pairs — refetch next render instead of showing a stale
// cache (same pattern as live.js's seatingCache invalidation).
window.addEventListener('seating:changed', () => {
  neighborsForPlayerId = null;
});

async function loadNeighbors(playerId, ctx) {
  neighborsLoading = true;
  try {
    neighborsCache = await api.players.neighbors(playerId);
    neighborsForPlayerId = playerId;
  } catch (err) {
    showToast(err.message, { error: true });
    neighborsCache = null;
  } finally {
    neighborsLoading = false;
    ctx.rerender();
  }
}

function renderNeighbors(myId) {
  const others = state.players.filter((p) => p.id !== myId);
  if (others.length === 0) {
    return `<div class="empty-state" style="padding:var(--space-4);">Noch keine anderen Spieler da.</div>`;
  }
  if (neighborsLoading || neighborsCache === null) {
    return `<div class="empty-state" style="padding:var(--space-4);">Lädt…</div>`;
  }
  const checked = new Set(neighborsCache.neighborIds);
  const rows = others
    .map((p) => `
      <label class="check-row">
        <input type="checkbox" data-neighbor="${p.id}" ${checked.has(p.id) ? 'checked' : ''} />
        ${avatarHtml(p, 20)}
        <span class="player-name" style="flex:1;">${escapeHtml(p.name)}</span>
      </label>`
    )
    .join('');
  return `<div class="player-selection-grid profile-monitor-grid">${rows}</div>`;
}

async function loadPushState(ctx) {
  pushState = await getPushSubscriptionState();
  ctx.rerender();
}

function renderPushSection() {
  const subscribed = pushState === 'subscribed';
  const disabled = pushBusy || pushState === null || pushState === 'unsupported' || pushState === 'denied';
  const status =
    pushState === 'unsupported'
      ? 'Dieser Browser unterstützt keine Push-Benachrichtigungen.'
      : pushState === 'denied'
        ? 'Im Browser blockiert – bitte in den Website-Einstellungen erlauben.'
        : pushState === null
          ? 'Status wird geladen…'
          : '';
  return `
    <div class="stack" style="gap:var(--space-2);">
      <label class="check-row">
        <input type="checkbox" id="push-toggle" ${subscribed ? 'checked' : ''} ${disabled ? 'disabled' : ''} />
        <span class="title-with-info" style="flex:1;">
          <span>Aktivieren</span>
          ${infoTooltipHtml('profile-push-help', 'Push-Benachrichtigungen aktivieren', PUSH_HELP)}
        </span>
      </label>
      ${pushBusy || status ? `<span class="muted" style="font-size:var(--font-size-xs);">${pushBusy ? 'Wird aktualisiert…' : status}</span>` : ''}
    </div>`;
}

export function renderProfile(container, ctx) {
  const myId = getMyId();
  const me = state.players.find((p) => p.id === myId);
  if (!me) {
    renderIdentityPicker(container, ctx);
    return;
  }

  if (neighborsForPlayerId !== myId && !neighborsLoading) {
    loadNeighbors(myId, ctx);
  }
  if (pushState === null) {
    loadPushState(ctx);
  }

  // A brand-new player has rated nothing yet — nudge them to the Spiele
  // view once, prominently. Once at least one rating exists, a plain link
  // further down (next to "Meine Statistiken") is enough.
  const hasAnyRating =
    state.skills.some((s) => s.player_id === myId) || state.preferences.some((p) => p.player_id === myId);

  container.innerHTML = `
    <div class="row-between profile-page-header">
      <h1 class="view-title">Mein Profil</h1>
      <button type="button" class="btn btn-sm" id="profile-not-me">Nicht du?</button>
    </div>
    <div class="grouped-page-sections">
      <section class="card stack grouped-page-section" aria-labelledby="profile-data-title">
        <div class="grouped-page-section-title"><h2 id="profile-data-title">Profil</h2></div>
        <div class="profile-identity-editor">
          <div class="profile-identity-fields">
            <div class="profile-avatar-editor">
              <label for="profile-avatar-input" class="profile-avatar-control" aria-label="Profilbild ändern">
                ${avatarHtml(me, 64)}
              </label>
              <input type="file" id="profile-avatar-input" accept="image/*" hidden />
            </div>
            <div class="profile-color-field">
              <label for="profile-color-trigger" class="field-label">Farbe</label>
              <button type="button" id="profile-color-trigger" class="profile-color-trigger" style="--profile-color:${escapeHtml(me.color)};" aria-label="Profilfarbe wählen, aktuell ${escapeHtml(me.color)}"></button>
              <input type="hidden" id="profile-color" value="${escapeHtml(me.color)}" />
            </div>
            <div class="profile-text-field">
              <label for="profile-name" class="field-label">Gamertag</label>
              <input type="text" id="profile-name" value="${escapeHtml(me.name)}" maxlength="60" />
            </div>
            <div class="profile-text-field">
              <label for="profile-real-name" class="field-label">Name</label>
              <input type="text" id="profile-real-name" value="${escapeHtml(me.real_name || '')}" maxlength="60" placeholder="Optional" />
            </div>
          </div>
          <button type="button" class="btn btn-primary btn-block" id="profile-save">Speichern</button>
        </div>
      </section>

      ${
        state.games.length === 0 || hasAnyRating
          ? ''
          : `<section class="card stack grouped-page-section profile-rating-nudge" aria-labelledby="profile-rating-title">
               <div class="grouped-page-section-title">
                 <span class="title-with-info">
                   <span class="inline-icon">${icon(domainIcon('gameCatalog'))}</span>
                   <h2 id="profile-rating-title">Bock & Skill eintragen</h2>
                 </span>
               </div>
               <p class="muted" style="font-size:var(--font-size-xs);margin:0;">Hilft beim Voting und beim Teams-Auslosen und dauert nur eine Minute.</p>
               <button type="button" class="btn btn-primary btn-block" data-navigate="gameCatalog">Zu den Spielen</button>
             </section>`
      }

      <section class="card stack grouped-page-section" aria-labelledby="profile-agent-title">
        <div class="grouped-page-section-title"><h2 id="profile-agent-title">Live-Status-Agent</h2></div>
        <div class="profile-agent-steps">
          <div class="card stack profile-agent-step">
            <span class="muted profile-agent-step-label">Schritt 1</span>
            <strong>Tracking festlegen</strong>
            <label class="check-row">
              <input type="checkbox" id="tracking-paused" ${me.tracking_paused ? 'checked' : ''} />
              <span class="title-with-info" style="flex:1;">
                <span>Tracking pausieren</span>
                ${infoTooltipHtml('profile-tracking-pause-help', 'Tracking pausieren', TRACKING_PAUSE_HELP)}
              </span>
            </label>
            <label class="check-row">
              <input type="checkbox" id="agent-track-activity" />
              <span class="title-with-info" style="flex:1;">
                <span>Erweitertes Tracking</span>
                ${infoTooltipHtml('profile-activity-tracking-help', 'Erweitertes Tracking', ACTIVITY_TRACKING_HELP)}
              </span>
            </label>
          </div>
          <div class="card stack profile-agent-step">
            <span class="muted profile-agent-step-label">Schritt 2</span>
            <strong>Agent herunterladen</strong>
            <span class="muted">Das ZIP enthält bereits Server-Adresse und deinen persönlichen Key.</span>
            <button type="button" class="btn btn-primary btn-block" id="agent-download">${icon('download')} Für Windows herunterladen</button>
          </div>
          <div class="card stack profile-agent-step">
            <span class="muted profile-agent-step-label">Schritt 3</span>
            <strong>Installieren</strong>
            <span class="muted">ZIP entpacken und <code>install.bat</code> starten. Danach läuft der Agent automatisch bei jedem Windows-Login.</span>
          </div>
        </div>
        <details class="card profile-agent-manual">
          <summary>Kein Windows / manuelle Einrichtung</summary>
          <div class="row profile-agent-key-row">
            <input type="text" id="profile-apikey" readonly value="Laden…" style="flex:1;font-family:monospace;" />
            <button type="button" class="btn btn-sm" id="profile-copy-key">Kopieren</button>
          </div>
          <p class="muted" style="font-size:var(--font-size-xs);margin-bottom:0;">Key in die Agent-Konfiguration eintragen; Details stehen in <code>agent/README.md</code>.</p>
        </details>
      </section>

      <section class="card stack grouped-page-section" aria-labelledby="profile-push-title">
        <div class="grouped-page-section-title"><h2 id="profile-push-title">Push-Benachrichtigungen</h2></div>
        ${renderPushSection()}
      </section>

      <section class="card stack grouped-page-section" aria-labelledby="profile-monitors-title">
        <div class="grouped-page-section-title"><h2 id="profile-monitors-title">Sichtbare Monitore</h2></div>
        ${renderNeighbors(myId)}
      </section>

      <section class="card grouped-page-section" aria-labelledby="profile-stats-title">
        <div class="grouped-page-section-title">
          <h2 id="profile-stats-title">Meine Statistiken</h2>
          <button type="button" class="btn btn-sm" data-navigate="myStats">Ansehen</button>
        </div>
      </section>
    </div>
  `;

  wireInfoTooltips(container);

  container.querySelector('#profile-not-me').addEventListener('click', () => {
    setMyId('');
    invalidateMyStats();
    neighborsForPlayerId = null;
    ctx.rerender();
  });

  // Fetched lazily (the roster list intentionally omits API keys) and only
  // ever for your own profile — see the players.js detail modal for the
  // admin-side equivalent.
  api.players
    .get(myId)
    .then((full) => {
      const input = container.querySelector('#profile-apikey');
      if (input) input.value = full.api_key;
    })
    .catch(() => {
      const input = container.querySelector('#profile-apikey');
      if (input) input.value = 'Fehler beim Laden';
    });

  container.querySelector('#tracking-paused').addEventListener('change', async (e) => {
    try {
      await api.players.update(myId, { trackingPaused: e.target.checked });
      await ctx.refresh();
      showToast(e.target.checked ? 'Tracking pausiert.' : 'Tracking wieder aktiv.');
    } catch (err) {
      showToast(err.message, { error: true });
    }
  });

  container.querySelector('#profile-copy-key').addEventListener('click', async () => {
    const value = container.querySelector('#profile-apikey').value;
    try {
      await navigator.clipboard.writeText(value);
      showToast('API-Key kopiert.');
    } catch {
      showToast('Kopieren nicht möglich – bitte manuell markieren.', { error: true });
    }
  });

  const profileColorInput = container.querySelector('#profile-color');
  const profileColorTrigger = container.querySelector('#profile-color-trigger');
  profileColorTrigger.addEventListener('click', () => openProfileColorPicker(profileColorInput, profileColorTrigger));

  container.querySelector('#agent-download').addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    btn.disabled = true;
    const originalLabel = btn.innerHTML;
    btn.textContent = 'Wird vorbereitet…';
    try {
      const trackActivity = container.querySelector('#agent-track-activity').checked;
      const { blob, filename } = await api.agent.download(myId, trackActivity);
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = filename;
      link.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      showToast(err.message, { error: true });
    } finally {
      btn.disabled = false;
      btn.innerHTML = originalLabel;
    }
  });

  container.querySelector('#profile-save').addEventListener('click', async () => {
    const name = container.querySelector('#profile-name').value.trim();
    const realName = container.querySelector('#profile-real-name').value.trim();
    const color = container.querySelector('#profile-color').value;
    if (!name) return showToast('Name darf nicht leer sein.', { error: true });
    try {
      await api.players.update(myId, { name, realName: realName || null, color });
      await ctx.refresh();
      showToast('Gespeichert.');
    } catch (err) {
      showToast(err.message, { error: true });
    }
  });

  container.querySelector('#profile-avatar-input').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      const avatar = await resizeImageFile(file);
      await api.players.update(myId, { avatar });
      await ctx.refresh();
      showToast('Profilbild aktualisiert.');
    } catch (err) {
      showToast(err.message, { error: true });
    }
  });

  container.querySelectorAll('[data-neighbor]').forEach((cb) => {
    cb.addEventListener('change', async () => {
      const ids = [...container.querySelectorAll('[data-neighbor]:checked')].map((el) => el.dataset.neighbor);
      try {
        neighborsCache = await api.players.setNeighbors(myId, ids);
      } catch (err) {
        showToast(err.message, { error: true });
        cb.checked = !cb.checked; // revert the click that failed to save
      }
    });
  });

  const pushToggle = container.querySelector('#push-toggle');
  if (pushToggle) {
    pushToggle.addEventListener('change', async (event) => {
      const shouldEnable = event.currentTarget.checked;
      pushBusy = true;
      ctx.rerender();
      try {
        if (shouldEnable) {
          await enablePush(myId);
          showToast('Push-Benachrichtigungen aktiviert.');
        } else {
          await disablePush();
          showToast('Push-Benachrichtigungen deaktiviert.');
        }
      } catch (err) {
        showToast(err.message, { error: true });
      } finally {
        pushBusy = false;
        pushState = await getPushSubscriptionState();
        ctx.rerender();
      }
    });
  }
}
