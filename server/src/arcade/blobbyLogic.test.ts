import test from 'node:test';
import assert from 'node:assert/strict';
import { BALL_RADIUS, COURT_WIDTH, GROUND_Y, NET_X, createWorld, stepWorld } from './blobbyLogic';

const idle = { left: false, right: false, jump: false };

test('blobs stay on their own side of the net', () => {
  const world = createWorld();
  for (let i = 0; i < 180; i++) stepWorld(world, [{ ...idle, right: true }, { ...idle, left: true }], 1 / 60);
  assert.ok(world.blobs[0].x < NET_X);
  assert.ok(world.blobs[1].x > NET_X);
});

test('jump lifts a grounded blob and gravity brings it back', () => {
  const world = createWorld();
  const floor = world.blobs[0].y;
  stepWorld(world, [{ ...idle, jump: true }, idle], 1 / 60);
  assert.ok(world.blobs[0].y < floor);
  for (let i = 0; i < 120; i++) stepWorld(world, [idle, idle], 1 / 60);
  assert.equal(Math.round(world.blobs[0].y), Math.round(floor));
});

test('ball bounces off the outer wall', () => {
  const world = createWorld();
  world.ball.x = BALL_RADIUS + 1;
  world.ball.vx = -400;
  stepWorld(world, [idle, idle], 1 / 30);
  assert.ok(world.ball.vx > 0);
  assert.ok(world.ball.x >= BALL_RADIUS && world.ball.x <= COURT_WIDTH);
});

test('floor contact reports the landing side', () => {
  const world = createWorld();
  world.ball.x = 200;
  world.ball.y = GROUND_Y - BALL_RADIUS - 1;
  world.ball.vy = 100;
  assert.equal(stepWorld(world, [idle, idle], 1 / 30), 'left');
});

test('ball speed is capped after a strong collision', () => {
  const world = createWorld();
  world.ball.x = world.blobs[0].x + 40;
  world.ball.y = world.blobs[0].y;
  world.ball.vx = -2000;
  world.ball.vy = 0;
  stepWorld(world, [idle, idle], 1 / 60);
  assert.ok(Math.hypot(world.ball.vx, world.ball.vy) <= 620.01);
});
