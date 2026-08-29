import test from 'node:test';
import assert from 'node:assert/strict';
import { projectPongWorld } from './pongPrediction.js';

function snapshot(overrides = {}) {
  return {
    running: true,
    paused: false,
    serverTime: 1_000,
    rallyResumeAt: 0,
    render: { width: 960, height: 540, paddleWidth: 16, paddleHeight: 80, ballRadius: 12 },
    world: {
      ball: { x: 480, y: 270, vx: 400, vy: 100 },
      paddles: [
        { x: 48, y: 90, height: 80, vy: 200, team: 'left', lane: 'upper' },
        { x: 896, y: 370, height: 80, vy: 0, team: 'right', lane: 'lower' },
      ],
    },
    ...overrides,
  };
}

test('Pong prediction advances snapshots smoothly between server updates', () => {
  const projected = projectPongWorld(snapshot(), 50);
  assert.equal(Math.round(projected.ball.x), 500);
  assert.equal(Math.round(projected.ball.y), 275);
  assert.equal(Math.round(projected.paddles[0].y), 100);
});

test('Pong prediction remains still while paused or waiting for a rally', () => {
  const paused = projectPongWorld(snapshot({ paused: true }), 50);
  assert.equal(paused.ball.x, 480);

  const waiting = projectPongWorld(snapshot({ rallyResumeAt: 1_100 }), 50);
  assert.equal(waiting.ball.x, 480);

  const resumed = projectPongWorld(snapshot({ rallyResumeAt: 1_025 }), 50);
  assert.equal(Math.round(resumed.ball.x), 490);
});

test('Pong prediction respects the shorter doubles paddle lanes', () => {
  const projected = projectPongWorld(snapshot({
    world: {
      ball: { x: 480, y: 270, vx: 0, vy: 0 },
      paddles: [
        { x: 48, y: 185, height: 80, vy: 400, team: 'left', lane: 'upper' },
        { x: 48, y: 275, height: 80, vy: -400, team: 'left', lane: 'lower' },
      ],
    },
  }), 75);
  assert.equal(projected.paddles[0].y, 190);
  assert.equal(projected.paddles[1].y, 270);
});
