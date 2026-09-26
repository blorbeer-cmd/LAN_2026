// "Mein Profil": authentication binds identity to the session. Players maintain their own
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
import { getMyId } from '../whoami.js';
import { logout } from '../authGate.js';
import { showToast } from '../toast.js';
import { getPushSubscriptionState, enablePush, disablePush } from '../push.js';
import { resizeImageFile } from '../imageUtils.js';
import { icon } from '../icons.js';
import { confirmDialog, openModal } from '../modal.js';
import { emptyStateHtml } from '../emptyState.js';
import { createLatestValueLoader } from '../latestValueLoader.js';
import {
  acceptedInvitationHandoffHtml,
  pendingEventInvitations,
  renderInvitationRow,
  wirePendingInvitationActions,
} from './events.js';
import { eventHasFeature } from '../eventFeatures.js';
import { layoutModeForPlayer, LAYOUT_MODES, setLayoutModeForPlayer } from '../layoutMode.js';
import { withStepUp } from '../reauth.js';

// Tracking is the one feature that runs on a private PC, so its labels alone
// ("Tracking pausieren") read like surveillance without saying what leaves the
// machine. The "Mehr erfahren" dialog therefore states the actual scope and
// purpose: the agent asks the OS only about the mapped game processes and
// never reads anything else (see agent/src/systemProbe.js), so this is a
// factual description of the probe, not a reassurance.
// The allow-list is returned only while activeTrackingContexts resolves a
// valid selected event. Technical reachability and version remain separate;
// recognized game processes are neither stored nor shown without consent.
const TRACKING_DETAILS = [
  ['Was der Agent liest', 'Der Agent fragt deinen PC nur während eines gültigen Tracking-Kontexts nach den Spielen aus der veröffentlichten Spieleliste. Andere Programme, Fenstertitel oder Dateien liest er nicht aus.'],
  ['Wann daraus Daten entstehen', 'Das ausgewählte Event muss laufen, du musst zugesagt haben, die Orga muss Tracking aktiviert haben und deine Einwilligung muss gültig sein. Ohne diesen Kontext werden keine erkannten Spiele übertragen, gespeichert oder der Administration angezeigt. Technische Erreichbarkeit und Agent-Version bleiben davon getrennt.'],
  ['Pausieren', 'Stoppt die Erfassung sofort: Der Agent meldet dann kein laufendes Spiel und keine Spielzeit mehr, und du erscheinst auf dem Board als „pausiert“. Bereits erfasste Spielzeit bleibt erhalten. Agent und Steuerung bleiben verbunden; beide Schalter zeigen denselben Stand.'],
  ['Erweitertes Tracking', 'Meldet zusätzlich, ob eines dieser Spiele gerade im Vordergrund ist und wie lange du keine Taste und keine Maus benutzt hast. Ab zwei Minuten ohne Eingabe zählt die Zeit nicht mehr als aktiv. So wird echte Spielzeit von einem nur nebenbei offenen Spiel unterschieden. Fenster außerhalb des Spielekatalogs bleiben auch hier ungelesen. Die Wahl gilt für den heruntergeladenen Agent und lässt sich später in der Agent-Steuerung ändern.'],
];

const AUTO_CONSENT_HELP =
  'Deine Zustimmung gilt automatisch, sobald ein neues LAN-Event oder eine Gruppe für die Spielerfassung freigeschaltet wird. Einzelne Zustimmungen kannst du jederzeit widerrufen. Gruppen haben kein Enddatum: Dort läuft die Erfassung bis zum Widerruf. Ändert sich der Einwilligungstext, wirst du erneut gefragt.';
const PRIVACY_OVERVIEW =
  'Respawn speichert Profil- und Kontodaten für Anmeldung und Teilnahme, Event- und Zahlungsstatus für die Organisation, freiwillige Spiel- und Aktivitätsdaten für Live-Status und Auswertung, Nachrichten und Push-Status für Kommunikation sowie begrenzte technische Protokolle für Betrieb und Sicherheit. Sichtbarkeit richtet sich nach Eventteilnahme und Rolle.';
const PRIVACY_EXPORT_HELP =
  'Der Export ist eine verständliche JSON-Datei mit deinen gespeicherten Daten. Passwörter, Schlüssel, Recovery-Codes und private Daten anderer Personen fehlen bewusst. Der Event-Andenkenexport bleibt davon getrennt.';

