import { getAreaTour, availableTour } from './areaTourCatalog.js';
import { readTourProgress, saveTourProgress, resumeTourIndex } from './areaTourProgress.js';
import { openModal } from './modal.js';
import { icon } from './icons.js';
import { escapeHtml } from './format.js';
import { profileRow } from './profileRow.js';
import { DEMO_VIEWS, tourDemoSceneKey } from './areaTourDemoData.js';

export function tourPanelPlacement(target, panel, viewport, inset) {
  const candidates = ['bottom', 'top'].flatMap((placement) => ['center', 'left', 'right'].map((align) => {
    const left = align === 'left' ? inset : align === 'right' ? viewport.width - inset - panel.width : (viewport.width - panel.width) / 2;
    const top = placement === 'top' ? inset : viewport.height - inset - panel.height;
    const overlap = Math.max(0, Math.min(left + panel.width, target.right) - Math.max(left, target.left))
      * Math.max(0, Math.min(top + panel.height, target.bottom) - Math.max(top, target.top));
    return { placement, align, overlap };
  }));
  const free = candidates.find((candidate) => candidate.overlap === 0);
  if (free) return free;
  return candidates.reduce((best, candidate) => candidate.overlap < best.overlap ? candidate : best);
}

export function stepsForTour(tour, chapterId = 'all') {
  return tour.chapters.filter((chapter) => chapterId === 'all' || chapter.id === chapterId)
    .flatMap((chapter) => chapter.steps.map((step) => ({ ...step, id: `${chapter.id}/${step.id}` })));
}

