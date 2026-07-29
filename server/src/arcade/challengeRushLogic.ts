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

export type TrialPhase = 'preview' | 'input';

export interface ChallengeDefinition { key: ChallengeKey; title: string; description: string; durationMs: number }
export const CHALLENGES: ChallengeDefinition[] = [
  { key: 'reaction-circle', title: 'Kreis-Serie', description: 'Treffe in 30 Sekunden so viele Kreise wie möglich.', durationMs: 30_000 },
  { key: 'cps', title: 'CPS-Serie', description: 'Klicke 30 Sekunden lang so oft du kannst.', durationMs: 30_000 },
  { key: 'number-salad', title: 'Zahlensalat-Serie', description: 'Klicke möglichst viele Zahlenfolgen in aufsteigender Reihenfolge.', durationMs: 30_000 },
  { key: 'timing-10', title: 'Timing-Serie', description: 'Stoppe wiederholt möglichst genau bei zehn Sekunden.', durationMs: 30_000 },
  { key: 'aim-trainer', title: 'Aim-Trainer-Serie', description: 'Treffe in 30 Sekunden so viele Ziele wie möglich.', durationMs: 30_000 },
  { key: 'memory-sequence', title: 'Reihenfolge-Merker', description: 'Merke dir aufleuchtende Felder und wiederhole sie.', durationMs: 30_000 },
  { key: 'odd-one-out', title: 'Finde den Unterschied', description: 'Finde das eine abweichende Feld im Raster.', durationMs: 30_000 },
  { key: 'whack-a-mole', title: 'Whack-a-Mole-Serie', description: 'Treffe die aufleuchtenden Felder in der richtigen Reihenfolge.', durationMs: 30_000 },
  { key: 'traffic-light', title: 'Ampel-Reaktion', description: 'Klicke erst bei Grün und reagiere so schnell wie möglich.', durationMs: 30_000 },
  { key: 'color-word', title: 'Farbwort-Chaos', description: 'Wähle die Schriftfarbe, nicht das geschriebene Wort.', durationMs: 30_000 },
  { key: 'number-sequence', title: 'Zahlenfolge', description: 'Erkenne die Regel und wähle die nächste Zahl.', durationMs: 30_000 },
  { key: 'logic-equation', title: 'Rechenlogik', description: 'Löse kurze Kopfrechenaufgaben unter Zeitdruck.', durationMs: 30_000 },
  { key: 'pattern-complete', title: 'Muster ergänzen', description: 'Erkenne das wiederkehrende Symbolmuster.', durationMs: 30_000 },
  { key: 'category-sort', title: 'Kategorie-Sortierung', description: 'Ordne Begriffe möglichst schnell der richtigen Kategorie zu.', durationMs: 30_000 },
  { key: 'direction-match', title: 'Richtungslogik', description: 'Verfolge Drehungen und bestimme die Endrichtung.', durationMs: 30_000 },
  { key: 'mental-rotation', title: 'Mentale Rotation', description: 'Drehe ein Symbol gedanklich und finde das Ergebnis.', durationMs: 30_000 },
  { key: 'word-scramble', title: 'Buchstaben-Salat', description: 'Setze einen verdrehten Begriff wieder zusammen.', durationMs: 30_000 },
  { key: 'count-shapes', title: 'Formen zählen', description: 'Zähle ein bestimmtes Symbol in einer Reihe.', durationMs: 30_000 },
  { key: 'logic-order', title: 'Reihenfolge-Logik', description: 'Setze drei Elemente anhand von Hinweisen in die richtige Reihenfolge.', durationMs: 30_000 },
  { key: 'delayed-recall', title: 'Verzögerter Abruf', description: 'Merke dir eine Liste und wähle später den gesuchten Begriff.', durationMs: 30_000 },
  { key: 'prime-check', title: 'Primzahl-Check', description: 'Erkenne schnell, ob eine Zahl eine Primzahl ist.', durationMs: 30_000 },
  { key: 'balance-scale', title: 'Waagenlogik', description: 'Bestimme das fehlende Gewicht aus Gleichungen.', durationMs: 30_000 },
  { key: 'clock-angle', title: 'Uhrwinkel', description: 'Berechne den kleineren Winkel zwischen den Zeigern.', durationMs: 30_000 },
  { key: 'binary-pattern', title: 'Binärmuster', description: 'Erkenne die nächste Folge aus Nullen und Einsen.', durationMs: 30_000 },
  { key: 'rule-switch', title: 'Regelwechsel', description: 'Wechsle zwischen gerader und ungerader Sortierregel.', durationMs: 30_000 },
  { key: 'matrix-missing', title: 'Zahlenmatrix', description: 'Finde die fehlende Zahl in einer kleinen Matrix.', durationMs: 30_000 },
  { key: 'coin-change', title: 'Münzwechsel', description: 'Finde die minimale Anzahl an Münzen für einen Betrag.', durationMs: 30_000 },
  { key: 'letter-order', title: 'Buchstabenordnung', description: 'Bringe Buchstaben gedanklich ins Alphabet.', durationMs: 30_000 },
  { key: 'digit-sum', title: 'Ziffernsumme', description: 'Berechne die Quersumme einer Zahl.', durationMs: 30_000 },
  { key: 'sequence-transform', title: 'Folgen-Operator', description: 'Erkenne die Rechenoperation zwischen den Folgengliedern.', durationMs: 30_000 },
  { key: 'sequence-echo', title: 'Sequenz-Echo', description: 'Merke dir Feldfolgen und wiederhole sie.', durationMs: 30_000 },
  { key: 'reverse-echo', title: 'Rückwärts-Echo', description: 'Wiederhole die gezeigte Feldfolge rückwärts.', durationMs: 30_000 },
  { key: 'memory-matrix', title: 'Memory-Matrix', description: 'Merke dir markierte Felder im Raster.', durationMs: 30_000 },
  { key: 'number-blind', title: 'Zahlenblende', description: 'Merke dir Zahlenpositionen und klicke sie aufsteigend.', durationMs: 30_000 },
  { key: 'n-back', title: 'N-zurück', description: 'Erkenne, ob das aktuelle Symbol vor N Schritten erschien.', durationMs: 30_000 },
  { key: 'seen-before', title: 'Schon gesehen?', description: 'Ordne Symbole als neu oder bereits gesehen ein.', durationMs: 30_000 },
  { key: 'missing-item', title: 'Was fehlt?', description: 'Finde den Gegenstand, der aus einer Gruppe verschwunden ist.', durationMs: 30_000 },
  { key: 'memory-pairs', title: 'Memory-Paare-Blitz', description: 'Finde möglichst viele Paare in wechselnden Spielfeldern.', durationMs: 30_000 },
  { key: 'path-memory', title: 'Pfad-Gedächtnis', description: 'Merke dir Wege und tippe sie anschließend nach.', durationMs: 30_000 },
  { key: 'suitcase-memory', title: 'Kofferpacken', description: 'Merke dir geordnete Gegenstandslisten.', durationMs: 30_000 },
];

