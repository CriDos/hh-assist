import { create } from 'zustand';
import { ConfigSettings, FingerprintProfile, TimingsConfig } from '../../types/settings.ts';
import { send } from '../services/extension';
import {
  listModels,
  loadModelsDev,
  providerMeta,
  EFFORT_VALUES,
  cachedModels,
  saveCachedModels,
  PRESET_PROVIDERS
} from '../../core/models.ts';
import { DEFAULT_TIMING } from '../../core/timing.ts';

const DEFAULT_EFFORTS = (EFFORT_VALUES as readonly string[]).filter(
  effort => effort !== 'none' && effort !== 'default'
);

interface SettingsState {
  baseUrl: string;
  apiKey: string;
  model: string;
  reasoning: string;
  modelsMeta: Record<string, any>;
  models: string[];
  reasoningOptions: string[];
  loadingModels: boolean;
  selectedPresetId: string;

  timingSavedFlash: boolean;
  profileHint: string;

  apiTestStatus: {
    status: 'idle' | 'testing' | 'ok' | 'err';
    message: string;
  };

  timings: TimingsConfig;
  profiles: FingerprintProfile[];
  selectedProfileId: string;

  setBaseUrl: (url: string) => void;
  setApiKey: (key: string) => void;
  setModel: (model: string) => void;
  setReasoning: (reasoning: string) => void;
  selectPreset: (presetId: string) => void;
  setTimingField: (path: string, seconds: number) => void;

  loadConfig: () => Promise<void>;
  saveApi: () => Promise<void>;
  testApi: () => Promise<void>;
  refreshModels: (force?: boolean) => Promise<void>;
  saveTimings: () => Promise<void>;
  resetTimings: () => Promise<void>;

  loadProfiles: (settings?: ConfigSettings) => Promise<void>;
  selectProfile: (id: string) => Promise<void>;
  createProfile: () => Promise<void>;
  recreateProfile: () => Promise<void>;
  deleteProfile: (id: string) => Promise<void>;
}

let refreshDebounceTimer: any = null;
function debouncedRefreshModels(get: any, ms = 400) {
  if (refreshDebounceTimer) clearTimeout(refreshDebounceTimer);
  refreshDebounceTimer = setTimeout(() => {
    get().refreshModels(true);
  }, ms);
}

