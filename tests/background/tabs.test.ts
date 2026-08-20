import { test, beforeEach, afterEach, assert } from 'vitest';
import {
  contestTokenFromUrl,
  waitTabComplete,
  ensureMainTab,
  returnToCatalog,
  launchTestTab,
  ensureGate,
  gateTaskId,
  gateReport,
  gateHeartbeat,
  setSolverTab,
  isHhDomain,
  getHhOrigin
} from '../../src/background/tabs.ts';
import { resetState } from '../../src/background/state.ts';

let mockTabs: Record<number, any> = {};
let createdTabs: any[] = [];
let updatedTabs: any[] = [];
let executedScripts: any[] = [];

beforeEach(() => {
  resetState();
  mockTabs = {};
  createdTabs = [];
  updatedTabs = [];
  executedScripts = [];

  (globalThis as any).chrome = {
    tabs: {
      get: async (id: number) => {
        if (!mockTabs[id]) throw new Error('tab not found');
        return mockTabs[id];
      },
      query: async ({ url: _url }: any) => {
        return Object.values(mockTabs).filter(
          t =>
            t.url &&
            (t.url.includes('hh.ru') || t.url.includes('rabota.by') || t.url.includes('hh.kz'))
        );
      },
      create: async ({ url, active }: any) => {
        const id = 100 + createdTabs.length;
        const newTab = { id, url, active, status: 'complete' };
        mockTabs[id] = newTab;
        createdTabs.push(newTab);
        return newTab;
      },
      update: async (id: number, opts: any) => {
        if (!mockTabs[id]) throw new Error('tab not found');
        Object.assign(mockTabs[id], opts);
        updatedTabs.push({ id, ...opts });
        return mockTabs[id];
      },
      onUpdated: { addListener: () => {} }
    },
    scripting: {
      executeScript: async ({ target, world, func, args }: any) => {
        executedScripts.push({ target, world, func, args });
        return [{ result: true }];
      }
    }
  };
});

afterEach(() => {
  delete (globalThis as any).chrome;
});

test('tabs: contestTokenFromUrl extracts token correctly or returns null', () => {
  assert.equal(
    contestTokenFromUrl('https://assessment.hh.ru/tests/123?contestToken=tok-12345'),
    'tok-12345'
  );
  assert.equal(
    contestTokenFromUrl('https://assessment.hh.ru/code/42?step=1&contestToken=my%20token&foo=bar'),
    'my token'
  );
  assert.equal(contestTokenFromUrl('https://assessment.hh.ru/tests/123'), null);
  assert.equal(contestTokenFromUrl(''), null);
  assert.equal(contestTokenFromUrl(null as any), null);
  assert.equal(contestTokenFromUrl(undefined as any), null);
});

test('tabs: waitTabComplete resolves when tab status becomes complete', async () => {
  mockTabs[10] = { id: 10, status: 'loading', url: 'https://test.com' };

  // Asynchronously complete the tab after 20ms
  setTimeout(() => {
    if (mockTabs[10]) mockTabs[10].status = 'complete';
  }, 20);

  const tab = await waitTabComplete(10, { timeoutMs: 200, stepMs: 10 });
  assert.equal(tab?.id, 10);
  assert.equal(tab?.status, 'complete');
});

test('tabs: waitTabComplete resolves with null if tab is missing or throws', async () => {
  const tab = await waitTabComplete(999, { timeoutMs: 50, stepMs: 10 });
  assert.equal(tab, null);
});

test('tabs: isHhDomain and getHhOrigin support main domain and all regional subdomains', () => {
  assert.equal(isHhDomain('hh.ru'), true);
  assert.equal(isHhDomain('spb.hh.ru'), true);
  assert.equal(isHhDomain('ekaterinburg.hh.ru'), true);
  assert.equal(isHhDomain('rabota.by'), true);
  assert.equal(isHhDomain('hh.kz'), true);
  assert.equal(isHhDomain('google.com'), false);

  assert.equal(getHhOrigin('https://hh.ru/applicant/skills'), 'https://hh.ru');
  assert.equal(getHhOrigin('https://spb.hh.ru/applicant/skills'), 'https://spb.hh.ru');
  assert.equal(
    getHhOrigin('https://ekaterinburg.hh.ru/applicant/skills'),
    'https://ekaterinburg.hh.ru'
  );
  assert.equal(getHhOrigin('https://rabota.by/applicant/skills'), 'https://rabota.by');
});

test('tabs: ensureMainTab reuses existing hh tab or creates a new one', async () => {
  // No tab exists -> creates one
  const first = await ensureMainTab();
  assert.equal(first.created, true);
  assert.equal(createdTabs.length, 1);

  // Existing tab exists -> reuses it
  mockTabs[first.tabId].status = 'complete';
  const second = await ensureMainTab();
  assert.equal(second.created, false);
  assert.equal(second.tabId, first.tabId);
});

test('tabs: returnToCatalog navigates tab to methods catalog', async () => {
  mockTabs[50] = { id: 50, status: 'complete', url: 'https://assessment.hh.ru/tests/123' };
  const ok = await returnToCatalog(50);
  assert.equal(ok, true);
  assert.equal(mockTabs[50].url, 'https://hh.ru/applicant/skill_verifications/methods');
});

test('tabs: launchTestTab navigates and waits for test page with contestToken', async () => {
  mockTabs[77] = { id: 77, status: 'loading', url: 'about:blank' };

  setTimeout(() => {
    if (mockTabs[77]) {
      mockTabs[77].status = 'complete';
      mockTabs[77].url = 'https://assessment.hh.ru/tests/888?contestToken=test-token-777';
    }
  }, 20);

  const result = await launchTestTab(77, 'https://spb.hh.ru/redirect?to=test', 888);
  assert.equal(result.ok, true);
  assert.equal(result.token, 'test-token-777');
});

test('tabs: ensureGate and gate action helpers inject scripts into MAIN world', async () => {
  setSolverTab(42);
  const gateInstalled = await ensureGate(42);
  assert.equal(gateInstalled, true);
  assert.equal(executedScripts.length, 1);
  assert.equal(executedScripts[0].world, 'MAIN');
  assert.deepEqual(executedScripts[0].args, [{ install: true }]);

  await gateTaskId(42, 1001);
  assert.deepEqual(executedScripts[1].args, [{ taskId: 1001 }]);

  await gateHeartbeat(42, 1001);
  assert.deepEqual(executedScripts[2].args, [{ taskId: 1001, heartbeat: true }]);

  await gateReport(42, 1001, [{ type: 8 }]);
  assert.deepEqual(executedScripts[3].args, [{ taskId: 1001, pending: [{ type: 8 }] }]);
});
