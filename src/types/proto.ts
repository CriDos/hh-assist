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
  taskNumber?: number;
  estimatedTime?: number;
  availability?: MethodAvailability;
  validity?: MethodValidity;
  externalId?: string | null;
  trainingExternalId?: string | null;
  [key: string]: unknown;
}

export interface LevelData {
  id: number | string;
  internalId?: number | string;
  name: string;
  rank: number;
  theory?: MethodData;
  practice?: MethodData;
}

export interface CatalogItem {
  id: number | string;
  name: string;
  category?: 'SKILL' | 'LANG' | string;
  source?: string;
  levels: LevelData[];
}

export interface AnswerItem {
  answer: string;
  uuid: string;
  feature?: string;
  [key: string]: unknown;
}

export interface TaskItem {
  taskId: number;
  description: string;
  subType?: 'SINGLE' | 'MULTIPLE' | string;
  title?: string;
  answers: AnswerItem[];
  media?: unknown[];
}

export interface CodeTaskAdminTest {
  id: string;
  name?: string;
  input?: string;
  expectedOutput?: string;
}

export interface CodeTaskDescription {
  description?: string[];
  inputFormat?: string[];
  outputFormat?: string[];
  examples?: Array<{ input?: string; output?: string }>;
  ddlScheme?: string;
  tableDescriptions?: Array<{ tableName: string; records: Record<string, unknown>[] }>;
  expectedTable?: { records: Record<string, unknown>[] };
}

export interface CodeTaskDetail {
  taskId: number;
  title?: string;
  taskDescription?: CodeTaskDescription;
}

export interface CodeTaskData {
  skillId?: number;
  taskId: number;
  task?: CodeTaskDetail | { task: CodeTaskDetail };
  displayData?: { level?: number; tags?: string[] };
  tests?: {
    adminTests?: CodeTaskAdminTest[];
    userTests?: unknown[];
  };
  taskCounter?: { current: number; count: number };
  editor?: {
    progLanguage: string;
    solutionText: string;
  };
  timeLeftSeconds?: number;
  isTestTask?: boolean;
}

export interface SmokeTestItem {
  passed: boolean;
  output?: string;
  [key: string]: unknown;
}

export interface SubmitTaskResult {
  status:
    | 'ACCEPTED'
    | 'WRONG_ANSWER'
    | 'COMPILE_ERROR'
    | 'TIME_LIMIT_EXCEEDED'
    | 'RUNTIME_ERROR'
    | 'PROCESSING'
    | 'PENDING'
    | string;
  smokeTests?: Record<string, SmokeTestItem>;
  commonError?: string | null;
  [key: string]: unknown;
}

export interface ApiClient {
  getCurrentTask(): Promise<TaskItem | null>;
  getContestTasks(): Promise<{ contestTasks: number[] } | null>;
  getTimeLeft(): Promise<{ timeLeftSeconds: number } | null>;
  submitAnswer(taskId: number, userAnswerUuids: string[]): Promise<any>;
  postFinish(): Promise<{ redirectUri?: string } | null>;
  updateCode(taskId: number, code: string, lang: string, isBeta?: boolean): Promise<any>;
  submitTask(
    taskId: number,
    code: string,
    lang: string,
    submissionType: string,
    isBeta?: boolean
  ): Promise<{ submissionId: string | number }>;
  getSubmitTaskResult(
    submissionId: string | number,
    taskId: number,
    isSolution?: boolean
  ): Promise<SubmitTaskResult>;
}
