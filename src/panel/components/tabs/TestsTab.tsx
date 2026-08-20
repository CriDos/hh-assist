import React from 'react';
import { useTestsStore, getMethodState, getMethodTitle } from '../../store/useTestsStore';
import { useSessionStore } from '../../store/useSessionStore';
import { LevelData, TestFilter } from '../../types/tests';

interface TestsTabProps {
  onTestsStarted: () => void;
}

const LEVEL_SHORT_DEFAULT: Record<number, string> = { 1: 'Б', 2: 'С', 3: 'П' };

function levelShort(level?: LevelData): string {
  const first = String(level?.name || '')
    .trim()
    .split(/\s+/)[0];
  if (first && first.length <= 4) return first;
  return LEVEL_SHORT_DEFAULT[level?.rank ?? 0] || String(level?.rank ?? '?');
}

export const TestsTab: React.FC<TestsTabProps> = ({ onTestsStarted }) => {
  const {
    catalogItems,
    selectedKeys,
    activeFilter,
    statusText,
    loadTests,
    setFilter,
    toggleSelect,
    selectAllAvailable,
    resetSelection,
    runSelected
  } = useTestsStore();

  const { session } = useSessionStore();
  const isAuthorized = Boolean(session?.loggedIn);

  const count = selectedKeys.size;
  const items = [...catalogItems].sort((a, b) => a.name.localeCompare(b.name, 'ru'));

  const handleRefresh = () => {
    loadTests();
    useSessionStore.getState().checkSession();
  };

  return (
    <section id="tab-tests" className="tab-body active">
      {!isAuthorized && (
        <div className="card warn-card" style={{ marginBottom: '12px' }}>
          <span className="warn-icon">🔒</span>
          <div className="warn-content">
            Вы не авторизованы на hh.ru. Войдите в аккаунт, чтобы проходить тесты.
          </div>
        </div>
      )}

      <div className="toolbar toolbar-split">
        <div className="toolbar-actions">
          <button
            id="testsRun"
            className="btn btn-primary"
            data-tooltip={
              !isAuthorized
                ? 'Требуется авторизация на hh.ru'
                : count
                  ? `Запустить выбранные тесты (${count})`
                  : 'Запустить выбранные тесты'
            }
            disabled={count === 0 || !isAuthorized}
            onClick={() => runSelected(onTestsStarted)}
          >
            <svg
              className="btn-icon"
              viewBox="0 0 16 16"
              width="10"
              height="10"
              fill="currentColor"
            >
              <path d="M4 2.5v11l9-5.5z" />
            </svg>
            <span>{count ? `Запустить (${count})` : 'Запустить'}</span>
          </button>

          <div className="filter-chips" id="testsFilterChips">
            {(['all', 'theory', 'practice'] as TestFilter[]).map(f => (
              <button
                key={f}
                className={`chip ${activeFilter === f ? 'active' : ''}`}
                onClick={() => setFilter(f)}
              >
                {f === 'all' ? 'Все' : f === 'theory' ? 'Теория' : 'Практика'}
              </button>
            ))}
          </div>
        </div>

        <div className="toolbar-actions">
          <button
            id="testsSelectAll"
            className="btn btn-secondary btn-icon-only"
            data-tooltip={isAuthorized ? 'Выбрать все доступные' : 'Требуется авторизация на hh.ru'}
            disabled={!isAuthorized}
            onClick={selectAllAvailable}
          >
            <svg
              className="btn-icon"
              viewBox="0 0 16 16"
              width="11"
              height="11"
              fill="currentColor"
            >
              <path d="M2.5 3A1.5 1.5 0 0 1 4 1.5h8A1.5 1.5 0 0 1 13.5 3v10a1.5 1.5 0 0 1-1.5 1.5H4A1.5 1.5 0 0 1 2.5 13zm9.8 2.8a.75.75 0 0 0-1.1-1.1L6.5 9.4 4.8 7.7a.75.75 0 0 0-1.1 1.1l2.3 2.3a.75.75 0 0 0 1.1 0z" />
            </svg>
          </button>

          <button
            id="testsReset"
            className="btn btn-secondary btn-icon-only"
            data-tooltip="Сбросить выбор"
            onClick={resetSelection}
          >
            <svg
              className="btn-icon"
              viewBox="0 0 16 16"
              width="10"
              height="10"
              fill="currentColor"
            >
              <path d="M3.7 3l-.7.7L6.3 7 3 10.3l.7.7L7 7.7l3.3 3.3.7-.7L7.7 7 11 3.7l-.7-.7L7 6.3z" />
            </svg>
          </button>

          <button
            id="testsRefresh"
            className="btn btn-secondary btn-icon-only"
            data-tooltip="Обновить список тестов"
            onClick={handleRefresh}
          >
            <svg
              className="btn-icon"
              viewBox="0 0 16 16"
              width="11"
              height="11"
              fill="currentColor"
            >
              <path d="M13.5 8a5.5 5.5 0 1 1-1.6-3.9l1.6-1.6V7h-4.5l1.8-1.8A7 7 0 1 0 15 8z" />
            </svg>
          </button>
        </div>
      </div>

      {statusText && (
        <div id="testsStatus" className="status-hint">
          {statusText}
        </div>
      )}

      <div id="testsList" className="tests-list">
        {items.map(item => {
          const kindsToRender: Array<'theory' | 'practice'> =
            activeFilter === 'all' ? ['theory', 'practice'] : [activeFilter];

          const hasAnyMethods = kindsToRender.some(kind => item.levels.some(level => level[kind]));
          if (!hasAnyMethods) return null;

          return (
            <div key={item.id} className="test-item">
              <div className="test-name">{item.name}</div>
              <div className="kinds">
                {kindsToRender.map(kind => {
                  const methods = [...item.levels]
                    .sort((a, b) => a.rank - b.rank)
                    .map(level => ({ level, method: level[kind] }))
                    .filter(entry => entry.method);
                  if (!methods.length) return null;

                  return (
                    <div key={kind} className="kind-row">
                      <div className="kind-label">{kind === 'theory' ? 'Теория' : 'Практика'}</div>
                      <div className="chips">
                        {methods.map(({ level, method }) => {
                          const key = `${item.id}:${level.id}:${kind}`;
                          const shortText = levelShort(level);
                          const state = getMethodState(method);
                          const isSelected = selectedKeys.has(key);

                          let chipClass = `chip ${shortText.length <= 1 ? 'chip-single' : ''}`;
                          if (state === 'passed') chipClass += ' passed';
                          else if (state !== 'available' || !isAuthorized) chipClass += ' blocked';
                          if (isSelected) chipClass += ' on';

                          return (
                            <button
                              key={key}
                              className={chipClass.trim()}
                              data-tooltip={
                                !isAuthorized
                                  ? 'Требуется авторизация на hh.ru'
                                  : getMethodTitle(level.name, method)
                              }
                              disabled={!isAuthorized || state !== 'available'}
                              onClick={() => toggleSelect(key)}
                            >
                              {shortText}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
};
