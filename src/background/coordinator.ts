// Test execution coordinator: assembly of solvers, session & tab preparation,
// single-test lifecycle (startTest), checkpoint recovery (resumeRun) and
// solver event dispatching.

import { callLLM } from '../core/llm.ts';
import { createApiClient } from '../core/api.ts';
import { createTheorySolver } from '../solvers/theory-solver.ts';
import { createPracticeSolver } from '../solvers/practice-solver.ts';
import { buildStartUrl } from '../core/fingerprint.ts';
import { parseResultPage, resultVerdict } from '../core/result.ts';
import { createBridgeFetch } from '../core/bridge.ts';
import { getSettings, llmConfig, timingConfig, activeProfile } from '../core/settings.ts';
import { DEFAULT_SYSTEM } from '../prompts/theory.ts';
import { parseAnswerResponse } from '../prompts/builder.ts';
import { isAssessmentUrl } from '../core/page-utils.ts';
import { state, ActiveRun } from './state.ts';
import { ensureKeepAlive, clearCheckpoint, saveCheckpoint, CHECKPOINT_KEY } from './keepalive.ts';
import { pushLog, pushLlmLog, updateLatestLlmLog } from './log.ts';
import {
  checkSession,
  ensureLastId,
  ensureGate,
  ensureMainTab,
  returnToCatalog,
  launchTestTab,
  waitTabComplete,
  fetchCodePage,
  readCompletion,
  setSolverTab,
  gateTaskId,
  gateReport,
  gateHeartbeat,
  fetchPageFromTab,
  markReloadNeeded,
  resetReloadFlag,
  getHhOrigin
} from './tabs.ts';
import { restoreQueue } from './queue.ts';
import {
  setTabId as netlogSetTabId,
  beginTest as netlogBeginTest,
  endTest as netlogEndTest
} from './netlog.ts';
import { ConfigSettings, FingerprintProfile } from '../types/settings';

export function finishRunCleanup(): void {
  state.run = null;
  clearCheckpoint();
  setSolverTab(null);
  ensureKeepAlive();
}

function pluralJobs(count: number): string {
  if (count % 10 === 1 && count % 100 !== 11) return 'тест';
  if (count % 10 >= 2 && count % 10 <= 4 && (count % 100 < 12 || count % 100 > 14)) return 'теста';
  return 'тестов';
}

export interface BuildSolverOptions {
  settings: ConfigSettings;
  item: any;
  kind: 'theory' | 'practice';
  tabId: number;
  onEvent: (event: any) => void;
}

export function buildSolver({ settings, item, kind, tabId, onEvent }: BuildSolverOptions) {
  const fetchImpl = createBridgeFetch({ tabId });
  const api = createApiClient({ fetchImpl });
  const telemetry = {
    report: (taskId: number, events: any[]) => gateReport(tabId, taskId, events),
    heartbeat: (taskId: number) => gateHeartbeat(tabId, taskId)
  };
  const common = {
    api,
    config: llmConfig(settings),
    llm: callLLM,
    delays: timingConfig(settings, kind),
    section: item.name,
    onEvent,
    telemetry
  };
  return kind === 'practice'
    ? createPracticeSolver({
        ...common,
        fetchPage: async () => {
          const fromTab = await fetchPageFromTab(tabId);
          if (fromTab.html) return fromTab;
          return fetchCodePage(item.id);
        },
        parseResult: parseResultPage
      })
    : createTheorySolver(common);
}

export async function ensureSolverTab(): Promise<number> {
  const cached = state.session?.tabId;
  if (cached) {
    try {
      const tab = await chrome.tabs.get(cached);
      if (tab?.id) return cached;
    } catch {}
    pushLog('warn', 'Вкладка hh была закрыта — открываю каталог заново');
    state.session = null;
  }
  const main = await ensureMainTab();
  return main.tabId;
}

