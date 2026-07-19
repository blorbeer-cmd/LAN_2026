// "Mehr" hub: the secondary destinations (Spielerprofile, Auswertungen,
// Hall of Fame, Info) each get their own clear entry point here, leaving
// the bottom nav to the things people reach for constantly during the party
// (tournaments earned that spot; the roster is mostly a setup-time concern
// since everyone self-onboards through their profile).

import { icon } from '../icons.js';
import { domainIcon } from '../domainIcons.js';

const ITEMS = [
  { view: 'admin', title: 'Admin' },
  { view: 'arrivals', title: 'An- & Abreise' },
  { view: 'arcade', title: 'Arcade' },
  { view: 'analytics', title: 'Auswertungen' },
  { view: 'broadcast', title: 'Durchsage' },
  { view: 'foodOrders', title: 'Essen' },
  { view: 'hallOfFame', title: 'Hall of Fame' },
  { view: 'infoBoard', title: 'Info' },
  { view: 'music', title: 'Jam' },
  { view: 'players', title: 'Spieler' },
  { view: 'gameCatalog', title: 'Spiele' },
];

export function renderMore(container) {
  const rows = ITEMS.map(
    (item) => `
    <button type="button" class="card row list-row more-card" data-navigate="${item.view}">
      <span class="more-card-label">
        <span class="list-row-icon">${icon(domainIcon(item.view))}</span>
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
