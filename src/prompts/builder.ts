// Builds the LLM prompt from an API task and parses the model response into
// answer indexes (docs/hh.md §4: task {description, answers[], subType}).
// Pure module: both the prompt and the parser are covered by tests.

import { TaskItem, CodeTaskAdminTest } from '../types/proto';

// Format like the old buildQuestion: optional section header, the question,
// numbered options. Numbering matches the system-prompt contract
// («Ответ: <номер варианта>. <текст дословно>»).
export function buildTestPrompt(task: TaskItem, { section = '' } = {}): string {
  const lines: string[] = [];
  if (section) lines.push(`Раздел: ${section}`);
  lines.push(`Вопрос: ${task.description}`);
  lines.push('Варианты ответа:');
  for (const [index, answer] of task.answers.entries()) {
    lines.push(`${index + 1}. ${answer.answer}`);
  }
  if (Array.isArray(task.media) && task.media.length > 0) {
    lines.push('');
    lines.push(`Приложены медиа-материалы (${task.media.length} шт.) — в тексте они недоступны.`);
  }
  return lines.join('\n');
}

export function buildQuestion(task: TaskItem, { section = '' } = {}) {
  return {
    kind: 'test',
    subType: task.subType,
    section,
    question: buildTestPrompt(task, { section })
  };
}

// Parse «Ответ: <номера>». Find the last answer line (Cyrillic or Latin
// prefix, any separators). Numbers are taken ONLY from the line "head" — the
// first run of digits with separators (commas/spaces, «и»/«and» joins); text
// after it (anything the model appended) is ignored, so digits in the
// explanation don't interfere. If the answer line is bare («Ответ:» alone),
// the number(s) are read from the next non-empty line. count — the number of
// options; out-of-range indexes are dropped. multiple=false (SINGLE): only
// the first number is returned. multiple=true (MULTIPLE): all numbers in
// order of appearance.
export function parseAnswerResponse(
  text: string,
  count: number,
  multiple = false
): { indexes: number[] } | null {
  if (typeof text !== 'string') return null;
  const extractNumberHead = (value: string) => {
    const head = (String(value || '').match(
      /^\s*<*\d+>?(?:(?:\s*,\s*|\s+(?:и|and)\s+|\s+)<*\d+>?)*\s*/iu
    ) || [''])[0];
    return [...head.matchAll(/\d+/g)].map(match => Number(match[0]));
  };
  // The LAST answer line wins: the reasoning comes BEFORE the final answer
  // (per the system prompt), so a «Ответ: 1 — не подходит» line inside the
  // reasoning must not override the final «Ответ: 2».
  const lines = text.split(/\r?\n/).map(item => item.trim());
  const PREFIX = /^(Ответ|Answer)\s*[:\.\-–—]?\s*/i;
  let lineIndex = -1;
  for (let index = lines.length - 1; index >= 0; index--) {
    const line = lines[index];
    if (!PREFIX.test(line)) continue;
    const tail = line.replace(PREFIX, '');
    // A candidate answer line: digits right after the prefix (angle-bracket
    // tolerance) or an empty tail (the number sits on the next line). Text
    // right after the prefix («Ответ: вариант 2») is a reasoning echo, not
    // the answer — keep searching backwards.
    if (extractNumberHead(tail).length || !tail.trim()) {
      lineIndex = index;
      break;
    }
  }
  if (lineIndex === -1) return null;
  const tail = lines[lineIndex].replace(PREFIX, '');

  // Numbers from the answer line: the head run of digits with separators,
  // plus «и»/«and»-joined continuations («1 и 3»).
  const numbers = extractNumberHead(tail);

  // A bare «Ответ:» line — the number(s) are on the next non-empty line.
  if (!numbers.length && lineIndex + 1 < lines.length) {
    for (let index = lineIndex + 1; index < lines.length; index++) {
      if (!lines[index]) continue;
      numbers.push(...extractNumberHead(lines[index]));
      break;
    }
  }

  const indexes = [...new Set(numbers.map(number => number - 1))].filter(
    index => index >= 0 && index < count
  );
  if (!indexes.length) return null;
  return { indexes: multiple ? indexes : [indexes[0]] };
}

// ---- Code tasks (practice, docs/hh.md §4.1) --------------------------------

// Fence without a language tag: no language in the section or the markup —
// the model infers it from the template and returns just the code.
const fenced = (value: string) => `\`\`\`\n${value}\n\`\`\``;