const PROBE_QUESTION_PROMPT = [
  'Вопрос: Какой результат вернёт выражение 2 + 2?',
  'Варианты ответа:',
  '1. 3',
  '2. 4',
  '3. 5'
].join('\n');

export async function probeLLM(config: any): Promise<void> {
  const start = Date.now();
  const probeSystem = DEFAULT_SYSTEM;
  pushLlmLog({
    kind: 'probe',
    item: 'Проверка LLM API',
    level: config.model || '',
    question: PROBE_QUESTION_PROMPT,
    system: probeSystem,
    status: 'pending'
  });
  try {
    const text = await callLLM(
      config,
      {
        kind: 'test',
        subType: 'SINGLE',
        question: PROBE_QUESTION_PROMPT
      },
      undefined,
      {
        retries: 1,
        baseDelayMs: 50,
        maxDelayMs: 150,
        emptyRetries: 1,
        timeoutMs: 5000
      }
    );
    const parsed = parseAnswerResponse(text, 3, false);
    const selected = parsed?.indexes?.length ? parsed.indexes[0] + 1 : null;
    updateLatestLlmLog({
      response: text,
      durationMs: Date.now() - start,
      status: 'success'
    });
    const answerNote = selected ? ` (ответ: вариант ${selected})` : '';
    pushLog('info', `Проверка LLM API: ok${answerNote} [${config.model}]`);
  } catch (error: any) {
    updateLatestLlmLog({
      response: null,
      durationMs: Date.now() - start,
      status: 'error',
      error: error?.message || String(error)
    });
    const probeError: any = new Error(`Проверка LLM API не пройдена: ${error?.message || error}`);
    probeError.code = 'LLM_API';
    throw probeError;
  }
}

export function reportResult(item: any, level: any, kind: string, res: any, note = '') {
  if (res) {
    const kindLabel = kind === 'theory' ? 'Теория' : 'Практика';
    const verdict = resultVerdict(res);
    pushLog(
      verdict.status === 'passed' ? 'info' : 'warn',
      `${item.name} · ${level.name} · ${kindLabel}: ${verdict.label}`
    );
  } else {
    pushLog('warn', `${item.name}: результат не определён${note}`);
  }
  return {
    status: 'finished',
    passed: res?.passed ?? null,
    correct: res?.correct ?? null,
    totalScore: res?.total ?? null,
    reason: res?.reason ?? null,
    res
  };
}

export async function collectOutcome(
  tabId: number,
  contestId: any,
  _item: any,
  _level: any,
  kind: string,
  result: any
) {
  let res = result.result || null;
  let note = '';
  if (kind === 'theory' || !res) {
    const origin = getHhOrigin();
    const fallback = contestId
      ? `${origin}/skills/applicant/contest_result?entrypoint=NEW_USER&token=${contestId}`
      : null;
    const redirect = result.redirectUri?.startsWith('http') ? result.redirectUri : fallback;
    if (redirect) {
      try {
        await chrome.tabs.update(tabId, { url: redirect });
        await waitTabComplete(tabId);
      } catch {}
    }
    const read = await readCompletion(tabId);
    res = read?.result || null;
    if (!res) note = ` (${read?.error || 'страница завершения не отдала результат'})`;
  }
  return { res, note };
}

export interface StartTestRunnerParams {
  item: any;
  level: any;
  method: any;
  kind: 'theory' | 'practice';
  ensureDefaultProfile: () => Promise<FingerprintProfile>;
}

