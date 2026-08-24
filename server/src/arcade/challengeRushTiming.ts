import { MEMORY_REVEAL_TOTAL_MS } from './challengeRushLogic';

interface ChallengeRushTimingEnv {
  NODE_ENV?: string;
  CHALLENGE_RUSH_FAST_TIMERS?: string;
  E2E_FAST_TIMERS?: string;
}

export interface ChallengeRushTiming {
  countdownMs: number;
  challengeDurationMs: number | null;
  memoryRevealMs: number;
  trafficLightGreenMs: number | null;
}

const CHALLENGE_RUSH_COUNTDOWN_MS = 5_000;

/**
 * Keeps production gameplay timings intact while allowing socket integration
 * and browser E2E suites to skip repeated reading delays. Socket tests also
 * shorten the overall challenge deadline; browser tests keep it real so
 * focus windows and preview phases cannot be cut off before the UI exercises
 * them. Both flags are ignored outside NODE_ENV=test.
 */
export function resolveChallengeRushTiming(env: ChallengeRushTimingEnv): ChallengeRushTiming {
  const useSocketTestTimers = env.NODE_ENV === 'test' && env.CHALLENGE_RUSH_FAST_TIMERS === '1';
  const useBrowserTestTimers = env.NODE_ENV === 'test' && env.E2E_FAST_TIMERS === '1';
  if (!useSocketTestTimers && !useBrowserTestTimers) {
    return {
      // A fresh task is announced before every mini-challenge. Five seconds
      // lets players read it while the answer-bearing playfield stays hidden.
      countdownMs: CHALLENGE_RUSH_COUNTDOWN_MS,
      challengeDurationMs: null,
      memoryRevealMs: MEMORY_REVEAL_TOTAL_MS,
      trafficLightGreenMs: null,
    };
  }
  if (useSocketTestTimers) return {
    countdownMs: 50,
    challengeDurationMs: 1_200,
    memoryRevealMs: 50,
    trafficLightGreenMs: 100,
  };
  return {
    countdownMs: 50,
    challengeDurationMs: null,
    memoryRevealMs: 50,
    trafficLightGreenMs: 100,
  };
}

export function challengeRushTiming(): ChallengeRushTiming {
  return resolveChallengeRushTiming(process.env);
}
