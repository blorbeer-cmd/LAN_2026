import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createWorld,
  setDirection,
  snakeArenaBotCount,
  SNAKE_ARENA_MAX_PLAYERS,
  SNAKE_ARENA_SHRINK_TICKS,
  SNAKE_HEIGHT,
  SNAKE_WIDTH,
  stepWorld,
  stepWorldWithCauses,
} from './snakeLogic';

test('classic Snake uses the expanded two-player board', () => {
  const world = createWorld();
  assert.equal(world.mode, 'classic');
  assert.equal(world.snakes.length, 2);
  assert.deepEqual(world.food, { x: 24, y: 8 });
  assert.deepEqual(world.safeBounds, { minX: 0, maxX: SNAKE_WIDTH - 1, minY: 0, maxY: SNAKE_HEIGHT - 1 });
  assert.equal(SNAKE_WIDTH / SNAKE_HEIGHT, 8 / 5);
});

test('Snake Arena creates distinct starting positions for up to eight players', () => {
  const world = createWorld(SNAKE_ARENA_MAX_PLAYERS, 'arena');
  const occupied = world.snakes.flatMap((snake) => snake.body.map((cell) => `${cell.x}:${cell.y}`));
  assert.equal(world.snakes.length, SNAKE_ARENA_MAX_PLAYERS);
  assert.deepEqual(world.food, { x: 24, y: 12 });
  assert.equal(new Set(occupied).size, occupied.length);
  assert.throws(() => createWorld(2, 'arena'), /3 to 8/);
  assert.throws(() => createWorld(9, 'arena'), /3 to 8/);
});

test('Snake AI quick starts fill the selected mode to its player limit', () => {
  assert.equal(snakeArenaBotCount('classic'), 1);
  assert.equal(snakeArenaBotCount('arena'), SNAKE_ARENA_MAX_PLAYERS - 1);
});

test('Snake Arena shrinks symmetrically and eliminates a head beyond the safe zone', () => {
  const world = createWorld(3, 'arena');
  world.tick = SNAKE_ARENA_SHRINK_TICKS;
  world.snakes[0].body = [{ x: 0, y: 10 }, { x: 1, y: 10 }, { x: 2, y: 10 }];
  world.snakes[0].direction = 'left';
  world.snakes[0].nextDirection = 'left';

  const deaths = stepWorld(world);

  assert.deepEqual(world.safeBounds, { minX: 1, maxX: 46, minY: 1, maxY: 28 });
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

test('Snake Arena records the opposing snake responsible for a collision', () => {
  const world = createWorld(3, 'arena');
  world.snakes[0].body = [{ x: 9, y: 10 }, { x: 8, y: 10 }, { x: 7, y: 10 }];
  world.snakes[1].body = [{ x: 11, y: 10 }, { x: 12, y: 10 }, { x: 13, y: 10 }];
  world.snakes[0].direction = world.snakes[0].nextDirection = 'right';
  world.snakes[1].direction = world.snakes[1].nextDirection = 'left';

  const result = stepWorldWithCauses(world);

  assert.deepEqual(result.eliminations.slice(0, 2), [
    { victimIndex: 0, culpritIndex: 1, reason: 'collision' },
    { victimIndex: 1, culpritIndex: 0, reason: 'collision' },
  ]);
  assert.equal(world.snakes[0].eliminatedBy, 1);
  assert.equal(world.snakes[0].eliminationReason, 'collision');
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
