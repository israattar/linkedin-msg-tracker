// IPC surface for the renderer. All state changes to contacts happen here,
// in one place: apply locally first, then sync to Team Hub.
import { ipcMain } from 'electron';
import type {
  AddContactInput,
  AddContactResult,
  Contact,
  QueueItem,
} from '../shared/types';
import { getAction, MAYBE_LATER_MONTHS, STALE_FIRST_MSG_DAYS } from '../shared/stages';
import { addMonthsIso, daysSince, formatLogLine, formatShort, todayIso } from '../shared/dates';
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

export function buildQueue(contacts: Contact[]): QueueItem[] {
  const today = todayIso();

  const due = contacts
    .filter((c) => c.stage === 'maybe-later' && c.followUpDate !== null && c.followUpDate <= today)
    .sort((a, b) => (a.followUpDate ?? '').localeCompare(b.followUpDate ?? ''))
    .map((c) => ({
      contactId: c.id,
      reason: `Follow-up due ${formatShort(c.followUpDate ?? today)}`,
    }));

  const stale = contacts
    .filter((c) => c.stage === 'first-msg' && lastActivityDays(c) >= STALE_FIRST_MSG_DAYS)
    .sort((a, b) => lastActivityDays(b) - lastActivityDays(a))
    .map((c) => ({
      contactId: c.id,
      reason: `No reply for ${lastActivityDays(c)} days`,
    }));

  return [...due, ...stale];
}

function lastActivityDays(contact: Contact): number {
  const last = contact.history[contact.history.length - 1];
  return last ? daysSince(last.date) : 0;
}

export function registerIpc(store: Store, sync: SyncService): void {
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
      stage: input.firstMessageSent ? 'first-msg' : 'draft',
      followUpDate: null,
      history: input.firstMessageSent
        ? [{ date: todayIso(), text: 'First message sent', stage: 'first-msg' as const }]
        : [],
      pendingLines: [],
      importedNotes: '',
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

  ipcMain.handle('contacts:act', async (_event, contactId: string, actionId: string): Promise<Contact | null> => {
    const contact = store.get(contactId);
    if (!contact) return null;
    const action = getAction(contact.stage, actionId);
    if (!action) return null;

    const wasDraft = contact.stage === 'draft';
    const snapshot = structuredClone(contact);

    // Apply locally first.
    contact.stage = action.to;
    contact.followUpDate =
      action.to === 'maybe-later' ? addMonthsIso(todayIso(), MAYBE_LATER_MONTHS) : null;

    const logText = action.log.replace(
      '{followUp}',
      contact.followUpDate ? formatShort(contact.followUpDate) : '',
    );
    const entry = { date: todayIso(), text: logText, stage: action.to };
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

  // Message drafts are a local scratchpad: saved quietly, never synced, and
  // deliberately not bumping updatedAt so typing does not reorder lists.
  ipcMain.handle('contacts:save-draft', (_event, contactId: string, text: string): void => {
    const contact = store.get(contactId);
    if (!contact) return;
    contact.draft = text;
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

  ipcMain.handle('sync:status', () => {
    const errorCount = store.list().filter((c) => c.sync.state === 'error').length;
    return sync.status(errorCount);
  });

  ipcMain.handle('sync:import', () => sync.importAll(store));

  ipcMain.handle('sync:retry', () => sync.retryFailed(store));
}
