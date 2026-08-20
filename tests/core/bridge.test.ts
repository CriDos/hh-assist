import { test, afterEach, assert, expect } from 'vitest';
import {
  bridgeFetch,
  createBridgeFetch,
  loadSettings,
  saveSettings,
  SETTINGS_KEY
} from '../../src/core/bridge.ts';

afterEach(() => {
  delete (globalThis as any).document;
  delete (globalThis as any).fetch;
  delete (globalThis as any).chrome;
});

test('bridgeFetch: attaches X-XSRFToken from document.cookie when header is missing', async () => {
  (globalThis as any).document = { cookie: 'other=123; _xsrf=test-xsrf-token%20123; session=abc' };
  let capturedInit: any = null;
  (globalThis as any).fetch = async (_url: string, init: any) => {
    capturedInit = init;
    return {
      status: 200,
      ok: true,
      text: async () => '{"status":"ok"}'
    };
  };

  const response = await bridgeFetch('https://assessment.hh.ru/api/test', { method: 'POST' });
  assert.equal(response.status, 200);
  assert.equal(response.ok, true);
  assert.equal(response.text, '{"status":"ok"}');
  assert.equal(capturedInit.headers['X-XSRFToken'], 'test-xsrf-token 123');
});

test('bridgeFetch: keeps existing X-XSRFToken if explicitly provided', async () => {
  (globalThis as any).document = { cookie: '_xsrf=from-cookie' };
  let capturedInit: any = null;
  (globalThis as any).fetch = async (_url: string, init: any) => {
    capturedInit = init;
    return {
      status: 200,
      ok: true,
      text: async () => 'ok'
    };
  };

  await bridgeFetch('https://assessment.hh.ru/api/test', {
    headers: { 'X-XSRFToken': 'explicit-token' }
  });
  assert.equal(capturedInit.headers['X-XSRFToken'], 'explicit-token');
});

test('createBridgeFetch: delegates execution to executeScript and returns response-like object', async () => {
  let executedTarget: any = null;
  let executedArgs: any = null;
  const mockExecuteScript = async ({ target, func, args }: any) => {
    executedTarget = target;
    executedArgs = args;
    assert.equal(func, bridgeFetch);
    return [{ result: { status: 200, ok: true, text: '{"ok":true}' } }];
  };

  const fetchImpl = createBridgeFetch({ tabId: 42, executeScript: mockExecuteScript });
  const response = await fetchImpl('https://assessment.hh.ru/shards/task', { method: 'GET' });

  assert.equal(executedTarget.tabId, 42);
  assert.equal(executedArgs[0], 'https://assessment.hh.ru/shards/task');
  assert.equal(response.status, 200);
  assert.equal(response.ok, true);
  assert.equal(response.text(), '{"ok":true}');
});

test('createBridgeFetch: throws error when bridge execution returns null or empty', async () => {
  const mockExecuteScript = async () => [{ result: null as any }];
  const fetchImpl = createBridgeFetch({ tabId: 42, executeScript: mockExecuteScript });

  await expect(fetchImpl('https://assessment.hh.ru/shards/task')).rejects.toThrow(
    'Мост вкладки не вернул результат'
  );
});

test('loadSettings and saveSettings: interact correctly with storage', async () => {
  const store: Record<string, any> = {};
  const mockStorage: any = {
    get: async (key: string) => ({ [key]: store[key] }),
    set: async (items: any) => Object.assign(store, items)
  };

  const initial = await loadSettings(mockStorage);
  assert.deepEqual(initial, {});

  const settingsToSave = { baseUrl: 'https://api.test', apiKey: 'k1', model: 'm1' };
  await saveSettings(settingsToSave, mockStorage);

  assert.deepEqual(store[SETTINGS_KEY], settingsToSave);

  const loaded = await loadSettings(mockStorage);
  assert.deepEqual(loaded, settingsToSave);
});
