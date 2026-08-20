import React from 'react';
import { useSessionStore } from '../store/useSessionStore';
import { getAppVersion } from '../services/extension';

export const Header: React.FC = () => {
  const { session, loading } = useSessionStore();
  const version = getAppVersion();

  let stateText = 'Проверка...';
  let stateClass = 'session-state';
  let dotClass = 'status-dot';
  let detailText = '';

  if (!loading && session) {
    if (session.error) {
      stateText = 'Ошибка';
      stateClass = 'session-state error';
      dotClass = 'status-dot error';
    } else if (session.loggedIn) {
      stateText = 'Авторизован';
      stateClass = 'session-state ok';
      dotClass = 'status-dot ok';
      if (session.userId) {
        detailText = `ID ${session.userId}`;
      }
    } else {
      stateText = 'Не авторизован';
      stateClass = 'session-state error';
      dotClass = 'status-dot error';
    }
  }

  return (
    <header className="app-header">
      <div className="brand">
        <span className="brand-logo"></span>
        <h1 className="brand-title">hh-assist</h1>
        <span className="ver-badge" id="ver">
          {version}
        </span>
      </div>
      <div
        id="sessionHeader"
        className="session-badge"
        data-tooltip={
          session?.loggedIn ? 'Авторизован на hh.ru' : 'Не авторизован (нажмите для проверки)'
        }
        style={{ cursor: session?.loggedIn ? 'default' : 'pointer' }}
        onClick={session?.loggedIn ? undefined : () => useSessionStore.getState().checkSession()}
      >
        <span id="sessionDot" className={dotClass}></span>
        <span id="sessionState" className={stateClass}>
          {stateText}
        </span>
        {detailText && (
          <span id="sessionDetail" className="session-detail">
            {detailText}
          </span>
        )}
      </div>
    </header>
  );
};
