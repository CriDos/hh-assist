import { test, assert, expect } from 'vitest';
import { createPracticeSolver, PRACTICE_SOLVER_LIMITS } from '../../src/solvers/practice-solver.ts';
import { base64ToUtf8, utf8ToBase64 } from '../../src/core/api.ts';

const delays = {
  answer: { min: 1, max: 2 },
  between: { min: 1, max: 2 },
  betweenTests: { min: 1, max: 2 },
  typing: { min: 2, max: 2 },
  retryTyping: { min: 2, max: 2 },
  heartbeatMs: 20000
};

function makeTaskPage(taskId: number, number: number, count: number) {
  return {
    skillId: 3750,
    taskId,
    task: {
      taskId,
      title: `Задача ${taskId}`,
      taskDescription: {
        description: ['Реализуйте функцию.'],
        inputFormat: ['Целое число'],
        outputFormat: ['Результат'],
        examples: [{ input: '1', output: '2' }]
      }
    },
    tests: { adminTests: [{ id: '1', expectedOutput: '2' }], userTests: [] },
    taskCounter: { current: number, count },
    editor: { progLanguage: 'PHP', solutionText: utf8ToBase64('<?php\n// ваш код\n') },
    timeLeftSeconds: 120
  };
}

function pageHtml(task: any) {
  return `<template class="AssessmentFront-InitialState">${JSON.stringify({ pageCertCode: task })}</template>`;
}

function finalHtml() {
  return `<template class="SkillsFront-InitialState">${JSON.stringify({
    applicantContestResultPage: {
      desktopUiLayout: { score: { max: 4, actual: 4 }, contestResultStatus: 'SUCCESS' }
    }
  })}</template>`;
}

function createHarness({
  pages = [] as string[],
  llmResponses = [] as string[],
  parseResult = undefined as any,
  customDelays = undefined as any
} = {}) {
  const events: any[] = [];
  const queue = [...pages];
  const order: string[] = [];
  const llmCalls: any[] = [];
  const api: any = {
    updateCode: async (taskId: number, code: string, lang: string) => {
      order.push('update');
      api.updateCalls = (api.updateCalls || 0) + 1;
      api.updateCodes = api.updateCodes || [];
      api.updateCodes.push({ taskId, code, lang });
      return {};
    },
    submitTask: async (taskId: number, code: string, lang: string, submissionType: string) => {
      order.push(`submit:${submissionType}`);
      api.submits.push({ taskId, code, lang, submissionType });
      return { submissionId: `s${api.submits.length}` };
    },
    getSubmitTaskResult: async (submissionId: string, taskId: number, isSolution: boolean) => {
      api.results.push({ submissionId, taskId, isSolution });
      const next = api.resultQueue.shift();
      return next ?? { smokeTests: {}, status: 'ACCEPTED' };
    },
    getTimeLeft: async () => {
      api.timeLeftCalls = (api.timeLeftCalls || 0) + 1;
      const next = api.timeLeftQueue?.shift();
      return next ?? { timeLeftSeconds: 900 };
    },
    submits: [] as any[],
    results: [] as any[],
    resultQueue: [] as any[],
    timeLeftQueue: [] as any[]
  };
  const telemetry: any = {
    report: async (taskId: number, pending: any[]) => {
      order.push('report');
      telemetry.reports = telemetry.reports || [];
      telemetry.reports.push({ taskId, pending });
    },
    heartbeat: async () => {}
  };
  const signal = new AbortController();
  const parseResultImpl = parseResult || (() => ({ passed: true, correct: 4, total: 4 }));
  const wrappedParse: any = (html: string) => {
    wrappedParse.called = true;
    return parseResultImpl(html);
  };
  const solver = createPracticeSolver({
    api,
    config: { baseUrl: 'https://api.test/v1', apiKey: 'k', model: 'm' },
    llm: async (_config: any, question: any) => {
      llmCalls.push({ messages: [...(question.messages || [])] });
      return llmResponses.shift() ?? '<?php\nreturn 1;';
    },
    delays: customDelays || delays,
    signal,
    section: 'PHP',
    onEvent: (event: any) => events.push(event),
    fetchPage: async () => ({ status: 200, html: queue.shift() ?? finalHtml() }),
    parseResult: wrappedParse,
    telemetry
  });
  return { solver, api, signal, events, parseResult: wrappedParse, telemetry, order, llmCalls };
}

