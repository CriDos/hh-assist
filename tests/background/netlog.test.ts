import { test, assert, vi } from 'vitest';
import { createChromeMock } from '../helpers/chrome-mock.ts';

let chrome: any;
let storage: any;

async function importNetLog() {
  vi.resetModules();
  const module = await import('../../src/background/netlog.ts');
  await module.initNetLog();
  return module;
}

test.beforeEach(() => {
  const mock = createChromeMock({ store: {} });
  chrome = mock.chrome;
  storage = mock.storage;
  (globalThis as any).chrome = chrome;
});

test.afterEach(() => {
  delete (globalThis as any).chrome;
});

function makeRequest(overrides = {}) {
  return {
    requestId: 'req-1',
    tabId: 7,
    timeStamp: 1000,
    method: 'POST',
    type: 'xmlhttprequest',
    url: 'https://assessment.hh.ru/shards/contest/report_data',
    requestBody: { raw: [{ bytes: new TextEncoder().encode('{"data":[]}') }] },
    ...overrides
  };
}

test('netlog: records requests of the solver tab with headers, body and status', async () => {
  const netlog = await importNetLog();
  netlog.setArmed(true);
  netlog.beginTest({ item: { name: 'Python' }, level: { name: 'Базовый' }, kind: 'theory' });
  netlog.setTabId(7);

  const before = makeRequest();
  chrome.webRequest.onBeforeRequest.listeners[0](before);
  chrome.webRequest.onBeforeSendHeaders.listeners[0]({
    requestId: 'req-1',
    tabId: 7,
    requestHeaders: [
      { name: 'X-Hhtmsource', value: 'CertTests' },
      { name: 'X-XSRFToken', value: 'tok' },
      { name: 'User-Agent', value: 'chrome' }
    ]
  });
  chrome.webRequest.onCompleted.listeners[0]({ requestId: 'req-1', tabId: 7, statusCode: 200 });

  assert.equal(netlog.status().count, 1);
  netlog.endTest();
  const session = netlog.getSession(netlog.status().archive[0].id);
  assert.ok(session, 'сессия в архиве');
  assert.equal(session.count, 1);
  const [recorded] = session.entries;
  assert.equal(recorded.url, 'https://assessment.hh.ru/shards/contest/report_data');
  assert.equal(recorded.method, 'POST');
  assert.equal(recorded.status, 200);
  assert.equal(recorded.body, '{"data":[]}');
  assert.ok(recorded.headers, 'заголовки записаны');
  assert.equal(recorded.headers['X-Hhtmsource'], 'CertTests');
  assert.equal(recorded.headers['User-Agent'], undefined, 'служебные заголовки не хранятся');
});

test('netlog: SW requests (tabId -1) are recorded, other tabs are not', async () => {
  const netlog = await importNetLog();
  netlog.setArmed(true);
  netlog.beginTest({ item: { name: 'Python' }, level: { name: 'Базовый' }, kind: 'theory' });
  netlog.setTabId(7);

  chrome.webRequest.onBeforeRequest.listeners[0](
    makeRequest({
      requestId: 'sw',
      tabId: -1,
      url: 'https://spb.hh.ru/applicant/skill_verifications/methods'
    })
  );
  chrome.webRequest.onBeforeRequest.listeners[0](
    makeRequest({ requestId: 'other', tabId: 42, url: 'https://spb.hh.ru/' })
  );
  chrome.webRequest.onBeforeRequest.listeners[0](
    makeRequest({ requestId: 'nohh', tabId: 7, url: 'https://example.com/x' })
  );

  const session = netlog.status();
  assert.equal(session.count, 1, 'только SW-запрос на hh.ru');
  netlog.endTest();
  const archived = netlog.getSession(netlog.status().archive[0].id);
  assert.ok(archived, 'сессия в архиве');
  assert.equal(archived.entries.length, 1);
  assert.equal(archived.entries[0].url, 'https://spb.hh.ru/applicant/skill_verifications/methods');
});

