import { test, assert, expect } from 'vitest';
import { createChromeMock } from './helpers/chrome-mock.ts';
import { waitFor } from './helpers/test-utils.ts';
import { state, resetState } from '../src/background/state.ts';

test('background: hh:catalog fetches and parses the catalog SSR (classless template)', async () => {
  resetState();
  (globalThis as any).setInterval = () => 0;
  const { chrome } = createChromeMock({ store: {}, tabs: {} });
  (globalThis as any).chrome = chrome;

  const level = (rank: number) => ({
    id: 100 + rank,
    internalId: 200 + rank,
    name: rank === 1 ? 'Базовый' : 'Средний',
    rank,
    theory: {
      id: 290 + rank,
      name: 'Теория',
      taskNumber: 10,
      estimatedTime: 600,
      availability: { availableAt: null, status: 'AVAILABLE' },
      validity: { state: 'NONE', validUntil: null },
      externalId: null,
      trainingExternalId: null
    },
    practice: {
      id: 390 + rank,
      name: 'Практика',
      taskNumber: 2,
      estimatedTime: 1800,
      availability: { availableAt: null, status: 'AVAILABLE' },
      validity: { state: 'NONE', validUntil: null },
      externalId: null,
      trainingExternalId: null
    }
  });
  const item = {
    id: 1114,
    name: 'Python',
    category: 'LANG',
    source: null,
    result: {
      level: null,
      state: 'NONE',
      theory: 'AVAILABLE',
      practice: 'AVAILABLE',
      availableAt: null,
      validUntil: null
    },
    levels: [level(1), level(2)]
  };
  const encoded = JSON.stringify({ skillsVerificationMethodsPage: { items: [item] } })
    .replaceAll('\\', '\\\\')
    .replaceAll('"', '&quot;');

  globalThis.fetch = async () =>
    ({
      ok: true,
      text: async () => `<!doctype html><html><body><template>${encoded}</template></body></html>`
    }) as any;

  await import('../src/background.ts?catalog' as any);
  const onMessage = chrome.runtime.onMessage.listeners[0];
  const result: any = await new Promise(resolve => onMessage({ type: 'hh:catalog' }, {}, resolve));

  assert.equal(result.ok, true);
  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].name, 'Python');
  assert.equal(result.items[0].levels[0].theory.id, 291);
  assert.equal(result.dropped, 0);
});

test('background: hh:catalog reports failure when fetch fails', async () => {
  resetState();
  (globalThis as any).setInterval = () => 0;
  const { chrome } = createChromeMock({ store: {}, tabs: {} });
  (globalThis as any).chrome = chrome;
  globalThis.fetch = async () => {
    throw new Error('network down');
  };

  await import('../src/background.ts?catalog-fail' as any);
  const onMessage = chrome.runtime.onMessage.listeners[0];
  const result: any = await new Promise(resolve => onMessage({ type: 'hh:catalog' }, {}, resolve));

  assert.equal(result.ok, false);
  assert.match(result.error, /network down/);
});

test('background: hh:startMany responds immediately without waiting for the queue', async () => {
  resetState();
  (globalThis as any).setInterval = () => 0;
  const { chrome } = createChromeMock({
    store: {
      hhSettings: {
        baseUrl: 'https://api.test/v1',
        apiKey: 'key',
        model: 'model',
        timings: { betweenTestsMinMs: 0, betweenTestsMaxMs: 0 }
      }
    },
    tabs: {
      7: {
        id: 7,
        url: 'https://spb.hh.ru/applicant/skills/1114/verification_methods',
        status: 'complete'
      }
    }
  });
  (globalThis as any).chrome = chrome;

  globalThis.fetch = async () =>
    ({
      ok: true,
      text: async () => JSON.stringify({ choices: [{ message: { content: 'ок' } }] })
    }) as any;

  const item = {
    id: 1114,
    name: 'Python',
    category: 'LANG',
    levels: [{ id: 8, name: 'Базовый', rank: 1 }]
  };
  const level = item.levels[0];
  const method = { id: 294, name: 'Теория' };
  const job = { item, level, method, kind: 'theory' };

  let mainTab = { id: 7, url: 'https://spb.hh.ru/', status: 'complete' };
  chrome.tabs.get = async () => mainTab;
  chrome.tabs.update = async (id: number, changes: any) => {
    const url = changes.url.includes('redirect_to_test')
      ? 'https://assessment.hh.ru/tests/1114?contestToken=abc'
      : changes.url;
    mainTab = { id, url, status: 'complete' };
    return mainTab;
  };
  let removed = false;
  chrome.tabs.remove = async () => {
    removed = true;
  };

  chrome.scripting.executeScript = async ({ target: _target, func, args }: any) => {
    const name = String(func);
    if (name.includes('probeSession')) {
      return [{ result: { loggedIn: true, userId: '1111', url: 'https://spb.hh.ru/' } }];
    }
    if (name.includes('gateAction')) return [{ result: 'ok' }];
    if (name.includes('readCompletionContent')) return [{ result: null }];
    const [url] = args;
    await new Promise(resolve => setTimeout(resolve, 30));
    const respond = (status: number, text: string) => [
      { result: { status, ok: status < 400, text } }
    ];
    if (url.includes('get_current_task')) return respond(204, '');
    if (url.includes('get_contest_tasks'))
      return respond(200, JSON.stringify({ contestTasks: [] }));
    if (url.includes('post_finish')) return respond(200, JSON.stringify({ redirectUri: 'x' }));
    return respond(200, '{}');
  };

  await import('../src/background.ts?nonblocking' as any);
  const onMessage = chrome.runtime.onMessage.listeners[0];

  const started = Date.now();
  const response: any = await new Promise(resolve =>
    onMessage({ type: 'hh:startMany', jobs: [job] }, {}, resolve)
  );
  const elapsed = Date.now() - started;

  assert.equal(response.ok, true);
  assert.ok(elapsed < 400, `hh:startMany must not block: responded after ${elapsed}ms`);

  await waitFor(() => mainTab.url.includes('skill_verifications/methods') && !removed, {
    message: 'queue must finish in the background'
  });
  assert.equal(removed, false, 'the single tab must never be closed');

  const status: any = await new Promise(resolve => onMessage({ type: 'hh:status' }, {}, resolve));
  assert.ok(Array.isArray(status.jobs), 'status must expose the jobs list');
  assert.equal(status.jobs.length, 1);
  assert.equal(status.jobs[0].name, 'Python');
  assert.equal(status.jobs[0].status, 'done');
  assert.equal(status.jobs[0].correct, null);
  assert.equal(status.jobs[0].message, 'Результат не найден');

  const jobId = status.jobs[0].id;
  assert.ok(jobId, 'job must have an id');
  const removedJob: any = await new Promise(resolve =>
    onMessage({ type: 'hh:jobs:remove', id: jobId }, {}, resolve)
  );
  assert.equal(removedJob.removed, true);
  const after: any = await new Promise(resolve => onMessage({ type: 'hh:status' }, {}, resolve));
  assert.equal(after.jobs.length, 0, 'removed job disappears from the queue');
});

