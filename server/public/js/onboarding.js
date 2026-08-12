// First-login orientation and the mandatory first ten catalog ratings.
// The tour owns only its progress; games, skills and preferences remain in
// the existing shared state and APIs.

import { api } from './api.js';
import { state } from './state.js';
import { getMyId } from './whoami.js';
import { escapeHtml } from './format.js';
import { showToast } from './toast.js';

const STEPS = [
  { title: 'Willkommen', text: 'Diese kurze Einführung zeigt die wichtigsten Bereiche und Funktionen.', view: 'home' },
  { title: 'Home', text: 'Home zeigt aktuelle Aktivitäten, den Live-Status aller Spielenden, die Rangliste und den Sitzplan auf einen Blick.', view: 'home', target: '.nav-btn[data-view="home"]' },
  { title: 'Wettkampf', text: 'Turniere und Teams liegen hier zusammen: Turniere anlegen und live verfolgen, Teams nach Skill-Level auslosen oder per Captain Draft zusammenstellen.', view: 'tournaments', target: '.nav-btn[data-view="tournaments"]' },
  { title: 'Vote', text: 'Hier startet und beantwortet ihr Abstimmungen zur nächsten Spielauswahl und seht die Top 10 nach Bock-Level.', view: 'votes', target: '.nav-btn[data-view="votes"]' },
  { title: 'Auswertung', text: 'Rangliste, Statistiken und Hall of Fame in einem Bereich: Punkte, Platzierungen, Spielzeit und die Champions vergangener LANs.', view: 'leaderboard', target: '.nav-btn[data-view="leaderboard"]' },
  { title: 'Mehr', text: 'Hier erreichst du alle weiteren Bereiche: Orga mit To-Dos, Packliste und An- & Abreise, dazu Essen, Arcade, Jam, Durchsagen und Spiele. Jeder dieser Bereiche erklärt sich beim ersten Öffnen kurz selbst.', view: 'more', target: '.nav-btn[data-view="more"]' },
  { title: 'Info, Profil und Suche', text: 'Das „i“ oben öffnet WLAN, Discord, Server-IPs und Hausregeln von jeder Ansicht aus. Im Profil verwaltest du deine persönlichen Angaben, deinen Tracking-Agent und Push-Benachrichtigungen. Über die Suche erreichst du Bereiche und Inhalte direkt.', view: 'profile', target: '#profile-btn' },
  { title: 'Spielekatalog', text: 'Bewerte jetzt die ersten zehn Spiele. Bock verbessert die gemeinsame Spielauswahl. Skill ermöglicht eine ausgewogenere Teamaufteilung.', view: 'gameCatalog' },
];

// Views reachable under "Mehr" that get their own short, one-time
// explanation on first visit instead of being crammed into the "Mehr" tour
// step's text (see onboardingHintHtml/wireOnboardingHint below).
const VIEW_HINTS = {
  checklist: 'Orga bündelt die Vorbereitung: Aufgaben und Mitbring-Anfragen für die Gruppe, deine persönliche Packliste und die Fahrgemeinschaften – jeweils ein Tab oben.',
  arrivals: 'Fahrgemeinschaften für An- und Abreise: Fahrten anlegen oder als Mitfahrer:in eintragen.',
  foodOrders: 'Sammelbestellungen: Positionen hinzufügen, eigenen Anteil markieren und die Bestellung gemeinsam abrechnen.',
  arcade: 'Kleine Zwischendurch-Spiele für 1 bis 8 Personen: Lobby öffnen oder einer offenen Lobby beitreten.',
  broadcast: 'Durchsagen an die ganze Gruppe senden, inklusive Verlauf der letzten Nachrichten.',
};

let runtime = null;
let candidateSyncPending = false;
let ratingResumePending = false;
let targetPositioningInstalled = false;

function root() {
  return document.getElementById('onboarding-root');
}

function isRatingActive() {
  return Boolean(runtime?.state?.ratingStatus === 'active' && runtime.state.ratingCandidateIds.length > 0);
}

function requiredRatingIds() {
  return (runtime?.state?.ratingCandidateIds ?? []).slice(0, 10);
}

export function isOnboardingRatingActive() {
  return isRatingActive();
}

export function onboardingRatingIds() {
  return runtime?.state?.ratingCandidateIds ?? [];
}

