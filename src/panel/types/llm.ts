export type LlmFilter = 'all' | 'theory' | 'practice' | 'error';

export interface LlmHistoryMessage {
  role: string;
  content: string;
}

export interface LlmLogEntry {
  id: string | number;
  kind?: 'theory' | 'practice' | 'probe';
  item?: string;
  level?: string;
  number?: number;
  total?: number;
  attempt?: number;
  at?: number;
  durationMs?: number;
  status?: 'pending' | 'ok' | 'success' | 'error';
  error?: string;
  system?: string;
  question?: string;
  history?: LlmHistoryMessage[];
  response?: string;
}
