import { test, assert } from 'vitest';
import { getAppVersion, copyToClipboard, send } from '../../src/panel/services/extension.ts';
import { APP_VERSION } from '../../src/core/version.ts';

test('panel extension service: getAppVersion returns manifest version or fallback', () => {
  (globalThis as any).chrome = {
    runtime: {
      getManifest: () => ({ version: '9.9.9' })
    }
  };
  assert.equal(getAppVersion(), '9.9.9');

  (globalThis as any).chrome = undefined;
  assert.equal(getAppVersion(), APP_VERSION);
});

test('panel extension service: copyToClipboard uses navigator.clipboard', async () => {
  let copiedText = '';
  const mockClipboard = {
    writeText: async (text: string) => {
      copiedText = text;
    }
  };

  try {
    Object.defineProperty(globalThis.navigator, 'clipboard', {
      value: mockClipboard,
      configurable: true
    });
  } catch {}

  const ok = await copyToClipboard('test clipboard text');
  assert.equal(ok, true);
  assert.equal(copiedText, 'test clipboard text');
});

test('panel extension service: send resolves null when chrome.runtime is missing', async () => {
  (globalThis as any).chrome = undefined;
  const res = await send({ type: 'test' } as any);
  assert.equal(res, null);
});
