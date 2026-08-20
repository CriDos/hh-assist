import { create } from 'zustand';
import { JobItem, StatusResponse } from '../types/queue';
import { send } from '../services/extension';
import { useSessionStore } from './useSessionStore';

interface QueueState {
  status: string;
  configured: boolean;
  paused: boolean;
  jobs: JobItem[];
  timerDeadline: number | null;
  remainingSeconds: number | null;
  previousBusy: boolean;
  onIdleCallbacks: Array<() => void>;

  addOnIdleCallback: (cb: () => void) => void;
  refreshStatus: () => Promise<void>;
  tickTimer: () => void;
  pauseQueue: () => Promise<void>;
  resumeQueue: () => Promise<void>;
  clearDone: () => Promise<void>;
  removeJob: (id: string) => Promise<void>;
  abortRunning: () => Promise<void>;
}

export const useQueueStore = create<QueueState>((set, get) => ({
  status: 'idle',
  configured: true,
  paused: false,
  jobs: [],
  timerDeadline: null,
  remainingSeconds: null,
  previousBusy: false,
  onIdleCallbacks: [],

  addOnIdleCallback: cb => {
    set(s => {
      if (s.onIdleCallbacks.includes(cb)) return s;
      return { onIdleCallbacks: [...s.onIdleCallbacks, cb] };
    });
  },

  refreshStatus: async () => {
    try {
      const result = await send<StatusResponse>({ type: 'hh:status' });
      if (!result) return;

      if (result.session) {
        useSessionStore.getState().setSession(result.session);
      }

      const running = Boolean(result.run);
      let newDeadline: number | null = null;
      if (running && result.run?.timeLeft != null) {
        const serverDeadline = (result.run.timeLeftAt || Date.now()) + result.run.timeLeft * 1000;
        const currentDeadline = get().timerDeadline;
        if (currentDeadline == null || Math.abs(serverDeadline - currentDeadline) > 1500) {
          newDeadline = serverDeadline;
        } else {
          newDeadline = currentDeadline;
        }
      }

      const isRunning = result.status === 'running' || result.status === 'queued';
      const prevBusy = get().previousBusy;
      if (prevBusy && result.status === 'idle') {
        get().onIdleCallbacks.forEach(cb => {
          try {
            cb();
          } catch {}
        });
      }

      set({
        status: result.status || 'idle',
        configured: result.configured ?? true,
        paused: result.status === 'paused' || Boolean(result.paused),
        jobs: result.jobs || [],
        timerDeadline: newDeadline,
        previousBusy: isRunning,
        remainingSeconds: newDeadline
          ? Math.max(0, Math.floor((newDeadline - Date.now()) / 1000))
          : null
      });
    } catch {}
  },

  tickTimer: () => {
    const { timerDeadline } = get();
    if (!timerDeadline) {
      set({ remainingSeconds: null });
      return;
    }
    const remaining = Math.max(0, Math.floor((timerDeadline - Date.now()) / 1000));
    set({ remainingSeconds: remaining });
  },

  pauseQueue: async () => {
    await send({ type: 'hh:queue:pause' });
    await get().refreshStatus();
  },

  resumeQueue: async () => {
    await send({ type: 'hh:queue:resume' });
    await get().refreshStatus();
  },

  clearDone: async () => {
    await send({ type: 'hh:queue:clearDone' });
    await get().refreshStatus();
  },

  removeJob: async (id: string) => {
    const res = await send<{ removed?: boolean }>({ type: 'hh:jobs:remove', id });
    if (res?.removed) {
      await get().refreshStatus();
    }
  },

  abortRunning: async () => {
    await send({ type: 'hh:abort' });
    await get().refreshStatus();
  }
}));