test('background: closed tab is recreated before the next queued job', async () => {
  resetState();
  (globalThis as any).setInterval = () => 0;
  const { chrome } = createChromeMock({
    store: {
      hhSettings: {
        baseUrl: 'https://api.test/v1',
        apiKey: 'k',
        model: 'm',
        timings: { betweenTestsMinMs: 0, betweenTestsMaxMs: 0 }
      }
    },
    tabs: { 7: { id: 7, url: 'https://spb.hh.ru/', status: 'complete' } }
  });
  (globalThis as any).chrome = chrome;

  globalThis.fetch = async () =>
    ({
      ok: true,
      text: async () => JSON.stringify({ choices: [{ message: { content: 'ок' } }] })
    }) as any;

  const job = {
    item: {
      id: 1114,
      name: 'Python',
      category: 'LANG',
      levels: [{ id: 8, name: 'Базовый', rank: 1 }]
    },
    level: { id: 8, name: 'Базовый', rank: 1 },
    method: { id: 294, name: 'Теория' },
    kind: 'theory'
  };

  let mainTab: any = { id: 7, url: 'https://spb.hh.ru/', status: 'complete' };
  let createdTabs = 0;
  chrome.tabs.get = async (id: number) => (id === mainTab?.id ? mainTab : undefined);
  chrome.tabs.update = async (id: number, changes: any) => {
    const url = changes.url.includes('redirect_to_test')
      ? 'https://assessment.hh.ru/tests/1114?contestToken=abc'
      : changes.url;
    mainTab = { id, url, status: 'complete' };
    return mainTab;
  };
  chrome.tabs.create = async ({ url: _url }: any) => {
    createdTabs++;
    mainTab = { id: 9, url: 'https://spb.hh.ru/', status: 'complete' };
    return mainTab;
  };
  chrome.tabs.query = async () => (mainTab?.id ? [mainTab] : []);
  chrome.tabs.remove = async () => {};

  chrome.scripting.executeScript = async ({ target: _target, func, args }: any) => {
    const name = String(func);
    if (name.includes('probeSession'))
      return [{ result: { loggedIn: true, userId: '1111', url: 'https://spb.hh.ru/' } }];
    if (name.includes('gateAction')) return [{ result: 'ok' }];
    if (name.includes('readCompletionContent')) return [{ result: null }];
    const [url] = args;
    await new Promise(resolve => setTimeout(resolve, 20));
    const respond = (status: number, text: string) => [
      { result: { status, ok: status < 400, text } }
    ];
    if (url.includes('get_current_task')) return respond(204, '');
    if (url.includes('get_contest_tasks'))
      return respond(200, JSON.stringify({ contestTasks: [] }));
    if (url.includes('post_finish')) return respond(200, JSON.stringify({ redirectUri: 'x' }));
    return respond(200, '{}');
  };

  await import('../src/background.ts?tab-recreate' as any);
  const onMessage = chrome.runtime.onMessage.listeners[0];
  const send = (message: any) => new Promise(resolve => onMessage(message, {}, resolve));
  const waitDone = () =>
    waitFor(() => mainTab?.url?.includes('skill_verifications/methods'), {
      message: 'queue must finish'
    });

  await send({ type: 'hh:startMany', jobs: [job] });
  await waitDone();
  assert.equal(createdTabs, 0, 'first job reused the existing tab');
  assert.equal(mainTab.id, 7);

  mainTab = null;
  await send({ type: 'hh:startMany', jobs: [job] });
  await waitDone();
  assert.equal(createdTabs, 1, 'closed tab was recreated for the next job');
  assert.equal(mainTab.id, 9, 'the new test runs on the fresh tab');
});

