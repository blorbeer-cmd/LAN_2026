// Top-level areas of the app. Several formerly standalone views now share one
// area with a tab row (Turniere+Teams, Rangliste+Statistiken+Hall of Fame,
// Packliste+To-Dos+An-/Abreise) so the bottom nav stays short and related work
// sits next to each other instead of in separate corners of the "Mehr" hub.
//
// Every tab keeps its own route on purpose. Deep links, the browser back
// button and already persisted push urls ("/#matchmaking", "/#checklist")
// therefore keep working exactly as before — only where a route is *presented*
// changed, not what it is called.

export const SECTIONS = Object.freeze({
  competition: Object.freeze({
    title: 'Wettkampf',
    tabs: Object.freeze([
      Object.freeze({ view: 'tournaments', label: 'Turniere' }),
      Object.freeze({ view: 'matchmaking', label: 'Teams' }),
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
  // To-Dos lead on purpose: that is what people open this area to check, and
  // it keeps the already persisted push url "/#checklist" landing where it
  // always did.
  orga: Object.freeze({
    title: 'Orga',
    tabs: Object.freeze([
      Object.freeze({ view: 'checklist', label: 'To-Dos' }),
      Object.freeze({ view: 'checklistPacking', label: 'Packliste' }),
      Object.freeze({ view: 'arrivals', label: 'An- & Abreise' }),
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

// The route a section opens on when it is entered from the bottom nav or the
// "Mehr" hub: always its first tab.
export function sectionEntryView(key) {
  return SECTIONS[key]?.tabs[0]?.view ?? null;
}

// Which nav entry should light up for the currently rendered route. A route
// inside an area highlights that area's button; everything else stands for
// itself.
export function navGroupForView(view) {
  return sectionKeyForView(view) ?? view;
}

// Renders an area's title and tab row into `container` and returns the element
// the active tab's own renderer should draw into. Sub-views keep rendering
// exactly as before — they just no longer own the page heading.
export function renderSectionShell(container, view, { badges = {} } = {}) {
  const section = sectionForView(view);
  if (!section) throw new Error(`Kein Bereich für Ansicht ${view}`);

  const tabs = section.tabs
    .map((tab) => {
      const active = tab.view === view;
      const badge = badges[tab.view];
      return `<button type="button" class="btn btn-sm section-tab${active ? ' btn-primary' : ''}"
        data-section-tab="${tab.view}"${active ? ' aria-current="page"' : ''}>${tab.label}${badge ? ` (${badge})` : ''}</button>`;
    })
    .join('');

  container.innerHTML = `
    <h1 class="view-title">${section.title}</h1>
    <nav class="section-tabs" aria-label="Bereiche in ${section.title}">${tabs}</nav>
    <div class="section-view"></div>
  `;
  return container.querySelector('.section-view');
}
