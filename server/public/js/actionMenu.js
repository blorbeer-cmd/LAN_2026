import { escapeHtml } from './format.js';
import { icon } from './icons.js';

// Callers provide trusted action markup; user content must already be escaped.
export function actionMenuHtml(actions, label) {
  if (!actions) return '';
  return `<details class="action-menu">
    <summary class="btn btn-sm" aria-label="${escapeHtml(label)}">Aktion ${icon('chevronDown')}</summary>
    <div class="action-menu-panel">${actions}</div>
  </details>`;
}

let controller;

export function wireActionMenus(container) {
  controller?.abort();
  controller = new AbortController();
  const { signal } = controller;
  const menus = [...container.querySelectorAll('.action-menu')];
  const markCard = (menu, open) => menu.closest('.card')?.classList.toggle('has-open-action-menu', open);
  const closeMenu = (menu, restoreFocus = false) => {
    menu.open = false;
    markCard(menu, false);
    if (restoreFocus) menu.querySelector('summary')?.focus();
  };
  for (const menu of menus) {
    menu.addEventListener('toggle', () => {
      if (menu.open) menus.filter((other) => other !== menu).forEach((other) => closeMenu(other));
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
}
