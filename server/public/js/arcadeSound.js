// Retro arcade-cabinet sound effects for the Arcade games, synthesized with
// the Web Audio API (same approach as kiosk.js's push chime): no shipped
// audio file, so no extra asset, no licensing to think about and it works
// offline. Each cue is a short, distinct blip/sweep/fanfare modeled on the
// sound language of the classic it evokes (Pong's paddle "pock", Tetris'
// line-clear sweep, a game-show correct/wrong buzzer, ...) rather than a
// continuous music loop — games re-render their surrounding UI on every
// socket update, and restarting a music loop on every re-render would just
// produce audio glitches instead of atmosphere.
import { icon } from './icons.js';

const MUTE_KEY = 'lan-arcade-sound-muted';

let muted = readStoredMute();

function readStoredMute() {
  try {
    if (typeof window === 'undefined') return false;
    return window.localStorage.getItem(MUTE_KEY) === 'true';
  } catch {
    // Private browsing modes may deny localStorage; default to unmuted.
    return false;
  }
}

export function isArcadeSoundMuted() {
  return muted;
}

export function setArcadeSoundMuted(value) {
  muted = Boolean(value);
  try {
    if (typeof window !== 'undefined') window.localStorage.setItem(MUTE_KEY, String(muted));
  } catch {
    // The preference is optional and must not block playing.
  }
  return muted;
}

export function toggleArcadeSoundMuted() {
  return setArcadeSoundMuted(!muted);
}

// Games are set up via a user gesture (joining/starting a lobby), so this
// resolves the browser's autoplay policy in practice; the click/keydown
// fallback mirrors kiosk.js in case a sound is ever triggered before that.
let audioCtx = null;
function ensureAudioCtx() {
  if (typeof window === 'undefined') return null;
  const Ctor = window.AudioContext || window.webkitAudioContext;
  if (!Ctor) return null;
  if (!audioCtx) audioCtx = new Ctor();
  if (audioCtx.state === 'suspended') audioCtx.resume();
  return audioCtx;
}
if (typeof document !== 'undefined') {
  ['click', 'keydown'].forEach((evt) => document.addEventListener(evt, ensureAudioCtx, { once: true }));
}

function tone(ctx, start, { freq, freqEnd = null, dur = 0.12, type = 'square', peak = 0.18 }) {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, start);
  if (freqEnd) osc.frequency.exponentialRampToValueAtTime(Math.max(1, freqEnd), start + dur);
  gain.gain.setValueAtTime(0, start);
  gain.gain.linearRampToValueAtTime(peak, start + Math.min(0.015, dur / 4));
  gain.gain.exponentialRampToValueAtTime(0.0001, start + dur);
  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.start(start);
  osc.stop(start + dur + 0.02);
}

function noiseBurst(ctx, start, { dur = 0.2, peak = 0.3, filterFreq = 900 }) {
  const size = Math.max(1, Math.floor(ctx.sampleRate * dur));
  const buffer = ctx.createBuffer(1, size, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < size; i += 1) data[i] = Math.random() * 2 - 1;
  const noise = ctx.createBufferSource();
  noise.buffer = buffer;
  const filter = ctx.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.setValueAtTime(filterFreq, start);
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(peak, start);
  gain.gain.exponentialRampToValueAtTime(0.0001, start + dur);
  noise.connect(filter);
  filter.connect(gain);
  gain.connect(ctx.destination);
  noise.start(start);
  noise.stop(start + dur + 0.02);
}

function melody(ctx, now, notes, opts = {}) {
  notes.forEach(({ freq, at, dur = 0.14 }) => tone(ctx, now + at, { freq, dur, ...opts }));
}

