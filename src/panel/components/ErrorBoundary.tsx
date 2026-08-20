import { Component, ErrorInfo, ReactNode } from 'react';
import { APP_VERSION } from '../../core/version';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
  errorInfo: ErrorInfo | null;
  copied: boolean;
}

export class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    error: null,
    errorInfo: null,
    copied: false
  };

  public static getDerivedStateFromError(error: Error): Partial<State> {
    return { hasError: true, error, errorInfo: null };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('[hh-assist:panel] Uncaught render error:', error, errorInfo);
    this.setState({ error, errorInfo });
  }

  private handleReset = () => {
    this.setState({ hasError: false, error: null, errorInfo: null, copied: false });
  };

  private handleReload = () => {
    try {
      if (typeof chrome !== 'undefined' && chrome?.runtime?.reload) {
        chrome.runtime.reload();
      } else {
        window.location.reload();
      }
    } catch {
      window.location.reload();
    }
  };

  private handleCopy = () => {
    const timeStr = new Date().toLocaleString('ru-RU');
    const ua = typeof navigator !== 'undefined' ? navigator.userAgent : 'Unknown';
    const text = [
      `=== HH-ASSIST PANEL CRASH REPORT ===`,
      `Версия: v${APP_VERSION}`,
      `Время: ${timeStr}`,
      `User-Agent: ${ua}`,
      `\n--- [ERROR] ---\n${this.state.error?.name || 'Error'}: ${this.state.error?.message || String(this.state.error)}`,
      `\n--- [STACK TRACE] ---\n${this.state.error?.stack || 'No stack trace'}`,
      `\n--- [COMPONENT STACK] ---\n${this.state.errorInfo?.componentStack || 'No component stack'}`
    ].join('\n');

    navigator.clipboard?.writeText(text);
    this.setState({ copied: true });
    setTimeout(() => this.setState({ copied: false }), 2000);
  };

  public render() {
    if (this.state.hasError) {
      const errorName = this.state.error?.name || 'RenderError';
      const errorMessage =
        this.state.error?.message || String(this.state.error || 'Неизвестная ошибка рендера');
      const stack = this.state.error?.stack;
      const componentStack = this.state.errorInfo?.componentStack;

      return (
        <div className="crash-screen">
          {/* Header Card */}
          <div className="crash-header">
            <div className="crash-icon-box">
              <svg
                viewBox="0 0 24 24"
                width="14"
                height="14"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.2"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z"
                />
              </svg>
            </div>
            <div className="crash-title-group">
              <div className="crash-title-row">
                <span className="crash-title">Сбой рендера панели: hh-assist v{APP_VERSION}</span>
              </div>
              <div className="crash-subtitle">Непредвиденная ошибка отрисовки интерфейса</div>
            </div>
          </div>

          {/* Error Message Box */}
          <div className="crash-error-box">
            <div className="crash-error-name">{errorName}</div>
            <div className="crash-error-msg">{errorMessage}</div>
          </div>

          {/* Toolbar Actions */}
          <div className="toolbar crash-toolbar">
            <button
              className="btn btn-primary"
              onClick={this.handleReset}
              data-tooltip="Восстановить рендер"
            >
              <svg
                className="btn-icon"
                viewBox="0 0 16 16"
                width="10"
                height="10"
                fill="currentColor"
              >
                <path d="M11.534 7h3.932a.25.25 0 0 1 .192.41l-1.966 2.36a.25.25 0 0 1-.384 0l-1.966-2.36a.25.25 0 0 1 .192-.41zm-11 2h3.932a.25.25 0 0 0 .192-.41L2.692 6.23a.25.25 0 0 0-.384 0L.342 8.59A.25.25 0 0 0 .534 9z" />
                <path
                  fillRule="evenodd"
                  d="M8 3c-1.552 0-2.94.707-3.857 1.818a.5.5 0 1 1-.771-.636A6.002 6.002 0 0 1 13.917 7H12.9A5.002 5.002 0 0 0 8 3zM3.1 9a5.002 5.002 0 0 0 8.757 2.182.5.5 0 1 1 .771.636A6.002 6.002 0 0 1 2.083 9H3.1z"
                />
              </svg>
              <span>Повторить</span>
            </button>

            <button
              className="btn btn-secondary"
              onClick={this.handleReload}
              data-tooltip="Перезапустить расширение"
            >
              <svg
                className="btn-icon"
                viewBox="0 0 16 16"
                width="10"
                height="10"
                fill="currentColor"
              >
                <path d="M13.5 8a5.5 5.5 0 1 1-1.6-3.9l1.6-1.6V7h-4.5l1.8-1.8A7 7 0 1 0 15 8z" />
              </svg>
              <span>Перезапустить</span>
            </button>

            <button
              className={`btn btn-secondary ${this.state.copied ? 'btn-success-flash' : ''}`}
              onClick={this.handleCopy}
              data-tooltip="Скопировать отчёт об ошибке"
            >
              <svg
                className="btn-icon"
                viewBox="0 0 16 16"
                width="10"
                height="10"
                fill="currentColor"
              >
                <path d="M4 2a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V4a2 2 0 0 0-2-2h-1.2A2 2 0 0 0 9 1H7a2 2 0 0 0-1.8 1zm3 0a1 1 0 0 1 1-1h0a1 1 0 0 1 1 1v.5H7zm-3 2h1.2A2 2 0 0 0 7 5.5h2A2 2 0 0 0 10.8 4H12a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1z" />
              </svg>
              <span>{this.state.copied ? 'Скопировано!' : 'Скопировать'}</span>
            </button>
          </div>

          {/* Two Non-Collapsible Scrollable Blocks */}
          {stack && (
            <div className="crash-block">
              <div className="crash-block-header">Стек вызовов</div>
              <div className="crash-block-body">
                <pre className="crash-stack-code">{stack}</pre>
              </div>
            </div>
          )}

          {componentStack && (
            <div className="crash-block">
              <div className="crash-block-header">Иерархия компонентов</div>
              <div className="crash-block-body">
                <pre className="crash-stack-code">{componentStack.trim()}</pre>
              </div>
            </div>
          )}
        </div>
      );
    }

    return this.props.children;
  }
}
