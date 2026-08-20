export const EFFORT_VALUES = [
  'none',
  'minimal',
  'low',
  'medium',
  'high',
  'xhigh',
  'max',
  'default'
] as const;
export type EffortValue = (typeof EFFORT_VALUES)[number];

export interface PresetProvider {
  id: string;
  name: string;
  baseUrl: string;
  hint: string;
}

export const PRESET_PROVIDERS: PresetProvider[] = [
  {
    id: 'custom',
    name: 'Свой сервер / Прокси',
    baseUrl: '',
    hint: 'http://localhost:11434/v1 или свой адрес'
  },
  {
    id: 'openai',
    name: 'OpenAI',
    baseUrl: 'https://api.openai.com/v1',
    hint: 'https://api.openai.com/v1'
  },
  {
    id: 'openrouter',
    name: 'OpenRouter',
    baseUrl: 'https://openrouter.ai/api/v1',
    hint: 'https://openrouter.ai/api/v1'
  },
  {
    id: 'opencode',
    name: 'OpenCode Zen',
    baseUrl: 'https://opencode.ai/zen/go/v1',
    hint: 'https://opencode.ai/zen/go/v1'
  },
  {
    id: 'deepseek',
    name: 'DeepSeek',
    baseUrl: 'https://api.deepseek.com/v1',
    hint: 'https://api.deepseek.com/v1'
  },
  {
    id: 'groq',
    name: 'Groq',
    baseUrl: 'https://api.groq.com/openai/v1',
    hint: 'https://api.groq.com/openai/v1'
  },
  {
    id: 'mistral',
    name: 'Mistral AI',
    baseUrl: 'https://api.mistral.ai/v1',
    hint: 'https://api.mistral.ai/v1'
  },
  {
    id: 'ollama',
    name: 'Ollama (локально)',
    baseUrl: 'http://127.0.0.1:11434/v1',
    hint: 'http://127.0.0.1:11434/v1'
  },
  {
    id: 'vllm',
    name: 'vLLM (локально)',
    baseUrl: 'http://127.0.0.1:8000/v1',
    hint: 'http://127.0.0.1:8000/v1'
  }
];

const MODELS_DEV_TTL = 6 * 60 * 60 * 1000;
const MODELS_DEV_TIMEOUT_MS = 5000;
const MODELS_DEV_FAIL_TTL = 10 * 60 * 1000;
export const MODELS_TTL = 30 * 60 * 1000;
const MODELS_CACHE_PREFIX = 'models:';
const MODELS_FETCH_TIMEOUT_MS = 20000;

let modelsDevCache: any = null;
let modelsDevAt = 0;
let modelsDevFailAt = 0;

const modelsCacheKey = (baseUrl: string) =>
  `${MODELS_CACHE_PREFIX}${String(baseUrl || '').replace(/\/+$/, '')}`;

export interface CachedModelsEntry {
  models: string[];
  meta: Record<string, any>;
  at: number;
}

export async function cachedModels(
  baseUrl: string,
  storage = (globalThis as any).chrome?.storage?.local
): Promise<CachedModelsEntry | null> {
  if (!storage?.get) return null;
  const key = modelsCacheKey(baseUrl);
  const stash = await storage.get(key).catch(() => ({}));
  const entry = stash[key];
  if (!entry || !Array.isArray(entry.models)) return null;
  if (Date.now() - (entry.at || 0) > MODELS_TTL) return null;
  return entry;
}

export async function saveCachedModels(
  baseUrl: string,
  models: string[],
  meta: Record<string, any>,
  storage = (globalThis as any).chrome?.storage?.local
): Promise<void> {
  if (!storage?.set) return;
  const key = modelsCacheKey(baseUrl);
  await storage.set({ [key]: { models, meta, at: Date.now() } }).catch(() => {});
}

