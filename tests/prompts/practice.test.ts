import { test, assert } from 'vitest';
import { buildPracticeMessages, DEFAULT_CODE_SYSTEM } from '../../src/prompts/practice.ts';

test('buildPracticeMessages passes question and saved prompt as-is', () => {
  const messages = buildPracticeMessages(
    { codeSystemPrompt: 'мой промпт' } as any,
    { kind: 'code', question: 'Задача...' } as any
  );
  assert.equal(messages.system, 'мой промпт');
  assert.equal(messages.user, 'Задача...');
});

test('default code prompt demands the full file, specifies single code block and keeps the template', () => {
  assert.match(DEFAULT_CODE_SYSTEM, /ПОЛНЫЙ рабочий файл/);
  assert.match(DEFAULT_CODE_SYSTEM, /Не меняй сигнатуры/);
  assert.match(DEFAULT_CODE_SYSTEM, /ОДНОГО блока кода/);
  assert.match(DEFAULT_CODE_SYSTEM, /Не добавляй точку входа/);
  assert.match(DEFAULT_CODE_SYSTEM, /В НАЧАЛО файла/);
});
