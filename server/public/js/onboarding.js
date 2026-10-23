// First-login orientation. The tour owns only its progress; the product
// areas it introduces keep their existing state and APIs.

import { api } from './api.js';
import { state } from './state.js';
import { getMyId } from './whoami.js';
import { escapeHtml } from './format.js';
import { icon } from './icons.js';
import { showToast } from './toast.js';
import { sectionEntryView } from './sectionNav.js';
import { eventHasFeature, viewIsEnabledForEvent } from './eventFeatures.js';

// Every account sees the LAN trailer once: new accounts right before the
// tour, existing accounts on their next start. The server streams its own
// 1440p file, so quality and sound do not depend on YouTube and the video
// also plays on a LAN without internet.
const WELCOME_TRAILER_VIDEO_URL = '/api/me/onboarding/trailer/video';
const WELCOME_TRAILER_POSTER_URL = '/api/me/onboarding/trailer/poster';

// Start with personal orientation, then explain the shared event context and
// the main LAN flows. The game catalog stays last so the tour ends on the
// page where players can optionally add their first ratings.
export const ONBOARDING_SKILL_COPY = 'Hinterlege vor der LAN unter Spiele deinen Skill für ausgeglichene Teams. Bock ist optional; während der LAN kannst du ihn über „Bock übernehmen“ aus Votes speichern.';

function navigationTarget(view, { compactFallback = view } = {}) {
  return `.desktop-nav-btn[data-view="${view}"], .nav-btn[data-view="${compactFallback}"]`;
}

export function visibleOnboardingTarget(selector, queryRoot = document) {
  // These target lists are ordered alternatives: prefer the explained
  // control even when a fallback navigation button precedes it in the DOM.
  for (const alternative of selector.split(',')) {
    const visible = [...queryRoot.querySelectorAll(alternative.trim())]
      .find((element) => element.getClientRects().length > 0);
    if (visible) return visible;
  }
  return null;
}

