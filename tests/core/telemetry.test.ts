import { test, assert } from 'vitest';
import {
  formatTimestamp,
  makeEvent,
  answerEvent,
  codeEditedEvent
} from '../../src/core/telemetry.ts';

test('formatTimestamp: local offset format like the live client', () => {
  const date = new Date(2026, 7, 11, 10, 15, 30);
  const stamp = formatTimestamp(date);
  assert.match(stamp, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2}$/);
  assert.ok(stamp.startsWith('2026-08-11T10:15:30'));
});

test('formatTimestamp: uses current time when no date provided', () => {
  const stamp = formatTimestamp();
  assert.match(stamp, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2}$/);
});

test('makeEvent: creates well-formed telemetry event structure', () => {
  const d = new Date(2026, 7, 14, 12, 0, 0);
  const evt = makeEvent(999, 10, [0], d);
  assert.equal(evt.taskId, 999);
  assert.equal(evt.type, 10);
  assert.deepEqual(evt.payload, [0]);
  assert.ok(evt.timestamp);
});

test('answerEvent: type 8 with empty payload', () => {
  const event = answerEvent(33555, new Date(2026, 7, 11, 10, 15, 30));
  assert.equal(event.type, 8);
  assert.equal(event.taskId, 33555);
  assert.deepEqual(event.payload, []);
  assert.ok(event.timestamp);
});

test('codeEditedEvent: type 5 with keys/delete/duration (gate shape)', () => {
  // Test lower boundary
  const minEvent = codeEditedEvent(() => 0.0);
  assert.equal(minEvent.type, 5);
  assert.deepEqual(minEvent.payload, [0, 1, 1000]);

  // Test middle distribution
  const midEvent = codeEditedEvent(() => 0.45);
  assert.equal(midEvent.type, 5);
  assert.deepEqual(midEvent.payload, [1, 1, 6400]);

  // Test upper boundary
  const maxEvent = codeEditedEvent(() => 0.99);
  assert.equal(maxEvent.type, 5);
  assert.deepEqual(maxEvent.payload, [2, 0, 12880]);
});

test('telemetry types match the live table', async () => {
  const { PROTO } = await import('../../src/core/proto.ts');
  const { telemetry } = PROTO;
  assert.equal(telemetry.types.chooseAnswer, 8);
  assert.equal(telemetry.types.heartBeat, 10);
  assert.equal(telemetry.types.failedToDetect, 9);
  assert.equal(telemetry.types.codeEdited, 5);
});