export async function startTestRunner({
  item,
  level,
  method,
  kind,
  ensureDefaultProfile
}: StartTestRunnerParams) {
  const settings = await getSettings();
  if (!settings.baseUrl || !settings.apiKey || !settings.model) {
    throw new Error('API не настроен: укажите baseUrl, ключ и модель в панели.');
  }

  await probeLLM(llmConfig(settings));
  netlogBeginTest({ item, level, kind });

  let tabId: number | null = null;
  try {
    if (!state.session?.loggedIn) {
      const session = await checkSession();
      if (!session.loggedIn) {
        throw new Error(
          'Авторизация на hh.ru не подтверждена: войдите в открытой вкладке каталога и повторите.'
        );
      }
    }
    tabId = await ensureSolverTab();
    netlogSetTabId(tabId);
    const profile = activeProfile(settings) || (await ensureDefaultProfile());
    pushLog(
      'info',
      `Запуск: ${item.name} · ${level.name} · ${kind === 'theory' ? 'Теория' : 'Практика'} · fingerprint: ${profile.label}`
    );
    const lastId = await ensureLastId(tabId);
    const origin = getHhOrigin();
    const redirectUrl = `${origin}${buildStartUrl({
      origin,
      skillId: item.id,
      kind,
      methodId: method.id,
      skillCategory: item.category === 'LANG' ? 'langs' : 'skills',
      lastId,
      hashes: profile.hashes,
      xhh: profile.xhh,
      fingerprintjs: profile.visitorId
    })}`;

    const launched = await launchTestTab(tabId, redirectUrl, item.id);
    if (!launched.ok) {
      throw new Error(
        `Тест не запущен: редирект не привёл к странице теста${launched.url ? ` (последний адрес: ${launched.url})` : ''}. Проверьте fingerprint или статус блокировок.`
      );
    }
    const contestId = launched.token || null;
    if (contestId) {
      pushLog('info', `Тест запущен (id ${contestId})`);
    }

    await ensureGate(tabId);
    setSolverTab(tabId);

    const solver = buildSolver({
      settings,
      item,
      kind,
      tabId,
      onEvent: event => onSolverEvent(event, { item, level, kind })
    });
    state.run = {
      tabId,
      contestId,
      item,
      level,
      kind,
      solver,
      progress: { number: 0, total: null },
      timeLeft: undefined,
      timeLeftAt: undefined
    };
    pushLog('info', `Тест готов к запуску (вкладка ${tabId})`);
    ensureKeepAlive();

    const result = await solver.start(`${item.id}:${method.id}`);
    if (result.status === 'aborted') {
      pushLog('warn', 'Выполнение теста прервано');
    } else if (result.status === 'finished') {
      const { res, note } = await collectOutcome(
        tabId,
        state.run?.contestId,
        item,
        level,
        kind,
        result
      );
      return reportResult(item, level, kind, res, note);
    }
    return result;
  } finally {
    netlogEndTest();
    if (tabId != null) {
      try {
        await returnToCatalog(tabId);
      } catch {}
    }
    finishRunCleanup();
  }
}

export async function resumeRun(run: ActiveRun, tabId: number) {
  const settings = await getSettings();
  if (run.kind === 'practice') markReloadNeeded();
  await ensureGate(tabId);
  const solver = buildSolver({
    settings,
    item: run.item,
    kind: run.kind,
    tabId,
    onEvent: event =>
      onSolverEvent(event, {
        item: { id: run.item?.id, name: run.item?.name },
        level: { name: run.level?.name },
        kind: run.kind
      })
  });
  state.run = {
    tabId,
    contestId: run.contestId || undefined,
    item: run.item,
    level: run.level,
    kind: run.kind,
    solver,
    progress: { number: 0, total: null },
    timeLeft: undefined,
    timeLeftAt: undefined
  };
  setSolverTab(tabId);
  ensureKeepAlive();
  netlogBeginTest({ item: run.item, level: run.level, kind: run.kind });
  netlogSetTabId(tabId);
  let outcome: any = { status: 'aborted' };
  try {
    const result = await solver.start('restored');
    if (result.status === 'aborted') {
      pushLog('warn', 'Выполнение теста прервано');
    } else if (result.status === 'finished') {
      const { res, note } = await collectOutcome(
        tabId,
        run.contestId,
        run.item,
        run.level,
        run.kind,
        result
      );
      outcome = reportResult(run.item, run.level, run.kind, res, note);
    }
  } finally {
    netlogEndTest();
    try {
      await returnToCatalog(tabId);
    } catch {}
    finishRunCleanup();
  }
  return outcome;
}

