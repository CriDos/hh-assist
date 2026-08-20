import { test, assert } from 'vitest';
import {
  buildTestPrompt,
  buildQuestion,
  parseAnswerResponse,
  buildCodePrompt,
  buildCodeQuestion,
  buildCodeFixPrompt,
  stripCodeFence,
  summarizeSmokeTests
} from '../../src/prompts/builder.ts';

const task: any = {
  taskId: 33555,
  title: 'Набор',
  description: 'Какой оператор выбирает данные?',
  subType: 'SINGLE',
  answers: [
    { answer: 'SELECT', uuid: 'u1', feature: 'false' },
    { answer: 'INSERT', uuid: 'u2', feature: 'false' },
    { answer: 'UPDATE', uuid: 'u3', feature: 'false' }
  ],
  media: []
};

test('buildTestPrompt: section, question and numbered options', () => {
  const prompt = buildTestPrompt(task, { section: 'SQL' });
  assert.match(prompt, /^Раздел: SQL\n/);
  assert.match(prompt, /Вопрос: Какой оператор выбирает данные\?/);
  assert.match(prompt, /Варианты ответа:\n1\. SELECT\n2\. INSERT\n3\. UPDATE/);
});

test('buildTestPrompt: section omitted when absent', () => {
  const prompt = buildTestPrompt(task);
  assert.notMatch(prompt, /Раздел:/);
  assert.match(prompt, /^Вопрос:/);
});

test('buildTestPrompt: media are announced but not included', () => {
  const withMedia = { ...task, media: [{ type: 'image' }] };
  const prompt = buildTestPrompt(withMedia);
  assert.match(prompt, /медиа-материалы \(1 шт\.\)/);
});

test('buildQuestion: kind test with subType and section', () => {
  const question = buildQuestion(task, { section: 'SQL' });
  assert.equal(question.kind, 'test');
  assert.equal(question.subType, 'SINGLE');
  assert.equal(question.section, 'SQL');
  assert.ok(question.question.includes('SELECT'));
});

test('parseAnswerResponse: single index', () => {
  assert.deepEqual(parseAnswerResponse('Ответ: 2. INSERT\nОбоснование: ок.', 3), { indexes: [1] });
  assert.deepEqual(
    parseAnswerResponse('Ответ: 1,3', 3),
    { indexes: [0] },
    'новый формат без пробелов'
  );
  assert.deepEqual(
    parseAnswerResponse('Ответ: <5>', 5),
    { indexes: [4] },
    'плейсхолдер со скобками'
  );
  assert.equal(parseAnswerResponse('Ответ: <номер>', 5), null, 'буквальный <номер> — не парсится');
});

test('parseAnswerResponse: always exactly one choice (first number wins)', () => {
  assert.deepEqual(parseAnswerResponse('Ответ: 1, 3\nОбоснование: оба.', 3), { indexes: [0] });
  assert.deepEqual(parseAnswerResponse('Ответ: 2-3', 3), { indexes: [1] });
  assert.deepEqual(parseAnswerResponse('Ответ: 3 (вариант 3 подходит лучше)', 3), { indexes: [2] });
});

test('parseAnswerResponse: multiple returns all numbers in order, deduped', () => {
  assert.deepEqual(parseAnswerResponse('Ответ: 1, 3\nОбоснование: оба.', 3, true), {
    indexes: [0, 2]
  });
  assert.deepEqual(parseAnswerResponse('Ответ: 3, 1, 2', 3, true), { indexes: [2, 0, 1] });
  assert.deepEqual(
    parseAnswerResponse('Ответ: 1, 1, 2', 3, true),
    { indexes: [0, 1] },
    'дубли отбрасываются'
  );
  assert.deepEqual(
    parseAnswerResponse('Ответ: 5, 1', 3, true),
    { indexes: [0] },
    'вне диапазона отбрасываются'
  );
  assert.deepEqual(
    parseAnswerResponse('Ответ: 1,3,5', 5, true),
    { indexes: [0, 2, 4] },
    'новый формат без пробелов'
  );
  assert.equal(parseAnswerResponse('Нет ответа', 3, true), null);
  assert.deepEqual(
    parseAnswerResponse('Ответ: 2', 3, false),
    { indexes: [1] },
    'SINGLE по-прежнему берёт первый'
  );
});

