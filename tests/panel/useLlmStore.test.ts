import { test, assert, beforeEach } from 'vitest';
import {
  useLlmStore,
  matchesLlmFilter,
  decodeHtmlEntities,
  formatSingleContext
} from '../../src/panel/store/useLlmStore.ts';
import { LlmLogEntry } from '../../src/panel/types/llm.ts';

beforeEach(() => {
  useLlmStore.setState({
    entries: [],
    selectedEntryId: null,
    activeFilter: 'all'
  });
});

test('useLlmStore: matchesLlmFilter correctly filters entries', () => {
  const theoryEntry: LlmLogEntry = { id: '1', at: 100, status: 'success', kind: 'theory' };
  const practiceEntry: LlmLogEntry = { id: '2', at: 200, status: 'success', kind: 'practice' };
  const errorEntry: LlmLogEntry = {
    id: '3',
    at: 300,
    status: 'error',
    kind: 'theory',
    error: 'Fail'
  };

  assert.equal(matchesLlmFilter(theoryEntry, 'all'), true);
  assert.equal(matchesLlmFilter(theoryEntry, 'theory'), true);
  assert.equal(matchesLlmFilter(theoryEntry, 'practice'), false);
  assert.equal(matchesLlmFilter(theoryEntry, 'error'), false);

  assert.equal(matchesLlmFilter(practiceEntry, 'practice'), true);
  assert.equal(matchesLlmFilter(practiceEntry, 'theory'), false);

  assert.equal(matchesLlmFilter(errorEntry, 'error'), true);
  assert.equal(matchesLlmFilter(errorEntry, 'theory'), true);
});

test('useLlmStore: decodeHtmlEntities decodes special HTML chars', () => {
  assert.equal(
    decodeHtmlEntities('&lt;div&gt;&quot;test&quot; &amp; &nbsp;&#39;hello&#39;'),
    '<div>"test" &  \'hello\''
  );
  assert.equal(decodeHtmlEntities(''), '');
  assert.equal(decodeHtmlEntities(undefined), '');
});

test('useLlmStore: formatSingleContext formats context block with metadata', () => {
  const entry: LlmLogEntry = {
    id: 'llm-1',
    at: 1723500000000,
    status: 'success',
    kind: 'theory',
    item: 'Python',
    level: 'Базовый',
    number: 1,
    total: 10,
    system: 'Answer correctly',
    question: 'What is Python?',
    response: 'A programming language',
    durationMs: 1500
  };

  const text = formatSingleContext(entry);
  assert.match(text, /=== HH-ASSIST LLM CONTEXT ===/);
  assert.match(text, /Тест: Python · Базовый · Теория · Вопрос 1 из 10/);
  assert.match(text, /\[SYSTEM PROMPT\]/);
  assert.match(text, /Answer correctly/);
  assert.match(text, /\[USER PROMPT \/ CONVERSATION\]/);
  assert.match(text, /What is Python\?/);
  assert.match(text, /\[MODEL RESPONSE\]/);
  assert.match(text, /A programming language/);
});

test('useLlmStore: auto-follow mode and selection toggling', async () => {
  const entry1: LlmLogEntry = {
    id: 'llm-1',
    at: 100,
    status: 'success',
    kind: 'theory',
    item: 'Python'
  };
  const entry2: LlmLogEntry = {
    id: 'llm-2',
    at: 200,
    status: 'success',
    kind: 'theory',
    item: 'Python'
  };

  // Set entries
  useLlmStore.setState({ entries: [entry1], selectedEntryId: null });
  assert.equal(useLlmStore.getState().getActiveEntry()?.id, 'llm-1');

  // Next entry arrives, still in auto-follow
  useLlmStore.setState({ entries: [entry1, entry2], selectedEntryId: null });
  assert.equal(useLlmStore.getState().getActiveEntry()?.id, 'llm-2');

  // User explicitly selects entry 1
  useLlmStore.getState().selectEntry('llm-1');
  assert.equal(useLlmStore.getState().selectedEntryId, 'llm-1');
  assert.equal(useLlmStore.getState().getActiveEntry()?.id, 'llm-1');

  // User clicks entry 1 again -> toggles back to auto-follow (null)
  useLlmStore.getState().selectEntry('llm-1');
  assert.equal(useLlmStore.getState().selectedEntryId, null);
  assert.equal(useLlmStore.getState().getActiveEntry()?.id, 'llm-2');

  // User clicks latest entry -> stays/returns to auto-follow (null)
  useLlmStore.getState().selectEntry('llm-2');
  assert.equal(useLlmStore.getState().selectedEntryId, null);
  assert.equal(useLlmStore.getState().getActiveEntry()?.id, 'llm-2');
});

test('useLlmStore: formatAllContext combines all entries', () => {
  assert.equal(useLlmStore.getState().formatAllContext(), 'История запросов пуста.');

  const entry1: LlmLogEntry = {
    id: 'llm-1',
    at: 100,
    status: 'success',
    kind: 'theory',
    item: 'Python',
    question: 'Q1'
  };
  const entry2: LlmLogEntry = {
    id: 'llm-2',
    at: 200,
    status: 'success',
    kind: 'practice',
    item: 'SQL',
    question: 'Q2'
  };
  useLlmStore.setState({ entries: [entry1, entry2] });

  const all = useLlmStore.getState().formatAllContext();
  assert.match(all, /\[#1\]/);
  assert.match(all, /\[#2\]/);
  assert.match(all, /Python/);
  assert.match(all, /SQL/);
});