test('background: panel commands work (status/config/log/profiles)', async () => {
  resetState();
  (globalThis as any).setInterval = () => 0;
  const { chrome } = createChromeMock({ store: {}, tabs: {} });
  (globalThis as any).chrome = chrome;

  await import('../src/background.ts?panel-cmds2' as any);
  const onMessage = chrome.runtime.onMessage.listeners[0];
  const send = (message: any): Promise<any> =>
    new Promise(resolve => onMessage(message, {}, resolve));

  const status = await send({ type: 'hh:status' });
  assert.equal(status.status, 'idle');
  assert.equal(status.configured, false);

  await send({
    type: 'hh:config:set',
    patch: { baseUrl: 'https://api.test/v1', apiKey: 'k', model: 'm' }
  });
  const config = await send({ type: 'hh:config:get' });
  assert.equal(config.baseUrl, 'https://api.test/v1');
  assert.equal(config.model, 'm');

  const log = await send({ type: 'hh:log:get' });
  assert.ok(Array.isArray(log.entries));

  const profile = await send({ type: 'hh:profiles:new' });
  assert.match(profile.visitorId, /^[0-9a-f]{32}$/);
  assert.match(profile.xhh, /^[0-9a-f]{32}$/);
  assert.match(profile.hashes.strict_hash, /^[0-9a-f]{64}$/);
  assert.match(profile.hashes.soft_hash, /^[0-9a-f]{64}$/);
  assert.match(profile.hashes.hardware_hash, /^[0-9a-f]{64}$/);
  assert.match(profile.label, /^gen_\d+_\d{4}-\d{2}-\d{2}$/);
  assert.equal(profile.salt, undefined, 'new profile model has no salt');
  const selected = await send({ type: 'hh:profiles:select', id: profile.id });
  assert.equal(selected.ok, true);
  assert.equal((await send({ type: 'hh:profiles:select', id: 'nope' })).id, null);

  const deleted = await send({ type: 'hh:profiles:delete', id: profile.id });
  assert.equal(deleted.ok, true);
  assert.equal(deleted.deleted?.id, profile.id);
  const listAfter = await send({ type: 'hh:profiles:list' });
  assert.equal(
    listAfter.some((p: any) => p.id === profile.id),
    false
  );
  const configAfterDelete = await send({ type: 'hh:config:get' });
  assert.equal(
    configAfterDelete.profileId,
    null,
    'removing the active profile clears the selection'
  );

  const [first, second] = await Promise.all([
    send({ type: 'hh:profiles:ensure' }),
    send({ type: 'hh:profiles:ensure' })
  ]);
  assert.equal(first.id, second.id, 'concurrent ensures must return the same profile');
  const configConcurrent = await send({ type: 'hh:config:get' });
  assert.equal(
    configConcurrent.profiles.filter((p: any) => p.auto).length,
    1,
    'concurrent ensures must not create a second auto profile'
  );

  const ensured = await send({ type: 'hh:profiles:ensure' });
  assert.equal(ensured.auto, true);
  assert.match(ensured.label, /^gen_0_\d{4}-\d{2}-\d{2}$/);
  const configEnsured = await send({ type: 'hh:config:get' });
  assert.equal(configEnsured.profileId, ensured.id, 'the default profile must be selected');
  const ensuredAgain = await send({ type: 'hh:profiles:ensure' });
  assert.equal(ensuredAgain.id, ensured.id, 'ensure must reuse the cached profile');
  const recreated = await send({ type: 'hh:profiles:recreate' });
  assert.equal(recreated.auto, true);
  assert.match(recreated.label, /^gen_0_\d{4}-\d{2}-\d{2}$/);
  assert.notEqual(recreated.id, ensured.id);
  assert.notEqual(recreated.visitorId, ensured.visitorId, 'recreate must roll a fresh visitorId');
  const configRecreated = await send({ type: 'hh:config:get' });
  assert.equal(configRecreated.profileId, recreated.id, 'the recreated profile stays selected');
  assert.equal(
    configRecreated.profiles.filter((p: any) => p.auto).length,
    1,
    'only one auto profile'
  );

  const unknown = await send({ type: 'hh:nope' });
  assert.ok(unknown.error);

  globalThis.fetch = async () =>
    ({
      ok: true,
      text: async () => JSON.stringify({ choices: [{ message: { content: 'ок' } }] })
    }) as any;
  const apiOk = await send({
    type: 'hh:api:test',
    baseUrl: 'https://api.test/v1',
    apiKey: 'k',
    model: 'm'
  });
  assert.equal(apiOk.ok, true);
  assert.equal(apiOk.model, 'm');
  assert.ok(Number.isFinite(apiOk.ms));
  const apiEmpty = await send({ type: 'hh:api:test', baseUrl: '', apiKey: '', model: '' });
  assert.equal(apiEmpty.ok, false);
  assert.match(apiEmpty.error, /Укажите baseUrl, ключ и модель/);
  globalThis.fetch = async () => {
    throw new TypeError('Failed to fetch');
  };
  const apiFail = await send({
    type: 'hh:api:test',
    baseUrl: 'https://api.test/v1',
    apiKey: 'k',
    model: 'm'
  });
  assert.equal(apiFail.ok, false);
  assert.match(apiFail.error, /Проверка LLM API не пройдена/);
});

