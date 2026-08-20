import { create } from 'zustand';
import { CatalogItem, MethodData, TestFilter } from '../types/tests';
import { send } from '../services/extension';
import { useQueueStore } from './useQueueStore';
import { useSessionStore } from './useSessionStore';

export function getMethodState(
  method?: MethodData
): 'passed' | 'available' | 'blocked' | 'unavailable' {
  if (!method) return 'unavailable';
  if (method.validity?.state === 'EFFECTIVE') return 'passed';
  const status = method.availability?.status;
  if (status === 'AVAILABLE') return 'available';
  if (status === 'TEMPORARY_UNAVAILABLE') return 'blocked';
  return 'unavailable';
}

export function getMethodTitle(levelName: string, method?: MethodData): string {
  const parts = [levelName];
  if (method?.validity?.state === 'EFFECTIVE' && method.validity.validUntil) {
    parts.push(
      `подтверждено до ${new Date(method.validity.validUntil).toLocaleDateString('ru-RU')}`
    );
  } else if (
    method?.availability?.status === 'TEMPORARY_UNAVAILABLE' &&
    method.availability.availableAt
  ) {
    parts.push(
      `доступно с ${new Date(method.availability.availableAt).toLocaleDateString('ru-RU')}`
    );
  }
  return parts.join(' · ');
}

interface TestsState {
  catalogItems: CatalogItem[];
  selectedKeys: Set<string>;
  activeFilter: TestFilter;
  statusText: string;
  loading: boolean;

  loadTests: () => Promise<void>;
  setFilter: (filter: TestFilter) => void;
  toggleSelect: (key: string) => void;
  selectAllAvailable: () => void;
  resetSelection: () => void;
  runSelected: (onStarted?: () => void) => Promise<void>;
}

export const useTestsStore = create<TestsState>((set, get) => ({
  catalogItems: [],
  selectedKeys: new Set<string>(),
  activeFilter: 'all',
  statusText: '',
  loading: false,

  loadTests: async () => {
    set({ loading: true });
    try {
      const result = await send<{ ok?: boolean; items?: CatalogItem[]; error?: string }>({
        type: 'hh:catalog'
      });
      if (!result?.ok || !Array.isArray(result.items)) {
        set({
          statusText: `Каталог недоступен: ${result?.error || 'нет данных'}. Проверьте авторизацию и обновите.`,
          loading: false
        });
        return;
      }
      set({ catalogItems: result.items, statusText: '', loading: false });
    } catch (e: any) {
      set({ statusText: `Ошибка загрузки: ${e?.message || 'ошибка сети'}`, loading: false });
    }
  },

  setFilter: (filter: TestFilter) => {
    set({ activeFilter: filter });
  },

  toggleSelect: (key: string) => {
    const next = new Set(get().selectedKeys);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    set({ selectedKeys: next });
  },

  selectAllAvailable: () => {
    if (!useSessionStore.getState().session?.loggedIn) return;
    const { catalogItems, activeFilter } = get();
    const kindsToSelect: Array<'theory' | 'practice'> =
      activeFilter === 'all' ? ['theory', 'practice'] : [activeFilter];

    const next = new Set(get().selectedKeys);
    for (const item of catalogItems) {
      for (const level of item.levels) {
        for (const kind of kindsToSelect) {
          const method = level[kind];
          if (getMethodState(method) === 'available') {
            next.add(`${item.id}:${level.id}:${kind}`);
          }
        }
      }
    }
    set({ selectedKeys: next });
  },

  resetSelection: () => {
    set({ selectedKeys: new Set<string>() });
  },

  runSelected: async onStarted => {
    const session = useSessionStore.getState().session;
    if (!session?.loggedIn) {
      set({ statusText: 'Для запуска тестов необходимо войти в аккаунт на hh.ru' });
      return;
    }

    const { selectedKeys, catalogItems } = get();
    const jobs: any[] = [];

    for (const key of selectedKeys) {
      const [itemId, levelId, kind] = key.split(':');
      const item = catalogItems.find(candidate => String(candidate.id) === itemId);
      const level = item?.levels.find(candidate => String(candidate.id) === levelId);
      const method = level?.[kind as 'theory' | 'practice'];
      if (!item || !level || !method) continue;
      jobs.push({ item, level, method, kind });
    }

    if (!jobs.length) return;

    const kindOrder = (kind: string) => (kind === 'theory' ? 0 : 1);
    jobs.sort((a, b) => {
      const kindDelta = kindOrder(a.kind) - kindOrder(b.kind);
      if (kindDelta) return kindDelta;
      const nameDelta = a.item.name.localeCompare(b.item.name, 'ru');
      if (nameDelta) return nameDelta;
      return (a.level.rank ?? 0) - (b.level.rank ?? 0);
    });

    await send({ type: 'hh:startMany', jobs });
    set({ selectedKeys: new Set<string>() });
    await useQueueStore.getState().refreshStatus();
    if (onStarted) onStarted();
  }
}));
