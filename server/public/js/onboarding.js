// First-login orientation and the mandatory first ten catalog ratings.
// The tour owns only its progress; games, skills and preferences remain in
// the existing shared state and APIs.

import { api } from './api.js';
import { state } from './state.js';
import { getMyId } from './whoami.js';
import { escapeHtml } from './format.js';
import { showToast } from './toast.js';
import { currentPlayerHasAdminRole } from './adminAccess.js';
import { sectionEntryView } from './sectionNav.js';
import { eventHasFeature, viewIsEnabledForEvent } from './eventFeatures.js';

// Ordered to match the bottom nav (Home, Match, Vote, Essen), then the
// individual areas under "Mehr" (which itself sits after Essen in the nav),
// and finally the game catalog last since its own step is what hands off
// into the mandatory rating mode below (see nextCoreStep()). Admin-only
// insights are appended only for admins, after the Admin step has introduced
// their entry point.
const MEHR_TARGET = '.nav-btn[data-view="more"]';

export function buildOnboardingSteps(isAdmin = currentPlayerHasAdminRole()) {
  const steps = [
    {
      title: 'Home',
      text: 'Hier siehst du auf einen Blick, wer online ist, was gerade gespielt wird und wie die Rangliste steht. Tippe im Live-Status auf eine Person, um ihr Profil mit Bock- und Skill-Werten zu öffnen.',
      view: 'home',
      target: '.nav-btn[data-view="home"]',
    },
    {
      title: 'Match',
      text: 'Hier lost ihr Teams aus, startet Captain-Drafts und legt Turniere an. Die Suchfelder in der Spieler- und Captain-Auswahl helfen euch, bei vielen Teilnehmenden schnell die richtigen Leute zu finden.',
      view: 'matchmaking',
      target: '.nav-btn[data-view="matchmaking"]',
    },
    {
      title: 'Vote',
      text: 'Hier startet ihr Abstimmungen, welche Spiele als Nächstes gespielt werden, und seht die Top 10 nach Bock-Level. Bei Gleichstand lässt sich direkt aus dem letzten Ergebnis eine Stichwahl starten.',
      view: 'votes',
      target: '.nav-btn[data-view="votes"]',
    },
    {
      title: 'Essen',
      text: 'Hier organisiert ihr Sammelbestellungen mit Artikeln, Preisen und Bezahlstatus. Jede Person bezahlt ihren vollständigen Block über PayPal und bestätigt ihn anschließend mit „Bezahlt?“',
      view: 'foodOrders',
      target: '.nav-btn[data-view="foodOrders"]',
    },
    {
      title: 'Mehr',
      text: 'Hier findet ihr weitere Bereiche wie Profil, Arcade, Durchsage, Jam und Orga. Über die Suche oben (oder Strg/Cmd+K am Laptop) erreicht ihr jeden Bereich und Inhalt auch direkt, ohne über Mehr zu navigieren.',
      view: 'more',
      target: MEHR_TARGET,
    },
    {
      title: 'Mein Profil',
      text: 'Im Profil verwaltest du Avatar-Farbe, Gamertag und den Tracking-Agent für deinen PC. Aktiviere Push, um Durchsagen und wichtige Updates auch außerhalb der App zu bekommen.',
      view: 'profile',
      target: MEHR_TARGET,
    },
    {
      title: 'Arcade',
      text: 'Hier spielt ihr Zwischendurch-Games wie Tetris, Snake oder Pong gegeneinander in eigenen Lobbys. Unter Statistiken seht ihr eure persönliche Bilanz für jedes Arcade-Spiel.',
      view: 'arcade',
      target: MEHR_TARGET,
    },
    {
      title: 'Durchsage',
      text: 'Hier verschickt ihr Durchsagen an alle im Netzwerk, zum Beispiel wenn das Essen da ist. Die letzten Durchsagen bleiben in der Historie nachlesbar, falls jemand eine verpasst hat.',
      view: 'broadcast',
      target: MEHR_TARGET,
    },
    {
      title: 'Jam',
      text: 'Hier steuert ihr gemeinsam die Musik: Titel suchen, zur Warteschlange hinzufügen und die Reihenfolge per Drag & Drop anpassen. Nur das Gerät, das die Session startet, braucht einen Spotify-Zugang.',
      view: 'music',
      target: MEHR_TARGET,
    },
    {
      title: 'Orga',
      text: 'Hier organisiert ihr die LAN mit An- und Abreise, Events, Packliste und To-Do-Liste als eigene Reiter. Im To-Do-Reiter siehst du unter „Mir zugewiesen“ sofort deine eigenen offenen Aufgaben inklusive Fälligkeit.',
      view: sectionEntryView('orga'),
      target: MEHR_TARGET,
    },
  ];
  if (isAdmin) {
    steps.push({
      title: 'Admin',
      text: 'Hier behältst du als Admin die LAN-Bereitschaft im Blick und verwaltest Nutzer, Sitzplan und Backups. Über den Werkzeug-Eintrag „Auswertung“ erreichst du außerdem Rangliste, Statistiken und Hall of Fame, die sonst nirgends verlinkt sind.',
      view: 'admin',
      target: MEHR_TARGET,
    });
    steps.push({
      title: 'Event-Auswahl',
      text: 'In den Auswertungen kannst du Spielzeit, Matches, Turniere und Arcade-Ergebnisse nach Event filtern. Achte vor jeder Auswertung darauf, welches Event im Dropdown ausgewählt ist – sonst siehst du möglicherweise die Daten einer anderen LAN oder aller Events.',
      view: 'analytics',
      target: 'section[aria-label="Ansicht"] .search-select-control',
    });
  }
  steps.push({
    title: 'Spielekatalog',
    text: 'Bewerte die ersten zehn Spiele mit Bock und Skill. Bock unterstützt die Spielauswahl, Skill die Teamaufteilung; die Chips „Bock offen“ und „Skill offen“ helfen dir später, schnell noch unbewertete Spiele zu finden.',
    view: 'gameCatalog',
  });
  return steps.filter((step) => viewIsEnabledForEvent(step.view, state.activeEvent));
}

function buildSteps() {
  return buildOnboardingSteps();
}

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
    target = step?.target ? document.querySelector(step.target) : null;
    if (!target) return;
    runtime.targetElement = target;
  }
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
  const step = runtime?.mode === 'core' ? runtime.steps[runtime.step] : null;
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
        <button type="button" class="btn btn-primary" data-onboarding-next>${runtime.step === runtime.steps.length - 1 ? 'Bewertungen öffnen' : 'Weiter'}</button>
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
    }
  } catch {
    runtime = null;
  }
}

export function maybeStartOnboarding() {
  if (!runtime || runtime.mode || runtime.deferredThisSession) return;
  // The current onboarding culminates in mandatory Bock/Skill ratings and is
  // therefore a LAN/game-area flow. A general event must not force people
  // through hidden gaming screens; the pending state remains available when
  // they later enter a LAN workspace.
  if (!eventHasFeature(state.activeEvent, 'games')) return;
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
    // Player data (and with it the admin role the step list depends on) may
    // still be loading when initOnboarding() first builds runtime.steps -
    // refresh it here, right before the tour actually becomes visible, and
    // re-clamp the saved step index against the now-current step count.
    runtime.steps = buildSteps();
    runtime.step = Math.min(Math.max(runtime.step, 0), runtime.steps.length - 1);
    runtime.mode = 'core';
    runtime.navigate(runtime.steps[runtime.step].view);
  }
  renderOverlay();
}