export async function restoreCheckpoint(queueInstance: any) {
  if (state.run || state.queueRunning) return;
  const [saved, restored] = await Promise.all([
    (chrome.storage.session.get(CHECKPOINT_KEY) as Promise<Record<string, any>>).catch(
      () => ({}) as Record<string, any>
    ),
    restoreQueue()
  ]);
  if (restored) {
    pushLog(
      'warn',
      `Восстановлена очередь: ${restored.jobs.length} ${pluralJobs(restored.jobs.length)}`
    );
  }
  const run = (saved as Record<string, any>)?.[CHECKPOINT_KEY];
  if (run?.item?.id) {
    state.queueRunning = true;
    ensureKeepAlive();
    try {
      let tab: chrome.tabs.Tab | null = null;
      if (run.tabId) {
        tab = await chrome.tabs.get(run.tabId).catch(() => null);
      }
      if (!tab || !isAssessmentUrl(tab?.url)) {
        if (run.contestId && run.item?.id) {
          pushLog(
            'warn',
            `Вкладка теста была закрыта — восстанавливаю тест ${run.item.name} по токену ${run.contestId}`
          );
          const main = await ensureMainTab();
          const targetUrl = `https://assessment.hh.ru/${run.kind === 'practice' ? 'code' : 'tests'}/${run.item.id}?contestToken=${run.contestId}`;
          await chrome.tabs.update(main.tabId, { url: targetUrl });
          await waitTabComplete(main.tabId);
          tab = await chrome.tabs.get(main.tabId).catch(() => null);
        }
      }
      if (!tab || !isAssessmentUrl(tab?.url)) {
        clearCheckpoint();
        queueInstance?.requeueRunning();
      } else {
        pushLog('warn', `Восстанавливаю выполнение: ${run.item?.name}, вкладка ${tab.id}`);
        const outcome = await resumeRun(run, tab.id!);
        queueInstance?.finishResumed(outcome);
      }
    } catch (error: any) {
      pushLog('error', `Восстановление работы не удалось: ${error.message}`);
      clearCheckpoint();
      queueInstance?.requeueRunning();
    }
  } else {
    if (run) clearCheckpoint();
    queueInstance?.requeueRunning();
  }
  if (state.jobs.some(job => job.status === 'queued')) {
    const loop = queueInstance?.startLoop();
    loop?.catch((error: any) =>
      pushLog('error', `Ошибка восстановленной очереди: ${error.message}`)
    );
  } else {
    state.queueRunning = false;
    ensureKeepAlive();
  }
}

export function formatDuration(ms = 0): string {
  const totalSeconds = Math.round((ms || 0) / 1000);
  if (totalSeconds < 60) return `${totalSeconds}с`;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes < 60) return seconds ? `${minutes} мин ${seconds}с` : `${minutes} мин`;
  const hours = Math.floor(minutes / 60);
  return `${hours} ч ${minutes % 60} мин`;
}

