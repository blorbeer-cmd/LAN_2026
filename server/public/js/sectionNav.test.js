import test from 'node:test';
import assert from 'node:assert/strict';

import { SECTIONS, navGroupForView, renderSectionShell, sectionEntryView, sectionForView, sectionKeyForView } from './sectionNav.js';
import { VIEW_MANIFEST } from './viewManifest.js';

test('every section tab is a real route and belongs to exactly one section', () => {
  const seen = new Map();
  for (const [key, section] of Object.entries(SECTIONS)) {
    assert.ok(section.tabs.length >= 2, `${key} needs at least two tabs to justify a tab row`);
    for (const tab of section.tabs) {
      assert.ok(Object.hasOwn(VIEW_MANIFEST, tab.view), `${tab.view} is not a declared route`);
      assert.equal(seen.has(tab.view), false, `${tab.view} is claimed by two sections`);
      seen.set(tab.view, key);
      assert.equal(sectionKeyForView(tab.view), key, tab.view);
    }
  }
});

test('a section is entered on its first tab and its tabs share one nav group', () => {
  assert.equal(sectionEntryView('competition'), 'matchmaking');
  assert.equal(sectionEntryView('insights'), 'leaderboard');
  assert.equal(sectionEntryView('checklist'), null);
  // Orga's tabs are sorted alphabetically for display, so its first tab is
  // "An- & Abreise" - more.js uses this as the "Mehr" hub entry point too, so
  // the top-left tab is the one actually selected on arrival, like every
  // other section.
  assert.equal(sectionEntryView('orga'), 'arrivals');

  assert.deepEqual(SECTIONS.competition.tabs.map((tab) => tab.view), ['matchmaking', 'tournaments']);
  assert.equal(navGroupForView('matchmaking'), navGroupForView('tournaments'));
  assert.equal(navGroupForView('hallOfFame'), navGroupForView('leaderboard'));
  // A route outside every section stands for itself.
  assert.equal(navGroupForView('votes'), 'votes');
  assert.equal(sectionForView('votes'), null);
});

// Minimal stand-in for the container element: it models exactly what the shell
// touches (innerHTML, dataset, and the two querySelector shapes) and counts
// every innerHTML assignment, which is what "the shell was rebuilt" means here.
function stubContainer() {
  let html = '';
  let writes = 0;
  const sectionView = { name: 'section-view' };
  const counts = new Map();
  return {
    dataset: {},
    get innerHTML() {
      return html;
    },
    set innerHTML(value) {
      html = value;
      writes += 1;
      counts.clear();
    },
    get writes() {
      return writes;
    },
    counts,
    sectionView,
    querySelector(selector) {
      if (selector === ':scope > .section-view') {
        return html.includes('class="section-view"') ? sectionView : null;
      }
      const tab = selector.match(/^\[data-section-tab="([^"]+)"\] \[data-section-tab-count\]$/);
      if (!tab || !html.includes(`data-section-tab="${tab[1]}"`)) return null;
      if (!counts.has(tab[1])) counts.set(tab[1], { textContent: null });
      return counts.get(tab[1]);
    },
  };
}

test('the shell renders the area title, marks the active tab and returns the content slot', () => {
  const container = stubContainer();
  const slot = renderSectionShell(container, 'matchmaking', { badges: { checklist: 3 } });
  assert.equal(slot, container.sectionView);
  assert.match(container.innerHTML, /<h1 class="view-title">Match<\/h1>/);
  for (const tab of SECTIONS.competition.tabs) {
    assert.ok(container.innerHTML.includes(`data-section-tab="${tab.view}"`), tab.view);
  }
  // Exactly the active tab is marked, for assistive tech and visually.
  assert.equal((container.innerHTML.match(/aria-current="page"/g) ?? []).length, 1);
  assert.match(container.innerHTML, /data-section-tab="matchmaking" aria-current="page"/);
  assert.match(container.innerHTML, /data-section-tab="matchmaking"[^>]*>Teams</);

  renderSectionShell(container, 'checklist', { badges: { checklist: 3 } });
  assert.match(container.innerHTML, /data-section-tab="checklist"[^>]*>To-Do<span data-section-tab-count> \(3\)</);
  // A zero count must not render an empty-looking badge.
  const zero = stubContainer();
  renderSectionShell(zero, 'checklist', { badges: { checklist: 0 } });
  assert.match(zero.innerHTML, /data-section-tab="checklist"[^>]*>To-Do<span data-section-tab-count><\//);
  assert.equal(zero.innerHTML.includes('To-Do (0)'), false);
});

test('re-rendering the same route keeps the shell and its content element alive', () => {
  // A renderer may read its own previous DOM before overwriting it (the
  // Packliste carries the half-typed add-item field and its focus that way), so
  // a background refresh must not hand it a freshly emptied container.
  const container = stubContainer();
  const first = renderSectionShell(container, 'checklist', { badges: { checklist: 1 } });
  const writesAfterFirst = container.writes;

  const second = renderSectionShell(container, 'checklist', { badges: { checklist: 2 } });
  assert.equal(second, first, 'the same route must keep its content element');
  assert.equal(container.writes, writesAfterFirst, 'the shell must not be rebuilt for the same route');
  // Only the live count is patched, in place.
  assert.equal(container.counts.get('checklist').textContent, ' (2)');
  renderSectionShell(container, 'checklist', { badges: { checklist: 0 } });
  assert.equal(container.counts.get('checklist').textContent, '');

  // A different tab of the same area is a different route and does rebuild.
  const third = renderSectionShell(container, 'arrivals', { badges: { checklist: 2 } });
  assert.equal(container.writes, writesAfterFirst + 1);
  assert.equal(third, container.sectionView);
  assert.match(container.innerHTML, /data-section-tab="arrivals" aria-current="page"/);
});

test('the shell rebuilds after a view outside every area replaced the container', () => {
  const container = stubContainer();
  renderSectionShell(container, 'checklist', {});
  // Home and friends write the container themselves; the section marker alone
  // must not make the shell believe its DOM is still there.
  container.innerHTML = '<h1 class="view-title">Home</h1>';
  const slot = renderSectionShell(container, 'checklist', {});
  assert.equal(slot, container.sectionView);
  assert.match(container.innerHTML, /<h1 class="view-title">Orga<\/h1>/);
});

test('the shell refuses a route that belongs to no section', () => {
  assert.throws(() => renderSectionShell(stubContainer(), 'votes'), /Kein Bereich/);
});
