import React, { useEffect, useRef, useState } from 'react';
import { useLogStore } from '../../store/useLogStore';
import { LogFilter } from '../../types/log';
import { copyToClipboard } from '../../services/extension';

export const LogTab: React.FC = () => {
  const { entries, activeFilter, setFilter, clearLog, getFilteredEntries } = useLogStore();
  const [copied, setCopied] = useState(false);
  const logContainerRef = useRef<HTMLDivElement>(null);

  const filteredEntries = getFilteredEntries();

  useEffect(() => {
    if (logContainerRef.current) {
      logContainerRef.current.scrollTop = logContainerRef.current.scrollHeight;
    }
  }, [filteredEntries.length]);

  const handleCopy = async () => {
    if (!filteredEntries.length) return;
    const text = filteredEntries
      .map(
        entry =>
          `${new Date(entry.ts).toLocaleTimeString('ru-RU')} [${(entry.level || 'info').toUpperCase()}] ${entry.message}`
      )
      .join('\n');
    await copyToClipboard(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1200);
  };

  return (
    <section id="tab-log" className="tab-body active">
      <div className="toolbar toolbar-split">
        <div className="filter-chips" id="logFilterChips">
          {(['all', 'info', 'warn', 'error'] as LogFilter[]).map(f => (
            <button
              key={f}
              className={`chip ${activeFilter === f ? 'active' : ''}`}
              onClick={() => setFilter(f)}
            >
              {f === 'all' ? 'Все' : f === 'info' ? 'Инфо' : f === 'warn' ? 'Варнинги' : 'Ошибки'}
            </button>
          ))}
        </div>

        <div className="toolbar-actions">
          <button
            id="logCopyBtn"
            className={`btn btn-secondary btn-icon-only ${copied ? 'btn-success-flash' : ''}`}
            data-tooltip="Скопировать журнал"
            onClick={handleCopy}
          >
            {copied ? (
              <svg
                className="btn-icon"
                viewBox="0 0 16 16"
                width="11"
                height="11"
                fill="currentColor"
              >
                <path d="M13.854 3.646a.5.5 0 0 1 0 .708l-7 7a.5.5 0 0 1-.708 0l-3.5-3.5a.5.5 0 1 1 .708-.708L6.5 10.293l6.646-6.647a.5.5 0 0 1 .708 0z" />
              </svg>
            ) : (
              <svg
                className="btn-icon"
                viewBox="0 0 16 16"
                width="11"
                height="11"
                fill="currentColor"
              >
                <path d="M4 2a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V4a2 2 0 0 0-2-2h-1.2A2 2 0 0 0 9 1H7a2 2 0 0 0-1.8 1zm3 0a1 1 0 0 1 1-1h0a1 1 0 0 1 1 1v.5H7zm-3 2h1.2A2 2 0 0 0 7 5.5h2A2 2 0 0 0 10.8 4H12a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1z" />
              </svg>
            )}
          </button>

          <button
            id="logClearBtn"
            className="btn btn-secondary btn-icon-only"
            data-tooltip="Очистить журнал"
            onClick={clearLog}
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

      <div id="logList" className="log-console" ref={logContainerRef}>
        {!filteredEntries.length ? (
          <div className="empty-state-hint">
            {entries.length ? 'Нет записей с выбранным фильтром' : 'Журнал событий пуст'}
          </div>
        ) : (
          filteredEntries.slice(-500).map((entry, idx) => {
            const level = entry.level || 'info';
            const timeStr = new Date(entry.ts || Date.now()).toLocaleTimeString('ru-RU');

            return (
              <div key={idx} className={`log-row level-${level}`}>
                <span className="log-dot" data-tooltip={level}></span>
                <span className="log-time">{timeStr}</span>
                <div className="log-msg">{entry.message}</div>
              </div>
            );
          })
        )}
      </div>
    </section>
  );
};
