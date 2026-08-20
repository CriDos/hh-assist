// Code Solver Engine: the full solving cycle for practice (code) API tasks
// (docs/hh.md §4.1). Pure module, mirrors theory-solver.js but separate:
// the cert_code protocol, the "check → fix on results → full" loop, and
// reading tasks from the SSR page /code/<skillId> instead of get_current_task.

import { PROTO } from '../core/proto.ts';
import { base64ToUtf8, utf8ToBase64 } from '../core/api.ts';
import { buildCodeQuestion, buildCodeFixPrompt, stripCodeFence } from '../prompts/builder.ts';
import { codeEditedEvent } from '../core/telemetry.ts';
import { parseSsr } from '../core/catalog.ts';
import { resultVerdict, scoreText } from '../core/result.ts';
import { sleep, delayMs } from '../core/timing.ts';
import { createSolverKit } from './solver-kit.ts';
import { ParsedResultPage } from '../types/solver.ts';
import { ApiClient } from '../types/proto.ts';
import { LLMConfig } from '../core/settings.ts';

export const PRACTICE_SOLVER_LIMITS = {
  maxFixAttempts: PROTO.code.maxFixAttempts,
  pollAttempts: PROTO.code.pollAttempts,
  pollDelayMs: PROTO.code.pollDelayMs
};

export interface PracticeSolverOptions {
  api: ApiClient;
  config: LLMConfig;
  llm: (config: any, question: any, signal?: AbortSignal) => Promise<string>;
  delays: {
    typing: { min: number; max: number };
    retryTyping: { min: number; max: number };
    heartbeatMs: number;
  };
  signal?: AbortSignal | AbortController;
  rng?: () => number;
  section?: string;
  onEvent?: (event: any) => void;
  fetchPage: () => Promise<{ status?: number; html?: string; url?: string } | null>;
  parseResult?: (html: string) => ParsedResultPage | null;
  telemetry?: {
    report?: (taskId: number, events: any[]) => Promise<any>;
    heartbeat?: (taskId: number) => Promise<any>;
  };
}