test('netlog: no recording while disarmed or outside a test', async () => {
  const netlog = await importNetLog();
  chrome.webRequest.onBeforeRequest.listeners[0](makeRequest({ requestId: 'a' }));
  assert.equal(netlog.status().count, 0, 'без взвода ничего не пишется');

  netlog.setArmed(true);
  chrome.webRequest.onBeforeRequest.listeners[0](makeRequest({ requestId: 'b' }));
  assert.equal(netlog.status().count, 0, 'без активного теста тоже не пишется');

  netlog.setArmed(false);
  netlog.beginTest({ item: {}, level: {}, kind: 'theory' });
  chrome.webRequest.onBeforeRequest.listeners[0](makeRequest({ requestId: 'c' }));
  assert.equal(netlog.status().count, 0);
});

test('netlog: per-test sessions land in the archive in order, capped', async () => {
  const netlog = await importNetLog();
  netlog.setArmed(true);
  for (let i = 0; i < 3; i++) {
    netlog.beginTest({ item: { name: `T${i}` }, level: { name: 'Базовый' }, kind: 'theory' });
    netlog.setTabId(7);
    chrome.webRequest.onBeforeRequest.listeners[0](
      makeRequest({ requestId: `r${i}`, timeStamp: i })
    );
    netlog.endTest();
  }
  const archive = netlog.status().archive;
  assert.equal(archive.length, 3);
  assert.equal(archive[0].test.item.name, 'T2', 'новые записи сверху');
  assert.equal(archive[0].count, 1);
});

test('netlog: archive persists to storage.local and loads back on init', async () => {
  const netlog = await importNetLog();
  netlog.setArmed(true);
  netlog.beginTest({ item: { name: 'Python' }, level: { name: 'Базовый' }, kind: 'practice' });
  netlog.setTabId(7);
  chrome.webRequest.onBeforeRequest.listeners[0](makeRequest({ requestId: 'r1' }));
  netlog.endTest();

  assert.ok(storage.hhNetArchive, 'архив сохранён в storage.local');
  assert.equal(storage.hhNetArchive[0].count, 1);

  delete (globalThis as any).chrome;
  (globalThis as any).chrome = createChromeMock({
    store: { hhNetArchive: storage.hhNetArchive }
  }).chrome;
  vi.resetModules();
  const fresh = await import('../../src/background/netlog.ts');
  await fresh.initNetLog();
  assert.equal(fresh.status().archive.length, 1);
  assert.equal(fresh.status().archive[0].count, 1);
});

test('netlog: persist stores only the quota subset of sessions', async () => {
  const netlog = await importNetLog();
  netlog.setArmed(true);
  for (let i = 0; i < 7; i++) {
    netlog.beginTest({ item: { name: `T${i}` }, level: {}, kind: 'theory' });
    netlog.setTabId(7);
    chrome.webRequest.onBeforeRequest.listeners[0](makeRequest({ requestId: `r${i}` }));
    netlog.endTest();
  }
  assert.equal(netlog.status().archive.length, 7, 'в памяти остаются все сессии');
  assert.ok(storage.hhNetArchive, 'архив персистнут');
  assert.equal(storage.hhNetArchive.length, 5, 'на диск уходит только подмножество (quota)');
});

