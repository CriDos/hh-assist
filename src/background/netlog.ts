// Test network activity recording (docs/plan.md §3.8): EVERYTHING that goes
// to hh.ru from the test tab and from the service worker — both page requests
// (report_data, get_current_task, static assets) and extension requests
// (tab bridge via executeScript, the fetchCodePage fallback). This lets you
// compare the flows of a live client and the extension by url/method/headers/
// request body.

import { pushLog } from './log.ts';

const STORAGE_KEY = 'hhNetArchive';
const ARMED_KEY = 'hhNetArmed';
const MAX_SESSIONS = 10;
const MAX_ENTRIES = 1000;
const MAX_BODY = 65536;
const MAX_PERSIST_SESSIONS = 5;
const PERSIST_ENTRIES = 50; // storage.local gets only a subset, otherwise it won't fit
const PERSIST_BODY = 1500;

// Headers relevant for flow comparison; the rest (service ones) are not stored
// so the recording stays readable.
const RECORD_HEADERS = [
  'X-Hhtmsource',
  'X-XSRFToken',
  'X-Requested-With',
  'Content-Type',
  'Origin',
  'Referer',
  'Cookie'
];

export interface NetEntry {
  ts: number;
  method: string;
  url: string;
  type: string;
  body: string | null;
  headers: Record<string, string> | null;
  status: number | null;
  error: string | null;
}

export interface NetSession {
  id: string;
  startedAt: number | null;
  finishedAt: number;
  test: any;
  count: number;
  truncated: boolean;
  entries: NetEntry[];
}

const rec: {
  armed: boolean;
  active: boolean;
  manual: boolean;
  tabId: number | null;
  test: any;
  startedAt: number | null;
  entries: NetEntry[];
  truncated: boolean;
  archive: NetSession[];
} = {
  armed: false,
  active: false,
  manual: false,
  tabId: null,
  test: null,
  startedAt: null,
  entries: [],
  truncated: false,
  archive: []
};

let pending = new Map<string, NetEntry>();
let sessionSeq = 0;
let armedRevision = 0;

function isTarget(details: any) {
  if (!rec.active) return false;
  if (details.tabId !== rec.tabId) {
    if (details.tabId !== -1 || rec.manual) return false;
  }
  const url = String(details.url || '');
  return (
    url.startsWith('https://') &&
    (url.includes('.hh.ru') ||
      url.includes('https://hh.ru/') ||
      url.includes('.rabota.by') ||
      url.includes('https://rabota.by/') ||
      url.includes('.hh.kz') ||
      url.includes('https://hh.kz/'))
  );
}

function bodyFrom(requestBody: any): string | null {
  if (!requestBody) return null;
  if (requestBody.error) return `[ошибка чтения тела: ${requestBody.error}]`;
  const raw = requestBody.raw?.[0]?.bytes;
  if (raw) {
    try {
      const text = new TextDecoder().decode(raw);
      return text.length > MAX_BODY ? `${text.slice(0, MAX_BODY)}…` : text;
    } catch {
      return '[нечитаемое тело]';
    }
  }
  if (requestBody.formData) return JSON.stringify(requestBody.formData);
  return null;
}

function pickHeaders(headers: any[]): Record<string, string> {
  const wanted = new Set(RECORD_HEADERS.map(name => name.toLowerCase()));
  const picked: Record<string, string> = {};
  for (const { name, value } of headers || []) {
    if (wanted.has(String(name).toLowerCase())) picked[name] = value;
  }
  return picked;
}

