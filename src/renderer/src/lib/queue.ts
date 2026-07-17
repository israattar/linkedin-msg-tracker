// Queue rules mirrored for the browser mock. In the desktop app the queue is
// built in the main process (src/main/ipc.ts) with identical rules.
import type { Contact, QueueItem } from '../../../shared/types';
import { STALE_FIRST_MSG_DAYS } from '../../../shared/stages';
import { daysSince, formatShort, todayIso } from '../../../shared/dates';

export function buildQueueView(contacts: Contact[]): QueueItem[] {
  const today = todayIso();

  const due = contacts
    .filter((c) => c.stage === 'maybe-later' && c.followUpDate !== null && c.followUpDate <= today)
    .map((c) => ({ contactId: c.id, reason: `Follow-up due ${formatShort(c.followUpDate ?? today)}` }));

  const stale = contacts
    .filter((c) => {
      if (c.stage !== 'first-msg') return false;
      const last = c.history[c.history.length - 1];
      return last ? daysSince(last.date) >= STALE_FIRST_MSG_DAYS : false;
    })
    .map((c) => {
      const last = c.history[c.history.length - 1];
      return { contactId: c.id, reason: `No reply for ${last ? daysSince(last.date) : 0} days` };
    });

  return [...due, ...stale];
}
