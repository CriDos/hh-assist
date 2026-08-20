// Orchestrator (docs/plan.md §3.7). MV3 service worker — composition root:
// binds pure modules (core/*, solvers/*) with chrome-API modules
// background/* and registers panel RPC commands.

import { generateProfile } from './core/fingerprint.ts';
import { loadSettings, saveSettings, SETTINGS_KEY } from './core/bridge.ts';
import { getSettings, settingsDefaults, activeProfile } from './core/settings.ts';
import { state } from './background/state.ts';
import { isWorkActive } from './background/keepalive.ts';
import {
  pushLog,
  llmLogWithSystem,
  resetLlmLog,
  installPanelPorts,
  pushLogHeader
} from './background/log.ts';
import { checkSession, fetchCatalog } from './background/tabs.ts';
import { createQueue } from './background/queue.ts';
import { installRpc } from './background/rpc.ts';
import {
  setArmed as netlogSetArmed,
  initNetLog,
  status as netlogStatus,
  getSession as netlogGetSession,
  clearArchive as netlogClearArchive
} from './background/netlog.ts';
import {
  buildSolver,
  ensureSolverTab,
  probeLLM,
  reportResult,
  collectOutcome,
  startTestRunner,
  resumeRun,
  restoreCheckpoint,
  formatDuration,
  onSolverEvent,
  finishRunCleanup
} from './background/coordinator.ts';
import { FingerprintProfile } from './types/settings';

export async function startTest(args: any) {
  return startTestRunner({ ...args, ensureDefaultProfile });
}

export function getRunningSolver() {
  return state.run?.solver;
}

export const queue = createQueue({
  startTest,
  getRunningSolver
});

export function startMany(jobs: any[]) {
  return queue.startMany(jobs);
}

export function abortQueue() {
  return queue.abort();
}

// Checkpoint recovery at worker startup (skipped during vitest test runs)
if (typeof process === 'undefined' || !process.env.VITEST) {
  setTimeout(() => {
    void restoreCheckpoint(queue);
  }, 500);
  setTimeout(() => {
    pushLogHeader();
  }, 50);
}

// ---- Fingerprint profiles ----------------------------------------------------

export async function listProfiles() {
  const settings = await getSettings();
  return settings.profiles;
}

async function saveProfile(profile: FingerprintProfile, { select = false } = {}) {
  const saved = await loadSettings();
  const settings = settingsDefaults(saved);
  settings.profiles.push(profile);
  if (select) settings.profileId = profile.id;
  await saveSettings({ ...saved, ...settings });
}

let ensureInFlight: Promise<FingerprintProfile> | null = null;

export function ensureDefaultProfile(): Promise<FingerprintProfile> {
  if (!ensureInFlight) {
    ensureInFlight = doEnsureDefaultProfile().finally(() => {
      ensureInFlight = null;
    });
  }
  return ensureInFlight;
}

async function doEnsureDefaultProfile(): Promise<FingerprintProfile> {
  const settings = await getSettings();
  const selected = activeProfile(settings);
  if (selected) return selected;
  const auto = settings.profiles.find((profile: FingerprintProfile) => profile.auto);
  if (auto) {
    if (settings.profileId !== auto.id) await selectProfile(auto.id);
    return auto;
  }
  const profile = await generateProfile();
  profile.label = `gen_0_${new Date().toISOString().slice(0, 10)}`;
  profile.auto = true;
  await saveProfile(profile, { select: true });
  return profile;
}

export async function recreateProfile(): Promise<FingerprintProfile> {
  const fresh = await generateProfile();
  fresh.label = `gen_0_${new Date().toISOString().slice(0, 10)}`;
  fresh.auto = true;
  const saved = await loadSettings();
  const settings = settingsDefaults(saved);
  const index = settings.profiles.findIndex((profile: FingerprintProfile) => profile.auto);
  if (index === -1) settings.profiles.push(fresh);
  else settings.profiles[index] = fresh;
  settings.profileId = fresh.id;
  await saveSettings({ ...saved, ...settings });
  return fresh;
}

export async function createProfile(): Promise<FingerprintProfile> {
  const settings = await getSettings();
  const profile = await generateProfile();
  profile.label = `gen_${settings.profiles.length}_${new Date().toISOString().slice(0, 10)}`;
  settings.profiles.push(profile);
  settings.profileId = profile.id;
  await saveSettings({ ...(await loadSettings()), ...settings });
  return profile;
}

export async function selectProfile(id: string | null): Promise<string | null> {
  const settings = await getSettings();
  if (id && !settings.profiles.some((profile: FingerprintProfile) => profile.id === id))
    return null;
  settings.profileId = id;
  await saveSettings({ ...(await loadSettings()), ...settings });
  return settings.profileId;
}

export async function deleteProfile(id: string): Promise<FingerprintProfile | null> {
  const settings = await getSettings();
  const index = settings.profiles.findIndex((profile: FingerprintProfile) => profile.id === id);
  if (index === -1) return null;
  const [removed] = settings.profiles.splice(index, 1);
  if (settings.profileId === id) settings.profileId = null;
  await saveSettings({ ...(await loadSettings()), ...settings });
  return removed;
}

// ---- Panel: RPC ---------------------------------------------------------------

function jobRank(status: string) {
  if (status === 'running') return 0;
  if (status === 'queued') return 1;
  return 2;
}

