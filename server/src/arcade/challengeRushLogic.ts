import { createHash } from 'node:crypto';

export type ChallengeKey =
  | 'reaction-circle' | 'cps' | 'number-salad' | 'timing-10'
  | 'aim-trainer' | 'memory-sequence' | 'odd-one-out' | 'whack-a-mole' | 'traffic-light' | 'color-word'
  | 'number-sequence' | 'logic-equation' | 'pattern-complete' | 'category-sort' | 'direction-match'
  | 'mental-rotation' | 'word-scramble' | 'count-shapes' | 'logic-order' | 'delayed-recall'
  | 'prime-check' | 'balance-scale' | 'clock-angle' | 'binary-pattern' | 'rule-switch'
  | 'matrix-missing' | 'coin-change' | 'letter-order' | 'digit-sum' | 'sequence-transform'
  | 'sequence-echo' | 'reverse-echo' | 'memory-matrix' | 'number-blind'
  | 'n-back' | 'seen-before' | 'missing-item' | 'memory-pairs'
  | 'path-memory' | 'suitcase-memory';

export interface ChallengeDefinition { key: ChallengeKey; title: string; description: string; durationMs: number }
export const CHALLENGES: ChallengeDefinition[] = [
  { key: 'reaction-circle', title: 'Klick den Kreis', description: 'Klicke den Kreis so schnell wie möglich.', durationMs: 30_000 },
  { key: 'cps', title: 'CPS-Test', description: 'Klicke 30 Sekunden lang so oft du kannst.', durationMs: 30_000 },
  { key: 'number-salad', title: 'Zahlensalat', description: 'Klicke die Zahlen in aufsteigender Reihenfolge.', durationMs: 30_000 },
  { key: 'timing-10', title: 'Stoppe bei 10 Sekunden', description: 'Stoppe den unsichtbaren Timer möglichst genau bei 10,00 Sekunden.', durationMs: 30_000 },
  { key: 'aim-trainer', title: 'Aim Trainer', description: 'Triff alle Ziele so schnell wie möglich.', durationMs: 30_000 },
  { key: 'memory-sequence', title: 'Merk dir die Reihenfolge', description: 'Merke dir die aufleuchtenden Felder und wiederhole sie.', durationMs: 30_000 },
  { key: 'odd-one-out', title: 'Finde den Unterschied', description: 'Finde das eine abweichende Feld im Raster.', durationMs: 30_000 },
  { key: 'whack-a-mole', title: 'Whack-a-Mole', description: 'Klicke die aufleuchtenden Löcher in der richtigen Reihenfolge.', durationMs: 30_000 },
  { key: 'traffic-light', title: 'Ampel-Reaktion', description: 'Klicke erst, wenn die Ampel auf Grün springt. Zu früh zählt als Fehlstart.', durationMs: 30_000 },
  { key: 'color-word', title: 'Farbwort-Chaos', description: 'Wähle die Schriftfarbe, nicht das geschriebene Wort.', durationMs: 30_000 },
  { key: 'number-sequence', title: 'Zahlenfolge', description: 'Erkenne die Regel und wähle die nächste Zahl.', durationMs: 30_000 },
  { key: 'logic-equation', title: 'Rechenlogik', description: 'Löse kurze Kopfrechenaufgaben unter Zeitdruck.', durationMs: 30_000 },
  { key: 'pattern-complete', title: 'Muster ergänzen', description: 'Erkenne das wiederkehrende Symbolmuster.', durationMs: 30_000 },
  { key: 'category-sort', title: 'Kategorie-Sortierung', description: 'Ordne Begriffe möglichst schnell der richtigen Kategorie zu.', durationMs: 30_000 },
  { key: 'direction-match', title: 'Richtungslogik', description: 'Verfolge Drehungen und bestimme die Endrichtung.', durationMs: 30_000 },
  { key: 'mental-rotation', title: 'Mentale Rotation', description: 'Drehe ein Symbol gedanklich und finde das Ergebnis.', durationMs: 30_000 },
  { key: 'word-scramble', title: 'Buchstaben-Salat', description: 'Setze einen verdrehten Begriff wieder zusammen.', durationMs: 30_000 },
  { key: 'count-shapes', title: 'Formen zählen', description: 'Zähle ein bestimmtes Symbol in einer Reihe.', durationMs: 30_000 },
  { key: 'logic-order', title: 'Reihenfolge-Logik', description: 'Ordne Elemente anhand der Hinweise.', durationMs: 30_000 },
  { key: 'delayed-recall', title: 'Verzögerter Abruf', description: 'Merke dir eine Liste und wähle später den gesuchten Begriff.', durationMs: 30_000 },
  { key: 'prime-check', title: 'Primzahl-Check', description: 'Erkenne schnell, ob eine Zahl eine Primzahl ist.', durationMs: 30_000 },
  { key: 'balance-scale', title: 'Waagenlogik', description: 'Bestimme das fehlende Gewicht aus einer Gleichung.', durationMs: 30_000 },
  { key: 'clock-angle', title: 'Uhrwinkel', description: 'Berechne den kleineren Winkel zwischen den Zeigern.', durationMs: 30_000 },
  { key: 'binary-pattern', title: 'Binärmuster', description: 'Erkenne die nächste Null oder Eins.', durationMs: 30_000 },
  { key: 'rule-switch', title: 'Regelwechsel', description: 'Wechsle zwischen gerader und ungerader Sortierregel.', durationMs: 30_000 },
  { key: 'matrix-missing', title: 'Zahlenmatrix', description: 'Finde die fehlende Zahl in einer kleinen Matrix.', durationMs: 30_000 },
  { key: 'coin-change', title: 'Münzwechsel', description: 'Finde die minimale Anzahl an Münzen.', durationMs: 30_000 },
  { key: 'letter-order', title: 'Buchstabenordnung', description: 'Finde den alphabetisch ersten Buchstaben.', durationMs: 30_000 },
  { key: 'digit-sum', title: 'Ziffernsumme', description: 'Berechne die Quersumme einer Zahl.', durationMs: 30_000 },
  { key: 'sequence-transform', title: 'Folgen-Operator', description: 'Erkenne die Rechenoperation zwischen den Folgengliedern.', durationMs: 30_000 },
  { key: 'sequence-echo', title: 'Sequenz-Echo', description: 'Merke dir Feldfolgen und wiederhole sie.', durationMs: 30_000 },
  { key: 'reverse-echo', title: 'Rückwärts-Echo', description: 'Wiederhole die gezeigte Folge rückwärts.', durationMs: 30_000 },
  { key: 'memory-matrix', title: 'Memory-Matrix', description: 'Merke dir markierte Felder im Raster.', durationMs: 30_000 },
  { key: 'number-blind', title: 'Zahlenblende', description: 'Merke dir Zahlenpositionen und klicke sie aufsteigend.', durationMs: 30_000 },
  { key: 'n-back', title: 'N-zurück', description: 'Erkenne, ob das Symbol vor N Schritten erschien.', durationMs: 30_000 },
  { key: 'seen-before', title: 'Schon gesehen?', description: 'Ordne Symbole als neu oder bereits gesehen ein.', durationMs: 30_000 },
  { key: 'missing-item', title: 'Was fehlt?', description: 'Finde den verschwundenen Gegenstand.', durationMs: 30_000 },
  { key: 'memory-pairs', title: 'Memory-Paare-Blitz', description: 'Finde möglichst viele Paare.', durationMs: 30_000 },
  { key: 'path-memory', title: 'Pfad-Gedächtnis', description: 'Merke dir einen Weg und tippe ihn nach.', durationMs: 30_000 },
  { key: 'suitcase-memory', title: 'Kofferpacken', description: 'Merke dir geordnete Gegenstandslisten.', durationMs: 30_000 },
];

