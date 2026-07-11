export const COURT_WIDTH = 1000;
export const COURT_HEIGHT = 600;
export const GROUND_Y = 550;
export const NET_X = COURT_WIDTH / 2;
export const NET_HEIGHT = 185;
export const BLOB_RADIUS = 44;
export const BALL_RADIUS = 24;

const MOVE_SPEED = 400;
const JUMP_SPEED = 670;
const GRAVITY = 1550;
const BALL_GRAVITY = 560;
const BALL_BOUNCE = 0.82;
const MAX_BALL_SPEED = 620;

export interface Vec { x: number; y: number }
export interface BlobState extends Vec { vx: number; vy: number; side: 'left' | 'right'; grounded: boolean }
export interface BallState extends Vec { vx: number; vy: number }
export interface BlobbyInput { left: boolean; right: boolean; jump: boolean }
export interface BlobbyWorld { blobs: [BlobState, BlobState]; ball: BallState }

export function createWorld(serveSide: 'left' | 'right' = 'left'): BlobbyWorld {
  return {
    blobs: [
      { x: 250, y: GROUND_Y - BLOB_RADIUS, vx: 0, vy: 0, side: 'left', grounded: true },
      { x: 750, y: GROUND_Y - BLOB_RADIUS, vx: 0, vy: 0, side: 'right', grounded: true },
    ],
    ball: {
      x: serveSide === 'left' ? 280 : 720,
      y: 170,
      vx: serveSide === 'left' ? 115 : -115,
      vy: -40,
    },
  };
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function stepBlob(blob: BlobState, input: BlobbyInput, dt: number) {
  blob.vx = (input.right ? MOVE_SPEED : 0) - (input.left ? MOVE_SPEED : 0);
  if (input.jump && blob.grounded) {
    blob.vy = -JUMP_SPEED;
    blob.grounded = false;
  }
  blob.vy += GRAVITY * dt;
  blob.x += blob.vx * dt;
  blob.y += blob.vy * dt;

  const minX = blob.side === 'left' ? BLOB_RADIUS : NET_X + BLOB_RADIUS;
  const maxX = blob.side === 'left' ? NET_X - BLOB_RADIUS : COURT_WIDTH - BLOB_RADIUS;
  blob.x = clamp(blob.x, minX, maxX);
  const floor = GROUND_Y - BLOB_RADIUS;
  if (blob.y >= floor) {
    blob.y = floor;
    blob.vy = 0;
    blob.grounded = true;
  }
}

function collideBallWithBlob(ball: BallState, blob: BlobState) {
  const dx = ball.x - blob.x;
  const dy = ball.y - blob.y;
  const minDist = BALL_RADIUS + BLOB_RADIUS;
  const distSq = dx * dx + dy * dy;
  if (distSq <= 0 || distSq >= minDist * minDist) return;
  const dist = Math.sqrt(distSq);
  const nx = dx / dist;
  const ny = dy / dist;
  const overlap = minDist - dist;
  ball.x += nx * overlap;
  ball.y += ny * overlap;
  const relative = (ball.vx - blob.vx) * nx + (ball.vy - blob.vy) * ny;
  if (relative < 0) {
    ball.vx -= 1.75 * relative * nx;
    ball.vy -= 1.75 * relative * ny;
  }
  ball.vx += blob.vx * 0.18;
  ball.vy = Math.min(ball.vy, -170);
}

function collideBallWithNet(ball: BallState) {
  const top = GROUND_Y - NET_HEIGHT;
  const halfWidth = 10;
  if (ball.y + BALL_RADIUS < top) return;
  if (Math.abs(ball.x - NET_X) > BALL_RADIUS + halfWidth) return;

  if (ball.y < top && ball.vy > 0) {
    ball.y = top - BALL_RADIUS;
    ball.vy = -Math.abs(ball.vy) * 0.78;
    return;
  }
  const side = ball.x < NET_X ? -1 : 1;
  ball.x = NET_X + side * (BALL_RADIUS + halfWidth);
  ball.vx = side * Math.max(150, Math.abs(ball.vx)) * 0.82;
}

function capBallSpeed(ball: BallState) {
  const speed = Math.hypot(ball.vx, ball.vy);
  if (speed <= MAX_BALL_SPEED) return;
  const factor = MAX_BALL_SPEED / speed;
  ball.vx *= factor;
  ball.vy *= factor;
}

// Returns the side on which the ball touched the floor, otherwise null.
export function stepWorld(world: BlobbyWorld, inputs: [BlobbyInput, BlobbyInput], dtSeconds: number): 'left' | 'right' | null {
  const dt = Math.min(0.05, Math.max(0, dtSeconds));
  stepBlob(world.blobs[0], inputs[0], dt);
  stepBlob(world.blobs[1], inputs[1], dt);

  const ball = world.ball;
  ball.vy += BALL_GRAVITY * dt;
  ball.x += ball.vx * dt;
  ball.y += ball.vy * dt;

  if (ball.x < BALL_RADIUS) {
    ball.x = BALL_RADIUS;
    ball.vx = Math.abs(ball.vx) * BALL_BOUNCE;
  } else if (ball.x > COURT_WIDTH - BALL_RADIUS) {
    ball.x = COURT_WIDTH - BALL_RADIUS;
    ball.vx = -Math.abs(ball.vx) * BALL_BOUNCE;
  }
  if (ball.y < BALL_RADIUS) {
    ball.y = BALL_RADIUS;
    ball.vy = Math.abs(ball.vy) * BALL_BOUNCE;
  }

  collideBallWithNet(ball);
  collideBallWithBlob(ball, world.blobs[0]);
  collideBallWithBlob(ball, world.blobs[1]);
  capBallSpeed(ball);

  if (ball.y + BALL_RADIUS >= GROUND_Y) return ball.x < NET_X ? 'left' : 'right';
  return null;
}
