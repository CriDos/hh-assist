import { test, assert } from 'vitest';
import { gateAction } from '../../src/core/telemetry-gate.ts';

const REPORT_URL = '/shards/contest/report_data';
const OTHER_URL = '/shards/cert_tests/get_current_task';

// Page mock: the native fetch/XHR the page sees, plus records of what
// actually went to the network (nativeSends) and what the page believed
// it sent (pageSends).
function installPage({ beacon = false, pathname = '/code/3750', install = true } = {}) {
  const page: any = { nativeSends: [], pageSends: [], beaconCalls: [] };

  class FakeXHR {
    readyState = 0;
    status = 0;
    responseText = '';
    onreadystatechange: any = null;
    onload: any = null;
    onerror: any = null;
    onabort: any = null;
    __hhProxy = false;
    __hhHeaders: Record<string, string> = {};
    _listeners: Record<string, any[]> = {};
    _aborted = false;
    method = '';
    url = '';

    addEventListener(type: string, listener: any) {
      (this._listeners[type] || (this._listeners[type] = [])).push(listener);
    }

    dispatchEvent(event: any) {
      const type = event?.type || String(event);
      const list = this._listeners[type] || [];
      for (const listener of list) listener.call(this, event);
      return true;
    }

    open(method: string, url: string) {
      this.method = method;
      this.url = url;
    }

    setRequestHeader(name: string, value: string) {
      this.__hhHeaders[name] = value;
    }

    send(body: any) {
      if (this.__hhProxy) {
        page.nativeSends.push({ url: this.url, body, headers: this.__hhHeaders });
        setTimeout(() => {
          this.status = 200;
          this.readyState = 4;
          this.responseText = '{}';
          if (this.onreadystatechange) this.onreadystatechange.call(this);
          if (this.onload) this.onload.call(this);
          this.dispatchEvent({ type: 'readystatechange' });
          this.dispatchEvent({ type: 'load' });
        }, 0);
        return;
      }
      page.pageSends.push({ method: this.method, url: this.url, body });
    }

    abort() {
      this._aborted = true;
      // A proxied XHR that was aborted fires onabort + abort event; an
      // unsent original (send was intercepted) fires nothing, like Chrome.
      if (this.__hhProxy) {
        if (this.onabort) this.onabort.call(this);
        this.dispatchEvent({ type: 'abort' });
      }
    }
  }

  const saved: Record<string, any> = {};
  const setNames = ['XMLHttpRequest', 'window', 'navigator', 'document', 'location', 'Headers'];
  for (const name of setNames) {
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, name);
    if (descriptor) saved[name] = descriptor;
  }
  const setGlobal = (name: string, value: any) => {
    Object.defineProperty(globalThis, name, { value, configurable: true, writable: true });
  };

  setGlobal('XMLHttpRequest', FakeXHR);
  setGlobal('Headers', undefined);
  setGlobal('window', {
    fetch: async (url: any, init: any) => {
      page.nativeSends.push({
        url: typeof url === 'string' ? url : url.url,
        body: init?.body,
        headers: init?.headers
      });
      return { ok: true, status: 200, text: async () => '{}' };
    }
  });
  setGlobal(
    'navigator',
    beacon
      ? {
          sendBeacon: (url: any, data: any) => {
            page.beaconCalls.push({ url, data });
            return true;
          }
        }
      : {}
  );
  setGlobal('document', {
    documentElement: {},
    cookie: '_xsrf=abc123; contest_token=t1'
  });
  setGlobal('location', { pathname });

  if (install) gateAction({ install: true });

  return {
    page,
    FakeXHR,
    document: (globalThis as any).document,
    restore() {
      for (const name of setNames) {
        if (saved[name]) Object.defineProperty(globalThis, name, saved[name]);
        else delete (globalThis as any)[name];
      }
    }
  };
}

// Utility: wait for the proxy-XHR microtasks/timers.
const tick = () => new Promise(resolve => setTimeout(resolve, 5));

test('gate: page report_data is forwarded with rewritten taskId and real response', async () => {
  const { page, restore } = installPage();
  try {
    gateAction({ taskId: 42 });
    const response = await (globalThis as any).window.fetch(REPORT_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Hhtmsource': 'CertCode',
        'X-XSRFToken': 'abc123'
      },
      body: JSON.stringify({
        data: [{ taskId: 1, type: 10, payload: [0], timestamp: 't' }],
        taskId: 1
      })
    });

    assert.equal(response.status, 200);
    assert.equal(page.nativeSends.length, 1, 'page telemetry reaches the network');
    const sent = page.nativeSends[0];
    const body = JSON.parse(sent.body);
    assert.equal(body.taskId, 42, 'wrapper taskId rewritten to the current task');
    assert.equal(body.data[0].taskId, 42, 'event taskId rewritten');
    assert.equal(body.data[0].type, 10);
  } finally {
    restore();
  }
});

