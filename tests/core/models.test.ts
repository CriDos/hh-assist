import { test, afterEach, assert, expect, vi } from 'vitest';
import { EFFORT_VALUES } from '../../src/core/models.ts';

afterEach(() => {
  delete (globalThis as any).fetch;
  delete (globalThis as any).chrome;
});

test('models: listModels strips the trailing slash, sorts and dedupes ids', async () => {
  const { listModels } = await import('../../src/core/models.ts');
  let requestedUrl: any = null;
  globalThis.fetch = async (url: any) => {
    requestedUrl = url;
    return {
      ok: true,
      json: async () => ({ data: [{ id: 'gamma' }, { id: 'alpha' }, { id: 'gamma' }] })
    } as any;
  };

  const models = await listModels('https://api.test/v1/', 'key');
  assert.equal(requestedUrl, 'https://api.test/v1/models');
  assert.deepEqual(models, ['alpha', 'gamma']);
});

test('models: cachedModels/saveCachedModels round-trip via storage.local', async () => {
  const { cachedModels, saveCachedModels } = await import('../../src/core/models.ts');
  const store: Record<string, any> = {};
  (globalThis as any).chrome = {
    storage: {
      local: {
        get: async (key: any) =>
          typeof key === 'string' ? { [key]: store[key] } : Object.assign({}, key, store),
        set: async (obj: any) => Object.assign(store, obj)
      }
    }
  };

  assert.equal(await cachedModels('https://api.test/v1'), null, 'без кэша — null');
  await saveCachedModels('https://api.test/v1', ['a', 'b'], { a: { reasoning: true } } as any);
  const entry = await cachedModels('https://api.test/v1/');
  assert.deepEqual(entry?.models, ['a', 'b']);
  assert.equal(entry?.meta?.a?.reasoning, true);
  assert.ok((entry?.at || 0) > 0);
  assert.equal(await cachedModels('https://other.test'), null, 'кэш изолирован по baseUrl');
});

test('listModels throws on http errors and empty lists', async () => {
  const { listModels } = await import('../../src/core/models.ts');
  globalThis.fetch = async () => ({ ok: false, status: 403, text: async () => 'forbidden' }) as any;
  await expect(listModels('https://api.test/v1', 'k')).rejects.toThrow(/HTTP 403 forbidden/);

  globalThis.fetch = async () => ({ ok: true, json: async () => ({ data: [] }) }) as any;
  await expect(listModels('https://api.test/v1', 'k')).rejects.toThrow(/не вернуло моделей/);
});

test('loadModelsDev caches in memory and returns a valid session stash without fetching', async () => {
  const { loadModelsDev } = await import('../../src/core/models.ts');
  let calls = 0;
  const payload = { bernoulli: { models: [] } };
  globalThis.fetch = async () => {
    calls++;
    return { ok: true, json: async () => payload } as any;
  };
  const session: Record<string, any> = {};
  (globalThis as any).chrome = {
    storage: {
      session: {
        get: async (key: any) =>
          typeof key === 'string' ? { [key]: session[key] } : Object.assign({}, key, session),
        set: async (obj: any) => Object.assign(session, obj)
      }
    }
  };

  const first = await loadModelsDev();
  const second = await loadModelsDev();
  assert.equal(first, payload);
  assert.equal(second, payload);
  assert.equal(calls, 1, 'both calls must hit one fetch and the in-memory cache');
});

test('loadModelsDev trusts a fresh session stash and refetches an expired one', async () => {
  const makeLoader = async (stash: any) => {
    const session: Record<string, any> = { mdv: stash };
    (globalThis as any).chrome = {
      storage: {
        session: {
          get: async (key: any) =>
            typeof key === 'string' ? { [key]: session[key] } : Object.assign({}, key, session),
          set: async (obj: any) => Object.assign(session, obj)
        }
      }
    };
    let calls = 0;
    const freshData = { provider: 'refetched' };
    globalThis.fetch = async () => {
      calls++;
      return { ok: true, json: async () => freshData } as any;
    };
    vi.resetModules();
    const { loadModelsDev } = await import('../../src/core/models.ts');
    const data = await loadModelsDev();
    return { data, calls };
  };

  const fresh = await makeLoader({ data: { provider: 'stashed' }, at: Date.now() });
  assert.equal(fresh.calls, 0, 'a fresh session stash must avoid the network');
  assert.equal(fresh.data.provider, 'stashed');

  const expired = await makeLoader({
    data: { provider: 'stale' },
    at: Date.now() - 7 * 60 * 60 * 1000
  });
  assert.equal(expired.calls, 1, 'an expired stash must refetch');
  assert.equal(expired.data.provider, 'refetched');
});

