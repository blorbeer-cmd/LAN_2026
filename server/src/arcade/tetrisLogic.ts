// Pure, side-effect-free Tetris rules — the deterministic core shared by the
// server game loop (tetris.ts) and directly unit-tested. Kept free of any
// socket/DB concerns so the rules can be reasoned about and tested in
// isolation. The server is authoritative: it owns every board and only ever
// applies validated moves through these functions.

export const BOARD_WIDTH = 10;
export const BOARD_HEIGHT = 20;

// Cell values: 0 = empty, 1-7 = a locked tetromino colour, 8 = garbage.
export const GARBAGE_CELL = 8;

export type Cell = number;
export type Board = Cell[][];
export type PieceType = 'I' | 'O' | 'T' | 'S' | 'Z' | 'J' | 'L';

export interface Piece {
  type: PieceType;
  rotation: number; // 0-3
  x: number; // column of the piece's local origin
  y: number; // row of the piece's local origin (may be negative near spawn)
}

// Each tetromino's four rotation states as explicit [col,row] cell offsets
// within a small bounding box (3x3 for most, 4x4 for I). Rotating just swaps
// to the next precomputed state — far less error-prone than rotating a matrix
// at runtime. Colours match the classic Tetris guideline palette order.
const PIECES: Record<PieceType, { color: number; rotations: Array<Array<[number, number]>> }> = {
  I: {
    color: 1,
    rotations: [
      [[0, 1], [1, 1], [2, 1], [3, 1]],
      [[2, 0], [2, 1], [2, 2], [2, 3]],
      [[0, 2], [1, 2], [2, 2], [3, 2]],
      [[1, 0], [1, 1], [1, 2], [1, 3]],
    ],
  },
  O: {
    color: 2,
    rotations: [
      [[1, 0], [2, 0], [1, 1], [2, 1]],
      [[1, 0], [2, 0], [1, 1], [2, 1]],
      [[1, 0], [2, 0], [1, 1], [2, 1]],
      [[1, 0], [2, 0], [1, 1], [2, 1]],
    ],
  },
  T: {
    color: 6,
    rotations: [
      [[1, 0], [0, 1], [1, 1], [2, 1]],
      [[1, 0], [1, 1], [2, 1], [1, 2]],
      [[0, 1], [1, 1], [2, 1], [1, 2]],
      [[1, 0], [0, 1], [1, 1], [1, 2]],
    ],
  },
  S: {
    color: 3,
    rotations: [
      [[1, 0], [2, 0], [0, 1], [1, 1]],
      [[1, 0], [1, 1], [2, 1], [2, 2]],
      [[1, 1], [2, 1], [0, 2], [1, 2]],
      [[0, 0], [0, 1], [1, 1], [1, 2]],
    ],
  },
  Z: {
    color: 4,
    rotations: [
      [[0, 0], [1, 0], [1, 1], [2, 1]],
      [[2, 0], [1, 1], [2, 1], [1, 2]],
      [[0, 1], [1, 1], [1, 2], [2, 2]],
      [[1, 0], [0, 1], [1, 1], [0, 2]],
    ],
  },
  J: {
    color: 5,
    rotations: [
      [[0, 0], [0, 1], [1, 1], [2, 1]],
      [[1, 0], [2, 0], [1, 1], [1, 2]],
      [[0, 1], [1, 1], [2, 1], [2, 2]],
      [[1, 0], [1, 1], [0, 2], [1, 2]],
    ],
  },
  L: {
    color: 7,
    rotations: [
      [[2, 0], [0, 1], [1, 1], [2, 1]],
      [[1, 0], [1, 1], [1, 2], [2, 2]],
      [[0, 1], [1, 1], [2, 1], [0, 2]],
      [[0, 0], [1, 0], [1, 1], [1, 2]],
    ],
  },
};

export const PIECE_TYPES: PieceType[] = ['I', 'O', 'T', 'S', 'Z', 'J', 'L'];

export function pieceColor(type: PieceType): number {
  return PIECES[type].color;
}

export function emptyBoard(): Board {
  return Array.from({ length: BOARD_HEIGHT }, () => Array<Cell>(BOARD_WIDTH).fill(0));
}

export function cloneBoard(board: Board): Board {
  return board.map((row) => row.slice());
}

// Absolute [x,y] cells a piece currently occupies on the board.
export function pieceCells(piece: Piece): Array<[number, number]> {
  return PIECES[piece.type].rotations[piece.rotation].map(([cx, cy]) => [piece.x + cx, piece.y + cy]);
}

// A move is invalid if any cell leaves the side/bottom walls or overlaps a
// locked cell. Cells above the top (y < 0) are allowed so pieces can spawn and
// rotate against the ceiling.
export function collides(board: Board, piece: Piece): boolean {
  for (const [x, y] of pieceCells(piece)) {
    if (x < 0 || x >= BOARD_WIDTH || y >= BOARD_HEIGHT) return true;
    if (y >= 0 && board[y][x] !== 0) return true;
  }
  return false;
}

