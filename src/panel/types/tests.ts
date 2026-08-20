export interface MethodValidity {
  state?: 'EFFECTIVE' | 'NONE' | string;
  validUntil?: string | null;
}

export interface MethodAvailability {
  status?: 'AVAILABLE' | 'TEMPORARY_UNAVAILABLE' | string;
  availableAt?: string | null;
}

export interface MethodData {
  id: number | string;
  name?: string;
  validity?: MethodValidity;
  availability?: MethodAvailability;
  [key: string]: unknown;
}

export interface LevelData {
  id: number | string;
  name: string;
  rank: number;
  theory?: MethodData;
  practice?: MethodData;
}

export interface CatalogItem {
  id: number | string;
  name: string;
  category?: string;
  levels: LevelData[];
}

export type TestFilter = 'all' | 'theory' | 'practice';
