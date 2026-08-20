export type JobStatus = 'queued' | 'running' | 'done' | 'error' | 'aborted';

export interface JobProgress {
  number?: number;
  total?: number;
  kind?: string;
}

export interface JobItem {
  id: string;
  name: string;
  level?: string;
  kind: 'theory' | 'practice';
  status: JobStatus;
  progress?: JobProgress;
  passed?: boolean;
  correct?: number;
  totalScore?: number;
  message?: string;
}

export interface RunData {
  timeLeft?: number;
  timeLeftAt?: number;
}

export interface StatusResponse {
  status?: string;
  configured?: boolean;
  run?: RunData;
  jobs?: JobItem[];
  session?: {
    loggedIn?: boolean;
    userId?: string | number;
    error?: boolean;
  };
  paused?: boolean;
}