export function focusOnboardingRatingSlider() {
  if (runtime?.mode !== 'rating') return;
  document.querySelector('.game-table-row.onboarding-required input[type="range"]')?.focus();
}

export async function syncOnboardingRatingCandidates() {
  if (!isRatingActive() || candidateSyncPending) return;
  const availableIds = new Set(state.games.filter((game) => !game.isSuggestion).map((game) => game.id));
  if (!onboardingRatingIds().some((id) => !availableIds.has(id))) return;
  candidateSyncPending = true;
  try {
    const next = await api.onboarding.rating.start({ includeAll: onboardingRatingIds().length > 10 });
    runtime.state = next;
    if (next.ratingStatus === 'completed') closeOverlay();
    runtime.rerender();
  } catch (error) {
    await handleOnboardingError(error);
  } finally {
    candidateSyncPending = false;
  }
}

export function onboardingRatingProgress() {
  const ids = requiredRatingIds();
  const myId = getMyId();
  if (!myId) return { completed: 0, required: ids.length, ready: false };
  const completed = ids.filter((gameId) =>
    state.skills.some((row) => row.player_id === myId && row.game_id === gameId)
      && state.preferences.some((row) => row.player_id === myId && row.game_id === gameId),
  ).length;
  return { completed, required: ids.length, ready: ids.length === 0 || completed >= ids.length };
}

// A short, dismissible one-time explanation for a view reached under "Mehr"
// (see VIEW_HINTS above). Renders nothing once the view is already in
// seenViews, before the onboarding state has loaded, or for a view with no
// registered hint - safe to call unconditionally from any view's render
// function.
export function onboardingHintHtml(view) {
  const text = VIEW_HINTS[view];
  if (!text || !runtime || runtime.state.seenViews.includes(view)) return '';
  return `<div class="onboarding-view-hint" data-onboarding-hint="${view}" role="note">
    <p>${escapeHtml(text)}</p>
    <button type="button" class="btn btn-sm" data-onboarding-hint-dismiss>Verstanden</button>
  </div>`;
}

// Call once after rendering a view that used onboardingHintHtml, passing the
// same rerender callback the view's own controls use.
export function wireOnboardingHint(container, rerenderView) {
  const hint = container.querySelector('[data-onboarding-hint]');
  hint?.querySelector('[data-onboarding-hint-dismiss]')?.addEventListener('click', () => {
    void dismissOnboardingHint(hint.dataset.onboardingHint, rerenderView);
  });
}

async function dismissOnboardingHint(view, rerenderView) {
  if (!runtime || runtime.state.seenViews.includes(view)) return;
  const seenViews = Array.from(new Set([...runtime.state.seenViews, view])).slice(-20);
  try {
    runtime.state = await api.onboarding.update({ seenViews });
  } catch (error) {
    showToast(error?.message || 'Hinweis konnte nicht gespeichert werden.', { error: true });
    return;
  }
  rerenderView();
}

function clearTargetHighlight() {
  document.querySelectorAll('.onboarding-target-highlight').forEach((element) => {
    element.classList.remove('onboarding-target-highlight');
  });
  runtime?.targetRing?.remove();
  if (runtime) {
    runtime.targetRing = null;
    runtime.targetElement = null;
  }
}

function positionTargetRing() {
  const target = runtime?.targetElement;
  const ring = runtime?.targetRing;
  if (!target || !ring || !document.contains(target)) return;
  const rect = target.getBoundingClientRect();
  ring.style.left = `${rect.left}px`;
  ring.style.top = `${rect.top}px`;
  ring.style.width = `${rect.width}px`;
  ring.style.height = `${rect.height}px`;
  // The dialog defaults to a bottom anchor, which sits directly above a
  // target in the bottom nav - too close on short viewports for the ring
  // and the explanation text to stay visually separate. Flip the dialog to
  // the top for any target in the lower half of the viewport (currently:
  // every bottom-nav step) so the highlighted icon and the text never
  // compete for the same screen area.
  root()?.querySelector('.onboarding-dialog')?.classList.toggle('onboarding-dialog--top', rect.top > window.innerHeight / 2);
}

