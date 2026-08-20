// Session probe on a live hh page (docs/hh.md §3.1). Fully self-contained:
// chrome.scripting.executeScript serializes only the function body, so helpers
// are declared INSIDE it to avoid ReferenceError in the MAIN world.

export interface SessionProbeResult {
  loggedIn: boolean;
  userId: string | null;
  url: string;
}

// Session probe: are we logged in, and which userId. userId is a root key of
// the SSR state ("userId": 171099089 — a number on the catalog, a string on a
// section page; NOT globalVars.hhid — that's a different id!). Fallback:
// globalVars.userType/login (hydration may have consumed the template).
export function probeSession(): SessionProbeResult {
  const readSsrState = () => {
    const templates = document.querySelectorAll('template');
    for (const template of templates) {
      const text = template.content?.textContent || '';
      if (!text || text.length < 2) continue;
      try {
        const json = JSON.parse(text.replace(/\\\\/g, '\\'));
        if (json && typeof json === 'object') return { json, text };
      } catch {}
    }
    return null;
  };
  const ssr = readSsrState();
  const textUserId = ssr?.text ? (ssr.text.match(/"userId"\s*:\s*"?(\d+)"?/) || [])[1] : null;
  const rawUserId = ssr?.json?.userId ?? textUserId ?? (window as any).globalVars?.userId ?? null;
  const userId =
    rawUserId != null && rawUserId !== '' && rawUserId !== '0' && rawUserId !== 0
      ? String(rawUserId)
      : null;
  const gv = (window as any).globalVars || {};
  const hasLogin = Boolean(gv.login) || Boolean(gv.isAuthorized) || Boolean(gv.authorized);
  const loggedIn = Boolean(userId) || hasLogin;
  return {
    loggedIn,
    userId,
    url: window.location?.href || ''
  };
}
