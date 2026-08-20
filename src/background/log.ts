// Panel log and ports: the single point of push messages (buffer + broadcast)
// and copies of LLM request contexts.

import { state, LogEntry, LlmLogEntry } from './state.ts';
import { ensureKeepAlive } from './keepalive.ts';
import { getSettings } from '../core/settings.ts';
import { DEFAULT_SYSTEM, MULTIPLE_SYSTEM } from '../prompts/theory.ts';
import { DEFAULT_CODE_SYSTEM } from '../prompts/practice.ts';
import { APP_VERSION } from '../core/version.ts';

export const LOG_LIMIT = 500;

export function broadcast(message: any): void {
  for (const port of state.ports.values()) {
    try {
      port.postMessage(message);
    } catch {}
  }
}

export function pushLog(level: string, message: string): LogEntry {
  const entry: LogEntry = { level, message, ts: Date.now() };
  state.logBuffer.push(entry);
  if (state.logBuffer.length > LOG_LIMIT)
    state.logBuffer.splice(0, state.logBuffer.length - LOG_LIMIT);
  broadcast({ type: 'solver', event: { type: 'log', level, message } });
  return entry;
}

// The panel connects via the hh-panel port and gets log events in real time;
// it polls its status itself (hh:status every 2 s).
export function installPanelPorts(): void {
  chrome.runtime.onConnect.addListener(port => {
    if (port.name !== 'hh-panel') return;
    const portId = `${port.name}:${port.sender?.tab?.id ?? 'panel'}:${Math.random().toString(36).slice(2, 7)}`;
    state.ports.set(portId, port);
    port.onMessage.addListener((message: any) => {
      if (message?.type === 'ping') {
        ensureKeepAlive();
      }
    });
    port.onDisconnect.addListener(() => {
      state.ports.delete(portId);
    });
  });
}

// Copy of the request context for the "Log" and "LLM" tabs.
export const LLM_LOG_LIMIT = 500;

export function pushLlmLog(entry: Partial<LlmLogEntry>): LlmLogEntry {
  const record: LlmLogEntry = {
    id: entry.id || `llm-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    at: entry.at || Date.now(),
    status: entry.status || 'pending',
    ...entry
  };
  state.llmLog.push(record);
  if (state.llmLog.length > LLM_LOG_LIMIT)
    state.llmLog.splice(0, state.llmLog.length - LLM_LOG_LIMIT);
  broadcast({ type: 'solver', event: { type: 'llm-context', entry: record } });
  return record;
}

export function updateLatestLlmLog(patch: any = {}): void {
  if (!state.llmLog.length) return;
  // Match the latest pending entry matching taskId/number/attempt if provided
  let target: LlmLogEntry | null = null;
  if (patch.taskId !== undefined || patch.number !== undefined) {
    for (let i = state.llmLog.length - 1; i >= 0; i--) {
      const entry = state.llmLog[i];
      const matchTask = patch.taskId === undefined || entry.taskId === patch.taskId;
      const matchNumber = patch.number === undefined || entry.number === patch.number;
      const matchAttempt = patch.attempt === undefined || entry.attempt === patch.attempt;
      if (matchTask && matchNumber && matchAttempt && entry.status === 'pending') {
        target = entry;
        break;
      }
    }
  }
  if (!target) {
    target = state.llmLog[state.llmLog.length - 1];
  }
  Object.assign(target, patch);
  broadcast({ type: 'solver', event: { type: 'llm-response', entry: target } });
}

// Reset the buffer when starting fresh or requested by the user.
export function resetLlmLog(): void {
  state.llmLog = [];
}

// LLM request context for the panel: each entry gets the final system prompt
// that was actually sent with the request (the user one or the default for
// the task kind).
export function llmLogWithSystem(settings: any = {}): LlmLogEntry[] {
  return state.llmLog.map(entry => ({
    ...entry,
    system:
      entry.system ||
      (entry.kind === 'practice'
        ? settings.codeSystemPrompt || DEFAULT_CODE_SYSTEM
        : settings.systemPrompt ||
          (entry.subType === 'MULTIPLE' ? MULTIPLE_SYSTEM : DEFAULT_SYSTEM))
  }));
}

// Log header: what build it is and how it is configured. Async (needs
// settings), so it runs right after listeners are registered. No secrets —
// the API key is not logged.
export function pushLogHeader(): void {
  const manifest = chrome.runtime?.getManifest?.() || {};
  void getSettings()
    .then(settings => {
      const profile = settings.profiles?.find((p: any) => p.id === settings.profileId);
      const ver = manifest.version || APP_VERSION;
      const model = settings.model || '—';
      const profLabel = profile ? profile.label : 'Desktop Chrome';
      pushLog('info', `hh-assist v${ver} · Модель: ${model} · Профиль: ${profLabel}`);
    })
    .catch(() => {});
}
