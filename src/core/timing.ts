// Solve timings (docs/plan.md §3.1). Uniform ~2-second intervals would be a
// suspicious pattern (docs/hh.md §8), so pauses are picked from ranges with
// random jitter. Values are configurable from the panel.

import { TimingsConfig } from '../types/settings';

export const DEFAULT_TIMING: TimingsConfig = {
  theory: {
    answerMinMs: 6000,
    answerMaxMs: 10000,
    betweenMinMs: 4000,
    betweenMaxMs: 8000
  },
  practice: {
    typingMinMs: 120000,
    typingMaxMs: 180000,
    retryTypingMinMs: 20000,
    retryTypingMaxMs: 30000
  },
  betweenTestsMinMs: 30000,
  betweenTestsMaxMs: 60000
};

export function randomBetween(min: number, max: number, rng = Math.random): number {
  if (max <= min) return min;
  return min + rng() * (max - min);
}

export function delayMs(range: { min: number; max: number }, rng = Math.random): number {
  return randomBetween(range.min, range.max, rng);
}

export interface SleepOptions {
  signal?: AbortSignal;
  rng?: () => number;
  jitter?: boolean;
}

// Sleep that can be interrupted via signal (abort/pause). Returns true when
// the sleep finished naturally, false when interrupted by the signal.
export function sleep(
  ms: number,
  { signal, rng = Math.random, jitter = true }: SleepOptions = {}
): Promise<boolean> {
  return new Promise(resolve => {
    if (signal?.aborted) return resolve(false);
    const duration = jitter
      ? Math.max(0, Math.floor(ms * (0.9 + rng() * 0.2)))
      : Math.max(0, Math.floor(ms));

    let timer: any = null;
    const cleanup = () => {
      if (typeof signal?.removeEventListener === 'function') {
        signal.removeEventListener('abort', onAbort);
      }
    };

    const onAbort = () => {
      clearTimeout(timer);
      cleanup();
      resolve(false);
    };

    timer = setTimeout(() => {
      cleanup();
      resolve(true);
    }, duration);

    signal?.addEventListener('abort', onAbort, { once: true });
    // Second check closes the race: abort between the first if and the subscription.
    if (signal?.aborted) {
      clearTimeout(timer);
      cleanup();
      resolve(false);
    }
  });
}