test('practice-solver: happy path solves tasks via check/full and finishes with result', async () => {
  const { solver, api, events, parseResult, telemetry, order } = createHarness({
    pages: [pageHtml(makeTaskPage(101, 1, 2)), pageHtml(makeTaskPage(102, 2, 2))]
  });

  const result = await solver.start('contest-code');

  assert.equal(result.status, 'finished');
  assert.deepEqual(result.result, { passed: true, correct: 4, total: 4 });
  assert.equal(api.submits.length, 4, 'check+full на каждую задачу');
  assert.equal(
    api.updateCalls,
    4,
    'update_code: автосохранение во время печати + финальное, на каждую задачу'
  );

  const [check1, full1] = api.submits;
  assert.equal(check1.submissionType, 'check');
  assert.equal(full1.submissionType, 'full');
  assert.equal(check1.lang, 'PHP');
  assert.equal(base64ToUtf8(check1.code), '<?php\nreturn 1;', 'код в base64 = ответ модели');
  assert.equal(full1.code, check1.code);

  assert.equal(telemetry.reports.length, 10, 'по 5 пачек type 5 на каждую задачу');
  const [first] = telemetry.reports;
  assert.equal(first.taskId, 101);
  assert.equal(first.pending.length, 1);
  const [edited] = first.pending;
  assert.equal(edited.type, 5);
  assert.equal(edited.payload.length, 3);
  assert.ok(telemetry.reports.every((r: any) => r.pending.length === 1 && r.pending[0].type === 5));
  assert.ok(api.updateCodes.every((entry: any) => entry.code === utf8ToBase64('<?php\nreturn 1;')));
  assert.deepEqual(order.slice(0, 7), [
    'report',
    'update',
    'report',
    'report',
    'report',
    'report',
    'update'
  ]);

  assert.equal(events.find(event => event.type === 'started').contest, 'contest-code');
  assert.equal(events.filter(event => event.type === 'task').length, 2);
  assert.equal(
    events.filter(event => event.type === 'code-checked' && event.status === 'ACCEPTED').length,
    2
  );
  assert.equal(events.filter(event => event.type === 'code-submitted').length, 2);
  assert.ok(parseResult.called);
});

test('practice-solver: timeLeft emitted at task start and after each check run', async () => {
  const { solver, api, events } = createHarness({
    pages: [pageHtml(makeTaskPage(221, 1, 1))]
  });
  api.timeLeftQueue = [{ timeLeftSeconds: 1000 }, { timeLeftSeconds: 987 }];

  const result = await solver.start('timer');

  assert.equal(result.status, 'finished');
  const timeLeft = events.filter(event => event.type === 'timeLeft');
  assert.deepEqual(
    timeLeft.map(event => event.seconds),
    [1000, 987],
    'замер в начале задачи и после прогона тестов'
  );
});

test('practice-solver: update_code gets the untrimmed code, submit the trimmed one', async () => {
  const { solver, api, telemetry } = createHarness({
    pages: [pageHtml(makeTaskPage(501, 1, 1))],
    llmResponses: ['\n<?php\nreturn 42;\n']
  });

  const result = await solver.start('trim');
  assert.equal(result.status, 'finished');

  const raw = utf8ToBase64('\n<?php\nreturn 42;\n');
  assert.deepEqual(
    api.updateCodes[0],
    { taskId: 501, code: raw, lang: 'PHP' },
    'update_code — нетримленный код'
  );
  assert.equal(
    base64ToUtf8(api.submits[0].code),
    '<?php\nreturn 42;',
    'post_submit_task — тримленный код'
  );
  assert.equal(telemetry.reports[0].pending[0].type, 5, 'type 5 — только ввод, без кода');
});

