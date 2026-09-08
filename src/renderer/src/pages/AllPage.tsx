// Browse everyone: search and filter by stage over a plain list of rows.
// Clicking a row opens that one contact in a modal with the full log, notes,
// actions and delete. Import and sync-retry live here too.
import { useEffect, useMemo, useState } from 'react';
import type { Contact, Stage, SyncStatus } from '../../../shared/types';
import { ALL_STAGES, messagesSentLabel, STAGES } from '../../../shared/stages';
import { daysSince, formatLogLine, formatShort } from '../../../shared/dates';
import { api, isDesktop } from '../lib/api';
import Avatar from '../components/Avatar';
import StageBadge from '../components/StageBadge';
import EmptyState from '../components/EmptyState';
import ActionButtons from '../components/ActionButtons';
import NotesBox from '../components/NotesBox';

interface Props {
  contacts: Contact[];
  syncStatus: SyncStatus | null;
  refresh: () => Promise<void>;
}

export default function AllPage({ contacts, syncStatus, refresh }: Props) {
  const [query, setQuery] = useState('');
  const [stageFilter, setStageFilter] = useState<Stage | 'all'>('all');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [busy, setBusy] = useState<'import' | 'retry' | null>(null);
  const [notice, setNotice] = useState('');

  const selected = contacts.find((c) => c.id === selectedId) ?? null;

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

  async function act(contactId: string, actionId: string, followUpDate?: string): Promise<void> {
    await api.applyAction(contactId, actionId, followUpDate);
    await refresh();
  }

  async function removeDraft(contactId: string): Promise<void> {
    await api.deleteDraft(contactId);
    setSelectedId(null);
    await refresh();
  }

  async function removeContact(contactId: string): Promise<void> {
    await api.deleteContact(contactId);
    setSelectedId(null);
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
        shown.map((contact) => (
          <div
            key={contact.id}
            className={`contact-row ${contact.needsReply ? 'needs-reply' : ''}`}
            onClick={() => setSelectedId(contact.id)}
          >
            <Avatar name={contact.name} size={36} />
            <div className="grow">
              <div className="name">{contact.name}</div>
              <div className="meta">
                {/* How far into the chase they are is the useful fact for
                    anyone still awaiting a reply. */}
                {contact.stage === 'awaiting-reply'
                  ? `${messagesSentLabel(contact.messagesSent)} - ${lastActivity(contact)}`
                  : contact.needsReply
                    ? 'Waiting on your reply'
                    : contact.followUpDate
                      ? `Follow up ${formatShort(contact.followUpDate)}`
                      : lastActivity(contact)}
              </div>
            </div>
            {contact.meetingHeldDate && <span className="chip">Met</span>}
            {contact.proposalSentDate && <span className="chip win">Proposal</span>}
            <StageBadge stage={contact.stage} />
            <span className={`sync-dot ${contact.sync.state}`} title={syncTitle(contact)} />
            <span className="when">{formatShort(contact.updatedAt.slice(0, 10))}</span>
          </div>
        ))
      )}

      {selected && (
        <ContactModal
          contact={selected}
          onClose={() => setSelectedId(null)}
          onAct={(id, followUpDate) => void act(selected.id, id, followUpDate)}
          onToggleFlag={() => void toggleFlag(selected.id, !selected.needsReply)}
          onDeleteDraft={() => void removeDraft(selected.id)}
          onDeleteContact={() => void removeContact(selected.id)}
        />
      )}
    </div>
  );
}

interface ModalProps {
  contact: Contact;
  onClose: () => void;
  onAct: (actionId: string, followUpDate?: string) => void;
  onToggleFlag: () => void;
  onDeleteDraft: () => void;
  onDeleteContact: () => void;
}

// The full detail view for one contact, opened by clicking its row - a clear
// "you are now looking at this one specific contact" state, with the delete
// action tucked behind a confirm step since it cannot be undone.
function ContactModal({ contact, onClose, onAct, onToggleFlag, onDeleteDraft, onDeleteContact }: ModalProps) {
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  useEffect(() => {
    setConfirmingDelete(false);
  }, [contact.id]);

  useEffect(() => {
    function onKey(e: KeyboardEvent): void {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const isLocalDraft = contact.stage === 'draft' && !contact.teamhubTaskId;

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-card" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <Avatar name={contact.name} size={40} />
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
          <button className="modal-close" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>

        <div className="modal-body">
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

          <div className="fact-row">
            <span className="chip">{messagesSentLabel(contact.messagesSent)}</span>
            {contact.meetingHeldDate && (
              <span className="chip">Met {formatShort(contact.meetingHeldDate)}</span>
            )}
            {contact.proposalSentDate && (
              <span className="chip win">Proposal {formatShort(contact.proposalSentDate)}</span>
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

          <NotesBox contact={contact} />

          <div className="actions">
            <ActionButtons contact={contact} onAct={onAct} compact />
            {contact.stage !== 'draft' && !STAGES[contact.stage].terminal && (
              <button className="btn small" onClick={onToggleFlag}>
                {contact.needsReply ? 'Clear reply flag' : 'Flag: needs my reply'}
              </button>
            )}
          </div>

          {contact.sync.state === 'error' && (
            <div className="sync-error">Sync failed: {contact.sync.message}</div>
          )}

          <div className="modal-danger">
            {isLocalDraft ? (
              <button className="btn small danger" onClick={onDeleteDraft}>
                Delete draft
              </button>
            ) : confirmingDelete ? (
              <>
                <span className="faint-text">
                  Removes {contact.name} from the tracker only
                  {contact.teamhubTaskId ? ' - their Team Hub card is not deleted.' : '.'} This can't be undone.
                </span>
                <button className="btn small danger" onClick={onDeleteContact}>
                  Confirm delete
                </button>
                <button className="btn small quiet" onClick={() => setConfirmingDelete(false)}>
                  Cancel
                </button>
              </>
            ) : (
              <button className="btn small danger" onClick={() => setConfirmingDelete(true)}>
                Delete contact
              </button>
            )}
          </div>
        </div>
      </div>
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