test('gate: injected answer flushes as action + heartbeat [counter], pending cleared', async () => {
  const { page, restore } = installPage();
  try {
    gateAction({ taskId: 7, pending: [{ type: 8, payload: [] }] });

    assert.equal(page.nativeSends.length, 2, 'burst: action, then counter heartbeat');
    const [action, counter] = page.nativeSends;
    const actionBody = JSON.parse(action.body);
    assert.equal(actionBody.taskId, 7);
    assert.equal(actionBody.data.length, 1);
    assert.equal(actionBody.data[0].type, 8);
    assert.ok(actionBody.data[0].timestamp, 'timestamp set by the page context');
    const counterBody = JSON.parse(counter.body);
    assert.equal(counterBody.data.length, 1);
    assert.equal(counterBody.data[0].type, 10);
    assert.deepEqual(counterBody.data[0].payload, [1], 'counter = число инжектированных действий');

    // A repeated flush sends nothing (pending is cleared)
    gateAction({ taskId: 7, pending: [] });
    assert.equal(page.nativeSends.length, 2);
  } finally {
    restore();
  }
});

test('gate: heartbeat-only pending goes out as-is with zero counter', async () => {
  const { page, restore } = installPage();
  try {
    gateAction({ taskId: 3, heartbeat: true });

    assert.equal(page.nativeSends.length, 1);
    const body = JSON.parse(page.nativeSends[0].body);
    assert.equal(body.data.length, 1);
    assert.equal(body.data[0].type, 10);
    assert.deepEqual(body.data[0].payload, [0]);
  } finally {
    restore();
  }
});

test('gate: burst uses page headers when available, CertCode fallback otherwise', async () => {
  const { page, restore } = installPage({ pathname: '/code/3750' });
  try {
    gateAction({ taskId: 9, pending: [{ type: 5, payload: [2, 0, 1001] }] });
    const sent = page.nativeSends[0];
    const headers = sent.headers;
    assert.equal(headers['X-Hhtmsource'], 'CertCode', 'code page → CertCode');
    assert.equal(headers['X-XSRFToken'], 'abc123', 'xsrf from cookie');
    assert.equal(headers['x-hhtmsourcelabel'], '', 'empty hhtm headers like the live client');

    // Now the page sent its own request — the next bursts take its headers
    await (globalThis as any).window.fetch(REPORT_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Hhtmsource': 'CertCode',
        'X-Requested-With': 'XMLHttpRequest'
      },
      body: '{"data":[]}'
    });
    gateAction({ taskId: 9, pending: [{ type: 8, payload: [] }] });
    assert.equal(page.nativeSends[1].headers['X-Requested-With'], 'XMLHttpRequest');
  } finally {
    restore();
  }
});

test('gate: theory page fallback uses CertTests', () => {
  const { page, restore } = installPage({ pathname: '/tests/1114' });
  try {
    gateAction({ taskId: 5, pending: [{ type: 8, payload: [] }] });
    assert.equal(page.nativeSends[0].headers['X-Hhtmsource'], 'CertTests');
  } finally {
    restore();
  }
});

test('gate: page XHR report_data proxied through real XHR with rewritten body', async () => {
  const { page, FakeXHR, restore } = installPage();
  try {
    gateAction({ taskId: 11 });
    const xhr = new FakeXHR();
    xhr.open('POST', REPORT_URL);
    xhr.setRequestHeader('Content-Type', 'application/json');
    xhr.onload = () => {
      page.loaded = true;
    };
    xhr.send('{"data":[{"taskId":1,"type":10,"payload":[0]}]}');
    await tick();

    assert.equal(page.nativeSends.length, 1, 'XHR telemetry reaches the network');
    const body = JSON.parse(page.nativeSends[0].body);
    assert.equal(body.data[0].taskId, 11);
    assert.equal(xhr.status, 200, 'caller sees the real response');
    assert.equal(xhr.readyState, 4);
    assert.equal(page.loaded, true);
  } finally {
    restore();
  }
});

test('gate: other API requests pass through untouched', async () => {
  const { page, FakeXHR, restore } = installPage();
  try {
    gateAction({ taskId: 1 });
    const xhr = new FakeXHR();
    xhr.open('GET', OTHER_URL);
    xhr.send(null);
    assert.equal(page.pageSends.length, 1, 'non-report XHR goes directly to network');
    assert.equal(page.pageSends[0].url, OTHER_URL);
    assert.equal(page.nativeSends.length, 0);
  } finally {
    restore();
  }
});

