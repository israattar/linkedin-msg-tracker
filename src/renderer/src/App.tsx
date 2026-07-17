// App shell: top bar with the three tabs and the Team Hub status pill.
// Contacts and the queue are loaded here once and shared with every page.
import { useCallback, useEffect, useState } from 'react';
import type { Contact, QueueItem, SyncStatus } from '../../shared/types';
import { api } from './lib/api';
import FocusPage from './pages/FocusPage';
import ReplyPage from './pages/ReplyPage';
import AddPage from './pages/AddPage';
import AllPage from './pages/AllPage';
import AnalyticsPage from './pages/AnalyticsPage';

type Page = 'focus' | 'reply' | 'add' | 'all' | 'analytics';

export default function App() {
  const [page, setPage] = useState<Page>('focus');
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [syncStatus, setSyncStatus] = useState<SyncStatus | null>(null);

  const refresh = useCallback(async () => {
    const [nextContacts, nextQueue, nextStatus] = await Promise.all([
      api.listContacts(),
      api.getQueue(),
      api.getSyncStatus(),
    ]);
    setContacts(nextContacts);
    setQueue(nextQueue);
    setSyncStatus(nextStatus);
  }, []);

  useEffect(() => {
    void refresh();
    // Clicking the daily reminder notification lands on the Focus tab.
    return api.onFocusRequested(() => setPage('focus'));
  }, [refresh]);

  const pill = pillState(syncStatus);
  const replyCount = contacts.filter(
    (c) => c.stage === 'connected' || (c.stage !== 'draft' && c.needsReply),
  ).length;

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="mark" />
          Outreach
        </div>
        <nav className="tabs">
          <TabButton id="focus" label="Focus" page={page} onSelect={setPage} count={queue.length} />
          <TabButton id="reply" label="Reply" page={page} onSelect={setPage} count={replyCount} />
          <TabButton id="add" label="Add" page={page} onSelect={setPage} />
          <TabButton id="all" label="All" page={page} onSelect={setPage} />
          <TabButton id="analytics" label="Analytics" page={page} onSelect={setPage} />
        </nav>
        <div className={`sync-pill ${pill.tone}`} title={syncStatus?.message ?? ''}>
          <span className="led" />
          {pill.text}
        </div>
      </header>

      <main className="page">
        {page === 'focus' && <FocusPage contacts={contacts} queue={queue} refresh={refresh} />}
        {page === 'reply' && <ReplyPage contacts={contacts} refresh={refresh} />}
        {page === 'add' && <AddPage contacts={contacts} refresh={refresh} />}
        {page === 'all' && <AllPage contacts={contacts} syncStatus={syncStatus} refresh={refresh} />}
        {page === 'analytics' && <AnalyticsPage contacts={contacts} />}
      </main>
    </div>
  );
}

interface TabProps {
  id: Page;
  label: string;
  page: Page;
  onSelect: (page: Page) => void;
  count?: number;
}

function TabButton({ id, label, page, onSelect, count }: TabProps) {
  return (
    <button className={`tab ${page === id ? 'active' : ''}`} onClick={() => onSelect(id)}>
      {label}
      {count !== undefined && count > 0 && <span className="count">{count}</span>}
    </button>
  );
}

function pillState(status: SyncStatus | null): { tone: string; text: string } {
  if (!status) return { tone: '', text: 'Connecting' };
  if (!status.configured) return { tone: '', text: 'Team Hub off' };
  if (status.errorCount > 0) return { tone: 'error', text: `${status.errorCount} sync errors` };
  if (!status.slotsMapped && status.unmappedStages.length > 0) {
    return { tone: 'error', text: 'Columns missing' };
  }
  return { tone: 'ok', text: 'Team Hub' };
}
