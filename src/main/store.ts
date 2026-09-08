// Local persistence: one JSON file in Electron's per-app user data folder.
// Writes are atomic (write to a temp file, then rename) and serialised so
// concurrent saves cannot interleave.
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import type {
  ConnectionDay,
  Contact,
  DeletedContact,
  HistoryEntry,
  Milestone,
  Stage,
} from '../shared/types';
import { htmlToText, isHtml } from './html';

interface StoreData {
  version: number;
  contacts: Contact[];
  // The Recently deleted bin. Nothing empties this automatically.
  deleted: DeletedContact[];
  // Daily connection tally, keyed by ISO date. Not tied to contacts.
  connections: Record<string, number>;
  meta: {
    lastNotifiedDate: string | null;
    // Date of the most recent snapshot, so only the first save of each day
    // takes one.
    lastSnapshotDate: string | null;
  };
}

const CURRENT_VERSION = 5;

// Daily snapshots kept beside the data file. Ten days is enough to notice a
// mistake and go back past it, and at a couple of megabytes each it costs
// nothing worth counting.
const SNAPSHOT_DIR = 'snapshots';
const SNAPSHOTS_KEPT = 10;

const EMPTY: StoreData = {
  version: CURRENT_VERSION,
  contacts: [],
  deleted: [],
  connections: {},
  meta: { lastNotifiedDate: null, lastSnapshotDate: null },
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
// v5: Recently deleted bin and daily snapshots added.
function migrate(data: StoreData): StoreData {
  data.connections ??= {};
  data.deleted ??= [];
  data.meta ??= { lastNotifiedDate: null, lastSnapshotDate: null };
  data.meta.lastSnapshotDate ??= null;
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
  private readonly dir: string;
  private writeChain: Promise<void> = Promise.resolve();

  private constructor(dir: string, data: StoreData) {
    this.dir = dir;
    this.file = join(dir, 'contacts.json');
    this.data = data;
  }

  // dataDir is wherever paths.ts settled on, which is normally a OneDrive
  // folder rather than AppData.
  static async open(dataDir: string): Promise<Store> {
    const file = join(dataDir, 'contacts.json');
    try {
      const raw = await fs.readFile(file, 'utf8');
      const parsed = JSON.parse(raw) as StoreData;
      const store = new Store(dataDir, migrate({ ...EMPTY, ...parsed }));
      // Take the day's snapshot before anything can modify the data, so the
      // snapshot always reflects how the app found it this morning.
      await store.snapshotIfNewDay();
      // Write the upgraded/healed data back so the file matches memory.
      store.persist();
      return store;
    } catch {
      return new Store(dataDir, structuredClone(EMPTY));
    }
  }

  get dataFile(): string {
    return this.file;
  }

  get dataDir(): string {
    return this.dir;
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

  // --- Recently deleted -----------------------------------------------------
  // Deleting moves a contact here rather than destroying it. Only purge()
  // actually loses anything, and only when asked twice.

  softDelete(id: string): DeletedContact | null {
    const contact = this.data.contacts.find((c) => c.id === id) ?? null;
    if (!contact) return null;
    const entry: DeletedContact = { contact, deletedAt: new Date().toISOString() };
    this.data.contacts = this.data.contacts.filter((c) => c.id !== id);
    this.data.deleted.unshift(entry);
    this.persist();
    return entry;
  }

  deleted(): DeletedContact[] {
    return this.data.deleted;
  }

  restore(id: string): Contact | null {
    const index = this.data.deleted.findIndex((d) => d.contact.id === id);
    if (index < 0) return null;
    const [entry] = this.data.deleted.splice(index, 1);
    // A contact created since the delete wins, rather than being overwritten.
    if (!this.data.contacts.some((c) => c.id === id)) {
      this.data.contacts.unshift(entry.contact);
    }
    this.persist();
    return entry.contact;
  }

  purge(id: string): boolean {
    const before = this.data.deleted.length;
    this.data.deleted = this.data.deleted.filter((d) => d.contact.id !== id);
    if (this.data.deleted.length === before) return false;
    this.persist();
    return true;
  }

  // Used by the draft delete, which never reaches the bin: an unsent draft has
  // nothing worth keeping.
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

  // --- Snapshots ------------------------------------------------------------
  // A dated copy of the file as the app found it, taken once a day on startup.
  // This is what a mistake gets rolled back from: the bin covers a deleted
  // contact, a snapshot covers everything else.

  async snapshotIfNewDay(): Promise<void> {
    const today = new Date().toISOString().slice(0, 10);
    if (this.data.meta.lastSnapshotDate === today) return;
    try {
      const dir = join(this.dir, SNAPSHOT_DIR);
      await fs.mkdir(dir, { recursive: true });
      await fs.copyFile(this.file, join(dir, `contacts-${today}.json`));
      this.data.meta.lastSnapshotDate = today;
      await this.pruneSnapshots(dir);
    } catch (error) {
      // A snapshot failing must never stop the app opening.
      console.error('Could not write the daily snapshot:', error);
    }
  }

  private async pruneSnapshots(dir: string): Promise<void> {
    const files = (await fs.readdir(dir))
      .filter((n) => n.startsWith('contacts-') && n.endsWith('.json'))
      .sort();
    for (const name of files.slice(0, Math.max(0, files.length - SNAPSHOTS_KEPT))) {
      await fs.unlink(join(dir, name)).catch(() => {});
    }
  }

  async snapshotInfo(): Promise<{ count: number; last: string | null }> {
    try {
      const files = (await fs.readdir(join(this.dir, SNAPSHOT_DIR)))
        .filter((n) => n.startsWith('contacts-') && n.endsWith('.json'))
        .sort();
      const last = files[files.length - 1];
      return {
        count: files.length,
        last: last ? last.slice('contacts-'.length, -'.json'.length) : null,
      };
    } catch {
      return { count: 0, last: null };
    }
  }

  // --- Backup file in and out ----------------------------------------------

  // Everything the app knows, as one JSON document.
  serialise(): string {
    return JSON.stringify(this.data, null, 2);
  }

  counts(): { contacts: number; connections: number } {
    return {
      contacts: this.data.contacts.length,
      connections: Object.keys(this.data.connections).length,
    };
  }

  // Replaces the lot with the contents of an exported file. The caller has
  // already confirmed with the user, and a snapshot was taken on startup, so
  // the version being replaced is still recoverable.
  replaceAll(raw: string): { contacts: number; connections: number } {
    const parsed = JSON.parse(raw) as StoreData;
    if (!Array.isArray(parsed.contacts)) {
      throw new Error('That file does not look like an Outreach Tracker backup.');
    }
    this.data = migrate({ ...structuredClone(EMPTY), ...parsed });
    this.persist();
    return this.counts();
  }

  private persist(): void {
    const snapshot = JSON.stringify(this.data, null, 2);
    this.writeChain = this.writeChain.then(async () => {
      // The folder can vanish under us when it is a cloud folder that got
      // moved or unlinked, so make sure it exists on every write.
      await fs.mkdir(this.dir, { recursive: true });
      const tmp = `${this.file}.tmp`;
      await fs.writeFile(tmp, snapshot, 'utf8');
      await fs.rename(tmp, this.file);
    });
    this.writeChain.catch((error) => {
      console.error('Failed to save contacts file:', error);
    });
  }
}
