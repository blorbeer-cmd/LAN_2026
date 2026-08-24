// Top-level areas of the app. Several formerly standalone views now share one
// area with a tab row (Teams+Turniere, Rangliste+Statistiken+Hall of Fame,
// Packliste+To-Dos+An-/Abreise) so the bottom nav stays short and related work
// sits next to each other instead of in separate corners of the "Mehr" hub.
//
// Every tab keeps its own route on purpose. Deep links, the browser back
// button and already persisted push urls ("/#matchmaking", "/#checklist")
// therefore keep working exactly as before — only where a route is *presented*
// changed, not what it is called.

import { viewIsEnabledForEvent } from './eventFeatures.js';

export const SECTIONS = Object.freeze({
  competition: Object.freeze({
    title: 'Match',
    tabs: Object.freeze([
      Object.freeze({ view: 'matchmaking', label: 'Teams' }),
      Object.freeze({ view: 'tournaments', label: 'Turniere' }),
    ]),
  }),
  insights: Object.freeze({
    title: 'Auswertung',
    tabs: Object.freeze([
      Object.freeze({ view: 'leaderboard', label: 'Rangliste' }),
      Object.freeze({ view: 'analytics', label: 'Statistiken' }),
      Object.freeze({ view: 'hallOfFame', label: 'Hall of Fame' }),
    ]),
  }),
  // Tabs are sorted alphabetically by their German label. The "Mehr" hub
  // opens this area on its first tab, "An- & Abreise", like every other
  // section (see sectionEntryView below and more.js). The already persisted
  // push url "/#checklist" is unaffected — it still routes straight to the
  // To-Do tab. TV-Kiosk is not a tab here — it lives only in Admin's
  // "Kioskverwaltung" tool card, which is the single entry point now.
  orga: Object.freeze({
    title: 'Orga',
    tabs: Object.freeze([
      Object.freeze({ view: 'arrivals', label: 'An- & Abreise' }),
      Object.freeze({ view: 'events', label: 'Events' }),
      Object.freeze({ view: 'checklistPacking', label: 'Packliste' }),
      Object.freeze({ view: 'checklist', label: 'To-Do' }),
    ]),
  }),
});

// view -> section key, for every route that belongs to one.
const SECTION_BY_VIEW = Object.freeze(
  Object.fromEntries(
    Object.entries(SECTIONS).flatMap(([key, section]) => section.tabs.map((tab) => [tab.view, key]))
  )
);

export function sectionKeyForView(view) {
  return SECTION_BY_VIEW[view] ?? null;
}

export function sectionForView(view) {
  const key = sectionKeyForView(view);
  return key ? SECTIONS[key] : null;
}

export function sectionTabsForEvent(key, event) {
  return (SECTIONS[key]?.tabs ?? []).filter((tab) => viewIsEnabledForEvent(tab.view, event));
}

// The route a section opens on when it is entered from the bottom nav or the
// "Mehr" hub: the first tab available for the active event.
export function sectionEntryView(key, event) {
  return sectionTabsForEvent(key, event)[0]?.view ?? null;
}

// Which nav entry should light up for the currently rendered route. A route
// inside an area highlights that area's button; everything else stands for
// itself.
export function navGroupForView(view) {
  return sectionKeyForView(view) ?? view;
}

function badgeText(count) {
  return count ? ` (${count})` : '';
}

// Renders an area's title and tab row into `container` and returns the element
// the active tab's own renderer should draw into. Sub-views keep rendering
// exactly as before — they just no longer own the page heading.
//
// Re-rendering the same route keeps the existing shell and hands back the very
// same `.section-view` element instead of a fresh empty one. Several renderers
// read their own previous DOM before overwriting it — the Packliste carries the
// half-typed add-item field and its focus that way — and replacing the node
// first would silently hand them an empty container on every background
// refresh. Only the live tab counts are patched in place.
export function renderSectionShell(container, view, { badges = {}, event } = {}) {
  const section = sectionForView(view);
  if (!section) throw new Error(`Kein Bereich für Ansicht ${view}`);
  const visibleTabs = sectionTabsForEvent(sectionKeyForView(view), event);
  const visibleTabSignature = visibleTabs.map((tab) => tab.view).join(',');

  const existing = container.querySelector(':scope > .section-view');
  if (
    existing &&
    container.dataset.sectionView === view &&
    container.dataset.sectionTabs === visibleTabSignature
  ) {
    for (const tab of visibleTabs) {
      const count = container.querySelector(`[data-section-tab="${tab.view}"] [data-section-tab-count]`);
      if (count) count.textContent = badgeText(badges[tab.view]);
    }
    return existing;
  }

  const tabs = visibleTabs
    .map((tab) => {
      const active = tab.view === view;
      return `<button type="button" class="btn btn-sm section-tab${active ? ' btn-primary' : ''}"
        data-section-tab="${tab.view}"${active ? ' aria-current="page"' : ''}>${tab.label}<span data-section-tab-count>${badgeText(badges[tab.view])}</span></button>`;
    })
    .join('');

  container.innerHTML = `
    <h1 class="view-title">${section.title}</h1>
    <nav class="section-tabs" aria-label="Bereiche in ${section.title}">${tabs}</nav>
    <div class="section-view"></div>
  `;
  container.dataset.sectionView = view;
  container.dataset.sectionTabs = visibleTabSignature;
  return container.querySelector(':scope > .section-view');
}