test('parseAnswerResponse: tolerates separators and spaces around the number', () => {
  assert.deepEqual(parseAnswerResponse('Ответ: 3', 3), { indexes: [2] });
});

test('parseAnswerResponse: reasoning before the final line is ignored', () => {
  const text = [
    'Вариант 1 не подходит: цикл for может не выполниться.',
    'Вариант 3 — то же самое, что while.',
    'do-while выполняется всегда хотя бы раз, поэтому:',
    'Ответ: 2'
  ].join('\n');
  assert.deepEqual(
    parseAnswerResponse(text, 3),
    { indexes: [1] },
    'финальная строка «Ответ: N» выигрывает'
  );
});

test('parseAnswerResponse: earlier Ответ: lines inside reasoning lose to the last one', () => {
  const text = [
    'Ответ: 1 — но это неверно, for может не выполниться.',
    'Рассмотрим вариант 2: do-while выполняется минимум один раз.',
    'Ответ: 2'
  ].join('\n');
  assert.deepEqual(parseAnswerResponse(text, 3), { indexes: [1] });
});

test('parseAnswerResponse: MULTIPLE with reasoning before the final line', () => {
  const text = [
    'Подходят варианты 1 и 3: они используют правильный синтаксис.',
    'Вариант 2 содержит ошибку компиляции.',
    'Ответ: 1,3'
  ].join('\n');
  assert.deepEqual(parseAnswerResponse(text, 5, true), { indexes: [0, 2] });
});

test('parseAnswerResponse: dedupes and drops out-of-range', () => {
  assert.deepEqual(parseAnswerResponse('Ответ: 2, 2, 5', 3), { indexes: [1] });
  assert.deepEqual(parseAnswerResponse('Ответ: 0, 99', 3), null);
});

test('parseAnswerResponse: no answer line yields null, numbers in reasoning ignored', () => {
  assert.equal(parseAnswerResponse('Обоснование: 2 правильный.', 3), null);
  assert.equal(parseAnswerResponse('', 3), null);
  assert.equal(parseAnswerResponse(null as any, 3), null);
  assert.equal(parseAnswerResponse('Я не знаю', 3), null);
});

test('parseAnswerResponse: bare «Ответ:» line reads the number from the next line', () => {
  assert.deepEqual(parseAnswerResponse('Обоснование: ок.\nОтвет:\n2', 3), { indexes: [1] });
  assert.deepEqual(parseAnswerResponse('Обоснование: ок.\nОтвет:\n\n2', 3), { indexes: [1] });
  assert.deepEqual(parseAnswerResponse('Обоснование: ок.\nОтвет:\n<3>', 3), { indexes: [2] });
  assert.deepEqual(parseAnswerResponse('Ответ:\n1, 3', 3, true), { indexes: [0, 2] });
  assert.equal(
    parseAnswerResponse('Обоснование: ок.\nОтвет:', 3),
    null,
    'no digit after the bare line — null'
  );
});

test('parseAnswerResponse: MULTIPLE joined with «и»/«and»', () => {
  assert.deepEqual(parseAnswerResponse('Ответ: 1 и 3', 3, true), { indexes: [0, 2] });
  assert.deepEqual(parseAnswerResponse('Ответ: 1, 2 и 3', 3, true), { indexes: [0, 1, 2] });
  assert.deepEqual(parseAnswerResponse('Ответ: 1 и 2 и 3', 3, true), { indexes: [0, 1, 2] });
  assert.deepEqual(parseAnswerResponse('Ответ: 2 and 4', 5, true), { indexes: [1, 3] });
  assert.deepEqual(
    parseAnswerResponse('Ответ: 1 и 3', 3),
    { indexes: [0] },
    'SINGLE still takes the first'
  );
});