test('netlog: manual test (browser) starts a session on redirect_to_test and ends on contest_result', async () => {
  const netlog = await importNetLog();
  netlog.setArmed(true);

  chrome.webRequest.onBeforeRequest.listeners[0](
    makeRequest({
      requestId: 'start',
      tabId: 9,
      type: 'main_frame',
      url: 'https://spb.hh.ru/applicant/keyskills/verification_methods/redirect_to_test?strict_hash=x'
    })
  );
  const status = netlog.status();
  assert.equal(status.active, true);
  assert.equal(status.test.source, 'manual');
  assert.equal(status.count, 1);

  chrome.webRequest.onBeforeRequest.listeners[0](
    makeRequest({
      requestId: 'api',
      tabId: 9,
      url: 'https://assessment.hh.ru/shards/cert_tests/get_current_task'
    })
  );
  chrome.webRequest.onBeforeRequest.listeners[0](
    makeRequest({
      requestId: 'sw',
      tabId: -1,
      url: 'https://spb.hh.ru/applicant/skill_verifications/methods'
    })
  );
  assert.equal(netlog.status().count, 2, 'ручная сессия пишет только вкладку браузера');

  chrome.webRequest.onBeforeRequest.listeners[0](
    makeRequest({
      requestId: 'finish',
      tabId: 9,
      type: 'main_frame',
      url: 'https://spb.hh.ru/skills/applicant/contest_result?entrypoint=NEW_USER&token=t1'
    })
  );
  assert.equal(netlog.status().active, false, 'финал закрывает ручную сессию');
  const session = netlog.getSession(netlog.status().archive[0].id);
  assert.ok(session, 'сессия в архиве');
  assert.equal(session.test.source, 'manual');
  assert.equal(session.count, 3, 'в запись входит и сам переход на contest_result');
});

test('netlog: manual session ends on post_finish; new attempt closes the previous one', async () => {
  const netlog = await importNetLog();
  netlog.setArmed(true);

  chrome.webRequest.onBeforeRequest.listeners[0](
    makeRequest({
      requestId: 'start',
      tabId: 9,
      type: 'main_frame',
      url: 'https://spb.hh.ru/applicant/keyskills/verification_methods/redirect_to_test?x=1'
    })
  );
  chrome.webRequest.onBeforeRequest.listeners[0](
    makeRequest({
      requestId: 'pf',
      tabId: 9,
      url: 'https://assessment.hh.ru/shards/contest/post_finish'
    })
  );
  assert.equal(netlog.status().active, false, 'post_finish закрывает теорию');
  assert.equal(netlog.status().archive.length, 1);

  chrome.webRequest.onBeforeRequest.listeners[0](
    makeRequest({
      requestId: 'start2',
      tabId: 9,
      type: 'main_frame',
      url: 'https://spb.hh.ru/applicant/keyskills/verification_methods/redirect_to_test?x=2'
    })
  );
  assert.equal(netlog.status().archive.length, 1, 'новая попытка переоткрывает сессию');
  assert.equal(netlog.status().active, true);
  assert.equal(netlog.status().count, 1, 'записи новой попытки отдельно от предыдущей');
});

test('netlog: extension session is not interrupted by manual detection', async () => {
  const netlog = await importNetLog();
  netlog.setArmed(true);
  netlog.beginTest({ item: { name: 'Python' }, level: { name: 'Базовый' }, kind: 'theory' });
  netlog.setTabId(7);
  assert.equal(netlog.status().test.source, 'extension');

  chrome.webRequest.onBeforeRequest.listeners[0](
    makeRequest({
      requestId: 'own-redirect',
      tabId: 7,
      type: 'main_frame',
      url: 'https://spb.hh.ru/applicant/keyskills/verification_methods/redirect_to_test?x=own'
    })
  );
  assert.equal(netlog.status().active, true);
  assert.equal(netlog.status().test.source, 'extension');
  netlog.endTest();
  assert.equal(netlog.status().archive[0].test.source, 'extension');
});

