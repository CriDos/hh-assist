import React from 'react';
import { useQueueStore } from '../../store/useQueueStore';
import { useSessionStore } from '../../store/useSessionStore';
import { JobItem } from '../../types/queue';
import { resultVerdict } from '../../../core/result.ts';

interface QueueTabProps {
  onGoToTests: () => void;
  onGoToSettings: () => void;
}

function jobTitle(job: JobItem): string {
  const kind = job.kind === 'theory' ? 'Теория' : 'Практика';
  return [job.name, job.level, kind].filter(Boolean).join(' · ');
}

function formatTime(seconds: number): string {
  const total = Math.max(0, Math.round(seconds));
  const minutes = Math.floor(total / 60);
  return `${minutes}:${String(total % 60).padStart(2, '0')}`;
}

export const QueueTab: React.FC<QueueTabProps> = ({ onGoToTests, onGoToSettings }) => {
  const {
    jobs,
    status,
    configured,
    paused,
    remainingSeconds,
    pauseQueue,
    resumeQueue,
    clearDone,
    removeJob,
    abortRunning
  } = useQueueStore();

  const { session } = useSessionStore();
  const isAuthorized = Boolean(session?.loggedIn);

  const doneCount = jobs.filter(j => j.status === 'done' || j.status === 'aborted').length;
  const failedCount = jobs.filter(j => j.status === 'error' || j.status === 'aborted').length;
  const queuedCount = jobs.filter(j => j.status === 'queued').length;
  const isRunning = status === 'running' || status === 'queued';
  const isPaused = status === 'paused' || paused;
  const canResume =
    (isPaused || failedCount > 0 || (queuedCount > 0 && !isRunning)) && isAuthorized;

  return (
    <section id="tab-status" className="tab-body active">
      {!isAuthorized && jobs.length > 0 && (
        <div className="card warn-card" style={{ marginBottom: '8px' }}>
          <span className="warn-icon">🔒</span>
          <div className="warn-content">
            Для выполнения тестов требуется авторизация на hh.ru. Войдите в свой аккаунт.
          </div>
        </div>
      )}

      <div className="toolbar">
        <div className="toolbar-actions queue-actions">
          <button
            id="queuePauseBtn"
            className="btn btn-secondary"
            data-tooltip="Приостановить очередь"
            disabled={!isRunning}
            onClick={pauseQueue}
          >
            <svg
              className="btn-icon"
              viewBox="0 0 16 16"
              width="10"
              height="10"
              fill="currentColor"
            >
              <rect x="3" y="2.5" width="3.5" height="11" rx="1" />
              <rect x="9.5" y="2.5" width="3.5" height="11" rx="1" />
            </svg>
            <span>Пауза</span>
          </button>

          <button
            id="queueResumeBtn"
            className="btn btn-secondary"
            data-tooltip={
              !isAuthorized ? 'Требуется авторизация на hh.ru' : 'Возобновить выполнение тестов'
            }
            disabled={!canResume}
            onClick={resumeQueue}
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
            <span>
              {failedCount > 0 && !isPaused ? `↻ Возобновить (${failedCount})` : '↻ Возобновить'}
            </span>
          </button>

          <button
            id="queueClearDoneBtn"
            className="btn btn-secondary"
            data-tooltip="Очистить завершённые тесты"
            disabled={doneCount === 0}
            onClick={clearDone}
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

      {jobs.length === 0 && (
        <>
          {!isAuthorized ? (
            <div id="jobsEmpty" className="empty-state">
              <span className="empty-icon">🔒</span>
              <div className="empty-title">Требуется авторизация</div>
              <div className="empty-desc">
                Войдите в аккаунт на hh.ru в браузере, чтобы приступить к решению тестов
              </div>
              <button
                id="checkAuthBtn"
                className="btn btn-secondary"
                onClick={() => useSessionStore.getState().checkSession()}
              >
                <span>Проверить авторизацию</span>
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
          ) : !configured ? (
            <div id="jobsEmpty" className="empty-state">
              <span className="empty-icon">⚠️</span>
              <div className="empty-title">API нейросети не настроен</div>
              <div className="empty-desc">
                Перейдите во вкладку «Настройки» и укажите адрес API, ключ и модель для решения
                заданий
              </div>
              <button id="goToSettingsBtn" className="btn btn-secondary" onClick={onGoToSettings}>
                <span>Перейти в настройки</span>
                <svg
                  className="btn-icon"
                  viewBox="0 0 16 16"
                  width="11"
                  height="11"
                  fill="currentColor"
                >
                  <path d="M6 3.5l4.5 4.5L6 12.5l-.7-.7L9.1 8 5.3 4.2z" />
                </svg>
              </button>
            </div>
          ) : (
            <div id="jobsEmpty" className="empty-state">
              <span className="empty-icon">📋</span>
              <div className="empty-title">Очередь пуста</div>
              <div className="empty-desc">
                Выберите навыки во вкладке «Тесты» для автоматического прохождения
              </div>
              <button id="goToTestsBtn" className="btn btn-secondary" onClick={onGoToTests}>
                <span>Выбрать тесты</span>
                <svg
                  className="btn-icon"
                  viewBox="0 0 16 16"
                  width="11"
                  height="11"
                  fill="currentColor"
                >
                  <path d="M6 3.5l4.5 4.5L6 12.5l-.7-.7L9.1 8 5.3 4.2z" />
                </svg>
              </button>
            </div>
          )}
        </>
      )}

      {jobs.length > 0 && (
        <div id="jobsList" className="jobs-container">
          {jobs.map(job => {
            const progress = job.progress || {};
            const total = progress.total || 0;
            const progressNumber = progress.number || 0;
            let fillWidth = '0%';
            let fillClass = 'job-bar-fill';

            if (job.status === 'running') {
              if (total) fillWidth = `${Math.round((progressNumber / total) * 100)}%`;
            } else if (job.status === 'done') {
              fillWidth = '100%';
              fillClass += ' done';
              if (job.passed === false) fillClass += ' fail';
            } else if (job.status === 'error' || job.status === 'aborted') {
              fillClass += ' error';
            }

            let metaText = '';
            if (job.status === 'running') {
              const unit = job.kind === 'practice' ? 'Задача' : 'Вопрос';
              metaText = total ? `${unit} ${progressNumber} из ${total}` : 'Инициализация теста…';
            } else if (job.status === 'queued') {
              metaText = 'В очереди';
            } else if (job.status === 'done' && job.correct != null && job.totalScore != null) {
              metaText = resultVerdict({
                passed: job.passed,
                correct: job.correct,
                total: job.totalScore
              }).label;
            } else if (job.message) {
              metaText = job.message;
            }

            return (
              <div
                key={job.id}
                className={`card job ${job.status} ${job.status !== 'running' ? 'has-remove' : ''}`}
              >
                {job.status !== 'running' && (
                  <button
                    className="job-remove"
                    data-tooltip="Удалить из очереди"
                    onClick={() => removeJob(job.id)}
                  >
                    <svg
                      viewBox="0 0 16 16"
                      width="10"
                      height="10"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.8"
                      strokeLinecap="round"
                    >
                      <path d="M4 4l8 8M12 4l-8 8" />
                    </svg>
                  </button>
                )}

                <div className="job-title">{jobTitle(job)}</div>

                <div className="job-row">
                  <div className="job-bar">
                    <div className={fillClass} style={{ width: fillWidth }}></div>
                  </div>
                  <span className="job-meta">{metaText}</span>

                  {job.status === 'running' && (
                    <>
                      <span
                        className={`job-timer ${remainingSeconds != null && remainingSeconds <= 60 ? 'urgent' : ''}`}
                      >
                        {remainingSeconds != null
                          ? `Осталось: ${formatTime(remainingSeconds)}`
                          : ''}
                      </span>
                      <button className="btn btn-danger" onClick={abortRunning}>
                        Остановить
                      </button>
                    </>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {jobs.length > 0 && !configured && (
        <div id="configWarn" className="card warn-card" style={{ marginTop: '12px' }}>
          <span className="warn-icon">⚠</span>
          <div className="warn-content">
            API нейросети не настроен. Перейдите во вкладку <strong>«Настройки»</strong> и укажите
            адрес, ключ и модель.
          </div>
        </div>
      )}
    </section>
  );
};
