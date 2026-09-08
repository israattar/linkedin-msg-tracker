// When someone is due something from you, and what that something is.
//
// One rule set, three readers: the Focus queue (main process), the Reply list
// (renderer) and the browser preview mock. Timers never move anyone on their
// own - they surface the contact and pre-select the move as one keypress.
import type { Contact, QueueItem } from './types';
import {
  CHASE_AFTER_FIRST_DAYS,
  CHASE_AFTER_SECOND_DAYS,
  CONVERSATION_QUIET_DAYS,
  GIVE_UP_AFTER_FINAL_DAYS,
  MAX_OUTREACH_MESSAGES,
  ordinalMessage,
} from './stages';
import { daysSince, formatShort, todayIso } from './dates';

export type DueKind =
  | 'follow-up' // a "maybe later" date has arrived
  | 'chase' // silence after a first or second message: send the next one
  | 'give-up' // silence after the final message: offer No response
  | 'quiet' // a live conversation has gone silent: follow up or mark cold
  | 'respond'; // they messaged you and are waiting on a reply

export interface DueItem {
  contact: Contact;
  kind: DueKind;
  reason: string;
  // Days of silence behind this item; 0 for date-driven follow-ups.
  days: number;
  // The action Focus and Reply offer as the obvious next press.
  suggestedActionId?: string;
}

// Days since the last message went out, falling back to the last logged
// activity for contacts imported without a message date.
export function daysSilent(contact: Contact): number {
  const last = contact.lastMessageDate ?? contact.history[contact.history.length - 1]?.date;
  return last ? Math.max(0, daysSince(last)) : 0;
}

// How long silence is allowed to run before the next message is due.
function chaseWait(messagesSent: number): number {
  return messagesSent >= 2 ? CHASE_AFTER_SECOND_DAYS : CHASE_AFTER_FIRST_DAYS;
}

export function dueFor(contact: Contact, today: string = todayIso()): DueItem | null {
  switch (contact.stage) {
    case 'maybe-later': {
      if (!contact.followUpDate || contact.followUpDate > today) return null;
      return {
        contact,
        kind: 'follow-up',
        reason: `Follow-up due ${formatShort(contact.followUpDate)}`,
        days: 0,
        suggestedActionId: 'followed-up',
      };
    }

    case 'awaiting-reply': {
      const days = daysSilent(contact);
      const sent = contact.messagesSent;

      // Out of messages: the decision is whether to let them go.
      if (sent >= MAX_OUTREACH_MESSAGES) {
        if (days < GIVE_UP_AFTER_FINAL_DAYS) return null;
        return {
          contact,
          kind: 'give-up',
          reason: `No reply ${days} days after the final message`,
          days,
          suggestedActionId: 'no-response',
        };
      }

      if (days < chaseWait(sent)) return null;
      const missed = ordinalMessage(sent).toLowerCase();
      const next = ordinalMessage(sent + 1).toLowerCase();
      return {
        contact,
        kind: 'chase',
        reason: `No reply to the ${missed} message in ${days} days - send the ${next}`,
        days,
        suggestedActionId: 'sent-another',
      };
    }

    case 'in-conversation': {
      // They wrote to you: that outranks any silence timer.
      if (contact.needsReply) {
        return {
          contact,
          kind: 'respond',
          reason: 'Waiting on your reply',
          days: daysSilent(contact),
          suggestedActionId: undefined,
        };
      }
      const days = daysSilent(contact);
      if (days < CONVERSATION_QUIET_DAYS) return null;
      return {
        contact,
        kind: 'quiet',
        reason: `No reply for ${days} days - follow up or let them go`,
        days,
        suggestedActionId: 'sent-follow-up',
      };
    }

    default:
      return null;
  }
}

// Everyone with something outstanding, most overdue first.
export function dueItems(contacts: Contact[], today: string = todayIso()): DueItem[] {
  const items: DueItem[] = [];
  for (const contact of contacts) {
    const due = dueFor(contact, today);
    if (due) items.push(due);
  }
  return items.sort(byUrgency);
}

// Date-driven follow-ups first (they were promised for today), then whoever
// has been waiting longest.
function byUrgency(a: DueItem, b: DueItem): number {
  if (a.kind === 'follow-up' && b.kind !== 'follow-up') return -1;
  if (b.kind === 'follow-up' && a.kind !== 'follow-up') return 1;
  if (a.kind === 'follow-up' && b.kind === 'follow-up') {
    return (a.contact.followUpDate ?? '').localeCompare(b.contact.followUpDate ?? '');
  }
  return b.days - a.days;
}

// The Focus queue: everything except "they are waiting on your reply", which
// is the Reply page's job.
export function buildQueue(contacts: Contact[], today: string = todayIso()): QueueItem[] {
  return dueItems(contacts, today)
    .filter((item) => item.kind !== 'respond')
    .map((item) => ({
      contactId: item.contact.id,
      reason: item.reason,
      suggestedActionId: item.suggestedActionId,
    }));
}

// The Reply page: everyone owed a message from you, for any reason.
export function replyDueItems(contacts: Contact[], today: string = todayIso()): DueItem[] {
  return dueItems(contacts, today).filter(
    (item) => item.kind === 'respond' || item.kind === 'chase' || item.kind === 'quiet',
  );
}
