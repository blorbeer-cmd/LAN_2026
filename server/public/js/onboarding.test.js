import test from 'node:test';
import assert from 'node:assert/strict';
import { buildOnboardingSteps, visibleOnboardingTarget } from './onboarding.js';
import { gameRowHtml } from './views/gameCatalog.js';
import { state } from './state.js';

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
  assert.match(steps[0].text, /Fragezeichen neben jedem Bereichstitel.*kurze Touren/u);
  assert.equal(steps[7].text, 'Hinterlege vor der LAN unter Spiele deinen Skill für ausgeglichene Teams. Bock ist optional; während der LAN kannst du ihn über „Bock übernehmen“ aus Votes speichern.');
});

test('onboarding targets the visible shell variant instead of a hidden duplicate', () => {
  const hiddenCompactTarget = { getClientRects: () => [] };
  const visibleDesktopTarget = { getClientRects: () => [{ width: 160, height: 44 }] };
  const queryRoot = { querySelectorAll: () => [hiddenCompactTarget, visibleDesktopTarget] };
  assert.equal(visibleOnboardingTarget('.any-selector', queryRoot), visibleDesktopTarget);

  const steps = buildOnboardingSteps();
  const help = { getClientRects: () => [{ width: 44, height: 32 }] };
  const targets = { querySelectorAll: (selector) => selector.includes('data-area-tour-open') ? [help] : [visibleDesktopTarget] };
  assert.equal(visibleOnboardingTarget(steps[0].target, targets), help, 'the question mark takes priority over navigation');
  assert.equal(visibleOnboardingTarget(steps[0].target, { querySelectorAll: (selector) => selector.includes('data-area-tour-open') ? [] : [visibleDesktopTarget] }),
    visibleDesktopTarget, 'navigation remains available as a fallback');
  for (const view of ['home', 'matchmaking', 'votes', 'profile']) {
    const step = steps.find((entry) => entry.view === view);
    assert.match(step.target, new RegExp(`desktop-nav-btn\\[data-view="${view}"\\]`), view);
  }
});

test('optional rating rows request only missing own Skill and accept zero as a completed rating', () => {
  const previousSkills = state.skills;
  const previousPreferences = state.preferences;
  const game = { id: 'rating-game', name: 'Rocket League', genres: [], processNames: [] };
  try {
    state.preferences = [{ player_id: 'me', game_id: game.id, rating: 5 }];
    state.skills = [{ player_id: 'other', game_id: game.id, rating: 4 }];
    assert.match(gameRowHtml(game, 'me', false, true), /onboarding-required-badge">Skill nötig<\/span>/u,
      'Bock and another player’s Skill do not settle the missing own Skill');
    assert.doesNotMatch(gameRowHtml(game, 'me', false, false), /onboarding-required/u,
      'games outside the required set do not request a rating');
    for (const rating of [0, 4]) {
      state.skills.push({ player_id: 'me', game_id: game.id, rating });
      assert.doesNotMatch(gameRowHtml(game, 'me', false, true), /onboarding-required/u,
        `Skill ${rating} removes both the request and required-row highlight`);
      state.skills.pop();
    }
  } finally {
    state.skills = previousSkills;
    state.preferences = previousPreferences;
  }
});