test('background: timings split into theory/practice groups and migrate from the flat shape', async () => {
  resetState();
  (globalThis as any).setInterval = () => 0;
  const { chrome } = createChromeMock({ store: {}, tabs: {} });
  (globalThis as any).chrome = chrome;

  await import('../src/background.ts?panel-timings' as any);
  const onMessage = chrome.runtime.onMessage.listeners[0];
  const send = (message: any): Promise<any> =>
    new Promise(resolve => onMessage(message, {}, resolve));

  await send({
    type: 'hh:config:set',
    patch: {
      timings: {
        answerMinMs: 5000,
        answerMaxMs: 9000,
        betweenMinMs: 3000,
        betweenMaxMs: 6000,
        betweenTestsMinMs: 20000,
        betweenTestsMaxMs: 40000
      }
    }
  });
  let config = await send({ type: 'hh:config:get' });
  assert.equal(config.timings.theory.answerMinMs, 5000);
  assert.equal(config.timings.theory.betweenMaxMs, 6000);
  assert.equal(config.timings.practice.answerMinMs, 5000);
  assert.equal(config.timings.practice.betweenMaxMs, 6000);
  assert.equal(config.timings.betweenTestsMinMs, 20000);

  await send({
    type: 'hh:config:set',
    patch: {
      timings: {
        theory: { answerMinMs: 4000, answerMaxMs: 8000, betweenMinMs: 2000, betweenMaxMs: 4000 },
        practice: { answerMinMs: 1000, answerMaxMs: 2000, betweenMinMs: 500, betweenMaxMs: 1000 },
        betweenTestsMinMs: 15000,
        betweenTestsMaxMs: 30000
      }
    }
  });
  config = await send({ type: 'hh:config:get' });
  assert.equal(config.timings.theory.answerMinMs, 4000);
  assert.equal(config.timings.practice.answerMinMs, 1000);
  assert.equal(config.timings.theory.betweenMinMs, 2000);
  assert.equal(config.timings.practice.betweenMinMs, 500);
  assert.equal(config.timings.betweenTestsMaxMs, 30000);
});

test('background: checkSession reports login state, opens the catalog tab when missing, and is included in status', async () => {
  resetState();
  (globalThis as any).setInterval = () => 0;
  const { chrome } = createChromeMock({ store: {}, tabs: {} });
  (globalThis as any).chrome = chrome;

  const created: string[] = [];
  const knownTabs: Record<number, any> = {};
  chrome.tabs.create = async ({ url }: any) => {
    created.push(url);
    knownTabs[9] = { id: 9, url, status: 'complete' };
    chrome.tabs.get = async () => knownTabs[9];
    return knownTabs[9];
  };
  chrome.tabs.query = async () => Object.values(knownTabs).filter(tab => Number.isInteger(tab.id));
  chrome.scripting.executeScript = async ({ func }: any) => {
    if (String(func).includes('probeSession')) {
      return [
        {
          result: {
            loggedIn: true,
            userId: '12345',
            url: 'https://spb.hh.ru/applicant/skill_verifications/methods'
          }
        }
      ];
    }
    return [{ result: null }];
  };

  const { checkSession } = await import('../src/background.ts?checksession' as any);

  const session = await checkSession();
  assert.equal(session.loggedIn, true);
  assert.equal(session.userId, '12345');
  assert.ok(created.length === 1, 'catalog tab must be opened when none exists');
  assert.ok(created[0].includes('skill_verifications/methods'));

  await checkSession();
  assert.equal(created.length, 1, 'existing tab must be reused');

  const onMessage = chrome.runtime.onMessage.listeners[0];
  const status: any = await new Promise(resolve => onMessage({ type: 'hh:status' }, {}, resolve));
  assert.equal(status.session.loggedIn, true);
});

test('background: checkSession waits for the tab to load before probing', async () => {
  resetState();
  (globalThis as any).setInterval = () => 0;
  const { chrome } = createChromeMock({ store: {}, tabs: {} });
  (globalThis as any).chrome = chrome;

  const knownTabs: Record<number, any> = {};
  let probed = 0;
  chrome.tabs.create = async ({ url }: any) => {
    const tab = { id: 9, url, status: 'loading' };
    knownTabs[9] = tab;
    setTimeout(() => {
      tab.status = 'complete';
    }, 5);
    return tab;
  };
  chrome.tabs.query = async () => Object.values(knownTabs).filter(tab => Number.isInteger(tab.id));
  chrome.tabs.get = async (id: number) => knownTabs[id];
  chrome.scripting.executeScript = async ({ func }: any) => {
    if (String(func).includes('probeSession')) {
      probed++;
      return [{ result: { loggedIn: true, userId: '1', url: 'https://spb.hh.ru/' } }];
    }
    return [{ result: null }];
  };

  const { checkSession } = await import('../src/background.ts?sessionwait' as any);
  const session = await checkSession();
  assert.equal(session.loggedIn, true);
  assert.equal(probed, 1, 'the probe runs once, after the tab finished loading');
});

