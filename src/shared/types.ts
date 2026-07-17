// Shared data model used by the main process, preload bridge, and renderer.

export type Stage =
  | 'draft'
  | 'first-msg'
  | 'connected'
  | 'second-msg'
  | 'in-conversation'
  | 'meeting-held'
  | 'proposal-sent'
  | 'active-client'
  | 'maybe-later'
  | 'went-cold'
  | 'not-interested';

export interface HistoryEntry {
  date: string; // ISO date, e.g. 2026-07-14
  text: string;
  // The stage this entry moved the contact into, when it was a stage change.
  // Used by the analytics page to count stage entries over time.
  stage?: Stage;
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
  // Next follow-up date (ISO date). Set while in "maybe-later", null otherwise.
  followUpDate: string | null;
  history: HistoryEntry[];
  // Log lines written locally but not yet confirmed on the Team Hub card.
  pendingLines: string[];
  // Original card description captured on import, preserved so manual notes are never lost.
  importedNotes: string;
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
}

export type AddContactResult =
  | { ok: true; contact: Contact }
  | { ok: false; error: string; existingId?: string };

export interface QueueItem {
  contactId: string;
  reason: string;
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
  applyAction(contactId: string, actionId: string): Promise<Contact | null>;
  undoLastAction(): Promise<Contact | null>;
  deleteDraft(contactId: string): Promise<boolean>;
  saveDraft(contactId: string, text: string): Promise<void>;
  setNeedsReply(contactId: string, needsReply: boolean): Promise<Contact | null>;
  markReplied(contactId: string): Promise<Contact | null>;
  getQueue(): Promise<QueueItem[]>;
  getSyncStatus(): Promise<SyncStatus>;
  importFromTeamHub(): Promise<ImportResult>;
  retryFailedSyncs(): Promise<RetryResult>;
  onFocusRequested(callback: () => void): () => void;
}
