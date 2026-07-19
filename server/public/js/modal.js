// Tiny modal helper reused by every view that needs a form/detail overlay
// (player detail, game editor, match entry). Bottom-sheet on mobile, centered
// dialog on wider screens (handled purely in CSS).

import { icon } from './icons.js';

export function openModal(title, bodyHtml, { onMount, onClose } = {}) {
  const previousFocus = document.activeElement;
  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop';
  backdrop.innerHTML = `
    <div class="modal" role="dialog" aria-modal="true" aria-label="${title}">
      <div class="modal-header">
        <h2>${title}</h2>
        <button type="button" class="icon-btn" data-close aria-label="Schließen">${icon('x')}</button>
      </div>
      <div class="modal-body">${bodyHtml}</div>
    </div>
  `;
  document.body.appendChild(backdrop);

  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    document.removeEventListener('keydown', onKeydown);
    backdrop.remove();
    onClose?.();
    if (previousFocus instanceof HTMLElement && previousFocus.isConnected) previousFocus.focus();
  };
  const onKeydown = (e) => {
    if (e.key === 'Escape') close();
    if (e.key !== 'Tab') return;
    const focusableSelector = [
      'button:not([disabled])',
      'a[href]',
      'input:not([disabled])',
      'select:not([disabled])',
      'textarea:not([disabled])',
      '[tabindex]:not([tabindex="-1"])',
    ].join(',');
    const focusable = [...backdrop.querySelectorAll(focusableSelector)].filter(
      (element) => !element.hidden && element.getClientRects().length > 0
    );
    if (focusable.length === 0) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  };
  backdrop.addEventListener('click', (e) => {
    if (e.target === backdrop) close();
  });
  backdrop.querySelector('[data-close]').addEventListener('click', close);
  document.addEventListener('keydown', onKeydown);

  if (onMount) onMount(backdrop, close);
  if (!backdrop.contains(document.activeElement)) {
    backdrop.querySelector('input, select, textarea, button, a[href]')?.focus();
  }
  return { el: backdrop, close };
}

// Themed replacement for the browser's native confirm() — the same dark
// bottom-sheet/dialog as every other modal, so "are you sure?" prompts stop
// looking like a jarring OS pop-up. Resolves true if confirmed, false otherwise
// (cancel button, close icon, backdrop tap, or Escape).
export function confirmDialog(message, { title = 'Bestätigen', confirmText = 'OK', cancelText = 'Abbrechen', danger = false } = {}) {
  return new Promise((resolve) => {
    const backdrop = document.createElement('div');
    backdrop.className = 'modal-backdrop';
    backdrop.innerHTML = `
      <div class="modal" role="alertdialog" aria-modal="true" aria-label="${escapeAttr(title)}">
        <div class="modal-header">
          <h2>${escapeHtml(title)}</h2>
          <button type="button" class="icon-btn" data-cancel aria-label="Schließen">${icon('x')}</button>
        </div>
        <div class="modal-body">
          <p style="margin:0 0 var(--space-4);">${escapeHtml(message)}</p>
          <div class="row" style="gap:var(--space-2);justify-content:flex-end;">
            <button type="button" class="btn btn-sm btn-equal" data-cancel>${escapeHtml(cancelText)}</button>
            <button type="button" class="btn btn-sm btn-equal ${danger ? 'btn-danger' : 'btn-primary'}" data-confirm>${escapeHtml(confirmText)}</button>
          </div>
        </div>
      </div>`;
    document.body.appendChild(backdrop);

    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      document.removeEventListener('keydown', onKey);
      backdrop.remove();
      resolve(result);
    };
    const onKey = (e) => {
      if (e.key === 'Escape') finish(false);
      if (e.key === 'Enter') finish(true);
    };
    backdrop.addEventListener('click', (e) => {
      if (e.target === backdrop) finish(false);
    });
    backdrop.querySelectorAll('[data-cancel]').forEach((b) => b.addEventListener('click', () => finish(false)));
    backdrop.querySelector('[data-confirm]').addEventListener('click', () => finish(true));
    document.addEventListener('keydown', onKey);
    backdrop.querySelector('[data-confirm]').focus();
  });
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
function escapeAttr(value) {
  return escapeHtml(value);
}