test('background: startTest fails fast with a clear message when not logged in', async () => {
  resetState();
  (globalThis as any).setInterval = () => 0;
  const { chrome } = createChromeMock({
    store: { hhSettings: { baseUrl: 'https://api.test/v1', apiKey: 'k', model: 'm' } },
    tabs: { 7: { id: 7, url: 'https://spb.hh.ru/', status: 'complete' } }
  });
  (globalThis as any).chrome = chrome;

  globalThis.fetch = async () =>
    ({
      ok: true,
      text: async () => JSON.stringify({ choices: [{ message: { content: 'ок' } }] })
    }) as any;

  chrome.scripting.executeScript = async ({ func }: any) => {
    if (String(func).includes('probeSession')) {
      return [{ result: { loggedIn: false, userId: null, url: 'https://spb.hh.ru/' } }];
    }
    return [{ result: null }];
  };

  const { startTest } = await import('../src/background.ts?notlogged' as any);
  await expect(
    startTest({
      item: { id: 1, name: 'X' },
      level: { name: 'Базовый' },
      method: { id: 1 },
      kind: 'theory'
    } as any)
  ).rejects.toThrow(/Авторизация на hh\.ru не подтверждена/);
});

test('background: startTest runs the full flow — fingerprint, redirect, gate, API loop, finish', async () => {
  resetState();
  (globalThis as any).setInterval = () => 0;
  const { chrome } = createChromeMock({
    store: {
      hhSettings: {
        baseUrl: 'https://api.test/v1',
        apiKey: 'key',
        model: 'model',
        timings: {
          theory: { answerMinMs: 0, answerMaxMs: 0, betweenMinMs: 0, betweenMaxMs: 0 },
          practice: { typingMinMs: 0, typingMaxMs: 0, retryTypingMinMs: 0, retryTypingMaxMs: 0 },
          betweenTestsMinMs: 0,
          betweenTestsMaxMs: 0
        }
      }
    },
    tabs: {
      7: {
        id: 7,
        url: 'https://spb.hh.ru/applicant/skills/1114/verification_methods',
        status: 'complete'
      }
    }
  });
  (globalThis as any).chrome = chrome;

  const item = {
    id: 1114,
    name: 'Python',
    category: 'LANG',
    levels: [{ id: 8, name: 'Базовый', rank: 1 }]
  };
  const level = item.levels[0];
  const method = { id: 294, name: 'Теория', taskNumber: 2 };
  const job = { item, level, method, kind: 'theory' as const };

  const executed: any[] = [];
  const gateCalls: any[] = [];
  const updateCalls: any[] = [];
  let submitted = 0;
  let finished = false;
  let mainTab = { id: 50, url: 'https://spb.hh.ru/', status: 'complete' };

  chrome.tabs.get = async () => mainTab;
  chrome.tabs.update = async (id: number, changes: any) => {
    updateCalls.push(changes);
    const url = changes.url.includes('redirect_to_test')
      ? 'https://assessment.hh.ru/tests/1114?contestToken=abc'
      : changes.url;
    mainTab = { id, url, status: 'complete' };
    return mainTab;
  };
  let removed = 0;
  chrome.tabs.remove = async () => {
    removed++;
  };

  chrome.scripting.executeScript = async ({ target, func, args }: any) => {
    const name = String(func);
    executed.push({ tabId: target.tabId, name, args });
    if (name.includes('probeSession')) {
      return [{ result: { loggedIn: true, userId: '12345', url: 'https://spb.hh.ru/' } }];
    }
    if (name.includes('gateAction')) {
      gateCalls.push({ tabId: target.tabId, args });
      return [{ result: 'ok' }];
    }
    if (name.includes('readCompletionContent')) {
      const content = JSON.stringify({
        applicantContestResultPage: { contest: { correct: 1, total: 1, passed: true } }
      })
        .replaceAll('\\', '\\\\')
        .replaceAll('"', '&quot;');
      return [{ result: { content } }];
    }
    const [url, init] = args;
    const respond = (status: number, text: string) => [
      { result: { status, ok: status < 400, text } }
    ];
    if (url.includes('get_current_task')) {
      if (submitted === 0) {
        return respond(
          200,
          JSON.stringify({
            taskId: 33555,
            description: 'Какой оператор выбирает данные?',
            subType: 'SINGLE',
            answers: [
              { answer: 'SELECT', uuid: 'u1' },
              { answer: 'INSERT', uuid: 'u2' }
            ],
            media: []
          })
        );
      }
      return respond(204, '');
    }
    if (url.includes('get_contest_tasks')) {
      return respond(
        200,
        JSON.stringify({ contestTasks: [{ taskId: 33555, status: 'NOT_STARTED' }] })
      );
    }
    if (url.includes('get_time_left')) {
      return respond(200, JSON.stringify({ timeLeftSeconds: 600 }));
    }
    if (url.includes('submit_user_answer')) {
      submitted++;
      const body = JSON.parse(init.body);
      assert.deepEqual(body, { userAnswerUuids: ['u1'], taskId: 33555 });
      return respond(200, JSON.stringify({ status: 'ACCEPTED' }));
    }
    if (url.includes('post_finish')) {
      finished = true;
      return respond(
        200,
        JSON.stringify({
          redirectUri: 'https://spb.hh.ru/skills/applicant/contest_result?token=abc'
        })
      );
    }
    return respond(500, 'unknown path');
  };

  globalThis.fetch = async (_url: any, opts: any) => {
    const body = JSON.parse(opts.body);
    const isProbe = body.messages.some(
      (m: any) => m.content?.includes('Тестовое') || m.content?.includes('Ответь')
    );
    return {
      ok: true,
      text: async () =>
        JSON.stringify({
          choices: [
            {
              message: {
                content: isProbe ? 'ок' : 'Ответ: 1. SELECT\nОбоснование: ок.'
              }
            }
          ]
        })
    } as any;
  };

  const { startTest } = await import('../src/background.ts?starttest' as any);

  const result = await startTest(job);

  assert.equal(result.status, 'finished');
  assert.equal(submitted, 1, 'one answer submitted');
  assert.equal(finished, true, 'post_finish called');
  assert.ok(
    executed.some(e => e.name.includes('gateAction') && e.args?.[0]?.install),
    'gate must be installed on the solver tab'
  );
  const gateIndex = executed.findIndex(e => e.name.includes('gateAction') && e.args?.[0]?.install);
  assert.ok(gateIndex > -1);
  const bridgeCalls = executed.filter(e => e.name.includes('bridgeFetch'));
  assert.ok(executed.indexOf(bridgeCalls[0]) > gateIndex, 'API must run only after the gate');

  const taskGate = gateCalls.find(
    call => call.args?.[0]?.taskId === 33555 && !call.args[0].install
  );
  assert.ok(taskGate, 'gate must receive the current taskId');
  const answerReport = gateCalls.find(call => call.args?.[0]?.pending?.length);
  assert.ok(answerReport, 'answer event must be reported through the gate');
  assert.equal(answerReport.args[0].pending[0].type, 8, 'answer event is type 8');
  assert.equal(answerReport.args[0].taskId, 33555);

  assert.ok(
    !updateCalls.some(
      call => call.url?.includes('/applicant/skills/') || call.url?.includes('/applicant/langs/')
    ),
    'the section page must not be visited for fingerprint collection'
  );

  const redirect =
    (updateCalls.find(call => call.url?.includes('redirect_to_test')) || {}).url || '';
  assert.ok(
    redirect.includes('redirect_to_test'),
    'the main tab must navigate through the redirect'
  );
  assert.ok(redirect.includes('strict_hash='));
  assert.ok(redirect.includes('soft_hash='));
  assert.ok(redirect.includes('hardware_hash='));
  const redirectParams = new URLSearchParams(redirect.split('?')[1]);
  assert.match(redirectParams.get('xhh') || '', /^[0-9a-f]{32}$/);
  assert.match(redirectParams.get('fingerprintjs') || '', /^[0-9a-f]{32}$/);
  const lastId = redirectParams.get('last_id');
  assert.match(lastId || '', /^[0-9a-f]{64}$/);
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode('12345'));
  const lastIdHex = [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('');
  assert.equal(lastId, lastIdHex, 'last_id is SHA-256 of the session userId');
  assert.ok(redirect.includes('skill_id=1114'));
  assert.ok(
    redirect.includes('skill_category=langs'),
    'language items must use skill_category=langs'
  );

  assert.equal(removed, 0, 'the single tab must never be closed');
  assert.ok(
    updateCalls.some(call => call.url?.includes('skill_verifications/methods')),
    'tab returns to the catalog after the run'
  );

  assert.ok(
    updateCalls.some(call => call.url?.includes('contest_result?token=abc')),
    'tab must navigate to the result page with the contest id'
  );

  const onMessage = chrome.runtime.onMessage.listeners[0];
  const log: any = await new Promise(resolve => onMessage({ type: 'hh:log:get' }, {}, resolve));
  assert.ok(
    log.entries.some((entry: any) =>
      /Python · Базовый · Теория: Навык подтверждён: 1 из 1/.test(entry.message)
    ),
    'result must be reported in the log'
  );

  assert.ok(
    log.entries.some((entry: any) => /Тест запущен \(id abc\)/.test(entry.message)),
    'contest id from the test page URL must be logged at start'
  );
  assert.ok(
    log.entries.some((entry: any) =>
      /Результат: https:\/\/spb\.hh\.ru\/skills\/applicant\/contest_result\?token=abc/.test(
        entry.message
      )
    ),
    'full result URL with the contest id must be logged at finish'
  );

  const llmCtx: any = await new Promise(resolve => onMessage({ type: 'hh:llm:get' }, {}, resolve));
  assert.equal(llmCtx.entries.length, 2, 'probe and theory entries collected');
  assert.equal(llmCtx.entries[0].kind, 'probe');
  assert.equal(llmCtx.entries[1].kind, 'theory');
  assert.equal(llmCtx.entries[1].taskId, 33555);
  assert.match(llmCtx.entries[1].question, /Какой оператор выбирает данные\?/);
  assert.match(
    llmCtx.entries[1].system,
    /сертификационн(ый|ым) тест/,
    'system is the default theory prompt'
  );

  const config: any = await new Promise(resolve =>
    onMessage({ type: 'hh:config:get' }, {}, resolve)
  );
  assert.ok(config.profileId, 'the default auto profile must be selected');
  assert.equal(config.profiles.length, 1, 'one profile — the generated default');
  assert.equal(config.profiles[0].auto, true);
  assert.match(config.profiles[0].label, /^gen_0_\d{4}-\d{2}-\d{2}$/);
  assert.ok(
    log.entries.some((entry: any) =>
      /Запуск: Python · Базовый · Теория · fingerprint: gen_0_/.test(entry.message)
    ),
    'the run log must name the fingerprint profile'
  );
});

