import { test, afterEach, assert, expect } from 'vitest';

const API = {
  baseUrl: 'https://api.test/v1/',
  apiKey: 'secret-key',
  model: 'model-x',
  reasoning: ''
};

function captureFetch() {
  let captured: any = null;
  globalThis.fetch = async (url: any, opts: any) => {
    captured = { url, headers: opts.headers, body: JSON.parse(opts.body) };
    return {
      ok: true,
      text: async () => JSON.stringify({ choices: [{ message: { content: 'ok' } }] })
    } as any;
  };
  return () => captured;
}

afterEach(() => {
  delete (globalThis as any).fetch;
});

test('llm: request uses trimmed base URL and falls back to temperature without reasoning', async () => {
  const { callLLM } = await import('../../src/core/llm.ts');
  const read = captureFetch();
  const answer = await callLLM(API, { kind: 'test', question: 'Вопрос?' });

  const captured = read();
  assert.equal(captured.url, 'https://api.test/v1/chat/completions');
  assert.equal(captured.headers.Authorization, 'Bearer secret-key');
  assert.equal(captured.body.model, 'model-x');
  assert.equal(captured.body.temperature, 0.2);
  assert.equal(captured.body.reasoning_effort, undefined);
  assert.equal(answer, 'ok');
});

test('llm: reasoning_effort replaces temperature when configured', async () => {
  const { callLLM } = await import('../../src/core/llm.ts');
  const read = captureFetch();
  await callLLM({ ...API, reasoning: 'high' }, { kind: 'test', question: '?' });

  const captured = read();
  assert.equal(captured.body.reasoning_effort, 'high');
  assert.equal(captured.body.temperature, undefined);
});

test('llm: http errors carry status and body snippet', async () => {
  const { callLLM } = await import('../../src/core/llm.ts');
  globalThis.fetch = async () =>
    ({ ok: false, status: 401, text: async () => 'invalid api key' }) as any;
  await expect(callLLM(API, { kind: 'test', question: '?' })).rejects.toThrow(
    /HTTP 401 invalid api key/
  );
});

test('llm: API failures are tagged LLM_API, cancellation is not', async () => {
  const { callLLM, MAX_EMPTY_RETRIES } = await import('../../src/core/llm.ts');
  // HTTP error (not retried — 4xx).
  globalThis.fetch = async () =>
    ({ ok: false, status: 401, text: async () => 'invalid api key' }) as any;
  await expect(callLLM(API, { kind: 'test', question: '?' })).rejects.toSatisfy(
    (error: any) => error.code === 'LLM_API'
  );

  // Empty answer exhausted.
  globalThis.fetch = async () =>
    ({
      ok: true,
      text: async () => JSON.stringify({ choices: [{ message: { content: ' ' } }] })
    }) as any;
  await expect(callLLM(API, { kind: 'test', question: '?' })).rejects.toSatisfy(
    (error: any) => error.code === 'LLM_API'
  );
  assert.ok(MAX_EMPTY_RETRIES > 0);

  // Network failure (TypeError) after retries.
  globalThis.fetch = async () => {
    throw new TypeError('Failed to fetch');
  };
  await expect(
    callLLM(API, { kind: 'test', question: '?' }, undefined, {
      retries: 1,
      baseDelayMs: 1,
      maxDelayMs: 1
    })
  ).rejects.toSatisfy((error: any) => error.code === 'LLM_API');

  // Caller cancellation is NOT tagged.
  const signal = new AbortController();
  signal.abort();
  await expect(callLLM(API, { kind: 'test', question: '?' }, signal.signal)).rejects.toSatisfy(
    (error: any) => error.name === 'AbortError' && !error.code
  );
});

test('llm: invalid JSON is rejected (non-transient)', async () => {
  const { callLLM } = await import('../../src/core/llm.ts');
  globalThis.fetch = async () => ({ ok: true, text: async () => 'not-json' }) as any;
  await expect(callLLM(API, { kind: 'test', question: '?' })).rejects.toThrow(/некорректный JSON/);
});

