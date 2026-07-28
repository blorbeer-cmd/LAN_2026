export const PONG_WIDTH = 960;
export const PONG_HEIGHT = 540;
export const PADDLE_WIDTH = 16;
export const PADDLE_HEIGHT = 112;
export const PADDLE_MARGIN = 48;
export const BALL_RADIUS = 12;

const PADDLE_SPEED = 430;
const BALL_START_SPEED = 390;
const BALL_MAX_SPEED = 900;
const BALL_HIT_ACCELERATION = 1.075;
const BALL_HIT_BOOST = 12;

export interface PongInput { up: boolean; down: boolean }
export type PongMode = 'duel' | 'doubles';
export type PongTeam = 'left' | 'right';
export interface PongPaddle { x: number; y: number; vy: number; team: PongTeam }
export interface PongBall { x: number; y: number; vx: number; vy: number }
export interface PongWorld { paddles: PongPaddle[]; ball: PongBall }

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

export function createWorld(serveToward: PongTeam = 'right', mode: PongMode = 'duel'): PongWorld {
  const leftX = PADDLE_MARGIN;
  const rightX = PONG_WIDTH - PADDLE_MARGIN - PADDLE_WIDTH;
  const centerY = (PONG_HEIGHT - PADDLE_HEIGHT) / 2;
  const upperY = PONG_HEIGHT / 4 - PADDLE_HEIGHT / 2;
  const lowerY = PONG_HEIGHT * 3 / 4 - PADDLE_HEIGHT / 2;
  const paddles: PongPaddle[] = mode === 'doubles'
    ? [
        { x: leftX, y: upperY, vy: 0, team: 'left' },
        { x: leftX, y: lowerY, vy: 0, team: 'left' },
        { x: rightX, y: upperY, vy: 0, team: 'right' },
        { x: rightX, y: lowerY, vy: 0, team: 'right' },
      ]
    : [
        { x: leftX, y: centerY, vy: 0, team: 'left' },
        { x: rightX, y: centerY, vy: 0, team: 'right' },
      ];
  return {
    paddles,
    ball: {
      x: PONG_WIDTH / 2,
      y: PONG_HEIGHT / 2,
      vx: serveToward === 'right' ? BALL_START_SPEED : -BALL_START_SPEED,
      vy: serveToward === 'right' ? -105 : 105,
    },
  };
}

function movePaddle(paddle: PongPaddle, input: PongInput, dt: number) {
  paddle.vy = (input.down ? PADDLE_SPEED : 0) - (input.up ? PADDLE_SPEED : 0);
  paddle.y = clamp(paddle.y + paddle.vy * dt, 0, PONG_HEIGHT - PADDLE_HEIGHT);
}

function bounceFromPaddle(ball: PongBall, paddle: PongPaddle, direction: 1 | -1) {
  const paddleFront = direction === 1 ? paddle.x + PADDLE_WIDTH : paddle.x;
  const passedFront = direction === 1
    ? ball.x - BALL_RADIUS <= paddleFront && ball.x >= paddle.x
    : ball.x + BALL_RADIUS >= paddleFront && ball.x <= paddle.x + PADDLE_WIDTH;
  const overlapsY = ball.y + BALL_RADIUS >= paddle.y && ball.y - BALL_RADIUS <= paddle.y + PADDLE_HEIGHT;
  const movingToward = direction === 1 ? ball.vx < 0 : ball.vx > 0;
  if (!passedFront || !overlapsY || !movingToward) return false;

  ball.x = paddleFront + direction * BALL_RADIUS;
  const offset = clamp((ball.y - (paddle.y + PADDLE_HEIGHT / 2)) / (PADDLE_HEIGHT / 2), -1, 1);
  const nextSpeed = Math.min(BALL_MAX_SPEED, Math.abs(ball.vx) * BALL_HIT_ACCELERATION + BALL_HIT_BOOST);
  ball.vx = direction * nextSpeed;
  ball.vy = clamp(offset * 340 + paddle.vy * 0.18, -BALL_MAX_SPEED * 0.78, BALL_MAX_SPEED * 0.78);
  return true;
}

// Returns the scoring team, otherwise null.
export function stepWorld(world: PongWorld, inputs: PongInput[], dtSeconds: number): PongTeam | null {
  const dt = clamp(dtSeconds, 0, 0.05);
  world.paddles.forEach((paddle, index) => movePaddle(paddle, inputs[index] ?? { up: false, down: false }, dt));

  const ball = world.ball;
  ball.x += ball.vx * dt;
  ball.y += ball.vy * dt;

  if (ball.y < BALL_RADIUS) {
    ball.y = BALL_RADIUS;
    ball.vy = Math.abs(ball.vy);
  } else if (ball.y > PONG_HEIGHT - BALL_RADIUS) {
    ball.y = PONG_HEIGHT - BALL_RADIUS;
    ball.vy = -Math.abs(ball.vy);
  }

  for (const paddle of world.paddles) {
    if (bounceFromPaddle(ball, paddle, paddle.team === 'left' ? 1 : -1)) break;
  }

  if (ball.x < -BALL_RADIUS) return 'right';
  if (ball.x > PONG_WIDTH + BALL_RADIUS) return 'left';
  return null;
}