export interface ChallengePayload { key: ChallengeKey; title: string; description: string; durationMs: number; seed: number; data: Record<string, unknown> }
export interface TrialPayload {
  trialId: string;
  index: number;
  difficulty: number;
  phase: TrialPhase;
  phaseMs: number;
  phaseRemainingMs?: number;
  inputMs?: number;
  inputRemainingMs?: number;
  resume?: Record<string, unknown>;
  data: Record<string, unknown>;
}
export interface TrialResult { accepted: boolean; complete: boolean; correct: boolean; errors: number; rawScore: number; next?: TrialPayload; error?: string }

export function seededRandom(seed: number): () => number {
  let value = seed >>> 0;
  return () => { value = (value * 1_664_525 + 1_013_904_223) >>> 0; return value / 0x1_0000_0000; };
}

function definition(key: ChallengeKey): ChallengeDefinition {
  const result = CHALLENGES.find((entry) => entry.key === key);
  if (!result) throw new Error('Unbekannte Challenge.');
  return result;
}

function shuffled<T>(values: T[], random: () => number): T[] {
  const result = [...values];
  for (let index = result.length - 1; index > 0; index -= 1) { const swap = Math.floor(random() * (index + 1)); [result[index], result[swap]] = [result[swap], result[index]]; }
  return result;
}

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

const MEMORY_KEYS = new Set<ChallengeKey>(['sequence-echo', 'reverse-echo', 'memory-matrix', 'number-blind', 'n-back', 'seen-before', 'missing-item', 'memory-pairs', 'path-memory', 'suitcase-memory']);
const LOGIC_KEYS = new Set<ChallengeKey>(['number-sequence', 'logic-equation', 'pattern-complete', 'category-sort', 'direction-match', 'mental-rotation', 'word-scramble', 'count-shapes', 'logic-order', 'delayed-recall', 'prime-check', 'balance-scale', 'clock-angle', 'binary-pattern', 'rule-switch', 'matrix-missing', 'coin-change', 'letter-order', 'digit-sum', 'sequence-transform']);
const TRIAL_KEYS = new Set<ChallengeKey>([...MEMORY_KEYS, ...LOGIC_KEYS, 'aim-trainer', 'memory-sequence', 'odd-one-out', 'whack-a-mole', 'traffic-light', 'color-word']);
export function isMemoryChallenge(key: ChallengeKey): boolean { return MEMORY_KEYS.has(key); }
export function isTrialChallenge(key: ChallengeKey): boolean { return TRIAL_KEYS.has(key); }
export function difficultyFor(streak: number): number { return Math.max(1, Math.min(5, 1 + Math.floor(Math.max(0, streak) / 2))); }

export function challengePayload(key: ChallengeKey, seed: number): ChallengePayload {
  const current = definition(key);
  const random = seededRandom(seed);
  if (key === 'reaction-circle') return { ...current, seed, data: { x: 15 + random() * 70, y: 20 + random() * 60, radius: 8 } };
  if (key === 'number-salad') {
    const numbers = shuffled(Array.from({ length: 8 }, (_, index) => index + 1), random);
    return { ...current, seed, data: { numbers } };
  }
  if (key === 'aim-trainer') return { ...current, seed, data: { targetCount: 1 } };
  if (key === 'memory-sequence') return { ...current, seed, data: { type: 'memory-sequence' } };
  if (key === 'odd-one-out') return { ...current, seed, data: { type: 'odd-one-out' } };
  if (key === 'whack-a-mole') return { ...current, seed, data: { type: 'whack-a-mole' } };
  if (key === 'traffic-light') return { ...current, seed, data: { type: 'traffic-light' } };
  if (key === 'color-word') return { ...current, seed, data: { type: 'color-word' } };
  return { ...current, seed, data: {} };
}

