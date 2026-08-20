import { test, assert, expect } from 'vitest';
import { createApiClient, ApiError, utf8ToBase64, base64ToUtf8 } from '../../src/core/api.ts';

function mockFetch(handler: any) {
  const calls: any[] = [];
  const impl: any = async (url: string, init: any) => {
    calls.push({ url, init });
    return handler({ url, init });
  };
  impl.calls = calls;
  return impl;
}

const ok = (body: any, status = 200) => ({
  status,
  ok: status >= 200 && status < 300,
  text: async () => (typeof body === 'string' ? body : JSON.stringify(body))
});

test('getCurrentTask: returns task json with headers', async () => {
  const fetchImpl = mockFetch(() => ok({ taskId: 33555, description: 'Вопрос' }));
  const api = createApiClient({ fetchImpl, xsrf: 'tok123' });
  const task = await api.getCurrentTask();
  assert.equal(task!.taskId, 33555);
  const call = fetchImpl.calls[0];
  assert.equal(call.url, 'https://assessment.hh.ru/shards/cert_tests/get_current_task');
  assert.equal(call.init.method, 'GET');
  assert.equal(call.init.headers['X-Requested-With'], 'XMLHttpRequest');
  assert.equal(call.init.headers['X-XSRFToken'], 'tok123');
  assert.equal(call.init.headers['X-Hhtmsource'], 'CertTests');
});

test('getCurrentTask: 204 maps to null (test finished)', async () => {
  const fetchImpl = mockFetch(() => ({ status: 204, ok: true, text: async () => '' }));
  const api = createApiClient({ fetchImpl });
  assert.equal(await api.getCurrentTask(), null);
});

test('getCurrentTask: empty 200 body throws instead of ending the test early', async () => {
  const fetchImpl = mockFetch(() => ({ status: 200, ok: true, text: async () => '' }));
  const api = createApiClient({ fetchImpl });
  await expect(api.getCurrentTask()).rejects.toThrow(/Пустое тело ответа сервера/);
});

test('xsrf can be a function resolved per request', async () => {
  let value = 'a';
  const fetchImpl = mockFetch(() => ok({}));
  const api = createApiClient({ fetchImpl, xsrf: () => value });
  await api.getTimeLeft();
  value = 'b';
  await api.getTimeLeft();
  assert.equal(fetchImpl.calls[0].init.headers['X-XSRFToken'], 'a');
  assert.equal(fetchImpl.calls[1].init.headers['X-XSRFToken'], 'b');
});

test('submitAnswer: posts uuids and taskId as JSON', async () => {
  const fetchImpl = mockFetch(() => ok({ status: 'ACCEPTED' }));
  const api = createApiClient({ fetchImpl });
  const result = await api.submitAnswer(35166, ['uuid-1']);
  assert.equal(result.status, 'ACCEPTED');
  const call = fetchImpl.calls[0];
  assert.equal(call.url, 'https://assessment.hh.ru/shards/cert_tests/submit_user_answer');
  assert.deepEqual(JSON.parse(call.init.body), { userAnswerUuids: ['uuid-1'], taskId: 35166 });
  assert.equal(call.init.headers['Content-Type'], 'application/json');
});

test('postFinish: sends empty FormData', async () => {
  const fetchImpl = mockFetch(() =>
    ok({
      redirectUri: 'https://spb.hh.ru/skills/applicant/contest_result?entrypoint=NEW_USER&token=abc'
    })
  );
  const api = createApiClient({ fetchImpl });
  const result = await api.postFinish();
  assert.match(result!.redirectUri!, /contest_result/);
  assert.ok(fetchImpl.calls[0].init.body instanceof FormData);
});

test('non-ok status throws ApiError with status and body', async () => {
  const fetchImpl = mockFetch(() => ({
    status: 404,
    ok: false,
    text: async () => '{"error":"no"}'
  }));
  const api = createApiClient({ fetchImpl });
  await expect(api.getCurrentTask()).rejects.toThrow(ApiError);
});

test('base64 helpers round-trip utf-8 code', () => {
  const code = '<?php\nnamespace Solution;\n// ваш код\nclass A {}\n';
  const encoded = utf8ToBase64(code);
  assert.equal(typeof encoded, 'string');
  assert.equal(base64ToUtf8(encoded), code);
  assert.equal(base64ToUtf8(utf8ToBase64('🧪 тест')), '🧪 тест');
  assert.equal(utf8ToBase64(''), '');
  assert.equal(base64ToUtf8(''), '');
  assert.equal(utf8ToBase64(null as any), '');
  assert.equal(base64ToUtf8(null as any), '');
  const largeCode = 'const x = 1;\n'.repeat(2000);
  assert.equal(base64ToUtf8(utf8ToBase64(largeCode)), largeCode);
});

test('updateCode: posts code as base64 with CertCode headers', async () => {
  const fetchImpl = mockFetch(() => ok({}));
  const api = createApiClient({ fetchImpl });
  await api.updateCode(34648, utf8ToBase64('<?php // x'), 'PHP');
  const call = fetchImpl.calls[0];
  assert.equal(call.url, 'https://assessment.hh.ru/shards/cert_code/update_code');
  assert.equal(call.init.method, 'POST');
  assert.equal(call.init.headers['X-Hhtmsource'], 'CertCode');
  assert.deepEqual(JSON.parse(call.init.body), {
    taskId: 34648,
    code: utf8ToBase64('<?php // x'),
    lang: 'PHP',
    isBeta: false
  });
});

test('submitTask: posts submissionType check/full with CertCode headers', async () => {
  const fetchImpl = mockFetch(() => ok({ submissionId: 52198164 }));
  const api = createApiClient({ fetchImpl });
  const result = await api.submitTask(34648, 'Y29kZQ==', 'PHP', 'check');
  assert.equal(result.submissionId, 52198164);
  const call = fetchImpl.calls[0];
  assert.equal(call.url, 'https://assessment.hh.ru/shards/cert_code/post_submit_task');
  assert.equal(call.init.headers['X-Hhtmsource'], 'CertCode');
  assert.deepEqual(JSON.parse(call.init.body), {
    taskId: 34648,
    code: 'Y29kZQ==',
    lang: 'PHP',
    submissionType: 'check',
    isBeta: false
  });
});

test('getSubmitTaskResult: builds query with isSolution flag', async () => {
  const fetchImpl = mockFetch(() => ok({ smokeTests: {}, status: 'ACCEPTED' }));
  const api = createApiClient({ fetchImpl });
  await api.getSubmitTaskResult(52198164, 34648, true);
  const call = fetchImpl.calls[0];
  assert.equal(
    call.url,
    'https://assessment.hh.ru/shards/cert_code/get_submit_task_result?submissionId=52198164&taskId=34648&isBeta=false&isSolution=true'
  );
  assert.equal(call.init.headers['X-Hhtmsource'], 'CertCode');
});
