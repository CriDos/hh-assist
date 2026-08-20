import React, { useEffect, useState } from 'react';
import { Header } from './components/Header';
import { TabsNav, TabId } from './components/TabsNav';
import { QueueTab } from './components/tabs/QueueTab';
import { TestsTab } from './components/tabs/TestsTab';
import { LogTab } from './components/tabs/LogTab';
import { LlmTab } from './components/tabs/LlmTab';
import { DebugTab } from './components/tabs/DebugTab';
import { SettingsTab } from './components/tabs/SettingsTab';

import { useSessionStore } from './store/useSessionStore';
import { useQueueStore } from './store/useQueueStore';
import { useTestsStore } from './store/useTestsStore';
import { useLogStore } from './store/useLogStore';
import { useLlmStore } from './store/useLlmStore';
import { useSettingsStore } from './store/useSettingsStore';
import { useNetLogStore } from './store/useNetLogStore';

export const App: React.FC = () => {
  const [activeTab, setActiveTab] = useState<TabId>('status');

  useEffect(() => {
    // 1. Initial data loads
    useSessionStore.getState().checkSession();
    useSettingsStore.getState().loadConfig();
    useQueueStore.getState().refreshStatus();
    useLogStore.getState().loadHistory();
    useLlmStore.getState().refreshLlm();
    useTestsStore.getState().loadTests();
    useNetLogStore.getState().refreshNetLog();

    // Wire on queue idle reload
    useQueueStore.getState().addOnIdleCallback(() => {
      useTestsStore.getState().loadTests();
    });

    // 2. Port live connection
    let port: chrome.runtime.Port | null = null;
    let reconnectTimeout: any = null;

    function connect() {
      if (typeof chrome === 'undefined' || !chrome.runtime?.connect) return;
      try {
        port = chrome.runtime.connect({ name: 'hh-panel' });
        port.onMessage.addListener((message: any) => {
          if (message.type === 'solver') {
            if (message.event?.type === 'log') {
              useLogStore
                .getState()
                .appendLog(message.event.level, message.event.message, message.event.ts);
            }
            if (message.event?.type === 'llm-context' || message.event?.type === 'llm-response') {
              useLlmStore.getState().refreshLlm();
            }
          }
        });
        port.onDisconnect.addListener(() => {
          reconnectTimeout = setTimeout(connect, 2000);
        });
      } catch {
        reconnectTimeout = setTimeout(connect, 2000);
      }
    }

    connect();

    // 3. Polling & Keep-Alive intervals
    const statusInterval = setInterval(() => {
      useQueueStore.getState().refreshStatus();
    }, 2000);

    const timerInterval = setInterval(() => {
      useQueueStore.getState().tickTimer();
    }, 1000);

    const netLogInterval = setInterval(() => {
      useNetLogStore.getState().refreshNetLog();
    }, 2000);

    // Keep-Alive heartbeat to Service Worker
    const pingInterval = setInterval(() => {
      try {
        if (port) port.postMessage({ type: 'ping' });
      } catch {}
    }, 15000);

    return () => {
      clearInterval(statusInterval);
      clearInterval(timerInterval);
      clearInterval(netLogInterval);
      clearInterval(pingInterval);
      if (reconnectTimeout) clearTimeout(reconnectTimeout);
      if (port) {
        try {
          port.disconnect();
        } catch {}
      }
    };
  }, []);

  const handleSelectTab = (tab: TabId) => {
    setActiveTab(tab);
    if (tab === 'tests') useTestsStore.getState().loadTests();
    if (tab === 'llm') useLlmStore.getState().refreshLlm();
    if (tab === 'debug') useNetLogStore.getState().refreshNetLog();
  };

  return (
    <>
      <Header />
      <TabsNav activeTab={activeTab} onSelectTab={handleSelectTab} />

      <main>
        {activeTab === 'status' && (
          <QueueTab
            onGoToTests={() => handleSelectTab('tests')}
            onGoToSettings={() => handleSelectTab('settings')}
          />
        )}
        {activeTab === 'tests' && <TestsTab onTestsStarted={() => handleSelectTab('status')} />}
        {activeTab === 'log' && <LogTab />}
        {activeTab === 'llm' && <LlmTab />}
        {activeTab === 'debug' && <DebugTab />}
        {activeTab === 'settings' && <SettingsTab />}
      </main>
    </>
  );
};