test('llm: empty content is retried up to the empty-retry budget, then rejected', async () => {
  const { callLLM, MAX_EMPTY_RETRIES } = await import('../../src/core/llm.ts');
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    return {
      ok: true,
      text: async () => JSON.stringify({ choices: [{ message: { content: '  ' } }] })
    } as any;
  };
  await expect(callLLM(API, { kind: 'test', question: '?' })).rejects.toThrow(
    /Пустой ответ модели/
  );
  assert.equal(
    calls,
    MAX_EMPTY_RETRIES + 1,
    'последний пустой ответ отдаётся после всех переспросов'
  );
});

test('llm: empty content recovers on a later attempt', async () => {
  const { callLLM } = await import('../../src/core/llm.ts');
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    return {
      ok: true,
      text: async () => {
        if (calls <= 2) return JSON.stringify({ choices: [{ message: { content: '  ' } }] });
        return JSON.stringify({ choices: [{ message: { content: 'ok' } }] });
      }
    } as any;
  };
  const answer = await callLLM(API, { kind: 'test', question: '?' }, undefined, {
    emptyRetries: 3
  });
  assert.equal(answer, 'ok');
  assert.equal(calls, 3, 'два пустых + успешный третий');
});

test('llm: an already-aborted caller aborts the request', async () => {
  const { callLLM } = await import('../../src/core/llm.ts');
  const controller = new AbortController();
  controller.abort();
  globalThis.fetch = (_url: any, opts: any) =>
    new Promise((_resolve, reject) => {
      if (opts.signal?.aborted) reject(new Error('fetch aborted'));
      else reject(new Error('not aborted'));
    });
  await expect(callLLM(API, { kind: 'test', question: '?' }, controller.signal)).rejects.toThrow(
    /Запрос отменён/
  );
});

test('llm: a timeout aborts the request with a readable error', async () => {
  const { callLLM } = await import('../../src/core/llm.ts');
  const realSetTimeout = globalThis.setTimeout;
  const realClearTimeout = globalThis.clearTimeout;
  (globalThis as any).setTimeout = (fn: any) => {
    fn();
    return 1;
  };
  (globalThis as any).clearTimeout = () => {};
  globalThis.fetch = (_url: any, opts: any) =>
    new Promise((_resolve, reject) => {
      if (opts.signal?.aborted) reject(new Error('aborted'));
      else opts.signal.addEventListener('abort', () => reject(new Error('aborted')));
    });
  try {
    await expect(callLLM(API, { kind: 'test', question: '?' })).rejects.toThrow(
      /Таймаут ожидания ответа модели \(\d+ c\)/
    );
  } finally {
    globalThis.setTimeout = realSetTimeout;
    globalThis.clearTimeout = realClearTimeout;
  }
});

test('llm: timeoutMs caps a single attempt (pre-test probe)', async () => {
  const { callLLM } = await import('../../src/core/llm.ts');
  const realSetTimeout = globalThis.setTimeout;
  const realClearTimeout = globalThis.clearTimeout;
  (globalThis as any).setTimeout = (fn: any) => {
    fn();
    return 1;
  };
  (globalThis as any).clearTimeout = () => {};
  globalThis.fetch = (_url: any, opts: any) =>
    new Promise((_resolve, reject) => {
      if (opts.signal?.aborted) reject(new Error('aborted'));
      else opts.signal.addEventListener('abort', () => reject(new Error('aborted')));
    });
  try {
    await expect(
      callLLM(API, { kind: 'test', question: '?' }, undefined, { timeoutMs: 5000 })
    ).rejects.toThrow(/Таймаут ожидания ответа модели \(5 c\)/);
  } finally {
    globalThis.setTimeout = realSetTimeout;
    globalThis.clearTimeout = realClearTimeout;
  }
});

test('llm: rate limited (429) with retry-after is retried once then succeeds', async () => {
  const { callLLM } = await import('../../src/core/llm.ts');
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    if (calls === 1) {
      return {
        ok: false,
        status: 429,
        headers: { get: (name: string) => (name === 'retry-after' ? '1' : null) },
        text: async () => 'rate limited'
      } as any;
    }
    return {
      ok: true,
      text: async () => JSON.stringify({ choices: [{ message: { content: 'ok' } }] })
    } as any;
  };
  const answer = await callLLM(API, { kind: 'test', question: '?' }, undefined, {
    retries: 2,
    baseDelayMs: 1,
    maxDelayMs: 5
  });
  assert.equal(answer, 'ok');
  assert.equal(calls, 2);
});

