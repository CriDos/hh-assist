// Test queue: solving the selected jobs sequentially with pauses between
// tests. State lives in state (jobs/queueRunning/aborted).
//
// MV3 resilience: the jobs list and the queueRunning flag are persisted to
// storage.session on every change. The service worker can die mid-queue (idle
// kill, crash, memory pressure) — on restart background.js restores the jobs
// (restoreQueue) and starts the loop again (startLoop). The checkpoint in
// keepalive.js covers the test in flight; this persistence covers everything
// else that was silently lost before.

import { state } from './state.ts';
import { SolverJob } from '../types/solver.ts';
import { pushLog } from './log.ts';
import { ensureKeepAlive, clearCheckpoint } from './keepalive.ts';
import { getSettings, timingConfig } from '../core/settings.ts';
import { sleep, delayMs } from '../core/timing.ts';
import { resultVerdict } from '../core/result.ts';

let jobSeq = 0;
let storageWrite: Promise<any> = Promise.resolve();

export function resetQueueState(): void {
  jobSeq = 0;
  storageWrite = Promise.resolve();
}

export const QUEUE_KEY = 'hhQueue';

function appendJobEntries(jobs: SolverJob[]) {
  for (const job of jobs) {
    state.jobs.push({
      id: ++jobSeq,
      item: job.item,
      level: job.level,
      method: job.method,
      kind: job.kind,
      status: 'queued',
      progress: { number: 0, total: null },
      passed: null,
      correct: null,
      totalScore: null,
      message: ''
    });
  }
}

// Persist the jobs snapshot. Best-effort: storage failures must not break the
// queue (the in-memory state is the source of truth while the SW lives).
function persistQueue(): Promise<any> {
  const snapshot = {
    jobs: state.jobs.map(job => ({ ...job })),
    running: state.queueRunning
  };
  try {
    if (typeof (chrome.storage?.session as any)?.set !== 'function') return storageWrite;
    storageWrite = storageWrite
      .then(() => chrome.storage.session.set({ [QUEUE_KEY]: snapshot }))
      .catch(() => {});
  } catch {}
  return storageWrite;
}

function clearPersistedQueue(): Promise<any> {
  try {
    if (typeof (chrome.storage?.session as any)?.remove !== 'function') return storageWrite;
    storageWrite = storageWrite
      .then(() => chrome.storage.session.remove(QUEUE_KEY))
      .catch(() => {});
  } catch {}
  return storageWrite;
}

// Restore jobs persisted by a previous SW lifetime. Returns the stored
// snapshot or null when there is nothing to restore.
export async function restoreQueue(): Promise<any> {
  let stored: any;
  try {
    stored = await chrome.storage?.session?.get(QUEUE_KEY);
  } catch {
    return null;
  }
  const saved = stored?.[QUEUE_KEY];
  if (!saved || !Array.isArray(saved.jobs) || !saved.jobs.length) return null;
  state.jobs = saved.jobs.map((job: any) => ({ ...job }));
  // jobSeq restarts at 0 in a new SW lifetime — restored ids must not collide
  // with the ids of newly appended jobs (removeJob matches by id).
  jobSeq = Math.max(jobSeq, ...state.jobs.map(job => Number(job.id) || 0));
  return saved;
}

export interface CreateQueueOptions {
  startTest: (args: any) => Promise<any>;
  getRunningSolver: () => any;
}