export type TrialPhase = 'preview' | 'input';
export interface TrialPayload {
  trialId: string; index: number; difficulty: number; phase: TrialPhase; phaseMs: number;
  phaseRemainingMs?: number; inputMs: number; inputRemainingMs?: number;
  resume?: Record<string, unknown>; data: Record<string, unknown>;
}
export interface InternalTrial extends TrialPayload { expected: unknown; state: Record<string, unknown> }
export interface TrialResult { accepted: boolean; complete: boolean; correct: boolean; errors: number; rawScore: number; error?: string }

export interface ChallengePayload { key: ChallengeKey; title: string; description: string; durationMs: number; seed: number; data: Record<string, unknown> }

// A plain linear congruential generator is invertible: revealing any single
// output (e.g. the first Aim Trainer target, which the player has to see to
// play) lets an attacker solve for the generator's internal state and
// reconstruct every later output — including, since challenge seeds are
// derived from the match seed, every remaining challenge in the match.
// Hashing (seed, counter) through SHA-256 for every call has no such
// algebraic shortcut: recovering the seed from a digest is a preimage
// attack, not solvable arithmetic, so this stays safe even once a value
// has to be revealed for gameplay.
export function seededRandom(seed: number): () => number {
  let counter = 0;
  return () => {
    counter += 1;
    const digest = createHash('sha256').update(`${seed}:${counter}`).digest();
    return digest.readUInt32BE(0) / 0x1_0000_0000;
  };
}

export function shuffled<T>(items: T[], random: () => number): T[] {
  const result = [...items];
  for (let index = result.length - 1; index > 0; index -= 1) { const swap = Math.floor(random() * (index + 1)); [result[index], result[swap]] = [result[swap], result[index]]; }
  return result;
}

function randomSequence(random: () => number, length: number, max: number): number[] {
  const sequence: number[] = [];
  for (let index = 0; index < length; index += 1) {
    let next = Math.floor(random() * max);
    if (sequence.length > 0 && next === sequence[sequence.length - 1]) next = (next + 1) % max;
    sequence.push(next);
  }
  return sequence;
}

export const AIM_TRAINER_TARGET_COUNT = 6;
export const MEMORY_SEQUENCE_TILE_COUNT = 9;
export const MEMORY_SEQUENCE_LENGTH = 5;
// Matches the client's reveal animation step (server/public/js/views/challengeRush.js,
// MEMORY_REVEAL_STEP_MS) — the two aren't otherwise linked since public/ has no build
// step to share a constant with src/. The full sequence is sent up front so the client
// can render the reveal, so the server must independently withhold real input
// acceptance until that reveal is actually over; without this, a scripted client could
// answer instantly and always score 100.
export const MEMORY_REVEAL_STEP_MS = 700;
export const MEMORY_REVEAL_TOTAL_MS = MEMORY_SEQUENCE_LENGTH * MEMORY_REVEAL_STEP_MS;
export const ODD_ONE_OUT_TILE_COUNT = 16;
export const WHACK_A_MOLE_HOLE_COUNT = 9;
export const WHACK_A_MOLE_SEQUENCE_LENGTH = 8;
export const COLOR_WORD_ROUND_COUNT = 6;
export const COLOR_WORD_COLORS: Array<{ key: string; word: string }> = [
  { key: 'red', word: 'Rot' }, { key: 'blue', word: 'Blau' }, { key: 'green', word: 'Grün' }, { key: 'yellow', word: 'Gelb' },
];

