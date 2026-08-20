import { test, assert, expect } from 'vitest';
import { createTheorySolver, THEORY_SOLVER_LIMITS } from '../../src/solvers/theory-solver.ts';
import { DEFAULT_TIMING, delayMs } from '../../src/core/timing.ts';

const delays = {
  answer: { min: 1, max: 2 },
  between: { min: 1, max: 2 },
  betweenTests: { min: 1, max: 2 },
  heartbeatMs: 20000
};

function makeTask(id: number) {
  return {
    taskId: id,
    title: 'Набор',
    description: `Вопрос ${id}?`,
    subType: 'SINGLE',
    answers: [
      { answer: 'Вариант A', uuid: `a${id}`, feature: 'false' },
      { answer: 'Вариант B', uuid: `b${id}`, feature: 'false' }
    ],
    media: []
  };
}

function createHarness({ tasks = [] as any[], llmText = 'Ответ: 1\nОбоснование: так.' } = {}) {
  const events: any[] = [];
  const reportCalls: any[] = [];
  const queue = [...tasks];
  const api: any = {
    getCurrentTask: async () => queue.shift() ?? null,
    getContestTasks: async () => ({
      contestTasks: tasks.map(task => ({ taskId: task.taskId, status: 'NOT_STARTED' }))
    }),
    getTimeLeft: async () => ({ timeLeftSeconds: 600 }),
    submitAnswer: async (taskId: number, uuids: string[]) => {
      api.submits.push({ taskId, uuids });
      return { status: 'ACCEPTED' };
    },
    postFinish: async () => ({ redirectUri: 'https://spb.hh.ru/result?token=x' }),
    submits: [] as any[]
  };
  const telemetry: any = {
    report: async (taskId: number, events: any[]) => {
      reportCalls.push({ taskId, events });
    },
    heartbeat: async (taskId: number) => {
      reportCalls.push({ taskId, heartbeat: true });
    }
  };
  const signal = new AbortController();
  const solver = createTheorySolver({
    api,
    config: { baseUrl: 'https://api.test/v1', apiKey: 'k', model: 'm' },
    llm: async () => llmText,
    delays,
    signal,
    section: 'Python',
    onEvent: (event: any) => events.push(event),
    telemetry
  });
  return { solver, api, signal, events, reportCalls };
}

test('theory-solver: happy path runs all tasks, posts finish and telemetry', async () => {
  const tasks = [makeTask(1), makeTask(2), makeTask(3)];
  const { solver, api, reportCalls, events } = createHarness({ tasks });

  const result = await solver.start('contest-1');

  assert.equal(result.status, 'finished');
  assert.equal(api.submits.length, 3);
  assert.deepEqual(api.submits[0], { taskId: 1, uuids: ['a1'] });
  assert.equal(events.find(event => event.type === 'started').contest, 'contest-1');
  assert.equal(events.find(event => event.type === 'total').total, 3);
  assert.equal(events.filter(event => event.type === 'task').length, 3);
  assert.equal(
    events.find(event => event.type === 'finished').redirectUri,
    'https://spb.hh.ru/result?token=x'
  );

  assert.equal(reportCalls.filter(call => call.heartbeat).length, 0, 'pump не бил (LLM быстрый)');
  const answers = reportCalls.filter(call => !call.heartbeat);
  assert.equal(answers.length, 3);
  assert.equal(answers[0].taskId, 1);
  assert.equal(answers[0].events.length, 1);
  assert.equal(answers[0].events[0].type, 8);
});

test('theory-solver: only the first answer index is submitted when LLM lists several', async () => {
  const tasks = [
    {
      ...makeTask(1),
      subType: 'SINGLE',
      answers: [
        makeTask(1).answers[0],
        makeTask(1).answers[1],
        { answer: 'C', uuid: 'c1', feature: 'false' }
      ]
    }
  ];
  const { solver, api } = createHarness({ tasks, llmText: 'Ответ: 1, 3\nОбоснование: оба.' });
  await solver.start('c');
  assert.deepEqual(api.submits[0].uuids, ['a1']);
});

test('theory-solver: 204 immediately (no tasks) still posts finish', async () => {
  const { solver, api } = createHarness({ tasks: [] });
  const result = await solver.start('empty');
  assert.equal(result.status, 'finished');
  assert.equal(api.submits.length, 0);
});

test('theory-solver: unparseable LLM answer retries then errors and aborts the run', async () => {
  const tasks = [makeTask(1)];
  const events: any[] = [];
  const api: any = {
    getCurrentTask: async () => tasks.shift() ?? null,
    getContestTasks: async () => ({ contestTasks: [] }),
    submitAnswer: async () => {
      throw new Error('must not be called');
    },
    postFinish: async () => {
      throw new Error('must not be called');
    }
  };
  const signal = new AbortController();
  const solver = createTheorySolver({
    api,
    config: { baseUrl: 'https://api.test', apiKey: 'k', model: 'm' },
    llm: async () => 'Не знаю ответа.',
    delays,
    signal,
    onEvent: (event: any) => events.push(event)
  });
  await expect(solver.start('x')).rejects.toThrow(/Модель не дала ответ/);
  assert.ok(events.some(event => event.type === 'log' && event.level === 'warn'));
});