function maybeBeginManual(details: any) {
  const url = String(details.url || '');
  const isMainFrame = details.type === 'main_frame';
  const started =
    url.includes('redirect_to_test') ||
    (isMainFrame && /assessment\.hh\.ru\/(tests|code)\//.test(url));
  if (!started) return;
  if (rec.active && rec.manual) endTest();
  if (rec.active) return;
  beginTest({ item: null, level: null, kind: null, source: 'manual' });
  rec.tabId = details.tabId;
  pushLog('info', 'Запись: тест пройден вручную — начата запись');
}

function checkManualEnd(details: any) {
  if (!rec.active || !rec.manual) return;
  const url = String(details.url || '');
  if (url.includes('post_finish')) {
    endTest();
    pushLog('info', 'Запись: ручной тест завершён');
    return;
  }
  if (details.type === 'main_frame' && url.includes('contest_result')) {
    endTest();
    pushLog('info', 'Запись: ручной тест завершён');
  }
}

function onBeforeRequest(details: any) {
  if (!rec.armed) return;
  if (!rec.active) {
    maybeBeginManual(details);
    if (!rec.active) return;
  }
  if (
    rec.active &&
    rec.manual &&
    details.type === 'main_frame' &&
    !String(details.url || '').includes('hh.ru')
  ) {
    endTest();
    pushLog('info', 'Запись: ручная сессия завершена (вкладка ушла с hh.ru)');
    return;
  }
  if (!isTarget(details)) return;
  if (rec.entries.length >= MAX_ENTRIES) {
    rec.truncated = true;
    rec.entries.shift();
  }
  const entry: NetEntry = {
    ts: details.timeStamp,
    method: details.method,
    url: details.url,
    type: details.type,
    body: bodyFrom(details.requestBody),
    headers: null,
    status: null,
    error: null
  };
  pending.set(details.requestId, entry);
  rec.entries.push(entry);
  checkManualEnd(details);
}

function onBeforeSendHeaders(details: any) {
  const entry = pending.get(details.requestId);
  if (entry) entry.headers = pickHeaders(details.requestHeaders);
}

function onCompleted(details: any) {
  const entry = pending.get(details.requestId);
  if (entry) entry.status = details.statusCode;
}

function onErrorOccurred(details: any) {
  const entry = pending.get(details.requestId);
  if (entry) entry.error = details.error;
}

function onTabRemoved(tabId: number) {
  if (!rec.active || !rec.manual || tabId !== rec.tabId) return;
  endTest();
  pushLog('info', 'Запись: ручная сессия прервана (вкладка закрыта)');
}

function registerListeners() {
  const wr = chrome?.webRequest;
  if (!wr?.onBeforeRequest) return;
  const urls = [
    'https://*.hh.ru/*',
    'https://hh.ru/*',
    'https://*.rabota.by/*',
    'https://rabota.by/*',
    'https://*.hh.kz/*',
    'https://hh.kz/*'
  ];
  wr.onBeforeRequest.addListener(onBeforeRequest, { urls }, ['requestBody']);
  wr.onBeforeSendHeaders.addListener(onBeforeSendHeaders, { urls }, ['requestHeaders']);
  wr.onCompleted.addListener(onCompleted, { urls });
  wr.onErrorOccurred.addListener(onErrorOccurred, { urls });
  chrome?.tabs?.onRemoved?.addListener(onTabRemoved);
}

registerListeners();

function persist() {
  const payload = rec.archive.slice(0, MAX_PERSIST_SESSIONS).map(session => {
    const entries = session.entries.slice(0, PERSIST_ENTRIES).map(entry => {
      const body =
        typeof entry.body === 'string' && entry.body.length > PERSIST_BODY
          ? `${entry.body.slice(0, PERSIST_BODY)}…`
          : entry.body;
      return { ...entry, body };
    });
    return { ...session, count: entries.length, entries };
  });
  try {
    void chrome.storage.local.set({ [STORAGE_KEY]: payload }).catch(() => {});
  } catch {}
}

export function setArmed(on: boolean): { armed: boolean } {
  armedRevision++;
  rec.armed = Boolean(on);
  try {
    void chrome.storage?.local?.set({ [ARMED_KEY]: rec.armed }).catch(() => {});
  } catch {}
  if (!rec.armed && rec.active) {
    rec.active = false;
    rec.manual = false;
    rec.entries = [];
    rec.test = null;
    rec.truncated = false;
  }
  return { armed: rec.armed };
}

export function beginTest(test: any): void {
  if (!rec.armed) return;
  if (rec.active && rec.manual) endTest();
  rec.active = true;
  rec.manual = test.source === 'manual';
  rec.test = {
    item: test.item ?? null,
    level: test.level ?? null,
    kind: test.kind ?? null,
    source: rec.manual ? 'manual' : 'extension'
  };
  rec.startedAt = Date.now();
  rec.tabId = null;
  rec.entries = [];
  rec.truncated = false;
  pending.clear();
}

export function setTabId(tabId: number | null): void {
  rec.tabId = tabId ?? null;
}

export function endTest(): void {
  if (!rec.active) return;
  rec.active = false;
  rec.manual = false;
  const session: NetSession = {
    id: `net-${rec.startedAt}-${sessionSeq++}`,
    startedAt: rec.startedAt,
    finishedAt: Date.now(),
    test: rec.test,
    count: rec.entries.length,
    truncated: rec.truncated,
    entries: rec.entries
  };
  rec.archive.unshift(session);
  if (rec.archive.length > MAX_SESSIONS) rec.archive.length = MAX_SESSIONS;
  rec.entries = [];
  rec.test = null;
  rec.truncated = false;
  pending.clear();
  persist();
}

export async function initNetLog(): Promise<void> {
  const revision = armedRevision;
  try {
    const stored = await chrome.storage.local.get(STORAGE_KEY);
    rec.archive = Array.isArray(stored?.[STORAGE_KEY]) ? stored[STORAGE_KEY] : [];
  } catch {}
  try {
    const armed = await chrome.storage.local.get(ARMED_KEY);
    if (revision === armedRevision && armed?.[ARMED_KEY] === true) rec.armed = true;
  } catch {}
}

export function status() {
  return {
    armed: rec.armed,
    active: rec.active,
    test: rec.active ? rec.test : null,
    startedAt: rec.active ? rec.startedAt : null,
    count: rec.entries.length,
    truncated: rec.truncated,
    archive: rec.archive.map(session => ({
      id: session.id,
      startedAt: session.startedAt,
      finishedAt: session.finishedAt,
      test: session.test,
      count: session.count,
      truncated: session.truncated
    }))
  };
}

export function getSession(id: string): NetSession | null {
  const session = rec.archive.find(entry => entry.id === id);
  return session || null;
}

export function clearArchive(): { ok: boolean } {
  rec.archive = [];
  persist();
  return { ok: true };
}