export function challengePayload(key: ChallengeKey, seed: number): ChallengePayload {
  const definition = CHALLENGES.find((entry) => entry.key === key);
  if (!definition) throw new Error('Unbekannte Challenge.');
  const random = seededRandom(seed);
  if (key === 'reaction-circle') return { ...definition, seed, data: { x: 15 + random() * 70, y: 20 + random() * 60 } };
  if (key === 'number-salad') {
    const numbers = shuffled(Array.from({ length: 8 }, (_, index) => index + 1), random);
    return { ...definition, seed, data: { numbers } };
  }
  if (key === 'aim-trainer') {
    const targets = Array.from({ length: AIM_TRAINER_TARGET_COUNT }, () => ({ x: 15 + random() * 70, y: 20 + random() * 60 }));
    // targetCount is a fixed, non-secret constant (not derived from the
    // targets array): the per-player wire payload later strips `targets`
    // down to just the current one, so the total needs its own field to
    // still render "X / 6 getroffen".
    return { ...definition, seed, data: { targets, targetCount: AIM_TRAINER_TARGET_COUNT } };
  }
  if (key === 'memory-sequence') {
    return { ...definition, seed, data: { tileCount: MEMORY_SEQUENCE_TILE_COUNT, sequence: randomSequence(random, MEMORY_SEQUENCE_LENGTH, MEMORY_SEQUENCE_TILE_COUNT) } };
  }
  if (key === 'odd-one-out') {
    return { ...definition, seed, data: { tileCount: ODD_ONE_OUT_TILE_COUNT, oddIndex: Math.floor(random() * ODD_ONE_OUT_TILE_COUNT), subtlety: 1 + Math.floor(random() * 5) } };
  }
  if (key === 'whack-a-mole') {
    return { ...definition, seed, data: { holeCount: WHACK_A_MOLE_HOLE_COUNT, sequence: randomSequence(random, WHACK_A_MOLE_SEQUENCE_LENGTH, WHACK_A_MOLE_HOLE_COUNT), totalHits: WHACK_A_MOLE_SEQUENCE_LENGTH } };
  }
  if (key === 'traffic-light') {
    return { ...definition, seed, data: { greenAtMs: 2_000 + Math.floor(random() * 3_500) } };
  }
  if (key === 'color-word') {
    const rounds = Array.from({ length: COLOR_WORD_ROUND_COUNT }, () => {
      const word = COLOR_WORD_COLORS[Math.floor(random() * COLOR_WORD_COLORS.length)];
      const textColor = COLOR_WORD_COLORS[Math.floor(random() * COLOR_WORD_COLORS.length)];
      return { word: word.word, textColor: textColor.key, options: shuffled(COLOR_WORD_COLORS.map((entry) => entry.key), random) };
    });
    return { ...definition, seed, data: { rounds, roundCount: COLOR_WORD_ROUND_COUNT } };
  }
  return { ...definition, seed, data: {} };
}

const LOGIC_KEYS = new Set<ChallengeKey>([
  'number-sequence', 'logic-equation', 'pattern-complete', 'category-sort', 'direction-match',
  'mental-rotation', 'word-scramble', 'count-shapes', 'logic-order', 'delayed-recall',
  'prime-check', 'balance-scale', 'clock-angle', 'binary-pattern', 'rule-switch',
  'matrix-missing', 'coin-change', 'letter-order', 'digit-sum', 'sequence-transform',
]);
const MEMORY_TRIAL_KEYS = new Set<ChallengeKey>([
  'sequence-echo', 'reverse-echo', 'memory-matrix', 'number-blind', 'n-back',
  'seen-before', 'missing-item', 'memory-pairs', 'path-memory', 'suitcase-memory',
]);
const TRIAL_KEYS = new Set<ChallengeKey>([...LOGIC_KEYS, ...MEMORY_TRIAL_KEYS]);
export function isTrialChallenge(key: ChallengeKey): boolean { return TRIAL_KEYS.has(key); }
export function difficultyFor(streak: number): number { return Math.max(1, Math.min(5, 1 + Math.floor(Math.max(0, streak) / 2))); }

export const CHALLENGE_SYMBOLS = ['◆', '●', '▲', '■', '★', '⬟', '✚', '☀', '☘', '⬢'] as const;
const SEEN_BASE_SYMBOLS = [
  ...CHALLENGE_SYMBOLS, '▼', '◀', '▶', '♠', '♥', '♦', '♣', '❄', '☾', '✿',
  '⌂', '⚑', '✎', '☯', '☂', '⚓', '✈', '☎', '♫', '✂', '☕', '⌘',
] as const;
// 1,024 recognizable symbol pairs outlast even the 30 ms server input floor for a
// complete 30-second round. No generation reset can therefore redefine a symbol
// that the player genuinely saw earlier in the same round as "new".
export const SEEN_BEFORE_SYMBOLS = SEEN_BASE_SYMBOLS.flatMap((left) => SEEN_BASE_SYMBOLS.map((right) => `${left}${right}`));
export function seenBeforeSelection(wantsRepeat: boolean, seenSymbols: string[], index: number): { symbol: string; repeated: boolean; seenSymbols: string[] } {
  const unused = SEEN_BEFORE_SYMBOLS.filter((symbol) => !seenSymbols.includes(symbol));
  const repeated = (wantsRepeat || unused.length === 0) && seenSymbols.length > 0;
  const symbol = repeated
    ? seenSymbols[index % seenSymbols.length]
    : unused[index % unused.length];
  return { symbol, repeated, seenSymbols: repeated ? seenSymbols : [...seenSymbols, symbol] };
}

