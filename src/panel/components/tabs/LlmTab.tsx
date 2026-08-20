import React, { useState } from 'react';
import { useLlmStore, decodeHtmlEntities } from '../../store/useLlmStore';
import { LlmFilter } from '../../types/llm';
import { copyToClipboard } from '../../services/extension';

export const LlmTab: React.FC = () => {
  const {
    entries,
    selectedEntryId,
    activeFilter,
    refreshLlm,
    selectEntry,
    setFilter,
    clearHistory,
    getActiveEntry,
    getFilteredEntries,
    formatActiveContext,
    formatAllContext
  } = useLlmStore();

  const [copyActiveFlash, setCopyActiveFlash] = useState(false);
  const [copyAllFlash, setCopyAllFlash] = useState(false);

  const active = getActiveEntry();
  const filteredHistory = getFilteredEntries();

  const handleCopyActive = async () => {
    if (!active) return;
    await copyToClipboard(formatActiveContext());
    setCopyActiveFlash(true);
    setTimeout(() => setCopyActiveFlash(false), 1200);
  };

  const handleCopyAll = async () => {
    if (!entries.length) return;
    await copyToClipboard(formatAllContext());
    setCopyAllFlash(true);
    setTimeout(() => setCopyAllFlash(false), 1200);
  };

  // Active Card Data
  const isProbe = active?.kind === 'probe';
  const kindLabel = isProbe ? 'Проверка API' : active?.kind === 'theory' ? 'Теория' : 'Практика';
  const itemLabel = active?.item || (isProbe ? 'Проверка API' : 'Тест');
  const taskPrefix = active?.kind === 'theory' ? 'Вопрос' : 'Задача';
  const taskNum = active?.number
    ? ` · ${taskPrefix} ${active.number}${active.total ? ` из ${active.total}` : ''}`
    : '';
  const attemptPrefix = active?.kind === 'theory' ? 'повтор' : 'исправление';
  const attemptStr =
    active?.attempt && active.attempt > 0 ? ` (${attemptPrefix} ${active.attempt + 1})` : '';
  const testHeader = [itemLabel, active?.level, kindLabel].filter(Boolean).join(' · ');

  const activeTitle = active
    ? isProbe
      ? `⚡ Проверка API (${active.level || 'Модель'})`
      : `${testHeader}${taskNum}${attemptStr}`
    : 'Нет данных о запросах';

  const timeStr = active?.at ? new Date(active.at).toLocaleTimeString('ru-RU') : '';
  const durStr = active?.durationMs ? `${(active.durationMs / 1000).toFixed(1)}s` : '';
  const activeMeta = active ? timeStr : 'Запустите тест для просмотра контекста диалога с LLM';

  let badgeText = 'Ожидание';
  let badgeClass = 'badge';
  if (active) {
    if (active.status === 'pending') {
      badgeText = 'В обработке...';
      badgeClass = 'badge badge-running';
    } else if (active.status === 'error' || active.error) {
      badgeText = 'Ошибка';
      badgeClass = 'badge badge-error';
    } else {
      badgeText = durStr ? `200 OK (${durStr})` : '200 OK';
      badgeClass = 'badge badge-success';
    }
  }

  return (
    <section id="tab-llm" className="tab-body active">
      <div className="toolbar toolbar-split">
        <div className="toolbar-actions">
          <button
            id="llmCopyActiveBtn"
            className={`btn btn-secondary ${copyActiveFlash ? 'btn-success-flash' : ''}`}
            data-tooltip="Скопировать текущий запрос"
            onClick={handleCopyActive}
          >
            <svg
              className="btn-icon"
              viewBox="0 0 16 16"
              width="11"
              height="11"
              fill="currentColor"
            >
              <path d="M4 2a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V4a2 2 0 0 0-2-2h-1.2A2 2 0 0 0 9 1H7a2 2 0 0 0-1.8 1zm3 0a1 1 0 0 1 1-1h0a1 1 0 0 1 1 1v.5H7zm-3 2h1.2A2 2 0 0 0 7 5.5h2A2 2 0 0 0 10.8 4H12a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1z" />
            </svg>
            <span>{copyActiveFlash ? 'Скопировано' : 'Текущий'}</span>
          </button>

          <button
            id="llmCopyAllBtn"
            className={`btn btn-secondary ${copyAllFlash ? 'btn-success-flash' : ''}`}
            data-tooltip="Скопировать всю историю запросов"
            onClick={handleCopyAll}
          >
            <svg
              className="btn-icon"
              viewBox="0 0 16 16"
              width="11"
              height="11"
              fill="currentColor"
            >
              <path d="M1 3.5A1.5 1.5 0 0 1 2.5 2h11A1.5 1.5 0 0 1 15 3.5v9a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 1 12.5zM2.5 3a.5.5 0 0 0-.5.5v9a.5.5 0 0 0 .5.5H8V3zm6.5 0v10h4.5a.5.5 0 0 0 .5-.5v-9a.5.5 0 0 0-.5-.5z" />
            </svg>
            <span>{copyAllFlash ? 'Скопировано' : 'Вся история'}</span>
          </button>
        </div>

        <div className="toolbar-actions">
          <button
            id="llmRefreshBtn"
            className="btn btn-secondary btn-icon-only"
            data-tooltip="Обновить контекст"
            onClick={refreshLlm}
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

          <button
            id="llmClearHistoryBtn"
            className="btn btn-secondary btn-icon-only"
            data-tooltip="Очистить историю запросов"
            onClick={clearHistory}
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
        </div>
      </div>

      <div className="card llm-viewer-card" id="llmActiveCard">
        <div className="llm-viewer-header">
          <div className="llm-header-info">
            <span id="llmActiveTitle" className="llm-task-title">
              {activeTitle}
            </span>
            <span id="llmActiveMeta" className="llm-task-meta">
              {activeMeta}
            </span>
          </div>
          <span id="llmActiveBadge" className={badgeClass}>
            {badgeText}
          </span>
        </div>

        <div className="llm-block llm-block-system">
          <div className="llm-block-summary">Системный промпт (инструкция)</div>
          <pre id="llmActiveSystem" className="llm-code-block">
            {decodeHtmlEntities(active?.system) || '—'}
          </pre>
        </div>

        <div className="llm-block llm-block-user">
          <div className="llm-block-summary">Промпт пользователя (вопрос / задание)</div>
          <pre id="llmActiveUser" className="llm-code-block">
            {active?.history && active.history.length > 0
              ? active.history
                  .map(msg => `[${msg.role.toUpperCase()}]:\n${decodeHtmlEntities(msg.content)}\n`)
                  .join('\n---\n\n')
              : decodeHtmlEntities(active?.question) || '—'}
          </pre>
        </div>

        <div className="llm-block llm-block-response">
          <div className="llm-block-summary">Ответ модели</div>
          <pre id="llmActiveResponse" className="llm-code-block">
            {active?.status === 'pending'
              ? 'Ожидание ответа модели...'
              : active?.error
                ? `Ошибка: ${decodeHtmlEntities(active.error)}`
                : decodeHtmlEntities(active?.response) || '—'}
          </pre>
        </div>
      </div>

      <div className="section-header">
        <span className="section-title">
          История (<span id="llmHistoryCount">{entries.length}</span>)
        </span>
        <div className="filter-chips" id="llmFilterChips">
          {(['all', 'theory', 'practice', 'error'] as LlmFilter[]).map(f => (
            <button
              key={f}
              className={`chip ${activeFilter === f ? 'active' : ''}`}
              onClick={() => setFilter(f)}
            >
              {f === 'all'
                ? 'Все'
                : f === 'theory'
                  ? 'Теория'
                  : f === 'practice'
                    ? 'Практика'
                    : 'Ошибки'}
            </button>
          ))}
        </div>
      </div>

      <div id="llmHistoryList" className="llm-history-list">
        {!filteredHistory.length ? (
          <div className="empty-state-hint">
            {entries.length ? 'Нет запросов под выбранный фильтр' : 'История запросов пуста'}
          </div>
        ) : (
          [...filteredHistory].reverse().map(entry => {
            const isSelected = selectedEntryId
              ? entry.id === selectedEntryId
              : entry.id === active?.id;
            const entryProbe = entry.kind === 'probe';
            const entryKindLabel = entryProbe
              ? 'Проверка API'
              : entry.kind === 'theory'
                ? 'Теория'
                : 'Практика';
            const entryItemLabel = entry.item || (entryProbe ? 'Проверка LLM' : 'Тест');
            const entryTimeStr = entry.at ? new Date(entry.at).toLocaleTimeString('ru-RU') : '';
            const entryDurStr = entry.durationMs ? `${(entry.durationMs / 1000).toFixed(1)}s` : '';

            let statusClass = 'status-ok';
            let statusText = entryDurStr || 'OK';
            if (entry.status === 'pending') {
              statusClass = 'status-pending';
              statusText = '...';
            } else if (entry.status === 'error' || entry.error) {
              statusClass = 'status-err';
              statusText = 'ERR';
            }

            let titleText = '';
            let subText = '';

            if (entryProbe) {
              titleText = '⚡ Проверка API';
              subText = [entry.level || 'Модель', entryTimeStr].filter(Boolean).join(' · ');
            } else {
              titleText = [entryItemLabel, entry.level, entryKindLabel].filter(Boolean).join(' · ');
              const taskPrefix = entry.kind === 'theory' ? 'Вопрос' : 'Задача';
              const taskNumStr = entry.number
                ? `${taskPrefix} ${entry.number}${entry.total ? ` из ${entry.total}` : ''}`
                : taskPrefix;
              const attemptPrefix = entry.kind === 'theory' ? 'повтор' : 'исправление';
              const attemptTag =
                entry.attempt && entry.attempt > 0
                  ? ` (${attemptPrefix} ${entry.attempt + 1})`
                  : '';
              subText = [`${taskNumStr}${attemptTag}`, entryTimeStr].filter(Boolean).join(' · ');
            }

            return (
              <div
                key={entry.id}
                className={`llm-history-item ${isSelected ? 'selected' : ''}`}
                onClick={() => selectEntry(entry.id)}
              >
                <div className="history-item-main">
                  <span className="history-item-title">{titleText}</span>
                  <span className="history-item-sub">{subText}</span>
                </div>
                <span className={`history-item-badge ${statusClass}`}>{statusText}</span>
              </div>
            );
          })
        )}
      </div>
    </section>
  );
};
