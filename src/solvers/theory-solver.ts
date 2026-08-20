// Solver Engine (docs/plan.md §3.1): the full API cycle for solving one test.
// Pure module: api/llm/telemetry/timing are injected; runs in node (tests)
// and in the extension (tab bridge).
//
// Loop: get_current_task → prompt → LLM → parse → submit_user_answer →
// type 8 telemetry via the tab relay → pause → ... → 204 → post_finish.
//
// The shared scaffolding (signal, retries, heartbeat, pauses) lives in solver-kit.js.

import { buildQuestion, parseAnswerResponse } from '../prompts/builder.ts';
import { answerEvent } from '../core/telemetry.ts';
import { delayMs, sleep } from '../core/timing.ts';
import { createSolverKit } from './solver-kit.ts';
import { ApiClient, TaskItem } from '../types/proto.ts';
import { LLMConfig } from '../core/settings.ts';

export const THEORY_SOLVER_LIMITS = {
  // 10 LLM attempts per question: an unparsed answer format is re-asked
  // (see solveTask). An empty model answer is re-asked by llm.js itself.
  llmParseRetries: 9
};

export interface TheorySolverOptions {
  api: ApiClient;
  config: LLMConfig;
  llm: (config: any, question: any, signal?: AbortSignal) => Promise<string>;
  delays: {
    answer: { min: number; max: number };
    between: { min: number; max: number };
    heartbeatMs: number;
  };
  signal?: AbortSignal | AbortController;
  rng?: () => number;
  section?: string;
  onEvent?: (event: any) => void;
  telemetry?: {
    report?: (taskId: number, events: any[]) => Promise<any>;
    heartbeat?: (taskId: number) => Promise<any>;
  };
  limits?: {
    llmParseRetries?: number;
    apiRetries?: number;
    apiBackoffMs?: number;
  };
}

export function createTheorySolver({
  api,
  config,
  llm,
  delays,
  signal,
  rng = Math.random,
  section = '',
  onEvent = () => {},
  telemetry = {},
  limits = {}
}: TheorySolverOptions) {
  const kit = createSolverKit({
    signal,
    telemetry,
    rng,
    onEvent,
    limits: { ...THEORY_SOLVER_LIMITS, ...limits }
  });
  const { emit, log, report, emitTimeLeft, expose, withApiRetries, withHeartbeat } = kit;

  // LLM request with retries on an unparsed answer: re-ask while the parser
  // returns null. An empty model answer is re-asked by llm.js itself — not
  // handled here.
  async function solveTask(task: TaskItem, taskNumber: number) {
    const question = buildQuestion(task, { section });
    let lastReason = '';
    for (let attempt = 0; attempt <= THEORY_SOLVER_LIMITS.llmParseRetries; attempt++) {
      if (attempt > 0)
        log(
          'warn',
          `Ответ модели не распарсен (${lastReason}), переспрашиваю ${attempt}/${THEORY_SOLVER_LIMITS.llmParseRetries + 1}`
        );
      emit({
        type: 'llm-context',
        taskId: task.taskId,
        number: taskNumber,
        attempt,
        subType: task.subType,
        question: question.question
      });
      const llmStart = Date.now();
      let text: string;
      try {
        text = await llm(config, question, kit.signal);
        emit({
          type: 'llm-response',
          taskId: task.taskId,
          number: taskNumber,
          attempt,
          response: text,
          durationMs: Date.now() - llmStart,
          status: 'success'
        });
      } catch (err: any) {
        emit({
          type: 'llm-response',
          taskId: task.taskId,
          number: taskNumber,
          attempt,
          response: null,
          durationMs: Date.now() - llmStart,
          status: 'error',
          error: err?.message || String(err)
        });
        throw err;
      }
      const parsed = parseAnswerResponse(text, task.answers.length, task.subType === 'MULTIPLE');
      if (parsed) {
        emit({
          type: 'question',
          taskId: task.taskId,
          number: taskNumber,
          description: task.description,
          subType: task.subType,
          answers: task.answers.map(answer => ({
            answer: answer.answer,
            uuid: answer.uuid,
            feature: answer.feature
          })),
          indexes: parsed.indexes
        });
        emit({ type: 'answer', taskId: task.taskId, indexes: parsed.indexes });
        return {
          uuids: parsed.indexes.map(index => task.answers[index].uuid),
          indexes: parsed.indexes
        };
      }
      lastReason = 'нет строки «Ответ»';
    }
    throw new Error(
      `Модель не дала ответ в требуемом формате (${THEORY_SOLVER_LIMITS.llmParseRetries + 1} попыток)`
    );
  }

  async function run(contest: any) {
    emit({ type: 'started', contest });
    try {
      return await runLoop(contest);
    } catch (error) {
      // Abort during an API/LLM wait (Stop): the wait's error is irrelevant —
      // the run ends as 'aborted', not as a failed job card.
      if (kit.signal.aborted) return { status: 'aborted' };
      throw error;
    }
  }

  async function runLoop(contest: any) {
    let total: number | null = null;
    try {
      const tasks = await api.getContestTasks();
      total = Array.isArray(tasks?.contestTasks) ? tasks.contestTasks.length : null;
    } catch (error: any) {
      log('warn', `get_contest_tasks: ${error.message}`);
    }
    emit({ type: 'total', total });

    let number = 0;
    for (;;) {
      if (kit.signal.aborted) return { status: 'aborted' };

      const task: any = await withApiRetries('get_current_task', () => api.getCurrentTask());
      if (kit.signal.aborted) return { status: 'aborted' };
      if (!task) break; // 204 — the test is over
      number++;

      const taskId = task.taskId;
      emit({ type: 'task', taskId, number, total });

      const answer = await withHeartbeat(taskId, () => solveTask(task, number), delays.heartbeatMs);
      if (kit.signal.aborted) return { status: 'aborted' };

      // "Thinking" pause before the submit: the value is drawn up front
      // (random from the range) — the log gets the exact, not the average.
      const answerMs = delayMs(delays.answer, rng);
      emit({ type: 'simulate', label: 'обдумывание ответа', ms: answerMs, number });
      if (!(await sleep(answerMs, { signal: kit.signal }))) return { status: 'aborted' };

      // Telemetry: the selected answer goes through the tab relay BEFORE the
      // submit — like the live client (click on an option → type 8 →
      // submit_user_answer). The relay appends the heartbeat [counter] → [0]
      // itself.
      await report(taskId, [answerEvent(taskId)]);

      await withApiRetries('submit_user_answer', () => api.submitAnswer(taskId, answer.uuids));
      if (kit.signal.aborted) return { status: 'aborted' };
      emit({ type: 'submitted', taskId, number, total, indexes: answer.indexes });

      // Time left — for the panel (the contest-wide timer)
      await emitTimeLeft(api);

      if (number < (total ?? Infinity)) {
        const betweenMs = delayMs(delays.between, rng);
        emit({ type: 'simulate', label: 'пауза между вопросами', ms: betweenMs, number });
        if (!(await sleep(betweenMs, { signal: kit.signal }))) return { status: 'aborted' };
      }
    }

    emit({ type: 'post-finishing' });
    const finish: any = await withApiRetries('post_finish', () => api.postFinish());
    emit({ type: 'finished', contest, redirectUri: finish?.redirectUri || null });
    return { status: 'finished', redirectUri: finish?.redirectUri || null };
  }

  return expose(run);
}
