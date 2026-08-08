// First-login orientation and the mandatory first ten catalog ratings.
// The tour owns only its progress; games, skills and preferences remain in
// the existing shared state and APIs.

import { api } from './api.js';
import { state } from './state.js';
import { getMyId } from './whoami.js';

const STEPS = [
  { title: 'Willkommen', text: 'Diese kurze Einführung zeigt die wichtigsten Bereiche und Funktionen.', view: 'home' },
  { title: 'Home', text: 'Home zeigt aktuelle Aktivitäten, Live-Status, Rangliste und Sitzplan.', view: 'home', target: '.nav-btn[data-view="home"]' },
  { title: 'Turniere', text: 'Hier werden Turniere angelegt, gespielt und ausgewertet.', view: 'tournaments', target: '.nav-btn[data-view="tournaments"]' },
  { title: 'Teams', text: 'Hier werden Teams ausgelost oder per Captain Draft zusammengestellt.', view: 'matchmaking', target: '.nav-btn[data-view="matchmaking"]' },
  { title: 'Vote', text: 'Hier bewertet ihr Spiele und stimmt über die nächste Spielauswahl ab.', view: 'votes', target: '.nav-btn[data-view="votes"]' },
  { title: 'Rang', text: 'Hier findest du Ergebnisse, Punkte, Platzierungen und Spielzeiten.', view: 'leaderboard', target: '.nav-btn[data-view="leaderboard"]' },
  { title: 'Mehr', text: 'Hier erreichst du alle weiteren Bereiche wie Anreise, Essen, Arcade und Checkliste.', view: 'more', target: '.nav-btn[data-view="more"]' },
  { title: 'Profil und Suche', text: 'Im Profil verwaltest du deine persönlichen Angaben und Tracking-Einstellungen. Über die Suche erreichst du Bereiche und Inhalte direkt.', view: 'profile', target: '#profile-btn' },
  { title: 'Spielekatalog', text: 'Bewerte jetzt die ersten zehn Spiele. Bock verbessert die gemeinsame Spielauswahl. Skill ermöglicht eine ausgewogenere Teamaufteilung.', view: 'gameCatalog', target: '#view-container' },
];

let runtime = null;