// One builder per cue: `(ctx, now) => void`. Grouped by game so the sound
// language of each stays internally consistent; see the module comment for
// the reasoning behind each family. `SOUND_NAMES` (exported for tests) is
// always the same list as this map's keys.
const SOUND_CUES = {
  // Tetris: soft low "lock" click, an ascending sweep per cleared line (a
  // bigger sweep for a Tetris/four-line clear), a short rising level-up
  // sting and a descending "power-down" sweep on game over.
  'tetris-lock': (ctx, now) => tone(ctx, now, { freq: 180, dur: 0.06, type: 'square', peak: 0.14 }),
  'tetris-line': (ctx, now) => melody(ctx, now, [
    { freq: 520, at: 0 }, { freq: 660, at: 0.05 }, { freq: 830, at: 0.1 },
  ], { type: 'square', dur: 0.12, peak: 0.16 }),
  'tetris-tetris': (ctx, now) => melody(ctx, now, [
    { freq: 520, at: 0 }, { freq: 660, at: 0.06 }, { freq: 830, at: 0.12 }, { freq: 1046, at: 0.18 },
  ], { type: 'square', dur: 0.16, peak: 0.2 }),
  'tetris-levelup': (ctx, now) => melody(ctx, now, [{ freq: 660, at: 0 }, { freq: 990, at: 0.09 }], { type: 'triangle', dur: 0.18, peak: 0.2 }),
  'tetris-gameover': (ctx, now) => tone(ctx, now, { freq: 440, freqEnd: 90, dur: 0.9, type: 'sawtooth', peak: 0.18 }),

  // Snake: a quick high blip on eating, a harsh short buzz on crashing.
  'snake-eat': (ctx, now) => tone(ctx, now, { freq: 880, freqEnd: 1200, dur: 0.09, type: 'square', peak: 0.18 }),
  'snake-gameover': (ctx, now) => tone(ctx, now, { freq: 220, freqEnd: 60, dur: 0.5, type: 'sawtooth', peak: 0.2 }),

  // Pong: the iconic short square-wave "pock" on paddle/wall hits, a lower
  // thud when a point is scored, a short victory/defeat fanfare on match end.
  'pong-hit': (ctx, now) => tone(ctx, now, { freq: 240, dur: 0.05, type: 'square', peak: 0.2 }),
  'pong-score': (ctx, now) => tone(ctx, now, { freq: 140, dur: 0.16, type: 'square', peak: 0.2 }),
  'pong-win': (ctx, now) => melody(ctx, now, [{ freq: 523, at: 0 }, { freq: 659, at: 0.1 }, { freq: 784, at: 0.2 }], { type: 'square', dur: 0.16, peak: 0.2 }),
  'pong-lose': (ctx, now) => melody(ctx, now, [{ freq: 392, at: 0 }, { freq: 330, at: 0.12 }, { freq: 262, at: 0.24 }], { type: 'square', dur: 0.2, peak: 0.18 }),

  // Blobby Volley: a bouncy "pop" on hits, a cheerful chime on points, the
  // same win/lose fanfares as Pong but with a rounder waveform to feel bouncier.
  'blobby-hit': (ctx, now) => tone(ctx, now, { freq: 300, freqEnd: 500, dur: 0.08, type: 'sine', peak: 0.22 }),
  'blobby-score': (ctx, now) => melody(ctx, now, [{ freq: 660, at: 0 }, { freq: 880, at: 0.08 }], { type: 'sine', dur: 0.14, peak: 0.2 }),
  'blobby-win': (ctx, now) => melody(ctx, now, [{ freq: 523, at: 0 }, { freq: 659, at: 0.1 }, { freq: 784, at: 0.2 }, { freq: 1046, at: 0.3 }], { type: 'sine', dur: 0.18, peak: 0.2 }),
  'blobby-lose': (ctx, now) => melody(ctx, now, [{ freq: 392, at: 0 }, { freq: 330, at: 0.12 }, { freq: 262, at: 0.24 }], { type: 'sine', dur: 0.22, peak: 0.18 }),

  // Battleship: filtered noise for hit/sunk explosions and a soft splash
  // blip for a miss, plus short win/lose stings.
  'battleship-hit': (ctx, now) => noiseBurst(ctx, now, { dur: 0.25, peak: 0.32, filterFreq: 1200 }),
  'battleship-miss': (ctx, now) => tone(ctx, now, { freq: 700, freqEnd: 300, dur: 0.18, type: 'sine', peak: 0.14 }),
  'battleship-sunk': (ctx, now) => {
    noiseBurst(ctx, now, { dur: 0.4, peak: 0.35, filterFreq: 500 });
    tone(ctx, now + 0.05, { freq: 160, freqEnd: 50, dur: 0.4, type: 'sawtooth', peak: 0.2 });
  },
  'battleship-win': (ctx, now) => melody(ctx, now, [{ freq: 523, at: 0 }, { freq: 659, at: 0.1 }, { freq: 784, at: 0.2 }], { type: 'square', dur: 0.16, peak: 0.2 }),
  'battleship-lose': (ctx, now) => melody(ctx, now, [{ freq: 392, at: 0 }, { freq: 330, at: 0.12 }, { freq: 262, at: 0.24 }], { type: 'square', dur: 0.2, peak: 0.18 }),

  // Scribble: a gentle chime introduces a new round/word, a happy rising
  // arpeggio rewards a correct guess (game-show "you got it" feel), and a
  // dry tick marks the final low-time seconds.
  'scribble-round-start': (ctx, now) => melody(ctx, now, [{ freq: 440, at: 0 }, { freq: 554, at: 0.08 }], { type: 'triangle', dur: 0.16, peak: 0.16 }),
  'scribble-correct': (ctx, now) => melody(ctx, now, [{ freq: 523, at: 0 }, { freq: 659, at: 0.07 }, { freq: 784, at: 0.14 }, { freq: 1046, at: 0.21 }], { type: 'triangle', dur: 0.16, peak: 0.2 }),
  'scribble-tick': (ctx, now) => tone(ctx, now, { freq: 1000, dur: 0.04, type: 'square', peak: 0.12 }),

  // Challenge Rush: a crisp "go!" stab the instant a challenge starts (so
  // the countdown's end is heard, not just seen), a quick upward blip per
  // point (arcade score-attack feel), a triumphant fanfare for a new high
  // score and a plain descending tone for an ordinary game over.
  'challenge-start': (ctx, now) => melody(ctx, now, [{ freq: 660, at: 0 }, { freq: 880, at: 0.05 }], { type: 'sine', dur: 0.16, peak: 0.22 }),
  'challenge-point': (ctx, now) => tone(ctx, now, { freq: 700, freqEnd: 1000, dur: 0.07, type: 'square', peak: 0.18 }),
  'challenge-highscore': (ctx, now) => melody(ctx, now, [{ freq: 523, at: 0 }, { freq: 659, at: 0.09 }, { freq: 784, at: 0.18 }, { freq: 1046, at: 0.27 }], { type: 'square', dur: 0.18, peak: 0.22 }),
  'challenge-gameover': (ctx, now) => tone(ctx, now, { freq: 330, freqEnd: 90, dur: 0.5, type: 'sawtooth', peak: 0.18 }),

  // Gaming-Quiz: a classic game-show "ding" for correct, a harsh buzzer for
  // wrong, and a dry tick for the countdown.
  'quiz-correct': (ctx, now) => melody(ctx, now, [{ freq: 660, at: 0 }, { freq: 880, at: 0.09 }], { type: 'triangle', dur: 0.16, peak: 0.2 }),
  'quiz-wrong': (ctx, now) => tone(ctx, now, { freq: 180, dur: 0.3, type: 'sawtooth', peak: 0.2 }),
  'quiz-tick': (ctx, now) => tone(ctx, now, { freq: 900, dur: 0.04, type: 'square', peak: 0.12 }),
};

