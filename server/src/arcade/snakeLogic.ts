export const SNAKE_WIDTH = 32;
export const SNAKE_HEIGHT = 20;

export type Direction = 'up' | 'down' | 'left' | 'right';
export interface Cell { x: number; y: number }
export interface Snake { body: Cell[]; direction: Direction; nextDirection: Direction; score: number; alive: boolean }
export interface SnakeWorld { snakes: [Snake, Snake]; food: Cell; tick: number }

const opposites: Record<Direction, Direction> = { up: 'down', down: 'up', left: 'right', right: 'left' };
const vectors: Record<Direction, Cell> = { up: { x: 0, y: -1 }, down: { x: 0, y: 1 }, left: { x: -1, y: 0 }, right: { x: 1, y: 0 } };

export function createWorld(): SnakeWorld {
  return {
    snakes: [
      { body: [{ x: 6, y: 10 }, { x: 5, y: 10 }, { x: 4, y: 10 }], direction: 'right', nextDirection: 'right', score: 0, alive: true },
      { body: [{ x: 25, y: 10 }, { x: 26, y: 10 }, { x: 27, y: 10 }], direction: 'left', nextDirection: 'left', score: 0, alive: true },
    ],
    food: { x: 16, y: 5 }, tick: 0,
  };
}

export function setDirection(snake: Snake, direction: Direction): void {
  if (snake.alive && direction !== opposites[snake.direction]) snake.nextDirection = direction;
}

function same(a: Cell, b: Cell) { return a.x === b.x && a.y === b.y; }
function randomFood(world: SnakeWorld): Cell {
  const occupied = world.snakes.flatMap((snake) => snake.body);
  const open: Cell[] = [];
  for (let y = 0; y < SNAKE_HEIGHT; y++) for (let x = 0; x < SNAKE_WIDTH; x++) {
    const cell = { x, y }; if (!occupied.some((part) => same(part, cell))) open.push(cell);
  }
  return open[Math.floor(Math.random() * open.length)] ?? { x: 16, y: 5 };
}

export function stepWorld(world: SnakeWorld): number[] {
  const next = world.snakes.map((snake) => {
    if (!snake.alive) return snake;
    snake.direction = snake.nextDirection;
    const vector = vectors[snake.direction];
    const head = { x: snake.body[0].x + vector.x, y: snake.body[0].y + vector.y };
    const ate = same(head, world.food);
    snake.body.unshift(head);
    if (!ate) snake.body.pop(); else snake.score += 1;
    return snake;
  }) as [Snake, Snake];
  const deaths: number[] = [];
  next.forEach((snake, index) => {
    const head = snake.body[0];
    const wall = head.x < 0 || head.x >= SNAKE_WIDTH || head.y < 0 || head.y >= SNAKE_HEIGHT;
    const self = snake.body.slice(1).some((part) => same(part, head));
    const other = next[1 - index].body.some((part) => same(part, head));
    if (wall || self || other) { snake.alive = false; deaths.push(index); }
  });
  if (next.some((snake) => same(snake.body[0], world.food) && snake.alive)) world.food = randomFood(world);
  world.tick += 1;
  return deaths;
}
