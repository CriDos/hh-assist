import React from 'react';
import { useSettingsStore } from '../../store/useSettingsStore';
import { PRESET_PROVIDERS } from '../../../core/models.ts';

export const SettingsTab: React.FC = () => {
  const {
    baseUrl,
    apiKey,
    model,
    reasoning,
    models,
    reasoningOptions,
    loadingModels,
    selectedPresetId,
    timingSavedFlash,
    profileHint,
    apiTestStatus,
    timings,
    profiles,
    selectedProfileId,
    setBaseUrl,
    setApiKey,
    setModel,
    setReasoning,
    selectPreset,
    setTimingField,
    saveApi,
    testApi,
    refreshModels,
    saveTimings,
    resetTimings,
    selectProfile,
    createProfile,
    recreateProfile,
    deleteProfile
  } = useSettingsStore();

  const toSec = (ms: number) => Math.round(Number(ms || 0) / 1000);

  return (
    <section id="tab-settings" className="tab-body active">
      {/* 1. LLM API */}
      <div className="card settings-card">
        <h2 className="card-heading">Нейросеть (LLM API)</h2>

        <label className="form-group">
          <span className="label-text">Провайдер</span>
          <select
            id="providerPreset"
            value={selectedPresetId}
            onChange={e => selectPreset(e.target.value)}
          >
            {PRESET_PROVIDERS.map((p: any) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>

        <label className="form-group">
          <span className="label-text">Base URL (Адрес API)</span>
          <input
            id="baseUrl"
            type="text"
            placeholder="https://api.openai.com/v1"
            spellCheck={false}
            value={baseUrl}
            onChange={e => setBaseUrl(e.target.value)}
          />
        </label>

        <label className="form-group">
          <span className="label-text">API-ключ</span>
          <input
            id="apiKey"
            type="password"
            placeholder="sk-..."
            spellCheck={false}
            value={apiKey}
            onChange={e => setApiKey(e.target.value)}
          />
        </label>

        <label className="form-group">
          <span className="label-text">Модель</span>
          <div className="input-with-button">
            <select id="model" value={model} onChange={e => setModel(e.target.value)}>
              {!models.length && <option value="">не выбрана</option>}
              {models.map(m => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
            <button
              id="loadModelsBtn"
              className="btn btn-secondary"
              data-tooltip="Обновить список моделей"
              disabled={loadingModels}
              onClick={() => refreshModels(true)}
            >
              {loadingModels ? 'Обновление…' : 'Обновить'}
            </button>
          </div>
        </label>

        <label className="form-group">
          <span className="label-text">Рассуждения (Reasoning)</span>
          <select id="reasoning" value={reasoning} onChange={e => setReasoning(e.target.value)}>
            <option value="">по умолчанию (не передавать)</option>
            {reasoningOptions.map(effort => (
              <option key={effort} value={effort}>
                {effort}
              </option>
            ))}
          </select>
        </label>

        <div className="card-actions">
          <button id="saveApiBtn" className="btn btn-primary" onClick={saveApi}>
            Сохранить
          </button>
          <button
            id="testApiBtn"
            className="btn btn-secondary"
            data-tooltip="Проверить подключение к API"
            disabled={apiTestStatus.status === 'testing'}
            onClick={testApi}
          >
            Проверить API
          </button>
          {apiTestStatus.message && (
            <span id="apiTestStatus" className={`inline-status ${apiTestStatus.status}`}>
              {apiTestStatus.message}
            </span>
          )}
        </div>
      </div>

      {/* 2. Timings */}
      <div className="card settings-card">
        <h2 className="card-heading">Задержки и тайминги</h2>

        <div className="timing-group">
          <div className="timing-group-title">
            <span className="timing-group-icon">📘</span> Теория (вопросы)
          </div>
          <div className="timing-row">
            <span className="timing-label">Перед ответом</span>
            <span className="timing-dots"></span>
            <div className="range-inputs">
              <input
                id="theoryAnswerMinMs"
                type="number"
                min="0"
                step="1"
                value={toSec(timings.theory.answerMinMs)}
                onChange={e => setTimingField('theory.answerMinMs', Number(e.target.value))}
              />
              <span className="range-dash">—</span>
              <input
                id="theoryAnswerMaxMs"
                type="number"
                min="0"
                step="1"
                value={toSec(timings.theory.answerMaxMs)}
                onChange={e => setTimingField('theory.answerMaxMs', Number(e.target.value))}
              />
              <span className="range-unit">сек</span>
            </div>
          </div>

          <div className="timing-row">
            <span className="timing-label">Между вопросами</span>
            <span className="timing-dots"></span>
            <div className="range-inputs">
              <input
                id="theoryBetweenMinMs"
                type="number"
                min="0"
                step="1"
                value={toSec(timings.theory.betweenMinMs)}
                onChange={e => setTimingField('theory.betweenMinMs', Number(e.target.value))}
              />
              <span className="range-dash">—</span>
              <input
                id="theoryBetweenMaxMs"
                type="number"
                min="0"
                step="1"
                value={toSec(timings.theory.betweenMaxMs)}
                onChange={e => setTimingField('theory.betweenMaxMs', Number(e.target.value))}
              />
              <span className="range-unit">сек</span>
            </div>
          </div>
        </div>

        <div className="timing-group">
          <div className="timing-group-title">
            <span className="timing-group-icon">💻</span> Практика (код)
          </div>
          <div className="timing-row">
            <span className="timing-label">Печать решения</span>
            <span className="timing-dots"></span>
            <div className="range-inputs">
              <input
                id="practiceTypingMinMs"
                type="number"
                min="0"
                step="1"
                value={toSec(timings.practice.typingMinMs)}
                onChange={e => setTimingField('practice.typingMinMs', Number(e.target.value))}
              />
              <span className="range-dash">—</span>
              <input
                id="practiceTypingMaxMs"
                type="number"
                min="0"
                step="1"
                value={toSec(timings.practice.typingMaxMs)}
                onChange={e => setTimingField('practice.typingMaxMs', Number(e.target.value))}
              />
              <span className="range-unit">сек</span>
            </div>
          </div>

          <div className="timing-row">
            <span className="timing-label">Печать исправлений</span>
            <span className="timing-dots"></span>
            <div className="range-inputs">
              <input
                id="practiceRetryTypingMinMs"
                type="number"
                min="0"
                step="1"
                value={toSec(timings.practice.retryTypingMinMs)}
                onChange={e => setTimingField('practice.retryTypingMinMs', Number(e.target.value))}
              />
              <span className="range-dash">—</span>
              <input
                id="practiceRetryTypingMaxMs"
                type="number"
                min="0"
                step="1"
                value={toSec(timings.practice.retryTypingMaxMs)}
                onChange={e => setTimingField('practice.retryTypingMaxMs', Number(e.target.value))}
              />
              <span className="range-unit">сек</span>
            </div>
          </div>
        </div>

        <div className="timing-group">
          <div className="timing-group-title">
            <span className="timing-group-icon">⏱</span> Очередь тестов
          </div>
          <div className="timing-row">
            <span className="timing-label">Между тестами</span>
            <span className="timing-dots"></span>
            <div className="range-inputs">
              <input
                id="betweenTestsMinMs"
                type="number"
                min="0"
                step="1"
                value={toSec(timings.betweenTestsMinMs)}
                onChange={e => setTimingField('betweenTestsMinMs', Number(e.target.value))}
              />
              <span className="range-dash">—</span>
              <input
                id="betweenTestsMaxMs"
                type="number"
                min="0"
                step="1"
                value={toSec(timings.betweenTestsMaxMs)}
                onChange={e => setTimingField('betweenTestsMaxMs', Number(e.target.value))}
              />
              <span className="range-unit">сек</span>
            </div>
          </div>
        </div>

        <div className="card-actions">
          <button id="saveTimingBtn" className="btn btn-primary" onClick={saveTimings}>
            Сохранить
          </button>
          <button id="timingResetBtn" className="btn btn-secondary" onClick={resetTimings}>
            По умолчанию
          </button>
          {timingSavedFlash && (
            <span id="timingSaved" className="inline-feedback">
              Сохранено
            </span>
          )}
        </div>
      </div>

      {/* 3. Fingerprint Profiles */}
      <div className="card settings-card">
        <h2 className="card-heading">Фингерпринт (Профиль)</h2>
        <label className="form-group">
          <span className="label-text">Активный профиль</span>
          <select
            id="profileSelect"
            value={selectedProfileId}
            onChange={e => selectProfile(e.target.value)}
          >
            {profiles.map(p => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </select>
        </label>

        <div className="card-actions">
          <button
            id="recreateProfileBtn"
            className="btn btn-secondary"
            data-tooltip="Перегенерировать текущий профиль"
            onClick={recreateProfile}
          >
            Перегенерировать
          </button>
          <button
            id="newProfileBtn"
            className="btn btn-secondary"
            data-tooltip="Создать новый профиль"
            onClick={createProfile}
          >
            <svg
              className="btn-icon"
              viewBox="0 0 16 16"
              width="10"
              height="10"
              fill="currentColor"
            >
              <path
                d="M8 2v12M2 8h12"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
              />
            </svg>
            <span>Новый</span>
          </button>
          <button
            id="deleteProfileBtn"
            className="btn btn-danger"
            data-tooltip={
              profiles.length <= 1
                ? 'Нельзя удалить единственный профиль'
                : 'Удалить текущий профиль'
            }
            disabled={profiles.length <= 1}
            onClick={() => deleteProfile(selectedProfileId)}
          >
            Удалить
          </button>
          {profileHint && (
            <span id="profileHint" className="inline-feedback">
              {profileHint}
            </span>
          )}
        </div>
      </div>
    </section>
  );
};
