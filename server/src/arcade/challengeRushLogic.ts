import { createHash, randomUUID } from 'node:crypto';

export type ChallengeKey =
  | 'reaction-circle' | 'timing-10'
  | 'number-sequence' | 'logic-equation' | 'pattern-complete' | 'category-sort' | 'direction-match'
  | 'mental-rotation' | 'word-scramble' | 'count-shapes' | 'logic-order' | 'delayed-recall'
  | 'prime-check' | 'balance-scale' | 'binary-pattern' | 'rule-switch'
  | 'matrix-missing' | 'coin-change' | 'letter-order' | 'digit-sum'
  | 'memory-matrix';

export interface ChallengeDefinition { key: ChallengeKey; title: string; description: string; durationMs: number }
export const CHALLENGES: ChallengeDefinition[] = [
  { key: 'reaction-circle', title: 'Klick den Kreis', description: 'Klicke den Kreis so schnell wie möglich.', durationMs: 30_000 },
  { key: 'timing-10', title: 'Stoppe bei 10 Sekunden', description: 'Stoppe den unsichtbaren Timer möglichst genau bei 10,00 Sekunden.', durationMs: 30_000 },
  { key: 'number-sequence', title: 'Zahlenfolge', description: 'Erkenne die Regel und wähle die nächste Zahl.', durationMs: 30_000 },
  { key: 'logic-equation', title: 'Rechenlogik', description: 'Löse kurze Kopfrechenaufgaben unter Zeitdruck.', durationMs: 30_000 },
  { key: 'pattern-complete', title: 'Muster ergänzen', description: 'Erkenne das wiederkehrende Symbolmuster.', durationMs: 30_000 },
  { key: 'category-sort', title: 'Kategorie-Sortierung', description: 'Ordne Begriffe möglichst schnell der richtigen Kategorie zu.', durationMs: 30_000 },
  { key: 'direction-match', title: 'Richtungslogik', description: 'Schaue in die genannte Richtung, führe alle Links- und Rechtsdrehungen aus und wähle die Endrichtung.', durationMs: 30_000 },
  { key: 'mental-rotation', title: 'Mentale Rotation', description: 'Drehe ein Symbol gedanklich und finde das Ergebnis.', durationMs: 30_000 },
  { key: 'word-scramble', title: 'Buchstaben-Salat', description: 'Setze einen verdrehten Begriff wieder zusammen.', durationMs: 30_000 },
  { key: 'count-shapes', title: 'Formen zählen', description: 'Zähle ein bestimmtes Symbol in einer Reihe.', durationMs: 30_000 },
  { key: 'logic-order', title: 'Reihenfolge-Logik', description: 'Ordne Elemente anhand der Hinweise.', durationMs: 30_000 },
  { key: 'delayed-recall', title: 'Verzögerter Abruf', description: 'Merke dir alle Begriffe der eingeblendeten Liste. Wähle danach den Begriff, der darin vorkam.', durationMs: 30_000 },
  { key: 'prime-check', title: 'Primzahl-Check', description: 'Erkenne schnell, ob eine Zahl eine Primzahl ist.', durationMs: 30_000 },
  { key: 'balance-scale', title: 'Waagenlogik', description: 'Bestimme das fehlende Gewicht aus einer Gleichung.', durationMs: 30_000 },
  { key: 'binary-pattern', title: 'Binärmuster', description: 'Erkenne die wiederkehrende Regel in der Folge und wähle die nächste Ziffer: 0 oder 1.', durationMs: 30_000 },
  { key: 'rule-switch', title: 'Regelwechsel', description: 'Wechsle zwischen gerader und ungerader Sortierregel.', durationMs: 30_000 },
  { key: 'matrix-missing', title: 'Zahlenmatrix', description: 'Finde die fehlende Zahl in einer kleinen Matrix.', durationMs: 30_000 },
  { key: 'coin-change', title: 'Münzwechsel', description: 'Finde die minimale Anzahl an Münzen.', durationMs: 30_000 },
  { key: 'letter-order', title: 'Buchstabenordnung', description: 'Vergleiche die groß angezeigten Buchstaben und wähle den alphabetisch ersten.', durationMs: 30_000 },
  { key: 'digit-sum', title: 'Ziffernsumme', description: 'Addiere alle einzelnen Ziffern der angezeigten Zahl und wähle das Ergebnis.', durationMs: 30_000 },
  { key: 'memory-matrix', title: 'Memory-Matrix', description: 'Merke dir markierte Felder im Raster.', durationMs: 30_000 },
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

// A plain linear congruential generator is invertible: revealing generated
// task data can let an attacker solve for its internal state and reconstruct
// later outputs — including, since challenge seeds derive from the match
// seed, remaining challenges in the match.
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

export function challengePayload(key: ChallengeKey, seed: number): ChallengePayload {
  const definition = CHALLENGES.find((entry) => entry.key === key);
  if (!definition) throw new Error('Unbekannte Challenge.');
  const random = seededRandom(seed);
  if (key === 'reaction-circle') return { ...definition, seed, data: { x: 15 + random() * 70, y: 20 + random() * 60 } };
  return { ...definition, seed, data: {} };
}

const LOGIC_KEYS = new Set<ChallengeKey>([
  'number-sequence', 'logic-equation', 'pattern-complete', 'category-sort', 'direction-match',
  'mental-rotation', 'word-scramble', 'count-shapes', 'logic-order', 'delayed-recall',
  'prime-check', 'balance-scale', 'binary-pattern', 'rule-switch',
  'matrix-missing', 'coin-change', 'letter-order', 'digit-sum',
]);
const MEMORY_TRIAL_KEYS = new Set<ChallengeKey>(['memory-matrix']);
const TRIAL_KEYS = new Set<ChallengeKey>([...LOGIC_KEYS, ...MEMORY_TRIAL_KEYS]);
export function isTrialChallenge(key: ChallengeKey): boolean { return TRIAL_KEYS.has(key); }
export function difficultyFor(streak: number, completedTrials = 0): number {
  const progression = Math.floor(Math.max(0, completedTrials) / 3);
  const momentum = Math.floor(Math.max(0, streak) / 3);
  return Math.max(1, Math.min(5, 1 + progression + momentum));
}

const ITEMS = [
  'Schlüssel', 'Becher', 'Würfel', 'Lampe', 'Karte', 'Stern', 'Brille', 'Uhr', 'Ball', 'Pfeil',
  'Ring', 'Buch', 'Kamera', 'Kompass', 'Kerze', 'Münze', 'Feder', 'Schere', 'Flasche', 'Kissen',
  'Tasse', 'Seil', 'Hammer', 'Radio', 'Stift', 'Apfel', 'Schuh', 'Krone', 'Glocke', 'Rucksack',
];

const CATEGORY_ITEMS = [
  { item: 'Apfel', category: 'Obst' }, { item: 'Karotte', category: 'Gemüse' },
  { item: 'Banane', category: 'Obst' }, { item: 'Paprika', category: 'Gemüse' },
  { item: 'Birne', category: 'Obst' }, { item: 'Gurke', category: 'Gemüse' },
  { item: 'Pflaume', category: 'Obst' }, { item: 'Brokkoli', category: 'Gemüse' },
  { item: 'Adler', category: 'Tier' }, { item: 'Otter', category: 'Tier' },
  { item: 'Pinguin', category: 'Tier' }, { item: 'Delfin', category: 'Tier' },
  { item: 'Hammer', category: 'Werkzeug' }, { item: 'Zange', category: 'Werkzeug' },
  { item: 'Säge', category: 'Werkzeug' }, { item: 'Bohrer', category: 'Werkzeug' },
  { item: 'Geige', category: 'Instrument' }, { item: 'Trommel', category: 'Instrument' },
  { item: 'Flöte', category: 'Instrument' }, { item: 'Klavier', category: 'Instrument' },
];
const SCRAMBLE_WORDS = [
  'KARTE', 'LAMPE', 'STERN', 'BRILLE', 'WÜRFEL', 'KAMERA', 'FENSTER', 'KOMPASS', 'GLOCKE', 'RAKETE',
  'PIRAT', 'TROMMEL', 'KISSEN', 'SCHERE', 'FLASCHE', 'ZIRKEL', 'PINGUIN', 'VULKAN', 'ROBOTER', 'FACKEL',
];
const DIRECTIONS = ['Norden', 'Osten', 'Süden', 'Westen'];
const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');

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
function previewMs(difficulty: number, itemCount = 3): number {
  const level = Math.max(1, Math.min(5, difficulty));
  return Math.max(2_500, Math.min(5_000, 2_400 + Math.max(1, itemCount) * 250 - level * 80));
}
export function inputWindowMs(key: ChallengeKey, difficulty: number): number {
  const level = Math.max(1, Math.min(5, difficulty));
  if (MEMORY_TRIAL_KEYS.has(key)) return 6_500 - level * 450;
  return 5_500 - level * 500;
}
function choiceTrial(key: ChallengeKey, id: string, index: number, difficulty: number, data: Record<string, unknown>, expected: string | number, phase: TrialPhase = 'input', phaseMs = 0): InternalTrial {
  return { trialId: id, index, difficulty, phase, phaseMs, inputMs: inputWindowMs(key, difficulty), data, expected, state: {} };
}

export function createTrial(key: ChallengeKey, seed: number, index: number, difficulty: number): InternalTrial {
  if (!isTrialChallenge(key)) throw new Error('Challenge verwendet keine Trials.');
  const random = seededRandom((seed ^ Math.imul(difficulty, 0x9e3779b9)) >>> 0);
  // The client uses this only as an opaque replay/stale-input token. Keeping
  // it independent from the deterministic generator seed prevents clients
  // from recreating `expected` or deriving later challenge seeds.
  const id = randomUUID();
  const size = difficulty >= 4 ? 5 : difficulty >= 2 ? 4 : 3;
  if (key === 'number-sequence') {
    const family = Math.floor(random() * Math.min(5, difficulty));
    let values: number[]; let expected: number; let offsets: number[];
    if (family === 1) {
      const start = 1 + Math.floor(random() * 8); const firstStep = 1 + Math.floor(random() * 4); const secondStep = firstStep + 1 + Math.floor(random() * 3);
      values = [start, start + firstStep, start + firstStep + secondStep, start + firstStep * 2 + secondStep, start + firstStep * 2 + secondStep * 2];
      expected = values[4] + firstStep; offsets = [-firstStep, secondStep, 1, -1];
    } else if (family === 2) {
      const start = 1 + Math.floor(random() * 4); const factor = 2 + Math.floor(random() * 2);
      values = [start, start * factor, start * factor ** 2, start * factor ** 3];
      expected = start * factor ** 4; offsets = [-values[1], values[0], factor, -factor];
    } else if (family === 3) {
      const start = 1 + Math.floor(random() * 6); const firstStep = 1 + Math.floor(random() * 3);
      values = [start];
      for (let step = firstStep; values.length < 5; step += 1) values.push(values.at(-1)! + step);
      expected = values.at(-1)! + firstStep + 4; offsets = [-firstStep - 3, firstStep + 5, 1, -1];
    } else if (family === 4) {
      const first = 1 + Math.floor(random() * 8); const second = first + 4 + Math.floor(random() * 7); const firstStep = 2 + Math.floor(random() * 4); const secondStep = 3 + Math.floor(random() * 5);
      values = [first, second, first + firstStep, second + secondStep, first + firstStep * 2];
      expected = second + secondStep * 2; offsets = [-secondStep, firstStep, 1, -1];
    } else {
      const start = 2 + Math.floor(random() * 8); const step = 1 + difficulty + Math.floor(random() * 3);
      values = [start, start + step, start + step * 2, start + step * 3];
      expected = start + step * 4; offsets = [-step, step, 1, -1];
    }
    return choiceTrial(key, id, index, difficulty, { type: 'choice', prompt: `${values.join(', ')}, ?`, options: numericOptions(expected, random, offsets) }, String(expected));
  }
  if (key === 'logic-equation') {
    const range = 8 + difficulty * 4; const a = 2 + Math.floor(random() * range); const b = 2 + Math.floor(random() * (5 + difficulty)); const c = 1 + Math.floor(random() * (3 + difficulty)); const expected = a + b * c;
    return choiceTrial(key, id, index, difficulty, { type: 'choice', prompt: `${a} + ${b} × ${c} = ?`, options: numericOptions(expected, random, [b, -c, 2, -2]) }, String(expected));
  }
  if (key === 'pattern-complete') {
    const symbols = ['◆', '●', '▲', '■'];
    const cycles = [[0, 1], [0, 0, 1], [0, 1, 2], [0, 1, 1, 0], [0, 1, 2, 1]];
    const cycle = cycles[Math.floor(random() * Math.min(cycles.length, difficulty + 1))];
    const rotated = shuffled(symbols, random);
    const visibleLength = Math.max(5, cycle.length * 2 - 1);
    const pattern = Array.from({ length: visibleLength }, (_, position) => rotated[cycle[position % cycle.length]]);
    const expected = rotated[cycle[visibleLength % cycle.length]];
    return choiceTrial(key, id, index, difficulty, { type: 'choice', prompt: `${pattern.join(' ')} ?`, options: shuffled([...symbols], random) }, expected);
  }
  if (key === 'category-sort') {
    const entry = CATEGORY_ITEMS[Math.floor(random() * CATEGORY_ITEMS.length)];
    const categories = [...new Set(CATEGORY_ITEMS.map(({ category }) => category))];
    const wrongCategories = shuffled(categories.filter((category) => category !== entry.category), random).slice(0, Math.min(3, 1 + difficulty));
    return choiceTrial(key, id, index, difficulty, { type: 'choice', prompt: `Zu welcher Kategorie gehört „${entry.item}“?`, options: shuffled([entry.category, ...wrongCategories], random) }, entry.category);
  }
  if (key === 'direction-match') {
    const start = Math.floor(random() * DIRECTIONS.length); const commandCount = Math.min(4, 1 + Math.floor(difficulty / 2));
    let direction = start;
    const commands = Array.from({ length: commandCount }, () => {
      const right = random() > 0.5; const quarterTurns = difficulty >= 4 && random() > 0.65 ? 2 : 1;
      direction = (direction + (right ? quarterTurns : -quarterTurns) + DIRECTIONS.length) % DIRECTIONS.length;
      return `${quarterTurns === 2 ? '180°' : '90°'} nach ${right ? 'rechts' : 'links'}`;
    });
    return choiceTrial(key, id, index, difficulty, { type: 'choice', prompt: `Du schaust nach ${DIRECTIONS[start]}. Drehe dich ${commands.join(', dann ')}. Wohin schaust du jetzt?`, options: DIRECTIONS }, DIRECTIONS[direction]);
  }
  if (key === 'mental-rotation') {
    const arrows = ['↑', '→', '↓', '←']; const start = arrows[Math.floor(random() * arrows.length)]; const turns = 1 + Math.floor(random() * 3); const expected = arrows[(arrows.indexOf(start) + turns) % arrows.length];
    return choiceTrial(key, id, index, difficulty, { type: 'choice', prompt: `Drehe ${start} um ${turns * 90}° nach rechts.`, options: arrows }, expected);
  }
  if (key === 'word-scramble') {
    const word = SCRAMBLE_WORDS[Math.floor(random() * SCRAMBLE_WORDS.length)];
    const shuffledLetters = shuffled([...word], random).join('');
    // A Fisher-Yates shuffle can land on the identity permutation by chance
    // (or, for a word with repeated letters, on a different permutation that
    // still spells the same string) — a rotation by one character is never
    // equal to the source word for any entry in SCRAMBLE_WORDS (none of them
    // are rotation-invariant), so it's a safe, still-scrambled fallback.
    const letters = shuffledLetters === word ? `${word.slice(1)}${word[0]}` : shuffledLetters;
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
    return choiceTrial(key, id, index, difficulty, { type: 'delayed-recall', prompt: 'Welcher Gegenstand war in der Liste?', items, options: shuffled([expected, ...shuffled(ITEMS.filter((item) => !items.includes(item)), random).slice(0, 3)], random) }, expected, 'preview', previewMs(difficulty, items.length));
  }
  if (key === 'prime-check') {
    const candidate = 11 + Math.floor(random() * 45); const prime = candidate > 1 && Array.from({ length: Math.max(0, Math.floor(Math.sqrt(candidate)) - 1) }, (_, offset) => offset + 2).every((divisor) => candidate % divisor !== 0);
    return choiceTrial(key, id, index, difficulty, { type: 'choice', prompt: `Ist ${candidate} eine Primzahl?`, options: ['Ja', 'Nein'] }, prime ? 'Ja' : 'Nein');
  }
  if (key === 'balance-scale') {
    const known = 3 + Math.floor(random() * 8); const total = known + 8 + Math.floor(random() * 8); const expected = total - known;
    return choiceTrial(key, id, index, difficulty, { type: 'choice', prompt: `Eine Kugel + ${known} kg = ${total} kg. Wie schwer ist die Kugel?`, options: numericOptions(expected, random) }, String(expected));
  }
  if (key === 'binary-pattern') {
    const cycles = [[0, 1], [0, 0, 1], [0, 1, 1], [0, 0, 1, 1], [0, 1, 0, 0, 1, 1]];
    const cycle = cycles[Math.floor(random() * Math.min(cycles.length, difficulty + 1))];
    const inverted = random() > 0.5 ? 1 : 0; const offset = Math.floor(random() * cycle.length); const visibleLength = 6 + difficulty;
    const bits = Array.from({ length: visibleLength }, (_, position) => cycle[(offset + position) % cycle.length] ^ inverted);
    const expected = cycle[(offset + visibleLength) % cycle.length] ^ inverted;
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
    const letters = shuffled(LETTERS, random).slice(0, Math.min(8, 3 + difficulty));
    return choiceTrial(key, id, index, difficulty, { type: 'letter-choice', prompt: 'Welcher Buchstabe steht alphabetisch zuerst?', letters, options: shuffled(letters, random) }, [...letters].sort()[0]);
  }
  if (key === 'digit-sum') {
    const digitCount = 2 + Math.floor((difficulty - 1) / 2); const minimum = 10 ** (digitCount - 1); const number = minimum + Math.floor(random() * (minimum * 9)); const expected = String(number).split('').reduce((sum, digit) => sum + Number(digit), 0);
    return choiceTrial(key, id, index, difficulty, { type: 'choice', prompt: `Wie hoch ist die Ziffernsumme von ${number}?`, options: numericOptions(expected, random) }, String(expected));
  }
  if (key === 'memory-matrix') {
    const highlights = gridSequence(random, Math.min(size * size - 1, 2 + difficulty + Math.floor(index / 5)), size);
    return { trialId: id, index, difficulty, phase: 'preview', phaseMs: previewMs(difficulty, highlights.length), inputMs: inputWindowMs(key, difficulty), data: { type: 'matrix', size, highlights }, expected: highlights, state: {} };
  }
  throw new Error('Unbekannte Trial-Challenge.');
}

export function previewTrialData(trial: InternalTrial): Record<string, unknown> {
  const type = String(trial.data.type ?? '');
  if (type === 'matrix') return { type, size: trial.data.size, highlights: trial.data.highlights };
  if (type === 'delayed-recall') return { type, prompt: trial.data.prompt, items: trial.data.items };
  return { type };
}

export function validateTrialInput(key: ChallengeKey, trial: InternalTrial, action: string, value: unknown): TrialResult {
  const wrong = (error = 'Falsche Antwort.'): TrialResult => ({ accepted: true, complete: true, correct: false, errors: 1, rawScore: 0, error });
  if (trial.phase === 'preview') return { accepted: false, complete: false, correct: false, errors: 0, rawScore: 0, error: 'Die Vorschau läuft noch.' };
  if (LOGIC_KEYS.has(key)) {
    if (action !== 'choice' || (typeof value !== 'string' && typeof value !== 'number')) return { accepted: false, complete: false, correct: false, errors: 0, rawScore: 0, error: 'Ungültige Auswahl.' };
    return String(value) === String(trial.expected) ? { accepted: true, complete: true, correct: true, errors: 0, rawScore: 58 + trial.difficulty * 7 } : wrong();
  }
  if (key === 'memory-matrix') {
    if (action !== 'cells' || !Array.isArray(value)) return { accepted: false, complete: false, correct: false, errors: 0, rawScore: 0, error: 'Ungültige Felder.' };
    const expectedRaw = trial.expected as number[];
    // Bound the length against the small known-good expected size before
    // sorting the array. Otherwise an authenticated LAN client could submit
    // an arbitrarily large value and stall the single Node.js event loop.
    if (value.length !== expectedRaw.length) return wrong();
    const expected = [...expectedRaw].sort((a, b) => a - b); const received = [...value].sort((a, b) => Number(a) - Number(b)); const valid = received.every((entry) => typeof entry === 'number' && Number.isInteger(entry)) && new Set(received).size === received.length;
    return valid && expected.every((entry, index) => entry === received[index]) ? { accepted: true, complete: true, correct: true, errors: 0, rawScore: 70 + trial.difficulty * 6 } : wrong();
  }
  if (key === 'delayed-recall') {
    if (action !== 'choice' || typeof value !== 'string') return { accepted: false, complete: false, correct: false, errors: 0, rawScore: 0, error: 'Ungültige Auswahl.' };
    return value === trial.expected ? { accepted: true, complete: true, correct: true, errors: 0, rawScore: 65 + trial.difficulty * 6 } : wrong();
  }
  return wrong('Nicht unterstützte Eingabe.');
}

export function safeScoreInput(value: number): number { return Number.isFinite(value) ? Math.max(0, Math.min(100, value)) : 0; }
function safeCount(value: number): number { return Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0; }
function safeElapsed(value: number): number { return Number.isFinite(value) ? Math.max(0, value) : 0; }
export function scoreReaction(elapsedMs: number): number { return safeScoreInput(Math.round(100 - Math.max(0, safeElapsed(elapsedMs) - 120) / 35)); }
export function scoreTiming10(elapsedMs: number): number { return safeScoreInput(Math.round(100 - Math.abs(safeElapsed(elapsedMs) - 10_000) / 20)); }
export function scoreRepeatedTrials(rawScore: number, trials: number, correct: number, durationMs: number): number {
  const safeTrials = safeCount(trials);
  if (safeTrials === 0) return 0;
  const averageRawScore = (Number.isFinite(rawScore) ? rawScore : 0) / safeTrials;
  const accuracy = Math.max(0, Math.min(1, safeCount(correct) / safeTrials));
  const targetTrials = Math.max(1, safeElapsed(durationMs) / 2_000);
  const throughput = Math.min(1, safeTrials / targetTrials);
  return safeScoreInput(Math.round(averageRawScore * 0.65 + accuracy * 25 + throughput * 10));
}
export function challengeOrder(seed: number, count = 10): ChallengeKey[] {
  const keys = CHALLENGES.map((challenge) => challenge.key);
  const boundedCount = Math.max(1, Math.min(keys.length, Math.floor(count)));
  return shuffled(keys, seededRandom(seed ^ 0x51ed270b)).slice(0, boundedCount);
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
