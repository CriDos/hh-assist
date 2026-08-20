import React from 'react';

export type TabId = 'status' | 'tests' | 'log' | 'llm' | 'debug' | 'settings';

interface TabsNavProps {
  activeTab: TabId;
  onSelectTab: (tab: TabId) => void;
}

const TABS: { id: TabId; label: string }[] = [
  { id: 'status', label: 'Очередь' },
  { id: 'tests', label: 'Тесты' },
  { id: 'log', label: 'Лог' },
  { id: 'llm', label: 'Контекст' },
  { id: 'debug', label: 'Сеть' },
  { id: 'settings', label: 'Настройки' }
];

export const TabsNav: React.FC<TabsNavProps> = ({ activeTab, onSelectTab }) => {
  return (
    <nav className="tabs-nav" aria-label="Разделы">
      {TABS.map(tab => (
        <button
          key={tab.id}
          data-tab={tab.id}
          className={`tab-btn ${activeTab === tab.id ? 'active' : ''}`}
          onClick={() => onSelectTab(tab.id)}
        >
          {tab.label}
        </button>
      ))}
    </nav>
  );
};