function syncTarget() {
  clearTargetHighlight();
  const step = runtime?.mode === 'core' ? STEPS[runtime.step] : null;
  if (!step?.target) {
    root()?.querySelector('.onboarding-dialog')?.classList.remove('onboarding-dialog--top');
    return;
  }
  const target = document.querySelector(step.target);
  if (!target) return;
  runtime.targetElement = target;
  const ring = document.createElement('div');
  ring.className = 'onboarding-target-ring';
  ring.setAttribute('aria-hidden', 'true');
  root()?.appendChild(ring);
  runtime.targetRing = ring;
  positionTargetRing();
  if (runtime.step > 0) {
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    target.scrollIntoView({ block: 'nearest', behavior: reducedMotion ? 'auto' : 'smooth' });
  }
}

// Keeps the required game rows scrollable clear of the fixed rating dialog
// (see .onboarding-rating-list in style.css) by mirroring the dialog's own
// rendered height into a CSS custom property. Re-measured on resize and
// whenever the dialog's content can change height (progress text digits,
// "Alle bewerten" widening the list).
function syncRatingSpacer() {
  const dialog = runtime?.mode === 'rating' ? root()?.querySelector('.onboarding-rating-dialog') : null;
  const height = dialog ? Math.ceil(dialog.getBoundingClientRect().height) : 0;
  document.documentElement.style.setProperty('--onboarding-rating-spacer', height ? `${height + 24}px` : '0px');
}

function syncOverlayGeometry() {
  if (runtime?.mode === 'core') positionTargetRing();
  else if (runtime?.mode === 'rating') syncRatingSpacer();
}

function closeOverlay({ restoreFocus = true } = {}) {
  const previousFocus = runtime?.previousFocus;
  clearTargetHighlight();
  document.documentElement.style.setProperty('--onboarding-rating-spacer', '0px');
  const element = root();
  if (element) element.innerHTML = '';
  if (restoreFocus && previousFocus instanceof HTMLElement && document.contains(previousFocus)) previousFocus.focus();
  if (runtime) {
    runtime.mode = null;
    runtime.previousFocus = null;
    runtime.targetElement = null;
    runtime.targetRing = null;
  }
  const app = document.getElementById('app');
  if (app) app.inert = false;
}

async function handleOnboardingError(error) {
  showToast(error?.message || 'Onboarding konnte nicht gespeichert werden.', { error: true });
  if (error?.status !== 409 || !runtime?.mode) return;
  try {
    const latest = await api.onboarding.get();
    runtime.state = latest;
    if (latest.ratingStatus === 'completed') {
      closeOverlay();
      runtime.rerender();
      return;
    }
    runtime.rerender();
    renderOverlay();
  } catch {
    // The original error toast is still actionable when the recovery request fails.
  }
}

// Two full copies of the same portrait, each clipped to one side of the
// mouth line and nudged apart on their own animation - the classic
// paper-cutout "talking head" look (upper head and lower jaw sliding apart
// with the mouth in between), rather than the whole head just bobbing.
function mascotHtml() {
  return `<div class="onboarding-mascot" aria-hidden="true">
    <div class="onboarding-mascot-half onboarding-mascot-half-top"><img src="/img/guide-head.jpg" alt="" /></div>
    <div class="onboarding-mascot-half onboarding-mascot-half-bottom"><img src="/img/guide-head.jpg" alt="" /></div>
  </div>`;
}

function focusableElements(container) {
  return [...container.querySelectorAll('button:not([disabled]), [href], input, select, textarea, [tabindex]:not([tabindex="-1"])')]
    .filter((element) => !element.hidden && element.getClientRects().length > 0);
}

function wireDialogFocus() {
  const dialog = root()?.querySelector('[role="dialog"]');
  if (!dialog) return;
  if (runtime?.mode === 'core') {
    dialog.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        void skipTour().catch(handleOnboardingError);
        return;
      }
      if (event.key !== 'Tab') return;
      const focusable = focusableElements(dialog);
      if (focusable.length === 0) {
        event.preventDefault();
        dialog.focus();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    });
  }
  const initialFocus = runtime?.mode === 'rating'
    ? document.querySelector('.game-table-row.onboarding-required input[type="range"]')
      ?? dialog.querySelector('button:not([disabled])')
    : focusableElements(dialog)[0];
  initialFocus?.focus();
  if (runtime?.mode === 'rating') window.setTimeout(focusOnboardingRatingSlider, 0);
}