// Normalize the model response: strip reasoning blocks (<think>...</think>, <thought>...</thought>)
// and extract code from markdown fences ```[lang]\n...\n``` even if wrapped in
// preamble or explanations. Plain code is left as-is.
export function stripCodeFence(text: string): string {
  if (typeof text !== 'string') return text;

  // Strip reasoning blocks (<think>...</think>, <thought>...</thought>)
  const hasReasoning = /<\s*(?:think|thought)\b[^>]*>[\s\S]*?<\/\s*(?:think|thought)\s*>/i.test(
    text
  );
  const clean = hasReasoning
    ? text.replace(/<\s*(?:think|thought)\b[^>]*>[\s\S]*?<\/\s*(?:think|thought)\s*>/gi, '').trim()
    : text;

  // Parse all multiline markdown code blocks (```[lang]\n...\n```)
  const lines = clean.split(/\r?\n/);
  const blocks: string[][] = [];
  let inBlock = false;
  let currentBlock: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    if (!inBlock) {
      if (trimmed === '```' || (trimmed.startsWith('```') && !trimmed.slice(3).includes('`'))) {
        inBlock = true;
        currentBlock = [];
      }
    } else {
      if (trimmed === '```') {
        inBlock = false;
        blocks.push(currentBlock);
        currentBlock = [];
      } else {
        currentBlock.push(line);
      }
    }
  }

  // If valid fenced blocks found, extract code (ignoring any explanations outside blocks)
  if (blocks.length > 0) {
    if (blocks.length === 1) {
      return blocks[0].join('\n');
    }

    // Multiple blocks: check if any block consists solely of imports/includes/directives
    const isDirectiveBlock = (blockLines: string[]) => {
      const codeLines = blockLines
        .map(l => l.trim())
        .filter(l => l && !l.startsWith('//') && !l.startsWith('/*'));
      if (codeLines.length === 0) return false;
      return codeLines.every(l =>
        /^(?:#\s*include|import\s+|using\s+|from\s+|package\s+|require\b|require_once\b)/i.test(l)
      );
    };

    const directiveBlocks: string[][] = [];
    const bodyBlocks: string[][] = [];

    for (const b of blocks) {
      if (isDirectiveBlock(b)) {
        directiveBlocks.push(b);
      } else {
        bodyBlocks.push(b);
      }
    }

    // If we have separate directive block(s) and body block(s), place directives at the top
    if (directiveBlocks.length > 0 && bodyBlocks.length > 0) {
      const ordered = [...directiveBlocks, ...bodyBlocks];
      return ordered.map(b => b.join('\n')).join('\n\n');
    }

    // Otherwise concatenate all blocks in order
    return blocks.map(b => b.join('\n')).join('\n\n');
  }

  // If reasoning was stripped, return clean (or empty if text had only reasoning)
  if (hasReasoning) return clean;

  // Plain code without markup or reasoning — return as-is
  return text;
}

// Smoke-test run summary: test id → PASSED/FAILED + the actual output
// (expected from adminTests, if known). This is the fix feedback for the LLM.
// SQL tasks (docs/hh.md §4.1): adminTests carry no expectedOutput (the
// checker is table-based), but the reference result — expectedTable — is what
// the live client shows on the "Результат запроса" tab after a run: it is
// fed as the oracle for failed tests, so the model can fix the condition
// (dates/prices) instead of blind format tweaks.
export function summarizeSmokeTests(
  result: any,
  adminTests: CodeTaskAdminTest[] = [],
  expectedTable: any = null
): string[] {
  const smoke = result?.smokeTests || {};
  const expected = new Map(adminTests.map(test => [String(test.id), test.expectedOutput]));
  const lines: string[] = [];
  for (const [testId, item] of Object.entries(smoke) as [string, any][]) {
    const passed = Boolean(item?.passed);
    const output = String(item?.output ?? '')
      .replace(/\n/g, '\\n')
      .slice(0, 300);
    let expectedOutput: string | null | undefined = expected.get(String(testId));
    // SQL tasks may keep an empty-string expectedOutput field in adminTests
    // — treat it as missing, the oracle falls back to expectedTable.
    if ((expectedOutput == null || expectedOutput === '') && !passed) {
      const records = expectedTable?.records;
      expectedOutput = Array.isArray(records)
        ? JSON.stringify(records)
        : expectedTable && typeof expectedTable === 'object'
          ? JSON.stringify(expectedTable)
          : null;
    }
    let oracle = '';
    if (expectedOutput != null) {
      const text = String(expectedOutput).replace(/\n/g, '\\n');
      // A truncated oracle is broken JSON — mark it so the model does not
      // trust it as complete.
      oracle = ` (ожидалось: "${text.length > 2000 ? `${text.slice(0, 2000)}…(обрезано)` : text}")`;
    }
    lines.push(
      `- Тест ${testId}: ${passed ? 'PASSED' : 'FAILED'} — фактический вывод: "${output}"${oracle}`
    );
  }
  return lines;
}

