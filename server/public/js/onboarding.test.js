import test from 'node:test';
import assert from 'node:assert/strict';
import { buildOnboardingSteps, visibleOnboardingTarget } from './onboarding.js';

test('onboarding keeps the event-selection step admin-only', () => {
  const memberSteps = buildOnboardingSteps(false);
  const adminSteps = buildOnboardingSteps(true);

  assert.equal(memberSteps.some((step) => step.view === 'analytics'), false);
  assert.equal(memberSteps.some((step) => step.view === 'admin'), false);

  const eventStep = adminSteps.find((step) => step.view === 'analytics');
  assert.deepEqual(eventStep, {
    title: 'Event-Auswahl',
    text: 'In den Auswertungen kannst du Spielzeit, Matches, Turniere und Arcade-Ergebnisse nach Event filtern. Achte vor jeder Auswertung darauf, welches Event im Dropdown ausgewählt ist – sonst siehst du möglicherweise die Daten einer anderen LAN oder aller Events.',
    view: 'analytics',
    target: 'section[aria-label="Ansicht"] .search-select-control',
  });
  assert.equal(adminSteps.at(-2)?.view, 'analytics');
  assert.equal(adminSteps.at(-1)?.view, 'gameCatalog');
  assert.equal(memberSteps.at(-1)?.view, 'gameCatalog');
  assert.equal(memberSteps.length - 1, 10);
  assert.equal(adminSteps.length - 1, 12);
});

test('onboarding targets the visible shell variant instead of a hidden duplicate', () => {
  const hiddenCompactTarget = { getClientRects: () => [] };
  const visibleDesktopTarget = { getClientRects: () => [{ width: 160, height: 44 }] };
  const queryRoot = { querySelectorAll: () => [hiddenCompactTarget, visibleDesktopTarget] };
  assert.equal(visibleOnboardingTarget('.any-selector', queryRoot), visibleDesktopTarget);

  const steps = buildOnboardingSteps(true);
  for (const view of ['home', 'matchmaking', 'votes', 'profile', 'arcade', 'broadcast', 'music', 'admin']) {
    const step = steps.find((entry) => entry.view === view);
    assert.match(step.target, new RegExp(`desktop-nav-btn\\[data-view="${view}"\\]`), view);
  }
});