// The piece each new spawn starts from: horizontally centred, flush with the
// top. Returns the piece; the caller checks collides() to detect a top-out.
export function spawnPiece(type: PieceType): Piece {
  return { type, rotation: 0, x: 3, y: 0 };
}

// Try to shift a piece by (dx,dy); returns the moved piece if legal, else null.
export function tryMove(board: Board, piece: Piece, dx: number, dy: number): Piece | null {
  const moved = { ...piece, x: piece.x + dx, y: piece.y + dy };
  return collides(board, moved) ? null : moved;
}

// Rotation with a small set of wall-kick offsets tried in order. Not full SRS,
// but enough that rotating against a wall or the floor "just works" for a
// casual 1v1 — the first offset that resolves the collision wins.
const KICKS: Array<[number, number]> = [
  [0, 0],
  [-1, 0],
  [1, 0],
  [-2, 0],
  [2, 0],
  [0, -1],
  [-1, -1],
  [1, -1],
];

export function tryRotate(board: Board, piece: Piece, dir: 1 | -1): Piece | null {
  const rotation = (piece.rotation + dir + 4) % 4;
  for (const [dx, dy] of KICKS) {
    const candidate = { ...piece, rotation, x: piece.x + dx, y: piece.y + dy };
    if (!collides(board, candidate)) return candidate;
  }
  return null;
}

// Drops the piece straight down as far as it will go (hard drop). Returns the
// resting piece plus how many rows it fell (used for the drop bonus).
export function dropDistance(board: Board, piece: Piece): number {
  let distance = 0;
  while (!collides(board, { ...piece, y: piece.y + distance + 1 })) distance += 1;
  return distance;
}

// Locks a piece into a fresh board copy (the caller then clears lines).
export function lockPiece(board: Board, piece: Piece): Board {
  const next = cloneBoard(board);
  const color = pieceColor(piece.type);
  for (const [x, y] of pieceCells(piece)) {
    if (y >= 0 && y < BOARD_HEIGHT && x >= 0 && x < BOARD_WIDTH) next[y][x] = color;
  }
  return next;
}

// Removes every full row, dropping everything above down. Returns the new
// board and how many rows were cleared.
export function clearLines(board: Board): { board: Board; cleared: number } {
  const remaining = board.filter((row) => row.some((cell) => cell === 0));
  const cleared = BOARD_HEIGHT - remaining.length;
  const next: Board = [];
  for (let i = 0; i < cleared; i++) next.push(Array<Cell>(BOARD_WIDTH).fill(0));
  return { board: [...next, ...remaining], cleared };
}

// How much garbage a line clear sends to the opponent. Singles send nothing;
// a Tetris (4) hits hardest — the usual incentive to stack for big clears.
export function garbageFor(cleared: number): number {
  if (cleared === 2) return 1;
  if (cleared === 3) return 2;
  if (cleared >= 4) return 4;
  return 0;
}

// Score awarded for a line clear at a given level (classic Nintendo values).
export function lineScore(cleared: number, level: number): number {
  const base = [0, 100, 300, 500, 800][Math.min(cleared, 4)];
  return base * level;
}

// Adds `count` garbage rows to the bottom, shoving the stack up. Each garbage
// row is solid except for a single hole at `gapColumn` (shared across the
// batch, as in most modern versions). Rows pushed past the ceiling are lost —
// which is what eventually tops a buried player out on their next spawn.
export function addGarbage(board: Board, count: number, gapColumn: number): Board {
  if (count <= 0) return cloneBoard(board);
  const rows: Board = [];
  for (let i = 0; i < count; i++) {
    const row = Array<Cell>(BOARD_WIDTH).fill(GARBAGE_CELL);
    row[gapColumn] = 0;
    rows.push(row);
  }
  const kept = board.slice(count); // drop the top `count` rows
  return [...kept, ...rows];
}

// Level rises every 10 cleared lines; gravity (ms per row) shortens with it.
export function levelForLines(lines: number): number {
  return Math.floor(lines / 10) + 1;
}

const GRAVITY_MS = [800, 720, 630, 550, 470, 380, 300, 220, 130, 100, 80, 80, 70, 70, 70, 50, 50, 50, 30, 30];

export function gravityMsForLevel(level: number): number {
  return GRAVITY_MS[Math.min(level - 1, GRAVITY_MS.length - 1)] ?? 30;
}

// Deterministic PRNG (mulberry32) so both boards in a match share the exact
// same piece sequence — fair by construction, no piece luck. Seeded from the
// match id, see stringToSeed.
export function makeRng(seed: number): () => number {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function stringToSeed(value: string): number {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

// One shuffled 7-bag: every tetromino once, in random order. Guarantees no
// long droughts or floods of a single piece.
export function nextBag(rng: () => number): PieceType[] {
  const bag = [...PIECE_TYPES];
  for (let i = bag.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [bag[i], bag[j]] = [bag[j], bag[i]];
  }
  return bag;
}
