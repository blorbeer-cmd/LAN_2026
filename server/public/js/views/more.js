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
import { sectionEntryView } from '../sectionNav.js';
import { state } from '../state.js';
import { viewIsEnabledForEvent } from '../eventFeatures.js';
import { moreNavigationEntries } from '../viewManifest.js';

export function moreItemsForEvent(event) {
  return moreNavigationEntries(event?.eventType === 'general' ? 'general' : 'lan');
}

export function renderMore(container) {
  const visibleItems = moreItemsForEvent(state.activeEvent).map((item) => ({
    ...item,
    view: item.section ? sectionEntryView(item.section, state.activeEvent) : item.view,
  })).filter(
    (item) =>
      item.view &&
      viewIsEnabledForEvent(item.view, state.activeEvent) &&
      (item.requiresRole !== 'admin' || currentPlayerHasAdminRole()),
  );
  const rows = visibleItems
    .map(
      (item) => `
    <button type="button" class="card row list-row more-card" data-navigate="${item.view}">
      <span class="more-card-label">
        <span class="list-row-icon">${icon(domainIcon(item.iconKey))}</span>
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