test('parseAnswerResponse: reasoning echo without a digit is skipped in favour of the last digit line', () => {
  const text = ['Обоснование: рассмотрим варианты.', 'Ответ: вариант 2', 'Ответ: 1'].join('\n');
  assert.deepEqual(parseAnswerResponse(text, 3), { indexes: [0] });
});

const codeTask: any = {
  taskId: 39389,
  title: 'Фильтрация комментариев',
  taskDescription: {
    description: ['Разберите строки на поля.'],
    inputFormat: ['Строки вида itemID;token;message'],
    outputFormat: ['valid;XSS;SQL или invalid'],
    examples: [{ input: '1001;ABCDEFGHIJKL;comment', output: 'valid;clean;clean' }]
  },
  tests: {
    adminTests: [{ id: '12969', expectedOutput: 'valid;clean;clean' }],
    userTests: []
  },
  editor: { progLanguage: 'PHP' }
};

test('buildCodePrompt: first run has task, format, examples and template', () => {
  const prompt = buildCodePrompt(codeTask, {
    section: 'PHP',
    template: '<?php\nnamespace Solution;\n// ваш код'
  });
  assert.match(prompt, /^Раздел: PHP\n/);
  assert.match(prompt, /Задача: Фильтрация комментариев/);
  assert.match(prompt, /Формат ввода:/);
  assert.match(prompt, /Ожидаемый вывод:\nvalid;clean;clean/);
  assert.match(prompt, /Шаблонный код/);
  assert.match(prompt, /namespace Solution/);
  assert.notMatch(prompt, /Результаты последнего прогона/);
});

