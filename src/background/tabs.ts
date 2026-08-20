// Tab handling: waiting for navigation, the extension's SINGLE tab
// (catalog → test → catalog), telemetry gate, session check, SSR requests for
// catalog/code pages, and reading the completion page.

import { PROTO } from '../core/proto.ts';
import { gateAction } from '../core/telemetry-gate.ts';
import { probeSession } from '../core/page-fp.ts';
import { sha256Hex } from '../core/fingerprint.ts';
import { isAssessmentUrl } from '../core/page-utils.ts';
import { parseCatalog } from '../core/catalog.ts';
import { parseResultPage, readCompletionContent, readSsrContent } from '../core/result.ts';
import { sleep } from '../core/timing.ts';
import { pushLog } from './log.ts';
import { state } from './state.ts';

// The test tab is the extension's ONLY tab: hh.ru/spb.hh.ru catalog. Session,
// fingerprint, redirect to the test and return to the catalog — all happen
// here: the extension never opens a second tab.
const TAB_WAIT_TIMEOUT_MS = 30000;

export function isHhDomain(hostname = ''): boolean {
  const h = String(hostname || '').toLowerCase();
  return (
    h === 'hh.ru' ||
    h.endsWith('.hh.ru') ||
    h === 'rabota.by' ||
    h.endsWith('.rabota.by') ||
    h === 'hh.kz' ||
    h.endsWith('.hh.kz')
  );
}

export function getHhOrigin(tabUrl?: string | null): string {
  if (tabUrl) {
    try {
      const parsed = new URL(tabUrl);
      if (isHhDomain(parsed.hostname) && parsed.hostname !== 'assessment.hh.ru') {
        return parsed.origin;
      }
    } catch {}
  }
  if (state.hhOrigin) return state.hhOrigin;
  return 'https://hh.ru';
}

export function waitTabComplete(
  tabId: number,
  { timeoutMs = TAB_WAIT_TIMEOUT_MS, stepMs = 50 } = {}
): Promise<chrome.tabs.Tab | null> {
  const deadline = Date.now() + timeoutMs;
  return new Promise(resolve => {
    const poll = async () => {
      try {
        const tab = await chrome.tabs.get(tabId);
        if (tab?.status === 'complete' || Date.now() > deadline) return resolve(tab);
      } catch {
        return resolve(null);
      }
      setTimeout(poll, stepMs);
    };
    poll();
  });
}

// Find an existing hh tab (any subdomain or domain); if there is no
// tab — open the catalog. Returns { tabId, created }.
export async function ensureMainTab(): Promise<{ tabId: number; created: boolean }> {
  const queryPatterns = [
    'https://*.hh.ru/*',
    'https://hh.ru/*',
    'https://*.rabota.by/*',
    'https://rabota.by/*',
    'https://*.hh.kz/*',
    'https://hh.kz/*'
  ];
  let tabs: chrome.tabs.Tab[] = [];
  try {
    const res = await chrome.tabs.query({ url: queryPatterns });
    tabs = Array.isArray(res) ? res : [];
  } catch {
    for (const pattern of queryPatterns) {
      try {
        const found = await chrome.tabs.query({ url: pattern });
        if (Array.isArray(found)) tabs.push(...found);
      } catch {}
    }
  }

  const nonAssessment = tabs.filter(t => t.url && !isAssessmentUrl(t.url));
  const existing =
    nonAssessment.find(tab => tab.id && tab.status === 'complete') || nonAssessment[0] || tabs[0];

  if (existing?.id) {
    state.hhOrigin = getHhOrigin(existing.url);
    return { tabId: existing.id, created: false };
  }

  const origin = getHhOrigin();
  const catalogUrl = `${origin}${PROTO.catalog.path}`;
  const created = await chrome.tabs.create({ url: catalogUrl, active: false });
  state.hhOrigin = origin;
  return { tabId: created.id!, created: true };
}

export async function returnToCatalog(tabId: number): Promise<boolean> {
  try {
    const origin = getHhOrigin();
    const catalogUrl = `${origin}${PROTO.catalog.path}`;
    await chrome.tabs.update(tabId, { url: catalogUrl });
    await waitTabComplete(tabId);
    return true;
  } catch {
    return false;
  }
}