const ITEMS = ['Schlüssel', 'Becher', 'Würfel', 'Lampe', 'Karte', 'Stern', 'Brille', 'Uhr', 'Ball', 'Pfeil', 'Ring', 'Buch'];
const CATEGORY_ITEMS = [
  { item: 'Apfel', category: 'Obst' }, { item: 'Karotte', category: 'Gemüse' },
  { item: 'Banane', category: 'Obst' }, { item: 'Paprika', category: 'Gemüse' },
  { item: 'Birne', category: 'Obst' }, { item: 'Gurke', category: 'Gemüse' },
];
const SCRAMBLE_WORDS = ['KARTE', 'LAMPE', 'STERN', 'BRILLE', 'WÜRFEL', 'KAMERA', 'FENSTER'];
const DIRECTIONS = ['Norden', 'Osten', 'Süden', 'Westen'];

function numericOptions(expected: number, random: () => number, offsets = [-1, 1, 2, -2]): string[] {
  const values = [expected];
  for (const offset of offsets) {
    const candidate = expected + offset;
    if (candidate >= 0 && !values.includes(candidate)) values.push(candidate);
    if (values.length === 4) break;
  }
  for (let offset = 3; values.length < 4; offset += 1) if (!values.includes(expected + offset)) values.push(expected + offset);
  return shuffled(values.map(String), random);
}
function gridSequence(random: () => number, count: number, size: number): number[] {
  return shuffled(Array.from({ length: size * size }, (_, index) => index), random).slice(0, count);
}
function trialId(index: number, seed: number): string { return `${index}-${seed >>> 0}`; }
function previewMs(difficulty: number): number { return Math.max(450, 1_000 - difficulty * 100); }
export function inputWindowMs(key: ChallengeKey, difficulty: number): number {
  const level = Math.max(1, Math.min(5, difficulty));
  if (key === 'n-back' || key === 'seen-before') return 1_800 - level * 180;
  if (key === 'memory-pairs') return 9_000 - level * 600;
  if (MEMORY_TRIAL_KEYS.has(key)) return 6_500 - level * 450;
  return 5_500 - level * 500;
}
function choiceTrial(key: ChallengeKey, id: string, index: number, difficulty: number, data: Record<string, unknown>, expected: string | number, phase: TrialPhase = 'input', phaseMs = 0): InternalTrial {
  return { trialId: id, index, difficulty, phase, phaseMs, inputMs: inputWindowMs(key, difficulty), data, expected, state: {} };
}