test('llm: transient failures are retried up to the configured count', async () => {
  const { callLLM } = await import('../../src/core/llm.ts');
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    if (calls < 5) throw new TypeError('Failed to fetch');
    return {
      ok: true,
      text: async () => JSON.stringify({ choices: [{ message: { content: 'ok' } }] })
    } as any;
  };
  const answer = await callLLM(API, { kind: 'test', question: '?' }, undefined, {
    retries: 4,
    baseDelayMs: 1,
    maxDelayMs: 2
  });
  assert.equal(answer, 'ok');
  assert.equal(calls, 5, 'first attempt plus four retries');
});

test('llm: gives up with the last error after retries are exhausted', async () => {
  const { callLLM } = await import('../../src/core/llm.ts');
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    return { ok: false, status: 503, text: async () => 'unavailable' } as any;
  };
  await expect(
    callLLM(API, { kind: 'test', question: '?' }, undefined, { retries: 2, baseDelayMs: 1 })
  ).rejects.toThrow(/HTTP 503 unavailable/);
  assert.equal(calls, 3, 'first attempt plus two retries');
});

test('llm: 4xx errors are not retried', async () => {
  const { callLLM } = await import('../../src/core/llm.ts');
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    return { ok: false, status: 400, text: async () => 'bad request' } as any;
  };
  await expect(
    callLLM(API, { kind: 'test', question: '?' }, undefined, { retries: 4, baseDelayMs: 1 })
  ).rejects.toThrow(/HTTP 400 bad request/);
  assert.equal(calls, 1, 'non-transient errors must reach the caller immediately');
});

test('llm: retries stop when the caller aborts during backoff', async () => {
  const { callLLM } = await import('../../src/core/llm.ts');
  const controller = new AbortController();
  let calls = 0;
  globalThis.fetch = async (_url: any, opts: any) => {
    calls++;
    if (opts.signal?.aborted) throw new Error('fetch aborted');
    return { ok: false, status: 503, text: async () => 'unavailable' } as any;
  };
  const timer = setTimeout(() => controller.abort(), 10);
  await expect(
    callLLM(API, { kind: 'test', question: '?' }, controller.signal, {
      retries: 4,
      baseDelayMs: 200
    })
  ).rejects.toThrow(/Запрос отменён/);
  clearTimeout(timer);
  assert.equal(calls, 1, 'the loop breaks on the abort — no doomed extra attempt');
});

test('llm: code answers pass through as-is (no semantic validation)', async () => {
  const { callLLM } = await import('../../src/core/llm.ts');
  const template = 'class T {\n    return "";\n}';

  globalThis.fetch = async () =>
    ({
      ok: true,
      text: async () =>
        JSON.stringify({ choices: [{ message: { content: 'class T {\n    return 42;\n}' } }] })
    }) as any;
  const full = await callLLM(API, { kind: 'code', template, question: 'Задача' });
  assert.equal(full, 'class T {\n    return 42;\n}');

  globalThis.fetch = async () =>
    ({
      ok: true,
      text: async () => JSON.stringify({ choices: [{ message: { content: 'return 42;' } }] })
    }) as any;
  const fragment = await callLLM(API, { kind: 'code', template, question: 'Задача' });
  assert.equal(fragment, 'return 42;', 'fragment answers are accepted as-is');
});

test('llm: invalid JSON response throws LLM_API error without retry loop', async () => {
  const { callLLM } = await import('../../src/core/llm.ts');
  globalThis.fetch = async () =>
    ({
      ok: true,
      text: async () => '<html><body>Bad Gateway</body></html>'
    }) as any;
  await expect(
    callLLM(API, { kind: 'test', question: '?' }, undefined, { retries: 2, baseDelayMs: 1 })
  ).rejects.toSatisfy((error: any) => error.code === 'LLM_API' && /JSON/.test(error.message));
});
