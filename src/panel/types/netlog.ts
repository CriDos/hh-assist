export interface NetSessionTest {
  source?: 'manual' | string;
  item?: { name?: string };
  level?: { name?: string };
  kind?: 'theory' | 'practice';
}

export interface NetSession {
  id: string;
  startedAt: number;
  test?: NetSessionTest;
  truncated?: boolean;
  entries?: unknown[];
}

export interface NetLogStatus {
  armed: boolean;
  archive: NetSession[];
}
