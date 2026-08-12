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
  assert.equal(sectionEntryView('competition'), 'tournaments');
  assert.equal(sectionEntryView('insights'), 'leaderboard');
  // To-Dos lead Orga, so the persisted push url "/#checklist" keeps landing
  // where it always did.
  assert.equal(sectionEntryView('checklist'), null);
  assert.equal(sectionEntryView('orga'), 'checklist');

  assert.equal(navGroupForView('matchmaking'), navGroupForView('tournaments'));
  assert.equal(navGroupForView('hallOfFame'), navGroupForView('leaderboard'));
  // A route outside every section stands for itself.
  assert.equal(navGroupForView('votes'), 'votes');
  assert.equal(sectionForView('votes'), null);
});

test('the shell renders the area title, marks the active tab and returns the content slot', () => {
  const tabs = [];
  const container = {
    innerHTML: '',
    querySelector: () => ({ tag: 'section-view' }),
  };
  const slot = renderSectionShell(container, 'matchmaking', { badges: { checklist: 3 } });
  assert.deepEqual(slot, { tag: 'section-view' });
  assert.match(container.innerHTML, /<h1 class="view-title">Wettkampf<\/h1>/);
  for (const tab of SECTIONS.competition.tabs) tabs.push(tab.view);
  for (const view of tabs) assert.ok(container.innerHTML.includes(`data-section-tab="${view}"`), view);
  // Exactly the active tab is marked, for assistive tech and visually.
  assert.equal((container.innerHTML.match(/aria-current="page"/g) ?? []).length, 1);
  assert.match(container.innerHTML, /data-section-tab="matchmaking" aria-current="page"/);
  assert.match(container.innerHTML, /data-section-tab="matchmaking"[^>]*>Teams</);

  renderSectionShell(container, 'checklist', { badges: { checklist: 3 } });
  assert.match(container.innerHTML, /data-section-tab="checklist"[^>]*>To-Dos \(3\)</);
  // A zero count must not render an empty-looking badge.
  renderSectionShell(container, 'checklist', { badges: { checklist: 0 } });
  assert.match(container.innerHTML, /data-section-tab="checklist"[^>]*>To-Dos</);
  assert.equal(container.innerHTML.includes('To-Dos (0)'), false);
});

test('the shell refuses a route that belongs to no section', () => {
  assert.throws(() => renderSectionShell({ innerHTML: '' }, 'votes'), /Kein Bereich/);
});