export const CHALLENGE_SYMBOLS = ['◆', '●', '▲', '■', '★', '⬟', '✚', '☀', '☘', '⬢'] as const;
export function seenBeforeSelection(baseSymbol: string, wantsRepeat: boolean, seenSymbols: string[], index: number): { symbol: string; repeated: boolean } {
  const unused = CHALLENGE_SYMBOLS.filter((symbol) => !seenSymbols.includes(symbol));
  const repeated = (wantsRepeat && seenSymbols.length > 0) || unused.length === 0;
  return {
    symbol: repeated ? seenSymbols[index % seenSymbols.length] : (unused[index % unused.length] ?? baseSymbol),
    repeated,
  };
}
const ITEMS = ['Schlüssel', 'Becher', 'Würfel', 'Lampe', 'Karte', 'Stern', 'Brille', 'Uhr', 'Ball', 'Pfeil', 'Ring', 'Buch'];
const COLOR_WORDS = [
  { key: 'red', word: 'Rot' }, { key: 'blue', word: 'Blau' }, { key: 'green', word: 'Grün' }, { key: 'yellow', word: 'Gelb' },
];
const CATEGORY_ITEMS = [
  { item: 'Apfel', category: 'Obst' }, { item: 'Karotte', category: 'Gemüse' }, { item: 'Banane', category: 'Obst' },
  { item: 'Paprika', category: 'Gemüse' }, { item: 'Birne', category: 'Obst' }, { item: 'Gurke', category: 'Gemüse' },
];
const SCRAMBLE_WORDS = ['KARTE', 'LAMPE', 'STERN', 'BRILLE', 'WÜRFEL', 'KAMERA', 'FENSTER'];
const DIRECTIONS = ['Norden', 'Osten', 'Süden', 'Westen'];

export interface InternalTrial extends TrialPayload {
  expected: unknown;
  state: Record<string, unknown>;
}

function trialId(index: number, seed: number): string { return `${index}-${seed >>> 0}`; }
function phaseMs(_key: ChallengeKey, difficulty: number): number { return Math.max(450, 1_000 - difficulty * 100); }
export function inputWindowMs(key: ChallengeKey, difficulty: number): number {
  const level = Math.max(1, Math.min(5, difficulty));
  if (key === 'n-back' || key === 'seen-before') return 1_800 - level * 180;
  if (key === 'memory-pairs') return 9_000 - level * 600;
  if (key === 'whack-a-mole' || MEMORY_KEYS.has(key)) return 6_500 - level * 450;
  if (key === 'traffic-light') return 2_800 - level * 200;
  return 5_500 - level * 500;
}
function choiceTrial(key: ChallengeKey, id: string, index: number, difficulty: number, data: Record<string, unknown>, expected: string | number, phase: TrialPhase = 'input', previewMs = 0): InternalTrial {
  return { trialId: id, index, difficulty, phase, phaseMs: previewMs, inputMs: inputWindowMs(key, difficulty), data, expected, state: {} };
}

