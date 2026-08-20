import { test, assert } from 'vitest';
import { DEFAULT_SYSTEM, buildTheoryMessages } from '../../src/prompts/theory.ts';

test('buildTheoryMessages passes the saved prompt and question as-is', () => {
  const messages = buildTheoryMessages(
    { systemPrompt: 'мой промпт' } as any,
    { kind: 'test', question: 'Вопрос: X\n\nВарианты ответа:\n1. A' } as any
  );
  assert.equal(messages.system, 'мой промпт');
  assert.equal(messages.user, 'Вопрос: X\n\nВарианты ответа:\n1. A');
});

test('buildTheoryMessages falls back to the default system prompt', () => {
  const messages = buildTheoryMessages(
    { systemPrompt: '' } as any,
    { kind: 'test', question: '?' } as any
  );
  assert.equal(messages.system, DEFAULT_SYSTEM);
});

test('default theory prompt fixes the output format and single choice', () => {
  assert.match(DEFAULT_SYSTEM, /ОДИН правильный вариант/);
  assert.match(DEFAULT_SYSTEM, /Ответ: <номер>/);
  assert.match(
    DEFAULT_SYSTEM,
    /ровно в две строки/,
    'ответ — строгий формат «Обоснование: …» + «Ответ: N»'
  );
  assert.match(DEFAULT_SYSTEM, /^Обоснование: /m, 'строка обоснования в шаблоне формата');
  assert.match(DEFAULT_SYSTEM, /^Ответ: 2$/m, 'пример: финальная строка «Ответ: 2»');
  assert.match(DEFAULT_SYSTEM, /без markdown-разметки/);
  assert.notMatch(
    DEFAULT_SYSTEM,
    /ничего больше не пиши: без текста варианта, без обоснования/,
    'обоснование больше не запрещено'
  );
});