test('gate: sendBeacon report_data rewritten and forwarded', () => {
  const { page, restore } = installPage({ beacon: true });
  try {
    const beacon = (globalThis as any).navigator.sendBeacon.bind((globalThis as any).navigator);
    gateAction({ taskId: 13 });
    const result = beacon(REPORT_URL, '{"data":[{"taskId":1,"type":10,"payload":[0]}]}');
    assert.equal(result, true);
    assert.equal(page.beaconCalls.length, 1);
    const body = JSON.parse(page.beaconCalls[0].data);
    assert.equal(body.data[0].taskId, 13);

    beacon(OTHER_URL, 'x');
    assert.equal(page.beaconCalls.length, 2);
    assert.equal(page.beaconCalls[1].url, OTHER_URL);
  } finally {
    restore();
  }
});

test('gate: idempotent via marker, canary listeners untouched', () => {
  const { document, restore } = installPage();
  try {
    assert.equal(document.documentElement.__hhGate, '1');
    gateAction({ install: true });
    assert.equal(document.documentElement.__hhGate, '1');
    assert.equal(document.addEventListener, undefined, 'no DOM listeners must be added');
  } finally {
    restore();
  }
});

test('gate: calls without install are no-ops (no state yet)', () => {
  const { restore } = installPage({ install: false });
  try {
    assert.equal(gateAction({ taskId: 1, pending: [{ type: 8, payload: [] }] }), 'no-state');
    assert.equal(gateAction({ heartbeat: true }), 'no-state');
    assert.equal(gateAction({}), 'no-state');
  } finally {
    restore();
  }
});

test('gate: theory strips detector types (blur), keeps 8/10 with rewritten taskId', async () => {
  const { page, restore } = installPage({ pathname: '/tests/1114' });
  try {
    gateAction({ taskId: 42 });
    await (globalThis as any).window.fetch(REPORT_URL, {
      method: 'POST',
      headers: { 'X-Hhtmsource': 'CertTests' },
      body: JSON.stringify({
        data: [
          { taskId: 1, type: 1, timestamp: 't', payload: [0, 25712] },
          { taskId: 1, type: 5, timestamp: 't', payload: [1, 0, 5000] },
          { taskId: 1, type: 10, timestamp: 't', payload: [0] }
        ],
        taskId: 1
      })
    });

    assert.equal(page.nativeSends.length, 1);
    const body = JSON.parse(page.nativeSends[0].body);
    assert.equal(body.data.length, 1, 'type 1 and type 5 stripped on theory');
    assert.equal(body.data[0].type, 10);
    assert.equal(body.data[0].taskId, 42);
  } finally {
    restore();
  }
});

test('gate: practice keeps type 5 (code typing), strips blur', async () => {
  const { page, restore } = installPage({ pathname: '/code/1114' });
  try {
    gateAction({ taskId: 7 });
    await (globalThis as any).window.fetch(REPORT_URL, {
      method: 'POST',
      headers: { 'X-Hhtmsource': 'CertCode' },
      body: JSON.stringify({
        data: [
          { taskId: 1, type: 1, timestamp: 't', payload: [0, 6421] },
          { taskId: 1, type: 5, timestamp: 't', payload: [2, 0, 1001] },
          { taskId: 1, type: 10, timestamp: 't', payload: [0] }
        ],
        taskId: 1
      })
    });

    assert.equal(page.nativeSends.length, 1);
    const body = JSON.parse(page.nativeSends[0].body);
    assert.deepEqual(
      body.data.map((e: any) => e.type),
      [5, 10],
      'type 5 passes on practice, blur stripped'
    );
    assert.equal(body.data[0].taskId, 7);
  } finally {
    restore();
  }
});

test('gate: all events hidden → synthetic success, nothing sent', async () => {
  const { page, FakeXHR, restore } = installPage({ pathname: '/tests/1114' });
  try {
    gateAction({ taskId: 5 });
    const response = await (globalThis as any).window.fetch(REPORT_URL, {
      method: 'POST',
      body: JSON.stringify({ data: [{ taskId: 1, type: 1, payload: [0, 25000] }], taskId: 1 })
    });
    assert.equal(response.status, 200, 'fetch caller gets synthetic success');
    assert.equal(page.nativeSends.length, 0, 'nothing reaches the network');

    const xhr = new FakeXHR();
    xhr.open('POST', REPORT_URL);
    xhr.onload = () => {
      page.loaded = true;
    };
    xhr.send('{"data":[{"taskId":1,"type":9,"payload":["canary"]}]}');
    assert.equal(xhr.status, 200, 'XHR caller gets synthetic success');
    assert.equal(page.loaded, true, 'XHR onload fired');
    assert.equal(page.nativeSends.length, 0);
  } finally {
    restore();
  }
});

