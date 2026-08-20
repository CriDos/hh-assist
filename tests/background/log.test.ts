import { test, beforeEach, assert } from 'vitest';
import { state, resetState } from '../../src/background/state.ts';
import {
  pushLog,
  broadcast,
  pushLlmLog,
  updateLatestLlmLog,
  resetLlmLog,
  llmLogWithSystem,
  LOG_LIMIT,
  LLM_LOG_LIMIT
} from '../../src/background/log.ts';
import { DEFAULT_SYSTEM, MULTIPLE_SYSTEM } from '../../src/prompts/theory.ts';
import { DEFAULT_CODE_SYSTEM } from '../../src/prompts/practice.ts';

beforeEach(() => {
  resetState();
  state.ports.clear();
});

test('log: pushLog adds entry, bounds buffer to LOG_LIMIT and broadcasts', () => {
  const messages: any[] = [];
  const mockPort: any = {
    postMessage: (msg: any) => messages.push(msg)
  };
  state.ports.set('p1', mockPort);

  const entry = pushLog('info', 'Test log message');
  assert.equal(entry.level, 'info');
  assert.equal(entry.message, 'Test log message');
  assert.equal(state.logBuffer.length, 1);
  assert.equal(messages.length, 1);
  assert.deepEqual(messages[0], {
    type: 'solver',
    event: { type: 'log', level: 'info', message: 'Test log message' }
  });

  // Exceed limit
  for (let i = 0; i < LOG_LIMIT + 20; i++) {
    pushLog('warn', `Log ${i}`);
  }
  assert.equal(state.logBuffer.length, LOG_LIMIT);
  assert.equal(state.logBuffer[LOG_LIMIT - 1].message, `Log ${LOG_LIMIT + 19}`);
});

test('log: broadcast swallows disconnected port errors', () => {
  const badPort: any = {
    postMessage: () => {
      throw new Error('disconnected');
    }
  };
  state.ports.set('bad', badPort);
  assert.doesNotThrow(() => broadcast({ hello: 'world' }));
});

test('log: pushLlmLog, updateLatestLlmLog and resetLlmLog maintain ring buffer', () => {
  const entry1 = pushLlmLog({ kind: 'theory', task: 'Question 1' });
  assert.ok(entry1.id.startsWith('llm-'));
  assert.equal(entry1.status, 'pending');
  assert.equal(state.llmLog.length, 1);

  updateLatestLlmLog({ status: 'done', response: 'Answer 42', latencyMs: 120 });
  assert.equal(state.llmLog[0].status, 'done');
  assert.equal(state.llmLog[0].response, 'Answer 42');
  assert.equal(state.llmLog[0].latencyMs, 120);

  // Fill over limit
  for (let i = 0; i < LLM_LOG_LIMIT + 10; i++) {
    pushLlmLog({ kind: 'practice', index: i });
  }
  assert.equal(state.llmLog.length, LLM_LOG_LIMIT);

  resetLlmLog();
  assert.equal(state.llmLog.length, 0);
});

test('log: llmLogWithSystem enriches log items with respective system prompts', () => {
  pushLlmLog({ kind: 'theory', subType: 'SINGLE', task: 'Q1' });
  pushLlmLog({ kind: 'theory', subType: 'MULTIPLE', task: 'Q2' });
  pushLlmLog({ kind: 'practice', task: 'Code 1' });

  // Default system prompts
  const defaultEnriched = llmLogWithSystem({});
  assert.equal(defaultEnriched[0].system, DEFAULT_SYSTEM);
  assert.equal(defaultEnriched[1].system, MULTIPLE_SYSTEM);
  assert.equal(defaultEnriched[2].system, DEFAULT_CODE_SYSTEM);

  // Custom system prompts from settings
  const customEnriched = llmLogWithSystem({
    systemPrompt: 'Custom Theory Prompt',
    codeSystemPrompt: 'Custom Practice Prompt'
  });
  assert.equal(customEnriched[0].system, 'Custom Theory Prompt');
  assert.equal(customEnriched[1].system, 'Custom Theory Prompt');
  assert.equal(customEnriched[2].system, 'Custom Practice Prompt');
});
