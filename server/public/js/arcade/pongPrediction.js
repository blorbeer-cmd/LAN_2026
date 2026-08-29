const MAX_PREDICTION_MS = 75;
const PREDICTION_STEP_SECONDS = 1 / 120;

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function paddleBounds(paddle, fieldHeight) {
  return {
    min: paddle.lane === 'lower' ? fieldHeight / 2 : 0,
    max: paddle.lane === 'upper' ? fieldHeight / 2 - paddle.height : fieldHeight - paddle.height,
  };
}

function bounceFromPaddle(ball, paddle, paddleWidth, ballRadius) {
  const direction = paddle.team === 'left' ? 1 : -1;
  const paddleFront = direction === 1 ? paddle.x + paddleWidth : paddle.x;
  const passedFront = direction === 1
    ? ball.x - ballRadius <= paddleFront && ball.x >= paddle.x
    : ball.x + ballRadius >= paddleFront && ball.x <= paddle.x + paddleWidth;
  const overlapsY = ball.y + ballRadius >= paddle.y && ball.y - ballRadius <= paddle.y + paddle.height;
  const movingToward = direction === 1 ? ball.vx < 0 : ball.vx > 0;
  if (!passedFront || !overlapsY || !movingToward) return false;
  ball.x = paddleFront + direction * ballRadius;
  ball.vx = direction * Math.abs(ball.vx);
  return true;
}

export function projectPongWorld(snapshot, elapsedMs) {
  if (!snapshot?.world) return null;
  const render = { width: 960, height: 540, paddleWidth: 16, ballRadius: 12, ...snapshot.render };
  const world = {
    ...snapshot.world,
    ball: { ...snapshot.world.ball },
    paddles: snapshot.world.paddles.map((paddle) => ({
      ...paddle,
      height: paddle.height ?? render.paddleHeight ?? 112,
    })),
  };
  if (!snapshot.running || snapshot.paused) return world;

  const predictedMs = clamp(elapsedMs, 0, MAX_PREDICTION_MS);
  const serverTime = Number(snapshot.serverTime) || 0;
  const rallyResumeAt = Number(snapshot.rallyResumeAt) || 0;
  let remaining = predictedMs / 1000;
  if (rallyResumeAt > serverTime) {
    remaining = Math.max(0, serverTime + predictedMs - rallyResumeAt) / 1000;
  }

  while (remaining > 0) {
    const dt = Math.min(remaining, PREDICTION_STEP_SECONDS);
    for (const paddle of world.paddles) {
      const bounds = paddleBounds(paddle, render.height);
      paddle.y = clamp(paddle.y + (paddle.vy ?? 0) * dt, bounds.min, bounds.max);
    }

    const ball = world.ball;
    ball.x += ball.vx * dt;
    ball.y += ball.vy * dt;
    if (ball.y < render.ballRadius) {
      ball.y = render.ballRadius;
      ball.vy = Math.abs(ball.vy);
    } else if (ball.y > render.height - render.ballRadius) {
      ball.y = render.height - render.ballRadius;
      ball.vy = -Math.abs(ball.vy);
    }
    for (const paddle of world.paddles) {
      if (bounceFromPaddle(ball, paddle, render.paddleWidth, render.ballRadius)) break;
    }
    remaining -= dt;
  }

  return world;
}
