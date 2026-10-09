// DOM-free helpers of the Chimp Test view, kept separate so they run under the
// Node test runner.

export const CHIMP_GRID_CELLS = 40;
// Laptop rows hold 8 cells; the phone grid shows the same indices column by
// column (5 columns of 8), so both layouts share one DOM order.
export const CHIMP_ROW_LENGTH = 8;

// One entry per cell: what the own run currently shows there. `clearedLocally`
// holds cells this client already tapped while the server ack is in flight.
export function chimpGridModel(me, reveal = null, clearedLocally = []) {
  const cells = Array.from({ length: CHIMP_GRID_CELLS }, () => ({ kind: 'empty' }));
  if (reveal) {
    (reveal.layout ?? []).forEach((cell, index) => {
      if (cells[cell]) cells[cell] = { kind: 'revealed', number: index + 1, wrong: cell === reveal.wrongCell };
    });
    return cells;
  }
  const cleared = new Set(clearedLocally);
  if (me?.phase === 'memorize' && Array.isArray(me.numbers)) {
    const started = cleared.size > 0;
    for (const { cell, number } of me.numbers) {
      if (!cells[cell] || cleared.has(cell)) continue;
      // The first tap hides every other number at once, before the ack arrives.
      cells[cell] = started ? { kind: 'hidden' } : { kind: 'number', number };
    }
  } else if (me?.phase === 'input' && Array.isArray(me.hiddenCells)) {
    for (const cell of me.hiddenCells) if (cells[cell] && !cleared.has(cell)) cells[cell] = { kind: 'hidden' };
  }
  return cells;
}

export function chimpCellLabel(index, cell) {
  const row = Math.floor(index / CHIMP_ROW_LENGTH) + 1;
  const column = (index % CHIMP_ROW_LENGTH) + 1;
  const position = `Reihe ${row}, Spalte ${column}`;
  if (cell.kind === 'number') return `Zahl ${cell.number}, ${position}`;
  if (cell.kind === 'revealed') return `${cell.wrong ? 'Falsch angetippt: ' : ''}Zahl ${cell.number}, ${position}`;
  if (cell.kind === 'hidden') return `Verdecktes Feld, ${position}`;
  return `Leeres Feld, ${position}`;
}

// Arrow keys move through the grid as it is drawn: row-major on laptops,
// column-major on phones. Edges stop instead of wrapping.
export function chimpNeighbor(index, key, columnFlow = false) {
  const across = columnFlow ? CHIMP_ROW_LENGTH : 1;
  const down = columnFlow ? 1 : CHIMP_ROW_LENGTH;
  const sameLine = (target, step) => step !== 1 || Math.floor(target / CHIMP_ROW_LENGTH) === Math.floor(index / CHIMP_ROW_LENGTH);
  const moves = { ArrowRight: across, ArrowLeft: -across, ArrowDown: down, ArrowUp: -down };
  const step = moves[key];
  if (step === undefined) return null;
  const target = index + step;
  if (target < 0 || target >= CHIMP_GRID_CELLS || !sameLine(target, Math.abs(step))) return null;
  return target;
}

export function chimpRatingText(rating) {
  if (!rating) return '';
  const value = rating.beyond > 0 ? `Ayumu übertroffen (+${rating.beyond})` : `${rating.percent ?? 0} %`;
  return `${value} · ${rating.tier}`;
}

export function chimpTimeText(ms) {
  const seconds = Math.max(0, Number(ms) || 0) / 1000;
  if (seconds < 60) return `${seconds.toLocaleString('de-DE', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} s`;
  const whole = Math.round(seconds);
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')} min`;
}

export function chimpNumbersText(count) {
  return `${count} ${count === 1 ? 'Zahl' : 'Zahlen'}`;
}

export function chimpStrikesText(strikes) {
  return `${strikes} ${strikes === 1 ? 'Strike' : 'Strikes'}`;
}
