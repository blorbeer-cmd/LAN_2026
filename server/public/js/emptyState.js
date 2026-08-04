// Shared markup for the app's ubiquitous ".empty-state" placeholder ("Noch
// keine Daten.", "Lädt…", …). The CSS class was already the single visual
// component; this is the matching single JS render function, so every view
// stops hand-rolling the same <div class="empty-state">…</div> shape.

export function emptyStateHtml(text, { icon, className = '', style = '' } = {}) {
  const iconHtml = icon ? `<span class="empty-state-icon">${icon}</span>` : '';
  const classes = `empty-state${className ? ` ${className}` : ''}`;
  const styleAttr = style ? ` style="${style}"` : '';
  return `<div class="${classes}"${styleAttr}>${iconHtml}${text}</div>`;
}
