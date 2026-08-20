// report_data telemetry gate on the solver tab (docs/plan.md §3.3).
//
// Two-layer telemetry handling:
//
// 1. Page report_data (XHR/fetch/beacon) is FILTERED: detector types are
//    stripped out — {1,2,3,4,5,6,7,9} for theory, {1,2,3,4,6,7,9} for practice
//    (type 5 "code editor" stays in practice — it's sent by the typing
//    itself). The surviving honest stream {5,8,10} goes with the taskId of the
//    current question/task (the page uses the taskId of the first question,
//    which conflicts with the API solver's progress). The violation counter
//    in type 10 is adjusted by the number of hidden events; if all events are
//    hidden, no request is sent and the caller gets a synthetic success.
//
// 2. Events the page cannot produce (answer choice type 8, code edit type 5
//    when solving via API) are injected through gateAction: they go out as an
//    immediate burst request in the live client format
//    "action → heartbeat [counter] → heartbeat [0]". Burst headers are taken
//    from the page's last outgoing request (X-Hhtmsource: CertCode/CertTests
//    etc.) — the server never sees foreign headers. Injected events are not
//    filtered (they only contain allowed types).
//
// A single self-contained function (executeScript in the MAIN world, no
// imports): gateAction({install:true}) installs the interceptors (idempotent
// via a marker), other calls update the state and flush pending immediately.

export interface GateActionParams {
  install?: boolean;
  taskId?: number;
  pending?: Array<{ type: number; payload?: unknown[] }>;
  heartbeat?: boolean;
  [key: string]: unknown;
}

