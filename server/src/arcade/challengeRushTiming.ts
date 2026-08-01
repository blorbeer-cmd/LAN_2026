import { MEMORY_REVEAL_TOTAL_MS } from './challengeRushLogic';

interface ChallengeRushTimingEnv {
  NODE_ENV?: string;
  CHALLENGE_RUSH_FAST_TIMERS?: string;
}

export interface ChallengeRushTiming {
  countdownMs: number;
  challengeDurationMs: number | null;
  memoryRevealMs: number;
  trafficLightGreenMs: number | null;
}

const CHALLENGE_RUSH_COUNTDOWN_MS = 5_000;

/**
 * Keeps production gameplay timings intact while allowing the socket-level
 * integration suite to exercise the same state machine without waiting for
 * every real countdown and challenge deadline. The dedicated flag is ignored
 * outside NODE_ENV=test so a production environment cannot enable it by
 * accident.
 */
export function resolveChallengeRushTiming(env: ChallengeRushTimingEnv): ChallengeRushTiming {
  const useFastTimers = env.NODE_ENV === 'test' && env.CHALLENGE_RUSH_FAST_TIMERS === '1';
  if (!useFastTimers) {
    return {
      // A fresh task is announced before every mini-challenge. Five seconds
      // lets players read it while the answer-bearing playfield stays hidden.
      countdownMs: CHALLENGE_RUSH_COUNTDOWN_MS,
      challengeDurationMs: null,
      memoryRevealMs: MEMORY_REVEAL_TOTAL_MS,
      trafficLightGreenMs: null,
    };
  }
  return {
    countdownMs: 50,
    challengeDurationMs: 1_200,
    memoryRevealMs: 50,
    trafficLightGreenMs: 100,
  };
}

export function challengeRushTiming(): ChallengeRushTiming {
  return resolveChallengeRushTiming(process.env);
}
