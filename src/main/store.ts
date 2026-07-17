// Local persistence: one JSON file in Electron's per-app user data folder.
// Writes are atomic (write to a temp file, then rename) and serialised so
// concurrent saves cannot interleave.
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import type { Contact } from '../shared/types';
import { htmlToText, isHtml } from './html';

interface StoreData {
  version: number;
  contacts: Contact[];
  meta: {
    lastNotifiedDate: string | null;
  };
}

const CURRENT_VERSION = 2;

const EMPTY: StoreData = {
  version: CURRENT_VERSION,
  contacts: [],
  meta: { lastNotifiedDate: null },
};

// Upgrade data written by older versions of the app.
// v2: "pricing-sent" renamed to "proposal-sent"; needsReply and draft added.
function migrate(data: StoreData): StoreData {
  for (const contact of data.contacts) {
    if ((contact.stage as string) === 'pricing-sent') contact.stage = 'proposal-sent';
    contact.needsReply ??= false;
    contact.draft ??= '';
    // Heal notes that were imported as raw HTML before the app handled rich
    // text. Runs every load and is a no-op once the notes are plain text.
    if (contact.importedNotes && isHtml(contact.importedNotes)) {
      contact.importedNotes = htmlToText(contact.importedNotes);
    }
  }
  data.version = CURRENT_VERSION;
  return data;
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