test('theory-solver: LLM failure (e.g. exhausted empty retries) aborts the run', async () => {
  const tasks = [makeTask(1)];
  const events: any[] = [];
  const api: any = {
    getCurrentTask: async () => tasks.shift() ?? null,
    getContestTasks: async () => ({ contestTasks: [] }),
    submitAnswer: async () => {
      throw new Error('must not be called');
    },
    postFinish: async () => {
      throw new Error('must not be called');
    }
  };
  const signal = new AbortController();
  const solver = createTheorySolver({
    api,
    config: { baseUrl: 'https://api.test', apiKey: 'k', model: 'm' },
    llm: async () => {
      throw new Error('Пустой ответ модели');
    },
    delays,
    signal,
    onEvent: (event: any) => events.push(event)
  });
  await expect(solver.start('x')).rejects.toThrow(/Пустой ответ модели/);
});

test('theory-solver: persistent LLM failure (empty after llm retries) errors', async () => {
  const tasks = [makeTask(1)];
  const api: any = {
    getCurrentTask: async () => tasks.shift() ?? null,
    getContestTasks: async () => ({ contestTasks: [] }),
    submitAnswer: async () => {
      throw new Error('must not be called');
    },
    postFinish: async () => {
      throw new Error('must not be called');
    }
  };
  const signal = new AbortController();
  const solver = createTheorySolver({
    api,
    config: { baseUrl: 'https://api.test', apiKey: 'k', model: 'm' },
    llm: async () => {
      throw new Error('Пустой ответ модели');
    },
    delays,
    signal,
    onEvent: () => {}
  });
  await expect(solver.start('x')).rejects.toThrow(/Пустой ответ модели/);
});

test('theory-solver: transient API error is retried and the run continues', async () => {
  const tasks = [makeTask(1)];
  let fails = 2;
  const api: any = {
    getCurrentTask: async () => {
      if (fails-- > 0) {
        const error: any = new Error('HTTP 500');
        error.status = 500;
        throw error;
      }
      return tasks.shift() ?? null;
    },
    getContestTasks: async () => ({ contestTasks: [] }),
    submitAnswer: async () => ({ status: 'ACCEPTED' }),
    postFinish: async () => ({ redirectUri: 'x' })
  };
  const solver = createTheorySolver({
    api,
    config: { baseUrl: 'https://api.test', apiKey: 'k', model: 'm' },
    llm: async () => 'Ответ: 1',
    delays: { ...delays, answer: { min: 1, max: 1 }, between: { min: 1, max: 1 } },
    rng: () => 0.5,
    limits: { apiBackoffMs: 1 },
    onEvent: () => {}
  });
  const result = await solver.start('x');
  assert.equal(result.status, 'finished');
  assert.ok(fails <= 0, 'both failures must have been consumed');
});

test('theory-solver: abort during the answer delay stops the run', async () => {
  const tasks = [makeTask(1), makeTask(2)];
  const events: any[] = [];
  const api: any = {
    getCurrentTask: async () => tasks.shift() ?? null,
    getContestTasks: async () => ({ contestTasks: [] }),
    submitAnswer: async (taskId: number, uuids: string[]) => {
      api.submits.push({ taskId, uuids });
      return { status: 'ACCEPTED' };
    },
    postFinish: async () => ({ redirectUri: 'x' }),
    submits: []
  };
  const signal = new AbortController();
  const solver = createTheorySolver({
    api,
    config: { baseUrl: 'https://api.test', apiKey: 'k', model: 'm' },
    llm: async () => 'Ответ: 1',
    delays: { ...delays, answer: { min: 5000, max: 6000 }, between: { min: 1, max: 1 } },
    signal,
    onEvent: (event: any) => events.push(event)
  });
  const run = solver.start('x');
  setTimeout(() => signal.abort(), 5);
  const result = await run;
  assert.equal(result.status, 'aborted');
  assert.equal(api.submits.length, 0);
  assert.equal(events.filter(event => event.type === 'submitted').length, 0);
});

test('theory-solver: question event carries description, answers and chosen indexes', async () => {
  const tasks = [makeTask(1)];
  const { solver, events } = createHarness({ tasks, llmText: 'Ответ: 2\nОбоснование: верный.' });
  await solver.start('c');

  const questionEvent = events.find(event => event.type === 'question');
  assert.ok(questionEvent, 'question event must be emitted');
  assert.equal(questionEvent.number, 1);
  assert.equal(questionEvent.description, 'Вопрос 1?');
  assert.equal(questionEvent.subType, 'SINGLE');
  assert.equal(questionEvent.answers.length, 2);
  assert.deepEqual(questionEvent.answers[0], { answer: 'Вариант A', uuid: 'a1', feature: 'false' });
  assert.deepEqual(questionEvent.indexes, [1]);
  assert.deepEqual(events.find(event => event.type === 'answer').indexes, [1]);
});

test('theory-solver: default timing ranges drive delays', () => {
  const answerRange = {
    min: DEFAULT_TIMING.theory.answerMinMs,
    max: DEFAULT_TIMING.theory.answerMaxMs
  };
  assert.ok(delayMs(answerRange, () => 0) >= DEFAULT_TIMING.theory.answerMinMs);
  assert.ok(THEORY_SOLVER_LIMITS.llmParseRetries >= 1);
});
