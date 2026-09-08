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
  deleteContact(contactId: string): Promise<boolean>;
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
  onFocusRequested(callback: () => void): () => void;
}