export function createPracticeSolver({
  api,
  config,
  llm,
  delays,
  signal,
  rng = Math.random,
  section = '',
  onEvent = () => {},
  fetchPage,
  parseResult = () => null,
  telemetry = {}
}: PracticeSolverOptions) {
  const kit = createSolverKit({ signal, telemetry, rng, onEvent, limits: PRACTICE_SOLVER_LIMITS });
  const { emit, log, report, emitTimeLeft, expose, withApiRetries } = kit;

  // SSR of the /code/<skillId> page → the contest task (pageCertCode).
  // fetchPage returns { status, html }; null if unparseable.
  async function fetchTask() {
    const page = await fetchPage();
    if (!page?.html) return null;
    const state = parseSsr(page.html, PROTO.code.ssrKey);
    const task = state ? state[PROTO.code.ssrKey] : null;
    if (!task || task.taskId == null) return null;
    return task;
  }

  // Poll the result of a test run: live clients get the answer via a single GET
  // in ~2 s; we poll with margin until a final status arrives. Intermediate
  // statuses (PROCESSING/PENDING/empty) — keep polling; final ones
  // (ACCEPTED/WRONG_ANSWER/COMPILE_ERROR/...) — return. null — aborted.
  async function pollSubmitResult(
    submissionId: string,
    taskId: number,
    isSolution: boolean
  ): Promise<any> {
    for (let attempt = 0; attempt < PRACTICE_SOLVER_LIMITS.pollAttempts; attempt++) {
      if (kit.signal.aborted) return null;
      const result: any = await withApiRetries('get_submit_task_result', () =>
        api.getSubmitTaskResult(submissionId, taskId, isSolution)
      );
      const status = result?.status;
      if (status && status !== 'PROCESSING' && status !== 'PENDING') return result;
      await sleep(PRACTICE_SOLVER_LIMITS.pollDelayMs, { signal: kit.signal });
    }
    throw new Error('Результат прогона тестов не получен (лимит ожидания)');
  }

  // One task: an LLM loop fixed by the check-run results.
  // Returns { code, result }, or null when aborted.
  // The panel timer (emitTimeLeft) updates from the task start: "typing"
  // lasts 1–3 minutes; without the initial server sample the card stays empty.
  async function solveTask(task: any, number: number) {
    const taskId = task.taskId;
    const lang = task.editor?.progLanguage || 'PHP';
    const template = task.editor?.solutionText ? base64ToUtf8(task.editor.solutionText) : '';
    // SQL tasks: the reference result (expectedTable) lives in
    // taskDescription (docs/hh.md §4.1) — the fix feedback oracle for the
    // smoke tests (adminTests carry no expectedOutput for SQL).
    const innerTask = task?.task && typeof task.task === 'object' ? task.task : task;
    const expectedTable = innerTask?.taskDescription?.expectedTable || null;

    await emitTimeLeft(api);

    // Task chat history: first message — the full condition (task, description,
    // formats, examples, template); then it accumulates assistant-code →
    // user run results → … The model sees the whole chain of attempts (which
    // tests passed, how it fixed them), the condition is not duplicated.
    const history: Array<{ role: string; content: string }> = [];
    const first = buildCodeQuestion(task, { section, template });
    history.push({ role: 'user', content: first.question });

    let code = '';
    for (let attempt = 0; attempt <= PRACTICE_SOLVER_LIMITS.maxFixAttempts; attempt++) {
      if (kit.signal.aborted) return null;

      // The page itself sends the heartbeat (~every 20 s) — no solver-side
      // pump is needed: its tick would add a second t10 next to the page one,
      // and a pair of heartbeats <2 s apart appeared in the FRAUD captures
      // (10:29/10:30/11:51).
      const outcome = await (async () => {
        // Copy of the chain (not a reference): history keeps growing, but the
        // record must stay a snapshot of this request's context.
        emit({
          type: 'llm-context',
          taskId,
          number,
          attempt,
          question: history[history.length - 1].content,
          history: history.map(message => ({ ...message }))
        });
        const llmStart = Date.now();
        let text: string;
        try {
          text = await llm(config, { kind: 'code', messages: history }, kit.signal);
          if (kit.signal.aborted) return null;
          if (!text || !text.trim()) {
            throw new Error('Модель вернула пустой файл решения');
          }
          emit({
            type: 'llm-response',
            taskId,
            number,
            attempt,
            response: text,
            durationMs: Date.now() - llmStart,
            status: 'success'
          });
        } catch (err: any) {
          emit({
            type: 'llm-response',
            taskId,
            number,
            attempt,
            response: null,
            durationMs: Date.now() - llmStart,
            status: 'error',
            error: err?.message || String(err)
          });
          throw err;
        }
        const raw = stripCodeFence(text); // strip a ``` fence if the model wrapped the code
        code = raw.trim(); // trimmed in submit, like the live client

        // "Entering the code into the editor" — like the live client
        // (docs/hh.md §4.1): a human reads the condition and types the code;
        // during typing the editor periodically autosaves (update_code).
        // type 3 (paste) is not sent — one-shot pasting of a ready solution
        // for every task was in the FRAUD captures. The first input is a full
        // "typing" over the typing range (default 2–3 min); a fix
        // (attempt > 0) uses its own retryTyping range (default 20–30 s).
        const baseTyping = delays.typing || { min: 30000, max: 60000 };
        const typing = attempt > 0 ? delays.retryTyping || { min: 20000, max: 30000 } : baseTyping;

        const bursts = 3;
        // Total "typing" duration — ONE random value from the range (30–60 s),
        // split into fragments: pauses between the start and final report
        // batches. Picked up front (random from the range, as everywhere) —
        // the log gets the exact total, matching the real sleep time.
        let typingMs = delayMs(typing, rng);
        const pauses: number[] = [];
        for (let i = 0; i < bursts - 1; i++) {
          const left = bursts - 1 - i;
          if (left <= 1) {
            pauses.push(typingMs);
            typingMs = 0;
            continue;
          }
          // 35–65 % of the remainder (min 1 ms — at least one type 5 report
          // ticks per pause; a batch roughly every 10 s).
          const share =
            typingMs > 0
              ? Math.min(
                  Math.max(1, Math.round(typingMs * (0.35 + rng() * 0.3))),
                  typingMs - (left - 1)
                )
              : 0;
          pauses.push(share);
          typingMs -= share;
        }
        const totalTypingMs = pauses.reduce((sum, ms) => sum + ms, 0);
        emit({
          type: 'code-generated',
          taskId,
          number,
          attempt,
          length: code.length,
          typingMs: totalTypingMs
        });
        // type 5 "typing" batches go continuously, like the live client buffer
        // (the page sends report_data every ~10 s while a human types):
        // a start batch + intermediate ones every ~10 s inside the pauses.
        const typingStepMs = 10000;
        for (let burst = 0; burst < bursts; burst++) {
          await report(taskId, [codeEditedEvent(rng)]);
          if (burst === 0) {
            // First autosave — partial code, like the live client
            await api.updateCode(taskId, utf8ToBase64(raw), lang).catch(() => {});
          }
          if (burst < bursts - 1) {
            let remaining = pauses[burst];
            while (remaining > 0 && !kit.signal.aborted) {
              const step = Math.min(typingStepMs, remaining);
              if (!(await sleep(step, { signal: kit.signal }))) return null;
              remaining -= step;
              await report(taskId, [codeEditedEvent(rng)]);
            }
          }
        }

        // Final autosave before the run
        await api.updateCode(taskId, utf8ToBase64(raw), lang).catch(() => {});
        emit({ type: 'code-running', taskId, number, attempt });

        const submission: any = await withApiRetries('post_submit_task', () =>
          api.submitTask(taskId, utf8ToBase64(code), lang, PROTO.code.submissionTypes.check)
        );
        const result: any = await pollSubmitResult(submission.submissionId, taskId, false);
        if (kit.signal.aborted || !result) return null;

        const summary = summarize(result);
        emit({ type: 'code-checked', taskId, number, attempt, status: result.status, ...summary });
        await emitTimeLeft(api);
        return { code, result };
      })();
      if (kit.signal.aborted || !outcome || !outcome.result) return null;

      if (outcome.result.status === 'ACCEPTED') break;
      if (attempt >= PRACTICE_SOLVER_LIMITS.maxFixAttempts) {
        // Fixes exhausted — give up on the task. The server advances to the
        // next task only after a full submission (docs/hh.md §4.1): the last
        // attempt goes as the final solution, the task counts as failed in
        // the verdict, and the contest itself continues.
        log(
          'warn',
          `Решение не прошло тесты после ${PRACTICE_SOLVER_LIMITS.maxFixAttempts + 1} прогонов — пропускаю задачу`
        );
        emit({ type: 'code-skipping', taskId, number });
        const submission: any = await withApiRetries('post_submit_task', () =>
          api.submitTask(taskId, utf8ToBase64(code), lang, PROTO.code.submissionTypes.full)
        );
        const result: any = await pollSubmitResult(submission.submissionId, taskId, true);
        if (kit.signal.aborted || !result) return null;
        emit({ type: 'code-submitted', taskId, number, status: result.status, skipped: true });
        return { code, result, skipped: true };
      }
      // Chat history: model answer + run results (no restatement of the condition)
      history.push({ role: 'assistant', content: code });
      history.push({
        role: 'user',
        content: buildCodeFixPrompt(outcome.result, task?.tests?.adminTests, expectedTable)
      });
      const fix = summarize(outcome.result);
      const reason = fix.error ? ` — ошибка сборки: ${fix.error}` : '';
      log(
        'warn',
        `Тесты не прошли ${fix.failed} из ${fix.total}${reason} — исправляю решение ${attempt + 1}/${PRACTICE_SOLVER_LIMITS.maxFixAttempts}`
      );
    }

    // Tests passed — final submission of the solution
    emit({ type: 'code-submitting', taskId, number });
    const submission: any = await withApiRetries('post_submit_task', () =>
      api.submitTask(taskId, utf8ToBase64(code), lang, PROTO.code.submissionTypes.full)
    );
    const result: any = await pollSubmitResult(submission.submissionId, taskId, true);
    if (kit.signal.aborted || !result) return null;
    emit({ type: 'code-submitted', taskId, number, status: result.status });
    return { code, result };
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
    let localCounter = 0;
    for (;;) {
      if (kit.signal.aborted) return { status: 'aborted' };

      const task = await withApiRetries('fetch_task', fetchTask);
      if (kit.signal.aborted) return { status: 'aborted' };

      // The page has returned contest_result (SSR SkillsFront-InitialState) —
      // the contest is finished.
      if (!task) {
        emit({ type: 'post-finishing' });
        const page = await fetchPage();
        const result = page?.html ? parseResult(page.html) : null;
        emit({ type: 'finished', contest, result, resultUrl: page?.url || null });
        if (result) {
          // The verdict phrasing lives in resultVerdict (single source): the
          // reason is the page status (SUCCESS/FAILURE/FRAUD), not a block by
          // itself. The score is parenthesized only when complete; no-score
          // and unknown already carry their full short form.
          const verdict = resultVerdict(result);
          const score = scoreText(result);
          log(
            'info',
            verdict.status === 'no-score' || verdict.status === 'unknown'
              ? `Контест завершён: ${verdict.short}`
              : `Контест завершён: ${verdict.short}${score ? ` (${score})` : ''}`
          );
        }
        return { status: 'finished', result, resultUrl: page?.url || null };
      }

      localCounter++;
      const currentNumber = Number.isInteger(task.taskCounter?.current)
        ? task.taskCounter.current
        : localCounter;
      const total = Number.isInteger(task.taskCounter?.count) ? task.taskCounter.count : null;

      emit({
        type: 'task',
        taskId: task.taskId,
        number: currentNumber,
        total,
        title: task.task?.title || ''
      });

      const outcome = await solveTask(task, currentNumber);
      if (kit.signal.aborted || !outcome) return { status: 'aborted' };
      emit({ type: 'task-done', taskId: task.taskId, number: currentNumber, ...outcome });
    }
  }

  return expose(run);
}

// Smoke-test summary for events/log. error — the server commonError line
// with the error position («file:line:col: message»); a "# command-line-…"
// header is skipped. null when the build passed.
function summarize(result: any) {
  const smoke = result?.smokeTests || {};
  const entries: any[] = Object.values(smoke);
  const passed = entries.filter(item => item?.passed).length;
  const failed = entries.length - passed;
  const lines = String(result?.commonError ?? '')
    .trim()
    .split('\n');
  const error =
    lines.find(line => /:\d+:\d+/.test(line)) ||
    lines.find(line => line.trim() && !line.trim().startsWith('#')) ||
    lines[0] ||
    null;
  return { total: entries.length, passed, failed, error };
}