function formatQuestion(event: any, meta: any) {
  const clean = (value: any) =>
    String(value ?? '')
      .replace(/<[^>]+>/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  const cap = (value: string, max: number) =>
    value.length > max ? `${value.slice(0, max)}…` : value;
  const title = event.description ? cap(clean(event.description), 100) : '';
  const qNum = event.number
    ? `вопрос ${event.number}${event.total ? ` из ${event.total}` : ''}`
    : 'вопрос';
  const chosen = (event.indexes || []).map((index: number) => index + 1).join(',');
  return `${meta?.item?.name || 'Тест'}: ${qNum}${title ? ` — ${title}` : ''}${chosen ? ` (ответ: ${chosen})` : ''}`;
}

const SOLVER_EVENT_HANDLERS: Record<string, (event: any, meta: any) => void> = {
  started: () => resetReloadFlag(),
  task: (event, meta) => {
    if (state.run?.tabId) gateTaskId(state.run.tabId, event.taskId);
    if (meta.kind === 'practice') {
      pushLog(
        'info',
        `${meta.item.name}: задача ${event.number}${event.total ? ` из ${event.total}` : ''}${event.title ? ` — ${event.title}` : ''}`
      );
    }
  },
  question: (event, meta) => pushLog('info', formatQuestion(event, meta)),
  submitted: (event, meta) =>
    pushLog(
      'info',
      `${meta.item.name}: отправлен ответ [${(event.indexes || []).map((i: number) => i + 1).join(',')}]`
    ),
  'code-generating': (event, meta) =>
    pushLog(
      'info',
      `${meta.item.name}: ${event.attempt > 0 ? `исправление ${event.attempt} — ` : ''}генерация решения...`
    ),
  'code-generated': (event, meta) =>
    pushLog('info', `${meta.item.name}: решение получено (~${formatDuration(event.typingMs)})`),
  'code-running': (_event, meta) => pushLog('info', `${meta.item.name}: проверка тестов...`),
  simulate: (event, meta) =>
    pushLog('info', `${meta.item.name}: ${event.label} ~${formatDuration(event.ms)}`),
  'code-checked': (event, meta) =>
    pushLog(
      event.status === 'ACCEPTED' ? 'info' : 'warn',
      `${meta.item.name}: тесты ${event.passed}/${event.total} (${event.status})`
    ),
  'code-submitting': (_event, meta) =>
    pushLog('info', `${meta.item.name}: тесты пройдены — отправка решения`),
  'code-submitted': (event, meta) => {
    pushLog(
      event.skipped ? 'warn' : 'info',
      `${meta.item.name}: ${event.skipped ? 'задача пропущена — перехожу к следующей' : 'решение отправлено'}`
    );
    markReloadNeeded();
  },
  'task-done': () => markReloadNeeded(),
  'post-finishing': (_event, meta) => pushLog('info', `${meta.item.name}: завершение теста...`),
  finished: (event, meta) => {
    resetReloadFlag();
    pushLog('info', `${meta.item.name}: тест завершён`);
    const resultUrl = event.resultUrl || event.redirectUri;
    if (resultUrl?.startsWith('http')) {
      pushLog('info', `Результат: ${resultUrl}`);
    }
  },
  aborted: () => resetReloadFlag(),
  error: event => pushLog('error', String(event.message))
};

export function onSolverEvent(event: any, meta: any) {
  if (!event || typeof event !== 'object') return;
  if (event.type === 'log') {
    pushLog(event.level, event.message);
    return;
  }
  if (event.type === 'llm-context') {
    pushLlmLog({
      kind: meta.kind,
      item: meta.item?.name || '',
      level: meta.level?.name || '',
      taskId: event.taskId,
      number: event.number,
      total: event.total,
      attempt: event.attempt ?? 0,
      subType: event.subType || '',
      question: event.question,
      history: event.history || null,
      status: 'pending'
    });
    return;
  }
  if (event.type === 'llm-response') {
    updateLatestLlmLog({
      taskId: event.taskId,
      number: event.number,
      attempt: event.attempt,
      response: event.response,
      durationMs: event.durationMs,
      status: event.status || 'success',
      error: event.error || null
    });
    return;
  }
  if (state.run && ['total', 'task', 'submitted', 'timeLeft'].includes(event.type)) {
    const current = state.run.progress || { number: 0, total: null };
    state.run.progress = {
      number: Number.isInteger(event.number) ? event.number : current.number,
      total: Number.isInteger(event.total) ? event.total : current.total
    };
    const job = state.jobs.find(entry => entry.status === 'running');
    if (job) job.progress = { ...state.run.progress };
    if (event.type === 'timeLeft') {
      state.run.timeLeft = event.seconds;
      state.run.timeLeftAt = Date.now();
    }
    saveCheckpoint();
  }
  SOLVER_EVENT_HANDLERS[event.type]?.(event, meta);
}