test('background: pre-test LLM probe failure cancels the remaining queue', async () => {
  resetState();
  (globalThis as any).setInterval = () => 0;
  const { chrome } = createChromeMock({
    store: { hhSettings: { baseUrl: 'https://api.test/v1', apiKey: 'k', model: 'm' } },
    tabs: { 7: { id: 7, url: 'https://spb.hh.ru/', status: 'complete' } }
  });
  (globalThis as any).chrome = chrome;
  globalThis.fetch = async () => {
    throw new TypeError('Failed to fetch');
  };

  const item = {
    id: 1114,
    name: 'Python',
    category: 'LANG',
    levels: [{ id: 8, name: 'Базовый', rank: 1 }]
  };
  const job = { item, level: item.levels[0], method: { id: 294, name: 'Теория' }, kind: 'theory' };

  await import('../src/background.ts?probe-fail' as any);
  const onMessage = chrome.runtime.onMessage.listeners[0];
  await new Promise(resolve => onMessage({ type: 'hh:startMany', jobs: [job, job] }, {}, resolve));

  const status: any = await waitFor(
    async () => {
      const s: any = await new Promise(resolve => onMessage({ type: 'hh:status' }, {}, resolve));
      return s?.jobs?.length === 2 &&
        s.jobs.some((j: any) => j.status === 'error') &&
        s.jobs.some((j: any) => j.status === 'queued') &&
        s.paused
        ? s
        : false;
    },
    { timeoutMs: 12000, message: 'queue must pause on probe error' }
  );
  const errJob = status.jobs.find((j: any) => j.status === 'error');
  const queuedJob = status.jobs.find((j: any) => j.status === 'queued');
  assert.ok(errJob, 'one job must be in error status');
  assert.match(errJob.message, /Проверка LLM API не пройдена/);
  assert.ok(queuedJob, 'remaining job must stay queued on pause');
  assert.equal(status.paused, true, 'queue is paused on critical error');

  const resumeResult: any = await new Promise(resolve =>
    onMessage({ type: 'hh:queue:resume' }, {}, resolve)
  );
  assert.equal(resumeResult.ok, true);

  const pauseResult: any = await new Promise(resolve =>
    onMessage({ type: 'hh:queue:pause' }, {}, resolve)
  );
  assert.equal(typeof pauseResult.ok, 'boolean');
}, 15000);

