export const SNAKE_WIDTH = 32;
export const SNAKE_HEIGHT = 20;
export const SNAKE_ARENA_MIN_PLAYERS = 3;
export const SNAKE_ARENA_MAX_PLAYERS = 8;
export const SNAKE_ARENA_SHRINK_TICKS = 80;

export type Direction = 'up' | 'down' | 'left' | 'right';
export type SnakeMode = 'classic' | 'arena';
export interface Cell { x: number; y: number }
export interface SafeBounds { minX: number; maxX: number; minY: number; maxY: number }
export interface Snake { body: Cell[]; direction: Direction; nextDirection: Direction; score: number; alive: boolean }
export interface SnakeWorld { snakes: Snake[]; food: Cell; tick: number; mode: SnakeMode; safeBounds: SafeBounds }

const opposites: Record<Direction, Direction> = { up: 'down', down: 'up', left: 'right', right: 'left' };
const vectors: Record<Direction, Cell> = { up: { x: 0, y: -1 }, down: { x: 0, y: 1 }, left: { x: -1, y: 0 }, right: { x: 1, y: 0 } };
const INITIAL_BOUNDS: SafeBounds = { minX: 0, maxX: SNAKE_WIDTH - 1, minY: 0, maxY: SNAKE_HEIGHT - 1 };

const SPAWNS: Array<{ head: Cell; direction: Direction }> = [
  { head: { x: 6, y: 10 }, direction: 'right' },
  { head: { x: 25, y: 10 }, direction: 'left' },
  { head: { x: 16, y: 4 }, direction: 'down' },
  { head: { x: 15, y: 15 }, direction: 'up' },
  { head: { x: 6, y: 5 }, direction: 'right' },
  { head: { x: 25, y: 14 }, direction: 'left' },
  { head: { x: 25, y: 5 }, direction: 'left' },
  { head: { x: 6, y: 14 }, direction: 'right' },
];

function spawnSnake({ head, direction }: { head: Cell; direction: Direction }): Snake {
  const vector = vectors[direction];
  return {
    body: [head, { x: head.x - vector.x, y: head.y - vector.y }, { x: head.x - vector.x * 2, y: head.y - vector.y * 2 }],
    direction,
    nextDirection: direction,
    score: 0,
    alive: true,
  };
}

export function createWorld(playerCount = 2, mode: SnakeMode = 'classic'): SnakeWorld {
  const valid = mode === 'classic'
    ? playerCount === 2
    : playerCount >= SNAKE_ARENA_MIN_PLAYERS && playerCount <= SNAKE_ARENA_MAX_PLAYERS;
  if (!valid) throw new RangeError(mode === 'classic' ? 'Classic Snake requires exactly 2 players.' : 'Snake Arena requires 3 to 8 players.');
  return {
    snakes: SPAWNS.slice(0, playerCount).map(spawnSnake),
    food: mode === 'arena' ? { x: 16, y: 8 } : { x: 16, y: 5 },
    tick: 0,
    mode,
    safeBounds: { ...INITIAL_BOUNDS },
  };
}

export function setDirection(snake: Snake, direction: Direction): void {
  if (snake.alive && direction !== opposites[snake.direction]) snake.nextDirection = direction;
}

function same(a: Cell, b: Cell) { return a.x === b.x && a.y === b.y; }
export function isInsideSafeBounds(cell: Cell, bounds: SafeBounds): boolean {
  return cell.x >= bounds.minX && cell.x <= bounds.maxX && cell.y >= bounds.minY && cell.y <= bounds.maxY;
}

function randomFood(world: SnakeWorld): Cell {
  const occupied = world.snakes.flatMap((snake) => snake.body);
  const open: Cell[] = [];
  for (let y = world.safeBounds.minY; y <= world.safeBounds.maxY; y++) {
    for (let x = world.safeBounds.minX; x <= world.safeBounds.maxX; x++) {
      const cell = { x, y };
      if (!occupied.some((part) => same(part, cell))) open.push(cell);
    }
  }
  return open[Math.floor(Math.random() * open.length)] ?? {
    x: Math.floor((world.safeBounds.minX + world.safeBounds.maxX) / 2),
    y: Math.floor((world.safeBounds.minY + world.safeBounds.maxY) / 2),
  };
}

function shrinkArena(world: SnakeWorld): void {
  if (world.mode !== 'arena' || world.tick === 0 || world.tick % SNAKE_ARENA_SHRINK_TICKS !== 0) return;
  const width = world.safeBounds.maxX - world.safeBounds.minX + 1;
  const height = world.safeBounds.maxY - world.safeBounds.minY + 1;
  if (width <= 12 || height <= 8) return;
  world.safeBounds = {
    minX: world.safeBounds.minX + 1,
    maxX: world.safeBounds.maxX - 1,
    minY: world.safeBounds.minY + 1,
    maxY: world.safeBounds.maxY - 1,
  };
  if (!isInsideSafeBounds(world.food, world.safeBounds)) world.food = randomFood(world);
}

export function stepWorld(world: SnakeWorld): number[] {
  shrinkArena(world);
  const next = world.snakes.map((snake) => {
    if (!snake.alive) return snake;
    snake.direction = snake.nextDirection;
    const vector = vectors[snake.direction];
    const head = { x: snake.body[0].x + vector.x, y: snake.body[0].y + vector.y };
    const ate = same(head, world.food);
    snake.body.unshift(head);
    if (!ate) snake.body.pop(); else snake.score += 1;
    return snake;
  });
  const deaths: number[] = [];
  next.forEach((snake, index) => {
    if (!snake.alive) return;
    const head = snake.body[0];
    const wall = !isInsideSafeBounds(head, world.safeBounds);
    const self = snake.body.slice(1).some((part) => same(part, head));
    const other = next.some((opponent, opponentIndex) => opponentIndex !== index && opponent.body.some((part) => same(part, head)));
    if (wall || self || other) {
      snake.alive = false;
      deaths.push(index);
    }
  });
  if (next.some((snake) => same(snake.body[0], world.food) && snake.alive)) world.food = randomFood(world);
  world.tick += 1;
  return deaths;
}
