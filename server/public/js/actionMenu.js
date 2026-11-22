import { escapeHtml } from './format.js';
import { icon } from './icons.js';

// Callers provide trusted action markup, one entry per array item; user
// content must already be escaped. A menu only earns its extra click when it
// bundles more than `inlineMax` entries (default one): below that the entries
// render directly as the buttons they are. An optional key gives the menu a
// stable identity, so a live re-render that restores disclosure state
// (viewRenderState.js) never mistakes one menu, or another details element,
// for a different one. `summary` names the visible trigger; it defaults to
// the generic "Aktion" and is only set where the menu bundles one kind of
// action (e.g. "Kalender", "Absagen"). Floating panels use the native popover
// layer so scrolling boards and neighboring cards cannot cover their actions.
export function actionMenuHtml(actions, label, { key = null, inlineMax = 1, summary = 'Aktion', floating = false } = {}) {
  const entries = actions.filter(Boolean);
  if (entries.length <= inlineMax) return entries.join('');
  return `<details class="action-menu"${key ? ` data-action-menu="${escapeHtml(key)}"` : ''}${floating ? ' data-floating-action-menu' : ''}>
    <summary class="btn btn-sm" aria-label="${escapeHtml(label)}">${escapeHtml(summary)} ${icon('chevronDown')}</summary>
    <div class="action-menu-panel"${floating ? ' popover="manual"' : ''}>${entries.join('')}</div>
  </details>`;
}

let controller;
// A live re-render replaces a keyed menu while someone is using it. The open
// menu's key and its focused entry outlive that replacement, so the rebuilt
// menu reopens with the same entry focused instead of silently closing. Some
// views build parts of their markup only after the render (lazy sections), so
// the memory waits for the next wiring of the same view rather than expiring
// when one wiring does not contain the menu. Closing the menu by any user path
// forgets it, and so does leaving the view, even through a view that never
// wires action menus.
let remembered = null;
let observedViewRoot = null;

function viewRootOf(container) {
  return container.closest('#view-container') ?? container;
}

function forgetOnViewChange(root) {
  if (observedViewRoot === root || typeof MutationObserver === 'undefined') return;
  observedViewRoot = root;
  new MutationObserver((records) => {
    if (records.some((record) => record.oldValue !== root.dataset.view)) remembered = null;
  }).observe(root, { attributes: true, attributeFilter: ['data-view'], attributeOldValue: true });
}

// The entry's first data attribute identifies it across renders; entries
// without one (or that no longer exist) fall back to the trigger.
function entrySelector(element) {
  if (element.matches('.action-menu > summary')) return ':scope > summary';
  const attribute = [...element.attributes].find((item) => item.name.startsWith('data-') && item.value);
  return attribute ? `[${attribute.name}="${CSS.escape(attribute.value)}"]` : ':scope > summary';
}

