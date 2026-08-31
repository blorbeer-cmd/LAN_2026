export const PONG_WIDTH = 960;
export const PONG_HEIGHT = 540;
export const PADDLE_WIDTH = 16;
export const PADDLE_HEIGHT = 112;
export const DOUBLES_PADDLE_HEIGHT = 80;
export const PADDLE_MARGIN = 48;
export const BALL_RADIUS = 12;

const PADDLE_SPEED = 430;
const BALL_START_SPEED = 390;
export const BALL_MAX_SPEED = 1200;
const BALL_RALLY_ACCELERATION = 15;
const BALL_HIT_ACCELERATION = 1.085;
const BALL_HIT_BOOST = 14;

export interface PongInput { up: boolean; down: boolean }
export type PongMode = 'duel' | 'doubles';
export type PongTeam = 'left' | 'right';
export type PongLane = 'full' | 'upper' | 'lower';
export interface PongPaddle {
  x: number;
  y: number;
  height: number;
  vy: number;
  team: PongTeam;
  lane: PongLane;
  playerId?: string;
}
export interface PongBall { x: number; y: number; vx: number; vy: number }
export interface PongWorld { paddles: PongPaddle[]; ball: PongBall }

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

export function createWorld(
  serveToward: PongTeam = 'right',
  mode: PongMode = 'duel',
  paddlePlayerIds: string[] = []
): PongWorld {
  const leftX = PADDLE_MARGIN;
  const rightX = PONG_WIDTH - PADDLE_MARGIN - PADDLE_WIDTH;
  const paddleHeight = mode === 'doubles' ? DOUBLES_PADDLE_HEIGHT : PADDLE_HEIGHT;
  const centerY = (PONG_HEIGHT - paddleHeight) / 2;
  const upperY = PONG_HEIGHT / 4 - paddleHeight / 2;
  const lowerY = PONG_HEIGHT * 3 / 4 - paddleHeight / 2;
  const paddles: PongPaddle[] = mode === 'doubles'
    ? [
        { x: leftX, y: upperY, height: paddleHeight, vy: 0, team: 'left', lane: 'upper' },
        { x: leftX, y: lowerY, height: paddleHeight, vy: 0, team: 'left', lane: 'lower' },
        { x: rightX, y: upperY, height: paddleHeight, vy: 0, team: 'right', lane: 'upper' },
        { x: rightX, y: lowerY, height: paddleHeight, vy: 0, team: 'right', lane: 'lower' },
      ]
    : [
        { x: leftX, y: centerY, height: paddleHeight, vy: 0, team: 'left', lane: 'full' },
        { x: rightX, y: centerY, height: paddleHeight, vy: 0, team: 'right', lane: 'full' },
      ];
  paddles.forEach((paddle, index) => {
    if (paddlePlayerIds[index]) paddle.playerId = paddlePlayerIds[index];
  });
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
  const minY = paddle.lane === 'lower' ? PONG_HEIGHT / 2 : 0;
  const maxY = paddle.lane === 'upper'
    ? PONG_HEIGHT / 2 - paddle.height
    : PONG_HEIGHT - paddle.height;
  paddle.vy = (input.down ? PADDLE_SPEED : 0) - (input.up ? PADDLE_SPEED : 0);
  paddle.y = clamp(paddle.y + paddle.vy * dt, minY, maxY);
}

export function pongPointScorerName(
  mode: PongMode,
  scoringTeam: PongTeam,
  players: Array<{ name: string; team: PongTeam }>
): string {
  if (mode === 'duel') {
    const scorer = players.find((player) => player.team === scoringTeam);
    if (scorer) return scorer.name;
  }
  return scoringTeam === 'left' ? 'Team Blau' : 'Team Pink';
}

function bounceFromPaddle(ball: PongBall, paddle: PongPaddle, direction: 1 | -1) {
  const paddleFront = direction === 1 ? paddle.x + PADDLE_WIDTH : paddle.x;
  const passedFront = direction === 1
    ? ball.x - BALL_RADIUS <= paddleFront && ball.x >= paddle.x
    : ball.x + BALL_RADIUS >= paddleFront && ball.x <= paddle.x + PADDLE_WIDTH;
  const overlapsY = ball.y + BALL_RADIUS >= paddle.y && ball.y - BALL_RADIUS <= paddle.y + paddle.height;
  const movingToward = direction === 1 ? ball.vx < 0 : ball.vx > 0;
  if (!passedFront || !overlapsY || !movingToward) return false;

  ball.x = paddleFront + direction * BALL_RADIUS;
  const offset = clamp((ball.y - (paddle.y + paddle.height / 2)) / (paddle.height / 2), -1, 1);
  const nextSpeed = Math.min(BALL_MAX_SPEED, Math.abs(ball.vx) * BALL_HIT_ACCELERATION + BALL_HIT_BOOST);
  ball.vx = direction * nextSpeed;
  ball.vy = clamp(offset * 340 + paddle.vy * 0.18, -BALL_MAX_SPEED * 0.78, BALL_MAX_SPEED * 0.78);
  limitBallSpeed(ball);
  return true;
}

function limitBallSpeed(ball: PongBall) {
  const speed = Math.hypot(ball.vx, ball.vy);
  if (speed <= BALL_MAX_SPEED || speed === 0) return;
  const scale = BALL_MAX_SPEED / speed;
  ball.vx *= scale;
  ball.vy *= scale;
}

function accelerateBall(ball: PongBall, dt: number) {
  const speed = Math.hypot(ball.vx, ball.vy);
  if (speed === 0 || speed >= BALL_MAX_SPEED) return;
  const scale = Math.min(BALL_MAX_SPEED, speed + BALL_RALLY_ACCELERATION * dt) / speed;
  ball.vx *= scale;
  ball.vy *= scale;
}

// Returns the scoring team, otherwise null.
export function stepWorld(world: PongWorld, inputs: PongInput[], dtSeconds: number): PongTeam | null {
  const dt = clamp(dtSeconds, 0, 0.05);
  world.paddles.forEach((paddle, index) => movePaddle(paddle, inputs[index] ?? { up: false, down: false }, dt));

  const ball = world.ball;
  accelerateBall(ball, dt);
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
