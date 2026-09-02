export interface ArcadeTimingEnvironment {
  NODE_ENV?: string;
  E2E_FAST_TIMERS?: string;
  ARCADE_FAST_TIMERS?: string;
}

export interface ArcadeTiming {
  countdownMs: number;
  endRevealMs: number;
}

// Real players must always see the complete 3-2-1 intro and the full end
// reveal. Test runs may opt into short synchronization delays, but only
// together with the explicit test environment so an accidentally configured
// production flag can never alter gameplay.
//
// Two flag names feed the same switch. E2E_FAST_TIMERS comes from the browser
// suites. ARCADE_FAST_TIMERS is for the socket integration suite, which drives
// the same lobbies without a browser: it asserts on lobby gates, team
// assignment, scoring and leave/disconnect persistence, never on the countdown
// itself, so waiting out the production intro is pure runtime with no added
// fault detection. Both production values stay covered by timing.test.ts.
export function arcadeTestTimersEnabled(env: ArcadeTimingEnvironment): boolean {
  if (env.NODE_ENV !== 'test') return false;
  return env.E2E_FAST_TIMERS === '1' || env.ARCADE_FAST_TIMERS === '1';
}

export function resolveArcadeTiming(env: ArcadeTimingEnvironment): ArcadeTiming {
  const fastTimers = arcadeTestTimersEnabled(env);
  return {
    countdownMs: fastTimers ? 50 : 3000,
    endRevealMs: fastTimers ? 250 : 12_000,
  };
}

export const arcadeTiming = resolveArcadeTiming(process.env);
