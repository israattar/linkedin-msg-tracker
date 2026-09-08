// Local persistence: one JSON file in Electron's per-app user data folder.
// Writes are atomic (write to a temp file, then rename) and serialised so
// concurrent saves cannot interleave.
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import type { ConnectionDay, Contact, HistoryEntry, Milestone, Stage } from '../shared/types';
import { htmlToText, isHtml } from './html';

interface StoreData {
  version: number;
  contacts: Contact[];
  // Daily connection tally, keyed by ISO date. Not tied to contacts.
  connections: Record<string, number>;
  meta: {
    lastNotifiedDate: string | null;
  };
}

const CURRENT_VERSION = 4;

const EMPTY: StoreData = {
  version: CURRENT_VERSION,
  contacts: [],
  connections: {},
  meta: { lastNotifiedDate: null },
};

// Stages that no longer exist, and where their occupants belong now. The
// per-message stages became a counter and the milestone stages became flags,
// so each old stage also carries what to record on the way across.
const RETIRED_STAGES: Record<
  string,
  { stage: Stage; messagesSent?: number; milestone?: Milestone }
> = {
  'first-msg': { stage: 'awaiting-reply', messagesSent: 1 },
  // Accepted the connection but never replied: the second message is still due.
  connected: { stage: 'awaiting-reply', messagesSent: 1 },
  'second-msg': { stage: 'awaiting-reply', messagesSent: 2 },
  'meeting-held': { stage: 'in-conversation', milestone: 'meeting' },
  'proposal-sent': { stage: 'in-conversation', milestone: 'proposal' },
  'pricing-sent': { stage: 'in-conversation', milestone: 'proposal' },
};

// Upgrade data written by older versions of the app.
// v2: "pricing-sent" renamed to "proposal-sent"; needsReply and draft added.
// v3: notes added.
// v4: per-message and milestone stages retired (see RETIRED_STAGES); messages
//     became a counter, meetings and proposals became dated flags.
function migrate(data: StoreData): StoreData {
  data.connections ??= {};
  for (const contact of data.contacts) {
    contact.needsReply ??= false;
    contact.draft ??= '';
    contact.notes ??= '';
    // Heal notes that were imported as raw HTML before the app handled rich
    // text. Runs every load and is a no-op once the notes are plain text.
    if (contact.importedNotes && isHtml(contact.importedNotes)) {
      contact.importedNotes = htmlToText(contact.importedNotes);
    }
    if (data.version < 4) upgradeToV4(contact);
    contact.messagesSent ??= contact.stage === 'draft' ? 0 : 1;
    contact.lastMessageDate ??= lastHistoryDate(contact.history);
    contact.meetingHeldDate ??= null;
    contact.proposalSentDate ??= null;
  }
  data.version = CURRENT_VERSION;
  return data;
}

// Move one contact onto the new model, reading their history for the facts the
// old stages carried implicitly.
function upgradeToV4(contact: Contact): void {
  const wasStage = contact.stage as string;

  // Milestones: a dated history line if there is one, otherwise the fact that
  // the card was sitting in that column at all.
  contact.meetingHeldDate ??=
    findHistoryDate(contact.history, 'meeting-held') ??
    (wasStage === 'meeting-held' ? lastHistoryDate(contact.history) : null);
  contact.proposalSentDate ??=
    findHistoryDate(contact.history, 'proposal-sent', 'pricing-sent') ??
    (wasStage === 'proposal-sent' || wasStage === 'pricing-sent'
      ? lastHistoryDate(contact.history)
      : null);

  const retired = RETIRED_STAGES[wasStage];
  if (retired) {
    contact.stage = retired.stage;
    if (retired.messagesSent !== undefined) contact.messagesSent ??= retired.messagesSent;
  }

  // Count the messages the old stages implied, then rewrite the history so the
  // analytics page keeps reading it.
  contact.messagesSent ??= countMessagesInHistory(contact.history);
  for (const entry of contact.history) {
    if (!entry.stage) continue;
    const moved = RETIRED_STAGES[entry.stage as string];
    if (!moved) continue;
    if (moved.milestone) entry.milestone = moved.milestone;
    entry.stage = moved.stage;
  }
}

function findHistoryDate(history: HistoryEntry[], ...stages: string[]): string | null {
  const entry = history.find((h) => h.stage !== undefined && stages.includes(h.stage as string));
  return entry?.date ?? null;
}

function lastHistoryDate(history: HistoryEntry[]): string | null {
  return history[history.length - 1]?.date ?? null;
}

// Old data recorded each message as its own stage entry.
function countMessagesInHistory(history: HistoryEntry[]): number {
  const sent = history.filter((h) => /message sent/i.test(h.text)).length;
  return Math.max(1, sent);
}

export class Store {
  private data: StoreData;
  private readonly file: string;
  private writeChain: Promise<void> = Promise.resolve();

  private constructor(file: string, data: StoreData) {
    this.file = file;
    this.data = data;
  }

  static async open(userDataDir: string): Promise<Store> {
    const file = join(userDataDir, 'contacts.json');
    try {
      const raw = await fs.readFile(file, 'utf8');
      const parsed = JSON.parse(raw) as StoreData;
      const store = new Store(file, migrate({ ...EMPTY, ...parsed }));
      // Write the upgraded/healed data back so the file matches memory.
      store.persist();
      return store;
    } catch {
      return new Store(file, structuredClone(EMPTY));
    }
  }

  list(): Contact[] {
    return this.data.contacts;
  }

  get(id: string): Contact | null {
    return this.data.contacts.find((c) => c.id === id) ?? null;
  }

  findByTeamhubTaskId(taskId: string): Contact | null {
    return this.data.contacts.find((c) => c.teamhubTaskId === taskId) ?? null;
  }

  upsert(contact: Contact): void {
    const index = this.data.contacts.findIndex((c) => c.id === contact.id);
    if (index >= 0) this.data.contacts[index] = contact;
    else this.data.contacts.unshift(contact);
    this.persist();
  }

  remove(id: string): void {
    this.data.contacts = this.data.contacts.filter((c) => c.id !== id);
    this.persist();
  }

  // --- Connection tally -----------------------------------------------------

  connections(): ConnectionDay[] {
    return Object.entries(this.data.connections)
      .map(([date, count]) => ({ date, count }))
      .sort((a, b) => a.date.localeCompare(b.date));
  }

  // Adds to one day's count. A negative delta takes a misclick back; the count
  // never goes below zero and empty days are not kept.
  addConnections(date: string, delta: number): ConnectionDay[] {
    return this.setConnections(date, (this.data.connections[date] ?? 0) + delta);
  }

  setConnections(date: string, count: number): ConnectionDay[] {
    const next = Math.max(0, Math.round(count));
    if (next === 0) delete this.data.connections[date];
    else this.data.connections[date] = next;
    this.persist();
    return this.connections();
  }

  get lastNotifiedDate(): string | null {
    return this.data.meta.lastNotifiedDate;
  }

  set lastNotifiedDate(date: string | null) {
    this.data.meta.lastNotifiedDate = date;
    this.persist();
  }

  private persist(): void {
    const snapshot = JSON.stringify(this.data, null, 2);
    this.writeChain = this.writeChain.then(async () => {
      const tmp = `${this.file}.tmp`;
      await fs.writeFile(tmp, snapshot, 'utf8');
      await fs.rename(tmp, this.file);
    });
    this.writeChain.catch((error) => {
      console.error('Failed to save contacts file:', error);
    });
  }
}
