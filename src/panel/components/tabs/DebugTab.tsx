import React from 'react';
import { useNetLogStore, formatTime, getSessionTestLabel } from '../../store/useNetLogStore';

export const DebugTab: React.FC = () => {
  const { armed, archive, toggleRecording, clearArchive, downloadSession, downloadAll } =
    useNetLogStore();

  return (
    <section id="tab-debug" className="tab-body active">
      <div className="toolbar toolbar-split">
        <button
          id="netRecordBtn"
          className={`btn ${armed ? 'btn-danger' : 'btn-secondary'}`}
          data-tooltip="Запись сетевого трафика"
          onClick={toggleRecording}
        >
          {armed ? (
            <svg
              className="btn-icon"
              viewBox="0 0 16 16"
              width="10"
              height="10"
              fill="currentColor"
            >
              <rect x="3" y="3" width="10" height="10" rx="1.5" />
            </svg>
          ) : (
            <svg className="btn-icon" viewBox="0 0 16 16" width="9" height="9" fill="#f87171">
              <circle cx="8" cy="8" r="6" />
            </svg>
          )}
          <span>{armed ? 'Остановить запись' : 'Запись трафика'}</span>
        </button>

        <div className="toolbar-actions">
          <button
            id="netDownloadAllBtn"
            className="btn btn-secondary"
            data-tooltip="Скачать все дампы"
            disabled={archive.length === 0}
            onClick={downloadAll}
          >
            <svg
              className="btn-icon"
              viewBox="0 0 16 16"
              width="10"
              height="10"
              fill="currentColor"
            >
              <path d="M.5 9.9a.5.5 0 0 1 .5.5v2.5a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-2.5a.5.5 0 0 1 1 0v2.5a2 2 0 0 1-2 2H2a2 2 0 0 1-2-2v-2.5a.5.5 0 0 1 .5-.5z" />
              <path d="M7.646 11.854a.5.5 0 0 0 .708 0l3-3a.5.5 0 0 0-.708-.708L8.5 10.293V1.5a.5.5 0 0 0-1 0v8.793L5.354 8.146a.5.5 0 1 0-.708.708l3 3z" />
            </svg>
            <span>Скачать все</span>
          </button>

          <button
            id="netArchiveClearBtn"
            className="btn btn-secondary"
            data-tooltip="Очистить архив дампов"
            disabled={archive.length === 0}
            onClick={clearArchive}
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
            <span>Очистить</span>
          </button>
        </div>
      </div>

      <div className="section-header">
        <span className="section-title">Сохранённые дампы ({archive.length})</span>
      </div>

      <div id="netArchiveList" className="archive-list">
        {!archive.length ? (
          <div className="empty-state-hint">
            <div>Архив дампов пуст.</div>
            <div>Включите запись перед прохождением теста.</div>
          </div>
        ) : (
          archive.map(session => {
            const truncated = session.truncated ? ' (обрезано)' : '';
            const testTitle = getSessionTestLabel(session.test);
            const timeStr = formatTime(session.startedAt);
            const entriesCount =
              Array.isArray(session.entries) && session.entries.length > 0
                ? ` · ${session.entries.length} зап.`
                : '';
            const subText = `${timeStr}${entriesCount}${truncated}`;

            return (
              <div key={session.id} className="net-entry">
                <div className="net-entry-main">
                  <span className="net-entry-title">{testTitle}</span>
                  <span className="net-entry-sub">{subText}</span>
                </div>
                <button
                  className="btn btn-secondary btn-sm"
                  onClick={() => downloadSession(session.id)}
                >
                  Скачать JSON
                </button>
              </div>
            );
          })
        )}
      </div>
    </section>
  );
};
