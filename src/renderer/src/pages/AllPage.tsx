// Browse everyone: search and filter by stage over a plain list of rows.
// Clicking a row opens that one contact in a modal with the full log, notes,
// actions and delete. Import and sync-retry live here too.
import { useEffect, useMemo, useState } from 'react';
import type {
  Contact,
  DeletedContact,
  Stage,
  StorageInfo,
  SyncStatus,
} from '../../../shared/types';
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
  deleted: DeletedContact[];
  storage: StorageInfo | null;
  syncStatus: SyncStatus | null;
  refresh: () => Promise<void>;
}

export default function AllPage({ contacts, deleted, storage, syncStatus, refresh }: Props) {
  const [query, setQuery] = useState('');
  // "bin" is a view over the Recently deleted list rather than a stage.
  const [stageFilter, setStageFilter] = useState<Stage | 'all' | 'bin'>('all');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [busy, setBusy] = useState<'import' | 'retry' | null>(null);
  const [notice, setNotice] = useState('');
  // The contact the last delete removed, so it can be put straight back
  // without going to find it in the bin.
  const [justDeleted, setJustDeleted] = useState<Contact | null>(null);

  const selected = contacts.find((c) => c.id === selectedId) ?? null;
  // False while Team Hub sync is switched off, which hides every part of the
  // UI that only makes sense when a board is attached.
  const syncing = syncStatus?.configured === true;

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
    const contact = contacts.find((c) => c.id === contactId) ?? null;
    await api.deleteContact(contactId);
    setSelectedId(null);
    setJustDeleted(contact);
    await refresh();
  }

  async function restoreContact(contactId: string): Promise<void> {
    await api.restoreContact(contactId);
    setJustDeleted(null);
    await refresh();
  }

  // The only thing in the app that destroys a contact, so it says so.
  async function purgeContact(contactId: string, name: string): Promise<void> {
    await api.purgeContact(contactId);
    setNotice(`${name} was permanently deleted.`);
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
        {deleted.length > 0 && (
          <button
            className={`filter-chip ${stageFilter === 'bin' ? 'active' : ''}`}
            onClick={() => setStageFilter('bin')}
          >
            Recently deleted <span className="n">{deleted.length}</span>
          </button>
        )}
        <span className="spacer" />
        {/* Import and retry only mean something when there is a board to talk
            to. With sync off they are hidden rather than disabled: there is
            nothing the user could do to make them work from here. */}
        {isDesktop && syncing && (
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

      {/* Straight after a delete, putting it back is one click rather than a
          trip to the bin. */}
      {justDeleted && (
        <div className="banner neutral undo-banner">
          <span>
            <b>{justDeleted.name}</b> moved to Recently deleted. Nothing is lost until you delete
            it permanently.
          </span>
          <span className="spacer" />
          <button className="btn small primary" onClick={() => void restoreContact(justDeleted.id)}>
            Undo
          </button>
          <button className="btn small quiet" onClick={() => setJustDeleted(null)}>
            Dismiss
          </button>
        </div>
      )}

      {stageFilter === 'bin' ? (
        <BinList
          deleted={deleted}
          query={query}
          onRestore={(id) => void restoreContact(id)}
          onPurge={(id, name) => void purgeContact(id, name)}
        />
      ) : shown.length === 0 ? (
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
            {syncing && <span className={`sync-dot ${contact.sync.state}`} title={syncTitle(contact)} />}
            <span className="when">{formatShort(contact.updatedAt.slice(0, 10))}</span>
          </div>
        ))
      )}

      {selected && (
        <ContactModal
          contact={selected}
          syncing={syncing}
          onClose={() => setSelectedId(null)}
          onAct={(id, followUpDate) => void act(selected.id, id, followUpDate)}
          onToggleFlag={() => void toggleFlag(selected.id, !selected.needsReply)}
          onDeleteDraft={() => void removeDraft(selected.id)}
          onDeleteContact={() => void removeContact(selected.id)}
        />
      )}

      <BackupPanel storage={storage} onChanged={refresh} />
    </div>
  );
}