function renderCore() {
  const element = root();
  const step = STEPS[runtime.step];
  // A step with a target relies on the ring's own spotlight shadow (see
  // style.css) to dim the page while keeping the highlighted element at
  // full brightness. Adding the plain full-screen backdrop on top of that
  // would darken the highlighted element again, so it's only rendered for
  // steps with nothing to highlight.
  element.innerHTML = `
    ${step.target ? '' : '<div class="onboarding-backdrop" aria-hidden="true"></div>'}
    <section class="onboarding-dialog" role="dialog" tabindex="-1" aria-modal="true" aria-labelledby="onboarding-title" aria-describedby="onboarding-copy">
      ${mascotHtml()}
      <div class="onboarding-dialog-body">
        <p class="onboarding-progress">Schritt ${runtime.step + 1} von ${STEPS.length}</p>
        <h2 id="onboarding-title">${escapeHtml(step.title)}</h2>
        <p id="onboarding-copy">${escapeHtml(step.text)}</p>
        <div class="onboarding-actions">
          <button type="button" class="btn" data-onboarding-skip>Tour überspringen</button>
          <span class="onboarding-actions-spacer"></span>
          <button type="button" class="btn" data-onboarding-back ${runtime.step === 0 ? 'disabled' : ''}>Zurück</button>
          <button type="button" class="btn btn-primary" data-onboarding-next>${runtime.step === STEPS.length - 1 ? 'Bewertungen öffnen' : 'Weiter'}</button>
        </div>
      </div>
    </section>`;
  root().querySelector('[data-onboarding-next]').addEventListener('click', () => void nextCoreStep().catch(handleOnboardingError));
  root().querySelector('[data-onboarding-back]').addEventListener('click', () => void previousCoreStep().catch(handleOnboardingError));
  root().querySelector('[data-onboarding-skip]').addEventListener('click', () => void skipTour().catch(handleOnboardingError));
  syncTarget();
  wireDialogFocus();
}

function renderRating() {
  const element = root();
  const progress = onboardingRatingProgress();
  element.innerHTML = `
    <section class="onboarding-dialog onboarding-rating-dialog" role="dialog" tabindex="-1" aria-modal="false" aria-labelledby="onboarding-rating-title" aria-describedby="onboarding-rating-copy">
      ${mascotHtml()}
      <div class="onboarding-dialog-body">
        <p class="onboarding-progress">Bewertung</p>
        <h2 id="onboarding-rating-title">Erste Spiele bewerten</h2>
        <p id="onboarding-rating-copy">Bewerte Bock und Skill für die ersten zehn Spiele. Bock unterstützt die Spielauswahl, Skill die Teamaufteilung.</p>
        <p class="onboarding-rating-progress" role="status">${progress.completed} von ${progress.required} Pflichtspielen vollständig bewertet.</p>
        <div class="onboarding-actions onboarding-rating-actions">
          <button type="button" class="btn" data-onboarding-all>Alle bewerten</button>
          <button type="button" class="btn" data-onboarding-later>Später</button>
          <button type="button" class="btn btn-primary" data-onboarding-finish ${progress.ready ? '' : 'disabled'}>Abschließen</button>
        </div>
      </div>
    </section>`;
  root().querySelector('[data-onboarding-all]').addEventListener('click', () => void includeAllGames().catch(handleOnboardingError));
  root().querySelector('[data-onboarding-later]').addEventListener('click', () => void deferRating().catch(handleOnboardingError));
  root().querySelector('[data-onboarding-finish]').addEventListener('click', () => void completeRating().catch(handleOnboardingError));
  wireDialogFocus();
  syncRatingSpacer();
}

function renderOverlay() {
  if (!runtime?.mode) return;
  const app = document.getElementById('app');
  if (app) app.inert = runtime.mode === 'core';
  if (runtime.mode === 'core') renderCore();
  else renderRating();
}

async function saveCore(patch) {
  const seenViews = Array.from(new Set([...runtime.state.seenViews, STEPS[runtime.step].view])).slice(-20);
  runtime.state = await api.onboarding.update({ ...patch, seenViews });
}

