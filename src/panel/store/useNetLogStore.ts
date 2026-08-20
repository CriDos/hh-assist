import { create } from 'zustand';
import { NetLogStatus, NetSession } from '../types/netlog';
import { send } from '../services/extension';

interface NetLogState {
  armed: boolean;
  archive: NetSession[];

  refreshNetLog: () => Promise<void>;
  toggleRecording: () => Promise<void>;
  clearArchive: () => Promise<void>;
  downloadSession: (id: string) => Promise<void>;
  downloadAll: () => Promise<void>;
}

export function formatTime(ms: number): string {
  const date = new Date(ms);
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.toLocaleDateString('ru-RU')} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

export function getSessionTestLabel(test?: NetSession['test']): string {
  if (!test) return 'тест';
  if (test.source === 'manual') return 'Вручную (браузер)';
  return [test.item?.name, test.level?.name, test.kind === 'theory' ? 'Теория' : 'Практика']
    .filter(Boolean)
    .join(' · ');
}

export function getSessionFileName(session: NetSession): string {
  const date = new Date(session.startedAt);
  const pad = (value: number) => String(value).padStart(2, '0');
  const stamp = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}_${pad(date.getHours())}-${pad(date.getMinutes())}`;
  const test = session.test || {};
  const name =
    test.source === 'manual'
      ? 'вручную'
      : [test.item?.name, test.level?.name, test.kind === 'theory' ? 'Теория' : 'Практика']
          .filter(Boolean)
          .join('-') || 'тест';
  return `hh-${stamp}-${name}.json`;
}

export const useNetLogStore = create<NetLogState>((set, get) => ({
  armed: false,
  archive: [],

  refreshNetLog: async () => {
    try {
      const status = await send<NetLogStatus>({ type: 'hh:netlog:get' });
      if (status) {
        set({ armed: Boolean(status.armed), archive: status.archive || [] });
      }
    } catch {}
  },

  toggleRecording: async () => {
    const nextState = !get().armed;
    await send({ type: 'hh:netlog:set', on: nextState });
    set({ armed: nextState });
    await get().refreshNetLog();
  },

  clearArchive: async () => {
    await send({ type: 'hh:netlog:archive:clear' });
    set({ archive: [] });
  },

  downloadSession: async (id: string) => {
    const session = await send<NetSession>({ type: 'hh:netlog:session:get', id });
    if (!session?.entries) return;
    const blob = new Blob([JSON.stringify(session, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = getSessionFileName(session);
    link.click();
    URL.revokeObjectURL(url);
  },

  downloadAll: async () => {
    const { archive, downloadSession } = get();
    if (!archive.length) return;
    for (const session of archive) {
      await downloadSession(session.id);
      await new Promise(r => setTimeout(r, 120));
    }
  }
}));