test('practice-solver: failed check feeds results back to LLM and retries until ACCEPTED', async () => {
  const bad = { smokeTests: { '1': { passed: false, output: '9' } }, status: 'WRONG_ANSWER' };
  const good = { smokeTests: { '1': { passed: true, output: '2' } }, status: 'ACCEPTED' };
  const { solver, api, events, llmCalls } = createHarness({
    pages: [pageHtml(makeTaskPage(201, 1, 1))]
  });
  api.resultQueue.push(bad, good);

  const result = await solver.start('fix-loop');

  assert.equal(result.status, 'finished');
  assert.equal(api.submits.length, 3, 'check(плохо) + check(ок) + full');
  assert.equal(api.submits[0].submissionType, 'check');
  assert.equal(api.submits[1].submissionType, 'check');
  assert.equal(api.submits[2].submissionType, 'full');

  assert.equal(llmCalls.length, 2);
  const [first, second] = llmCalls;
  assert.equal(first.messages.length, 1, 'первый вызов: только user-условие');
  assert.match(first.messages[0].content, /Задача: /);
  assert.equal(second.messages.length, 3, 'второй вызов: user + assistant-код + результаты');
  assert.equal(second.messages[1].role, 'assistant');
  assert.equal(second.messages[1].content, '<?php\nreturn 1;');
  assert.equal(second.messages[2].role, 'user');
  assert.match(second.messages[2].content, /Результаты последнего прогона тестов/);
  assert.notMatch(second.messages[2].content, /Задача: /, 'условие в фиксе не дублируется');

  const contexts = events.filter(event => event.type === 'llm-context');
  assert.equal(contexts.length, 2);
  assert.equal(contexts[0].history.length, 1, 'снимок 1-го вызова: только условие');
  assert.equal(contexts[1].history.length, 3, 'снимок 2-го вызова: условие + код + результаты');
  assert.deepEqual(contexts[1].history[1], { role: 'assistant', content: '<?php\nreturn 1;' });
  assert.equal(contexts[0].history.length, 1, 'снимок 1-го не мутировался последующими вызовами');

  const checked = events.filter(event => event.type === 'code-checked');
  assert.equal(checked[0].status, 'WRONG_ANSWER');
  assert.deepEqual(checked[0], {
    type: 'code-checked',
    taskId: 201,
    number: 1,
    attempt: 0,
    status: 'WRONG_ANSWER',
    total: 1,
    passed: 0,
    failed: 1,
    error: null
  });
  assert.equal(checked[1].status, 'ACCEPTED');
  const logs = events.filter(event => event.type === 'log' && event.level === 'warn');
  assert.ok(logs.some(log => /не прошли/.test(log.message)));
});

test('practice-solver: compile error (commonError) is named in the warn log and fed to LLM', async () => {
  const bad = {
    smokeTests: {},
    invisibleTests: {},
    userTests: {},
    status: 'WRONG_ANSWER',
    commonError:
      '# command-line-arguments\n./Runner.go:22:6: main redeclared in this block\n\t./Solution.go:3:6: other declaration of main\n'
  };
  const good = { smokeTests: { '1': { passed: true, output: 'ok' } }, status: 'ACCEPTED' };
  const { solver, api, events } = createHarness({
    pages: [pageHtml(makeTaskPage(401, 1, 1))]
  });
  api.resultQueue.push(bad, good);

  await solver.start('compile-error');

  const logs = events.filter(event => event.type === 'log' && event.level === 'warn');
  assert.ok(
    logs.some(log => /ошибка сборки: .*main redeclared/.test(log.message)),
    'лог называет причину: ' + JSON.stringify(logs.map(l => l.message))
  );

  const contexts = events.filter(event => event.type === 'llm-context');
  const fixMessage = contexts[1].history[2];
  assert.equal(fixMessage.role, 'user');
  assert.match(fixMessage.content, /Ошибка сборки:/);
  assert.match(fixMessage.content, /main redeclared in this block/);
  assert.notMatch(
    fixMessage.content,
    /не добавляй точку входа/,
    'подсказка про main не нужна — текст компилятора сам говорит, что не так'
  );
  assert.notMatch(fixMessage.content, /func main\(\)/, 'без привязки к конкретному языку');
});

