// Shared test utilities and helpers for reliable and fast assertions.

export async function waitFor<T>(
  predicate: () => Promise<T> | T,
  {
    timeoutMs = 3000,
    stepMs = 5,
    message = 'Condition not met within timeout'
  }: { timeoutMs?: number; stepMs?: number; message?: string } = {}
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const result = await predicate();
      if (result) return result;
    } catch {}
    await new Promise(resolve => setTimeout(resolve, stepMs));
  }
  const lastState = await Promise.resolve()
    .then(predicate)
    .catch(err => err);
  throw new Error(`${message} (timeout ${timeoutMs}ms, last state: ${JSON.stringify(lastState)})`);
}

export function createTestJob({
  id = 1114,
  name = 'Python',
  category = 'LANG',
  levelId = 8,
  levelName = 'Базовый',
  methodId = 294,
  methodName = 'Теория',
  kind = 'theory' as const
}: {
  id?: number;
  name?: string;
  category?: string;
  levelId?: number;
  levelName?: string;
  methodId?: number;
  methodName?: string;
  kind?: 'theory' | 'practice';
} = {}) {
  const item = {
    id,
    name,
    category,
    levels: [{ id: levelId, name: levelName, rank: 1 }]
  };
  return {
    item,
    level: item.levels[0],
    method: { id: methodId, name: methodName },
    kind
  };
}

export function createTestSettings({
  baseUrl = 'https://api.test/v1',
  apiKey = 'test-key',
  model = 'test-model',
  reasoning = '',
  zeroTimings = true
}: {
  baseUrl?: string;
  apiKey?: string;
  model?: string;
  reasoning?: string;
  zeroTimings?: boolean;
} = {}) {
  return {
    baseUrl,
    apiKey,
    model,
    reasoning,
    timings: zeroTimings
      ? {
          theory: { answerMinMs: 0, answerMaxMs: 0, betweenMinMs: 0, betweenMaxMs: 0 },
          practice: { typingMinMs: 0, typingMaxMs: 0, retryTypingMinMs: 0, retryTypingMaxMs: 0 },
          betweenTestsMinMs: 0,
          betweenTestsMaxMs: 0
        }
      : undefined
  };
}
