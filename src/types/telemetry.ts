export const TELEMETRY_TYPES = {
  WINDOW_FOCUS_BLUR: 1,
  WINDOW_RESIZED: 2,
  CODE_PASTED: 3,
  CODE_COPIED: 4,
  CODE_EDITED: 5,
  TEXT_COPIED: 6,
  QUESTION_COPIED: 7,
  CHOOSE_ANSWER: 8,
  FAILED_TO_DETECT: 9,
  HEARTBEAT: 10
} as const;

export type TelemetryType = (typeof TELEMETRY_TYPES)[keyof typeof TELEMETRY_TYPES];

export interface TelemetryEvent {
  taskId: number;
  type: TelemetryType;
  timestamp: string;
  payload: unknown[];
}

export interface TelemetryReportBody {
  data: TelemetryEvent[];
  taskId?: number;
}
