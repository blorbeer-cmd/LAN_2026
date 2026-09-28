// First-login orientation. The tour owns only its progress; the product
// areas it introduces keep their existing state and APIs.

import { api } from './api.js';
import { state } from './state.js';
import { getMyId } from './whoami.js';
import { escapeHtml } from './format.js';
import { showToast } from './toast.js';
import { sectionEntryView } from './sectionNav.js';
import { eventHasFeature, viewIsEnabledForEvent } from './eventFeatures.js';

// Start with personal orientation, then explain the shared event context and
// the main LAN flows. The game catalog stays last so the tour ends on the
// page where players can optionally add their first ratings.

function navigationTarget(view, { compactFallback = view } = {}) {
  return `.desktop-nav-btn[data-view="${view}"], .nav-btn[data-view="${compactFallback}"]`;
}

export function visibleOnboardingTarget(selector, queryRoot = document) {
  return [...queryRoot.querySelectorAll(selector)]
    .find((element) => element.getClientRects().length > 0) ?? null;
}

export function buildOnboardingSteps() {
  const steps = [
    {
      title: 'Home',
      text: 'Hier siehst du auf einen Blick, wer online ist, was gerade gespielt wird und wie die Rangliste steht. Tippe im Live-Status auf eine Person, um ihr Profil mit Bock- und Skill-Werten zu öffnen.',
      view: 'home',
      target: navigationTarget('home'),
    },
    {
      title: 'Mein Profil',
      text: 'Im Profil verwaltest du Gamertag, Avatar-Farbe und deine Ansicht: Automatisch, Desktop oder Laptop. Hier richtest du bei Bedarf den Tracking-Agent für deinen PC und Push-Mitteilungen ein.',
      view: 'profile',
      target: navigationTarget('profile', { compactFallback: 'more' }),
    },
    {
      title: 'Orga',
      text: 'Hier plant ihr die LAN: Über Umfragen klärt ihr Termine und andere Fragen. Weitere Reiter zeigen An- und Abreise, Events, Packliste und To-Dos.',
      view: sectionEntryView('orga'),
      target: navigationTarget(sectionEntryView('orga'), { compactFallback: 'more' }),
    },
    {
      title: 'Aktives Event',
      text: 'Wähle oben im Header über den Eventnamen aus, in welchem Event du gerade bist.',
      view: 'home',
      target: '#event-context .search-select-control',
    },
    {
      title: 'Match',
      text: 'Hier lost ihr Teams aus, startet Captain-Drafts und legt Turniere an. Die Suchfelder in der Spieler- und Captain-Auswahl helfen euch, bei vielen Teilnehmenden schnell die richtigen Leute zu finden.',
      view: 'matchmaking',
      target: navigationTarget('matchmaking'),
    },
    {
      title: 'Vote',
      text: 'Hier startet ihr Abstimmungen, welche Spiele als Nächstes gespielt werden, und seht die Top 10 nach Bock-Level. Bei Gleichstand lässt sich direkt aus dem letzten Ergebnis eine Stichwahl starten.',
      view: 'votes',
      target: navigationTarget('votes'),
    },
    {
      title: 'Essen',
      text: 'Hier organisiert ihr Sammelbestellungen und seht pro Person Positionen, Gesamtbetrag und Bezahlstatus. Ist ein PayPal-Link hinterlegt, kannst du damit zahlen.',
      view: 'foodOrders',
      target: navigationTarget('foodOrders'),
    },
    {
      title: 'Spielekatalog',
      text: 'Bewerte die ersten zehn Spiele mit Bock und Skill. Bock unterstützt die Spielauswahl, Skill die Teamaufteilung.',
      view: 'gameCatalog',
    },
  ];
  return steps.filter((step) => viewIsEnabledForEvent(step.view, state.activeEvent));
}

function buildSteps() {
  return buildOnboardingSteps();
}

let runtime = null;
let candidateSyncPending = false;
let targetPositioningInstalled = false;

function root() {
  return document.getElementById('onboarding-root');
}

