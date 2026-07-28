import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createWorld,
  setDirection,
  SNAKE_ARENA_MAX_PLAYERS,
  SNAKE_ARENA_SHRINK_TICKS,
  stepWorld,
} from './snakeLogic';

test('classic Snake keeps the existing two-player board', () => {
  const world = createWorld();
  assert.equal(world.mode, 'classic');
  assert.equal(world.snakes.length, 2);
  assert.deepEqual(world.food, { x: 16, y: 5 });
  assert.deepEqual(world.safeBounds, { minX: 0, maxX: 31, minY: 0, maxY: 19 });
});

test('Snake Arena creates distinct starting positions for up to eight players', () => {
  const world = createWorld(SNAKE_ARENA_MAX_PLAYERS, 'arena');
  const occupied = world.snakes.flatMap((snake) => snake.body.map((cell) => `${cell.x}:${cell.y}`));
  assert.equal(world.snakes.length, SNAKE_ARENA_MAX_PLAYERS);
  assert.deepEqual(world.food, { x: 16, y: 8 });
  assert.equal(new Set(occupied).size, occupied.length);
  assert.throws(() => createWorld(2, 'arena'), /3 to 8/);
  assert.throws(() => createWorld(9, 'arena'), /3 to 8/);
});

test('Snake Arena shrinks symmetrically and eliminates a head beyond the safe zone', () => {
  const world = createWorld(3, 'arena');
  world.tick = SNAKE_ARENA_SHRINK_TICKS;
  world.snakes[0].body = [{ x: 0, y: 10 }, { x: 1, y: 10 }, { x: 2, y: 10 }];
  world.snakes[0].direction = 'left';
  world.snakes[0].nextDirection = 'left';

  const deaths = stepWorld(world);

  assert.deepEqual(world.safeBounds, { minX: 1, maxX: 30, minY: 1, maxY: 18 });
  assert.deepEqual(deaths, [0]);
  assert.equal(world.snakes[0].alive, false);
});

test('all colliding Snake Arena heads are eliminated in the same turn', () => {
  const world = createWorld(3, 'arena');
  world.snakes[0].body = [{ x: 9, y: 10 }, { x: 8, y: 10 }, { x: 7, y: 10 }];
  world.snakes[1].body = [{ x: 11, y: 10 }, { x: 12, y: 10 }, { x: 13, y: 10 }];
  world.snakes[0].direction = world.snakes[0].nextDirection = 'right';
  world.snakes[1].direction = world.snakes[1].nextDirection = 'left';
  setDirection(world.snakes[2], 'down');

  const deaths = stepWorld(world);

  assert.deepEqual(deaths, [0, 1]);
  assert.equal(world.snakes[2].alive, true);
});

test('Snake Arena respawns food even when every snake reaching it dies in the same turn', () => {
  const world = createWorld(3, 'arena');
  world.food = { x: 10, y: 10 };
  world.snakes[0].body = [{ x: 9, y: 10 }, { x: 8, y: 10 }, { x: 7, y: 10 }];
  world.snakes[1].body = [{ x: 11, y: 10 }, { x: 12, y: 10 }, { x: 13, y: 10 }];
  world.snakes[0].direction = world.snakes[0].nextDirection = 'right';
  world.snakes[1].direction = world.snakes[1].nextDirection = 'left';

  const deaths = stepWorld(world);

  assert.deepEqual(deaths, [0, 1]);
  assert.notDeepEqual(world.food, { x: 10, y: 10 });
  assert.equal(world.snakes[2].alive, true);
});
