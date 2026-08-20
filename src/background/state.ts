import { CatalogItem, LevelData, MethodData } from '../types/proto.ts';

export interface ActiveRun {
  tabId: number;
  contestId?: number | string | null;
  item: CatalogItem;
  level: LevelData;
  kind: 'theory' | 'practice';
  solver?: any;
  progress?: { number: number; total: number | null };
  timeLeft?: number;
  timeLeftAt?: number;
  userId?: string | number;
  origin?: string;
  [key: string]: any;
}

export interface JobEntry {
  id: number;
  item: CatalogItem;
  level: LevelData;
  method: MethodData;
  kind: 'theory' | 'practice';
  status: 'queued' | 'running' | 'done' | 'error' | 'aborted';
  progress: { number: number; total: number | null };
  passed: boolean | null;
  correct: number | null;
  totalScore: number | null;
  message: string;
}

export interface LogEntry {
  level: string;
  message: string;
  ts: number;
}

export interface LlmLogEntry {
  id: string;
  at: number;
  status: string;
  taskId?: number;
  number?: number;
  attempt?: number;
  subType?: string;
  kind?: string;
  question?: string;
  response?: string | null;
  durationMs?: number;
  error?: string;
  history?: any[];
  system?: string;
  [key: string]: any;
}

export interface BackgroundState {
  run: ActiveRun | null;
  jobs: JobEntry[];
  queueRunning: boolean;
  queuePaused: boolean;
  aborted: boolean;
  ports: Map<string, chrome.runtime.Port>;
  logBuffer: LogEntry[];
  llmLog: LlmLogEntry[];
  session: any;
  hhOrigin: string;
}

export const state: BackgroundState = {
  run: null,
  jobs: [],
  queueRunning: false,
  queuePaused: false,
  aborted: false,
  ports: new Map(),
  logBuffer: [],
  llmLog: [],
  session: null,
  hhOrigin: 'https://hh.ru'
};

// Reset between tests: state is a module singleton, while tests re-import
// background.js with different query strings.
export function resetState(): void {
  state.run = null;
  state.jobs = [];
  state.queueRunning = false;
  state.queuePaused = false;
  state.aborted = false;
  state.ports.clear();
  state.logBuffer = [];
  state.llmLog = [];
  state.session = null;
  state.hhOrigin = 'https://hh.ru';
}