// The Recently deleted bin. Nothing here expires; it stays until it is put
// back or deliberately destroyed, which is the only irreversible act in the
// app and so asks twice.
function BinList({
  deleted,
  query,
  onRestore,
  onPurge,
}: {
  deleted: DeletedContact[];
  query: string;
  onRestore: (id: string) => void;
  onPurge: (id: string, name: string) => void;
}) {
  const [confirming, setConfirming] = useState<string | null>(null);
  const shown = deleted.filter(
    (d) => query === '' || d.contact.name.toLowerCase().includes(query.toLowerCase()),
  );

  if (shown.length === 0) {
    return (
      <div className="card">
        <EmptyState title="Nothing deleted">
          Contacts you delete are kept here so they can be put back.
        </EmptyState>
      </div>
    );
  }

  return (
    <>
      <p className="bin-note">
        Kept indefinitely. Restoring puts a contact back exactly as it was, with its history and
        notes intact.
      </p>
      {shown.map(({ contact, deletedAt }) => (
        <div key={contact.id} className="contact-row bin-row">
          <Avatar name={contact.name} size={36} />
          <div className="grow">
            <div className="name">{contact.name}</div>
            <div className="meta">
              Deleted {describeWhen(deletedAt)} · was {STAGES[contact.stage].label.toLowerCase()}
            </div>
          </div>
          <StageBadge stage={contact.stage} />
          {confirming === contact.id ? (
            <>
              <span className="faint-text">Gone for good?</span>
              <button className="btn small danger" onClick={() => onPurge(contact.id, contact.name)}>
                Delete permanently
              </button>
              <button className="btn small quiet" onClick={() => setConfirming(null)}>
                Cancel
              </button>
            </>
          ) : (
            <>
              <button className="btn small primary" onClick={() => onRestore(contact.id)}>
                Restore
              </button>
              <button className="btn small quiet" onClick={() => setConfirming(contact.id)}>
                Delete permanently
              </button>
            </>
          )}
        </div>
      ))}
    </>
  );
}

// Where the data actually is, and the two buttons that put a copy somewhere
// else. Deliberately plain about the location, because the one failure nobody
// notices is a backup that was never happening.
function BackupPanel({
  storage,
  onChanged,
}: {
  storage: StorageInfo | null;
  onChanged: () => Promise<void>;
}) {
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);

  if (!storage) return null;

  async function runExport(): Promise<void> {
    setBusy(true);
    const result = await api.exportBackup();
    setBusy(false);
    setMessage(
      result.ok
        ? `Saved ${result.contacts} contacts to ${result.file}`
        : result.error === 'Cancelled.'
          ? ''
          : `Export failed: ${result.error}`,
    );
  }

  async function runRestore(): Promise<void> {
    const ok = window.confirm(
      'Restoring replaces everything currently in the app with the contents of the backup file. Today\'s snapshot is already on disk, so this can be undone. Continue?',
    );
    if (!ok) return;
    setBusy(true);
    const result = await api.restoreBackup();
    setBusy(false);
    setMessage(
      result.ok
        ? `Restored ${result.contacts} contacts and ${result.connections} days of connections.`
        : result.error === 'Cancelled.'
          ? ''
          : `Restore failed: ${result.error}`,
    );
    if (result.ok) await onChanged();
  }

  return (
    <div className="card backup-panel">
      <div className="card-head">
        <div>
          <h3 className="card-title">Data and backups</h3>
          <p className="card-sub">{storageSummary(storage)}</p>
        </div>
        <div className="actions">
          <button className="btn small" disabled={busy} onClick={() => void runExport()}>
            Export a copy
          </button>
          <button className="btn small" disabled={busy} onClick={() => void runRestore()}>
            Restore from a file
          </button>
          <button className="btn small quiet" onClick={() => void api.revealDataFolder()}>
            Open folder
          </button>
        </div>
      </div>

      <div className="backup-facts">
        <div>
          <span className="k">Saving to</span>
          <span className="v">{storage.file}</span>
        </div>
        <div>
          <span className="k">Daily snapshots</span>
          <span className="v">
            {storage.snapshotCount === 0
              ? 'none yet, the first is taken tomorrow'
              : `${storage.snapshotCount} kept, most recent ${storage.lastSnapshot}`}
          </span>
        </div>
      </div>

      {message && <div className="banner neutral" style={{ marginTop: 12 }}>{message}</div>}
    </div>
  );
}

function storageSummary(storage: StorageInfo): string {
  if (storage.kind === 'onedrive') {
    return 'Backed up to OneDrive. Every change syncs to the cloud within seconds.';
  }
  if (storage.kind === 'custom') return 'Saving to a folder you chose.';
  return 'Saving to this machine only.';
}

// "today", "yesterday", "12 Aug 2026"
function describeWhen(iso: string): string {
  const days = daysSince(iso.slice(0, 10));
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 7) return `${days} days ago`;
  return `on ${formatShort(iso.slice(0, 10))}`;
}

interface ModalProps {
  contact: Contact;
  syncing: boolean;
  onClose: () => void;
  onAct: (actionId: string, followUpDate?: string) => void;
  onToggleFlag: () => void;
  onDeleteDraft: () => void;
  onDeleteContact: () => void;
}

// The full detail view for one contact, opened by clicking its row - a clear
// "you are now looking at this one specific contact" state, with the delete
// action tucked behind a confirm step since it cannot be undone.
function ContactModal({ contact, syncing, onClose, onAct, onToggleFlag, onDeleteDraft, onDeleteContact }: ModalProps) {
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

          {syncing && contact.sync.state === 'error' && (
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
