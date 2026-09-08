// Shared data model used by the main process, preload bridge, and renderer.

export type Stage =
  | 'draft'
  | 'awaiting-reply'
  | 'in-conversation'
  | 'active-client'
  | 'no-response'
  | 'maybe-later'
  | 'went-cold'
  | 'not-interested';

// Things that can happen while a conversation is running. They are flags, not
// stages: one person can have held a meeting *and* been sent a proposal and
// still read as "In conversation" everywhere else.
export type Milestone = 'meeting' | 'proposal';

export interface HistoryEntry {
  date: string; // ISO date, e.g. 2026-07-14
  text: string;
  // The stage this entry moved the contact into, when it was a stage change.
  // Used by the analytics page to count stage entries over time.
  stage?: Stage;
  // Set instead of `stage` when the entry recorded a milestone.
  milestone?: Milestone;
}

export type ContactSyncState = 'synced' | 'error' | 'local-only';

export interface ContactSync {
  state: ContactSyncState;
  message?: string;
}

export interface Contact {
  id: string;
  teamhubTaskId: string | null;
  name: string;
  linkedinUrl: string;
  websiteUrl: string;
  stage: Stage;
  // Messages sent to this person so far. Replaces the old first-msg /
  // second-msg stages and drives the chase cadence while awaiting a reply.
  messagesSent: number;
  // Date of the most recent message sent to them. The silence timers count
  // from here, so a chase or a follow-up restarts the clock.
  lastMessageDate: string | null;
  // Milestone dates, null until they happen. See Milestone.
  meetingHeldDate: string | null;
  proposalSentDate: string | null;
  // Next follow-up date (ISO date). Set while in "maybe-later", null otherwise.
  followUpDate: string | null;
  history: HistoryEntry[];
  // Log lines written locally but not yet confirmed on the Team Hub card.
  pendingLines: string[];
  // Original card description captured on import, preserved so manual notes are never lost.
  importedNotes: string;
  // Free-form personal notes, editable any time. Local only, never synced.
  notes: string;
  // True when the ball is in the user's court: this contact is waiting on a
  // reply and shows on the Reply page until ticked.
  needsReply: boolean;
  // A half-written message saved for later. Local only, never synced.
  draft: string;
  sync: ContactSync;
  createdAt: string;
  updatedAt: string;
}

export interface AddContactInput {
  name: string;
  linkedinUrl: string;
  websiteUrl: string;
  firstMessageSent: boolean;
  notes: string;
}

export type AddContactResult =
  | { ok: true; contact: Contact }
  | { ok: false; error: string; existingId?: string };

export interface QueueItem {
  contactId: string;
  reason: string;
  // The action Focus should offer as the obvious next press. Timers never move
  // anyone on their own; they only pre-select the move for one keystroke.
  suggestedActionId?: string;
}

// One day's connection tally. Connections are counted, not tracked per person:
// see the Connected page.
export interface ConnectionDay {
  date: string; // ISO date
  count: number;
}

// A contact in the Recently deleted bin. Deleting never destroys anything on
// its own; it moves the record here, where it stays until it is restored or
// deliberately purged. Nothing empties this automatically.
export interface DeletedContact {
  contact: Contact;
  deletedAt: string; // ISO timestamp
}

// Where the data file actually is, and whether that location is backed up.
export interface StorageInfo {
  kind: 'onedrive' | 'local' | 'custom';
  dir: string;
  file: string;
  // Set when the app could not use the location it wanted. Shown in the UI,
  // because silently falling back to an unbacked-up folder is the one failure
  // the user would never notice on their own.
  warning: string | null;
  snapshotCount: number;
  lastSnapshot: string | null; // ISO date
}

export type ExportResult =
  | { ok: true; file: string; contacts: number }
  | { ok: false; error: string };

// Reading a previously exported file back in. Replaces everything, so the UI
// asks first.
export type RestoreResult =
  | { ok: true; contacts: number; connections: number }
  | { ok: false; error: string };

export interface SyncStatus {
  configured: boolean;
  slotsMapped: boolean;
  unmappedStages: string[];
  message: string;
  errorCount: number;
}

export interface ImportResult {
  ok: boolean;
  imported: number;
  updated: number;
  skipped: number;
  message: string;
}

export interface RetryResult {
  fixed: number;
  remaining: number;
}

// The API the preload script exposes to the renderer as window.tracker.
export interface TrackerApi {
  listContacts(): Promise<Contact[]>;
  addContact(input: AddContactInput): Promise<AddContactResult>;
  // followUpDate applies only to actions landing in "maybe later"; without
  // one those fall back to the default timeframe.
  applyAction(contactId: string, actionId: string, followUpDate?: string): Promise<Contact | null>;
  undoLastAction(): Promise<Contact | null>;
  deleteDraft(contactId: string): Promise<boolean>;
  // Moves a contact to the Recently deleted bin. Reversible via restoreContact.
  deleteContact(contactId: string): Promise<boolean>;
  listDeleted(): Promise<DeletedContact[]>;
  restoreContact(contactId: string): Promise<Contact | null>;
  // The only call that actually destroys a contact.
  purgeContact(contactId: string): Promise<boolean>;
  saveDraft(contactId: string, text: string): Promise<void>;
  saveNotes(contactId: string, text: string): Promise<void>;
  setNeedsReply(contactId: string, needsReply: boolean): Promise<Contact | null>;
  markReplied(contactId: string): Promise<Contact | null>;
  getQueue(): Promise<QueueItem[]>;
  listConnections(): Promise<ConnectionDay[]>;
  // Adds to today's tally: +1 on a click, -1 to take back a misclick.
  logConnection(delta: number): Promise<ConnectionDay[]>;
  // Corrects any day's count outright.
  setConnections(date: string, count: number): Promise<ConnectionDay[]>;
  getSyncStatus(): Promise<SyncStatus>;
  importFromTeamHub(): Promise<ImportResult>;
  retryFailedSyncs(): Promise<RetryResult>;
  // Backups: where the data lives, writing a copy out, reading one back.
  getStorageInfo(): Promise<StorageInfo>;
  exportBackup(): Promise<ExportResult>;
  restoreBackup(): Promise<RestoreResult>;
  revealDataFolder(): Promise<void>;
  onFocusRequested(callback: () => void): () => void;
}