export function wireActionMenus(container) {
  controller?.abort();
  controller = new AbortController();
  const { signal } = controller;
  const menus = [...container.querySelectorAll('.action-menu')];
  const viewRoot = viewRootOf(container);
  forgetOnViewChange(viewRoot);
  const view = viewRoot.dataset.view ?? null;
  if (remembered && remembered.view !== view) remembered = null;
  const anchors = new WeakMap();
  const forget = (menu) => {
    if (remembered && remembered.key === menu.dataset.actionMenu) remembered = null;
  };
  const hidePanel = (menu) => {
    const panel = menu.querySelector('.action-menu-panel');
    if (panel.hidePopover && panel.matches(':popover-open')) panel.hidePopover();
  };
  const markCard = (menu, open) => menu.closest('.card')?.classList.toggle('has-open-action-menu', open);
  const closeMenu = (menu, restoreFocus = false) => {
    forget(menu);
    menu.open = false;
    hidePanel(menu);
    markCard(menu, false);
    if (restoreFocus) menu.querySelector('summary')?.focus();
  };
  const placeFloatingMenu = (menu) => {
    const panel = menu.querySelector('.action-menu-panel');
    if (!menu.hasAttribute('data-floating-action-menu') || !panel.showPopover) return;
    if (!panel.matches(':popover-open')) panel.showPopover();
    const anchor = menu.querySelector('summary').getBoundingClientRect();
    anchors.set(menu, { top: anchor.top, left: anchor.left });
    const rect = panel.getBoundingClientRect();
    const inset = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--space-2'));
    panel.style.left = `${Math.max(inset, Math.min(anchor.right - rect.width, window.innerWidth - rect.width - inset))}px`;
    panel.style.top = `${Math.max(inset, anchor.bottom + rect.height + inset <= window.innerHeight
      ? anchor.bottom : anchor.top - rect.height)}px`;
  };
  for (const menu of menus) {
    menu.addEventListener('toggle', () => {
      if (menu.open) menus.filter((other) => other !== menu).forEach((other) => closeMenu(other));
      if (menu.open) placeFloatingMenu(menu);
      else hidePanel(menu);
      markCard(menu, menu.open);
      const key = menu.dataset.actionMenu;
      if (menu.open && key) {
        const focused = menu.contains(document.activeElement) ? entrySelector(document.activeElement) : null;
        remembered = { view, key, entry: remembered?.key === key ? remembered.entry ?? focused : focused };
      }
      else if (!menu.open && menu.isConnected) forget(menu);
    }, { signal });
    // Only a keyed menu is remembered; an unkeyed one never matches.
    const isRemembered = () => Boolean(menu.dataset.actionMenu) && remembered?.key === menu.dataset.actionMenu;
    menu.addEventListener('focusin', (event) => {
      if (isRemembered() && event.target instanceof Element) {
        remembered.entry = entrySelector(event.target);
      }
    }, { signal });
    menu.addEventListener('focusout', (event) => {
      // Moving focus to another control ends the remembered focus; focus
      // that is lost because the menu was removed has no related target.
      if (isRemembered() && event.relatedTarget instanceof Element
        && !menu.contains(event.relatedTarget)) remembered.entry = null;
    }, { signal });
    menu.querySelector('.action-menu-panel').addEventListener('click', (event) => {
      if (event.target.closest('button.btn:not(:disabled):not([aria-disabled="true"])')) closeMenu(menu, true);
    }, { signal, capture: true });
  }
  const restored = remembered && menus.find((menu) => menu.dataset.actionMenu === remembered.key);
  if (restored) {
    // Show the floating panel synchronously, so a focus restore that runs
    // right after this render can reach its entries.
    restored.open = true;
    placeFloatingMenu(restored);
    markCard(restored, true);
    const active = document.activeElement;
    const focusLost = !active || active === document.body || !active.isConnected;
    if (remembered.entry && focusLost) {
      (restored.querySelector(remembered.entry) ?? restored.querySelector(':scope > summary'))?.focus({ preventScroll: true });
    }
  }
  document.addEventListener('pointerdown', (event) => {
    if (event.target instanceof Element && event.target.closest('.action-menu')) return;
    menus.forEach((menu) => closeMenu(menu));
  }, { signal });
  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;
    const menu = menus.find((candidate) => candidate.open);
    if (!menu) return;
    event.preventDefault();
    closeMenu(menu, true);
  }, { signal });
  const syncFloatingMenus = (event) => {
    if (event?.target instanceof Element && event.target.closest('.action-menu-panel')) return;
    menus.filter((menu) => menu.open && menu.hasAttribute('data-floating-action-menu')).forEach((menu) => {
      const previous = anchors.get(menu);
      const rect = menu.querySelector('summary').getBoundingClientRect();
      if (event.type === 'resize' || rect.bottom < 0 || rect.top > window.innerHeight) closeMenu(menu);
      else if (previous && (Math.abs(rect.top - previous.top) > 1 || Math.abs(rect.left - previous.left) > 1))
        placeFloatingMenu(menu);
    });
  };
  document.addEventListener('scroll', syncFloatingMenus, { signal, capture: true });
  window.addEventListener('resize', syncFloatingMenus, { signal });
}