test('background: checkpoint recovery re-opens closed test tab by contestToken', async () => {
  resetState();
  (globalThis as any).setInterval = () => 0;
  const openedUrls: string[] = [];
  const { chrome } = createChromeMock({
    store: {
      hhSettings: { baseUrl: 'https://api.test/v1', apiKey: 'k', model: 'm' },
      hhCheckpoint: {
        tabId: 999,
        contestId: 'contest-token-123',
        item: { id: 1114, name: 'Python' },
        level: { name: 'Базовый' },
        kind: 'theory',
        savedAt: Date.now()
      }
    },
    tabs: {
      1: {
        id: 1,
        url: 'https://spb.hh.ru/skills/applicant/skill_verifications',
        status: 'complete'
      }
    }
  });
  const origUpdate = chrome.tabs.update;
  chrome.tabs.update = async (tabId: number, opts: any) => {
    openedUrls.push(opts.url);
    return origUpdate(tabId, {
      ...opts,
      url: 'https://assessment.hh.ru/tests/1114?contestToken=contest-token-123'
    });
  };
  (globalThis as any).chrome = chrome;

  const { restoreCheckpoint } = await import('../src/background/coordinator.ts');
  const dummyQueue: any = {
    finishResumed: () => {},
    requeueRunning: () => {},
    startLoop: () => Promise.resolve()
  };
  await restoreCheckpoint(dummyQueue);
  assert.ok(
    openedUrls.some(url =>
      url?.includes('assessment.hh.ru/tests/1114?contestToken=contest-token-123')
    ),
    'should reopen test URL on recovery'
  );
});

test('background: llmLog RPC handlers and queue clearDone', async () => {
  resetState();
  const { chrome } = createChromeMock({
    store: { hhSettings: { baseUrl: 'https://api.test/v1', apiKey: 'k', model: 'm' } }
  });
  (globalThis as any).chrome = chrome;

  await import('../src/background.ts?llm-log-test' as any);
  const onMessage = chrome.runtime.onMessage.listeners[0];

  const { pushLlmLog } = await import('../src/background/log.ts');
  pushLlmLog({
    kind: 'theory',
    item: 'Python',
    taskId: 123,
    number: 1,
    question: 'Что такое GIL?',
    response: 'Ответ: 1'
  });

  const getRes: any = await new Promise(resolve =>
    onMessage({ type: 'hh:llmLog:get' }, {}, resolve)
  );
  assert.ok(Array.isArray(getRes.entries));
  assert.equal(getRes.entries.length, 1);
  assert.equal(getRes.entries[0].item, 'Python');
  assert.equal(getRes.entries[0].response, 'Ответ: 1');

  const clearRes: any = await new Promise(resolve =>
    onMessage({ type: 'hh:llmLog:clear' }, {}, resolve)
  );
  assert.equal(clearRes.ok, true);

  const emptyRes: any = await new Promise(resolve =>
    onMessage({ type: 'hh:llmLog:get' }, {}, resolve)
  );
  assert.equal(emptyRes.entries.length, 0);

  state.jobs = [
    { id: 1, status: 'done' } as any,
    { id: 2, status: 'queued' } as any,
    { id: 3, status: 'aborted' } as any
  ];
  const clearDoneRes: any = await new Promise(resolve =>
    onMessage({ type: 'hh:queue:clearDone' }, {}, resolve)
  );
  assert.equal(clearDoneRes.ok, true);
  assert.equal(clearDoneRes.count, 2);
  assert.equal(state.jobs.length, 1);
  assert.equal(state.jobs[0].id, 2);
});