async function nextCoreStep() {
  if (runtime.step === STEPS.length - 1) {
    runtime.state = await api.onboarding.rating.start({ includeAll: false });
    clearTargetHighlight();
    if (runtime.state.ratingStatus === 'completed') {
      closeOverlay();
      runtime.rerender();
      return;
    }
    runtime.mode = 'rating';
    runtime.navigate('gameCatalog');
    renderOverlay();
    return;
  }
  runtime.step += 1;
  await saveCore({ status: 'active', lastCoreStep: runtime.step });
  runtime.navigate(STEPS[runtime.step].view);
  renderOverlay();
}

async function previousCoreStep() {
  if (runtime.step === 0) return;
  runtime.step -= 1;
  await saveCore({ status: 'active', lastCoreStep: runtime.step });
  runtime.navigate(STEPS[runtime.step].view);
  renderOverlay();
}

async function skipTour() {
  runtime.state = await api.onboarding.rating.start({ includeAll: false });
  clearTargetHighlight();
  if (runtime.state.ratingStatus === 'completed') {
    closeOverlay();
    runtime.rerender();
    return;
  }
  runtime.mode = 'rating';
  runtime.navigate('gameCatalog');
  renderOverlay();
}

async function includeAllGames() {
  runtime.state = await api.onboarding.rating.start({ includeAll: true });
  runtime.rerender();
  renderOverlay();
}

async function completeRating() {
  const progress = onboardingRatingProgress();
  if (!progress.ready) return;
  runtime.state = await api.onboarding.rating.complete();
  closeOverlay();
  runtime.rerender();
}

async function deferRating() {
  runtime.state = await api.onboarding.rating.defer();
  runtime.deferredThisSession = true;
  closeOverlay();
  runtime.rerender();
}

async function resumeDeferredRating() {
  if (ratingResumePending || !runtime) return;
  ratingResumePending = true;
  try {
    runtime.state = await api.onboarding.rating.start({ includeAll: runtime.state.ratingCandidateIds.length > 10 });
    if (runtime.state.ratingStatus === 'completed') {
      closeOverlay();
      runtime.rerender();
      return;
    }
    runtime.mode = 'rating';
    runtime.navigate('gameCatalog');
    renderOverlay();
  } finally {
    ratingResumePending = false;
  }
}

export function refreshOnboardingRatingProgress() {
  if (runtime?.mode !== 'rating') return;
  const progress = onboardingRatingProgress();
  const progressEl = root()?.querySelector('.onboarding-rating-progress');
  if (progressEl) progressEl.textContent = `${progress.completed} von ${progress.required} Pflichtspielen vollständig bewertet.`;
  const finish = root()?.querySelector('[data-onboarding-finish]');
  if (finish) finish.disabled = !progress.ready;
  syncRatingSpacer();
}

export async function initOnboarding({ navigate, rerender, getCurrentView }) {
  if (!getMyId()) return;
  try {
    const onboardingState = await api.onboarding.get();
    runtime = {
      state: onboardingState,
      mode: null,
      deferredThisSession: false,
      step: Math.min(Math.max(onboardingState.lastCoreStep, 0), STEPS.length - 1),
      previousFocus: null,
      navigate,
      rerender,
      getCurrentView,
    };
    if (!targetPositioningInstalled) {
      targetPositioningInstalled = true;
      window.addEventListener('resize', syncOverlayGeometry);
      window.addEventListener('scroll', syncOverlayGeometry, true);
    }
  } catch {
    runtime = null;
  }
}

export function maybeStartOnboarding() {
  if (!runtime || runtime.mode || runtime.deferredThisSession) return;
  const shouldResumeCore = (runtime.state.status === 'pending' || runtime.state.status === 'active')
    && runtime.state.ratingStatus !== 'deferred'
    && runtime.state.ratingStatus !== 'completed';
  const shouldResumeRating = ['active', 'deferred'].includes(runtime.state.ratingStatus)
    && runtime.state.ratingCandidateIds.length > 0;
  if (!shouldResumeCore && !shouldResumeRating) return;
  runtime.previousFocus = document.activeElement;
  if (runtime.state.ratingStatus === 'deferred') {
    void resumeDeferredRating().catch(handleOnboardingError);
    return;
  }
  if (shouldResumeRating) {
    runtime.mode = 'rating';
    runtime.navigate('gameCatalog');
  } else {
    runtime.mode = 'core';
    runtime.navigate(STEPS[runtime.step].view);
  }
  renderOverlay();
}