const commands: Record<string, (message: any) => Promise<any> | any> = {
  'hh:status': async () => {
    const settings = await getSettings();
    return {
      status: state.queuePaused
        ? 'paused'
        : state.run
          ? 'running'
          : state.queueRunning
            ? 'queued'
            : 'idle',
      paused: Boolean(state.queuePaused),
      run: state.run
        ? {
            item: state.run.item?.name,
            level: state.run.level?.name,
            kind: state.run.kind,
            tabId: state.run.tabId,
            contestId: state.run.contestId,
            progress: state.run.progress,
            timeLeft: state.run.timeLeft,
            timeLeftAt: state.run.timeLeftAt
          }
        : null,
      jobs: state.jobs
        .slice()
        .sort((a, b) => jobRank(a.status) - jobRank(b.status))
        .map(job => ({
          id: job.id,
          name: job.item?.name,
          level: job.level?.name,
          kind: job.kind,
          status: job.status,
          progress: job.progress,
          passed: job.passed,
          correct: job.correct,
          totalScore: job.totalScore,
          message: job.message
        })),
      configured: Boolean(settings.baseUrl && settings.apiKey && settings.model),
      session: state.session
    };
  },
  'hh:check': async () => {
    const session = await checkSession();
    if (session.loggedIn) await ensureDefaultProfile();
    return session;
  },
  'hh:catalog': () => fetchCatalog(),
  'hh:startMany': (message: any) => {
    Promise.resolve(startMany(message.jobs)).catch(error => {
      pushLog('error', `Ошибка очереди: ${error.message}`);
    });
    return { ok: true };
  },
  'hh:abort': () => {
    abortQueue();
    return { ok: true };
  },
  'hh:queue:pause': () => queue.pause(),
  'hh:queue:resume': () => queue.resume(),
  'hh:queue:retry': () => queue.retryFailed(),
  'hh:queue:clearDone': () => queue.clearDone(),
  'hh:jobs:remove': (message: any) => queue.removeJob(message.id),
  'hh:api:test': async (message: any) => {
    const config = {
      baseUrl: String(message?.baseUrl || '').trim(),
      apiKey: String(message?.apiKey || '').trim(),
      model: String(message?.model || '').trim(),
      reasoning: String(message?.reasoning || '').trim()
    };
    if (!config.baseUrl || !config.apiKey || !config.model) {
      return { ok: false, error: 'Укажите baseUrl, ключ и модель' };
    }
    const started = Date.now();
    try {
      await probeLLM(config);
      return { ok: true, model: config.model, ms: Date.now() - started };
    } catch (error: any) {
      return { ok: false, error: String(error?.message || error), ms: Date.now() - started };
    }
  },
  'hh:config:get': () => getSettings(),
  'hh:config:set': async (message: any) => {
    const saved = await loadSettings();
    await saveSettings({ ...saved, ...message.patch });
    return { ok: true };
  },
  'hh:log:get': () => ({ entries: state.logBuffer.slice() }),
  'hh:log:clear': () => {
    state.logBuffer = [];
    return { ok: true };
  },
  'hh:llm:get': async () => {
    const settings = await getSettings();
    return { entries: llmLogWithSystem(settings) };
  },
  'hh:llmLog:get': async () => {
    const settings = await getSettings();
    return {
      entries: llmLogWithSystem(settings),
      active: state.llmLog[state.llmLog.length - 1] || null
    };
  },
  'hh:llmLog:clear': () => {
    resetLlmLog();
    return { ok: true };
  },
  'hh:profiles:list': () => listProfiles(),
  'hh:profiles:ensure': () => ensureDefaultProfile(),
  'hh:profiles:recreate': () => recreateProfile(),
  'hh:profiles:new': () => createProfile(),
  'hh:profiles:select': (message: any) => selectProfile(message.id).then(id => ({ ok: true, id })),
  'hh:profiles:delete': (message: any) =>
    deleteProfile(message.id).then(deleted => ({ ok: true, deleted })),
  'hh:netlog:set': (message: any) => netlogSetArmed(Boolean(message.on)),
  'hh:netlog:get': () => netlogStatus(),
  'hh:netlog:session:get': (message: any) => netlogGetSession(message.id),
  'hh:netlog:archive:clear': () => netlogClearArchive(),
  'hh:extension:reload': () => {
    setTimeout(() => {
      try {
        chrome.runtime?.reload?.();
      } catch {}
    }, 50);
    return { ok: true };
  }
};

installRpc(commands);
installPanelPorts();
void initNetLog();

chrome.runtime?.onInstalled?.addListener(() => {
  try {
    chrome.contextMenus?.removeAll(() => {
      chrome.contextMenus?.create({
        id: 'hh_reload_extension',
        title: '🔄 Перезапустить расширение',
        contexts: ['action']
      });
    });
  } catch {}
});

chrome.action?.onClicked?.addListener(async tab => {
  try {
    if (tab?.windowId) {
      await chrome.sidePanel?.open({ windowId: tab.windowId });
    }
  } catch (err) {
    try {
      console.error('[hh-assist] Failed to open sidePanel:', err);
    } catch {}
  }
});

chrome.contextMenus?.onClicked?.addListener(info => {
  if (info.menuItemId === 'hh_reload_extension') {
    chrome.runtime?.reload?.();
  }
});

export {
  checkSession,
  isWorkActive,
  SETTINGS_KEY,
  onSolverEvent,
  reportResult,
  collectOutcome,
  buildSolver,
  ensureSolverTab,
  probeLLM,
  resumeRun,
  restoreCheckpoint,
  formatDuration,
  finishRunCleanup
};
