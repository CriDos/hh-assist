// report_data telemetry generation (docs/hh.md §5). Pure module.
//
// Format: {"data": [{"taskId", "type", "timestamp", "payload"}], "taskId"}.
// The extension sends a "clean" stream indistinguishable from the live client:
// type 8 (answer choice) after each theory submission, type 5 (editor input)
// during practice "code typing", and type 10 (heartbeat with a violation
// counter, always 0). The other types aren't generated — the page has its own
// anti-fraud, and we work via the API (docs/plan.md §3.3).

import { PROTO } from './proto.ts';
import { TelemetryEvent, TelemetryType } from '../types/telemetry';

// Timestamp like the live client's: local offset from UTC.
export function formatTimestamp(date = new Date()): string {
  const pad = (value: number) => String(value).padStart(2, '0');
  const offset = -date.getTimezoneOffset();
  const sign = offset >= 0 ? '+' : '-';
  const abs = Math.abs(offset);
  const base =
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    `T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
  return `${base}${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`;
}

export function makeEvent(
  taskId: number,
  type: TelemetryType | number,
  payload: unknown[],
  date = new Date()
): TelemetryEvent {
  return { taskId, type: type as TelemetryType, timestamp: formatTimestamp(date), payload };
}

// type 8 — answer choice (empty payload).
export function answerEvent(taskId: number, date = new Date()): TelemetryEvent {
  return makeEvent(taskId, PROTO.telemetry.types.chooseAnswer, [], date);
}

// type 5 — code editor input (payload [keypresses, deletes, duration ms], as
// in the live client — docs/hh.md §4.1). Distribution captured from a real
// session 2026-08-12: keys 0..2, deletes 0..1, duration 1..13 s.
export function codeEditedEvent(rng = Math.random): {
  type: number;
  payload: [number, number, number];
} {
  const keys = rng() < 0.3 ? 0 : rng() < 0.65 ? 1 : 2;
  const deletes = rng() < 0.5 ? 1 : 0;
  const duration = 1000 + Math.floor(rng() * 12000);
  return { type: PROTO.telemetry.types.codeEdited, payload: [keys, deletes, duration] };
}