export async function listModels(baseUrl: string, apiKey: string): Promise<string[]> {
  const url = `${String(baseUrl).replace(/\/+$/, '')}/models`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), MODELS_FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: ctrl.signal
    });

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      throw new Error(`HTTP ${response.status} ${body.slice(0, 300)}`);
    }

    const json = await response.json();
    const models = (Array.isArray(json?.data) ? json.data : [])
      .map((item: any) => item?.id)
      .filter(Boolean)
      .sort((a: string, b: string) => a.localeCompare(b));

    if (!models.length) throw new Error('API не вернуло моделей');
    return [...new Set(models)] as string[];
  } finally {
    clearTimeout(timer);
  }
}

export async function loadModelsDev(
  sessionStorage = (globalThis as any).chrome?.storage?.session
): Promise<any> {
  const now = Date.now();
  if (modelsDevCache && now - modelsDevAt < MODELS_DEV_TTL) return modelsDevCache;

  const stash = sessionStorage?.get ? await sessionStorage.get('mdv').catch(() => ({})) : {};
  if (stash?.mdv?.data && now - stash.mdv.at < MODELS_DEV_TTL) {
    modelsDevCache = stash.mdv.data;
    modelsDevAt = stash.mdv.at;
    return modelsDevCache;
  }

  if (modelsDevFailAt && now - modelsDevFailAt < MODELS_DEV_FAIL_TTL) {
    throw new Error('models.dev: recent failure, skipping');
  }

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), MODELS_DEV_TIMEOUT_MS);
  try {
    const response = await fetch(
      'https://raw.githubusercontent.com/JochenYang/models.dev/main/api.json',
      { signal: ctrl.signal }
    );
    if (!response.ok) {
      const body = await response.text().catch(() => '');
      throw new Error(`models.dev HTTP ${response.status} ${body.slice(0, 200)}`);
    }
    const data = await response.json();
    try {
      if (sessionStorage?.set) await sessionStorage.set({ mdv: { data, at: now } });
    } catch {}
    modelsDevCache = data;
    modelsDevAt = now;
    modelsDevFailAt = 0;
    return data;
  } catch (err) {
    modelsDevFailAt = now;
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

function reasoningInfo(model: any) {
  const info: { reasoning: boolean; efforts: string[]; toggle: boolean; budget: any } = {
    reasoning: model?.reasoning === true,
    efforts: [],
    toggle: false,
    budget: null
  };
  const options = model?.reasoning_options ?? model?.reasoningOptions ?? [];
  for (const option of Array.isArray(options) ? options : []) {
    if (option?.type === 'effort' && Array.isArray(option.values)) {
      info.efforts = option.values.filter(
        (v: string) => typeof v === 'string' && (EFFORT_VALUES as readonly string[]).includes(v)
      );
    } else if (option?.type === 'toggle') {
      info.toggle = true;
    } else if (option?.type === 'budget_tokens') {
      info.budget = {
        min: option.min,
        max: option.max
      };
    }
  }
  return info;
}

function forEachDevModel(data: any, callback: (model: any) => void) {
  const providers = Array.isArray(data) ? data : Object.values(data);
  for (const provider of providers as any[]) {
    const models = provider?.models;
    if (!models) continue;

    const entries = Array.isArray(models)
      ? models
      : Object.entries(models).map(([id, model]) =>
          model && typeof model === 'object' ? { ...(model as any), id } : null
        );

    for (const entry of entries) {
      if (entry && typeof entry === 'object') callback(entry);
    }
  }
}

function bareId(id: string) {
  return String(id || '')
    .toLowerCase()
    .split('/')
    .pop();
}

function modelRank(model: any) {
  const efforts = reasoningInfo(model).efforts;
  const maxBonus = efforts.includes('max') ? 1 : 0;
  return efforts.length + maxBonus;
}

export function providerMeta(data: any, models: string[]): Record<string, any> {
  const meta: Record<string, any> = {};
  const globalIndex: Record<string, any> = {};

  forEachDevModel(data, model => {
    const key = bareId(model.id);
    if (!key) return;
    const current = globalIndex[key];
    if (!current || modelRank(model) > modelRank(current)) globalIndex[key] = model;
  });

  for (const id of models) {
    const wanted = bareId(id);
    const model = wanted ? globalIndex[wanted] || null : null;
    if (model) {
      const info: any = reasoningInfo(model);
      info.source = 'global';
      meta[id] = info;
    }
  }

  return meta;
}
