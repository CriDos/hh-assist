import { create } from 'zustand';
import { LogEntry, LogFilter, LogLevel } from '../types/log';
import { send } from '../services/extension';

interface LogState {
  entries: LogEntry[];
  activeFilter: LogFilter;
  appendLog: (level: LogLevel, message: string, ts?: number) => void;
  setFilter: (filter: LogFilter) => void;
  loadHistory: () => Promise<void>;
  clearLog: () => Promise<void>;
  getFilteredEntries: () => LogEntry[];
}

export function matchesLogFilter(entry: LogEntry, filter: LogFilter): boolean {
  if (filter === 'all') return true;
  if (filter === 'info') return entry.level === 'info';
  if (filter === 'warn') return entry.level === 'warn';
  if (filter === 'error') return entry.level === 'error';
  if (filter === 'warn_error') return entry.level === 'warn' || entry.level === 'error';
  return true;
}

export const useLogStore = create<LogState>((set, get) => ({
  entries: [],
  activeFilter: 'all',

  appendLog: (level: LogLevel, message: string, ts?: number) => {
    const entry: LogEntry = { level: level || 'info', message, ts: ts || Date.now() };
    set(s => {
      const next = [...s.entries, entry];
      if (next.length > 1000) next.shift();
      return { entries: next };
    });
  },

  setFilter: (filter: LogFilter) => {
    set({ activeFilter: filter });
  },

  loadHistory: async () => {
    try {
      const result = await send<{ entries?: LogEntry[] }>({ type: 'hh:log:get' });
      if (result?.entries) {
        set({ entries: result.entries.slice(-1000) });
      }
    } catch {}
  },

  clearLog: async () => {
    set({ entries: [] });
    await send({ type: 'hh:log:clear' });
  },

  getFilteredEntries: () => {
    const { entries, activeFilter } = get();
    return entries.filter(e => matchesLogFilter(e, activeFilter));
  }
}));