function root() {
  return document.getElementById('onboarding-root');
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
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

export function onboardingRatingProgress() {
  const ids = requiredRatingIds();
  const myId = getMyId();
  if (!myId) return { completed: 0, required: ids.length, ready: false };
  const completed = ids.filter((gameId) =>
    state.skills.some((row) => row.player_id === myId && row.game_id === gameId)
      && state.preferences.some((row) => row.player_id === myId && row.game_id === gameId),
  ).length;
  return { completed, required: ids.length, ready: ids.length > 0 && completed >= ids.length };
}

function clearTargetHighlight() {
  document.querySelectorAll('.onboarding-target-highlight').forEach((element) => {
    element.classList.remove('onboarding-target-highlight');
  });
}

function syncTarget() {
  clearTargetHighlight();
  const step = runtime?.mode === 'core' ? STEPS[runtime.step] : null;
  if (!step?.target) return;
  const target = document.querySelector(step.target);
  if (!target) return;
  target.classList.add('onboarding-target-highlight');
  if (runtime.step > 0) {
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    target.scrollIntoView({ block: 'nearest', behavior: reducedMotion ? 'auto' : 'smooth' });
  }
}

function closeOverlay({ restoreFocus = true } = {}) {
  const previousFocus = runtime?.previousFocus;
  clearTargetHighlight();
  const element = root();
  if (element) element.innerHTML = '';
  if (restoreFocus && previousFocus instanceof HTMLElement && document.contains(previousFocus)) previousFocus.focus();
  if (runtime) {
    runtime.mode = null;
    runtime.previousFocus = null;
  }
}

function mascotHtml() {
  return `<div class="onboarding-mascot" aria-hidden="true"><img src="/img/guide-head.jpg" alt="" /></div>`;
}

function wireDialogFocus() {
  const dialog = root()?.querySelector('[role="dialog"]');
  if (!dialog) return;
  const focusable = dialog.querySelector('button:not([disabled]), [href], input, select, textarea, [tabindex]:not([tabindex="-1"])');
  focusable?.focus();
}

function renderCore() {
  const element = root();
  const step = STEPS[runtime.step];
  element.innerHTML = `
    <div class="onboarding-backdrop" aria-hidden="true"></div>
    <section class="onboarding-dialog" role="dialog" aria-modal="true" aria-labelledby="onboarding-title" aria-describedby="onboarding-copy">
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
  root().querySelector('[data-onboarding-next]').addEventListener('click', () => void nextCoreStep());
  root().querySelector('[data-onboarding-back]').addEventListener('click', () => void previousCoreStep());
  root().querySelector('[data-onboarding-skip]').addEventListener('click', () => void skipTour());
  syncTarget();
  wireDialogFocus();
}

function renderRating() {
  const element = root();
  const progress = onboardingRatingProgress();
  element.innerHTML = `
    <section class="onboarding-dialog onboarding-rating-dialog" role="dialog" aria-modal="false" aria-labelledby="onboarding-rating-title" aria-describedby="onboarding-rating-copy">
      ${mascotHtml()}
      <div class="onboarding-dialog-body">
        <p class="onboarding-progress">Bewertung</p>
        <h2 id="onboarding-rating-title">Erste Spiele bewerten</h2>
        <p id="onboarding-rating-copy">Bewerte Bock und Skill für die ersten zehn Spiele. Bock unterstützt die Spielauswahl, Skill die Teamaufteilung.</p>
        <p class="onboarding-rating-progress" role="status">${progress.completed} von ${progress.required} Pflichtspielen vollständig bewertet.</p>
        <div class="onboarding-actions onboarding-rating-actions">
          <button type="button" class="btn" data-onboarding-all>Alle Spiele bewerten</button>
          <button type="button" class="btn btn-primary" data-onboarding-finish ${progress.ready ? '' : 'disabled'}>Bewertung abschließen</button>
        </div>
      </div>
    </section>`;
  root().querySelector('[data-onboarding-all]').addEventListener('click', () => void includeAllGames());
  root().querySelector('[data-onboarding-finish]').addEventListener('click', () => void completeRating());
  wireDialogFocus();
}

function renderOverlay() {
  if (!runtime?.mode) return;
  if (runtime.mode === 'core') renderCore();
  else renderRating();
}

async function saveCore(patch) {
  runtime.state = await api.onboarding.update(patch);
}

async function nextCoreStep() {
  if (runtime.step === STEPS.length - 1) {
    runtime.state = await api.onboarding.rating.start({ includeAll: false });
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

export function refreshOnboardingRatingProgress() {
  if (runtime?.mode !== 'rating') return;
  const progress = onboardingRatingProgress();
  const progressEl = root()?.querySelector('.onboarding-rating-progress');
  if (progressEl) progressEl.textContent = `${progress.completed} von ${progress.required} Pflichtspielen vollständig bewertet.`;
  const finish = root()?.querySelector('[data-onboarding-finish]');
  if (finish) finish.disabled = !progress.ready;
}

export async function initOnboarding({ navigate, rerender, getCurrentView }) {
  if (!getMyId()) return;
  try {
    const onboardingState = await api.onboarding.get();
    runtime = {
      state: onboardingState,
      mode: null,
      step: Math.min(Math.max(onboardingState.lastCoreStep, 0), STEPS.length - 1),
      previousFocus: null,
      navigate,
      rerender,
      getCurrentView,
    };
  } catch {
    runtime = null;
  }
}

export function maybeStartOnboarding() {
  if (!runtime || runtime.mode) return;
  const shouldResumeCore = (runtime.state.status === 'pending' || runtime.state.status === 'active')
    && runtime.state.ratingStatus !== 'deferred'
    && runtime.state.ratingStatus !== 'completed';
  const shouldResumeRating = runtime.state.ratingStatus === 'active' && runtime.state.ratingCandidateIds.length > 0;
  if (!shouldResumeCore && !shouldResumeRating) return;
  runtime.previousFocus = document.activeElement;
  if (shouldResumeRating) {
    runtime.mode = 'rating';
    runtime.navigate('gameCatalog');
  } else {
    runtime.mode = 'core';
    runtime.navigate(STEPS[runtime.step].view);
  }
  renderOverlay();
}