export const useSettingsStore = create<SettingsState>((set, get) => ({
  baseUrl: '',
  apiKey: '',
  model: '',
  reasoning: '',
  modelsMeta: {},
  models: [],
  reasoningOptions: DEFAULT_EFFORTS,
  loadingModels: false,
  selectedPresetId: 'custom',

  timingSavedFlash: false,
  profileHint: '',

  apiTestStatus: { status: 'idle', message: '' },

  timings: JSON.parse(JSON.stringify(DEFAULT_TIMING)),
  profiles: [],
  selectedProfileId: '',

  setBaseUrl: (baseUrl: string) => {
    let presetId = 'custom';
    for (const p of PRESET_PROVIDERS) {
      if (p.baseUrl && baseUrl.startsWith(p.baseUrl)) {
        presetId = p.id;
        break;
      }
    }
    set({ baseUrl, selectedPresetId: presetId });
    debouncedRefreshModels(get);
  },

  setApiKey: (apiKey: string) => {
    set({ apiKey });
    debouncedRefreshModels(get);
  },

  setModel: (model: string) => {
    const meta = get().modelsMeta;
    const efforts = meta[model]?.efforts?.length ? meta[model].efforts : DEFAULT_EFFORTS;
    set({ model, reasoningOptions: efforts });
  },

  setReasoning: (reasoning: string) => {
    set({ reasoning });
  },

  selectPreset: (presetId: string) => {
    const found = PRESET_PROVIDERS.find(p => p.id === presetId);
    if (found && found.baseUrl) {
      set({ selectedPresetId: presetId, baseUrl: found.baseUrl });
      get().refreshModels(true);
    } else {
      set({ selectedPresetId: presetId });
    }
  },

  setTimingField: (path: string, seconds: number) => {
    const ms = Math.max(0, Math.round(seconds * 1000));
    set(s => {
      const timings = JSON.parse(JSON.stringify(s.timings));
      const parts = path.split('.');
      if (parts.length === 2) {
        (timings as any)[parts[0]][parts[1]] = ms;
      } else {
        (timings as any)[path] = ms;
      }
      return { timings };
    });
  },

  loadConfig: async () => {
    await send({ type: 'hh:profiles:ensure' });
    const settings = await send<ConfigSettings>({ type: 'hh:config:get' });
    if (!settings) return;

    const baseUrl = settings.baseUrl || '';
    let presetId = 'custom';
    for (const p of PRESET_PROVIDERS) {
      if (p.baseUrl && baseUrl.startsWith(p.baseUrl)) {
        presetId = p.id;
        break;
      }
    }

    const timings: TimingsConfig = {
      theory: {
        answerMinMs: settings.timings?.theory?.answerMinMs ?? DEFAULT_TIMING.theory.answerMinMs,
        answerMaxMs: settings.timings?.theory?.answerMaxMs ?? DEFAULT_TIMING.theory.answerMaxMs,
        betweenMinMs: settings.timings?.theory?.betweenMinMs ?? DEFAULT_TIMING.theory.betweenMinMs,
        betweenMaxMs: settings.timings?.theory?.betweenMaxMs ?? DEFAULT_TIMING.theory.betweenMaxMs
      },
      practice: {
        typingMinMs: settings.timings?.practice?.typingMinMs ?? DEFAULT_TIMING.practice.typingMinMs,
        typingMaxMs: settings.timings?.practice?.typingMaxMs ?? DEFAULT_TIMING.practice.typingMaxMs,
        retryTypingMinMs:
          settings.timings?.practice?.retryTypingMinMs ?? DEFAULT_TIMING.practice.retryTypingMinMs,
        retryTypingMaxMs:
          settings.timings?.practice?.retryTypingMaxMs ?? DEFAULT_TIMING.practice.retryTypingMaxMs
      },
      betweenTestsMinMs: settings.timings?.betweenTestsMinMs ?? DEFAULT_TIMING.betweenTestsMinMs,
      betweenTestsMaxMs: settings.timings?.betweenTestsMaxMs ?? DEFAULT_TIMING.betweenTestsMaxMs
    };

    set({
      baseUrl,
      apiKey: settings.apiKey || '',
      model: settings.model || '',
      reasoning: settings.reasoning || '',
      selectedPresetId: presetId,
      timings
    });

    await get().loadProfiles(settings);
    await get().refreshModels(false);
  },

  saveApi: async () => {
    const { baseUrl, apiKey, model, reasoning } = get();
    const patch = {
      baseUrl: baseUrl.trim(),
      apiKey: apiKey.trim(),
      model,
      reasoning
    };
    await send({ type: 'hh:config:set', patch });
    set({
      apiTestStatus: { status: 'ok', message: 'Сохранено' }
    });
    setTimeout(() => {
      if (get().apiTestStatus.message === 'Сохранено') {
        set({ apiTestStatus: { status: 'idle', message: '' } });
      }
    }, 2000);
  },

  testApi: async () => {
    const { baseUrl, apiKey, model, reasoning } = get();
    set({ apiTestStatus: { status: 'testing', message: 'Проверка соединения…' } });

    try {
      const result = await send<{ ok?: boolean; model?: string; ms?: number; error?: string }>({
        type: 'hh:api:test',
        baseUrl: baseUrl.trim(),
        apiKey: apiKey.trim(),
        model: model.trim(),
        reasoning: reasoning.trim()
      });

      if (result?.ok) {
        set({
          apiTestStatus: {
            status: 'ok',
            message: `OK · ${result.model} · ${result.ms} мс`
          }
        });
      } else {
        set({
          apiTestStatus: {
            status: 'err',
            message: `Ошибка: ${result?.error || 'нет ответа'}`
          }
        });
      }
    } catch (e: any) {
      set({
        apiTestStatus: {
          status: 'err',
          message: `Ошибка: ${e?.message || 'сбой сети'}`
        }
      });
    }
  },

  refreshModels: async (force = false) => {
    const { baseUrl, apiKey, model } = get();
    const cleanUrl = baseUrl.trim();
    const cleanKey = apiKey.trim();

    if (!cleanUrl || !cleanKey) {
      set({ models: model ? [model] : [] });
      return;
    }

    try {
      const cache = await cachedModels(cleanUrl);
      if (cache?.models?.length) {
        set({ models: cache.models });
      }

      if (!force && cache) return;

      set({ loadingModels: true });
      const freshModels = await listModels(cleanUrl, cleanKey);
      let meta = cache?.meta || {};
      try {
        const dev = await loadModelsDev();
        meta = { ...meta, ...providerMeta(dev, freshModels) };
      } catch {}

      await saveCachedModels(cleanUrl, freshModels, meta);
      const chosenModel = freshModels.includes(model) ? model : freshModels[0] || model;
      const efforts = meta[chosenModel]?.efforts?.length
        ? meta[chosenModel].efforts
        : DEFAULT_EFFORTS;

      set({
        models: freshModels,
        modelsMeta: meta,
        loadingModels: false,
        model: chosenModel,
        reasoningOptions: efforts
      });
    } catch {
      set({ loadingModels: false });
    }
  },

  saveTimings: async () => {
    const { timings } = get();
    await send({ type: 'hh:config:set', patch: { timings } });
    set({ timingSavedFlash: true });
    setTimeout(() => set({ timingSavedFlash: false }), 2000);
  },

  resetTimings: async () => {
    const def = JSON.parse(JSON.stringify(DEFAULT_TIMING));
    set({ timings: def });
    await get().saveTimings();
  },

  loadProfiles: async settings => {
    const profiles = await send<FingerprintProfile[]>({ type: 'hh:profiles:list' });
    if (!Array.isArray(profiles)) return;

    const currentProfileId = get().selectedProfileId;
    const selected =
      settings?.profileId && profiles.some(p => p.id === settings.profileId)
        ? settings.profileId
        : currentProfileId && profiles.some(p => p.id === currentProfileId)
          ? currentProfileId
          : profiles[0]?.id || '';

    set({ profiles, selectedProfileId: selected });
  },

  selectProfile: async (id: string) => {
    set({ selectedProfileId: id });
    await send({ type: 'hh:profiles:select', id });
  },

  createProfile: async () => {
    const profile = await send<FingerprintProfile>({ type: 'hh:profiles:new' });
    if (profile?.id) {
      await get().loadProfiles();
      set({ profileHint: 'Создан' });
      setTimeout(() => set({ profileHint: '' }), 2000);
    }
  },

  recreateProfile: async () => {
    const profile = await send<FingerprintProfile>({ type: 'hh:profiles:recreate' });
    if (profile?.id) {
      await get().loadProfiles();
      set({ profileHint: 'Обновлён' });
      setTimeout(() => set({ profileHint: '' }), 2000);
    }
  },

  deleteProfile: async (id: string) => {
    if (!id) return;
    const result = await send<{ deleted?: boolean }>({ type: 'hh:profiles:delete', id });
    if (result?.deleted) {
      await get().loadProfiles();
      set({ profileHint: 'Удалён' });
      setTimeout(() => set({ profileHint: '' }), 2000);
    }
  }
}));
