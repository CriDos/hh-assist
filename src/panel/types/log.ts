export type LogLevel = 'info' | 'warn' | 'error';
export type LogFilter = 'all' | 'info' | 'warn' | 'error' | 'warn_error';

export interface LogEntry {
  level: LogLevel;
  message: string;
  ts: number;
}
