import assert from 'node:assert/strict';
import test from 'node:test';

// `currentPlayerMayUseArcadeAi()` reads the device-local admin flag, so the
// opponent helpers below need a localStorage stand-in before lobbyReady.js is
// imported. An empty store is the non-admin identity, which is exactly the
// case resetArcadeOpponentOnIdentityChange has to clean up after.
globalThis.localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };

const {
  arcadeLobbyModeButtonsHtml,
  arcadeLobbyOpponentToggleHtml,
  resetArcadeOpponentOnIdentityChange,
  wireArcadeOpponentToggle,
} = await import('./lobbyReady.js');

// Minimal stand-ins for the two DOM APIs the wiring helpers actually touch, so
// the wiring stays testable without pulling in a full DOM implementation.
function stubButton(value) {
  return { dataset: { arcadeOpponent: value }, handlers: [], addEventListener(_type, cb) { this.handlers.push(cb); }, click() { this.handlers.forEach((cb) => cb()); } };
}
function stubContainer(selectorMap) {
  return { querySelectorAll: (selector) => selectorMap[selector] ?? [] };
}

test('renders the shared arcade mode toggle with the selected button', () => {
  const html = arcadeLobbyModeButtonsHtml(
    'pong-mode',
    'Pong-Modus',
    [
      { value: 'duel', label: 'Duell' },
      { value: 'doubles', label: 'Doppel' },
    ],
    'duel'
  );

  assert.match(html, /id="pong-mode" class="arcade-mode-toggle" role="group" aria-label="Pong-Modus"/);
  assert.match(html, /class="arcade-mode-toggle-btn is-active" data-arcade-mode="duel" aria-pressed="true">Duell<\/button>/);
  assert.match(html, /class="arcade-mode-toggle-btn" data-arcade-mode="doubles" aria-pressed="false">Doppel<\/button>/);
  assert.doesNotMatch(html, /<select|>Modus</);
  assert.doesNotMatch(html, / disabled/);
});

test('escapes mode button content and supports disabled lobbies', () => {
  const html = arcadeLobbyModeButtonsHtml(
    'mode-<x>',
    'Modus "Test"',
    [{ value: 'a&b', label: '<Arena>' }],
    'a&b',
    true
  );

  assert.match(html, /id="mode-&lt;x&gt;"/);
  assert.match(html, /aria-label="Modus &quot;Test&quot;"/);
  assert.match(html, /data-arcade-mode="a&amp;b" aria-pressed="true" disabled>&lt;Arena&gt;<\/button>/);
  assert.match(html, / disabled/);
});

test('renders the opponent toggle as a mode-toggle sibling with its own data attribute', () => {
  const html = arcadeLobbyOpponentToggleHtml('tetris-opponent', 'human');

  assert.match(html, /id="tetris-opponent" class="arcade-mode-toggle" role="group" aria-label="Gegner"/);
  assert.match(html, /class="arcade-mode-toggle-btn is-active" data-arcade-opponent="human" aria-pressed="true">Mensch<\/button>/);
  assert.match(html, /class="arcade-mode-toggle-btn" data-arcade-opponent="bot" aria-pressed="false">KI<\/button>/);
  // The mode switch may sit in the same row, so the two must not share an
  // attribute — otherwise one wiring pass would capture both switches.
  assert.doesNotMatch(html, /data-arcade-mode=/);
  assert.doesNotMatch(html, / disabled/);
});

test('marks the bot segment active and supports a disabled opponent toggle', () => {
  const html = arcadeLobbyOpponentToggleHtml('cr-opponent', 'bot', true);

  assert.match(html, /data-arcade-opponent="bot" aria-pressed="true" disabled>KI<\/button>/);
  assert.match(html, /data-arcade-opponent="human" aria-pressed="false" disabled>Mensch<\/button>/);
});

test('treats an unknown opponent value as the human default', () => {
  const html = arcadeLobbyOpponentToggleHtml('snake-opponent', undefined);

  assert.match(html, /data-arcade-opponent="human" aria-pressed="true"/);
  assert.match(html, /data-arcade-opponent="bot" aria-pressed="false"/);
});

test('wires each opponent segment to its own value', () => {
  const human = stubButton('human');
  const bot = stubButton('bot');
  const selected = [];
  wireArcadeOpponentToggle(stubContainer({ '#quiz-opponent [data-arcade-opponent]': [human, bot] }), 'quiz-opponent', (value) => selected.push(value));

  bot.click();
  human.click();

  assert.deepEqual(selected, ['bot', 'human']);
});

test('clears an admin-gated opponent selection when the identity may not use Arcade AI', () => {
  const listeners = [];
  const previousWindow = globalThis.window;
  globalThis.window = { addEventListener: (type, cb) => listeners.push([type, cb]) };
  try {
    let opponent = 'bot';
    resetArcadeOpponentOnIdentityChange(() => { opponent = 'human'; });

    assert.deepEqual(listeners.map(([type]) => type), ['respawn:identity-changed']);
    // The stubbed store holds no admin flag, so the new identity may not use
    // Arcade AI and the stale 'bot' selection must not survive the switch.
    listeners[0][1]();
    assert.equal(opponent, 'human');
  } finally {
    globalThis.window = previousWindow;
  }
});
