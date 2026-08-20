import { create } from 'zustand';
import { LlmFilter, LlmLogEntry } from '../types/llm';
import { send } from '../services/extension';

interface LlmState {
  entries: LlmLogEntry[];
  selectedEntryId: string | number | null;
  activeFilter: LlmFilter;

  refreshLlm: () => Promise<void>;
  selectEntry: (id: string | number) => void;
  setFilter: (filter: LlmFilter) => void;
  clearHistory: () => Promise<void>;
  getActiveEntry: () => LlmLogEntry | null;
  getFilteredEntries: () => LlmLogEntry[];
  formatActiveContext: () => string;
  formatAllContext: () => string;
}

export function matchesLlmFilter(entry: LlmLogEntry, filter: LlmFilter): boolean {
  if (filter === 'theory') return entry.kind === 'theory';
  if (filter === 'practice') return entry.kind === 'practice';
  if (filter === 'error') return entry.status === 'error' || Boolean(entry.error);
  return true;
}

export function decodeHtmlEntities(str?: string): string {
  if (!str || typeof str !== 'string') return str || '';
  return str
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

export function formatSingleContext(entry?: LlmLogEntry | null): string {
  if (!entry) return '';
  const isProbe = entry.kind === 'probe';
  const kind = isProbe ? 'Проверка API' : entry.kind === 'theory' ? 'Теория' : 'Практика';
  const taskPrefix = entry.kind === 'theory' ? 'Вопрос' : 'Задача';
  const taskStr = entry.number
    ? `${taskPrefix} ${entry.number}${entry.total ? ` из ${entry.total}` : ''}`
    : '';
  const attemptPrefix = entry.kind === 'theory' ? 'повтор' : 'исправление';
  const attemptStr =
    entry.attempt && entry.attempt > 0 ? ` (${attemptPrefix} ${entry.attempt + 1})` : '';

  const testHeader = [entry.item || 'Без названия', entry.level, kind].filter(Boolean).join(' · ');
  return [
    `=== HH-ASSIST LLM CONTEXT ===`,
    `Тест: ${testHeader}${taskStr ? ` · ${taskStr}` : ''}${attemptStr}`,
    `Время: ${entry.at ? new Date(entry.at).toLocaleString('ru-RU') : ''}`,
    `Статус: ${entry.status || (entry.error ? 'error' : 'ok')} (${entry.durationMs ? `${(entry.durationMs / 1000).toFixed(1)}s` : '—'})`,
    `\n--- [SYSTEM PROMPT] ---\n${entry.system || '—'}`,
    `\n--- [USER PROMPT / CONVERSATION] ---\n${entry.history && entry.history.length > 0 ? entry.history.map(m => `[${m.role.toUpperCase()}]:\n${m.content}`).join('\n\n---\n\n') : entry.question || '—'}`,
    `\n--- [MODEL RESPONSE] ---\n${entry.response || entry.error || '—'}`
  ].join('\n');
}

export const useLlmStore = create<LlmState>((set, get) => ({
  entries: [],
  selectedEntryId: null,
  activeFilter: 'all',

  refreshLlm: async () => {
    try {
      const data = await send<{ entries?: LlmLogEntry[] }>({ type: 'hh:llmLog:get' });
      if (!data) return;
      const entries = Array.isArray(data.entries) ? data.entries : [];

      let activeId = get().selectedEntryId;
      if (activeId && !entries.some(e => e.id === activeId)) {
        activeId = null;
      }

      set({ entries, selectedEntryId: activeId });
    } catch {}
  },

  selectEntry: (id: string | number) => {
    const { selectedEntryId, entries } = get();
    const latestId = entries.length > 0 ? entries[entries.length - 1].id : null;
    if (selectedEntryId === id || id === latestId) {
      set({ selectedEntryId: null });
    } else {
      set({ selectedEntryId: id });
    }
  },

  setFilter: (filter: LlmFilter) => {
    set({ activeFilter: filter });
  },

  clearHistory: async () => {
    await send({ type: 'hh:llmLog:clear' });
    set({ entries: [], selectedEntryId: null });
  },

  getActiveEntry: () => {
    const { entries, selectedEntryId } = get();
    if (selectedEntryId) {
      const found = entries.find(e => e.id === selectedEntryId);
      if (found) return found;
    }
    return entries.length > 0 ? entries[entries.length - 1] : null;
  },

  getFilteredEntries: () => {
    const { entries, activeFilter } = get();
    return entries.filter(e => matchesLlmFilter(e, activeFilter));
  },

  formatActiveContext: () => {
    const active = get().getActiveEntry();
    return formatSingleContext(active);
  },

  formatAllContext: () => {
    const { entries } = get();
    if (!entries.length) return 'История запросов пуста.';
    return entries
      .map(
        (entry, index) =>
          `========================================================\n[#${index + 1}] ` +
          formatSingleContext(entry)
      )
      .join('\n\n');
  }
}));
