// "Mehr" hub: the secondary destinations that don't earn a bottom-nav slot.
// The nav itself carries what people reach for constantly during the party
// (Home, Wettkampf, Vote, Essen, Spiele); everything below is either
// preparation (Orga), a side activity (Arcade, Jam) or an organizer tool
// (Admin, which now also reaches Auswertung through its Werkzeuge). Info
// moved out entirely — it is a topbar dialog now, reachable from any view
// without leaving it.

import { icon } from '../icons.js';
import { domainIcon } from '../domainIcons.js';
import { currentPlayerHasAdminRole } from '../adminAccess.js';

const ITEMS = [
  // Moved out of the topbar to make room for the always-available Feedback
  // icon there; still just as reachable, one tap into "Mehr".
  { view: 'profile', title: 'Mein Profil' },
  { view: 'admin', title: 'Admin' },
  { view: 'arcade', title: 'Arcade' },
  { view: 'broadcast', title: 'Durchsage' },
  { view: 'music', title: 'Jam' },
  { view: 'checklist', title: 'Orga', iconKey: 'orga' },
];

export function renderMore(container) {
  const rows = ITEMS.filter((item) => item.view !== 'admin' || currentPlayerHasAdminRole())
    .map(
      (item) => `
    <button type="button" class="card row list-row more-card" ${item.action ?? `data-navigate="${item.view}"`}>
      <span class="more-card-label">
        <span class="list-row-icon">${icon(domainIcon(item.iconKey ?? item.view))}</span>
        <span class="player-name more-card-title">${item.title}</span>
      </span>
      <span class="muted more-card-chevron">${icon('chevronRight')}</span>
    </button>`
    )
    .join('');

  container.innerHTML = `
    <h1 class="view-title">Mehr</h1>
    <div class="card-grid more-grid">${rows}</div>
  `;
}
