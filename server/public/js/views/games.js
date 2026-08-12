// Settings view: the shared TV/Kiosk screen. Event management used to live
// here too, which put a global, non-personal surface behind the personal-
// looking gear icon; it has its own area now (views/events.js).

import { infoTooltipHtml, wireInfoTooltips } from '../infoTooltip.js';

const KIOSK_HELP = 'Für gemeinsame Bildschirme: zeigt Live-Status, Vote, Rang und Turnier automatisch. Der Kiosk benötigt seinen eigenen Token.';

function renderKioskSection() {
  return `
    <section class="card stack grouped-page-section" aria-labelledby="settings-kiosk-title">
      <div class="grouped-page-section-title">
        <span class="title-with-info">
          <h2 id="settings-kiosk-title">TV-/Kiosk-Ansicht</h2>
          ${infoTooltipHtml('settings-kiosk-help', 'TV-/Kiosk-Ansicht', KIOSK_HELP)}
        </span>
      </div>
      <a href="/kiosk.html" target="_blank" rel="noopener" class="btn btn-block">Kiosk-Ansicht öffnen</a>
    </section>
  `;
}

export function renderSettings(container) {
  container.innerHTML = `
    <h1 class="view-title">Einstellungen</h1>
    <div class="grouped-page-sections">
      ${renderKioskSection()}
    </div>
  `;
  wireInfoTooltips(container);
}