// Code-task prompt — the first chat message for the task: task + template +
// examples. Follow-up iterations go as separate messages (buildCodeFixPrompt)
// through the chat history (llm.js) — the model returns the FULL fixed file.
// SSR shape (docs/hh.md §4.1): pageCertCode = { taskId, task: {title,
// taskDescription, ...}, tests, taskCounter, editor: {solutionText}, ... } —
// the title and description nest inside task; tests live at the top level.
export function buildCodePrompt(task: any, { section = '', template = '' } = {}): string {
  const inner = task?.task && typeof task.task === 'object' ? task.task : task;
  const description = inner?.taskDescription || {};
  const lines: string[] = [];
  if (section) lines.push(`Раздел: ${section}`);
  lines.push(`Задача: ${inner?.title || ''}`);
  const pushBlock = (label: string, values: any) => {
    if (Array.isArray(values) && values.length > 0) {
      lines.push('', label);
      lines.push(...values.map(String));
    }
  };
  pushBlock('Описание:', description.description);
  pushBlock('Формат ввода:', description.inputFormat);
  pushBlock('Формат вывода:', description.outputFormat);
  if (Array.isArray(description.examples) && description.examples.length > 0) {
    lines.push('', 'Примеры:');
    for (const [index, example] of description.examples.entries()) {
      lines.push(`Пример ${index + 1}:`);
      lines.push('Входные данные:', String(example?.input ?? ''));
      lines.push('Ожидаемый вывод:', String(example?.output ?? ''));
    }
  }
  // SQL tasks (docs/hh.md §4.1): the DB schema and test data live in
  // taskDescription, not in editor.solutionText (no code template). The live
  // client shows them on the "SQL schema" and "Tables" tabs.
  if (typeof description.ddlScheme === 'string' && description.ddlScheme.trim()) {
    lines.push('', 'Схема базы данных:');
    lines.push(fenced(description.ddlScheme.trim()));
  }
  if (Array.isArray(description.tableDescriptions) && description.tableDescriptions.length > 0) {
    lines.push('', 'Данные таблиц:');
    for (const table of description.tableDescriptions) {
      lines.push(`Таблица ${table?.tableName || '?'}:`);
      const records = Array.isArray(table?.records) ? table.records : [];
      if (records.length > 0) lines.push(JSON.stringify(records));
    }
  }
  if (template) {
    lines.push('', 'Шаблонный код (сохрани его структуру, заполни только места-заглушки):');
    lines.push(fenced(template));
  }
  return lines.join('\n');
}

// Fix message for the task chat history: the run results only, plus a note
// to return the full file. Task statement, template and examples were already
// in the first message — not duplicated (llm.js passes the whole history).
// On a build error there are no smoke tests at all — the feedback is the
// server commonError (compiler output, e.g. Go's "main redeclared"): without
// it the model fixes blindly and misses the same error.
export function buildCodeFixPrompt(
  result: any,
  adminTests: CodeTaskAdminTest[] = [],
  expectedTable: any = null
): string {
  const lines = ['Результаты последнего прогона тестов (решение не прошло все тесты):'];
  const smoke = summarizeSmokeTests(result, adminTests, expectedTable);
  if (smoke.length) {
    lines.push(...smoke);
  } else {
    lines.push('- тесты не выполнялись (код не собрался)');
  }
  const commonError = String(result?.commonError ?? '').trim();
  if (commonError) {
    lines.push('');
    lines.push('Ошибка сборки:');
    lines.push('```');
    lines.push(commonError.slice(0, 1000));
    lines.push('```');
  }
  lines.push('');
  lines.push(
    'Исправь решение с учётом ошибок выше и верни ПОЛНЫЙ итоговый файл целиком в одном блоке ```. Без пояснений и без текста снаружи блока.'
  );
  return lines.join('\n');
}

export function buildCodeQuestion(task: any, options = {}) {
  return {
    kind: 'code',
    question: buildCodePrompt(task, options)
  };
}
