export interface RpcMessage {
  type: string;
  id?: string | number;
  patch?: Record<string, unknown>;
  on?: boolean;
  jobs?: unknown[];
  baseUrl?: string;
  apiKey?: string;
  model?: string;
  reasoning?: string;
  [key: string]: unknown;
}

export interface SolverEvent {
  type: 'log' | 'llm-context' | 'llm-response' | 'status' | string;
  level?: 'info' | 'warn' | 'error';
  message?: string;
  ts?: number;
  [key: string]: unknown;
}
