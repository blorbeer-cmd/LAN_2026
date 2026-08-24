export interface ArcadeTimingEnvironment {
  NODE_ENV?: string;
  E2E_FAST_TIMERS?: string;
}

export interface ArcadeTiming {
  countdownMs: number;
}

// Real players must always see the complete 3-2-1 intro. Browser E2E runs
// may opt into a short synchronization delay, but only together with the
// explicit test environment so an accidentally configured production flag
// can never alter gameplay.
export function resolveArcadeTiming(env: ArcadeTimingEnvironment): ArcadeTiming {
  const useFastTimers = env.NODE_ENV === 'test' && env.E2E_FAST_TIMERS === '1';
  return { countdownMs: useFastTimers ? 50 : 3000 };
}

export const arcadeTiming = resolveArcadeTiming(process.env);