// Agent setup and privacy start collapsed; their open state survives
// live re-renders.
const profileSectionOpen = { agent: false, privacy: false, data: false };

let privacyState = null;
let privacyContext = null;
const privacyLoader = createLatestValueLoader(async () => {
  const context = privacyContext;
  try {
    privacyState = { data: await api.privacy.get(), error: null };
  } catch (error) {
    privacyState = { data: null, error: error.message };
  } finally {
    context?.rerender();
  }
});

export function invalidatePrivacy() {
  privacyState = null;
  privacyLoader.invalidate();
}

globalThis.window?.addEventListener('respawn:identity-changed', invalidatePrivacy);
globalThis.window?.addEventListener('respawn:event-invitation-accepted', invalidatePrivacy);

async function loadPrivacy(ctx, force = false) {
  privacyContext = ctx;
  if (!force && privacyState) return;
  await privacyLoader.run(force);
}

function openPrivacyDetails(trackingConsent) {
  openModal(
    'Datenschutz',
    `<div class="stack profile-tracking-details">
       <div><strong>Was Respawn speichert</strong><p>${PRIVACY_OVERVIEW}</p></div>
       <div><strong>Freiwillige Spielerfassung</strong><p>${escapeHtml(trackingConsent.text)}</p></div>
       <div><strong>Vorab-Zustimmung</strong><p>${AUTO_CONSENT_HELP}</p></div>
       <div><strong>Datenexport</strong><p>${PRIVACY_EXPORT_HELP}</p></div>
     </div>`,
  );
}

// "Datenschutz & meine Daten": consent per trackable event, the standing
// pre-authorization, withdrawable legacy consents, export and deletion, all
// as rows with one action each. The consent text stays visible above the
// consent rows because granting refers to exactly that text.
function renderPrivacySection() {
  const section = (body) => `
    <details class="card grouped-page-section collapsible-section" data-profile-section="privacy" aria-labelledby="profile-privacy-title" ${profileSectionOpen.privacy ? 'open' : ''}>
      <summary class="collapsible-section-header"><h2 id="profile-privacy-title">Datenschutz</h2><span class="collapsible-section-chevron">${icon('chevronRight')}</span></summary>
      <div class="collapsible-section-content stack">${body}</div>
    </details>`;
  if (!privacyState) return section(emptyStateHtml('Lädt', { className: 'empty-state-compact' }));
  if (privacyState.error) {
    return section(`<div class="profile-rows">${profileRow({
      title: 'Nicht geladen',
      meta: escapeHtml(privacyState.error),
      action: '<button type="button" class="btn btn-sm" id="privacy-retry">Erneut laden</button>',
    })}</div>`);
  }
  // The old group consent from before event-bound tracking no longer enables
  // anything and is deliberately not listed.
  const { trackingConsent } = privacyState.data;
  const version = escapeHtml(trackingConsent.textVersion);
  // A row only counts as active when the server matched the current purpose
  // and text version, so an active row always carries that version.
  const consentRows = trackingConsent.events
    .filter((event) => event.eventId !== 'instance-base-event' && event.eventType !== 'general')
    .map((event) => {
      const active = Boolean(event.consentId);
      return profileRow({
        title: escapeHtml(event.eventName),
        meta: active ? `Spielerfassung erlaubt · Text ${escapeHtml(event.textVersion)}` : 'Spielerfassung nicht erlaubt',
        action: `<button type="button" class="btn btn-sm" data-consent-event="${escapeHtml(event.eventId)}" aria-pressed="${active}">${active ? 'Widerrufen' : 'Erlauben'}</button>`,
      });
    });
  const auto = trackingConsent.autoConsent ?? {};
  // A pre-authorization set under an older text stops applying; name it
  // instead of letting the button read as "never set".
  const autoMeta = auto.enabled
    ? `An · gilt für neue Events und Gruppen · Text ${version}`
    : auto.agreedTextVersion
      ? `Aus · frühere Zustimmung zu Text ${escapeHtml(auto.agreedTextVersion)} gilt nicht mehr`
      : 'Aus · Gruppen laufen bis zum Widerruf';
  // "Allgemein" is not trackable, so an old consent there is left out just
  // like the event itself above.
  const legacyRows = [
    ...(trackingConsent.legacyEvents ?? []).filter((event) => event.eventId !== 'instance-base-event').map((event) => profileRow({
      title: `Frühere Einwilligung: ${escapeHtml(event.eventName)}`,
      meta: event.textVersion ? `Text ${escapeHtml(event.textVersion)} · aktiviert keine Erfassung` : 'Ohne Textversion · aktiviert keine Erfassung',
      action: `<button type="button" class="btn btn-sm" data-consent-legacy-event="${escapeHtml(event.eventId)}">Widerrufen</button>`,
    })),
  ];
  return section(`
    <p class="profile-note">${escapeHtml(trackingConsent.text)} <button type="button" class="profile-link-btn" id="privacy-details">Mehr erfahren</button></p>
    <div class="profile-rows" role="group" aria-label="Deine Events">${
      consentRows.length || legacyRows.length
        ? `${consentRows.join('')}${legacyRows.join('')}`
        : '<p class="profile-note">Gerade kein Event mit Spielerfassung</p>'
    }</div>
    <div class="profile-rows profile-rows-separate">${profileRow({
      title: 'Neue Events und Gruppen vorab erlauben',
      meta: autoMeta,
      action: `<button type="button" class="btn btn-sm" id="privacy-auto-consent" aria-pressed="${Boolean(auto.enabled)}">${auto.enabled ? 'Deaktivieren' : 'Aktivieren'}</button>`,
    })}</div>`);
}

