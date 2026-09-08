// IPC surface for the renderer. All state changes to contacts happen here,
// in one place: apply locally first, then sync to Team Hub.
import { app, dialog, ipcMain, shell } from 'electron';
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import type {
  AddContactInput,
  AddContactResult,
  ConnectionDay,
  Contact,
  ExportResult,
  HistoryEntry,
  RestoreResult,
  StorageInfo,
} from '../shared/types';
import type { StorageLocation } from './paths';
import { defaultFollowUpDate, getAction, ordinalMessage } from '../shared/stages';
import { buildQueue } from '../shared/cadence';
import { formatLogLine, formatShort, isIsoDate, todayIso } from '../shared/dates';
import { isLinkedinProfileUrl, normaliseLinkedinUrl } from '../shared/linkedin';
import type { Store } from './store';
import type { SyncService } from './sync';

interface UndoEntry {
  contactId: string;
  snapshot: Contact;
  addedLine: string;
}

// Single-level undo is enough for "pressed the wrong key in focus mode".
// Creating a card is not undoable (the client has no safe delete endpoint).
const undoStack: UndoEntry[] = [];
const UNDO_STACK_LIMIT = 20;

export function registerIpc(store: Store, sync: SyncService, storage: StorageLocation): void {
  ipcMain.handle('contacts:list', () => store.list());

  ipcMain.handle('contacts:add', async (_event, input: AddContactInput): Promise<AddContactResult> => {
    const name = input.name.trim();
    const linkedinUrl = input.linkedinUrl.trim();
    const websiteUrl = input.websiteUrl.trim();

    if (!name) return { ok: false, error: 'A name is required.' };
    if (!isLinkedinProfileUrl(linkedinUrl)) {
      return { ok: false, error: 'That does not look like a LinkedIn profile URL.' };
    }

    const key = normaliseLinkedinUrl(linkedinUrl);
    const existing = store
      .list()
      .find((c) => c.linkedinUrl && normaliseLinkedinUrl(c.linkedinUrl) === key);
    if (existing) {
      return { ok: false, error: `${existing.name} already has this LinkedIn URL.`, existingId: existing.id };
    }

    const now = new Date().toISOString();
    const contact: Contact = {
      id: crypto.randomUUID(),
      teamhubTaskId: null,
      name,
      linkedinUrl,
      websiteUrl,
      stage: input.firstMessageSent ? 'awaiting-reply' : 'draft',
      messagesSent: input.firstMessageSent ? 1 : 0,
      lastMessageDate: input.firstMessageSent ? todayIso() : null,
      meetingHeldDate: null,
      proposalSentDate: null,
      followUpDate: null,
      history: input.firstMessageSent
        ? [{ date: todayIso(), text: 'First message sent', stage: 'awaiting-reply' as const }]
        : [],
      pendingLines: [],
      importedNotes: '',
      notes: input.notes.trim(),
      needsReply: false,
      draft: '',
      sync: { state: 'local-only' },
      createdAt: now,
      updatedAt: now,
    };

    if (input.firstMessageSent) {
      await sync.pushNewContact(contact);
    }
    store.upsert(contact);
    return { ok: true, contact };
  });

  ipcMain.handle('contacts:act', async (
    _event,
    contactId: string,
    actionId: string,
    followUpDate?: string,
  ): Promise<Contact | null> => {
    const contact = store.get(contactId);
    if (!contact) return null;
    const action = getAction(contact.stage, actionId);
    if (!action) return null;

    const wasDraft = contact.stage === 'draft';
    const snapshot = structuredClone(contact);
    const today = todayIso();

    // Apply locally first. A "maybe later" move carries the timeframe the
    // user picked; anything unrecognised falls back to the default.
    contact.stage = action.to;
    contact.followUpDate =
      action.to === 'maybe-later'
        ? isIsoDate(followUpDate)
          ? followUpDate
          : defaultFollowUpDate(today)
        : null;

    // A logged message restarts the silence timers and, while chasing, names
    // itself after the count it takes the contact to.
    if (action.sendsMessage) {
      contact.messagesSent += 1;
      contact.lastMessageDate = today;
    }
    if (action.milestone === 'meeting') contact.meetingHeldDate = today;
    if (action.milestone === 'proposal') contact.proposalSentDate = today;

    const logText = action.log
      .replace('{followUp}', contact.followUpDate ? formatShort(contact.followUpDate) : '')
      .replace('{ordinal}', ordinalMessage(contact.messagesSent))
      .replace('{messages}', messageCountPhrase(contact.messagesSent));
    const entry: HistoryEntry = { date: today, text: logText };
    // Milestones record what happened rather than a move; everything else
    // records the stage it landed in, which is what analytics counts.
    if (action.milestone) entry.milestone = action.milestone;
    else entry.stage = action.to;
    contact.history.push(entry);
    // Acting on a contact means the user just handled them; the flag is only
    // (re)set when the other person messaged and now awaits a reply.
    contact.needsReply = action.setsNeedsReply === true;
    contact.updatedAt = new Date().toISOString();

    // Then sync. A draft entering the pipeline creates its card; everything
    // else moves the existing card and appends the log line.
    const line = formatLogLine(entry);
    if (wasDraft) {
      await sync.pushNewContact(contact);
    } else {
      contact.pendingLines.push(line);
      await sync.pushAction(contact, line);
    }
    store.upsert(contact);

    if (!wasDraft) {
      undoStack.push({ contactId, snapshot, addedLine: line });
      if (undoStack.length > UNDO_STACK_LIMIT) undoStack.shift();
    }
    return contact;
  });

  ipcMain.handle('contacts:undo', async (): Promise<Contact | null> => {
    const entry = undoStack.pop();
    if (!entry) return null;
    const current = store.get(entry.contactId);
    if (!current) return null;

    const restored = structuredClone(entry.snapshot);
    restored.teamhubTaskId = current.teamhubTaskId; // keep a card link gained meanwhile
    await sync.pushRevert(restored, entry.addedLine);
    store.upsert(restored);
    return restored;
  });

  ipcMain.handle('contacts:delete-draft', (_event, contactId: string): boolean => {
    const contact = store.get(contactId);
    // Only local drafts can be deleted; anything with a Team Hub card cannot.
    if (!contact || contact.stage !== 'draft' || contact.teamhubTaskId) return false;
    store.remove(contactId);
    return true;
  });

  // Deleting is reversible: the contact moves to the Recently deleted bin and
  // stays there until it is restored or deliberately purged. There is no
  // delete endpoint for Team Hub (see README), so a synced card is left in
  // place on the board either way.
  ipcMain.handle('contacts:delete', (_event, contactId: string): boolean => {
    const entry = store.softDelete(contactId);
    if (!entry) return false;
    // Stage undo cannot reach into the bin, so drop those entries; restoring
    // is what undoes a delete.
    for (let i = undoStack.length - 1; i >= 0; i--) {
      if (undoStack[i].contactId === contactId) undoStack.splice(i, 1);
    }
    return true;
  });

  ipcMain.handle('contacts:list-deleted', () => store.deleted());

  ipcMain.handle('contacts:restore', (_event, contactId: string): Contact | null =>
    store.restore(contactId),
  );

  // The only call that actually destroys a contact.
  ipcMain.handle('contacts:purge', (_event, contactId: string): boolean =>
    store.purge(contactId),
  );

  // Message drafts are a local scratchpad: saved quietly, never synced, and
  // deliberately not bumping updatedAt so typing does not reorder lists.
  ipcMain.handle('contacts:save-draft', (_event, contactId: string, text: string): void => {
    const contact = store.get(contactId);
    if (!contact) return;
    contact.draft = text;
    store.upsert(contact);
  });

  // Personal notes: a free-form scratchpad, saved quietly, never synced, and
  // deliberately not bumping updatedAt so typing does not reorder lists.
  ipcMain.handle('contacts:save-notes', (_event, contactId: string, text: string): void => {
    const contact = store.get(contactId);
    if (!contact) return;
    contact.notes = text;
    store.upsert(contact);
  });

  ipcMain.handle(
    'contacts:set-needs-reply',
    (_event, contactId: string, needsReply: boolean): Contact | null => {
      const contact = store.get(contactId);
      if (!contact) return null;
      contact.needsReply = needsReply;
      contact.updatedAt = new Date().toISOString();
      store.upsert(contact);
      return contact;
    },
  );

  // Tick on the Reply page for someone staying in their stage: log the reply,
  // clear the flag, and append the line to their Team Hub card.
  ipcMain.handle('contacts:replied', async (_event, contactId: string): Promise<Contact | null> => {
    const contact = store.get(contactId);
    if (!contact) return null;

    const entry = { date: todayIso(), text: 'Replied to their message' };
    contact.history.push(entry);
    contact.needsReply = false;
    // Replying is a message out: it counts, and it restarts the silence timer.
    contact.messagesSent += 1;
    contact.lastMessageDate = todayIso();
    contact.updatedAt = new Date().toISOString();

    const line = formatLogLine(entry);
    if (contact.teamhubTaskId) {
      contact.pendingLines.push(line);
      await sync.pushAction(contact, line);
    }
    store.upsert(contact);
    return contact;
  });

  ipcMain.handle('queue:list', () => buildQueue(store.list()));

  // --- Connection tally -----------------------------------------------------
  // Connections are counted, never attached to a contact: 50 a day is far more
  // people than anyone would track individually.

  ipcMain.handle('connections:list', (): ConnectionDay[] => store.connections());

  ipcMain.handle('connections:log', (_event, delta: number): ConnectionDay[] => {
    const step = Number.isFinite(delta) ? Math.trunc(delta) : 0;
    if (step === 0) return store.connections();
    return store.addConnections(todayIso(), step);
  });

  ipcMain.handle('connections:set', (_event, date: string, count: number): ConnectionDay[] => {
    if (!isIsoDate(date) || !Number.isFinite(count)) return store.connections();
    return store.setConnections(date, count);
  });

  ipcMain.handle('sync:status', () => {
    const errorCount = store.list().filter((c) => c.sync.state === 'error').length;
    return sync.status(errorCount);
  });

  ipcMain.handle('sync:import', () => sync.importAll(store));

  ipcMain.handle('sync:retry', () => sync.retryFailed(store));

  // --- Backups --------------------------------------------------------------

  ipcMain.handle('storage:info', async (): Promise<StorageInfo> => {
    const snapshots = await store.snapshotInfo();
    return {
      kind: storage.kind,
      dir: store.dataDir,
      file: store.dataFile,
      syncing: storage.syncing,
      warning: storage.warning,
      snapshotCount: snapshots.count,
      lastSnapshot: snapshots.last,
    };
  });

  ipcMain.handle('storage:reveal', async (): Promise<void> => {
    shell.showItemInFolder(store.dataFile);
  });

  // A copy the user controls outright, somewhere the app will never touch it.
  ipcMain.handle('storage:export', async (): Promise<ExportResult> => {
    const stamp = todayIso();
    const result = await dialog.showSaveDialog({
      title: 'Save a backup',
      defaultPath: join(app.getPath('documents'), `outreach-backup-${stamp}.json`),
      filters: [{ name: 'JSON backup', extensions: ['json'] }],
    });
    if (result.canceled || !result.filePath) return { ok: false, error: 'Cancelled.' };
    try {
      await fs.writeFile(result.filePath, store.serialise(), 'utf8');
      return { ok: true, file: result.filePath, contacts: store.counts().contacts };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  // Reading a backup replaces everything, so the renderer confirms first and
  // the startup snapshot means the replaced version is still on disk.
  ipcMain.handle('storage:restore', async (): Promise<RestoreResult> => {
    const result = await dialog.showOpenDialog({
      title: 'Restore from a backup',
      properties: ['openFile'],
      filters: [{ name: 'JSON backup', extensions: ['json'] }],
    });
    const file = result.filePaths[0];
    if (result.canceled || !file) return { ok: false, error: 'Cancelled.' };
    try {
      const counts = store.replaceAll(await fs.readFile(file, 'utf8'));
      return { ok: true, ...counts };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  });
}

// "three messages" - how the No response log line names what was sent.
function messageCountPhrase(messagesSent: number): string {
  const words = ['no messages', 'one message', 'two messages', 'three messages'];
  return words[messagesSent] ?? `${messagesSent} messages`;
}