export function createTrial(key: ChallengeKey, seed: number, index: number, difficulty: number, symbolHistory: string[] = []): InternalTrial {
  if (!isTrialChallenge(key)) throw new Error('Challenge verwendet keine Trials.');
  const random = seededRandom((seed ^ Math.imul(difficulty, 0x9e3779b9)) >>> 0);
  const id = trialId(index, seed);
  const size = difficulty >= 4 ? 5 : difficulty >= 2 ? 4 : 3;
  if (key === 'number-sequence') {
    const start = 2 + Math.floor(random() * 8); const step = 1 + difficulty + Math.floor(random() * 3); const expected = start + step * 3;
    return choiceTrial(key, id, index, difficulty, { type: 'choice', prompt: `${start}, ${start + step}, ${start + step * 2}, ?`, options: numericOptions(expected, random, [-step, step, 1, -1]) }, String(expected));
  }
  if (key === 'logic-equation') {
    const range = 8 + difficulty * 4; const a = 2 + Math.floor(random() * range); const b = 2 + Math.floor(random() * (5 + difficulty)); const c = 1 + Math.floor(random() * (3 + difficulty)); const expected = a + b * c;
    return choiceTrial(key, id, index, difficulty, { type: 'choice', prompt: `${a} + ${b} × ${c} = ?`, options: numericOptions(expected, random, [b, -c, 2, -2]) }, String(expected));
  }
  if (key === 'pattern-complete') {
    const symbols = ['◆', '●', '▲', '■']; const base = Math.floor(random() * symbols.length); const pattern = [0, 1, 2, 0, 1, 2].map((offset) => symbols[(base + offset) % symbols.length]); const expected = pattern[pattern.length - 1];
    return choiceTrial(key, id, index, difficulty, { type: 'choice', prompt: `${pattern.slice(0, 5).join(' ')} ?`, options: shuffled([...symbols], random) }, expected);
  }
  if (key === 'category-sort') {
    const entry = CATEGORY_ITEMS[Math.floor(random() * CATEGORY_ITEMS.length)];
    return choiceTrial(key, id, index, difficulty, { type: 'choice', prompt: `Wohin gehört „${entry.item}“?`, options: ['Obst', 'Gemüse'] }, entry.category);
  }
  if (key === 'direction-match') {
    const start = Math.floor(random() * DIRECTIONS.length); const turns = 1 + Math.floor(random() * 3); const expected = DIRECTIONS[(start + turns) % DIRECTIONS.length];
    return choiceTrial(key, id, index, difficulty, { type: 'choice', prompt: `Starte im ${DIRECTIONS[start]} und drehe dich ${turns}× nach rechts.`, options: DIRECTIONS }, expected);
  }
  if (key === 'mental-rotation') {
    const arrows = ['↑', '→', '↓', '←']; const start = arrows[Math.floor(random() * arrows.length)]; const turns = 1 + Math.floor(random() * 3); const expected = arrows[(arrows.indexOf(start) + turns) % arrows.length];
    return choiceTrial(key, id, index, difficulty, { type: 'choice', prompt: `Drehe ${start} um ${turns * 90}° nach rechts.`, options: arrows }, expected);
  }
  if (key === 'word-scramble') {
    const word = SCRAMBLE_WORDS[Math.floor(random() * SCRAMBLE_WORDS.length)]; const letters = shuffled([...word], random).join('');
    return choiceTrial(key, id, index, difficulty, { type: 'choice', prompt: `Welches Wort steckt in „${letters}“?`, options: shuffled([word, ...SCRAMBLE_WORDS.filter((entry) => entry !== word).slice(0, 3)], random) }, word);
  }
  if (key === 'count-shapes') {
    const shapes = ['◆', '●', '▲']; const target = shapes[Math.floor(random() * shapes.length)]; const sequence = Array.from({ length: 6 + difficulty }, () => shapes[Math.floor(random() * shapes.length)]); const expected = sequence.filter((shape) => shape === target).length;
    return choiceTrial(key, id, index, difficulty, { type: 'choice', prompt: `Wie oft kommt ${target} vor?  ${sequence.join(' ')}`, options: numericOptions(expected, random) }, String(expected));
  }
  if (key === 'logic-order') {
    const elements = difficulty >= 4 ? ['A', 'B', 'C', 'D'] : ['A', 'B', 'C']; const order = shuffled(elements, random);
    const clues = order.slice(1).map((entry, clueIndex) => clueIndex % 2 === 0 ? `${entry} kommt nach ${order[clueIndex]}.` : `${order[clueIndex]} kommt vor ${entry}.`);
    const permutations = (values: string[]): string[] => values.length <= 1 ? values : values.flatMap((entry, entryIndex) => permutations(values.filter((_, other) => other !== entryIndex)).map((suffix) => entry + suffix));
    const expected = order.join(''); const distractors = shuffled(permutations(elements).filter((entry) => entry !== expected), random).slice(0, 5);
    return choiceTrial(key, id, index, difficulty, { type: 'choice', prompt: shuffled(clues, random).join(' '), options: shuffled([expected, ...distractors], random) }, expected);
  }
  if (key === 'delayed-recall') {
    const items = shuffled(ITEMS, random).slice(0, Math.min(7, 3 + difficulty)); const expected = items[Math.floor(random() * items.length)];
    return choiceTrial(key, id, index, difficulty, { type: 'delayed-recall', prompt: 'Welcher Gegenstand war in der Liste?', items, options: shuffled([expected, ...ITEMS.filter((item) => !items.includes(item)).slice(0, 3)], random) }, expected, 'preview', previewMs(difficulty));
  }
  if (key === 'prime-check') {
    const candidate = 11 + Math.floor(random() * 45); const prime = candidate > 1 && Array.from({ length: Math.max(0, Math.floor(Math.sqrt(candidate)) - 1) }, (_, offset) => offset + 2).every((divisor) => candidate % divisor !== 0);
    return choiceTrial(key, id, index, difficulty, { type: 'choice', prompt: `Ist ${candidate} eine Primzahl?`, options: ['Ja', 'Nein'] }, prime ? 'Ja' : 'Nein');
  }
  if (key === 'balance-scale') {
    const known = 3 + Math.floor(random() * 8); const total = known + 8 + Math.floor(random() * 8); const expected = total - known;
    return choiceTrial(key, id, index, difficulty, { type: 'choice', prompt: `Eine Kugel + ${known} kg = ${total} kg. Wie schwer ist die Kugel?`, options: numericOptions(expected, random) }, String(expected));
  }
  if (key === 'clock-angle') {
    const hour = 1 + Math.floor(random() * 11); const minute = [0, 15, 30, 45][Math.floor(random() * 4)]; const difference = Math.abs((hour % 12) * 30 + minute * 0.5 - minute * 6); const expected = Math.round(Math.min(difference, 360 - difference));
    return choiceTrial(key, id, index, difficulty, { type: 'choice', prompt: `Wie groß ist der kleinere Winkel bei ${hour}:${String(minute).padStart(2, '0')} Uhr?`, options: numericOptions(expected, random, [15, -15, 30, -30]) }, String(expected));
  }
  if (key === 'binary-pattern') {
    const startsWithOne = random() > 0.5; const bits = Array.from({ length: 5 }, (_, position) => startsWithOne ? position % 2 : (position + 1) % 2); const expected = startsWithOne ? 1 : 0;
    return choiceTrial(key, id, index, difficulty, { type: 'choice', prompt: `${bits.join(' ')} ?`, options: ['0', '1'] }, String(expected));
  }
  if (key === 'rule-switch') {
    const number = 2 + Math.floor(random() * 20); const evenRule = random() > 0.5; const expected = number % 2 === 0 ? (evenRule ? 'Blau' : 'Rot') : (evenRule ? 'Rot' : 'Blau');
    return choiceTrial(key, id, index, difficulty, { type: 'choice', prompt: `${evenRule ? 'Gerade Zahlen = Blau' : 'Ungerade Zahlen = Blau'}, sonst Rot. Zahl ${number}?`, options: ['Blau', 'Rot'] }, expected);
  }
  if (key === 'matrix-missing') {
    const a = 1 + Math.floor(random() * 8); const b = a + 1 + Math.floor(random() * 5); const c = b + 1 + Math.floor(random() * 5); const expected = c + (b - a);
    return choiceTrial(key, id, index, difficulty, { type: 'matrix-choice', matrix: [[a, b], [c, null]], options: numericOptions(expected, random) }, String(expected));
  }
  if (key === 'coin-change') {
    const amount = 8 + Math.floor(random() * 18); const expected = Math.floor(amount / 5) + Math.floor((amount % 5) / 2) + (amount % 5) % 2;
    return choiceTrial(key, id, index, difficulty, { type: 'choice', prompt: `Wie viele Münzen brauchst du mindestens für ${amount} € (1 €, 2 €, 5 €)?`, options: numericOptions(expected, random) }, String(expected));
  }
  if (key === 'letter-order') {
    const letters = shuffled(['A', 'F', 'K', 'M', 'R'], random).slice(0, 3);
    return choiceTrial(key, id, index, difficulty, { type: 'choice', prompt: `Welcher Buchstabe steht alphabetisch zuerst: ${letters.join(', ')}?`, options: shuffled(letters, random) }, [...letters].sort()[0]);
  }
  if (key === 'digit-sum') {
    const number = 12 + Math.floor(random() * 87); const expected = String(number).split('').reduce((sum, digit) => sum + Number(digit), 0);
    return choiceTrial(key, id, index, difficulty, { type: 'choice', prompt: `Wie hoch ist die Ziffernsumme von ${number}?`, options: numericOptions(expected, random) }, String(expected));
  }
  if (key === 'sequence-transform') {
    const terms = [2 + Math.floor(random() * 5)];
    while (terms.length < 4) terms.push(terms[terms.length - 1] * 2 + 1);
    const expected = terms[terms.length - 1];
    return choiceTrial(key, id, index, difficulty, { type: 'choice', prompt: `${terms.slice(0, -1).join(' → ')} → ?`, options: numericOptions(expected, random, [-1, 2, 4, -2]) }, String(expected));
  }
  if (key === 'sequence-echo' || key === 'reverse-echo') {
    const length = Math.min(9, 2 + difficulty + Math.floor(index / 4)); const sequence = gridSequence(random, length, size);
    return { trialId: id, index, difficulty, phase: 'preview', phaseMs: previewMs(difficulty), inputMs: inputWindowMs(key, difficulty), data: { type: 'sequence', size, sequence }, expected: key === 'reverse-echo' ? [...sequence].reverse() : sequence, state: {} };
  }
  if (key === 'memory-matrix') {
    const highlights = gridSequence(random, Math.min(size * size - 1, 2 + difficulty + Math.floor(index / 5)), size);
    return { trialId: id, index, difficulty, phase: 'preview', phaseMs: previewMs(difficulty), inputMs: inputWindowMs(key, difficulty), data: { type: 'matrix', size, highlights }, expected: highlights, state: {} };
  }
  if (key === 'number-blind') {
    const count = Math.min(12, 3 + difficulty + Math.floor(index / 5)); const positions = gridSequence(random, count, size);
    const numbers = shuffled(Array.from({ length: count }, (_, value) => value + 1), random).map((number, position) => ({ number, position: positions[position] }));
    return { trialId: id, index, difficulty, phase: 'preview', phaseMs: previewMs(difficulty), inputMs: inputWindowMs(key, difficulty), data: { type: 'number-blind', size, numbers }, expected: [...numbers].sort((a, b) => a.number - b.number).map((entry) => entry.position), state: {} };
  }
  if (key === 'n-back') {
    const n = difficulty >= 3 ? 2 : 1; const previous = symbolHistory.length >= n ? symbolHistory[symbolHistory.length - n] : null; const shouldMatch = previous !== null && random() > 0.67; const candidate = CHALLENGE_SYMBOLS[Math.floor(random() * CHALLENGE_SYMBOLS.length)];
    const symbol = shouldMatch ? previous : previous !== null && candidate === previous ? CHALLENGE_SYMBOLS[(CHALLENGE_SYMBOLS.indexOf(previous as typeof CHALLENGE_SYMBOLS[number]) + 1) % CHALLENGE_SYMBOLS.length] : candidate;
    return { trialId: id, index, difficulty, phase: 'input', phaseMs: 0, inputMs: inputWindowMs(key, difficulty), data: { type: 'choice', symbol, n }, expected: previous !== null && symbol === previous, state: {} };
  }
  if (key === 'seen-before') {
    return { trialId: id, index, difficulty, phase: 'input', phaseMs: 0, inputMs: inputWindowMs(key, difficulty), data: { type: 'choice' }, expected: index > 0 && random() > 0.55, state: {} };
  }
  if (key === 'missing-item') {
    const items = shuffled(ITEMS, random).slice(0, Math.min(9, 3 + difficulty + Math.floor(index / 4))); const missingIndex = Math.floor(random() * items.length); const missing = items[missingIndex]; const visible = items.filter((_, itemIndex) => itemIndex !== missingIndex);
    return { trialId: id, index, difficulty, phase: 'preview', phaseMs: previewMs(difficulty), inputMs: inputWindowMs(key, difficulty), data: { type: 'missing', items: visible, originalItems: items, options: shuffled([missing, ...shuffled(visible, random).slice(0, 3)], random) }, expected: missing, state: {} };
  }
  if (key === 'memory-pairs') {
    const pairCount = difficulty >= 4 ? 6 : difficulty >= 2 ? 3 : 2; const values = shuffled([...CHALLENGE_SYMBOLS], random).slice(0, pairCount); const board = shuffled([...values, ...values], random);
    return { trialId: id, index, difficulty, phase: 'input', phaseMs: 0, inputMs: inputWindowMs(key, difficulty), data: { type: 'pairs', boardSize: pairCount * 2 <= 6 ? 2 : 3, cards: board.map((_, cardIndex) => ({ index: cardIndex })) }, expected: board, state: { found: [], revealed: [], attempts: 0 } };
  }
  if (key === 'path-memory') {
    const path = gridSequence(random, Math.min(10, 2 + difficulty + Math.floor(index / 4)), size);
    return { trialId: id, index, difficulty, phase: 'preview', phaseMs: Math.max(350, 700 - difficulty * 60), inputMs: inputWindowMs(key, difficulty), data: { type: 'path', size, path }, expected: path, state: {} };
  }
  const list = shuffled(ITEMS, random).slice(0, Math.min(8, 2 + difficulty + Math.floor(index / 4))); const position = Math.floor(random() * list.length);
  return { trialId: id, index, difficulty, phase: 'preview', phaseMs: previewMs(difficulty), inputMs: inputWindowMs(key, difficulty), data: { type: 'suitcase', items: list, position: position + 1, options: shuffled([list[position], ...shuffled(ITEMS.filter((item) => !list.includes(item)), random).slice(0, 3)], random) }, expected: list[position], state: {} };
}