test('practice-solver: LLM failure (e.g. empty exhausted in llm.js) aborts the run', async () => {
  const queue = [pageHtml(makeTaskPage(601, 1, 1))];
  const api: any = {
    updateCode: async () => {},
    submitTask: async () => {
      throw new Error('must not be called');
    },
    getSubmitTaskResult: async () => {
      throw new Error('must not be called');
    }
  };
  const signal = new AbortController();
  const collected: any[] = [];
  const solver = createPracticeSolver({
    api,
    config: { baseUrl: 'https://api.test/v1', apiKey: 'k', model: 'm' },
    llm: async () => {
      throw new Error('Пустой ответ модели');
    },
    delays,
    signal,
    section: 'PHP',
    onEvent: (event: any) => collected.push(event),
    fetchPage: async () => ({
      status: 200,
      html: queue.shift() ?? '<template class="SkillsFront-InitialState"></template>'
    }),
    parseResult: () => ({ passed: true, correct: 4, total: 4 })
  });
  await expect(solver.start('empty-llm')).rejects.toThrow(/Пустой ответ модели/);
  assert.equal(
    collected.some(
      event => event.type === 'log' && event.level === 'warn' && /переспрашиваю/.test(event.message)
    ),
    false,
    'пустой ответ переспрашивает llm.js, солвер не логирует переспросы'
  );
});

test('practice-solver: exhausted fix attempts skip the task and continue', async () => {
  const bad = { smokeTests: { '1': { passed: false, output: '9' } }, status: 'WRONG_ANSWER' };
  const zeroDelays = {
    answer: { min: 0, max: 0 },
    between: { min: 0, max: 0 },
    betweenTests: { min: 0, max: 0 },
    typing: { min: 0, max: 0 },
    retryTyping: { min: 0, max: 0 },
    heartbeatMs: 20000
  };
  const { solver, api, events } = createHarness({
    pages: [pageHtml(makeTaskPage(301, 1, 2)), pageHtml(makeTaskPage(302, 2, 2))],
    customDelays: zeroDelays
  });
  for (let i = 0; i < PRACTICE_SOLVER_LIMITS.maxFixAttempts + 1; i++) api.resultQueue.push(bad);

  const result = await solver.start('exhausted-skip');

  assert.equal(result.status, 'finished', 'контест не прерывается, а переходит к следующей задаче');
  assert.equal(api.submits.length, PRACTICE_SOLVER_LIMITS.maxFixAttempts + 4);
  const skipFull = api.submits[PRACTICE_SOLVER_LIMITS.maxFixAttempts + 1];
  assert.equal(skipFull.submissionType, 'full', 'последняя попытка уходит финальной отправкой');
  assert.equal(base64ToUtf8(skipFull.code), '<?php\nreturn 1;');
  assert.equal(api.results[PRACTICE_SOLVER_LIMITS.maxFixAttempts + 1].isSolution, true);

  const submitted = events.filter(event => event.type === 'code-submitted');
  assert.equal(submitted.length, 2);
  assert.equal(submitted[0].skipped, true);
  assert.equal(submitted[1].skipped, undefined, 'обычная сдача без флага пропуска');
  assert.equal(events.filter(event => event.type === 'code-skipping').length, 1);
  const warnings = events.filter(event => event.type === 'log' && event.level === 'warn');
  assert.ok(warnings.some(event => /пропускаю задачу/.test(event.message)));
});