export function buildOnboardingSteps() {
  const steps = [
    {
      title: 'Home',
      text: 'Home zeigt Live-Status und aktuelle Vorgänge. Das Fragezeichen neben jedem Bereichstitel öffnet kurze Touren zu dessen Funktionen – auch später jederzeit.',
      view: 'home',
      target: `#view-container [data-area-tour-open="home"], ${navigationTarget('home')}`,
    },
    {
      title: 'Mein Profil',
      text: 'Im Profil verwaltest du Gamertag, Avatar-Farbe und deine Ansicht: Automatisch, Desktop oder Laptop. Hier richtest du bei Bedarf den Agent für Spiele-Tracking auf deinem PC und Push-Benachrichtigungen ein.',
      view: 'profile',
      target: navigationTarget('profile', { compactFallback: 'more' }),
    },
    {
      title: 'Orga',
      text: 'Umfragen, An- & Abreise, Packliste und To-Dos helfen bei der LAN-Planung. Events und Gruppen verwaltest du separat über Events & Gruppen.',
      view: sectionEntryView('orga'),
      target: navigationTarget(sectionEntryView('orga'), { compactFallback: 'more' }),
    },
    {
      title: 'Ausgewähltes Event',
      text: 'Wähle oben im Header über den Eventnamen aus, in welchem Event du gerade bist.',
      view: 'home',
      target: '#event-context .search-select-control',
    },
    {
      title: 'Match',
      text: 'Hier lost ihr ausgeglichene Teams aus und legt Turniere an. Admins können einen Captain Draft starten, bei dem Captains ihre Mitspieler wählen.',
      view: 'matchmaking',
      target: navigationTarget('matchmaking'),
    },
    {
      title: 'Vote',
      text: 'Hier startet ihr Abstimmungen, welche Spiele als Nächstes gespielt werden, und seht die Top 10 nach Bock-Level. Bei Gleichstand können Admins direkt aus dem letzten Ergebnis eine Stichwahl starten.',
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
      title: 'Spiele',
      text: ONBOARDING_SKILL_COPY,
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
  document.querySelector('.game-table-row.onboarding-required .skill-row[data-kind="skill"] [data-rating-value]')?.focus();
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
    state.skills.some((row) => row.player_id === myId && row.game_id === gameId),
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
// "Alle Spiele zeigen" widening the list).
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
  return [...container.querySelectorAll('button:not([disabled]), [href], input, select, textarea, video[controls], [tabindex]:not([tabindex="-1"])')]
    .filter((element) => !element.hidden && element.getClientRects().length > 0);
}

function wireDialogFocus() {
  const dialog = root()?.querySelector('[role="dialog"]');
  if (!dialog) return;
  if (runtime?.mode === 'core' || runtime?.mode === 'trailer') {
    const onEscape = runtime.mode === 'trailer' ? continueAfterTrailer : skipTour;
    dialog.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        void onEscape().catch(handleOnboardingError);
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
    ? document.querySelector('.game-table-row.onboarding-required .skill-row[data-kind="skill"] [data-rating-value]')
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

// The trailer fills the whole page and starts at once, muted where the browser
// refuses sound (agreed with the organizers). Controls stay small and out of
// the picture: sound bottom left, skip bottom right, fullscreen top right. A
// large play button only appears when the browser blocks even muted playback.
const TRAILER_SOUND = {
  on: { icon: 'volumeOn', label: 'Ton aus' },
  off: { icon: 'volumeOff', label: 'Ton an' },
};

function renderTrailer() {
  root().innerHTML = `
    <section class="onboarding-trailer" role="dialog" tabindex="-1" aria-modal="true" aria-label="Willkommen bei Respawn: LAN 2026 Trailer" data-state="loading">
      <video src="${WELCOME_TRAILER_VIDEO_URL}" ${runtime.trailer.hasPoster ? `poster="${WELCOME_TRAILER_POSTER_URL}"` : ''}
        preload="auto" playsinline aria-hidden="true"></video>
      <p class="onboarding-trailer-status" role="status"></p>
      <div class="onboarding-trailer-start-wrap" hidden>
        <button type="button" class="onboarding-trailer-start" data-onboarding-trailer-start aria-label="Trailer abspielen">${icon('play')}</button>
        <span class="onboarding-trailer-start-label" aria-hidden="true">Trailer abspielen</span>
      </div>
      <button type="button" class="onboarding-trailer-control onboarding-trailer-fullscreen" data-onboarding-trailer-fullscreen hidden></button>
      <div class="onboarding-trailer-bar">
        <button type="button" class="onboarding-trailer-control onboarding-trailer-sound" data-onboarding-trailer-sound hidden></button>
        <span class="onboarding-actions-spacer"></span>
        <button type="button" class="onboarding-trailer-control" data-onboarding-trailer-next>Überspringen${icon('chevronRight')}</button>
      </div>
      <div class="onboarding-trailer-progress" aria-hidden="true"><span></span></div>
    </section>`;
  const section = root().querySelector('.onboarding-trailer');
  const video = section.querySelector('video');
  section.querySelector('[data-onboarding-trailer-next]').addEventListener('click', () => void continueAfterTrailer().catch(handleOnboardingError));
  section.querySelector('[data-onboarding-trailer-start]').addEventListener('click', () => void playTrailerWithSound());
  section.querySelector('[data-onboarding-trailer-sound]').addEventListener('click', toggleTrailerSound);
  section.querySelector('[data-onboarding-trailer-fullscreen]').addEventListener('click', () => void toggleTrailerFullscreen());
  // A tap on the picture does the obvious thing: start, or switch the sound on.
  video.addEventListener('click', () => {
    if (trailerState() === 'idle') void playTrailerWithSound();
    else if (video.muted) toggleTrailerSound();
  });
  video.addEventListener('timeupdate', () => {
    const progress = video.duration ? video.currentTime / video.duration : 0;
    section.querySelector('.onboarding-trailer-progress span').style.transform = `scaleX(${progress})`;
  });
  video.addEventListener('volumechange', renderTrailerSound);
  video.addEventListener('ended', () => void continueAfterTrailer().catch(handleOnboardingError));
  video.addEventListener('error', () => setTrailerState('error'));
  document.addEventListener('fullscreenchange', renderTrailerFullscreen);
  renderTrailerFullscreen();
  setTrailerState('loading');
  wireDialogFocus();
  // Focus the player itself: Escape and Tab work at once, and no control
  // carries a focus ring before anyone pressed a key.
  section.focus();
  // Right after registering the click still counts as a fresh interaction,
  // which is the only moment a browser lets a page enter real fullscreen.
  if (navigator.userActivation?.isActive) void toggleTrailerFullscreen();
  void startTrailer();
}

function trailerSection() {
  return root()?.querySelector('.onboarding-trailer') ?? null;
}

function trailerVideo() {
  return trailerSection()?.querySelector('video') ?? null;
}

function trailerState() {
  return trailerSection()?.dataset.state;
}

const TRAILER_STATUS = {
  loading: 'Lädt …',
  error: 'Video konnte nicht geladen werden',
};

function setTrailerState(stateName) {
  const section = trailerSection();
  if (!section) return;
  section.dataset.state = stateName;
  const status = section.querySelector('.onboarding-trailer-status');
  status.textContent = TRAILER_STATUS[stateName] ?? '';
  status.hidden = !TRAILER_STATUS[stateName];
  const start = section.querySelector('[data-onboarding-trailer-start]');
  const next = section.querySelector('[data-onboarding-trailer-next]');
  const startHadFocus = document.activeElement === start;
  start.parentElement.hidden = stateName !== 'idle';
  start.hidden = stateName !== 'idle';
  renderTrailerSound();
  // Keep keyboard focus inside the trailer when the focused control hides.
  if (!start.hidden && (document.activeElement === next || document.activeElement === section)) start.focus();
  else if (start.hidden && startHadFocus) next.focus();
}

function renderTrailerSound() {
  const section = trailerSection();
  const video = trailerVideo();
  if (!section || !video) return;
  const button = section.querySelector('[data-onboarding-trailer-sound]');
  button.hidden = trailerState() !== 'playing';
  const view = video.muted ? TRAILER_SOUND.off : TRAILER_SOUND.on;
  button.toggleAttribute('data-muted', video.muted);
  button.innerHTML = `${icon(view.icon)}<span>${view.label}</span>`;
}

function toggleTrailerSound() {
  const video = trailerVideo();
  if (video) video.muted = !video.muted;
}

function trailerFullscreenElement() {
  return document.fullscreenElement ?? document.webkitFullscreenElement ?? null;
}

function renderTrailerFullscreen() {
  const section = trailerSection();
  if (!section) {
    document.removeEventListener('fullscreenchange', renderTrailerFullscreen);
    return;
  }
  const button = section.querySelector('[data-onboarding-trailer-fullscreen]');
  const supported = Boolean(section.requestFullscreen ?? section.webkitRequestFullscreen);
  button.hidden = !supported;
  const active = trailerFullscreenElement() === section;
  button.innerHTML = icon(active ? 'minimize' : 'maximize');
  button.setAttribute('aria-label', active ? 'Vollbild beenden' : 'Vollbild');
  button.title = active ? 'Vollbild beenden' : 'Vollbild';
}

async function toggleTrailerFullscreen() {
  const section = trailerSection();
  if (!section) return;
  try {
    if (trailerFullscreenElement() === section) await exitTrailerFullscreen();
    else await (section.requestFullscreen ?? section.webkitRequestFullscreen)?.call(section);
  } catch {
    // Without a fresh click the browser refuses; the page-filling view stays.
  }
}

async function exitTrailerFullscreen() {
  if (!trailerFullscreenElement()) return;
  try {
    await (document.exitFullscreen ?? document.webkitExitFullscreen)?.call(document);
  } catch {
    // Leaving fullscreen can only fail when it already ended.
  }
}

// Sound first where the browser allows it (after registering, or for a site it
// knows well), otherwise muted. Only if even muted playback is refused does
// the large play button wait for a click.
async function startTrailer() {
  const video = trailerVideo();
  if (!video) return;
  if (await tryPlay(video, { muted: false })) return;
  if (trailerState() === 'error') return;
  if (await tryPlay(video, { muted: true })) return;
  if (trailerState() !== 'error') setTrailerState('idle');
}

async function tryPlay(video, { muted }) {
  video.muted = muted;
  try {
    await video.play();
  } catch {
    return false;
  }
  setTrailerState('playing');
  return true;
}

// A click is the user gesture every browser accepts for sound.
async function playTrailerWithSound() {
  const video = trailerVideo();
  if (!video) return;
  setTrailerState('loading');
  if (!(await tryPlay(video, { muted: false })) && trailerState() !== 'error') setTrailerState('idle');
}

function renderRating() {
  const element = root();
  const progress = onboardingRatingProgress();
  element.innerHTML = `
    <section class="onboarding-dialog onboarding-rating-dialog" role="dialog" tabindex="-1" aria-modal="false" aria-labelledby="onboarding-rating-title" aria-describedby="onboarding-rating-copy">
      <p class="onboarding-progress">Bewertung</p>
      <h2 id="onboarding-rating-title">Skill vor der LAN hinterlegen</h2>
      <p id="onboarding-rating-copy">${escapeHtml(ONBOARDING_SKILL_COPY)}</p>
      <p class="onboarding-rating-progress" role="status">${progress.completed} von ${progress.required} Spielen mit Skill bewertet.</p>
      <div class="onboarding-actions onboarding-rating-actions">
        <button type="button" class="btn" data-onboarding-all>Alle Spiele zeigen</button>
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
  if (app) app.inert = runtime.mode === 'core' || runtime.mode === 'trailer';
  if (runtime.mode === 'trailer') renderTrailer();
  else if (runtime.mode === 'core') renderCore();
  else renderRating();
}

// Marks the trailer as seen and hands over to the tour, if one is due. A
// failed save must not trap the player in front of a video, so the dialog
// closes either way and the trailer simply returns on the next start.
async function continueAfterTrailer() {
  if (runtime?.mode !== 'trailer') return;
  trailerVideo()?.pause();
  void exitTrailerFullscreen();
  runtime.trailer = { ...runtime.trailer, seen: true };
  if (shouldResumeCore()) {
    runtime.mode = 'core';
    renderOverlay();
  } else {
    closeOverlay();
  }
  runtime.trailer = await api.onboarding.trailer.seen();
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
  if (progressEl) progressEl.textContent = `${progress.completed} von ${progress.required} Spielen mit Skill bewertet.`;
  const finish = root()?.querySelector('[data-onboarding-finish]');
  if (finish) finish.disabled = !progress.ready;
  syncRatingSpacer();
}

export async function initOnboarding({ navigate, rerender, getCurrentView }) {
  if (!getMyId()) return;
  try {
    const [onboardingState, trailer] = await Promise.all([
      api.onboarding.get(),
      api.onboarding.trailer.get().catch(() => ({ available: false, hasPoster: false, seen: true })),
    ]);
    const steps = buildSteps();
    runtime = {
      state: onboardingState,
      trailer,
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

// The tour ends in the game catalog and is therefore a LAN/game-area flow.
// A general event must not force people through hidden gaming screens; the
// pending state remains available when they later enter a LAN workspace.
function shouldResumeCore() {
  return eventHasFeature(state.activeEvent, 'games')
    && (runtime.state.status === 'pending' || runtime.state.status === 'active');
}

function shouldShowTrailer() {
  return Boolean(runtime.trailer?.available && !runtime.trailer.seen);
}

export function maybeStartOnboarding() {
  if (!runtime || runtime.mode || runtime.deferredThisSession) return;
  const showTrailer = shouldShowTrailer();
  const resumeCore = shouldResumeCore();
  if (!showTrailer && !resumeCore) return;
  runtime.previousFocus = document.activeElement;
  runtime.steps = buildSteps();
  runtime.step = Math.min(Math.max(runtime.step, 0), runtime.steps.length - 1);
  runtime.mode = showTrailer ? 'trailer' : 'core';
  if (resumeCore) runtime.navigate(runtime.steps[runtime.step].view);
  renderOverlay();
}