export function validateTrialInput(key: ChallengeKey, trial: InternalTrial, action: string, value: unknown): TrialResult {
  const wrong = (error = 'Falsche Antwort.'): TrialResult => ({ accepted: true, complete: true, correct: false, errors: 1, rawScore: 0, error });
  if (trial.phase === 'preview') return { accepted: false, complete: false, correct: false, errors: 0, rawScore: 0, error: 'Die Vorschau läuft noch.' };
  if (LOGIC_KEYS.has(key)) {
    if (action !== 'choice' || (typeof value !== 'string' && typeof value !== 'number')) return { accepted: false, complete: false, correct: false, errors: 0, rawScore: 0, error: 'Ungültige Auswahl.' };
    return String(value) === String(trial.expected) ? { accepted: true, complete: true, correct: true, errors: 0, rawScore: 58 + trial.difficulty * 7 } : wrong();
  }
  if (key === 'sequence-echo' || key === 'reverse-echo' || key === 'path-memory') {
    if (action !== 'sequence' || !Array.isArray(value)) return { accepted: false, complete: false, correct: false, errors: 0, rawScore: 0, error: 'Ungültige Folge.' };
    const expected = trial.expected as number[]; const valid = value.every((entry) => typeof entry === 'number' && Number.isInteger(entry) && entry >= 0 && entry < Number(trial.data.size) ** 2) && new Set(value).size === value.length;
    return valid && value.length === expected.length && expected.every((entry, index) => entry === value[index]) ? { accepted: true, complete: true, correct: true, errors: 0, rawScore: 70 + trial.difficulty * 6 } : wrong();
  }
  if (key === 'memory-matrix') {
    if (action !== 'cells' || !Array.isArray(value)) return { accepted: false, complete: false, correct: false, errors: 0, rawScore: 0, error: 'Ungültige Felder.' };
    const expected = [...(trial.expected as number[])].sort((a, b) => a - b); const received = [...value].sort((a, b) => Number(a) - Number(b)); const valid = received.every((entry) => typeof entry === 'number' && Number.isInteger(entry)) && new Set(received).size === received.length;
    return valid && expected.length === received.length && expected.every((entry, index) => entry === received[index]) ? { accepted: true, complete: true, correct: true, errors: 0, rawScore: 70 + trial.difficulty * 6 } : wrong();
  }
  if (key === 'number-blind') {
    if (action !== 'sequence' || !Array.isArray(value)) return { accepted: false, complete: false, correct: false, errors: 0, rawScore: 0, error: 'Ungültige Zahlenfolge.' };
    const expected = trial.expected as number[]; const valid = value.every((entry) => typeof entry === 'number' && Number.isInteger(entry)) && new Set(value).size === value.length;
    return valid && expected.length === value.length && expected.every((entry, index) => entry === value[index]) ? { accepted: true, complete: true, correct: true, errors: 0, rawScore: 72 + trial.difficulty * 5 } : wrong();
  }
  if (key === 'n-back' || key === 'seen-before') {
    if (action !== 'choice' || typeof value !== 'boolean') return { accepted: false, complete: false, correct: false, errors: 0, rawScore: 0, error: 'Ungültige Auswahl.' };
    return value === trial.expected ? { accepted: true, complete: true, correct: true, errors: 0, rawScore: 45 + trial.difficulty * 7 } : wrong();
  }
  if (key === 'missing-item' || key === 'suitcase-memory' || key === 'delayed-recall') {
    if (action !== 'choice' || typeof value !== 'string') return { accepted: false, complete: false, correct: false, errors: 0, rawScore: 0, error: 'Ungültige Auswahl.' };
    return value === trial.expected ? { accepted: true, complete: true, correct: true, errors: 0, rawScore: 65 + trial.difficulty * 6 } : wrong();
  }
  if (key === 'memory-pairs') {
    if (action !== 'pair' || !Array.isArray(value) || value.length !== 2) return { accepted: false, complete: false, correct: false, errors: 0, rawScore: 0, error: 'Ungültiges Paar.' };
    const board = trial.expected as string[]; const [first, second] = value;
    if (!Number.isInteger(first) || !Number.isInteger(second) || first === second || Number(first) < 0 || Number(second) < 0 || Number(first) >= board.length || Number(second) >= board.length) return { accepted: false, complete: false, correct: false, errors: 0, rawScore: 0, error: 'Ungültige Karten.' };
    const found = (trial.state.found as number[] | undefined) ?? [];
    if (found.includes(Number(first)) || found.includes(Number(second))) return { accepted: false, complete: false, correct: false, errors: 0, rawScore: 0, error: 'Karte bereits gefunden.' };
    trial.state.attempts = Number(trial.state.attempts ?? 0) + 1;
    if (board[Number(first)] !== board[Number(second)]) return { accepted: true, complete: false, correct: false, errors: 1, rawScore: -4 };
    found.push(Number(first), Number(second)); trial.state.found = found; const complete = found.length === board.length;
    return { accepted: true, complete, correct: true, errors: 0, rawScore: complete ? 80 + trial.difficulty * 5 : 0 };
  }
  return wrong('Nicht unterstützte Eingabe.');
}