// The app supplies its verified account, role, active workspace and route.
// Demonstrations use the actual views in a separate, network-isolated frame.
// The real application's controls, data and drafts are never used for examples.
export function createAreaTours({ container, getContext }) {
  let scope = '';
  let chooser = null;
  let active = null;
  let arcadeCatalog = null;
  let arcadeLoading = null;
  let frame = 0;

  function contextKey(context) {
    return JSON.stringify([context.accountId, context.event?.id, context.view, context.route, context.admin]);
  }

  function definition(key, context) {
    return getAreaTour(key, context) ?? availableTour(arcadeCatalog?.[key], context);
  }

  function eligible(context) {
    return Boolean(context.accountId && context.enabled !== false);
  }

  function attach(heading, key, source, context) {
    if (!heading || !eligible(context) || !definition(key, context)) return;
    if (heading.querySelector('[data-area-tour-open]')) return;
    // Keep heading navigation's name unchanged when its help button becomes
    // a descendant. The button remains an independently named tab stop.
    if (!heading.hasAttribute('aria-label')) heading.setAttribute('aria-label', heading.innerText.trim());
    heading.classList.add('area-tour-heading');
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'icon-btn';
    button.dataset.areaTourOpen = key;
    button.setAttribute('aria-label', `${definition(key, context).title} kennenlernen`);
    button.setAttribute('aria-haspopup', 'dialog');
    button.title = 'Bereich kennenlernen';
    button.innerHTML = icon('circleHelp');
    button.addEventListener('click', () => openChooser(key, source, button));
    heading.append(button);
  }

  function sync() {
    const context = getContext();
    const nextScope = contextKey(context);
    if (scope && nextScope !== scope) stop();
    scope = nextScope;
    if (!eligible(context)) {
      stop();
      container.querySelectorAll('[data-area-tour-open]').forEach((button) => button.remove());
      return;
    }
    if (context.area === 'arcade' && !arcadeCatalog && !arcadeLoading) {
      arcadeLoading = import('./arcade/areaTours.js')
        .then((module) => { arcadeCatalog = module.ARCADE_TOURS; sync(); })
        .catch(() => { /* A help chunk must not interrupt a playable game. */ })
        .finally(() => { arcadeLoading = null; });
    }
    attach(container.querySelector('h1, h2.view-title'), context.view, container, context);
    if (active) {
      if (!active.source.isConnected || !definition(active.key, context)) stop();
      else schedulePosition();
    }
  }

  function openChooser(key, source, trigger) {
    const context = getContext();
    const tour = definition(key, context);
    if (!tour || !eligible(context)) return;
    stop();
    const progress = readTourProgress(context.accountId, key, 'all');
    const lastChapter = readTourProgress(context.accountId, key, 'last')?.stepId;
    const resumeChapter = lastChapter === 'all' || tour.chapters.some((chapter) => chapter.id === lastChapter) ? lastChapter : 'all';
    const lastProgress = readTourProgress(context.accountId, key, resumeChapter);
    const resumable = lastProgress && !lastProgress.completed
      && stepsForTour(tour, resumeChapter).some((step) => step.id === lastProgress.stepId);
    const chapters = tour.chapters.length > 1 ? `
      <div class="area-tour-chapters" aria-label="Einzelne Kapitel">
        ${tour.chapters.map((chapter) => {
          const saved = readTourProgress(context.accountId, key, chapter.id);
          const label = saved?.completed ? 'Wiederholen' : saved ? 'Fortsetzen' : 'Starten';
          return profileRow({
            title: escapeHtml(chapter.title),
            meta: `${chapter.steps.length} Schritte${saved?.completed ? ' · Abgeschlossen' : ''}`,
            action: `<button type="button" class="btn btn-sm" data-tour-chapter="${escapeHtml(chapter.id)}" aria-label="${escapeHtml(`${chapter.title}: ${label}`)}">${label}</button>`,
          });
        }).join('')}
      </div>` : '';
    chooser = openModal(`${tour.title} kennenlernen`, `
      <p>Entdecke die Funktionen und was deine Aktionen auslösen.</p>
      ${context.area === 'arcade' && !['arcade', 'arcadeWatch'].includes(key) ? '<p class="muted">Die Partie läuft während der Tour weiter. Als Host kannst du sie vorher pausieren, wenn die aktuelle Spielphase es erlaubt.</p>' : ''}
      ${chapters}
      <p class="muted">Dein Fortschritt bleibt für dieses Konto auf diesem Gerät gespeichert.</p>
      <div class="area-tour-actions">
        ${resumable ? '<button type="button" class="btn btn-sm" data-tour-restart>Neu starten</button>' : ''}
        <button type="button" class="btn btn-primary btn-sm" data-tour-start>${resumable ? 'Fortsetzen' : progress?.completed ? 'Tour wiederholen' : 'Tour starten'}</button>
      </div>`, {
      isolateKeys: true,
      onClose: () => { chooser = null; },
      onMount: (el, close) => {
        const start = (chapterId, restart = false) => {
          close();
          if (contextKey(getContext()) !== scope || !source.isConnected) return;
          startTour(key, source, trigger, chapterId, restart);
        };
        el.querySelector('[data-tour-start]').addEventListener('click', () => start(resumable ? resumeChapter : 'all'));
        el.querySelector('[data-tour-restart]')?.addEventListener('click', () => start(resumeChapter, true));
        el.querySelectorAll('[data-tour-chapter]').forEach((button) => {
          button.addEventListener('click', () => start(button.dataset.tourChapter));
        });
      },
    });
  }

  function startTour(key, source, trigger, chapterId, restart) {
    const context = getContext();
    const tour = definition(key, context);
    if (!tour || !eligible(context)) return;
    const steps = stepsForTour(tour, chapterId);
    if (!steps.length) return;
    const progress = restart ? null : readTourProgress(context.accountId, key, chapterId);
    const frozen = [document.getElementById('app'), ...document.querySelectorAll('.modal-backdrop')]
      .filter(Boolean).map((element) => ({ element, inert: element.inert }));
    active = {
      key, source, trigger, accountId: context.accountId, chapterId, steps,
      tour, scope,
      index: resumeTourIndex(steps, progress), frozen, openedDetails: new Map(), demoNow: Date.now(),
      scrollX: window.scrollX, scrollY: window.scrollY, dialog: null, ring: null, shade: null,
      scrollState: [container, ...document.querySelectorAll('.modal')]
        .map((element) => ({ element, left: element.scrollLeft, top: element.scrollTop })),
    };
    const handle = openModal(tour.title, '', {
      isolateKeys: true,
      closeOnBackdrop: false,
      onClose: finish,
      onMount: (el) => {
        el.classList.add('area-tour-backdrop');
        const shade = document.createElement('div');
        shade.className = 'area-tour-shade';
        shade.setAttribute('aria-hidden', 'true');
        const ring = document.createElement('div');
        ring.className = 'area-tour-target';
        ring.setAttribute('aria-hidden', 'true');
        ring.hidden = true;
        el.prepend(shade, ring);
        active.dialog = el;
        active.ring = ring;
        active.shade = shade;
        el.querySelector('[data-close]').setAttribute('aria-label', 'Tour beenden');
        // Keep the live region mounted while the visual example is replaced.
        // Inserting a new prefilled live region each step is not announced
        // consistently by assistive technology.
        const announcer = document.createElement('p');
        announcer.className = 'visually-hidden';
        announcer.setAttribute('role', 'status');
        el.querySelector('.modal').append(announcer);
        active.announcer = announcer;
      },
    });
    active.close = handle.close;
    frozen.forEach(({ element }) => { element.inert = true; });
    renderStep();
  }

  function renderStep() {
    if (!active) return;
    const { steps, index, dialog, accountId, key, chapterId } = active;
    const step = steps[index];
    active.announcer.textContent = `Schritt ${index + 1} von ${steps.length}: ${step.title}. ${step.text}`;
    saveTourProgress(accountId, key, chapterId, step.id);
    saveTourProgress(accountId, key, 'last', chapterId);
    const heading = dialog.querySelector('.modal-header h2');
    heading.textContent = step.title;
    dialog.querySelector('.modal').setAttribute('aria-label', `${step.title} · Schritt ${index + 1} von ${steps.length}`);
    dialog.querySelector('.modal-body').innerHTML = `
      <div class="area-tour-explanation">
          <p class="onboarding-progress">Schritt ${index + 1} von ${steps.length}</p>
          <p>${escapeHtml(step.text)}</p>
          <p class="muted" data-tour-scene-state hidden></p>
          <button type="button" class="btn btn-sm" data-tour-retry hidden>Erneut versuchen</button>
      </div>
      <div class="area-tour-actions">
          <button type="button" class="btn btn-sm" data-tour-end>Tour beenden</button>
          <button type="button" class="btn btn-sm" data-tour-back ${index === 0 ? 'disabled' : ''}>Zurück</button>
          <button type="button" class="btn btn-primary btn-sm" data-tour-next>${index === steps.length - 1 ? 'Abschließen' : 'Weiter'}</button>
      </div>`;
    dialog.querySelector('[data-tour-end]').addEventListener('click', () => active.close());
    dialog.querySelector('[data-tour-retry]').addEventListener('click', () => { clearScene(active); renderStep(); });
    dialog.querySelector('[data-tour-back]').addEventListener('click', () => { active.index -= 1; renderStep(); });
    dialog.querySelector('[data-tour-next]').addEventListener('click', () => {
      if (active.index === active.steps.length - 1) {
        saveTourProgress(active.accountId, active.key, active.chapterId, active.steps[active.index].id, true);
        active.close();
      } else { active.index += 1; renderStep(); }
    });
    if (DEMO_VIEWS.includes(key)) startScene(step);
    else revealTarget(true);
    dialog.querySelector('[data-tour-next]').focus({ preventScroll: true });
  }

  function clearScene(tour) {
    clearTimeout(tour.sceneTimeout);
    tour.sceneFrame?.remove();
    tour.sceneFrame = null;
    tour.sceneToken = null;
    tour.sceneKey = null;
  }

  function startScene(step) {
    const context = getContext();
    const demoContext = { admin: context.admin, event: { eventType: context.event?.eventType, enabledFeatures: context.event?.enabledFeatures },
      theme: document.documentElement.dataset.theme, layoutMode: document.documentElement.dataset.layoutMode };
    const sceneKey = tourDemoSceneKey(active.key, step.id, demoContext, active.demoNow);
    const token = crypto.randomUUID();
    const prepareStep = () => {
      active.sceneToken = token;
      active.dialog.dataset.tourSceneStatus = 'loading';
      active.dialog.querySelector('[data-tour-next]').disabled = true;
      active.sceneTimeout = setTimeout(() => sceneFailed(token), 15000);
    };
    if (active.sceneFrame && active.sceneKey === sceneKey && active.sceneFrame.contentWindow.areaTourScene) {
      clearTimeout(active.sceneTimeout);
      prepareStep();
      active.sceneFrame.contentWindow.postMessage({ type: 'area-tour:focus', token, step: step.id, target: step.target }, location.origin);
      return;
    }
    clearScene(active);
    const frame = document.createElement('iframe');
    frame.className = 'area-tour-scene-frame';
    frame.dataset.areaTourScene = active.key;
    frame.title = `Tour: ${active.tour.title}`;
    frame.setAttribute('sandbox', 'allow-scripts allow-same-origin');
    frame.tabIndex = -1;
    frame.inert = true;
    active.sceneFrame = frame;
    active.sceneKey = sceneKey;
    active.sceneLayout = JSON.stringify([demoContext.theme, demoContext.layoutMode]);
    prepareStep();
    frame.addEventListener('load', () => {
      if (active?.sceneToken !== token) return;
      frame.contentWindow.postMessage({ type: 'area-tour:init', token, view: active.key, step: step.id, target: step.target, now: active.demoNow,
        context: demoContext,
      }, location.origin);
    });
    // Bound a genuinely failed asset/frame load; this is not a render delay.
    frame.src = '/area-tour.html';
    active.dialog.before(frame);
    positionScene();
  }

  function sceneFailed(token) {
    if (active?.sceneToken !== token) return;
    active.dialog.dataset.tourSceneStatus = 'error';
    const status = active.dialog.querySelector('[data-tour-scene-state]');
    status.hidden = false;
    status.textContent = 'Die Tour konnte nicht geladen werden.';
    active.dialog.querySelector('[data-tour-retry]').hidden = false;
  }

  function onSceneMessage(event) {
    if (!active?.sceneFrame || event.source !== active.sceneFrame.contentWindow || event.origin !== location.origin
      || event.data?.token !== active.sceneToken) return;
    if (event.data.type === 'area-tour:error') { clearTimeout(active.sceneTimeout); sceneFailed(active.sceneToken); return; }
    if (event.data.type === 'area-tour:position') { schedulePosition(); return; }
    if (event.data.type !== 'area-tour:shown') return;
    clearTimeout(active.sceneTimeout);
    active.dialog.dataset.tourSceneStatus = 'ready';
    active.dialog.querySelector('[data-tour-scene-state]').hidden = true;
    active.dialog.querySelector('[data-tour-retry]').hidden = true;
    active.dialog.querySelector('[data-tour-next]').disabled = false;
    positionTarget();
    active.dialog.querySelector('.area-tour-explanation').scrollTop = 0;
    active.dialog.querySelector('[data-tour-next]').focus({ preventScroll: true });
  }

  function positionScene() {
    if (!active?.sceneFrame) return;
    const panel = active.dialog.querySelector('.modal');
    panel.dataset.tourPlacement = 'bottom';
    const { theme, layoutMode } = document.documentElement.dataset;
    const layout = JSON.stringify([theme, layoutMode]);
    if (active.sceneLayout !== layout) {
      active.sceneLayout = layout;
      active.sceneFrame.contentWindow.postMessage({ type: 'area-tour:layout', theme, layoutMode }, location.origin);
    }
  }

  function revealTarget(scroll = false) {
    if (!active) return;
    if (active.sceneFrame) { positionTarget(); return; }
    const step = active.steps[active.index];
    const candidates = step.target ? [...document.querySelectorAll(step.target)]
      .filter((element) => !active.dialog.contains(element) && (active.source.contains(element) || element.closest('.topbar'))) : [];
    let target = null;
    for (const candidate of candidates) {
      // Also open a details target itself and ancestors of a visible summary.
      // Their headings have a rectangle even while their content is collapsed.
      for (let parent = candidate; parent && parent !== document.body; parent = parent.parentElement) {
        if (parent.tagName === 'DETAILS' && !parent.open) {
          if (!active.openedDetails.has(parent)) {
            const data = [...parent.attributes].find((attribute) => attribute.name.startsWith('data-'));
            const selector = parent.id ? `#${CSS.escape(parent.id)}`
              : data ? `[${data.name}="${CSS.escape(data.value)}"]` : null;
            active.openedDetails.set(parent, { open: parent.open, selector });
          }
          parent.open = true;
        }
      }
      if (candidate.getClientRects().length) { target = candidate; break; }
    }
    if (!target && !step.target) target = active.source.querySelector('h1, h2');
    active.target = target;
    if (target && scroll) target.scrollIntoView({ block: 'center', behavior: 'instant' });
    positionTarget();
  }

  function positionTarget() {
    if (!active) return;
    const { target, ring, shade, dialog } = active;
    positionScene();
    let rect = target?.isConnected && target.getClientRects().length ? target.getBoundingClientRect() : null;
    if (active.sceneFrame) {
      const frameRect = active.sceneFrame.getBoundingClientRect();
      const inner = active.sceneFrame.contentWindow.areaTourScene?.targetRect();
      rect = inner ? { left: Math.max(frameRect.left, frameRect.left + inner.left), top: Math.max(frameRect.top, frameRect.top + inner.top),
        right: Math.min(frameRect.right, frameRect.left + inner.right), bottom: Math.min(frameRect.bottom, frameRect.top + inner.bottom) } : null;
    }
    const visible = rect && rect.right > rect.left && rect.bottom > rect.top
      && rect.bottom > 0 && rect.top < window.innerHeight && rect.right > 0 && rect.left < window.innerWidth;
    ring.hidden = !visible;
    shade.hidden = Boolean(visible);
    const panel = dialog.querySelector('.modal');
    if (!visible) { panel.dataset.tourPlacement = 'bottom'; panel.dataset.tourAlign = 'center'; return; }
    const left = Math.max(0, rect.left);
    const top = Math.max(0, rect.top);
    ring.style.left = `${left}px`;
    ring.style.top = `${top}px`;
    ring.style.width = `${Math.min(window.innerWidth, rect.right) - left}px`;
    ring.style.height = `${Math.min(window.innerHeight, rect.bottom) - top}px`;
    const inset = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--space-4'));
    // Keep the whole explanation at its natural height. A small gap around
    // a large target must not clip its text just to avoid an overlap.
    const placement = tourPanelPlacement(rect, panel.getBoundingClientRect(),
      { width: window.innerWidth, height: window.innerHeight }, inset);
    panel.dataset.tourPlacement = placement.placement;
    panel.dataset.tourAlign = placement.align;
  }

  function schedulePosition() {
    if (frame || !active) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      if (active) revealTarget();
    });
  }

  function finish() {
    if (!active) return;
    const previous = active;
    clearScene(previous);
    active = null;
    cancelAnimationFrame(frame);
    frame = 0;
    const sameContext = contextKey(getContext()) === previous.scope;
    previous.frozen.forEach(({ element, inert }) => { element.inert = inert; });
    previous.openedDetails.forEach(({ open, selector }, element) => {
      const current = element.isConnected ? element : sameContext && selector ? previous.source.querySelector(selector) : null;
      if (current) current.open = open;
    });
    if (sameContext && previous.source.isConnected) {
      previous.scrollState.forEach(({ element, left, top }) => {
        if (element.isConnected) { element.scrollLeft = left; element.scrollTop = top; }
      });
      window.scrollTo({ left: previous.scrollX, top: previous.scrollY, behavior: 'instant' });
      const trigger = previous.trigger.isConnected ? previous.trigger : previous.source.querySelector('[data-area-tour-open]');
      trigger?.focus({ preventScroll: true });
    }
  }

  function stop() {
    chooser?.close();
    active?.close();
  }

  function onDialogOpened(event) {
    const { tourKey, el } = event.detail ?? {};
    if (tourKey && el?.isConnected) attach(el.querySelector('.modal-header h2'), tourKey, el, getContext());
  }

  const observer = new MutationObserver(sync);
  observer.observe(container, { childList: true, subtree: true });
  document.addEventListener('respawn:dialog-opened', onDialogOpened);
  window.addEventListener('resize', schedulePosition);
  window.addEventListener('scroll', schedulePosition, true);
  window.addEventListener('message', onSceneMessage);
  return {
    sync, stop,
    dispose() {
      stop();
      observer.disconnect();
      document.removeEventListener('respawn:dialog-opened', onDialogOpened);
      window.removeEventListener('resize', schedulePosition);
      window.removeEventListener('scroll', schedulePosition, true);
      window.removeEventListener('message', onSceneMessage);
    },
  };
}