test('practice-solver: SQL expectedTable feeds the fix prompt as the oracle', async () => {
  const bad = { smokeTests: { '1': { passed: false, output: '550000' } }, status: 'WRONG_ANSWER' };
  const taskPage = makeTaskPage(401, 1, 1);
  (taskPage.task.taskDescription as any).expectedTable = { records: [{ total_cost: 400000 }] };
  taskPage.tests.adminTests = [{ id: '1', name: 'Пример 1' } as any];
  const { solver, api, llmCalls } = createHarness({ pages: [pageHtml(taskPage)] });
  api.resultQueue.push(bad, {
    smokeTests: { '1': { passed: true, output: '400000' } },
    status: 'ACCEPTED'
  });

  const result = await solver.start('sql-oracle');

  assert.equal(result.status, 'finished');
  assert.equal(llmCalls.length, 2, 'первая попытка + фикс');
  const fixMessage = llmCalls[1].messages[2];
  assert.equal(fixMessage.role, 'user');
  assert.match(
    fixMessage.content,
    /ожидалось: "\[\{"total_cost":400000\}\]"/,
    'эталон результата попадает в фикс-промпт для SQL'
  );
});

test('practice-solver: contest finished when page has no task SSR', async () => {
  const { solver, events } = createHarness({ pages: [] });
  const result = await solver.start('empty-contest');
  assert.equal(result.status, 'finished');
  assert.deepEqual(result.result, { passed: true, correct: 4, total: 4 });
  assert.equal(events.filter(event => event.type === 'task').length, 0);
});

test('practice-solver: finish log follows the verdict, not the raw status', async () => {
  const ok = createHarness({
    parseResult: () => ({ passed: true, correct: 4, total: 4, reason: 'SUCCESS' })
  });
  await ok.solver.start('log-ok');
  const okLogs = ok.events.filter(event => event.type === 'log' && event.level === 'info');
  assert.ok(
    okLogs.some(log => /Контест завершён: навык подтверждён \(4 из 4\)/.test(log.message)),
    'SUCCESS + passed must log «навык подтверждён»: ' + JSON.stringify(okLogs.map(l => l.message))
  );
  assert.ok(
    !okLogs.some(log => /не подтверждён/.test(log.message)),
    'no «не подтверждён» on a passed contest'
  );

  const blocked = createHarness({
    parseResult: () => ({ passed: false, correct: null, total: null, reason: 'FRAUD' })
  });
  await blocked.solver.start('log-fraud');
  const blockedLogs = blocked.events.filter(
    event => event.type === 'log' && event.level === 'info'
  );
  assert.ok(
    blockedLogs.some(log => /Контест завершён: навык не подтверждён \(FRAUD\)/.test(log.message)),
    'FRAUD must log the reason: ' + JSON.stringify(blockedLogs.map(l => l.message))
  );

  const bare = createHarness({
    parseResult: () => ({ passed: true, correct: null, total: null })
  });
  await bare.solver.start('log-bare');
  const bareLogs = bare.events.filter(event => event.type === 'log' && event.level === 'info');
  assert.ok(
    bareLogs.some(log => /Контест завершён: навык подтверждён$/.test(log.message)),
    'passed without a score logs «навык подтверждён» with no parens: ' +
      JSON.stringify(bareLogs.map(l => l.message))
  );
});

test('practice-solver: abort during work stops the run', async () => {
  const { solver, signal } = createHarness({
    pages: [pageHtml(makeTaskPage(401, 1, 1)), pageHtml(makeTaskPage(402, 2, 2))],
    customDelays: { ...delays, typing: { min: 5000, max: 6000 } }
  });
  const promise = solver.start('abort-me');
  setTimeout(() => signal.abort(), 5);
  const result = await promise;
  assert.equal(result.status, 'aborted');
});

test('practice-solver: respects taskCounter.current on mid-contest resume', async () => {
  const { solver, events } = createHarness({
    pages: [pageHtml(makeTaskPage(703, 3, 4)), finalHtml()]
  });
  const result = await solver.start('mid-resume');
  assert.equal(result.status, 'finished');
  const taskEvent = events.find(e => e.type === 'task');
  assert.ok(taskEvent, 'task event must be emitted');
  assert.equal(taskEvent.number, 3, 'task number must be 3 from taskCounter.current');
  assert.equal(taskEvent.total, 4, 'total tasks must be 4');
});
