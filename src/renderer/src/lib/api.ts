// The renderer's single entry to app data. Inside Electron this is the
// preload bridge. In a plain browser (UI preview during development) it
// falls back to an in-memory mock so the interface still renders and can
// be clicked through; nothing is persisted and no network calls are made.
import type {
  AddContactInput,
  ConnectionDay,
  Contact,
  HistoryEntry,
  Stage,
  TrackerApi,
} from '../../../shared/types';
import { defaultFollowUpDate, getAction, ordinalMessage } from '../../../shared/stages';
import { buildQueue } from '../../../shared/cadence';
import { addDaysIso, formatShort, isIsoDate, todayIso } from '../../../shared/dates';

export const isDesktop = typeof window !== 'undefined' && !!window.tracker;

function createBrowserMock(): TrackerApi {
  const today = todayIso();
  // Dates are relative to today so the preview shows the cadence working:
  // someone due a second message, someone out of messages, a quiet conversation.
  const ago = (days: number): string => addDaysIso(today, -days);

  const contacts: Contact[] = [
    mockContact('Raj Verma', 'https://www.linkedin.com/in/raj-verma-17582861/', '', 'awaiting-reply', ago(4), { messagesSent: 1 }),
    mockContact('Aisha Begum', 'https://www.linkedin.com/in/aisha-begum-77/', '', 'awaiting-reply', ago(9), { messagesSent: 2 }),
    mockContact('Dana Kirk', 'https://www.linkedin.com/in/dana-kirk-22/', '', 'awaiting-reply', ago(1), { messagesSent: 1 }),
    mockContact('Leo Barnes', 'https://www.linkedin.com/in/leo-barnes-4b/', '', 'awaiting-reply', ago(12), { messagesSent: 3 }),
    mockContact('Maya Rodriguez', 'https://www.linkedin.com/in/maya-rodriguez-8a2b/', 'https://mayarodriguez.com', 'in-conversation', ago(2), { needsReply: true }),
    mockContact('Tom Whitfield', 'https://www.linkedin.com/in/tom-whitfield/', 'https://whitfield.dev', 'in-conversation', ago(6), { meetingHeldDate: ago(5), proposalSentDate: ago(3) }),
    mockContact('Priya Nair', 'https://www.linkedin.com/in/priya-nair-70/', '', 'in-conversation', ago(9), { meetingHeldDate: ago(8) }),
    mockContact('Daniel Koh', 'https://www.linkedin.com/in/daniel-koh-991/', '', 'maybe-later', ago(30), { followUpDate: ago(1) }),
    mockContact('Sofia Marino', 'https://www.linkedin.com/in/sofia-marino-3c/', '', 'active-client', ago(60), { meetingHeldDate: ago(40), proposalSentDate: ago(30) }),
    mockContact('Yousufuddin Shaik', 'https://www.linkedin.com/in/yousufuddin-shaik-a4455427/', 'https://yousuforthopaedicmedicine.co.uk', 'went-cold', ago(45), { meetingHeldDate: ago(44) }),
    mockContact('Ben Carter', 'https://www.linkedin.com/in/ben-carter-19/', '', 'no-response', ago(35), { messagesSent: 3 }),
  ];

  const connections: Record<string, number> = {};
  for (let day = 0; day < 21; day++) {
    // A plausible working week: busy days, lighter days, nothing at weekends.
    const date = ago(day);
    const weekday = new Date(date).getDay();
    if (weekday === 0 || weekday === 6) continue;
    connections[date] = 28 + ((day * 13) % 34);
  }

  const listConnections = (): ConnectionDay[] =>
    Object.entries(connections)
      .map(([date, count]) => ({ date, count }))
      .sort((a, b) => a.date.localeCompare(b.date));

  return {
    listContacts: async () => contacts,
    addContact: async (input: AddContactInput) => {
      const contact = mockContact(
        input.name,
        input.linkedinUrl,
        input.websiteUrl,
        input.firstMessageSent ? 'awaiting-reply' : 'draft',
        today,
        { messagesSent: input.firstMessageSent ? 1 : 0 },
      );
      contact.notes = input.notes.trim();
      contacts.unshift(contact);
      return { ok: true as const, contact };
    },
    applyAction: async (contactId, actionId, followUpDate) => {
      const contact = contacts.find((c) => c.id === contactId) ?? null;
      if (!contact) return null;
      const action = getAction(contact.stage, actionId);
      if (!action) return null;

      contact.stage = action.to;
      contact.followUpDate =
        action.to === 'maybe-later'
          ? isIsoDate(followUpDate)
            ? followUpDate
            : defaultFollowUpDate(today)
          : null;
      if (action.sendsMessage) {
        contact.messagesSent += 1;
        contact.lastMessageDate = today;
      }
      if (action.milestone === 'meeting') contact.meetingHeldDate = today;
      if (action.milestone === 'proposal') contact.proposalSentDate = today;

      const entry: HistoryEntry = {
        date: today,
        text: action.log
          .replace('{followUp}', contact.followUpDate ? formatShort(contact.followUpDate) : '')
          .replace('{ordinal}', ordinalMessage(contact.messagesSent))
          .replace('{messages}', `${contact.messagesSent} messages`),
      };
      if (action.milestone) entry.milestone = action.milestone;
      else entry.stage = action.to;
      contact.history.push(entry);

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
    deleteContact: async (contactId) => {
      const index = contacts.findIndex((c) => c.id === contactId);
      if (index < 0) return false;
      contacts.splice(index, 1);
      return true;
    },
    saveDraft: async (contactId, text) => {
      const contact = contacts.find((c) => c.id === contactId);
      if (contact) contact.draft = text;
    },
    saveNotes: async (contactId, text) => {
      const contact = contacts.find((c) => c.id === contactId);
      if (contact) contact.notes = text;
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
      contact.messagesSent += 1;
      contact.lastMessageDate = today;
      contact.updatedAt = new Date().toISOString();
      return contact;
    },
    getQueue: async () => buildQueue(contacts),
    listConnections: async () => listConnections(),
    logConnection: async (delta) => {
      const next = Math.max(0, (connections[today] ?? 0) + Math.trunc(delta));
      if (next === 0) delete connections[today];
      else connections[today] = next;
      return listConnections();
    },
    setConnections: async (date, count) => {
      const next = Math.max(0, Math.round(count));
      if (next === 0) delete connections[date];
      else connections[date] = next;
      return listConnections();
    },
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
  overrides: Partial<Contact> = {},
): Contact {
  return {
    id: crypto.randomUUID(),
    teamhubTaskId: null,
    name,
    linkedinUrl,
    websiteUrl,
    stage,
    messagesSent: 1,
    lastMessageDate: since,
    meetingHeldDate: null,
    proposalSentDate: null,
    followUpDate: null,
    history: [{ date: since, text: 'First message sent', stage: 'awaiting-reply' }],
    pendingLines: [],
    importedNotes: '',
    notes: '',
    needsReply: false,
    draft: '',
    sync: { state: 'local-only' },
    createdAt: since,
    updatedAt: since,
    ...overrides,
  };
}

export const api: TrackerApi = window.tracker ?? createBrowserMock();
