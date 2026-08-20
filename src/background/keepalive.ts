// Keep-alive and checkpoint (MV3).
//
// The service worker can be killed by idle (~30 s) in the middle of a queue.
// 1) While work is running — an alarm every 12 s wakes the SW (an event
//    resets the idle timer; a single alarm run alone does not last beyond 30 s,
//    but frequent events — do).
// 2) A checkpoint goes into storage.session on each progress step; on SW
//    restart the checkpoint is restored: the test tab is still open (cookies
//    intact), and get_current_task returns the current (unsolved) question —
//    so solver.start() simply continues.

import { state } from './state.ts';

export const KEEP_ALIVE_ALARM = 'hh-keepalive';
export const CHECKPOINT_KEY = 'hhCheckpoint';

export function isWorkActive(): boolean {
  return Boolean(state.queueRunning || state.run);
}

export function ensureKeepAlive(): void {
  try {
    if (isWorkActive()) {
      (globalThis as any).chrome?.alarms?.create(KEEP_ALIVE_ALARM, { periodInMinutes: 0.5 });
    } else {
      (globalThis as any).chrome?.alarms?.clear(KEEP_ALIVE_ALARM);
    }
  } catch {}
}

(globalThis as any).chrome?.alarms?.onAlarm?.addListener((alarm: chrome.alarms.Alarm) => {
  if (alarm.name === KEEP_ALIVE_ALARM) ensureKeepAlive();
});

export function saveCheckpoint(): void {
  if (!state.run) return;
  const { tabId, item, level, kind, contestId } = state.run;
  const payload = {
    tabId,
    contestId,
    job: `${item?.name}:${level?.name}:${kind}`,
    item: { id: item?.id, name: item?.name },
    level: { name: level?.name },
    kind,
    savedAt: Date.now()
  };
  void (globalThis as any).chrome?.storage?.session
    ?.set({ [CHECKPOINT_KEY]: payload })
    .catch(() => {});
}

export function clearCheckpoint(): void {
  void (globalThis as any).chrome?.storage?.session?.remove(CHECKPOINT_KEY).catch(() => {});
}