function isRatingActive() {
  return Boolean(runtime?.mode === 'rating' && runtime.state.ratingStatus === 'active' && runtime.state.ratingCandidateIds.length > 0);
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

export function focusOnboardingRatingControl() {
  if (runtime?.mode !== 'rating') return;
  document.querySelector('.game-table-row.onboarding-required .skill-row [data-rating-value]')?.focus();
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
  let target = runtime?.targetElement;
  const ring = runtime?.targetRing;
  if (!ring) return;
  if (!target || !document.contains(target)) {
    const step = runtime?.mode === 'core' ? runtime.steps[runtime.step] : null;
    target = step?.target ? visibleOnboardingTarget(step.target) : null;
    if (!target) return;
    runtime.targetElement = target;
  }
  if (target.getClientRects().length === 0) {
    const step = runtime?.mode === 'core' ? runtime.steps[runtime.step] : null;
    target = step?.target ? visibleOnboardingTarget(step.target) : null;
    if (!target) return;
    runtime.targetElement = target;
  }
  const rect = target.getBoundingClientRect();
  ring.style.left = `${rect.left}px`;
  ring.style.top = `${rect.top}px`;
  ring.style.width = `${rect.width}px`;
  ring.style.height = `${rect.height}px`;
}

function syncTarget() {
  clearTargetHighlight();
  const step = runtime?.mode === 'core' ? runtime.steps[runtime.step] : null;
  if (!step?.target) return;
  const target = visibleOnboardingTarget(step.target);
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
    ? document.querySelector('.game-table-row.onboarding-required .skill-row [data-rating-value]')
      ?? dialog.querySelector('button:not([disabled])')
    : focusableElements(dialog)[0];
  initialFocus?.focus();
  if (runtime?.mode === 'rating') window.setTimeout(focusOnboardingRatingControl, 0);
}

function renderCore() {
  const element = root();
  const step = runtime.steps[runtime.step];
  // A step with a target relies on the ring's own spotlight shadow (see
  // style.css) to dim the page while keeping the highlighted element at
  // full brightness. Adding the plain full-screen backdrop on top of that
  // would darken the highlighted element again, so it's only rendered for
  // steps with nothing to highlight.
  element.innerHTML = `
    ${step.target ? '' : '<div class="onboarding-backdrop" aria-hidden="true"></div>'}
    <section class="onboarding-dialog" role="dialog" tabindex="-1" aria-modal="true" aria-labelledby="onboarding-title" aria-describedby="onboarding-copy">
      <p class="onboarding-progress">Schritt ${runtime.step + 1} von ${runtime.steps.length}</p>
      <h2 id="onboarding-title">${escapeHtml(step.title)}</h2>
      <p id="onboarding-copy">${escapeHtml(step.text)}</p>
      <div class="onboarding-actions">
        <button type="button" class="btn" data-onboarding-skip>Tour überspringen</button>
        <span class="onboarding-actions-spacer"></span>
        <button type="button" class="btn" data-onboarding-back ${runtime.step === 0 ? 'disabled' : ''}>Zurück</button>
        <button type="button" class="btn btn-primary" data-onboarding-next>${runtime.step === runtime.steps.length - 1 ? 'Abschließen' : 'Weiter'}</button>
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
      <p class="onboarding-progress">Bewertung</p>
      <h2 id="onboarding-rating-title">Erste Spiele bewerten</h2>
      <p id="onboarding-rating-copy">Bewerte Bock und Skill für die ersten zehn Spiele. Bock unterstützt die Spielauswahl, Skill die Teamaufteilung.</p>
      <p class="onboarding-rating-progress" role="status">${progress.completed} von ${progress.required} Pflichtspielen vollständig bewertet.</p>
      <div class="onboarding-actions onboarding-rating-actions">
        <button type="button" class="btn" data-onboarding-all>Alle bewerten</button>
        <button type="button" class="btn" data-onboarding-later>Später</button>
        <button type="button" class="btn btn-primary" data-onboarding-finish ${progress.ready ? '' : 'disabled'}>Abschließen</button>
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
  const seenViews = Array.from(new Set([...runtime.state.seenViews, runtime.steps[runtime.step].view])).slice(-20);
  runtime.state = await api.onboarding.update({ ...patch, seenViews });
}

async function nextCoreStep() {
  if (runtime.step === runtime.steps.length - 1) {
    runtime.state = await api.onboarding.complete();
    closeOverlay();
    runtime.rerender();
    return;
  }
  runtime.step += 1;
  await saveCore({ status: 'active', lastCoreStep: runtime.step });
  runtime.navigate(runtime.steps[runtime.step].view);
  renderOverlay();
}

async function previousCoreStep() {
  if (runtime.step === 0) return;
  runtime.step -= 1;
  await saveCore({ status: 'active', lastCoreStep: runtime.step });
  runtime.navigate(runtime.steps[runtime.step].view);
  renderOverlay();
}

async function skipTour() {
  runtime.state = await api.onboarding.complete();
  closeOverlay();
  runtime.rerender();
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
    const steps = buildSteps();
    runtime = {
      state: onboardingState,
      mode: null,
      deferredThisSession: false,
      steps,
      step: Math.min(Math.max(onboardingState.lastCoreStep, 0), steps.length - 1),
      previousFocus: null,
      navigate,
      rerender,
      getCurrentView,
    };
    if (!targetPositioningInstalled) {
      targetPositioningInstalled = true;
      window.addEventListener('resize', syncOverlayGeometry);
      window.addEventListener('scroll', syncOverlayGeometry, true);
      window.addEventListener('respawn:layout-mode-changed', syncTarget);
    }
  } catch {
    runtime = null;
  }
}

export function maybeStartOnboarding() {
  if (!runtime || runtime.mode || runtime.deferredThisSession) return;
  // The tour ends in the game catalog and is therefore a LAN/game-area flow.
  // A general event must not force people through hidden gaming screens; the
  // pending state remains available when they later enter a LAN workspace.
  if (!eventHasFeature(state.activeEvent, 'games')) return;
  const shouldResumeCore = runtime.state.status === 'pending' || runtime.state.status === 'active';
  if (!shouldResumeCore) return;
  runtime.previousFocus = document.activeElement;
  runtime.steps = buildSteps();
  runtime.step = Math.min(Math.max(runtime.step, 0), runtime.steps.length - 1);
  runtime.mode = 'core';
  runtime.navigate(runtime.steps[runtime.step].view);
  renderOverlay();
}
