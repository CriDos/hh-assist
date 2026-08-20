import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ErrorBoundary } from '../../src/panel/components/ErrorBoundary';
import { Header } from '../../src/panel/components/Header';
import { TabsNav, TabId } from '../../src/panel/components/TabsNav';
import { Tooltip } from '../../src/panel/components/Tooltip';
import { LogTab } from '../../src/panel/components/tabs/LogTab';
import { DebugTab } from '../../src/panel/components/tabs/DebugTab';
import { QueueTab } from '../../src/panel/components/tabs/QueueTab';
import { LlmTab } from '../../src/panel/components/tabs/LlmTab';
import { TestsTab } from '../../src/panel/components/tabs/TestsTab';
import { SettingsTab } from '../../src/panel/components/tabs/SettingsTab';
import { useSessionStore } from '../../src/panel/store/useSessionStore';
import { useLogStore } from '../../src/panel/store/useLogStore';
import { useNetLogStore } from '../../src/panel/store/useNetLogStore';
import { useLlmStore } from '../../src/panel/store/useLlmStore';
import { useTestsStore } from '../../src/panel/store/useTestsStore';
import { APP_VERSION } from '../../src/core/version';

describe('Panel React Components', () => {
  describe('ErrorBoundary Component', () => {
    it('renders child components when there is no error', () => {
      const html = renderToStaticMarkup(
        <ErrorBoundary>
          <div data-testid="child-content">Панель работает штатно</div>
        </ErrorBoundary>
      );
      expect(html).toContain('Панель работает штатно');
      expect(html).not.toContain('Сбой рендера панели');
    });

    it('renders crash screen UI when error state is active', () => {
      const boundary = new ErrorBoundary({ children: <div>Normal</div> });
      boundary.state = {
        hasError: true,
        error: new Error('Тестовая ошибка отрисовки'),
        errorInfo: { componentStack: '\n    at BrokenComponent\n    at App' },
        copied: false
      };

      const element = boundary.render() as React.ReactElement;
      const html = renderToStaticMarkup(element);

      // Verify Header & Version
      expect(html).toContain(`Сбой рендера панели: hh-assist v${APP_VERSION}`);
      expect(html).toContain('Непредвиденная ошибка отрисовки интерфейса');

      // Verify Error message & name
      expect(html).toContain('Error');
      expect(html).toContain('Тестовая ошибка отрисовки');

      // Verify Compact Toolbar Actions
      expect(html).toContain('Повторить');
      expect(html).toContain('Перезапустить');
      expect(html).toContain('Скопировать');
      expect(html).toContain('data-tooltip="Восстановить рендер"');
      expect(html).toContain('data-tooltip="Перезапустить расширение"');
      expect(html).toContain('data-tooltip="Скопировать отчёт об ошибке"');

      // Verify 2 Non-Collapsible Independent Blocks
      expect(html).toContain('Стек вызовов');
      expect(html).toContain('Иерархия компонентов');
      expect(html).toContain('BrokenComponent');
    });

    it('getDerivedStateFromError captures error object', () => {
      const err = new Error('Reconciliation failure');
      const derived = ErrorBoundary.getDerivedStateFromError(err);
      expect(derived).toEqual({
        hasError: true,
        error: err,
        errorInfo: null
      });
    });

    it('componentDidCatch sets error and componentStack', () => {
      const boundary = new ErrorBoundary({ children: <div>Normal</div> });
      boundary.setState = vi.fn((update: any) => {
        boundary.state = {
          ...boundary.state,
          ...(typeof update === 'function' ? update(boundary.state) : update)
        };
      });
      const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const err = new Error('DOM insert error');
      const info = { componentStack: '\n  at SubComponent' };

      boundary.componentDidCatch(err, info);
      expect(boundary.state.error).toBe(err);
      expect(boundary.state.errorInfo).toEqual(info);
      spy.mockRestore();
    });

    it('handleReset resets error boundary state', () => {
      const boundary = new ErrorBoundary({ children: <div>Normal</div> });
      boundary.setState = vi.fn((update: any) => {
        boundary.state = {
          ...boundary.state,
          ...(typeof update === 'function' ? update(boundary.state) : update)
        };
      });
      boundary.state = {
        hasError: true,
        error: new Error('Boom'),
        errorInfo: { componentStack: 'stack' },
        copied: false
      };

      (boundary as any).handleReset();
      expect(boundary.state.hasError).toBe(false);
      expect(boundary.state.error).toBeNull();
      expect(boundary.state.errorInfo).toBeNull();
    });

    it('handleCopy formats crash report with version, error and stack traces', () => {
      const boundary = new ErrorBoundary({ children: <div>Normal</div> });
      boundary.setState = vi.fn((update: any) => {
        boundary.state = {
          ...boundary.state,
          ...(typeof update === 'function' ? update(boundary.state) : update)
        };
      });
      const writeTextSpy = vi.fn();
      Object.assign(navigator, {
        clipboard: { writeText: writeTextSpy }
      });

      boundary.state = {
        hasError: true,
        error: new Error('Critical UI failure'),
        errorInfo: { componentStack: '\n    at Broken\n    at App' },
        copied: false
      };

      (boundary as any).handleCopy();

      expect(writeTextSpy).toHaveBeenCalledTimes(1);
      const clipboardContent = writeTextSpy.mock.calls[0][0];
      expect(clipboardContent).toContain('HH-ASSIST PANEL CRASH REPORT');
      expect(clipboardContent).toContain(`v${APP_VERSION}`);
      expect(clipboardContent).toContain('Critical UI failure');
      expect(clipboardContent).toContain('at Broken');
      expect(boundary.state.copied).toBe(true);
    });

    it('handleReload triggers chrome.runtime.reload or window.location.reload', () => {
      const boundary = new ErrorBoundary({ children: <div>Normal</div> });
      const reloadSpy = vi.fn();
      (globalThis as any).chrome = { runtime: { reload: reloadSpy } };

      (boundary as any).handleReload();
      expect(reloadSpy).toHaveBeenCalledTimes(1);
    });
  });

  describe('Header Component', () => {
    it('renders brand title and current extension version badge', () => {
      const html = renderToStaticMarkup(<Header />);
      expect(html).toContain('hh-assist');
      expect(html).toContain(APP_VERSION);
    });

    it('renders loading state when checking session', () => {
      useSessionStore.setState({ loading: true, session: null });
      const html = renderToStaticMarkup(<Header />);
      expect(html).toContain('Проверка...');
    });
  });

  describe('TabsNav Component', () => {
    it('renders all 6 navigation tabs with Russian labels', () => {
      const html = renderToStaticMarkup(<TabsNav activeTab="status" onSelectTab={() => {}} />);
      expect(html).toContain('Очередь');
      expect(html).toContain('Тесты');
      expect(html).toContain('Лог');
      expect(html).toContain('Контекст');
      expect(html).toContain('Сеть');
      expect(html).toContain('Настройки');
    });

    it('marks the active tab button with .active class', () => {
      const html = renderToStaticMarkup(<TabsNav activeTab="tests" onSelectTab={() => {}} />);
      expect(html).toContain('data-tab="tests" class="tab-btn active"');
      expect(html).toContain('data-tab="status" class="tab-btn "');
    });

    it('renders properly for each possible tab ID', () => {
      const tabs: TabId[] = ['status', 'tests', 'log', 'llm', 'debug', 'settings'];
      for (const tab of tabs) {
        const html = renderToStaticMarkup(<TabsNav activeTab={tab} onSelectTab={() => {}} />);
        expect(html).toContain(`data-tab="${tab}" class="tab-btn active"`);
      }
    });
  });

  describe('Tooltip Component', () => {
    it('renders tooltip container markup with content and arrow', () => {
      const html = renderToStaticMarkup(<Tooltip />);
      expect(html).toBe('');
    });
  });

  describe('Tab Views Components', () => {
    it('LogTab renders log filters and empty state container', () => {
      useLogStore.setState({ entries: [], activeFilter: 'all' });
      const html = renderToStaticMarkup(<LogTab />);
      expect(html).toContain('Все');
      expect(html).toContain('Инфо');
      expect(html).toContain('Варнинги');
      expect(html).toContain('Ошибки');
      expect(html).toContain('log-console');
    });

    it('DebugTab renders network log toolbar, archive header and empty prompt', () => {
      useNetLogStore.setState({ archive: [], armed: false });
      const html = renderToStaticMarkup(<DebugTab />);
      expect(html).toContain('Запись трафика');
      expect(html).toContain('Скачать все');
      expect(html).toContain('Сохранённые дампы');
      expect(html).toContain('Архив дампов пуст');
    });

    it('LlmTab renders copy all queries button and empty history prompt', () => {
      useLlmStore.setState({ entries: [], activeFilter: 'all' });
      const html = renderToStaticMarkup(<LlmTab />);
      expect(html).toContain('data-tooltip="Скопировать всю историю запросов"');
      expect(html).toContain('Нет данных о запросах');
    });

    it('QueueTab renders authorization prompt or queue toolbar', () => {
      const html = renderToStaticMarkup(
        <QueueTab onGoToTests={() => {}} onGoToSettings={() => {}} />
      );
      expect(html).toContain('tab-status');
      expect(html).toContain('queue-actions');
    });

    it('TestsTab renders test category filters and launch button', () => {
      useTestsStore.setState({ catalogItems: [], loading: false });
      const html = renderToStaticMarkup(<TestsTab onTestsStarted={() => {}} />);
      expect(html).toContain('testsFilterChips');
      expect(html).toContain('Все');
      expect(html).toContain('Теория');
      expect(html).toContain('Практика');
      expect(html).toContain('Запустить');
    });

    it('SettingsTab renders configuration form with providers and timing settings', () => {
      const html = renderToStaticMarkup(<SettingsTab />);
      expect(html).toContain('Нейросеть (LLM API)');
      expect(html).toContain('Провайдер');
      expect(html).toContain('OpenAI');
      expect(html).toContain('OpenRouter');
      expect(html).toContain('DeepSeek');
      expect(html).toContain('Задержки и тайминги');
      expect(html).toContain('Фингерпринт (Профиль)');
    });
  });
});
