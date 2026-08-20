import { buildTheoryMessages } from '../prompts/theory.ts';
import { buildPracticeMessages } from '../prompts/practice.ts';
import { sleep } from './timing.ts';

// Network retries for LLM API calls. Only transient errors are retried:
// network failure, timeout, HTTP 429 (rate limit), 5xx, and an empty model
// answer (a proxy returning an empty reply — a retry usually fixes it).
// 4xx, broken JSON and external cancellation are not retried.
export const MAX_RETRIES = 4;
export const RETRY_BASE_DELAY_MS = 1500;
export const RETRY_MAX_DELAY_MS = 12000;
// An empty response is a transient failure (gpt-5.x via proxy): re-ask up to
// 10 times in a row. It doesn't consume the network counter (MAX_RETRIES).
export const MAX_EMPTY_RETRIES = 9;
const ATTEMPT_TIMEOUT_MS = 180000;

function logRetry(attempt: number, maxRetries: number, error: any) {
  try {
    const message = String(error?.message || error || '').split('\n')[0];
    console.info(`[hh-assist] llm: ретрай ${attempt}/${maxRetries} — ${message}`);
  } catch {}
}

function retryableStatus(status: number) {
  return status === 429 || status >= 500;
}

function retryAfterMs(response: Response) {
  try {
    const value = response?.headers?.get?.('retry-after');
    if (!value) return 0;
    const seconds = Number.parseFloat(value);
    if (Number.isFinite(seconds) && seconds >= 0) return Math.ceil(seconds) * 1000;
    const date = Date.parse(value);
    if (Number.isFinite(date)) return Math.max(0, date - Date.now());
  } catch {}
  return 0;
}

function cancellationError() {
  const error: any = new Error('Запрос отменён');
  error.name = 'AbortError';
  return error;
}

// Every error leaving this module means the LLM API failed (network, HTTP,
// empty answer, timeout, broken JSON). The code tag lets the queue abort the
// remaining tests instead of spoiling more attempts. User/queue cancellation
// (AbortError) is intentionally NOT tagged.
function llmError(error: any) {
  if (error && typeof error === 'object' && error.name !== 'AbortError') error.code = 'LLM_API';
  return error;
}

function isRetryableError(error: any, externalSignal?: AbortSignal) {
  if (externalSignal?.aborted) return false;
  const name = error?.name;
  if (name === 'AbortError') return false;
  if (error?.status !== undefined) return retryableStatus(Number(error.status));
  if (error?.timedOut === true) return true;
  // Network failures (Failed to fetch etc.) arrive as TypeError.
  const isNetworkError =
    error instanceof TypeError ||
    /fetch|network|ECONN|ETIMEDOUT/i.test(String(error?.message || error || ''));
  if (isNetworkError) return true;
  return false;
}