test('netlog: manual session ends when the tab leaves hh.ru or is closed', async () => {
  const netlog = await importNetLog();
  netlog.setArmed(true);

  chrome.webRequest.onBeforeRequest.listeners[0](
    makeRequest({
      requestId: 'start',
      tabId: 9,
      type: 'main_frame',
      url: 'https://spb.hh.ru/applicant/keyskills/verification_methods/redirect_to_test?x=1'
    })
  );
  assert.equal(netlog.status().active, true);
  chrome.webRequest.onBeforeRequest.listeners[0](
    makeRequest({
      requestId: 'away',
      tabId: 9,
      type: 'main_frame',
      url: 'https://example.com/'
    })
  );
  assert.equal(netlog.status().active, false, 'уход с hh.ru завершает ручную сессию');
  assert.equal(netlog.status().archive.length, 1);

  chrome.webRequest.onBeforeRequest.listeners[0](
    makeRequest({
      requestId: 'start2',
      tabId: 10,
      type: 'main_frame',
      url: 'https://spb.hh.ru/applicant/keyskills/verification_methods/redirect_to_test?x=2'
    })
  );
  assert.equal(netlog.status().active, true);
  chrome.tabs.onRemoved.listeners[0](10);
  assert.equal(netlog.status().active, false, 'закрытие вкладки завершает ручную сессию');
  assert.equal(netlog.status().archive.length, 2);

  chrome.webRequest.onBeforeRequest.listeners[0](
    makeRequest({
      requestId: 'start3',
      tabId: 11,
      type: 'main_frame',
      url: 'https://spb.hh.ru/applicant/keyskills/verification_methods/redirect_to_test?x=3'
    })
  );
  chrome.tabs.onRemoved.listeners[0](99);
  assert.equal(netlog.status().active, true);
  netlog.endTest();
});

test('netlog: new session does not inherit the previous tabId', async () => {
  const netlog = await importNetLog();
  netlog.setArmed(true);
  netlog.beginTest({ item: { name: 'Python' }, level: {}, kind: 'theory' });
  netlog.setTabId(7);
  netlog.endTest();

  netlog.beginTest({ item: { name: 'Python' }, level: {}, kind: 'theory' });
  chrome.webRequest.onBeforeRequest.listeners[0](makeRequest({ requestId: 'other', tabId: 7 }));
  assert.equal(netlog.status().count, 0, 'tabId предыдущей сессии не наследуется');
  netlog.setTabId(7);
  chrome.webRequest.onBeforeRequest.listeners[0](makeRequest({ requestId: 'own', tabId: 7 }));
  assert.equal(netlog.status().count, 1);
  netlog.endTest();
});

test('netlog: extension test start archives a lingering manual session', async () => {
  const netlog = await importNetLog();
  netlog.setArmed(true);

  chrome.webRequest.onBeforeRequest.listeners[0](
    makeRequest({
      requestId: 'manual-start',
      tabId: 9,
      type: 'main_frame',
      url: 'https://spb.hh.ru/applicant/keyskills/verification_methods/redirect_to_test?x=1'
    })
  );
  chrome.webRequest.onBeforeRequest.listeners[0](
    makeRequest({ requestId: 'manual-api', tabId: 9 })
  );
  assert.equal(netlog.status().active, true);

  netlog.beginTest({ item: { name: 'Python' }, level: { name: 'Базовый' }, kind: 'theory' });
  assert.equal(netlog.status().active, true);
  assert.equal(netlog.status().test.source, 'extension');
  assert.equal(netlog.status().count, 0, 'новая сессия чистая');
  const manual = netlog.getSession(netlog.status().archive[0].id);
  assert.ok(manual, 'сессия в архиве');
  assert.equal(manual.test.source, 'manual');
  assert.equal(manual.count, 2);
  netlog.endTest();
});

test('netlog: archive clear and disarming mid-test discard the session', async () => {
  const netlog = await importNetLog();
  netlog.setArmed(true);
  netlog.beginTest({ item: { name: 'Python' }, level: {}, kind: 'theory' });
  netlog.setTabId(7);
  chrome.webRequest.onBeforeRequest.listeners[0](makeRequest({ requestId: 'r1' }));
  netlog.setArmed(false);
  assert.equal(netlog.status().active, false, 'сброс кнопки обрывает сессию');
  assert.equal(netlog.status().count, 0);
  netlog.endTest();
  assert.equal(netlog.status().archive.length, 0, 'оборванная сессия не попадает в архив');

  netlog.clearArchive();
  assert.equal(netlog.status().archive.length, 0);
});