// Real SSR structure (docs/hh.md §4.1): the header/description are nested in task,
// editor/tests/taskCounter — on the top level of pageCertCode.
test('buildCodePrompt: nested SSR structure (task.*) is unwrapped', () => {
  const nested: any = {
    skillId: 231,
    taskId: 39548,
    task: {
      taskId: 39548,
      title: 'Подозрительные транзакции',
      taskDescription: {
        description: ['Три и более одинаковых сумм подряд.'],
        inputFormat: ['N', 'p1 p2 … pN'],
        outputFormat: ['true/false'],
        examples: [{ input: '3\n100 100 100', output: 'true' }]
      }
    },
    tests: { adminTests: [{ id: '14027', expectedOutput: 'true' }], userTests: [] },
    taskCounter: { current: 1, count: 3 },
    editor: { progLanguage: 'C_PLUS_PLUS', solutionText: 'c29sdXRpb24=' }
  };
  const prompt = buildCodePrompt(nested, { template: '#include <iostream>' });
  assert.match(prompt, /Задача: Подозрительные транзакции/);
  assert.match(prompt, /Три и более одинаковых сумм подряд\./);
  assert.match(prompt, /Ожидаемый вывод:\ntrue/);
  assert.match(prompt, /#include <iostream>/);
  assert.notMatch(prompt, /Задача: $/);
});

test('buildCodePrompt: SQL tasks include ddlScheme and table data, not expectedTable', () => {
  const sqlTask: any = {
    taskId: 39888,
    task: {
      taskId: 39888,
      title: 'Просмотр базы клиентов',
      taskDescription: {
        description: ['Выберите клиентов 18–24 лет.'],
        inputFormat: [],
        outputFormat: ['user_id', 'age'],
        ddlScheme:
          'CREATE TABLE users (\n  user_id INT PRIMARY KEY,\n  age INT,\n  city VARCHAR(100)\n);',
        tableDescriptions: [
          {
            tableName: 'users',
            records: [
              { user_id: '1', age: '22', city: 'Dubai' },
              { user_id: '2', age: '30', city: 'Moscow' }
            ]
          }
        ],
        expectedTable: { records: [{ user_id: '1', age: '22' }] }
      }
    },
    editor: { progLanguage: 'SQL', solutionText: '' }
  };
  const prompt = buildCodePrompt(sqlTask, {});
  assert.match(prompt, /Схема базы данных:/);
  assert.match(prompt, /CREATE TABLE users/);
  assert.match(prompt, /Данные таблиц:/);
  assert.match(prompt, /Таблица users:/);
  assert.match(prompt, /"user_id":"1"/);
  assert.notMatch(prompt, /expectedTable/, 'эталон результата в промпт не попадает');
  assert.notMatch(prompt, /Шаблонный код/, 'для SQL шаблона-кода нет (solutionText пуст)');
});

test('buildCodeFixPrompt: run results only, no task duplicate (chat history message)', () => {
  const result: any = {
    status: 'WRONG_ANSWER',
    smokeTests: {
      '12969': { passed: true, output: 'valid;clean;clean' },
      '12970': { passed: false, output: 'invalid' }
    }
  };
  const prompt = buildCodeFixPrompt(result, [
    { id: '12969', expectedOutput: 'valid;clean;clean' },
    { id: '12970', expectedOutput: 'valid;XSS;clean' }
  ]);
  assert.match(prompt, /Результаты последнего прогона тестов/);
  assert.match(prompt, /Тест 12969: PASSED/);
  assert.match(
    prompt,
    /Тест 12970: FAILED — фактический вывод: "invalid" \(ожидалось: "valid;XSS;clean"\)/
  );
  assert.match(prompt, /Исправь решение/);
  assert.notMatch(prompt, /Задача:/, 'условие не дублируется — оно в первом сообщении чата');
  assert.notMatch(prompt, /Шаблонный код/, 'шаблон не дублируется');
});

test('buildCodeFixPrompt: compile error (commonError) is fed back when no tests ran', () => {
  const result: any = {
    status: 'WRONG_ANSWER',
    smokeTests: {},
    invisibleTests: {},
    userTests: {},
    commonError:
      '# command-line-arguments\n./Runner.go:22:6: main redeclared in this block\n\t./Solution.go:3:6: other declaration of main\n'
  };
  const prompt = buildCodeFixPrompt(result, []);
  assert.match(prompt, /тесты не выполнялись \(код не собрался\)/);
  assert.match(prompt, /Ошибка сборки:/);
  assert.match(prompt, /main redeclared in this block/);
  assert.notMatch(
    prompt,
    /не добавляй точку входа/,
    'подсказка про main не нужна — текст компилятора сам говорит, что не так'
  );
  assert.notMatch(prompt, /func main\(\)/, 'без привязки к конкретному языку');
});

test('buildCodeQuestion: kind code with assembled text', () => {
  const question = buildCodeQuestion(codeTask, { section: 'PHP', template: '<?php' });
  assert.equal(question.kind, 'code');
  assert.match(question.question, /Задача: Фильтрация комментариев/);
});

test('stripCodeFence: unwraps fenced code and leaves clean code as-is', () => {
  assert.equal(stripCodeFence('```php\n<?php\nreturn 1;\n```'), '<?php\nreturn 1;');
  assert.equal(stripCodeFence('```\n<?php\nreturn 1;\n```'), '<?php\nreturn 1;');
  assert.equal(stripCodeFence('<?php\nreturn 1;'), '<?php\nreturn 1;');
});

test('stripCodeFence: multiline fenced code with language and surrounding whitespace', () => {
  const fenced =
    '```go\npackage main\n\nfunc GetTimeOfDay(hour int) string {\n\tswitch {\n\tcase hour >= 0 && hour <= 5:\n\t\treturn "Night"\n\tdefault:\n\t\treturn "Day"\n\t}\n}\n```';
  const expected =
    'package main\n\nfunc GetTimeOfDay(hour int) string {\n\tswitch {\n\tcase hour >= 0 && hour <= 5:\n\t\treturn "Night"\n\tdefault:\n\t\treturn "Day"\n\t}\n}';
  assert.equal(stripCodeFence(fenced), expected);
  assert.equal(stripCodeFence(`\n\n${fenced}\n\n`), expected, 'обрезка пробелов вокруг фенса');
});

test('stripCodeFence: long C++ code with empty lines on boundaries', () => {
  const code = [
    '#include <iostream>',
    '#include <vector>',
    '#include <algorithm>',
    '',
    'long long sum(const std::vector<long long>& values) {',
    '\tlong long total = 0;',
    '\tfor (const auto& v : values) total += v;',
    '\treturn total;',
    '}'
  ].join('\n');
  assert.equal(
    stripCodeFence(`\`\`\`c++\n\n${code}\n\n\`\`\``),
    `\n${code}\n`,
    'внутренние пустые строки сохраняются'
  );
  assert.equal(stripCodeFence(code), code, 'обычный код без фенса — как есть');
});

test('stripCodeFence: code with triple backticks inside string literals', () => {
  const code = [
    '#include <iostream>',
    '',
    'std::string quote = "```not a fence```";',
    '',
    'int main() { return 0; }'
  ].join('\n');
  assert.equal(stripCodeFence(`\`\`\`c++\n${code}\n\`\`\``), code);
  assert.equal(stripCodeFence(code), code);
});

test('stripCodeFence: fences that are not a full wrap stay untouched', () => {
  const partial = '```php\n<?php\nreturn 1;';
  assert.equal(stripCodeFence(partial), partial, 'незакрытый фенс — не трогаем');
  const inline = '```php```';
  assert.equal(stripCodeFence(inline), inline, 'однострочный фенс без кода — не трогаем');
  assert.equal(stripCodeFence(''), '', 'пустая строка');
  assert.equal(stripCodeFence(null as any), null, 'null проходит как есть');
});

test('stripCodeFence: code containing triple backticks inside string literals', () => {
  const codeWithTicks = 'const s = ````; // markdown-метка\nreturn 42;';
  assert.equal(stripCodeFence(codeWithTicks), codeWithTicks);
  const inner = 'let x = "```";\n\nconsole.log(x);\n\n/* конец */';
  assert.equal(stripCodeFence(`\`\`\`js\n${inner}\n\`\`\``), inner);
});

test('stripCodeFence: unicode-heavy code (Cyrillic comments, emoji in strings)', () => {
  const code =
    '// комментарий «ваш код» — удалить нельзя: это строка кода\nfunction f() {\n\treturn "Привет 👋";\n}';
  assert.equal(stripCodeFence(`\`\`\`javascript\n${code}\n\`\`\``), code);
  assert.equal(stripCodeFence(code), code);
});

test('stripCodeFence: CRLF line endings', () => {
  const fenced = '```python\r\nprint("hello")\r\nprint("world")\r\n```';
  assert.equal(stripCodeFence(fenced), 'print("hello")\nprint("world")');
});

test('stripCodeFence: empty code inside fence', () => {
  assert.equal(stripCodeFence('```php\n\n```'), '', 'пустой фенс с пустой строкой');
});

test('stripCodeFence: removes reasoning tags (<think>, <thought>)', () => {
  const reasoning =
    '<think>\nWe need to filter comments based on the condition.\n</think>\n```php\n<?php\nreturn 1;\n```';
  assert.equal(stripCodeFence(reasoning), '<?php\nreturn 1;');

  const pureReasoning =
    '<thought>\nJust returning clean code without fences.\n</thought>\npackage main\n\nfunc main() {}';
  assert.equal(stripCodeFence(pureReasoning), 'package main\n\nfunc main() {}');
});

test('stripCodeFence: extracts code block when model adds preamble or trailing notes', () => {
  const withPreamble =
    'Вот исправленное решение задачи:\n```python\ndef solution(x):\n    return x * 2\n```\nНадеюсь это поможет!';
  assert.equal(stripCodeFence(withPreamble), 'def solution(x):\n    return x * 2');
});

test('stripCodeFence: extracts multiple blocks and reorders directive blocks to the top while dropping outside text', () => {
  const multiBlock = [
    '```cpp',
    'std::vector<std::string>',
    'Solution::Processing::process(const std::vector<std::string>& lines) const {',
    '    return {};',
    '}',
    '```',
    '',
    'Для этого варианта потребуются дополнительные заголовки:',
    '',
    '```cpp',
    '#include <future>',
    '#include <thread>',
    '```',
    '',
    'Пояснение: ConcurrentDictionary заменено на локальные мапы.'
  ].join('\n');

  const expected = [
    '#include <future>',
    '#include <thread>',
    '',
    'std::vector<std::string>',
    'Solution::Processing::process(const std::vector<std::string>& lines) const {',
    '    return {};',
    '}'
  ].join('\n');

  assert.equal(stripCodeFence(multiBlock), expected);
});

test('summarizeSmokeTests: formats each test with expected output from adminTests', () => {
  const lines = summarizeSmokeTests({ smokeTests: { '1': { passed: false, output: '9' } } }, [
    { id: '1', expectedOutput: '2' }
  ]);
  assert.deepEqual(lines, ['- Тест 1: FAILED — фактический вывод: "9" (ожидалось: "2")']);
});

test('summarizeSmokeTests: SQL expectedTable feeds the oracle when adminTests lack expectedOutput', () => {
  const lines = summarizeSmokeTests(
    { smokeTests: { '1': { passed: false, output: '550000' } } },
    [],
    { records: [{ total_cost: 400000 }] }
  );
  assert.deepEqual(lines, [
    '- Тест 1: FAILED — фактический вывод: "550000" (ожидалось: "[{"total_cost":400000}]")'
  ]);
});

test('summarizeSmokeTests: passed SQL test gets no oracle', () => {
  const lines = summarizeSmokeTests(
    { smokeTests: { '1': { passed: true, output: '400000' } } },
    [],
    { records: [{ total_cost: 400000 }] }
  );
  assert.deepEqual(lines, ['- Тест 1: PASSED — фактический вывод: "400000"']);
});

test('summarizeSmokeTests: adminTests expectedOutput wins over expectedTable', () => {
  const lines = summarizeSmokeTests(
    { smokeTests: { '1': { passed: false, output: '9' } } },
    [{ id: '1', expectedOutput: '2' }],
    { records: [{ total_cost: 3 }] }
  );
  assert.deepEqual(lines, ['- Тест 1: FAILED — фактический вывод: "9" (ожидалось: "2")']);
});

test('summarizeSmokeTests: empty-string adminTests expectedOutput falls back to expectedTable', () => {
  const lines = summarizeSmokeTests(
    { smokeTests: { '1': { passed: false, output: '9' } } },
    [{ id: '1', expectedOutput: '' }],
    { records: [{ total_cost: 3 }] }
  );
  assert.deepEqual(lines, [
    '- Тест 1: FAILED — фактический вывод: "9" (ожидалось: "[{"total_cost":3}]")'
  ]);
});

test('summarizeSmokeTests: truncated oracle is marked as cut', () => {
  const lines = summarizeSmokeTests({ smokeTests: { '1': { passed: false, output: 'y' } } }, [], {
    records: [{ value: 'x'.repeat(2100) }]
  });
  assert.match(
    lines[0],
    /…\(обрезано\)"\)$/,
    'обрыв JSON помечается, модель не доверяет ему как полному'
  );
});

test('buildCodeFixPrompt: SQL expectedTable is fed as the oracle', () => {
  const result: any = {
    status: 'WRONG_ANSWER',
    smokeTests: { '1': { passed: false, output: '550000' } }
  };
  const prompt = buildCodeFixPrompt(result, [], { records: [{ total_cost: 400000 }] });
  assert.match(
    prompt,
    /Тест 1: FAILED — фактический вывод: "550000" \(ожидалось: "\[\{"total_cost":400000\}\]"\)/
  );
});