// A single HTTP attempt. The timeout is per-attempt (default 60 s): a slow
// response doesn't cancel later retries. External cancellation (task switch,
// reset) aborts both the attempt and the retry loop. opts.timeoutMs caps a
// single attempt — used by the pre-test API probe.
async function attemptRequest(
  url: string,
  messages: any,
  config: any,
  externalSignal?: AbortSignal,
  timeoutMs?: number
): Promise<string> {
  const controller = new AbortController();
  let timedOut = false;
  const abortFromCaller = () => controller.abort();
  if (externalSignal) {
    if (externalSignal.aborted) controller.abort();
    else externalSignal.addEventListener('abort', abortFromCaller, { once: true });
  }
  const limitMs = Number.isFinite(timeoutMs) && timeoutMs! > 0 ? timeoutMs! : ATTEMPT_TIMEOUT_MS;
  const timeout = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, limitMs);

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.apiKey}`
      },
      body: JSON.stringify({
        model: config.model,
        // Task chat history (practice): [system, user-condition, assistant-code,
        // user-results…] — the model sees the whole chain of attempts. Theory
        // is a single [system, user].
        messages: messages.messages
          ? [{ role: 'system', content: messages.system }, ...messages.messages]
          : [
              { role: 'system', content: messages.system },
              { role: 'user', content: messages.user }
            ],
        ...(config.reasoning ? { reasoning_effort: config.reasoning } : { temperature: 0.2 })
      }),
      signal: controller.signal
    });

    const responseBody = await response.text();
    if (!response.ok) {
      const error: any = new Error(`HTTP ${response.status} ${responseBody.slice(0, 300)}`);
      error.status = response.status;
      error.retryAfterMs = retryAfterMs(response);
      throw error;
    }

    let json: any;
    try {
      json = JSON.parse(responseBody);
    } catch {
      throw llmError(new Error('API вернуло некорректный JSON'));
    }
    const content = json?.choices?.[0]?.message?.content;
    if (content == null || !String(content).trim())
      throw llmError(new Error('Пустой ответ модели'));
    return String(content).trim();
  } catch (error) {
    if (externalSignal?.aborted) throw cancellationError();
    if (timedOut && !externalSignal?.aborted) {
      const seconds = Math.max(1, Math.round(limitMs / 1000));
      const err: any = new Error(`Таймаут ожидания ответа модели (${seconds} c)`);
      err.timedOut = true;
      throw llmError(err);
    }
    throw llmError(error);
  } finally {
    clearTimeout(timeout);
    if (externalSignal) externalSignal.removeEventListener('abort', abortFromCaller);
  }
}

export interface CallLLMOptions {
  retries?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  emptyRetries?: number;
  timeoutMs?: number;
}

export async function callLLM(
  config: any,
  question: any,
  externalSignal?: AbortSignal,
  opts: CallLLMOptions = {}
): Promise<string> {
  if (externalSignal?.aborted) throw cancellationError();
  const url = `${config.baseUrl.replace(/\/+$/, '')}/chat/completions`;
  const messages = question?.messages
    ? question
    : question?.kind === 'raw' || question?.kind === 'probe'
      ? {
          system: question.system || 'Ты полезный ИИ-помощник.',
          user: question.question || question.user
        }
      : question?.kind === 'code'
        ? buildPracticeMessages(config, question)
        : buildTheoryMessages(config, question);

  const maxRetries = Number.isInteger(opts.retries) ? opts.retries! : MAX_RETRIES;
  const baseDelayMs = Number.isFinite(opts.baseDelayMs) ? opts.baseDelayMs! : RETRY_BASE_DELAY_MS;
  const maxDelayMs = Number.isFinite(opts.maxDelayMs) ? opts.maxDelayMs! : RETRY_MAX_DELAY_MS;
  const emptyRetries = Number.isInteger(opts.emptyRetries) ? opts.emptyRetries! : MAX_EMPTY_RETRIES;
  const timeoutMs =
    Number.isFinite(opts.timeoutMs) && opts.timeoutMs! > 0 ? opts.timeoutMs! : ATTEMPT_TIMEOUT_MS;

  // Two independent limits: network retries (network/429/5xx, with backoff) and
  // "empty answer" (immediate re-ask — doesn't spend the network counter;
  // emptiness arrives instantly, so no backoff is needed).
  let networkAttempt = 0;
  let emptyAttempt = 0;
  let lastError: any = null;
  for (;;) {
    try {
      return await attemptRequest(url, messages, config, externalSignal, timeoutMs);
    } catch (error) {
      lastError = error;
      const isEmpty = /пустой ответ/i.test(String((error as any)?.message || ''));
      if (isEmpty) {
        // An empty answer uses only its own re-ask limit; network backoff does
        // not apply (emptiness is unrelated to the network).
        if (emptyAttempt >= emptyRetries) break;
        emptyAttempt++;
        logRetry(emptyAttempt, emptyRetries, error);
        continue;
      }
      if (networkAttempt >= maxRetries || !isRetryableError(error, externalSignal)) break;
      networkAttempt++;
      const hasRetryAfter = Boolean(lastError.retryAfterMs);
      const delayMs = hasRetryAfter
        ? Math.min(lastError.retryAfterMs, maxDelayMs)
        : Math.min(
            baseDelayMs * 2 ** (networkAttempt - 1) * (0.8 + Math.random() * 0.4),
            maxDelayMs
          );
      logRetry(networkAttempt, maxRetries, error);
      await sleep(delayMs, { signal: externalSignal, jitter: !hasRetryAfter });
      // Aborted during the backoff pause: don't burn another doomed attempt.
      if (externalSignal?.aborted) throw cancellationError();
    }
  }
  throw llmError(lastError);
}