test('gate: type 10 counter corrected by number of stripped events', async () => {
  const { page, restore } = installPage({ pathname: '/tests/1114' });
  try {
    gateAction({ taskId: 9 });
    await (globalThis as any).window.fetch(REPORT_URL, {
      method: 'POST',
      body: JSON.stringify({
        data: [
          { taskId: 1, type: 1, timestamp: 't', payload: [0, 10000] },
          { taskId: 1, type: 10, timestamp: 't', payload: [2] }
        ],
        taskId: 1
      })
    });

    const body = JSON.parse(page.nativeSends[0].body);
    assert.equal(body.data.length, 1);
    assert.deepEqual(body.data[0].payload, [1], 'counter 2 − 1 hidden event = 1');
  } finally {
    restore();
  }
});

test('gate: beacon with only stripped events returns true without sending', () => {
  const { page, restore } = installPage({ beacon: true, pathname: '/tests/1114' });
  try {
    const beacon = (globalThis as any).navigator.sendBeacon.bind((globalThis as any).navigator);
    gateAction({ taskId: 13 });
    const result = beacon(REPORT_URL, '{"data":[{"taskId":1,"type":2,"payload":[0,0]}]}');
    assert.equal(result, true);
    assert.equal(page.beaconCalls.length, 0, 'blur-only beacon is not sent');
  } finally {
    restore();
  }
});

test('gate: XHR addEventListener receives load and readystatechange events', async () => {
  const { FakeXHR, restore } = installPage();
  try {
    gateAction({ taskId: 15 });
    const xhr = new FakeXHR();
    let loadFired = false;
    let stateFired = false;
    xhr.addEventListener('load', () => {
      loadFired = true;
    });
    xhr.addEventListener('readystatechange', () => {
      stateFired = true;
    });
    xhr.open('POST', REPORT_URL);
    xhr.send('{"data":[{"taskId":1,"type":10,"payload":[0]}]}');
    await tick();

    assert.equal(loadFired, true, 'addEventListener("load") was invoked');
    assert.equal(stateFired, true, 'addEventListener("readystatechange") was invoked');
    assert.equal(xhr.status, 200);
  } finally {
    restore();
  }
});

test('gate: XHR abort propagates to the proxied request', async () => {
  const { page, FakeXHR, restore } = installPage();
  try {
    gateAction({ taskId: 30 });
    const xhr = new FakeXHR();
    let aborted = 0;
    xhr.addEventListener('abort', () => {
      aborted++;
    });
    xhr.onabort = () => {
      aborted++;
    };
    xhr.open('POST', REPORT_URL);
    xhr.send('{"data":[{"taskId":1,"type":10,"payload":[0]}]}');
    assert.equal(page.nativeSends.length, 1, 'запрос ушёл через прокси');

    xhr.abort();
    assert.equal(xhr._aborted, true);
    assert.equal(aborted, 2, 'onabort + abort-событие доставлены оригиналу');
    assert.equal(page.nativeSends.length, 1, 'повторных отправок нет');
  } finally {
    restore();
  }
});

test('gate: beacon with non-string data passes through untouched', () => {
  const { page, restore } = installPage({ beacon: true });
  try {
    const beacon = (globalThis as any).navigator.sendBeacon.bind((globalThis as any).navigator);
    gateAction({ taskId: 13 });
    const blob = new Blob(['{"data":[]}'], { type: 'application/json' });
    const result = beacon(REPORT_URL, blob);
    assert.equal(result, true);
    assert.equal(page.beaconCalls.length, 1, 'blob-beacon уходит как есть');
    assert.equal(page.beaconCalls[0].data, blob, 'тело не фильтруется и не подменяется');
  } finally {
    restore();
  }
});

test('gate: fetch with Request object rewrites body correctly', async () => {
  const { page, restore } = installPage();
  try {
    gateAction({ taskId: 20 });
    const req = {
      url: REPORT_URL,
      headers: { 'X-Hhtmsource': 'CertCode' },
      body: JSON.stringify({ data: [{ taskId: 1, type: 10, payload: [0] }], taskId: 1 })
    };
    const response = await (globalThis as any).window.fetch(req);
    assert.equal(response.status, 200);
    assert.equal(page.nativeSends.length, 1);
    const sentBody = JSON.parse(page.nativeSends[0].body);
    assert.equal(sentBody.taskId, 20);
    assert.equal(sentBody.data[0].taskId, 20);
  } finally {
    restore();
  }
});
