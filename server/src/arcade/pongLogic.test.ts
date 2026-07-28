import test from 'node:test';
import assert from 'node:assert/strict';
import { BALL_RADIUS, PADDLE_HEIGHT, PONG_HEIGHT, PONG_WIDTH, createWorld, stepWorld } from './pongLogic';

const idle = { up: false, down: false };

test('paddles stay inside the arena', () => {
  const world = createWorld();
  for (let index = 0; index < 240; index++) stepWorld(world, [{ up: true, down: false }, { up: false, down: true }], 1 / 60);
  assert.equal(world.paddles[0].y, 0);
  assert.equal(world.paddles[1].y, PONG_HEIGHT - PADDLE_HEIGHT);
});

test('ball bounces off the top and bottom walls', () => {
  const world = createWorld();
  world.ball.y = BALL_RADIUS + 1;
  world.ball.vy = -300;
  stepWorld(world, [idle, idle], 1 / 60);
  assert.ok(world.ball.vy > 0);

  world.ball.y = PONG_HEIGHT - BALL_RADIUS - 1;
  world.ball.vy = 300;
  stepWorld(world, [idle, idle], 1 / 60);
  assert.ok(world.ball.vy < 0);
});

test('paddle contact sends the ball back and adds angle', () => {
  const world = createWorld('left');
  const paddle = world.paddles[0];
  world.ball.x = paddle.x + 20;
  world.ball.y = paddle.y + 12;
  world.ball.vx = -420;
  world.ball.vy = 0;
  stepWorld(world, [idle, idle], 1 / 60);
  assert.ok(world.ball.vx > 0);
  assert.ok(world.ball.vy < 0);
});

test('every paddle contact accelerates the ball up to a controlled maximum', () => {
  const world = createWorld('left');
  const speeds: number[] = [];

  for (let hit = 0; hit < 14; hit++) {
    const paddleIndex = hit % 2;
    const paddle = world.paddles[paddleIndex];
    world.ball.x = paddleIndex === 0
      ? paddle.x + 20
      : paddle.x - BALL_RADIUS + 1;
    world.ball.y = paddle.y + PADDLE_HEIGHT / 2;
    world.ball.vx = paddleIndex === 0
      ? -Math.abs(world.ball.vx)
      : Math.abs(world.ball.vx);
    world.ball.vy = 0;

    stepWorld(world, [idle, idle], 1 / 120);
    speeds.push(Math.abs(world.ball.vx));
  }

  assert.ok(speeds[1] > speeds[0]);
  assert.equal(speeds.at(-1), 900);
  assert.ok(speeds.every((speed) => speed <= 900));
});

test('crossing a goal awards the opposite player', () => {
  const world = createWorld('left');
  world.ball.x = -BALL_RADIUS - 1;
  assert.equal(stepWorld(world, [idle, idle], 1 / 60), 'right');

  const other = createWorld('right');
  other.ball.x = PONG_WIDTH + BALL_RADIUS + 1;
  assert.equal(stepWorld(other, [idle, idle], 1 / 60), 'left');
});

test('doubles creates two independently moving paddles for each team', () => {
  const world = createWorld('right', 'doubles');
  assert.deepEqual(world.paddles.map((paddle) => paddle.team), ['left', 'left', 'right', 'right']);

  const startingY = world.paddles.map((paddle) => paddle.y);
  stepWorld(world, [
    { up: false, down: true },
    { up: true, down: false },
    { up: false, down: true },
    { up: true, down: false },
  ], 1 / 60);

  assert.ok(world.paddles[0].y > startingY[0]);
  assert.ok(world.paddles[1].y < startingY[1]);
  assert.ok(world.paddles[2].y > startingY[2]);
  assert.ok(world.paddles[3].y < startingY[3]);
});

test('ball bounces off the second paddle of a doubles team', () => {
  const world = createWorld('left', 'doubles');
  const paddle = world.paddles[1];
  world.ball.x = paddle.x + 20;
  world.ball.y = paddle.y + PADDLE_HEIGHT / 2;
  world.ball.vx = -420;
  world.ball.vy = 0;

  stepWorld(world, [idle, idle, idle, idle], 1 / 60);

  assert.ok(world.ball.vx > 0);
});
