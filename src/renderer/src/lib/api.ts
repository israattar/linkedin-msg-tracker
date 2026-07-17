// The renderer's single entry to app data. Inside Electron this is the
// preload bridge. In a plain browser (UI preview during development) it
// falls back to an in-memory mock so the interface still renders and can
// be clicked through; nothing is persisted and no network calls are made.
import type {
  AddContactInput,
  Contact,
  Stage,
  TrackerApi,
} from '../../../shared/types';
import { getAction, MAYBE_LATER_MONTHS } from '../../../shared/stages';
import { addMonthsIso, formatShort, todayIso } from '../../../shared/dates';
import { buildQueueView } from './queue';

export const isDesktop = typeof window !== 'undefined' && !!window.tracker;

function createBrowserMock(): TrackerApi {
  const today = todayIso();
  const contacts: Contact[] = [
    mockContact('Raj Verma', 'https://www.linkedin.com/in/raj-verma-17582861/', '', 'first-msg', '2026-07-04'),
    mockContact('Maya Rodriguez', 'https://www.linkedin.com/in/maya-rodriguez-8a2b/', 'https://mayarodriguez.com', 'in-conversation', '2026-07-11'),
    mockContact('Daniel Koh', 'https://www.linkedin.com/in/daniel-koh-991/', '', 'maybe-later', '2026-06-10'),
    mockContact('Aisha Begum', 'https://www.linkedin.com/in/aisha-begum-77/', '', 'connected', '2026-07-13'),
    mockContact('Tom Whitfield', 'https://www.linkedin.com/in/tom-whitfield/', 'https://whitfield.dev', 'proposal-sent', '2026-06-28'),
    mockContact('Sofia Marino', 'https://www.linkedin.com/in/sofia-marino-3c/', '', 'active-client', '2026-06-02'),
    mockContact('Yousufuddin Shaik', 'https://www.linkedin.com/in/yousufuddin-shaik-a4455427/', 'https://yousuforthopaedicmedicine.co.uk', 'went-cold', '2026-06-20'),
  ];
  contacts[2].followUpDate = '2026-07-10';
  contacts[1].needsReply = true;
  contacts[6].history.push({ date: '2026-06-25', text: 'Meeting held', stage: 'meeting-held' });
  contacts[6].history.push({ date: '2026-07-02', text: 'Went cold', stage: 'went-cold' });

  return {
    listContacts: async () => contacts,
    addContact: async (input: AddContactInput) => {
      const contact = mockContact(
        input.name,
        input.linkedinUrl,
        input.websiteUrl,
        input.firstMessageSent ? 'first-msg' : 'draft',
        today,
      );
      contacts.unshift(contact);
      return { ok: true as const, contact };
    },
    applyAction: async (contactId, actionId) => {
      const contact = contacts.find((c) => c.id === contactId) ?? null;
      if (!contact) return null;
      const action = getAction(contact.stage, actionId);
      if (!action) return null;
      contact.stage = action.to;
      contact.followUpDate =
        action.to === 'maybe-later' ? addMonthsIso(today, MAYBE_LATER_MONTHS) : null;
      contact.history.push({
        date: today,
        text: action.log.replace('{followUp}', contact.followUpDate ? formatShort(contact.followUpDate) : ''),
        stage: action.to,
      });
      contact.needsReply = action.setsNeedsReply === true;
      contact.updatedAt = new Date().toISOString();
      return contact;
    },
    undoLastAction: async () => null,
    deleteDraft: async (contactId) => {
      const index = contacts.findIndex((c) => c.id === contactId);
      if (index < 0) return false;
      contacts.splice(index, 1);
      return true;
    },
    saveDraft: async (contactId, text) => {
      const contact = contacts.find((c) => c.id === contactId);
      if (contact) contact.draft = text;
    },
    setNeedsReply: async (contactId, needsReply) => {
      const contact = contacts.find((c) => c.id === contactId) ?? null;
      if (contact) contact.needsReply = needsReply;
      return contact;
    },
    markReplied: async (contactId) => {
      const contact = contacts.find((c) => c.id === contactId) ?? null;
      if (!contact) return null;
      contact.history.push({ date: today, text: 'Replied to their message' });
      contact.needsReply = false;
      contact.updatedAt = new Date().toISOString();
      return contact;
    },
    getQueue: async () => buildQueueView(contacts),
    getSyncStatus: async () => ({
      configured: false,
      slotsMapped: false,
      unmappedStages: [],
      message: 'Browser preview: Team Hub sync runs in the desktop app.',
      errorCount: 0,
    }),
    importFromTeamHub: async () => ({
      ok: false,
      imported: 0,
      updated: 0,
      skipped: 0,
      message: 'Import is only available in the desktop app.',
    }),
    retryFailedSyncs: async () => ({ fixed: 0, remaining: 0 }),
    onFocusRequested: () => () => {},
  };
}

function mockContact(
  name: string,
  linkedinUrl: string,
  websiteUrl: string,
  stage: Stage,
  since: string,
): Contact {
  return {
    id: crypto.randomUUID(),
    teamhubTaskId: null,
    name,
    linkedinUrl,
    websiteUrl,
    stage,
    followUpDate: null,
    history: [{ date: since, text: 'First message sent', stage: 'first-msg' }],
    pendingLines: [],
    importedNotes: '',
    needsReply: false,
    draft: '',
    sync: { state: 'local-only' },
    createdAt: since,
    updatedAt: since,
  };
}

export const api: TrackerApi = window.tracker ?? createBrowserMock();