export function createTrial(key: ChallengeKey, seed: number, index: number, difficulty: number, symbolHistory: string[] = []): InternalTrial {
  // Difficulty changes task size and/or the enforced answer window; mixing it
  // into the seed additionally keeps consecutive levels deterministic but varied.
  const random = seededRandom((seed ^ Math.imul(difficulty, 0x9e3779b9)) >>> 0);
  const id = trialId(index, seed);
  const size = difficulty >= 4 ? 5 : difficulty >= 2 ? 4 : 3;
  if (key === 'aim-trainer') {
    const target = { x: 15 + random() * 70, y: 20 + random() * 60 };
    const radius = Math.max(7, 13 - difficulty);
    return { trialId: id, index, difficulty, phase: 'input', phaseMs: 0, inputMs: inputWindowMs(key, difficulty), data: { type: 'aim-trainer', target: { ...target, radius } }, expected: { ...target, radius }, state: {} };
  }
  if (key === 'memory-sequence') {
    const length = Math.min(9, 2 + difficulty + Math.floor(index / 4));
    const sequence = gridSequence(random, length, size);
    return { trialId: id, index, difficulty, phase: 'preview', phaseMs: Math.max(450, 700 - difficulty * 50), inputMs: inputWindowMs(key, difficulty), data: { type: 'memory-sequence', size, sequence }, expected: sequence, state: {} };
  }
  if (key === 'odd-one-out') {
    const tileCount = difficulty >= 4 ? 25 : difficulty >= 2 ? 16 : 9;
    const oddIndex = Math.floor(random() * tileCount);
    return { trialId: id, index, difficulty, phase: 'input', phaseMs: 0, inputMs: inputWindowMs(key, difficulty), data: { type: 'odd-one-out', size: Math.sqrt(tileCount), tileCount, oddIndex, subtlety: difficulty }, expected: oddIndex, state: {} };
  }
  if (key === 'whack-a-mole') {
    const length = Math.min(10, 3 + difficulty + Math.floor(index / 4));
    const sequence = gridSequence(random, length, size);
    return { trialId: id, index, difficulty, phase: 'preview', phaseMs: Math.max(400, 650 - difficulty * 45), inputMs: inputWindowMs(key, difficulty), data: { type: 'whack-a-mole', size, sequence }, expected: sequence, state: { correct: 0 } };
  }
  if (key === 'traffic-light') {
    const greenAtMs = 1_000 + Math.floor(random() * Math.max(500, 2_500 - difficulty * 250));
    return { trialId: id, index, difficulty, phase: 'preview', phaseMs: greenAtMs, inputMs: inputWindowMs(key, difficulty), data: { type: 'traffic-light' }, expected: true, state: {} };
  }
  if (key === 'color-word') {
    const word = COLOR_WORDS[Math.floor(random() * COLOR_WORDS.length)];
    const textColor = COLOR_WORDS[Math.floor(random() * COLOR_WORDS.length)];
    return { trialId: id, index, difficulty, phase: 'input', phaseMs: 0, inputMs: inputWindowMs(key, difficulty), data: { type: 'color-word', word: word.word, textColor: textColor.key, options: shuffled(COLOR_WORDS.map((entry) => entry.key), random) }, expected: textColor.key, state: {} };
  }
  if (key === 'number-sequence') {
    const start = 2 + Math.floor(random() * 8); const step = 1 + difficulty + Math.floor(random() * 3); const expected = start + step * 3;
    const options = numericOptions(expected, random, [-step, step, 1, -1]);
    return choiceTrial(key, id, index, difficulty, { type: 'choice', prompt: `${start}, ${start + step}, ${start + step * 2}, ?`, options }, String(expected));
  }
  if (key === 'logic-equation') {
    const range = 8 + difficulty * 4; const a = 2 + Math.floor(random() * range); const b = 2 + Math.floor(random() * (5 + difficulty)); const c = 1 + Math.floor(random() * (3 + difficulty)); const expected = a + b * c;
    const options = numericOptions(expected, random, [b, -c, 2, -2]);
    return choiceTrial(key, id, index, difficulty, { type: 'choice', prompt: `${a} + ${b} × ${c} = ?`, options }, String(expected));
  }
  if (key === 'pattern-complete') {
    const symbols = ['◆', '●', '▲', '■']; const base = Math.floor(random() * symbols.length); const pattern = [0, 1, 2, 0, 1, 2].map((offset) => symbols[(base + offset) % symbols.length]);
    const expected = pattern[pattern.length - 1]; const options = shuffled([...symbols], random);
    return choiceTrial(key, id, index, difficulty, { type: 'choice', prompt: `${pattern.slice(0, 5).join(' ')} ?`, options }, expected);
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
    const start = ['↑', '→', '↓', '←'][Math.floor(random() * 4)]; const turns = 1 + Math.floor(random() * 3); const arrows = ['↑', '→', '↓', '←']; const expected = arrows[(arrows.indexOf(start) + turns) % arrows.length];
    return choiceTrial(key, id, index, difficulty, { type: 'choice', prompt: `Drehe ${start} um ${turns * 90}° nach rechts.`, options: arrows }, expected);
  }
  if (key === 'word-scramble') {
    const word = SCRAMBLE_WORDS[Math.floor(random() * SCRAMBLE_WORDS.length)]; const letters = shuffled([...word], random).join('');
    const options = shuffled([word, ...SCRAMBLE_WORDS.filter((entry) => entry !== word).slice(0, 3)], random);
    return choiceTrial(key, id, index, difficulty, { type: 'choice', prompt: `Welches Wort steckt in „${letters}“?`, options }, word);
  }
  if (key === 'count-shapes') {
    const shapes = ['◆', '●', '▲']; const target = shapes[Math.floor(random() * shapes.length)]; const sequence = Array.from({ length: 6 + difficulty }, () => shapes[Math.floor(random() * shapes.length)]); const expected = sequence.filter((shape) => shape === target).length;
    const options = numericOptions(expected, random);
    return choiceTrial(key, id, index, difficulty, { type: 'choice', prompt: `Wie oft kommt ${target} vor?  ${sequence.join(' ')}`, options }, String(expected));
  }
  if (key === 'logic-order') {
    const elements = difficulty >= 4 ? ['A', 'B', 'C', 'D'] : ['A', 'B', 'C'];
    const order = shuffled(elements, random);
    const clues = order.slice(1).map((entry, clueIndex) => clueIndex % 2 === 0
      ? `${entry} kommt nach ${order[clueIndex]}.`
      : `${order[clueIndex]} kommt vor ${entry}.`);
    const permutations = (values: string[]): string[] => values.length <= 1
      ? values
      : values.flatMap((entry, entryIndex) => permutations(values.filter((_, index) => index !== entryIndex)).map((suffix) => entry + suffix));
    const expected = order.join('');
    const distractors = shuffled(permutations(elements).filter((entry) => entry !== expected), random).slice(0, 5);
    return choiceTrial(key, id, index, difficulty, { type: 'choice', prompt: shuffled(clues, random).join(' '), options: shuffled([expected, ...distractors], random) }, expected);
  }
  if (key === 'delayed-recall') {
    const items = shuffled(ITEMS, random).slice(0, Math.min(7, 3 + difficulty)); const expected = items[Math.floor(random() * items.length)]; const options = shuffled([expected, ...ITEMS.filter((item) => !items.includes(item)).slice(0, 3)], random);
    return choiceTrial(key, id, index, difficulty, { type: 'delayed-recall', prompt: 'Welcher Gegenstand war in der Liste?', items, options }, expected, 'preview', phaseMs(key, difficulty));
  }
  if (key === 'prime-check') {
    const candidate = 11 + Math.floor(random() * 45); const prime = candidate > 1 && Array.from({ length: Math.floor(Math.sqrt(candidate)) - 1 }, (_, offset) => offset + 2).every((divisor) => candidate % divisor !== 0);
    return choiceTrial(key, id, index, difficulty, { type: 'choice', prompt: `Ist ${candidate} eine Primzahl?`, options: ['Ja', 'Nein'] }, prime ? 'Ja' : 'Nein');
  }
  if (key === 'balance-scale') {
    const known = 3 + Math.floor(random() * 8); const total = known + 8 + Math.floor(random() * 8); const expected = total - known;
    return choiceTrial(key, id, index, difficulty, { type: 'choice', prompt: `Eine Kugel + ${known} kg = ${total} kg. Wie schwer ist die Kugel?`, options: numericOptions(expected, random) }, String(expected));
  }
  if (key === 'clock-angle') {
    const hour = 1 + Math.floor(random() * 11); const minute = [0, 15, 30, 45][Math.floor(random() * 4)]; const hourAngle = (hour % 12) * 30 + minute * 0.5; const minuteAngle = minute * 6; const expected = Math.round(Math.min(Math.abs(hourAngle - minuteAngle), 360 - Math.abs(hourAngle - minuteAngle)));
    return choiceTrial(key, id, index, difficulty, { type: 'choice', prompt: `Wie groß ist der kleinere Winkel bei ${hour}:${String(minute).padStart(2, '0')} Uhr?`, options: numericOptions(expected, random, [15, -15, 30, -30]) }, String(expected));
  }
  if (key === 'binary-pattern') {
    const startsWithOne = random() > 0.5; const bits = Array.from({ length: 5 }, (_, position) => (startsWithOne ? position % 2 : (position + 1) % 2)); const expected = startsWithOne ? 1 : 0;
    return choiceTrial(key, id, index, difficulty, { type: 'choice', prompt: `${bits.join(' ')} ?`, options: ['0', '1'] }, String(expected));
  }
  if (key === 'rule-switch') {
    const number = 2 + Math.floor(random() * 20); const evenRule = random() > 0.5; const expected = number % 2 === 0 ? (evenRule ? 'Blau' : 'Rot') : (evenRule ? 'Rot' : 'Blau');
    return choiceTrial(key, id, index, difficulty, { type: 'choice', prompt: `${evenRule ? 'Gerade Zahlen = Blau' : 'Ungerade Zahlen = Blau'}, sonst Rot. Zahl ${number}?`, options: ['Blau', 'Rot'] }, expected);
  }
  if (key === 'matrix-missing') {
    const a = 1 + Math.floor(random() * 8); const b = a + 1 + Math.floor(random() * 5); const c = b + 1 + Math.floor(random() * 5); const expected = c + (b - a);
    return choiceTrial(key, id, index, difficulty, { type: 'matrix-choice', matrix: [[a, b], [c, null]], prompt: `${a}  ${b}\n${c}  ?`, options: numericOptions(expected, random) }, String(expected));
  }
  if (key === 'coin-change') {
    const amount = 8 + Math.floor(random() * 18); const expected = Math.floor(amount / 5) + Math.floor((amount % 5) / 2) + amount % 2;
    return choiceTrial(key, id, index, difficulty, { type: 'choice', prompt: `Wie viele Münzen brauchst du mindestens für ${amount} € (1 €, 2 €, 5 €)?`, options: numericOptions(expected, random) }, String(expected));
  }
  if (key === 'letter-order') {
    const letters = shuffled(['A', 'F', 'K', 'M', 'R'], random).slice(0, 3); const expected = [...letters].sort()[0];
    return choiceTrial(key, id, index, difficulty, { type: 'choice', prompt: `Welcher Buchstabe steht alphabetisch zuerst: ${letters.join(', ')}?`, options: shuffled(letters, random) }, expected);
  }
  if (key === 'digit-sum') {
    const number = 12 + Math.floor(random() * 87); const expected = String(number).split('').reduce((sum, digit) => sum + Number(digit), 0);
    return choiceTrial(key, id, index, difficulty, { type: 'choice', prompt: `Wie hoch ist die Ziffernsumme von ${number}?`, options: numericOptions(expected, random) }, String(expected));
  }
  if (key === 'sequence-transform') {
    const start = 2 + Math.floor(random() * 5); const expected = (start * 2 + 1) * 2 + 1;
    return choiceTrial(key, id, index, difficulty, { type: 'choice', prompt: `${start} → ${start * 2 + 1} → ${(start * 2 + 1) * 2 + 1} → ?`, options: numericOptions(expected, random, [-1, 2, 4, -2]) }, String(expected));
  }
  if (key === 'sequence-echo' || key === 'reverse-echo') {
    const length = Math.min(9, 2 + difficulty + Math.floor(index / 4));
    const sequence = gridSequence(random, length, size);
    return { trialId: id, index, difficulty, phase: 'preview', phaseMs: phaseMs(key, difficulty), inputMs: inputWindowMs(key, difficulty), data: { type: 'sequence', size, sequence }, expected: key === 'reverse-echo' ? [...sequence].reverse() : sequence, state: {} };
  }
  if (key === 'memory-matrix') {
    const count = Math.min(size * size - 1, 2 + difficulty + Math.floor(index / 5));
    const highlights = gridSequence(random, count, size);
    return { trialId: id, index, difficulty, phase: 'preview', phaseMs: phaseMs(key, difficulty), inputMs: inputWindowMs(key, difficulty), data: { type: 'matrix', size, highlights }, expected: highlights, state: {} };
  }
  if (key === 'number-blind') {
    const count = Math.min(12, 3 + difficulty + Math.floor(index / 5));
    const positions = gridSequence(random, count, size);
    const numbers = shuffled(Array.from({ length: count }, (_, value) => value + 1), random).map((number, position) => ({ number, position: positions[position] }));
    return { trialId: id, index, difficulty, phase: 'preview', phaseMs: phaseMs(key, difficulty), inputMs: inputWindowMs(key, difficulty), data: { type: 'number-blind', size, numbers }, expected: numbers.sort((a, b) => a.number - b.number).map((entry) => entry.position), state: {} };
  }
  if (key === 'n-back') {
    const n = difficulty >= 3 ? 2 : 1;
    const previous = symbolHistory.length >= n ? symbolHistory[symbolHistory.length - n] : null;
    const shouldMatch = previous !== null && random() > 0.67;
    const candidate = CHALLENGE_SYMBOLS[Math.floor(random() * CHALLENGE_SYMBOLS.length)];
    const symbol = shouldMatch ? previous : previous !== null && candidate === previous
      ? CHALLENGE_SYMBOLS[(CHALLENGE_SYMBOLS.indexOf(previous as typeof CHALLENGE_SYMBOLS[number]) + 1 + Math.floor(random() * (CHALLENGE_SYMBOLS.length - 1))) % CHALLENGE_SYMBOLS.length]
      : candidate;
    return { trialId: id, index, difficulty, phase: 'input', phaseMs: 0, inputMs: inputWindowMs(key, difficulty), data: { type: 'choice', symbol, n, itemIndex: index }, expected: previous !== null && symbol === previous, state: {} };
  }
  if (key === 'seen-before') {
    const repeated = index > 0 && random() > 0.55;
    const symbolIndex = repeated ? Math.floor(random() * Math.max(1, Math.min(CHALLENGE_SYMBOLS.length, index))) : Math.floor(random() * CHALLENGE_SYMBOLS.length);
    const symbol = CHALLENGE_SYMBOLS[symbolIndex];
    return { trialId: id, index, difficulty, phase: 'input', phaseMs: 0, inputMs: inputWindowMs(key, difficulty), data: { type: 'choice', symbol }, expected: repeated, state: {} };
  }
  if (key === 'missing-item') {
    const count = Math.min(9, 3 + difficulty + Math.floor(index / 4));
    const items = shuffled(ITEMS, random).slice(0, count);
    const missingIndex = Math.floor(random() * items.length);
    const missing = items[missingIndex];
    const visible = items.filter((_, itemIndex) => itemIndex !== missingIndex);
    const options = shuffled([missing, ...shuffled(visible, random).slice(0, 3)], random);
    return { trialId: id, index, difficulty, phase: 'preview', phaseMs: phaseMs(key, difficulty), inputMs: inputWindowMs(key, difficulty), data: { type: 'missing', items: visible, originalItems: items, options }, expected: missing, state: {} };
  }
  if (key === 'memory-pairs') {
    const pairCount = difficulty >= 4 ? 6 : difficulty >= 2 ? 3 : 2;
    const values = shuffled([...CHALLENGE_SYMBOLS], random).slice(0, pairCount);
    const board = shuffled([...values, ...values], random);
    return { trialId: id, index, difficulty, phase: 'input', phaseMs: 0, inputMs: inputWindowMs(key, difficulty), data: { type: 'pairs', boardSize: pairCount * 2 <= 6 ? 2 : 3, cards: board.map((value, cardIndex) => ({ index: cardIndex, value })) }, expected: board, state: { found: [], attempts: 0 }, };
  }
  if (key === 'path-memory') {
    const pathLength = Math.min(10, 2 + difficulty + Math.floor(index / 4));
    const path = gridSequence(random, pathLength, size);
    return { trialId: id, index, difficulty, phase: 'preview', phaseMs: Math.max(350, 700 - difficulty * 60), inputMs: inputWindowMs(key, difficulty), data: { type: 'path', size, path }, expected: path, state: {} };
  }
  const count = Math.min(8, 2 + difficulty + Math.floor(index / 4));
  const list = shuffled(ITEMS, random).slice(0, count);
  const position = Math.floor(random() * list.length);
  const options = shuffled([list[position], ...shuffled(ITEMS.filter((item) => !list.includes(item)), random).slice(0, 3)], random);
  return { trialId: id, index, difficulty, phase: 'preview', phaseMs: phaseMs(key, difficulty), inputMs: inputWindowMs(key, difficulty), data: { type: 'suitcase', items: list, position: position + 1, options }, expected: list[position], state: {} };
}