export function gateAction(json?: GateActionParams): string {
  const root = typeof document !== 'undefined' ? (document.documentElement as any) : null;
  if (!root) return 'no-doc';

  const isoNow = () => {
    const d = new Date();
    const p = (value: number) => String(value).padStart(2, '0');
    const off = -d.getTimezoneOffset();
    const sign = off >= 0 ? '+' : '-';
    const abs = Math.abs(off);
    return (
      `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}` +
      `T${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}` +
      `${sign}${p(Math.floor(abs / 60))}:${p(abs % 60)}`
    );
  };

  const isReport = (url: unknown): boolean =>
    typeof url === 'string' && url.indexOf('/shards/contest/report_data') !== -1;

  // Headers when the page hasn't sent anything yet (first burst): the contour
  // is inferred from the URL, XSRF from the cookie, empty hhtm headers like
  // the live client.
  const buildHeaders = (): Record<string, string> => {
    const xsrf = (document.cookie.match(/(?:^|;\s*)_xsrf=([^;]+)/) || [])[1] || '';
    const pathname = (typeof location !== 'undefined' && location.pathname) || '';
    const source = pathname.indexOf('/code/') !== -1 ? 'CertCode' : 'CertTests';
    return {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      'X-Requested-With': 'XMLHttpRequest',
      'X-Hhtmsource': source,
      'X-XSRFToken': xsrf ? decodeURIComponent(xsrf) : '',
      'x-hhtmsourcelabel': '',
      'x-hhtmfromlabel': '',
      'x-hhtmfrom': ''
    };
  };

  const normalizeHeaders = (headers: any): Record<string, string> => {
    const out: Record<string, string> = {};
    try {
      if (typeof Headers !== 'undefined' && headers instanceof Headers) {
        headers.forEach((value: string, key: string) => {
          out[key] = value;
        });
      } else if (headers && typeof headers === 'object') {
        for (const key of Object.keys(headers)) out[key] = headers[key];
      }
    } catch {}
    return out;
  };

  // Detector types the page can only send on real violations (window blur,
  // resize, copy/paste, canary) — impossible on the solver tab. Keep type 5 in
  // practice (code editor — injected by the typing itself); theory has no
  // type 5 at all.
  const STRIP: Record<string, number[]> = {
    tests: [1, 2, 3, 4, 5, 6, 7, 9],
    code: [1, 2, 3, 4, 6, 7, 9]
  };

  // Tab contour: /code/* — practice (cert_code), otherwise theory (cert_tests).
  // Determined at install; never changes within one document.
  const contour =
    typeof location !== 'undefined' &&
    typeof location.pathname === 'string' &&
    location.pathname.indexOf('/code/') !== -1
      ? 'code'
      : 'tests';

  // Filtering + taskId rewrite of the page report_data body. Returns
  // { body, sent }: body — the cleaned JSON (or null), sent=false means "all
  // events were hidden — don't send the request".
  const filterBody = (
    body: unknown,
    taskId?: number | null
  ): { body: string | null; sent: boolean } => {
    if (typeof body !== 'string') return { body: null, sent: false };
    let parsed: any;
    try {
      parsed = JSON.parse(body);
    } catch {
      return { body: null, sent: false };
    }
    if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.data)) {
      return { body: null, sent: false };
    }
    const strip = STRIP[contour] || STRIP.tests;
    const kept: any[] = [];
    let hidden = 0;
    for (const event of parsed.data) {
      if (!event || typeof event !== 'object' || typeof event.type !== 'number') {
        continue;
      }
      if (strip.indexOf(event.type) !== -1) {
        hidden++;
        continue;
      }
      // The violation counter in type 10 (payload[0] = detectedEvents) is reduced by
      // the number of hidden detector events — the server sees no "hole".
      if (
        event.type === 10 &&
        hidden > 0 &&
        Array.isArray(event.payload) &&
        typeof event.payload[0] === 'number'
      ) {
        event.payload[0] = Math.max(0, event.payload[0] - hidden);
        hidden = 0;
      }
      if (taskId && 'taskId' in event) event.taskId = taskId;
      kept.push(event);
    }
    if (!kept.length) return { body: null, sent: false };
    parsed.data = kept;
    if (taskId) parsed.taskId = taskId;
    return { body: JSON.stringify(parsed), sent: true };
  };

  // Send a burst request on behalf of the page: its fetch (native, outside the
  // intercept), its headers, its origin/cookie. Fire-and-forget.
  const sendBurst = (st: any, events: any[]) => {
    const data = events.map(event => ({
      type: event.type,
      taskId: st.taskId,
      timestamp: isoNow(),
      payload: event.payload ?? []
    }));
    const headers = st.headers || buildHeaders();
    const body = JSON.stringify({ data, taskId: st.taskId });
    if (st.nativeFetch) {
      try {
        st.nativeFetch('/shards/contest/report_data', { method: 'POST', headers, body }).catch(
          () => {}
        );
      } catch {}
    }
    return body;
  };

  // Flush injected events in the live client format: the actions first, then a
  // heartbeat with a counter (number of actions since the last flush — like
  // the page's detectedEvents), then "empty" heartbeats.
  const flush = (st: any) => {
    const pending = st.pending || (st.pending = []);
    if (!pending.length) return;
    const events = pending.splice(0);
    const actions = events.filter((event: any) => event && event.type !== 10);
    const beats = events.filter((event: any) => event && event.type === 10);
    if (actions.length) {
      sendBurst(st, actions);
      sendBurst(st, [{ type: 10, payload: [actions.length] }]);
    }
    if (beats.length) sendBurst(st, beats);
  };

  if (json && json.install) {
    if (root.__hhGate) return 'installed';
    root.__hhGate = '1';
    const win = window as any;
    const st =
      win.__hhGateState ||
      (win.__hhGateState = {
        taskId: null,
        pending: [],
        headers: null,
        nativeFetch: null
      });
    st.nativeFetch = typeof window.fetch === 'function' ? window.fetch.bind(window) : null;

    const XHR = XMLHttpRequest;
    const protoOpen = XHR.prototype.open;
    const protoSend = XHR.prototype.send;
    const protoSetHeader = XHR.prototype.setRequestHeader;

    XHR.prototype.open = function (this: any, method: string, url: string | URL) {
      this.__hhUrl = url;
      this.__hhMethod = method;
      return protoOpen.apply(this, arguments as any);
    };
    XHR.prototype.setRequestHeader = function (this: any, name: string, value: string) {
      (this.__hhHeaders || (this.__hhHeaders = {}))[name] = value;
      return protoSetHeader.apply(this, arguments as any);
    };
    XHR.prototype.send = function (this: any, body?: any) {
      if (this.__hhProxy || !isReport(this.__hhUrl)) return protoSend.apply(this, arguments as any);
      const st = (window as any).__hhGateState;
      flush(st);
      const headers = this.__hhHeaders || {};
      st.headers = Object.assign({}, headers);
      const filtered = filterBody(body, st.taskId);
      if (!filtered.sent) {
        // All events were hidden by the filter — the request never goes out; the
        // caller gets a synthetic success, as in the old guard.
        try {
          const setProp = (prop: string, val: any) => {
            try {
              this[prop] = val;
            } catch {
              try {
                Object.defineProperty(this, prop, {
                  value: val,
                  writable: true,
                  configurable: true
                });
              } catch {}
            }
          };
          setProp('status', 200);
          setProp('readyState', 4);
          setProp('responseText', '{}');
          setProp('response', '{}');
          if (typeof this.onreadystatechange === 'function')
            this.onreadystatechange.call(this, { type: 'readystatechange' });
          if (typeof this.onload === 'function') this.onload.call(this, { type: 'load' });
          if (typeof this.dispatchEvent === 'function') {
            try {
              this.dispatchEvent(new Event('readystatechange'));
            } catch {}
            try {
              this.dispatchEvent(new Event('load'));
            } catch {}
            try {
              this.dispatchEvent(new Event('loadend'));
            } catch {}
          }
        } catch {}
        return undefined;
      }
      let real: any;
      try {
        real = new XHR();
      } catch {
        return protoSend.apply(this, arguments as any);
      }
      this.__hhReal = real;
      // Proxy response: the page gets the real status/body from the server.
      real.__hhProxy = true;
      const setProp = (prop: string, val: any) => {
        try {
          this[prop] = val;
        } catch {
          try {
            Object.defineProperty(this, prop, { value: val, writable: true, configurable: true });
          } catch {}
        }
      };
      real.onreadystatechange = () => {
        setProp('readyState', real.readyState);
        if (real.readyState === 4) {
          setProp('status', real.status);
          setProp('statusText', real.statusText);
          setProp('responseText', real.responseText);
          setProp('response', real.response);
        }
        if (typeof this.onreadystatechange === 'function') this.onreadystatechange.call(this);
        if (typeof this.dispatchEvent === 'function') {
          try {
            this.dispatchEvent(new Event('readystatechange'));
          } catch {}
        }
      };
      real.onload = () => {
        if (typeof this.onload === 'function') this.onload.call(this);
        if (typeof this.dispatchEvent === 'function') {
          try {
            this.dispatchEvent(new Event('load'));
          } catch {}
          try {
            this.dispatchEvent(new Event('loadend'));
          } catch {}
        }
      };
      real.onerror = () => {
        if (typeof this.onerror === 'function') this.onerror.call(this);
        if (typeof this.dispatchEvent === 'function') {
          try {
            this.dispatchEvent(new Event('error'));
          } catch {}
          try {
            this.dispatchEvent(new Event('loadend'));
          } catch {}
        }
      };
      real.onabort = () => {
        if (typeof this.onabort === 'function') this.onabort.call(this);
        if (typeof this.dispatchEvent === 'function') {
          try {
            this.dispatchEvent(new Event('abort'));
          } catch {}
          try {
            this.dispatchEvent(new Event('loadend'));
          } catch {}
        }
      };
      real.open(this.__hhMethod || 'POST', this.__hhUrl);
      for (const key of Object.keys(headers)) real.setRequestHeader(key, headers[key]);
      real.send(filtered.body);
      return undefined;
    };

    const protoAbort = XHR.prototype.abort;
    XHR.prototype.abort = function () {
      if ((this as any).__hhReal) {
        try {
          (this as any).__hhReal.abort();
        } catch {}
      }
      return protoAbort.apply(this, arguments as any);
    };

    if (st.nativeFetch) {
      window.fetch = function (input: any, init?: any) {
        const url = typeof input === 'string' ? input : (input && input.url) || '';
        if (!isReport(url)) return st.nativeFetch.apply(this, arguments);
        try {
          const reqHeaders = (init && init.headers) || (input && input.headers);
          if (reqHeaders) st.headers = normalizeHeaders(reqHeaders);
          flush(st);
          const reqBody =
            (init && init.body) || (input && typeof input.body === 'string' ? input.body : null);
          const filtered = filterBody(reqBody, st.taskId);
          if (!filtered.sent) {
            // All events were hidden by the filter — synthetic success without the network.
            return Promise.resolve(new Response('{}', { status: 200, statusText: 'OK' }));
          }
          if (typeof input === 'string') {
            return st.nativeFetch(url, Object.assign({}, init, { body: filtered.body }));
          }
          if (typeof Request !== 'undefined' && input instanceof Request) {
            return st.nativeFetch(
              new Request(input, Object.assign({}, init, { body: filtered.body }))
            );
          }
          return st.nativeFetch(input, Object.assign({}, init, { body: filtered.body }));
        } catch {
          return st.nativeFetch.apply(this, arguments);
        }
      };
    }

    if (typeof navigator.sendBeacon === 'function') {
      const originalBeacon = navigator.sendBeacon.bind(navigator);
      navigator.sendBeacon = function (url: string | URL, data?: any) {
        if (!isReport(url)) return originalBeacon(url, data);
        if (typeof data !== 'string') return originalBeacon(url, data);
        try {
          const st = (window as any).__hhGateState;
          flush(st);
          const filtered = filterBody(data, st.taskId);
          if (!filtered.sent) return true;
          return originalBeacon(url, filtered.body);
        } catch {
          return originalBeacon(url, data);
        }
      };
    }
    return 'installed';
  }

  // Non-install calls only work over an installed gate (install always comes
  // first after navigation) — otherwise no-op.
  const win = window as any;
  if (!win.__hhGateState) return 'no-state';
  const st = win.__hhGateState;
  if (json && json.taskId) st.taskId = json.taskId;
  if (json && Array.isArray(json.pending)) st.pending.push(...json.pending);
  if (json && json.heartbeat) st.pending.push({ type: 10, payload: [0] });
  flush(st);
  return 'ok';
}
