import { getAreaTour, availableTour } from './areaTourCatalog.js';
import { readTourProgress, saveTourProgress, resumeTourIndex } from './areaTourProgress.js';
import { openModal } from './modal.js';
import { icon } from './icons.js';
import { escapeHtml } from './format.js';
import { profileRow } from './profileRow.js';
import { exampleForTourStep, tourExampleHtml } from './areaTourExamples.js';

export function stepsForTour(tour, chapterId = 'all') {
  return tour.chapters.filter((chapter) => chapterId === 'all' || chapter.id === chapterId)
    .flatMap((chapter) => chapter.steps.map((step) => ({ ...step, id: `${chapter.id}/${step.id}` })));
}

// The app supplies its verified account, role, active workspace and route.
// The tour never calls a product API or clicks a product control.
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
      ${context.area === 'arcade' && !['arcade', 'arcadeWatch'].includes(key) ? '<p class="muted">Die Partie läuft während der Hilfe weiter. Pausiere sie bei Bedarf vorher.</p>' : ''}
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
      index: resumeTourIndex(steps, progress), frozen, openedDetails: new Map(),
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
    const example = exampleForTourStep(key, active.tour, step);
    saveTourProgress(accountId, key, chapterId, step.id);
    saveTourProgress(accountId, key, 'last', chapterId);
    const heading = dialog.querySelector('.modal-header h2');
    heading.textContent = step.title;
    dialog.querySelector('.modal').setAttribute('aria-label', `${step.title} · Schritt ${index + 1} von ${steps.length}`);
    dialog.querySelector('.modal-body').innerHTML = `
      ${tourExampleHtml(example)}
      <div class="area-tour-explanation">
        <div aria-live="polite">
          <p class="onboarding-progress">Schritt ${index + 1} von ${steps.length}</p>
          <p>${escapeHtml(step.text)}</p>
        </div>
        <div class="area-tour-actions">
          <button type="button" class="btn btn-sm" data-tour-end>Tour beenden</button>
          <button type="button" class="btn btn-sm" data-tour-back ${index === 0 ? 'disabled' : ''}>Zurück</button>
          <button type="button" class="btn btn-primary btn-sm" data-tour-next>${index === steps.length - 1 ? 'Abschließen' : 'Weiter'}</button>
        </div>
      </div>`;
    dialog.querySelector('[data-tour-end]').addEventListener('click', () => active.close());
    dialog.querySelector('[data-tour-back]').addEventListener('click', () => { active.index -= 1; renderStep(); });
    dialog.querySelector('[data-tour-next]').addEventListener('click', () => {
      if (active.index === active.steps.length - 1) {
        saveTourProgress(active.accountId, active.key, active.chapterId, active.steps[active.index].id, true);
        active.close();
      } else { active.index += 1; renderStep(); }
    });
    revealTarget(true);
    const exampleFocus = dialog.querySelector('[data-tour-example-focus]');
    if (exampleFocus) exampleFocus.scrollIntoView({ block: 'nearest', behavior: 'instant' });
    dialog.querySelector('[data-tour-next]').focus({ preventScroll: true });
  }

  function revealTarget(scroll = false) {
    if (!active) return;
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
    const rect = target?.isConnected && target.getClientRects().length ? target.getBoundingClientRect() : null;
    const visible = rect && rect.bottom > 0 && rect.top < window.innerHeight && rect.right > 0 && rect.left < window.innerWidth;
    ring.hidden = !visible;
    shade.hidden = Boolean(visible);
    const panel = dialog.querySelector('.modal');
    if (!visible) { panel.dataset.tourPlacement = 'bottom'; return; }
    const left = Math.max(0, rect.left);
    const top = Math.max(0, rect.top);
    ring.style.left = `${left}px`;
    ring.style.top = `${top}px`;
    ring.style.width = `${Math.min(window.innerWidth, rect.right) - left}px`;
    ring.style.height = `${Math.min(window.innerHeight, rect.bottom) - top}px`;
    panel.dataset.tourPlacement = rect.bottom > window.innerHeight - panel.getBoundingClientRect().height - 32 ? 'top' : 'bottom';
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
  return {
    sync, stop,
    dispose() {
      stop();
      observer.disconnect();
      document.removeEventListener('respawn:dialog-opened', onDialogOpened);
      window.removeEventListener('resize', schedulePosition);
      window.removeEventListener('scroll', schedulePosition, true);
    },
  };
}