// Export and deletion need no privacy payload, so this card renders at once.
function renderMyDataSection() {
  return `
    <details class="card grouped-page-section collapsible-section" data-profile-section="data" aria-labelledby="profile-data-title" ${profileSectionOpen.data ? 'open' : ''}>
      <summary class="collapsible-section-header"><h2 id="profile-data-title">Meine Daten</h2><span class="collapsible-section-chevron">${icon('chevronRight')}</span></summary>
      <div class="collapsible-section-content profile-rows">
        ${profileRow({
          title: 'Exportieren',
          meta: 'JSON-Datei ohne Passwörter und Schlüssel',
          action: '<button type="button" class="btn btn-sm" id="privacy-export">Exportieren</button>',
        })}
        ${profileRow({
          title: 'Konto löschen',
          meta: 'Dauerhaft · vorher erneut anmelden',
          action: '<button type="button" class="btn btn-sm" id="privacy-delete-account">Löschen</button>',
        })}
      </div>
    </details>`;
}

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
            showToast('Kopieren nicht möglich.', { error: true });
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

// Seat neighbours are pre-filled from the active event's seating plan, so
// they are event data even though the cache is keyed by player id. Switching
// the workspace has to drop them, or the previous event's seating keeps
// driving the checkboxes for the new one.
export function invalidateSeatNeighbors() {
  neighborsCache = null;
  neighborsLoading = false;
  neighborsForPlayerId = null;
}

// 'unsupported' | 'denied' | 'unsubscribed' | 'subscribed' | null (not yet
// checked). Re-checked whenever the view renders fresh (cheap local
// permission/registration lookups, no network round trip).
let pushState = null;
let pushBusy = false;

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
    // Mark as attempted so a failed load doesn't immediately retry on the
    // next rerender and flood the user with repeated error toasts.
    neighborsForPlayerId = playerId;
  } finally {
    neighborsLoading = false;
    ctx.rerender();
  }
}

// One settings row: title and a muted meta line on the left, the row's single
// action in the fixed right column shared by every row of the page.
function profileRow({ title, meta = '', action = '', number = null, className = '' }) {
  return `
    <div class="profile-row${className ? ` ${className}` : ''}">
      <div class="profile-row-main">
        ${number == null ? '' : `<span class="profile-row-number">${number}</span>`}
        <span class="profile-row-text">
          <span class="profile-row-title">${title}</span>
          ${meta ? `<span class="profile-row-meta">${meta}</span>` : ''}
        </span>
      </div>
      <div class="profile-row-action">${action}</div>
    </div>`;
}

function neighborSummary(myId) {
  if (neighborsLoading || neighborsCache === null) return 'Lädt';
  const names = state.players
    .filter((p) => p.id !== myId && neighborsCache.neighborIds.includes(p.id))
    .map((p) => p.name)
    .sort((a, b) => a.localeCompare(b, 'de'));
  return names.length ? escapeHtml(names.join(', ')) : 'Niemand ausgewählt';
}