export function createQueue({ startTest, getRunningSolver }: CreateQueueOptions) {
  let loopActive = false;
  let pauseController: AbortController | null = null;

  async function runLoop() {
    loopActive = true;
    try {
      while (!state.aborted && !state.queuePaused) {
        const next = state.jobs.find(job => job.status === 'queued');
        if (!next) break;
        next.status = 'running';
        persistQueue();
        try {
          const out = await startTest({
            item: next.item,
            level: next.level,
            method: next.method,
            kind: next.kind
          });
          if (out.status === 'aborted') {
            next.status = 'aborted';
            next.message = 'Выполнение прервано';
          } else if (out.status === 'finished') {
            next.status = 'done';
            next.passed = out.passed;
            next.correct = out.correct;
            next.totalScore = out.totalScore;
            // The card message mirrors the shared verdict: a block (no score
            // + failed + reason) gets the reason, a normal outcome — none.
            const verdict = out.res ? resultVerdict(out.res) : null;
            next.message = verdict
              ? verdict.status === 'blocked'
                ? verdict.label
                : ''
              : 'Результат не найден';
          }
          persistQueue();
        } catch (error: any) {
          next.status = 'error';
          next.message = String(error?.message || error);
          persistQueue();
          pushLog('error', `${next.item?.name}: ${next.message}`);
          // On critical LLM API failure, pause queue gracefully instead of cancelling remaining tests
          if (error?.code === 'LLM_API') {
            state.queuePaused = true;
            pushLog(
              'warn',
              'Очередь приостановлена из-за сбоя LLM API. Проверьте настройки или соединение и нажмите «Возобновить очередь».'
            );
            break;
          }
        }
        if (
          !state.aborted &&
          !state.queuePaused &&
          state.jobs.some(job => job.status === 'queued')
        ) {
          const settings = await getSettings();
          const nextKind = state.jobs.find(job => job.status === 'queued')?.kind || 'theory';
          const pauseMs = delayMs(timingConfig(settings, nextKind).betweenTests);
          // Abortable pause: Stop or pause interrupts the sleep via the signal
          await sleep(pauseMs, { signal: pauseController?.signal });
        }
      }
    } finally {
      loopActive = false;
      state.queueRunning = false;
      const persistence = state.jobs.some(
        job => job.status === 'queued' || job.status === 'running'
      )
        ? persistQueue()
        : clearPersistedQueue();
      await persistence;
      ensureKeepAlive();
      if (!state.aborted && !state.queuePaused) pushLog('info', 'Очередь завершена');
    }
  }

  return {
    startMany(jobs: any[]): Promise<any> {
      if (state.session && state.session.loggedIn === false) {
        pushLog('warn', 'Запуск отменён: вы не авторизованы на hh.ru');
        return Promise.resolve({ ok: false, error: 'not_authenticated' });
      }
      state.aborted = false;
      state.queuePaused = false;
      appendJobEntries(jobs);
      persistQueue();

      const plural = (count: number) =>
        count % 10 === 1 && count % 100 !== 11
          ? 'тест'
          : count % 10 >= 2 && count % 10 <= 4 && (count % 100 < 12 || count % 100 > 14)
            ? 'теста'
            : 'тестов';

      if (loopActive) {
        pushLog('info', `В очередь добавлено: ${jobs.length} ${plural(jobs.length)}`);
        ensureKeepAlive();
        if (pauseController?.signal.aborted) {
          pauseController = new AbortController();
        }
        return Promise.resolve({ ok: true });
      }

      state.queueRunning = true;
      clearCheckpoint();
      pauseController = new AbortController();
      ensureKeepAlive();
      return runLoop();
    },
    // Continue a restored queue (after SW restart): kicks the loop off unless
    // it is already running (one instance per SW lifetime).
    startLoop(): Promise<any> | null {
      if (loopActive) return null;
      if (!state.jobs.some(job => job.status === 'queued')) return null;
      state.queueRunning = true;
      state.queuePaused = false;
      // A restored loop needs its own abortable pause (startMany arms one for
      // fresh queues; on a restart the controller is gone).
      pauseController = new AbortController();
      ensureKeepAlive();
      return runLoop();
    },
    pause(): { ok: boolean } {
      if (!state.queueRunning || state.queuePaused) return { ok: false };
      state.queuePaused = true;
      pauseController?.abort();
      pushLog('warn', 'Очередь поставлена на паузу');
      persistQueue();
      return { ok: true };
    },
    resume(): Promise<{ ok: boolean; message?: string }> {
      if (state.session && state.session.loggedIn === false) {
        pushLog('warn', 'Возобновление отменено: вы не авторизованы на hh.ru');
        return Promise.resolve({ ok: false, message: 'Требуется авторизация на hh.ru' });
      }
      state.queuePaused = false;
      state.aborted = false;
      let hasQueued = state.jobs.some(job => job.status === 'queued');
      if (!hasQueued) {
        for (const job of state.jobs) {
          if (job.status === 'error' || job.status === 'aborted') {
            job.status = 'queued';
            job.progress = { number: 0, total: null };
            job.message = '';
            job.passed = null;
            job.correct = null;
            job.totalScore = null;
            hasQueued = true;
          }
        }
      }
      if (!hasQueued)
        return Promise.resolve({ ok: false, message: 'Нет тестов для возобновления' });
      persistQueue();
      state.queueRunning = true;
      pushLog('info', 'Очередь возобновлена');
      const loop = this.startLoop();
      return loop ? loop.then(() => ({ ok: true })) : Promise.resolve({ ok: true });
    },
    // SW-restart recovery helpers. A 'running' job survives a restart in two
    // shapes: the checkpoint resumed it (finishResumed marks it done) or the
    // tab is gone / resume failed (requeueRunning sends it back to 'queued').
    finishResumed(outcome: any): void {
      const job = state.jobs.find(entry => entry.status === 'running');
      if (!job) return;
      if (outcome?.status === 'aborted') {
        job.status = 'aborted';
        job.message = 'Выполнение прервано';
      } else {
        job.status = 'done';
        job.passed = outcome?.passed ?? null;
        job.correct = outcome?.correct ?? null;
        job.totalScore = outcome?.totalScore ?? null;
        job.message = 'Тест завершён (после восстановления)';
      }
      persistQueue();
    },
    requeueRunning(): void {
      let changed = false;
      for (const job of state.jobs) {
        if (job.status === 'running') {
          job.status = 'queued';
          job.progress = { number: 0, total: null };
          changed = true;
        }
      }
      if (changed) persistQueue();
    },
    abort(): void {
      state.aborted = true;
      state.queuePaused = false;
      pauseController?.abort();
      for (const job of state.jobs) {
        if (job.status === 'queued') {
          job.status = 'aborted';
          job.message = 'Отменено';
        }
      }
      persistQueue();
      getRunningSolver()?.abort();
      pushLog('warn', 'Очередь остановлена');
    },
    removeJob(id: number): { removed: boolean; id?: number; status?: string; running?: boolean } {
      // Remove a card from the queue: finished and queued ones. A running test
      // cannot be removed (stop via "Stop"/abort).
      const index = state.jobs.findIndex(job => job.id === id);
      if (index === -1) return { removed: false };
      const [job] = state.jobs.splice(index, 1);
      if (job.status === 'running') {
        state.jobs.splice(index, 0, job);
        return { removed: false, running: true };
      }
      const currentRun = state.run;
      if (
        currentRun &&
        String(currentRun.item?.id) === String(job.item?.id) &&
        currentRun.kind === job.kind
      ) {
        clearCheckpoint();
      }
      persistQueue();
      return { removed: true, id, status: job.status };
    },
    clearDone(): { ok: boolean; count: number } {
      const before = state.jobs.length;
      state.jobs = state.jobs.filter(
        job => job.status === 'running' || job.status === 'queued' || job.status === 'error'
      );
      const removed = before - state.jobs.length;
      if (removed > 0) persistQueue();
      return { ok: true, count: removed };
    },
    retryFailed(): { ok: boolean; count: number } {
      let count = 0;
      for (const job of state.jobs) {
        if (job.status === 'error' || job.status === 'aborted') {
          job.status = 'queued';
          job.progress = { number: 0, total: null };
          job.message = '';
          job.passed = null;
          job.correct = null;
          job.totalScore = null;
          count++;
        }
      }
      if (!count) return { ok: false, count: 0 };
      state.queuePaused = false;
      state.aborted = false;
      persistQueue();
      const loop = this.startLoop();
      loop?.catch((error: any) => pushLog('error', `Ошибка очереди: ${error.message}`));
      return { ok: true, count };
    }
  };
}
