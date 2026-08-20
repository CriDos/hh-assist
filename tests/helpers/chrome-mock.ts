export interface MockEvent<T = any> {
  listeners: T[];
  addListener: (fn: T) => void;
}

export function createEvent<T = any>(): MockEvent<T> {
  const listeners: T[] = [];
  return {
    listeners,
    addListener(fn: T) {
      listeners.push(fn);
    }
  };
}

export interface ChromeMockOptions {
  store?: Record<string, any>;
  tabs?: Record<number, any>;
}

export function createChromeMock({
  store = {},
  tabs = { 1: { id: 1, url: 'https://assessment.hh.ru/code/230' } }
}: ChromeMockOptions = {}) {
  const storage: Record<string, any> = { ...store };
  const chrome: any = {
    storage: {
      session: {
        get: async (key: any) => {
          if (typeof key === 'string') return { [key]: storage[key] };
          return Object.assign({}, key, storage);
        },
        set: async (obj: any) => Object.assign(storage, obj),
        remove: async (key: string) => {
          delete storage[key];
        }
      },
      local: {
        get: async (key: any) => {
          if (typeof key === 'string') return { [key]: storage[key] };
          return Object.assign({}, key, storage);
        },
        set: async (obj: any) => Object.assign(storage, obj),
        remove: async (key: string) => {
          delete storage[key];
        }
      }
    },
    runtime: {
      onConnect: createEvent(),
      onMessage: createEvent(),
      onInstalled: createEvent(),
      reload: () => {}
    },
    sidePanel: {
      behavior: null,
      options: null,
      opened: null,
      async open(options: any) {
        chrome.sidePanel.opened = options;
      },
      async setOptions(options: any) {
        chrome.sidePanel.options = options;
      },
      async setPanelBehavior(options: any) {
        chrome.sidePanel.behavior = options;
      }
    },
    action: {
      onClicked: createEvent()
    },
    contextMenus: {
      items: [] as any[],
      create(item: any) {
        chrome.contextMenus.items.push(item);
      },
      removeAll(cb?: () => void) {
        chrome.contextMenus.items = [];
        cb?.();
      },
      onClicked: createEvent()
    },
    scripting: {
      results: [] as any[],
      executeScript: async () => chrome.scripting.results
    },
    alarms: {
      create: async () => {},
      clear: async () => {},
      onAlarm: createEvent()
    },
    webRequest: {
      onBeforeRequest: createEvent(),
      onBeforeSendHeaders: createEvent(),
      onCompleted: createEvent(),
      onErrorOccurred: createEvent()
    },
    tabs: {
      onUpdated: createEvent(),
      onRemoved: createEvent(),
      get: async (id: number) => tabs[id],
      query: async () => Object.values(tabs).filter(tab => Number.isInteger(tab.id)),
      update: async (id: number, changes: any) => Object.assign(tabs[id], changes),
      create: async () => ({}),
      reload: async () => {}
    }
  };
  return { chrome, storage };
}