function waitForTestPage(
  tabId: number,
  skillId: number | string,
  { timeoutMs = TAB_WAIT_TIMEOUT_MS, stepMs = 50 } = {}
): Promise<string | null> {
  const deadline = Date.now() + timeoutMs;
  return new Promise(resolve => {
    const poll = async () => {
      try {
        const tab = await chrome.tabs.get(tabId);
        // Theory lands on /tests/<skillId>, practice — on /code/<skillId>:
        // the path segment must match EXACTLY (a substring `includes` would
        // match /tests/1 for skillId 11).
        const onTestPage = isSkillTestPage(tab?.url || '', skillId);
        if (onTestPage || Date.now() > deadline) {
          return resolve(onTestPage ? tab.url || null : null);
        }
      } catch {
        return resolve(null);
      }
      setTimeout(poll, stepMs);
    };
    poll();
  });
}

// Host and path prefix are checked by isAssessmentUrl; here — the exact skillId segment.
function isSkillTestPage(url: string, skillId: number | string): boolean {
  if (!isAssessmentUrl(url)) return false;
  try {
    return new URL(url).pathname.split('/')[2] === String(skillId);
  } catch {
    return false;
  }
}

// Contest id: a new UUID per attempt. At start it is in the test page URL
// (?contestToken=), in the result — the same token (?token= in contest_result).
// See docs/hh.md §4, §4.1.
export function contestTokenFromUrl(url = ''): string | null {
  const match = String(url).match(/[?&]contestToken=([^&]+)/);
  return match ? decodeURIComponent(match[1]) : null;
}

// Start a test: the single tab navigates to the redirect (spb.hh.ru → 302 →
// assessment) and waits to land on the test page. Nothing is created.
// Returns { ok, url?, token? } — token = contestToken from the test page URL.
export async function launchTestTab(
  tabId: number,
  redirectUrl: string,
  skillId: number | string
): Promise<{ ok: boolean; url?: string; token?: string | null }> {
  try {
    await chrome.tabs.update(tabId, { url: redirectUrl });
  } catch {
    return { ok: false, url: redirectUrl };
  }
  const settled = await waitForTestPage(tabId, skillId);
  if (!settled) {
    const info = await chrome.tabs.get(tabId).catch(() => null);
    return { ok: false, url: info?.url || redirectUrl };
  }
  return { ok: true, token: contestTokenFromUrl(settled) };
}

// ---- Telemetry gate on the solver tab -------------------------------------

const gateWarned = new Set<number>();

export async function ensureGate(tabId: number): Promise<boolean> {
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      world: 'MAIN',
      func: gateAction,
      args: [{ install: true }]
    });
    gateWarned.delete(tabId);
    return true;
  } catch (error: any) {
    console.info('[hh-assist] gate: install failed', error);
    if (!gateWarned.has(tabId)) {
      gateWarned.add(tabId);
      pushLog(
        'warn',
        `Шлюз телеметрии не установился: ${error?.message || error} — страница будет слать report_data с собственным taskId.`
      );
    }
    return false;
  }
}

// Inject an event (type 8/3/5) or heartbeat into the tab's gate. Best-effort:
// executeScript fails during navigation — skip silently.
async function gateActionOn(tabId: number, args: any) {
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      world: 'MAIN',
      func: gateAction,
      args: [args]
    });
  } catch {}
}

export function gateTaskId(tabId: number, taskId: number) {
  return gateActionOn(tabId, { taskId });
}

export function gateReport(tabId: number, taskId: number, events: any[]) {
  return gateActionOn(tabId, { taskId, pending: events });
}

export function gateHeartbeat(tabId: number, taskId: number) {
  return gateActionOn(tabId, { taskId, heartbeat: true });
}

// Reload/SPA-navigation of the test frontend on the solver tab — the relay
// is re-installed automatically (the function is idempotent by marker).
let solverTabId: number | null = null;

export function setSolverTab(tabId: number | null): void {
  solverTabId = tabId;
}

(globalThis as any).chrome?.tabs?.onUpdated?.addListener(
  (tabId: number, info: chrome.tabs.TabChangeInfo, tab: chrome.tabs.Tab) => {
    if (
      info.status === 'complete' &&
      tab?.url &&
      isAssessmentUrl(tab.url) &&
      solverTabId === tabId
    ) {
      ensureGate(tabId);
    }
  }
);

// ---- Fingerprint -----------------------------------------------------------

export async function ensureLastId(tabId: number): Promise<string> {
  if (state.session?.userId) {
    return sha256Hex(state.session.userId);
  }
  const [result] = await chrome.scripting.executeScript({
    target: { tabId },
    world: 'MAIN',
    func: probeSession
  });
  const userId = (result?.result as any)?.userId;
  if (!userId) {
    throw new Error('не найден userId для last_id');
  }
  return sha256Hex(userId);
}

// ---- Session ---------------------------------------------------------------