// Chosen neighbours lead the list, the rest follows alphabetically. The split
// is taken when the dialog opens, so a row does not jump away under the
// pointer while boxes are ticked; the search filters both groups.
function openNeighborsDialog(myId, ctx) {
  const others = state.players
    .filter((p) => p.id !== myId)
    .sort((a, b) => a.name.localeCompare(b.name, 'de'));
  const checked = new Set(neighborsCache?.neighborIds ?? []);
  const row = (p) => `
    <label class="profile-monitor-row" data-monitor-name="${escapeHtml(p.name.toLocaleLowerCase('de'))}">
      <input type="checkbox" data-neighbor="${p.id}" ${checked.has(p.id) ? 'checked' : ''} />
      ${avatarHtml(p, 20)}
      <span class="player-name">${escapeHtml(p.name)}</span>
    </label>`;
  const group = (title, players) => (players.length === 0
    ? ''
    : `<div class="profile-monitor-group">
         <h3 class="profile-group-title">${title}</h3>
         ${players.map(row).join('')}
       </div>`);
  openModal(
    'Sichtbare Monitore',
    others.length === 0
      ? emptyStateHtml('Noch keine weiteren Teilnehmenden', { className: 'empty-state-compact' })
      : `<div class="stack">
           <input type="search" id="profile-monitor-search" placeholder="Spieler suchen" aria-label="Spieler suchen" autocomplete="off" />
           ${group('Ausgewählt', others.filter((p) => checked.has(p.id)))}
           ${group('Weitere', others.filter((p) => !checked.has(p.id)))}
           <p class="profile-note profile-monitor-empty" hidden>Kein Spieler gefunden</p>
         </div>`,
    {
      onMount(el) {
        const search = el.querySelector('#profile-monitor-search');
        search?.addEventListener('input', () => {
          const query = search.value.trim().toLocaleLowerCase('de');
          let visible = 0;
          el.querySelectorAll('.profile-monitor-group').forEach((groupEl) => {
            let groupVisible = 0;
            groupEl.querySelectorAll('[data-monitor-name]').forEach((rowEl) => {
              const match = !query || rowEl.dataset.monitorName.includes(query);
              rowEl.hidden = !match;
              if (match) groupVisible += 1;
            });
            groupEl.hidden = groupVisible === 0;
            visible += groupVisible;
          });
          el.querySelector('.profile-monitor-empty').hidden = visible > 0;
        });
        el.querySelectorAll('[data-neighbor]').forEach((cb) => {
          cb.addEventListener('change', async () => {
            const ids = [...el.querySelectorAll('[data-neighbor]:checked')].map((box) => box.dataset.neighbor);
            try {
              neighborsCache = await api.players.setNeighbors(myId, ids);
              ctx.rerender();
            } catch (err) {
              showToast(err.message, { error: true });
              cb.checked = !cb.checked; // revert the click that failed to save
            }
          });
        });
      },
    },
  );
}

function openPasswordDialog() {
  const passwordField = (id, label, autocomplete, extra = '') => `
    <div>
      <label for="${id}" class="field-label">${label}</label>
      <div class="row">
        <input type="password" id="${id}" autocomplete="${autocomplete}" required ${extra} style="flex:1;" />
        <button type="button" class="icon-btn" data-password-toggle="${id}" data-password-toggle-label="${label}" aria-label="${label} anzeigen" title="${label} anzeigen">${icon('eye')}</button>
      </div>
    </div>`;
  const { close } = openModal(
    'Passwort ändern',
    `<form class="stack" id="profile-password-form">
       ${passwordField('profile-current-password', 'Aktuelles Passwort', 'current-password')}
       ${passwordField('profile-new-password', 'Neues Passwort', 'new-password', 'minlength="1" maxlength="1024"')}
       <div class="checklist-form-footer">
         <button type="button" class="btn btn-sm" data-password-cancel>Abbrechen</button>
         <button type="submit" class="btn btn-primary btn-sm">Speichern</button>
       </div>
     </form>`,
    {
      confirmClose: () => ([...document.querySelectorAll('#profile-password-form input')].some((input) => input.value)
        ? 'Die eingegebenen Passwörter gehen verloren.'
        : ''),
      onMount(el) {
        el.querySelectorAll('[data-password-toggle]').forEach((button) => {
          button.addEventListener('click', () => {
            const input = el.querySelector(`#${button.dataset.passwordToggle}`);
            const visible = input.type === 'password';
            const label = button.dataset.passwordToggleLabel || 'Passwort';
            input.type = visible ? 'text' : 'password';
            button.innerHTML = icon(visible ? 'eyeOff' : 'eye');
            button.setAttribute('aria-label', `${label} ${visible ? 'verbergen' : 'anzeigen'}`);
            button.title = button.getAttribute('aria-label');
          });
        });
        el.querySelector('[data-password-cancel]').addEventListener('click', () => el.querySelector('[data-close]')?.click());
        el.querySelector('#profile-password-form').addEventListener('submit', async (event) => {
          event.preventDefault();
          try {
            await api.auth.changePassword({
              currentPassword: el.querySelector('#profile-current-password').value,
              newPassword: el.querySelector('#profile-new-password').value,
            });
            close();
            showToast('Passwort geändert. Andere Geräte wurden abgemeldet.');
          } catch (error) {
            showToast(error.message, { error: true });
          }
        });
        el.querySelector('#profile-current-password').focus();
      },
    },
  );
}

