import { CatalogItem, LevelData, MethodData } from './proto';
import { FingerprintProfile } from './fingerprint';

export interface SolverJob {
  item: CatalogItem;
  level: LevelData;
  method: MethodData;
  kind: 'theory' | 'practice';
}

export interface ContestPayload {
  tabId: number;
  skillId: number | string;
  methodId: number | string;
  kind: 'theory' | 'practice';
  profile: FingerprintProfile;
  userId?: string | number;
  origin?: string;
  signal?: AbortSignal;
  job?: SolverJob;
  [key: string]: unknown;
}

export interface SolverVerdict {
  status: 'passed' | 'failed' | 'blocked' | 'no-score' | 'unknown';
  label: string;
  short: string;
}

export interface ParsedResultPage {
  known?: boolean;
  passed?: boolean | null;
  correct?: number | null;
  total?: number | null;
  reason?: string | null;
}