test('background: action.onClicked opens sidePanel reliably for the active window', async () => {
  resetState();
  (globalThis as any).setInterval = () => 0;
  const { chrome } = createChromeMock({ store: {}, tabs: {} });
  (globalThis as any).chrome = chrome;

  const bg: any = await import('../src/background.ts?action-onclick-test' as any);

  assert.equal(chrome.action.onClicked.listeners.length, 1);

  const clickListener = chrome.action.onClicked.listeners[0];
  await clickListener({ windowId: 42 });

  assert.deepEqual(chrome.sidePanel.opened, { windowId: 42 });

  assert.ok(bg.queue);
  assert.equal(typeof bg.startMany, 'function');
  assert.equal(typeof bg.abortQueue, 'function');
});

test('background: consecutive tests preserve LLM history across queue runs', async () => {
  resetState();
  (globalThis as any).setInterval = () => 0;
  const { chrome } = createChromeMock({
    store: {
      hhSettings: {
        baseUrl: 'https://api.test/v1',
        apiKey: 'key',
        model: 'model',
        timings: { betweenTestsMinMs: 0, betweenTestsMaxMs: 0 }
      }
    },
    tabs: {
      7: {
        id: 7,
        url: 'https://spb.hh.ru/applicant/skills/1114/verification_methods',
        status: 'complete'
      }
    }
  });
  (globalThis as any).chrome = chrome;

  globalThis.fetch = async () =>
    ({
      ok: true,
      text: async () => JSON.stringify({ choices: [{ message: { content: '1' } }] })
    }) as any;

  const job1 = {
    item: {
      id: 1114,
      name: 'Python',
      category: 'LANG',
      levels: [{ id: 8, name: 'Базовый', rank: 1 }]
    },
    level: { id: 8, name: 'Базовый', rank: 1 },
    method: { id: 294, name: 'Теория' },
    kind: 'theory'
  };
  const job2 = {
    item: {
      id: 1252,
      name: 'SQL',
      category: 'SKILL',
      levels: [{ id: 8, name: 'Базовый', rank: 1 }]
    },
    level: { id: 8, name: 'Базовый', rank: 1 },
    method: { id: 295, name: 'Теория' },
    kind: 'theory'
  };

  let mainTab = { id: 7, url: 'https://spb.hh.ru/', status: 'complete' };
  chrome.tabs.get = async () => mainTab;
  chrome.tabs.query = async () => [mainTab];
  chrome.tabs.update = async (id: number, changes: any) => {
    const match = changes.url?.match(/skill_id=(\d+)/);
    const skillId = match ? match[1] : '1114';
    const url = changes.url?.includes('redirect_to_test')
      ? `https://assessment.hh.ru/tests/${skillId}?contestToken=abc`
      : changes.url;
    mainTab = { id, url, status: 'complete' };
    return mainTab;
  };
  chrome.tabs.remove = async () => {};

  chrome.scripting.executeScript = async ({ target: _target, func, args }: any) => {
    const name = String(func);
    if (name.includes('probeSession')) {
      return [{ result: { loggedIn: true, userId: '1111', url: 'https://spb.hh.ru/' } }];
    }
    if (name.includes('gateAction')) return [{ result: 'ok' }];
    if (name.includes('readCompletionContent')) return [{ result: null }];
    const [url] = args;
    await new Promise(resolve => setTimeout(resolve, 20));
    const respond = (status: number, text: string) => [
      { result: { status, ok: status < 400, text } }
    ];
    if (url.includes('get_current_task')) return respond(204, '');
    if (url.includes('get_contest_tasks'))
      return respond(200, JSON.stringify({ contestTasks: [] }));
    if (url.includes('post_finish')) return respond(200, JSON.stringify({ redirectUri: 'x' }));
    return respond(200, '{}');
  };

  await import('../src/background.ts?llm-history-preserve' as any);
  const onMessage = chrome.runtime.onMessage.listeners[0];

  await new Promise(resolve =>
    onMessage({ type: 'hh:startMany', jobs: [job1, job2] }, {}, resolve)
  );

  await waitFor(() => state.jobs.length === 2 && state.jobs.every(j => j.status === 'done'), {
    message: 'both jobs in queue must finish'
  });

  const getRes: any = await new Promise(resolve =>
    onMessage({ type: 'hh:llmLog:get' }, {}, resolve)
  );
  assert.ok(Array.isArray(getRes.entries));
  // Probe requests for each test should be retained in the LLM log history
  assert.ok(
    getRes.entries.length >= 2,
    `Expected at least 2 entries in LLM log, got ${getRes.entries.length}`
  );

  const items = getRes.entries.map((e: any) => e.item);
  assert.ok(items.includes('Проверка LLM API'), 'LLM probes should be logged');

  const clearRes: any = await new Promise(resolve =>
    onMessage({ type: 'hh:llmLog:clear' }, {}, resolve)
  );
  assert.equal(clearRes.ok, true);

  const afterClear: any = await new Promise(resolve =>
    onMessage({ type: 'hh:llmLog:get' }, {}, resolve)
  );
  assert.equal(afterClear.entries.length, 0);
});
