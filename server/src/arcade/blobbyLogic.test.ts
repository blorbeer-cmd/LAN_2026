import test from 'node:test';
import assert from 'node:assert/strict';
import { BALL_RADIUS, BLOB_RADIUS, COURT_WIDTH, GROUND_Y, NET_X, blobbyBotInput, createWorld, stepWorld } from './blobbyLogic';

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

test('doubles creates two independently moving blobs on each side', () => {
  const world = createWorld('left', 'doubles');
  assert.deepEqual(world.blobs.map((blob) => blob.side), ['left', 'left', 'right', 'right']);

  const startingX = world.blobs.map((blob) => blob.x);
  stepWorld(world, [
    { ...idle, right: true },
    { ...idle, left: true },
    { ...idle, right: true },
    { ...idle, left: true },
  ], 1 / 60);

  assert.ok(world.blobs[0].x > startingX[0]);
  assert.ok(world.blobs[1].x < startingX[1]);
  assert.ok(world.blobs[2].x > startingX[2]);
  assert.ok(world.blobs[3].x < startingX[3]);
});

test('doubles keeps every blob on its team side', () => {
  const world = createWorld('left', 'doubles');
  const inputs = [
    { ...idle, right: true },
    { ...idle, right: true },
    { ...idle, left: true },
    { ...idle, left: true },
  ];
  for (let i = 0; i < 180; i += 1) stepWorld(world, inputs, 1 / 60);

  assert.ok(world.blobs.slice(0, 2).every((blob) => blob.x < NET_X));
  assert.ok(world.blobs.slice(2).every((blob) => blob.x > NET_X));
});

test('ball collides with the second blob of a doubles team', () => {
  const world = createWorld('left', 'doubles');
  const secondBlob = world.blobs[1];
  world.ball.x = secondBlob.x + 40;
  world.ball.y = secondBlob.y;
  world.ball.vx = -320;
  world.ball.vy = 0;

  stepWorld(world, [idle, idle, idle, idle], 1 / 60);

  assert.ok(world.ball.vx > -320 || world.ball.vy < 0);
});

test('doubles bot lanes keep two same-team opponents separated', () => {
  const world = createWorld('left', 'doubles');
  for (let tick = 0; tick < 240; tick += 1) {
    world.ball.x = 750;
    world.ball.y = 140;
    world.ball.vx = 0;
    world.ball.vy = 0;
    stepWorld(world, [
      idle,
      idle,
      blobbyBotInput(world, 2, 'doubles', 0),
      blobbyBotInput(world, 3, 'doubles', 1),
    ], 1 / 60);
  }

  assert.ok(world.blobs[3].x - world.blobs[2].x >= BLOB_RADIUS * 2);
});