export function validateTrialInput(key: ChallengeKey, trial: InternalTrial, action: string, value: unknown, responseMs = 0): TrialResult {
  const wrong = (error = 'Falsche Antwort.') => ({ accepted: true, complete: true, correct: false, errors: 1, rawScore: 0, error });
  if (trial.phase === 'preview' && key !== 'memory-pairs') return { accepted: false, complete: false, correct: false, errors: 0, rawScore: 0, error: 'Die Vorschau läuft noch.' };
  if (key === 'aim-trainer') {
    const point = value && typeof value === 'object' ? value as { x?: unknown; y?: unknown } : {};
    const target = trial.expected as { x: number; y: number };
    const valid = action === 'hit' && typeof point.x === 'number' && typeof point.y === 'number' && Math.abs(point.x - target.x) <= 12 && Math.abs(point.y - target.y) <= 12;
    return valid ? { accepted: true, complete: true, correct: true, errors: 0, rawScore: 55 + trial.difficulty * 7 } : wrong('Ungültiges Ziel.');
  }
  if (key === 'odd-one-out') {
    if (action !== 'select' || typeof value !== 'number' || !Number.isInteger(value) || value < 0 || value >= Number(trial.data.tileCount)) return { accepted: false, complete: false, correct: false, errors: 0, rawScore: 0, error: 'Ungültiges Feld.' };
    return value === trial.expected ? { accepted: true, complete: true, correct: true, errors: 0, rawScore: 65 + trial.difficulty * 6 } : wrong();
  }
  if (key === 'traffic-light') {
    if (action !== 'click') return { accepted: false, complete: false, correct: false, errors: 0, rawScore: 0, error: 'Ungültige Reaktion.' };
    return { accepted: true, complete: true, correct: true, errors: 0, rawScore: scoreReaction(responseMs) };
  }
  if (key === 'color-word') {
    if (action !== 'answer' || typeof value !== 'string') return { accepted: false, complete: false, correct: false, errors: 0, rawScore: 0, error: 'Ungültige Farbwahl.' };
    return value === trial.expected ? { accepted: true, complete: true, correct: true, errors: 0, rawScore: 55 + trial.difficulty * 7 } : wrong();
  }
  if (LOGIC_KEYS.has(key)) {
    if (action !== 'choice' || (typeof value !== 'string' && typeof value !== 'number')) return { accepted: false, complete: false, correct: false, errors: 0, rawScore: 0, error: 'Ungültige Auswahl.' };
    return String(value) === String(trial.expected) ? { accepted: true, complete: true, correct: true, errors: 0, rawScore: 58 + trial.difficulty * 7 } : wrong();
  }
  if (key === 'whack-a-mole') {
    if (action !== 'hit' || typeof value !== 'number' || !Number.isInteger(value)) return { accepted: false, complete: false, correct: false, errors: 0, rawScore: 0, error: 'Ungültiges Feld.' };
    const sequence = trial.expected as number[]; const current = typeof trial.state.correct === 'number' ? trial.state.correct : 0;
    if (value < 0 || value >= Number(trial.data.size) ** 2 || value !== sequence[current]) return wrong();
    const next = current + 1; trial.state.correct = next;
    return { accepted: true, complete: next >= sequence.length, correct: true, errors: 0, rawScore: next >= sequence.length ? 75 + trial.difficulty * 5 : 0 };
  }
  if (key === 'sequence-echo' || key === 'reverse-echo' || key === 'memory-sequence' || key === 'path-memory') {
    if (action !== 'sequence' || !Array.isArray(value)) return { accepted: false, complete: false, correct: false, errors: 0, rawScore: 0, error: 'Ungültige Folge.' };
    const expected = trial.expected as number[]; const received = value;
    const correct = received.length === expected.length && received.every((entry, index) => typeof entry === 'number' && Number.isInteger(entry) && entry >= 0 && entry < Number(trial.data.size) ** 2 && entry === expected[index]) && new Set(received).size === received.length;
    return correct ? { accepted: true, complete: true, correct: true, errors: 0, rawScore: 70 + trial.difficulty * 6 } : wrong();
  }
  if (key === 'memory-matrix') {
    if (action !== 'cells' || !Array.isArray(value)) return { accepted: false, complete: false, correct: false, errors: 0, rawScore: 0, error: 'Ungültige Felder.' };
    const expected = [...(trial.expected as number[])].sort((a, b) => a - b); const received = [...value].sort((a, b) => Number(a) - Number(b));
    const valid = received.every((entry) => typeof entry === 'number' && Number.isInteger(entry) && entry >= 0 && entry < Number(trial.data.size) ** 2) && new Set(received).size === received.length;
    const correct = valid && expected.length === received.length && expected.every((entry, index) => entry === received[index]);
    return correct ? { accepted: true, complete: true, correct: true, errors: 0, rawScore: 70 + trial.difficulty * 6 } : wrong();
  }
  if (key === 'number-blind') {
    if (action !== 'sequence' || !Array.isArray(value)) return { accepted: false, complete: false, correct: false, errors: 0, rawScore: 0, error: 'Ungültige Zahlenfolge.' };
    const expected = trial.expected as number[]; const received = value;
    const valid = received.every((entry) => typeof entry === 'number' && Number.isInteger(entry) && entry >= 0 && entry < Number(trial.data.size) ** 2) && new Set(received).size === received.length;
    const correct = valid && expected.length === received.length && expected.every((entry, index) => entry === received[index]);
    return correct ? { accepted: true, complete: true, correct: true, errors: 0, rawScore: 72 + trial.difficulty * 5 } : wrong();
  }
  if (key === 'n-back' || key === 'seen-before') {
    if (action !== 'choice' || typeof value !== 'boolean') return { accepted: false, complete: false, correct: false, errors: 0, rawScore: 0, error: 'Ungültige Auswahl.' };
    const correct = value === trial.expected; return correct ? { accepted: true, complete: true, correct: true, errors: 0, rawScore: 45 + trial.difficulty * 7 } : wrong();
  }
  if (key === 'missing-item' || key === 'suitcase-memory') {
    if (action !== 'choice' || typeof value !== 'string') return { accepted: false, complete: false, correct: false, errors: 0, rawScore: 0, error: 'Ungültige Auswahl.' };
    const correct = value === trial.expected; return correct ? { accepted: true, complete: true, correct: true, errors: 0, rawScore: 65 + trial.difficulty * 6 } : wrong();
  }
  if (key === 'memory-pairs') {
    if (action !== 'pair' || !Array.isArray(value) || value.length !== 2) return { accepted: false, complete: false, correct: false, errors: 0, rawScore: 0, error: 'Ungültiges Paar.' };
    const board = trial.expected as string[]; const first = value[0]; const second = value[1];
    if (!Number.isInteger(first) || !Number.isInteger(second) || first < 0 || second < 0 || first >= board.length || second >= board.length || first === second) {
      return { accepted: false, complete: false, correct: false, errors: 0, rawScore: 0, error: 'Ungültige Karten.' };
    }
    const found = (trial.state.found as number[] | undefined) ?? []; if (found.includes(first) || found.includes(second)) return { accepted: false, complete: false, correct: false, errors: 0, rawScore: 0, error: 'Karte bereits gefunden.' };
    trial.state.attempts = Number(trial.state.attempts ?? 0) + 1;
    if (board[first] !== board[second]) return { accepted: true, complete: false, correct: false, errors: 1, rawScore: -4 };
    found.push(first, second); trial.state.found = found;
    const complete = found.length === board.length;
    return { accepted: true, complete, correct: true, errors: 0, rawScore: complete ? 80 + trial.difficulty * 5 : 0 };
  }
  return wrong('Nicht unterstützte Eingabe.');
}