export async function checkSession(): Promise<any> {
  const { tabId, created } = await ensureMainTab();
  try {
    await waitTabComplete(tabId);
    const [result] = await chrome.scripting.executeScript({
      target: { tabId },
      world: 'MAIN',
      func: probeSession
    });
    const probe: any = result?.result;
    if (probe?.url) {
      state.hhOrigin = getHhOrigin(probe.url);
    }
    const session = {
      tabId,
      created,
      loggedIn: Boolean(probe?.loggedIn),
      userId: probe?.userId || null,
      url: probe?.url || '',
      checkedAt: Date.now()
    };
    state.session = session;
    if (!session.loggedIn) {
      pushLog('warn', 'Авторизация не подтверждена: войдите на hh.ru в открытой вкладке каталога');
    } else {
      pushLog('info', `Авторизация подтверждена (ID ${session.userId})`);
    }
    return session;
  } catch (error: any) {
    state.session = {
      tabId,
      created,
      loggedIn: false,
      userId: null,
      error: String(error?.message || error),
      checkedAt: Date.now()
    };
    pushLog('error', `Ошибка проверки авторизации: ${error.message}`);
    return state.session;
  }
}

// ---- SSR pages ------------------------------------------------------------

export async function fetchCatalog(): Promise<any> {
  try {
    const origin = getHhOrigin();
    const response = await fetch(`${origin}${PROTO.catalog.path}`, {
      credentials: 'include',
      headers: { 'X-Requested-With': 'XMLHttpRequest', Accept: 'text/html' }
    });
    const html = await response.text();
    const { items, dropped } = parseCatalog(html);
    return { ok: true, items, dropped, fetchedAt: Date.now() };
  } catch (error: any) {
    return { ok: false, error: String(error?.message || error) };
  }
}

let tabReloadNeeded = false;

export function markReloadNeeded(): void {
  tabReloadNeeded = true;
}

export function resetReloadFlag(): void {
  tabReloadNeeded = false;
}

async function readFromTab(
  tabId: number
): Promise<{ status: number; html: string; url?: string; error?: string }> {
  try {
    const [result] = await chrome.scripting.executeScript({
      target: { tabId },
      world: 'MAIN',
      func: readSsrContent
    });
    const raw: any = result?.result;
    if (!raw?.content)
      return {
        status: 0,
        html: '',
        error: raw?.error || 'SSR-шаблон не найден',
        url: raw?.url || ''
      };
    return {
      status: 200,
      html: `<template class="${raw.templateClass}">${raw.content}</template>`,
      url: raw.url || ''
    };
  } catch (error: any) {
    return { status: 0, html: '', error: String(error?.message || error) };
  }
}

export async function fetchPageFromTab(
  tabId: number
): Promise<{ status: number; html: string; url?: string; error?: string }> {
  if (tabReloadNeeded) {
    tabReloadNeeded = false;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        await chrome.tabs.reload(tabId);
        const tab = await waitTabComplete(tabId, { timeoutMs: 10000 });
        if (tab?.status === 'complete') break;
      } catch {}
      await sleep(1000);
    }
  }
  return readFromTab(tabId);
}

export async function fetchCodePage(
  skillId: number | string
): Promise<{ status: number; html: string }> {
  const url = `https://assessment.hh.ru${PROTO.code.pagePath.replace('<skillId>', String(skillId))}`;
  const response = await fetch(url, {
    credentials: 'include',
    redirect: 'follow',
    headers: { 'X-Requested-With': 'XMLHttpRequest', Accept: 'text/html' }
  });
  const html = await response.text();
  return { status: response.status, html };
}

// ---- Test result -----------------------------------------------------------

export async function readCompletion(tabId: number): Promise<any> {
  try {
    const [result] = await chrome.scripting.executeScript({
      target: { tabId },
      world: 'MAIN',
      func: readCompletionContent
    });
    const raw: any = result?.result || {};
    if (!raw.content) return { error: raw.error || 'страница не отдала SSR-шаблон', ...raw };
    const html = `<template class="${PROTO.catalog.ssrTemplateClass}">${raw.content}</template>`;
    const parsed = parseResultPage(html);
    if (parsed) return { result: parsed };
    let stateJson: any = null;
    let topKeys: string[] = [];
    try {
      stateJson = JSON.parse(
        raw.content.replaceAll('&quot;', '"').replaceAll('&#34;', '"').replaceAll('\\\\', '\\')
      );
      topKeys = Object.keys(stateJson || {});
    } catch {}
    return {
      error: 'структура результата не распознана',
      topKeys,
      snippet: raw.content.slice(0, 500)
    };
  } catch (error: any) {
    return { error: `выполнение во вкладке упало: ${String(error?.message || error)}` };
  }
}