function openTrackingDetails() {
  openModal(
    'Was der Agent erfasst',
    `<div class="stack profile-tracking-details">
       ${TRACKING_DETAILS.map(([title, text]) => `<div><strong>${title}</strong><p>${text}</p></div>`).join('')}
     </div>`,
  );
}

async function loadPushState(ctx) {
  pushState = await getPushSubscriptionState();
  ctx.rerender();
}

function pushRow() {
  const subscribed = pushState === 'subscribed';
  const disabled = pushBusy || pushState === null || pushState === 'unsupported' || pushState === 'denied';
  const status =
    pushState === 'unsupported'
      ? 'Aus · von diesem Browser nicht unterstützt'
      : pushState === 'denied'
        ? 'Aus · im Browser blockiert'
        : pushState === null
          ? 'Lädt'
          : subscribed
            ? 'An · auch bei geschlossener App'
            : 'Aus · meldet sich auch bei geschlossener App';
  return profileRow({
    title: 'Push-Benachrichtigungen',
    meta: status,
    action: `<button type="button" class="btn btn-sm" id="push-toggle" aria-pressed="${subscribed}" ${disabled ? 'disabled' : ''}>${subscribed ? 'Deaktivieren' : 'Aktivieren'}</button>`,
  });
}

export function renderProfile(container, ctx) {
  const myId = getMyId();
  const me = state.players.find((p) => p.id === myId);
  if (!me) {
    container.innerHTML = emptyStateHtml('Dein Profil konnte nicht geladen werden');
    return;
  }

  const gamesEnabled = eventHasFeature(state.activeEvent, 'games');
  const trackingEnabled = eventHasFeature(state.activeEvent, 'tracking');
  const monitorsEnabled = trackingEnabled && eventHasFeature(state.activeEvent, 'seating');

  if (monitorsEnabled && neighborsForPlayerId !== myId && !neighborsLoading) {
    loadNeighbors(myId, ctx);
  }
  if (pushState === null) {
    loadPushState(ctx);
  }
  if (!privacyState) loadPrivacy(ctx);

  // A brand-new player has rated nothing yet: nudge them to the Spiele view
  // until at least one rating exists.
  const hasAnyRating =
    state.skills.some((s) => s.player_id === myId) || state.preferences.some((p) => p.player_id === myId);
  const ratingNudge = gamesEnabled && state.games.length > 0 && !hasAnyRating;

  // Event invitations lead the page: they need a response (see events.js's
  // renderInvitationRow/pendingEventInvitations, also linked from Home's
  // "Aktuell" list in aktuellStatus.js).
  const pendingInvitations = pendingEventInvitations();
  const layoutPreference = layoutModeForPlayer(myId);
  const eventRows = [
    ratingNudge
      ? profileRow({
          title: 'Bock &amp; Skill',
          meta: 'Noch nichts bewertet',
          action: '<button type="button" class="btn btn-sm" data-navigate="gameCatalog">Bewerten</button>',
        })
      : '',
    trackingEnabled
      ? profileRow({
          title: 'Meine Statistiken',
          meta: 'Spielzeit und Awards',
          action: '<button type="button" class="btn btn-sm" data-navigate="myStats">Ansehen</button>',
        })
      : '',
    monitorsEnabled
      ? profileRow({
          title: 'Sichtbare Monitore',
          meta: neighborSummary(myId),
          action: `<button type="button" class="btn btn-sm" id="profile-monitors-edit" ${neighborsCache === null ? 'disabled' : ''}>Bearbeiten</button>`,
        })
      : '',
  ].filter(Boolean);

  container.innerHTML = `
    <div class="more-subpage-header">
      <div class="more-subpage-title-row">
        <h1 class="view-title" id="profile-view-title" tabindex="-1">Mein Profil</h1>
        <button type="button" class="btn btn-sm" id="profile-logout">Abmelden</button>
      </div>
    </div>
    <div class="grouped-page-sections">
      ${acceptedInvitationHandoffHtml()}
      ${
        pendingInvitations.length > 0
          ? `<section class="card stack grouped-page-section" aria-labelledby="profile-invitations-title">
               <div class="grouped-page-section-title"><h2 id="profile-invitations-title" tabindex="-1">Einladungen</h2></div>
               <div class="profile-rows">${pendingInvitations.map(renderInvitationRow).join('')}</div>
             </section>`
          : ''
      }
      <section class="card grouped-page-section" aria-label="Profildaten">
        <div class="profile-rows">
          <div class="profile-row is-form">
            <div class="profile-identity">
              <div class="profile-avatar-editor">
                <label for="profile-avatar-input" class="profile-avatar-control" aria-label="Profilbild ändern" title="Profilbild ändern">
                  ${avatarHtml(me, 48)}
                </label>
                <input type="file" id="profile-avatar-input" accept="image/*" hidden />
                <button type="button" id="profile-color-trigger" class="profile-color-trigger" style="--profile-color:${escapeHtml(me.color)};" aria-label="Profilfarbe wählen, aktuell ${escapeHtml(me.color)}" title="Profilfarbe wählen"></button>
                <input type="hidden" id="profile-color" value="${escapeHtml(me.color)}" />
              </div>
              <div class="profile-text-field">
                <label for="profile-name" class="field-label is-required">Gamertag</label>
                <input type="text" id="profile-name" value="${escapeHtml(me.name)}" maxlength="60" required placeholder="NightOwl" />
              </div>
              <div class="profile-text-field profile-real-name">
                <label for="profile-real-name" class="field-label">Name</label>
                <input type="text" id="profile-real-name" value="${escapeHtml(me.real_name || '')}" maxlength="60" placeholder="Robert" />
              </div>
            </div>
            <div class="profile-row-action"><button type="button" class="btn btn-primary btn-sm" id="profile-save">Speichern</button></div>
          </div>
          ${profileRow({
            title: '<label for="profile-layout">Ansicht</label>',
            meta: 'Automatisch zeigt ab 1280 px die Desktop-Leiste',
            action: `<select id="profile-layout">${[
              { value: LAYOUT_MODES.auto, label: 'Automatisch' },
              { value: LAYOUT_MODES.desktop, label: 'Desktop' },
              { value: LAYOUT_MODES.laptop, label: 'Laptop' },
            ].map((option) => `<option value="${option.value}" ${layoutPreference === option.value ? 'selected' : ''}>${option.label}</option>`).join('')}</select>`,
          })}
          ${pushRow()}
          ${profileRow({
            title: 'Passwort',
            meta: 'Meldet andere Geräte ab',
            action: '<button type="button" class="btn btn-sm" id="profile-password-open">Ändern</button>',
          })}
        </div>
      </section>

      ${eventRows.length ? `<section class="card stack grouped-page-section" aria-labelledby="profile-event-title">
        <div class="grouped-page-section-title"><h2 id="profile-event-title">${escapeHtml(state.activeEvent?.name ?? 'Event')}</h2></div>
        <div class="profile-rows">${eventRows.join('')}</div>
      </section>` : ''}

      ${trackingEnabled ? `<details class="card grouped-page-section collapsible-section" data-profile-section="agent" aria-labelledby="profile-agent-title" ${profileSectionOpen.agent ? 'open' : ''}>
        <summary class="collapsible-section-header"><h2 id="profile-agent-title">Live-Status &amp; Agent</h2><span class="collapsible-section-chevron">${icon('chevronRight')}</span></summary>
        <div class="collapsible-section-content profile-rows">
          ${profileRow({
            title: 'Tracking',
            meta: `${me.tracking_paused ? 'Pausiert' : 'Läuft'} · prüft nur Spiele aus dem Katalog · <button type="button" class="profile-link-btn" id="profile-tracking-details">Mehr erfahren</button>`,
            action: `<button type="button" class="btn btn-sm" id="tracking-paused" aria-pressed="${Boolean(me.tracking_paused)}">${me.tracking_paused ? 'Fortsetzen' : 'Pausieren'}</button>`,
          })}
          ${profileRow({
            number: 1,
            title: 'Agent herunterladen',
            meta: `ZIP mit Server-Adresse und deinem Key
              <label class="profile-check"><input type="checkbox" id="agent-track-activity" />Erweitertes Tracking für diesen Download</label>`,
            action: '<button type="button" class="btn btn-primary btn-sm" id="agent-download">Herunterladen</button>',
          })}
          ${profileRow({
            number: 2,
            title: 'Installieren',
            meta: 'ZIP entpacken und <code>install.bat</code> starten · startet danach bei jedem Windows-Login',
          })}
          ${profileRow({
            number: 3,
            title: 'Ohne Windows',
            meta: 'Key in die Agent-Konfiguration eintragen · <button type="button" class="profile-link-btn" id="profile-rotate-key">Key erneuern</button>',
            action: '<button type="button" class="btn btn-sm" id="profile-copy-key" disabled>Key kopieren</button>',
          })}
        </div>
      </details>` : ''}

      ${renderPrivacySection()}
      ${renderMyDataSection()}
    </div>
  `;

  wirePendingInvitationActions(container, ctx);
  wirePrivacyActions(container, ctx);
  container.querySelectorAll('[data-profile-section]').forEach((section) => {
    section.addEventListener('toggle', () => {
      profileSectionOpen[section.dataset.profileSection] = section.open;
    });
  });

  container.querySelector('#profile-layout').addEventListener('change', (event) => {
    setLayoutModeForPlayer(myId, event.currentTarget.value);
    window.dispatchEvent(new Event('respawn:layout-mode-changed'));
  });

  container.querySelector('#profile-logout').addEventListener('click', () => logout());
  container.querySelector('#profile-password-open').addEventListener('click', () => openPasswordDialog());
  container.querySelector('#profile-monitors-edit')?.addEventListener('click', () => openNeighborsDialog(myId, ctx));
  container.querySelector('#profile-tracking-details')?.addEventListener('click', () => openTrackingDetails());

  // Fetched lazily (the roster list intentionally omits API keys) and only
  // ever for your own profile; see the players.js detail modal for the
  // admin-side equivalent.
  let apiKey = null;
  const copyKeyButton = container.querySelector('#profile-copy-key');
  if (trackingEnabled) {
    api.players
      .get(myId)
      .then((full) => {
        apiKey = full.api_key;
        if (copyKeyButton) copyKeyButton.disabled = false;
      })
      .catch(() => {
        if (copyKeyButton) copyKeyButton.title = 'Key konnte nicht geladen werden';
      });
  }

  container.querySelector('#tracking-paused')?.addEventListener('click', async (e) => {
    const pause = !me.tracking_paused;
    e.currentTarget.disabled = true;
    try {
      await api.players.update(myId, { trackingPaused: pause });
      await ctx.refresh();
      showToast(pause ? 'Tracking pausiert.' : 'Tracking wieder aktiv.');
    } catch (err) {
      e.currentTarget.disabled = false;
      showToast(err.message, { error: true });
    }
  });

  copyKeyButton?.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(apiKey);
      showToast('Agent-Key kopiert.');
    } catch {
      showToast('Kopieren nicht möglich.', { error: true });
    }
  });

  const profileColorInput = container.querySelector('#profile-color');
  const profileColorTrigger = container.querySelector('#profile-color-trigger');
  profileColorTrigger.addEventListener('click', () => openProfileColorPicker(profileColorInput, profileColorTrigger));

  container.querySelector('#profile-rotate-key')?.addEventListener('click', async () => {
    if (!(await confirmDialog('Agent-Key wirklich erneuern? Der aktuell installierte Agent muss danach neu eingerichtet werden.', {
      title: 'Agent-Key erneuern',
      confirmText: 'Erneuern',
      danger: true,
    }))) return;
    try {
      const result = await api.players.rotateApiKey(myId);
      apiKey = result.apiKey;
      if (copyKeyButton) copyKeyButton.disabled = false;
      showToast('Agent-Key erneuert. Der alte Key ist sofort ungültig.');
    } catch (error) {
      showToast(error.message, { error: true });
    }
  });

  container.querySelector('#agent-download')?.addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    btn.disabled = true;
    const originalLabel = btn.innerHTML;
    btn.textContent = 'Wird vorbereitet';
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

  container.querySelector('#push-toggle')?.addEventListener('click', async () => {
    const shouldEnable = pushState !== 'subscribed';
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

function wirePrivacyActions(container, ctx) {
  const reload = async () => {
    privacyState = null;
    await loadPrivacy(ctx, true);
  };
  container.querySelector('#privacy-retry')?.addEventListener('click', () => {
    privacyState = null;
    loadPrivacy(ctx, true);
  });
  container.querySelector('#privacy-details')?.addEventListener('click', () => {
    if (privacyState?.data) openPrivacyDetails(privacyState.data.trackingConsent);
  });
  container.querySelectorAll('[data-consent-event]').forEach((button) => {
    button.addEventListener('click', async () => {
      const granted = button.getAttribute('aria-pressed') !== 'true';
      button.disabled = true;
      try {
        await api.events.setTrackingConsent(
          button.dataset.consentEvent,
          granted,
          granted ? privacyState.data.trackingConsent.textVersion : undefined,
        );
        await reload();
        showToast(granted ? 'Tracking-Einwilligung gespeichert.' : 'Tracking-Einwilligung widerrufen. Weitere Erfassung ist gestoppt.');
      } catch (error) {
        button.disabled = false;
        showToast(error.message, { error: true });
      }
    });
  });
  container.querySelector('#privacy-auto-consent')?.addEventListener('click', async (event) => {
    const button = event.currentTarget;
    const enabled = button.getAttribute('aria-pressed') !== 'true';
    button.disabled = true;
    try {
      await api.privacy.setTrackingDefault(
        enabled,
        enabled ? privacyState.data.trackingConsent.textVersion : undefined,
      );
      await reload();
      showToast(
        enabled
          ? 'Neue trackbare Events werden künftig automatisch eingewilligt.'
          : 'Neue trackbare Events brauchen wieder deine ausdrückliche Einwilligung.',
      );
    } catch (error) {
      button.disabled = false;
      showToast(error.message, { error: true });
    }
  });
  // Revoking never carries a text version, so an outdated consent can always
  // be withdrawn through the ordinary event endpoint.
  container.querySelectorAll('[data-consent-legacy-event]').forEach((button) => {
    button.addEventListener('click', async () => {
      button.disabled = true;
      try {
        await api.events.setTrackingConsent(button.dataset.consentLegacyEvent, false);
        await reload();
        showToast('Frühere Event-Einwilligung widerrufen.');
      } catch (error) {
        button.disabled = false;
        showToast(error.message, { error: true });
      }
    });
  });
  container.querySelector('#privacy-export')?.addEventListener('click', async (event) => {
    const button = event.currentTarget;
    button.disabled = true;
    try {
      const { blob, filename } = await api.privacy.export();
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
      showToast('Persönlicher Datenexport heruntergeladen.');
    } catch (error) {
      showToast(error.message, { error: true });
    } finally {
      button.disabled = false;
    }
  });
  container.querySelector('#privacy-delete-account')?.addEventListener('click', async () => {
    const confirmed = await confirmDialog(
      'Dein Konto, persönliche Zugangsschlüssel, Sitzungen, Einwilligungen und zuordenbare Daten werden dauerhaft gelöscht. Historische Ergebnisse bleiben nur ohne deine Identität erhalten. Frei formulierte Erwähnungen durch andere können eine Prüfung der Orga erfordern. Offene Zahlungen, eigene Bestellungen, Fahrgemeinschaften, To-dos oder die letzte Admin- oder Ownerrolle müssen vorher geklärt werden.',
      { title: 'Konto dauerhaft löschen', confirmText: 'Dauerhaft löschen', danger: true },
    );
    if (!confirmed) return;
    try {
      const removed = await withStepUp(() => api.privacy.deleteAccount());
      if (removed === undefined) return;
      location.reload();
    } catch (error) {
      showToast(error.message, { error: true });
    }
  });
}