test('loadModelsDev backoff: after a failure the fetch is skipped for a while, but the stash still wins', async () => {
  let calls = 0;
  (globalThis as any).chrome = {
    storage: {
      session: {
        get: async () => ({}),
        set: async () => {}
      }
    }
  };
  globalThis.fetch = async () => {
    calls++;
    throw new Error('network down');
  };
  vi.resetModules();
  const { loadModelsDev } = await import('../../src/core/models.ts');
  await expect(loadModelsDev()).rejects.toThrow(/network down/);
  await expect(loadModelsDev()).rejects.toThrow(/recent failure, skipping/);
  assert.equal(calls, 1, 'the second call must skip the network because of the backoff');

  const stashed = { provider: 'stash-wins' };
  (globalThis as any).chrome = {
    storage: {
      session: {
        get: async () => ({ mdv: { data: stashed, at: Date.now() } }),
        set: async () => {}
      }
    }
  };
  vi.resetModules();
  const { loadModelsDev: loadWithStash } = await import('../../src/core/models.ts');
  const data = await loadWithStash();
  assert.equal(data.provider, 'stash-wins');
});

test('providerMeta maps requested ids via base name and picks the strongest reasoning option', async () => {
  const { providerMeta } = await import('../../src/core/models.ts');
  const dev = [
    {
      models: {
        'a/some-model': { reasoning_options: [{ type: 'effort', values: ['low'] }] },
        'b/some-model': { reasoning_options: [{ type: 'effort', values: ['low', 'high', 'max'] }] }
      }
    }
  ];

  const meta = providerMeta(dev as any, ['some-model']);
  assert.ok(meta['some-model'], 'provider meta must include a matching model id');
  assert.equal(meta['some-model'].source, 'global');
  assert.deepEqual(meta['some-model'].efforts, ['low', 'high', 'max']);
  assert.equal(meta['some-model'].reasoning, false);
});

test('reasoningInfo parses effort, toggle and budget options and filters unknown efforts', async () => {
  const { providerMeta } = await import('../../src/core/models.ts');
  const dev = [
    {
      models: {
        'toggle-model': { reasoning: true, reasoning_options: [{ type: 'toggle' }] },
        'budget-model': {
          reasoning: true,
          reasoning_options: [{ type: 'budget_tokens', min: 256, max: 4096 }]
        },
        'dirty-model': {
          reasoning: true,
          reasoning_options: [{ type: 'effort', values: ['low', 'bot', 'high'] }]
        }
      }
    }
  ];

  const meta = providerMeta(dev as any, ['toggle-model', 'budget-model', 'dirty-model']);
  assert.equal(meta['toggle-model'].toggle, true);
  assert.deepEqual(meta['budget-model'].budget, { min: 256, max: 4096 });
  assert.deepEqual(meta['dirty-model'].efforts, ['low', 'high']);
});

test('EFFORT_VALUES exposes a stable whitelist', () => {
  assert.deepEqual(EFFORT_VALUES, [
    'none',
    'minimal',
    'low',
    'medium',
    'high',
    'xhigh',
    'max',
    'default'
  ]);
});

test('PRESET_PROVIDERS contains OpenCode Zen with correct endpoint', async () => {
  const { PRESET_PROVIDERS } = await import('../../src/core/models.ts');
  const opencode = PRESET_PROVIDERS.find(p => p.id === 'opencode');
  assert.ok(opencode, 'OpenCode Zen provider must be present in presets');
  assert.equal(opencode.name, 'OpenCode Zen');
  assert.equal(opencode.baseUrl, 'https://opencode.ai/zen/go/v1');
});