export function safeScoreInput(value: number): number { return Number.isFinite(value) ? Math.max(0, Math.min(100, value)) : 0; }
function safeCount(value: number): number { return Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0; }
function safeElapsed(value: number): number { return Number.isFinite(value) ? Math.max(0, value) : 0; }
export function scoreReaction(elapsedMs: number): number { return safeScoreInput(Math.round(100 - Math.max(0, safeElapsed(elapsedMs) - 120) / 35)); }
export function scoreCps(clicks: number, durationMs = 30_000): number {
  const seconds = Math.max(1, safeElapsed(durationMs) / 1_000);
  return safeScoreInput(Math.round((safeCount(clicks) / seconds / 8) * 100));
}
export function scoreNumberSalad(correct: number, errors: number): number { return safeScoreInput(Math.round(safeCount(correct) * 12.5 - safeCount(errors) * 8)); }
export function scoreTiming10(elapsedMs: number): number { return safeScoreInput(Math.round(100 - Math.abs(safeElapsed(elapsedMs) - 10_000) / 20)); }

export function scoreTrialThroughput(rawScore: number, trials: number, correct: number, durationMs: number): number {
  const safeTrials = safeCount(trials);
  if (safeTrials === 0) return 0;
  const averageRawScore = (Number.isFinite(rawScore) ? rawScore : 0) / safeTrials;
  const accuracy = Math.max(0, Math.min(1, safeCount(correct) / safeTrials));
  const targetTrials = Math.max(1, safeElapsed(durationMs) / 2_000);
  const throughput = Math.min(1, safeTrials / targetTrials);
  return safeScoreInput(Math.round(averageRawScore * 0.65 + accuracy * 25 + throughput * 10));
}

export function scoreRepeatedTrials(rawScore: number, trials: number, correct: number, partialHits: number, durationMs: number): number {
  const partialCredit = Math.min(5, safeCount(partialHits) / 2);
  if (safeCount(trials) === 0) return safeScoreInput(Math.round(partialCredit));
  return safeScoreInput(scoreTrialThroughput(rawScore, trials, correct, durationMs) + partialCredit);
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

export function isCurrentChallenge(expectedIndex: number, actualIndex: number): boolean { return Number.isInteger(expectedIndex) && expectedIndex === actualIndex; }
export function remainingUntil(deadlineAt: number | null, now: number): number | null { return deadlineAt === null ? null : Math.max(0, deadlineAt - now); }