export function safeScoreInput(value: number): number { return Number.isFinite(value) ? Math.max(0, Math.min(100, value)) : 0; }
function safeCount(value: number): number { return Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0; }
function safeElapsed(value: number): number { return Number.isFinite(value) ? Math.max(0, value) : 0; }
export function scoreReaction(elapsedMs: number): number { return safeScoreInput(Math.round(100 - Math.max(0, safeElapsed(elapsedMs) - 120) / 35)); }
export function scoreCps(clicks: number): number { return safeScoreInput(Math.round(safeCount(clicks) * 5)); }
export function scoreNumberSalad(correct: number, errors: number, elapsedMs: number): number {
  return safeScoreInput(Math.round(safeCount(correct) * 12.5 - safeCount(errors) * 8 - Math.max(0, safeElapsed(elapsedMs) - 2_000) / 180));
}
export function scoreTiming10(elapsedMs: number): number { return safeScoreInput(Math.round(100 - Math.abs(safeElapsed(elapsedMs) - 10_000) / 20)); }
export function scoreAimTrainer(hits: number, elapsedMs: number): number {
  return safeScoreInput(Math.round((safeCount(hits) / AIM_TRAINER_TARGET_COUNT) * 100 - Math.max(0, safeElapsed(elapsedMs) - 2_000) / 250));
}
export function scoreMemorySequence(correct: number): number {
  return safeScoreInput(Math.round((safeCount(correct) / MEMORY_SEQUENCE_LENGTH) * 100));
}
// Wrong guesses carry a real penalty so rapid blind-clicking through the grid
// cannot outscore an honest look-and-click (the concept scores this challenge
// on time alone, but a free wrong click would make random guessing the
// mathematically better strategy at this tile count).
export function scoreOddOneOut(elapsedMs: number, errors = 0): number {
  return safeScoreInput(Math.round(100 - safeElapsed(elapsedMs) / 40 - safeCount(errors) * 15));
}
export function scoreWhackAMole(correct: number, errors: number, elapsedMs: number): number {
  return safeScoreInput(Math.round(safeCount(correct) * 12.5 - safeCount(errors) * 8 - Math.max(0, safeElapsed(elapsedMs) - 3_000) / 200));
}
export function scoreTrafficLight(elapsedAfterGreenMs: number, falseStart: boolean): number {
  return falseStart ? 0 : scoreReaction(elapsedAfterGreenMs);
}
export function scoreColorWord(correct: number, errors: number, elapsedMs: number): number {
  return safeScoreInput(Math.round((safeCount(correct) / COLOR_WORD_ROUND_COUNT) * 100 - safeCount(errors) * 10 - Math.max(0, safeElapsed(elapsedMs) - 3_000) / 250));
}
export function scoreRepeatedTrials(rawScore: number, trials: number, correct: number, partialHits: number, durationMs: number): number {
  const safeTrials = safeCount(trials);
  const partialCredit = Math.min(5, safeCount(partialHits) / 2);
  if (safeTrials === 0) return safeScoreInput(Math.round(partialCredit));
  const averageRawScore = (Number.isFinite(rawScore) ? rawScore : 0) / safeTrials;
  const accuracy = Math.max(0, Math.min(1, safeCount(correct) / safeTrials));
  const targetTrials = Math.max(1, safeElapsed(durationMs) / 2_000);
  const throughput = Math.min(1, safeTrials / targetTrials);
  return safeScoreInput(Math.round(averageRawScore * 0.65 + accuracy * 25 + throughput * 10 + partialCredit));
}
export function challengeOrder(seed: number, count = 10): ChallengeKey[] {
  const boundedCount = Math.max(1, Math.min(CHALLENGES.length, Math.floor(count)));
  return shuffled(CHALLENGES.map((challenge) => challenge.key), seededRandom(seed ^ 0x51ed270b)).slice(0, boundedCount);
}

