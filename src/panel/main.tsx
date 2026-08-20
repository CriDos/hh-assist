import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './App';
import { ErrorBoundary } from './components/ErrorBoundary';
import { Tooltip } from './components/Tooltip';
import './panel.css';

window.addEventListener('error', event => {
  console.error('[hh-assist:panel window error]', event.error || event.message);
});

window.addEventListener('unhandledrejection', event => {
  console.error('[hh-assist:panel unhandled promise rejection]', event.reason);
});

const rootElement = document.getElementById('root');
if (rootElement) {
  ReactDOM.createRoot(rootElement).render(
    <React.StrictMode>
      <ErrorBoundary>
        <App />
      </ErrorBoundary>
      <Tooltip />
    </React.StrictMode>
  );
}
