import { test, beforeEach, assert } from 'vitest';
import { state, resetState } from '../../src/background/state.ts';

beforeEach(() => {
  resetState();
});

test('state: initial state is empty', () => {
  assert.equal(state.run, null);
  assert.deepEqual(state.jobs, []);
  assert.equal(state.queueRunning, false);
  assert.equal(state.queuePaused, false);
  assert.equal(state.aborted, false);
  assert.equal(state.ports.size, 0);
  assert.deepEqual(state.logBuffer, []);
  assert.deepEqual(state.llmLog, []);
  assert.equal(state.session, null);
  assert.equal(state.hhOrigin, 'https://hh.ru');
});

test('state: resetState clears all state fields', () => {
  state.run = { tabId: 10 } as any;
  state.jobs = [{ id: '1' }] as any;
  state.queueRunning = true;
  state.queuePaused = true;
  state.aborted = true;
  state.ports.set('test', {} as any);
  state.logBuffer.push({ msg: 'hello' } as any);
  state.llmLog.push({ id: 'llm-1' } as any);
  state.session = { ok: true } as any;

  resetState();
  assert.equal(state.run, null);
  assert.deepEqual(state.jobs, []);
  assert.equal(state.queueRunning, false);
  assert.equal(state.queuePaused, false);
  assert.equal(state.aborted, false);
  assert.equal(state.ports.size, 0);
  assert.deepEqual(state.logBuffer, []);
  assert.deepEqual(state.llmLog, []);
  assert.equal(state.session, null);
});
