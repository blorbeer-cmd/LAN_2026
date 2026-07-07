// Tiny modal helper reused by every view that needs a form/detail overlay
// (player detail, game editor, match entry). Bottom-sheet on mobile, centered
// dialog on wider screens (handled purely in CSS).

export function openModal(title, bodyHtml, { onMount } = {}) {
  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop';
  backdrop.innerHTML = `
    <div class="modal" role="dialog" aria-modal="true" aria-label="${title}">
      <div class="modal-header">
        <h2>${title}</h2>
        <button type="button" class="icon-btn" data-close aria-label="Schließen">✕</button>
      </div>
      <div class="modal-body">${bodyHtml}</div>
    </div>
  `;
  document.body.appendChild(backdrop);

  const close = () => backdrop.remove();
  backdrop.addEventListener('click', (e) => {
    if (e.target === backdrop) close();
  });
  backdrop.querySelector('[data-close]').addEventListener('click', close);

  if (onMount) onMount(backdrop, close);
  return { el: backdrop, close };
}
