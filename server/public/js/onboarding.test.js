import test from 'node:test';
import assert from 'node:assert/strict';
import { buildOnboardingSteps, visibleOnboardingTarget } from './onboarding.js';

test('onboarding uses the shared eight-step tour in the intended order', () => {
  const steps = buildOnboardingSteps();

  assert.deepEqual(steps.map((step) => step.title), [
    'Home',
    'Mein Profil',
    'Orga',
    'Ausgewähltes Event',
    'Match',
    'Vote',
    'Essen',
    'Spiele',
  ]);
  assert.equal(steps[2].text, 'Umfragen, An- & Abreise, Packliste und To-Dos helfen bei der LAN-Planung. Events und Gruppen verwaltest du separat über Events & Gruppen.');
  assert.equal(steps[3].text, 'Wähle oben im Header über den Eventnamen aus, in welchem Event du gerade bist.');
  assert.equal(steps[6].text, 'Hier organisiert ihr Sammelbestellungen und seht pro Person Positionen, Gesamtbetrag und Bezahlstatus. Ist ein PayPal-Link hinterlegt, kannst du damit zahlen.');
  assert.match(steps[0].text, /Fragezeichen neben jedem Bereichstitel.*Touren mit Beispielen/u);
  assert.equal(steps[7].text, 'Hinterlege vor der LAN deinen Skill in der Spieleliste für ausgeglichene Teams. Bock ist optional; während der LAN kannst du ihn über „Bock übernehmen“ aus Votes speichern.');
});

test('onboarding targets the visible shell variant instead of a hidden duplicate', () => {
  const hiddenCompactTarget = { getClientRects: () => [] };
  const visibleDesktopTarget = { getClientRects: () => [{ width: 160, height: 44 }] };
  const queryRoot = { querySelectorAll: () => [hiddenCompactTarget, visibleDesktopTarget] };
  assert.equal(visibleOnboardingTarget('.any-selector', queryRoot), visibleDesktopTarget);

  const steps = buildOnboardingSteps();
  for (const view of ['home', 'matchmaking', 'votes', 'profile']) {
    const step = steps.find((entry) => entry.view === view);
    assert.match(step.target, new RegExp(`desktop-nav-btn\\[data-view="${view}"\\]`), view);
  }
});
