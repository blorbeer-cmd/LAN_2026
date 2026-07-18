import { escapeHtml } from './format.js';
import { icon } from './icons.js';

let activeTrigger = null;
let pinnedTrigger = null;
// Viewport position of the active trigger at open time. Scroll events only
// close the popover once the trigger has actually moved: scroll listeners
// fire asynchronously, so a programmatic scroll-into-view (or settling touch
// momentum) that finished before the opening tap would otherwise be
// delivered right after open() and close the popover again immediately.
let activeTriggerViewportPosition = null;
let globalListenersInstalled = false;

function panelFor(trigger) {
  const id = trigger.getAttribute('aria-controls');
  return id ? document.getElementById(id) : null;
}

function positionPanel(trigger, panel) {
  const styles = getComputedStyle(document.documentElement);
  const margin = parseFloat(styles.getPropertyValue('--space-2'));
  const gap = parseFloat(styles.getPropertyValue('--space-1'));
  const triggerRect = trigger.getBoundingClientRect();
  const panelRect = panel.getBoundingClientRect();
  const safeMargin = Number.isFinite(margin) ? margin : 0;
  const safeGap = Number.isFinite(gap) ? gap : 0;
  const maxLeft = Math.max(safeMargin, window.innerWidth - panelRect.width - safeMargin);
  const left = Math.min(Math.max(triggerRect.left, safeMargin), maxLeft);
  let top = triggerRect.bottom + safeGap;
  if (top + panelRect.height > window.innerHeight - safeMargin) {
    top = Math.max(safeMargin, triggerRect.top - safeGap - panelRect.height);
  }
  panel.style.left = `${left}px`;
  panel.style.top = `${top}px`;
}

function close(trigger = activeTrigger) {
  if (!trigger) return;
  const panel = panelFor(trigger);
  trigger.setAttribute('aria-expanded', 'false');
  if (panel) panel.hidden = true;
  if (activeTrigger === trigger) {
    activeTrigger = null;
    activeTriggerViewportPosition = null;
  }
  if (pinnedTrigger === trigger) pinnedTrigger = null;
}

function open(trigger, { pinned = false } = {}) {
  if (activeTrigger && activeTrigger !== trigger) close(activeTrigger);
  const panel = panelFor(trigger);
  if (!panel) return;
  panel.hidden = false;
  positionPanel(trigger, panel);
  trigger.setAttribute('aria-expanded', 'true');
  activeTrigger = trigger;
  const rect = trigger.getBoundingClientRect();
  activeTriggerViewportPosition = { top: rect.top, left: rect.left };
  if (pinned) pinnedTrigger = trigger;
}

function installGlobalListeners() {
  if (globalListenersInstalled) return;
  globalListenersInstalled = true;
  document.addEventListener('pointerdown', (event) => {
    if (!activeTrigger) return;
    const wrapper = activeTrigger.closest('[data-info-tooltip]');
    if (!wrapper?.contains(event.target)) close(activeTrigger);
  });
  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape' || !activeTrigger) return;
    const trigger = activeTrigger;
    close(trigger);
    trigger.focus();
  });
  window.addEventListener('resize', () => close());
  window.addEventListener(
    'scroll',
    () => {
      if (!activeTrigger || !activeTriggerViewportPosition) return;
      const rect = activeTrigger.getBoundingClientRect();
      const moved =
        Math.abs(rect.top - activeTriggerViewportPosition.top) > 1 ||
        Math.abs(rect.left - activeTriggerViewportPosition.left) > 1;
      if (moved) close();
    },
    true
  );
}

export function infoTooltipHtml(id, label, text) {
  const safeId = escapeHtml(id);
  const safeLabel = escapeHtml(label);
  return `<span class="info-tooltip" data-info-tooltip>
    <button type="button" class="info-tooltip-trigger" data-info-tooltip-trigger
      aria-label="Mehr Informationen zu ${safeLabel}" aria-controls="${safeId}"
      aria-expanded="false">${icon('info')}</button>
    <span class="info-tooltip-panel" id="${safeId}" role="tooltip" hidden>${escapeHtml(text)}</span>
  </span>`;
}

export function wireInfoTooltips(root) {
  installGlobalListeners();
  if (activeTrigger && !document.contains(activeTrigger)) {
    activeTrigger = null;
    pinnedTrigger = null;
  }
  root.querySelectorAll('[data-info-tooltip-trigger]').forEach((trigger) => {
    trigger.addEventListener('click', () => {
      if (pinnedTrigger === trigger) close(trigger);
      else open(trigger, { pinned: true });
    });
    trigger.addEventListener('mouseenter', () => {
      if (!pinnedTrigger) open(trigger);
    });
    trigger.closest('[data-info-tooltip]')?.addEventListener('mouseleave', () => {
      if (pinnedTrigger !== trigger && !trigger.matches(':focus-visible')) close(trigger);
    });
    trigger.addEventListener('focusout', (event) => {
      if (!trigger.closest('[data-info-tooltip]')?.contains(event.relatedTarget)) close(trigger);
    });
  });
}
