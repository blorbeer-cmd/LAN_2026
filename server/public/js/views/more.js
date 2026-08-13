// "Mehr" hub: the secondary destinations that don't earn a bottom-nav slot.
// The nav itself carries what people reach for constantly during the party
// (Home, Wettkampf, Vote, Auswertung); everything below is either preparation
// (Orga), a side activity (Arcade, Jam, Essen) or an organizer tool (Admin).
// Info moved out entirely — it is a topbar dialog now, reachable from any view
// without leaving it.

import { icon } from '../icons.js';
import { domainIcon } from '../domainIcons.js';

const ITEMS = [
  { view: 'admin', title: 'Admin' },
  { view: 'arcade', title: 'Arcade' },
  { view: 'broadcast', title: 'Durchsage' },
  { view: 'foodOrders', title: 'Essen' },
  { view: 'music', title: 'Jam' },
  { view: 'checklist', title: 'Orga', iconKey: 'orga' },
  { view: 'gameCatalog', title: 'Spiele' },
];

export function renderMore(container) {
  const rows = ITEMS.map(
    (item) => `
    <button type="button" class="card row list-row more-card" data-navigate="${item.view}">
      <span class="more-card-label">
        <span class="list-row-icon">${icon(domainIcon(item.iconKey ?? item.view))}</span>
        <span class="player-name more-card-title">${item.title}</span>
      </span>
      <span class="muted more-card-chevron">${icon('chevronRight')}</span>
    </button>`
  ).join('');

  container.innerHTML = `
    <h1 class="view-title">Mehr</h1>
    <div class="card-grid more-grid">${rows}</div>
  `;
}
