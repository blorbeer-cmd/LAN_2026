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

export function wireActionMenus(container) {
  controller?.abort();
  controller = new AbortController();
  const { signal } = controller;
  const menus = [...container.querySelectorAll('.action-menu')];
  const anchors = new WeakMap();
  const hidePanel = (menu) => {
    const panel = menu.querySelector('.action-menu-panel');
    if (panel.hidePopover && panel.matches(':popover-open')) panel.hidePopover();
  };
  const markCard = (menu, open) => menu.closest('.card')?.classList.toggle('has-open-action-menu', open);
  const closeMenu = (menu, restoreFocus = false) => {
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
    }, { signal });
    menu.querySelector('.action-menu-panel').addEventListener('click', (event) => {
      if (event.target.closest('button.btn:not(:disabled):not([aria-disabled="true"])')) closeMenu(menu, true);
    }, { signal, capture: true });
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