export function winnerIdForScores(scores: Array<{ playerId: string; score: number }>): string | null {
  const normalized = scores.map((entry) => ({ ...entry, score: Number.isFinite(entry.score) ? Math.max(0, entry.score) : 0 }));
  const highest = Math.max(0, ...normalized.map((entry) => entry.score));
  const winners = normalized.filter((entry) => entry.score === highest);
  return winners.length === 1 ? winners[0].playerId : null;
}

export function isCurrentChallenge(expectedIndex: number, actualIndex: number): boolean {
  return Number.isInteger(expectedIndex) && expectedIndex === actualIndex;
}

export function remainingUntil(deadlineAt: number | null, now: number): number | null {
  return deadlineAt === null ? null : Math.max(0, deadlineAt - now);
}

export interface ReadyGateEntry { playerId: string; connected: boolean; forfeited: boolean }

// Only still-connected, non-forfeited players are required to confirm ready —
// someone who left or dropped must not stall the rest of the group forever.
export function isReadyForNext(entries: ReadyGateEntry[], readyIds: Set<string> | string[]): boolean {
  const ready = readyIds instanceof Set ? readyIds : new Set(readyIds);
  const pending = entries.filter((entry) => entry.connected && !entry.forfeited);
  return pending.length > 0 && pending.every((entry) => ready.has(entry.playerId));
}
