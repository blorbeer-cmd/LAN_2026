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
import { backButtonHtml } from './backButton.js';
import { SECTION_MANIFEST, sectionViews } from './viewManifest.js';

// Tabs and labels come from the route registry. The section manifest only
// supplies the shared area label/icon and optional navigation metadata.
export const SECTIONS = Object.freeze(Object.fromEntries(
  Object.entries(SECTION_MANIFEST).map(([key, section]) => [key, Object.freeze({
    title: section.label,
    tabs: Object.freeze(sectionViews(key)),
  })])
));

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
export function navGroupForView(view, event) {
  if (event?.eventType === 'general' && sectionKeyForView(view) === 'orga') return view;
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
  const sectionKey = sectionKeyForView(view);
  const visibleTabs = sectionTabsForEvent(sectionKey, event);
  const standalone = event?.eventType === 'general' && sectionKey === 'orga';
  const visibleTabSignature = standalone
    ? `standalone:${view}`
    : visibleTabs.map((tab) => tab.view).join(',');

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

  const activeTab = visibleTabs.find((tab) => tab.view === view);
  const title = standalone ? activeTab?.label ?? section.title : section.title;
  const tabNavigation = standalone
    ? ''
    : `<nav class="section-tabs" aria-label="Bereiche in ${section.title}">${tabs}</nav>`;
  const heading = sectionKey === 'orga' && !standalone
    ? `<div class="more-subpage-header more-subpage-header--tabs">
         <div class="more-subpage-title-row">
           ${backButtonHtml({ view: 'more' })}
           <h1 class="view-title">${title}</h1>
         </div>
         ${tabNavigation}
       </div>`
    : standalone
      ? `<h1 class="view-title">${title}</h1>`
      : `<div class="section-page-header"><h1 class="view-title">${title}</h1>${tabNavigation}</div>`;
  container.innerHTML = `
    ${heading}
    <div class="section-view"></div>
  `;
  container.dataset.sectionView = view;
  container.dataset.sectionTabs = visibleTabSignature;
  return container.querySelector(':scope > .section-view');
}