export const SOUND_NAMES = Object.keys(SOUND_CUES);

// A sound glitch (no audio device, autoplay still blocked, unsupported
// browser, ...) must never break the game itself — same guard as kiosk.js.
export function playArcadeSound(name) {
  if (muted) return;
  const build = SOUND_CUES[name];
  if (!build) return;
  try {
    const ctx = ensureAudioCtx();
    if (!ctx) return;
    build(ctx, ctx.currentTime);
  } catch {
    // see comment above — a sound failure must not affect gameplay
  }
}

export function arcadeMuteControlHtml() {
  return `<button type="button" class="btn btn-sm arcade-mute-btn" data-arcade-mute></button>`;
}

export function wireArcadeMuteControl(container) {
  const button = container.querySelector('[data-arcade-mute]');
  if (!button) return;
  const apply = () => {
    const isMuted = isArcadeSoundMuted();
    button.setAttribute('aria-pressed', String(isMuted));
    button.setAttribute('aria-label', isMuted ? 'Ton einschalten' : 'Ton stummschalten');
    button.title = isMuted ? 'Ton einschalten' : 'Ton stummschalten';
    button.innerHTML = icon(isMuted ? 'volumeOff' : 'volumeOn');
  };
  apply();
  button.addEventListener('click', () => {
    toggleArcadeSoundMuted();
    apply();
  });
}
