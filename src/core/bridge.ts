// Assessment tab bridge (docs/plan.md §2.1, §3.2).
//
// All /shards/* requests must come from the assessment.hh.ru origin (natural
// Origin/Referer, contest_token and _xsrf cookies). The service worker cannot
// fetch on its own — it would send Origin: chrome-extension://. Instead, the
// ApiClient gets a fetchImpl that runs fetch via
// chrome.scripting.executeScript on the test tab.
//
// Bridge functions are serializable (no module closures) — executeScript
// passes them over, so they cannot use imports; everything needed comes in as
// arguments.

export interface BridgeFetchResult {
  status: number;
  ok: boolean;
  text: string;
}

export interface BridgeFetchResponse {
  status: number;
  ok: boolean;
  text: () => string;
}

// Runs in the tab: fetch from its context. Reads the XSRF token from
// document.cookie (like the live client), returns a serializable response
// {status, ok, text} — an isolated-world Response is not serializable.
export function bridgeFetch(url: string, init?: RequestInit): Promise<BridgeFetchResult> {
  const headers: Record<string, string> = { ...((init?.headers as Record<string, string>) || {}) };
  if (!headers['X-XSRFToken']) {
    const pair = document.cookie
      .split('; ')
      .map(part => part.split('='))
      .find(([key]) => key === '_xsrf');
    if (pair) headers['X-XSRFToken'] = decodeURIComponent(pair[1]);
  }
  return fetch(url, { ...init, headers }).then(async response => {
    const text = await response.text();
    return { status: response.status, ok: response.ok, text };
  });
}

export interface CreateBridgeFetchOptions {
  tabId: number;
  executeScript?: (options: any) => Promise<Array<{ result: BridgeFetchResult }>>;
}

// fetchImpl for ApiClient: runs the request through the bridge on tab tabId.
export function createBridgeFetch({
  tabId,
  executeScript = (globalThis as any).chrome?.scripting?.executeScript
}: CreateBridgeFetchOptions): (url: string, init?: RequestInit) => Promise<BridgeFetchResponse> {
  return async function bridgeFetchImpl(
    url: string,
    init?: RequestInit
  ): Promise<BridgeFetchResponse> {
    const [wrapper] = await executeScript({
      target: { tabId },
      func: bridgeFetch,
      args: [url, init]
    });
    const result = wrapper?.result;
    if (!result) {
      const error: any = new Error('Мост вкладки не вернул результат');
      error.status = 0;
      throw error;
    }
    return {
      status: result.status,
      ok: result.ok,
      text: () => result.text
    };
  };
}

// Settings storage: a single key in chrome.storage.local.
export const SETTINGS_KEY = 'hhSettings';

export async function loadSettings(
  storage = (globalThis as any).chrome?.storage?.local
): Promise<Record<string, any>> {
  if (!storage?.get) return {};
  const { [SETTINGS_KEY]: saved } = await storage.get(SETTINGS_KEY);
  return saved || {};
}

export async function saveSettings(
  settings: Record<string, any>,
  storage = (globalThis as any).chrome?.storage?.local
): Promise<Record<string, any>> {
  if (storage?.set) {
    await storage.set({ [SETTINGS_KEY]: settings });
  }
  return settings;
}
