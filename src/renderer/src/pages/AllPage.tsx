// Browse everyone: search, filter by stage, expand a row for the full log
// and actions. Import and sync-retry live here too.
import { useMemo, useState } from 'react';
import type { Contact, Stage, SyncStatus } from '../../../shared/types';
import { ALL_STAGES, STAGES } from '../../../shared/stages';
import { daysSince, formatLogLine, formatShort } from '../../../shared/dates';
import { api, isDesktop } from '../lib/api';
import Avatar from '../components/Avatar';
import StageBadge from '../components/StageBadge';
import EmptyState from '../components/EmptyState';
import ActionButtons from '../components/ActionButtons';

interface Props {
  contacts: Contact[];
  syncStatus: SyncStatus | null;
  refresh: () => Promise<void>;
}

export default function AllPage({ contacts, syncStatus, refresh }: Props) {
  const [query, setQuery] = useState('');
  const [stageFilter, setStageFilter] = useState<Stage | 'all'>('all');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [busy, setBusy] = useState<'import' | 'retry' | null>(null);
  const [notice, setNotice] = useState('');

  const countByStage = useMemo(() => {
    const counts = new Map<Stage, number>();
    for (const contact of contacts) {
      counts.set(contact.stage, (counts.get(contact.stage) ?? 0) + 1);
    }
    return counts;
  }, [contacts]);

  const shown = contacts
    .filter((c) => stageFilter === 'all' || c.stage === stageFilter)
    .filter((c) => query === '' || c.name.toLowerCase().includes(query.toLowerCase()))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));

  const errorCount = contacts.filter((c) => c.sync.state === 'error').length;

  async function runImport(): Promise<void> {
    setBusy('import');
    const result = await api.importFromTeamHub();
    setBusy(null);
    setNotice(result.message);
    if (result.ok) await refresh();
  }

  async function runRetry(): Promise<void> {
    setBusy('retry');
    const result = await api.retryFailedSyncs();
    setBusy(null);
    setNotice(`Retried: ${result.fixed} fixed, ${result.remaining} still failing.`);
    await refresh();
  }

  async function act(contactId: string, actionId: string): Promise<void> {
    await api.applyAction(contactId, actionId);
    await refresh();
  }

  async function removeDraft(contactId: string): Promise<void> {
    await api.deleteDraft(contactId);
    setExpandedId(null);
    await refresh();
  }

  async function toggleFlag(contactId: string, needsReply: boolean): Promise<void> {
    await api.setNeedsReply(contactId, needsReply);
    await refresh();
  }

  return (
    <div className="page-inner wide">
      <h1 className="page-title">All contacts</h1>
      <p className="page-sub">{syncStatus?.message ?? ''}</p>

      <div className="toolbar">
        <input
          type="text"
          placeholder="Search by name..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <button
          className={`filter-chip ${stageFilter === 'all' ? 'active' : ''}`}
          onClick={() => setStageFilter('all')}
        >
          All <span className="n">{contacts.length}</span>
        </button>
        {ALL_STAGES.map((stage) => {
          const count = countByStage.get(stage) ?? 0;
          if (count === 0) return null;
          return (
            <button
              key={stage}
              className={`filter-chip ${stageFilter === stage ? 'active' : ''}`}
              onClick={() => setStageFilter(stage)}
            >
              {STAGES[stage].label} <span className="n">{count}</span>
            </button>
          );
        })}
        <span className="spacer" />
        {isDesktop && (
          <>
            {errorCount > 0 && (
              <button className="btn small" disabled={busy !== null} onClick={() => void runRetry()}>
                {busy === 'retry' ? 'Retrying...' : `Retry sync (${errorCount})`}
              </button>
            )}
            <button className="btn small" disabled={busy !== null} onClick={() => void runImport()}>
              {busy === 'import' ? 'Importing...' : 'Import from Team Hub'}
            </button>
          </>
        )}
      </div>

      {notice && <div className="banner neutral" style={{ marginBottom: 14 }}>{notice}</div>}

      {shown.length === 0 ? (
        <div className="card">
          <EmptyState title="No contacts here">
            Add someone from the Add tab, or import your existing board.
          </EmptyState>
        </div>
      ) : (
        shown.map((contact) => {
          const expanded = expandedId === contact.id;
          return (
            <div key={contact.id}>
              <div
                className="contact-row"
                onClick={() => setExpandedId(expanded ? null : contact.id)}
              >
                <Avatar name={contact.name} size={36} />
                <div className="grow">
                  <div className="name">{contact.name}</div>
                  <div className="meta">
                    {contact.needsReply
                      ? 'Waiting on your reply'
                      : contact.followUpDate
                        ? `Follow up ${formatShort(contact.followUpDate)}`
                        : lastActivity(contact)}
                  </div>
                </div>
                <StageBadge stage={contact.stage} />
                <span
                  className={`sync-dot ${contact.sync.state}`}
                  title={syncTitle(contact)}
                />
                <span className="when">{formatShort(contact.updatedAt.slice(0, 10))}</span>
              </div>

              {expanded && (
                <div className="contact-detail">
                  <div className="links">
                    {contact.linkedinUrl && (
                      <a href={contact.linkedinUrl} target="_blank" rel="noreferrer">
                        LinkedIn profile
                      </a>
                    )}
                    {contact.websiteUrl && (
                      <a href={contact.websiteUrl} target="_blank" rel="noreferrer">
                        Website
                      </a>
                    )}
                  </div>

                  {contact.history.length > 0 && (
                    <div className="log">
                      {[...contact.history].reverse().map((entry, index) => (
                        <div key={index} className="line">
                          {formatLogLine(entry)}
                        </div>
                      ))}
                    </div>
                  )}

                  {contact.importedNotes && <div className="notes">{contact.importedNotes}</div>}

                  <div className="actions">
                    <ActionButtons contact={contact} onAct={(id) => void act(contact.id, id)} compact />
                    {contact.stage !== 'draft' && !STAGES[contact.stage].terminal && (
                      <button
                        className="btn small"
                        onClick={() => void toggleFlag(contact.id, !contact.needsReply)}
                      >
                        {contact.needsReply ? 'Clear reply flag' : 'Flag: needs my reply'}
                      </button>
                    )}
                    {contact.stage === 'draft' && (
                      <button className="btn small danger" onClick={() => void removeDraft(contact.id)}>
                        Delete draft
                      </button>
                    )}
                  </div>

                  {contact.sync.state === 'error' && (
                    <div className="sync-error">Sync failed: {contact.sync.message}</div>
                  )}
                </div>
              )}
            </div>
          );
        })
      )}
    </div>
  );
}

function lastActivity(contact: Contact): string {
  const last = contact.history[contact.history.length - 1];
  if (!last) return 'No activity yet';
  const days = daysSince(last.date);
  if (days === 0) return 'Active today';
  if (days === 1) return 'Active yesterday';
  return `Active ${days} days ago`;
}

function syncTitle(contact: Contact): string {
  switch (contact.sync.state) {
    case 'synced':
      return 'Synced with Team Hub';
    case 'error':
      return `Sync failed: ${contact.sync.message ?? 'unknown error'}`;
    default:
      return contact.stage === 'draft' ? 'Draft, local only' : 'Not synced yet';
  }
}
