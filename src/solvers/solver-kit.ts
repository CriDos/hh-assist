// Shared solver scaffolding (docs/plan.md §3.1): cancel signal, log emitter,
// API retries, heartbeat in report_data and pauses across timings.
// One instance per solver; the theory and practice business loops live in
// theory-solver.js / practice-solver.js.

import { sleep, delayMs } from '../core/timing.ts';
import { PROTO } from '../core/proto.ts';

// Default API retry limits if the solver did not supply its own.
const DEFAULT_API_RETRIES = 3;
const DEFAULT_API_BACKOFF_MS = 1500;

export interface SolverKitOptions {
  signal?: AbortController | AbortSignal;
  telemetry?: {
    heartbeat?: (taskId: number) => Promise<any>;
    report?: (taskId: number, events: any[]) => Promise<any>;
  };
  rng?: () => number;
  onEvent?: (event: any) => void;
  limits?: {
    apiRetries?: number;
    apiBackoffMs?: number;
    [key: string]: any;
  };
}

export function createSolverKit({
  signal, // AbortController (optional; otherwise its own is created)
  telemetry = {}, // { heartbeat(taskId), report(taskId, events) } — tab relay
  rng = Math.random,
  onEvent = () => {},
  limits = {} // { apiRetries, apiBackoffMs, ... } — per-solver limits
}: SolverKitOptions = {}) {
  const controller = signal instanceof AbortController ? signal : new AbortController();
  const abortSignal = controller.signal;
  const apiRetries = limits.apiRetries ?? DEFAULT_API_RETRIES;
  const apiBackoffMs = limits.apiBackoffMs ?? DEFAULT_API_BACKOFF_MS;

  const emit = (event: any) => {
    try {
      onEvent(event);
    } catch {}
  };
  const log = (level: string, message: string) => emit({ type: 'log', level, message });
  // Answer/code-edit telemetry goes through the tab relay; no-op when the
  // relay is missing (tests, install failure).
  const report = telemetry.report || (async () => {});

  // Heartbeat pump: ticks report_data (through the tab relay) while long work
  // (an LLM wait) is running. stop() breaks even a sleeping timer, so no
  // dangling awaits remain after the work finishes. The interval comes from
  // the timings (timingConfig always returns heartbeatMs); fallback — protocol.
  function heartbeatPump(taskId: number, ms: number = PROTO.telemetry.heartbeatMs) {
    const pumpController = new AbortController();
    const onAbort = () => pumpController.abort();
    abortSignal.addEventListener('abort', onAbort, { once: true });
    let stopped = false;
    (async () => {
      while (!stopped && !abortSignal.aborted) {
        await sleep(ms, { signal: pumpController.signal });
        if (stopped || abortSignal.aborted) break;
        try {
          if (telemetry.heartbeat) await telemetry.heartbeat(taskId);
        } catch {}
      }
    })();
    return () => {
      stopped = true;
      abortSignal.removeEventListener('abort', onAbort);
      pumpController.abort();
    };
  }

  async function withHeartbeat<T>(taskId: number, work: () => Promise<T>, ms?: number): Promise<T> {
    const stop = heartbeatPump(taskId, ms);
    try {
      return await work();
    } finally {
      stop();
    }
  }

  // API call with retries on transient errors (network, 429, 5xx).
  async function withApiRetries<T>(name: string, work: () => Promise<T>): Promise<T> {
    let attempt = 0;
    for (;;) {
      try {
        return await work();
      } catch (error: any) {
        const retriable =
          error?.status === undefined ||
          error.status === 429 ||
          error.status >= 500 ||
          error?.timedOut;
        if (attempt >= apiRetries || !retriable) throw error;
        attempt++;
        const backoff = apiBackoffMs * 2 ** (attempt - 1) * (0.8 + rng() * 0.4);
        log('warn', `${name}: ${error.message} — ретрай ${attempt}/${apiRetries}`);
        if (abortSignal.aborted) throw error;
        await sleep(backoff, { signal: abortSignal });
        if (abortSignal.aborted) throw error;
      }
    }
  }

  // Pause from the timings range. Returns false when aborted by the signal.
  async function pause(range: { min: number; max: number }): Promise<boolean> {
    return sleep(delayMs(range, rng), { signal: abortSignal });
  }

  // Time left in the contest — for the panel timer (the shared "all tasks" one).
  // Both solvers hit the same endpoint; no strict contract — a failing request
  // is silently skipped and only a valid value is emitted.
  async function emitTimeLeft(api: any) {
    try {
      const timeLeft = await api.getTimeLeft();
      if (timeLeft?.timeLeftSeconds != null)
        emit({ type: 'timeLeft', seconds: timeLeft.timeLeftSeconds });
    } catch {}
  }

  // Public solver tail: start(contest)/abort glued to the common run() and signal.
  function expose(run: (contest: any) => Promise<any>) {
    return {
      start(contest: any) {
        return run(contest);
      },
      abort() {
        controller.abort();
      }
    };
  }

  return {
    signal: abortSignal,
    emit,
    log,
    report,
    pause,
    emitTimeLeft,
    expose,
    withApiRetries,
    withHeartbeat,
    abort: () => controller.abort()
  };
}
