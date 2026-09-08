// Pure calculations behind the Analytics page. Everything derives from the
// contact list: history entries record the stage they moved a contact into and
// the milestones they passed, so "who did X during Y" is a filter over those
// entries.
import type { Contact, Milestone, Stage } from '../../../shared/types';
import { parseIsoDate, toIsoDate, todayIso } from '../../../shared/dates';

export interface DateRange {
  start: string; // inclusive ISO date
  end: string; // inclusive ISO date
}

export function rangeOfPastDays(days: number): DateRange {
  const start = new Date();
  start.setDate(start.getDate() - (days - 1));
  return { start: toIsoDate(start), end: todayIso() };
}

function inRange(date: string, range?: DateRange): boolean {
  if (!range) return true;
  return date >= range.start && date <= range.end;
}

// Unique contacts that entered a stage, optionally within a range.
export function enteredStage(contacts: Contact[], stage: Stage, range?: DateRange): number {
  return contacts.filter((c) =>
    c.history.some((h) => h.stage === stage && inRange(h.date, range)),
  ).length;
}

// Unique contacts that passed a milestone, optionally within a range. Falls
// back to the date on the contact for records imported without a log line.
export function passedMilestone(
  contacts: Contact[],
  milestone: Milestone,
  range?: DateRange,
): number {
  return contacts.filter((c) => {
    if (c.history.some((h) => h.milestone === milestone && inRange(h.date, range))) return true;
    const date = milestoneDate(c, milestone);
    return date !== null && inRange(date, range);
  }).length;
}

export function milestoneDate(contact: Contact, milestone: Milestone): string | null {
  return milestone === 'meeting' ? contact.meetingHeldDate : contact.proposalSentDate;
}

export function currentCounts(contacts: Contact[]): Map<Stage, number> {
  const counts = new Map<Stage, number>();
  for (const contact of contacts) {
    counts.set(contact.stage, (counts.get(contact.stage) ?? 0) + 1);
  }
  return counts;
}

// "Met and went cold": had a meeting at some point, now sitting in Went cold.
export function metThenWentCold(contacts: Contact[]): number {
  return contacts.filter((c) => c.stage === 'went-cold' && hasMilestone(c, 'meeting')).length;
}

function hasMilestone(contact: Contact, milestone: Milestone): boolean {
  return (
    milestoneDate(contact, milestone) !== null ||
    contact.history.some((h) => h.milestone === milestone)
  );
}

// The funnel mixes stages and milestones, because that is how the pipeline
// actually narrows: everyone messaged, the ones who wrote back, the ones who
// took a meeting, the ones who got a proposal, the ones who signed.
export type FunnelKey = 'messaged' | 'replied' | 'meeting' | 'proposal' | 'client';

export const FUNNEL_LABELS: Record<FunnelKey, string> = {
  messaged: 'Messaged',
  replied: 'Replied',
  meeting: 'Meeting held',
  proposal: 'Proposal sent',
  client: 'Active client',
};

const FUNNEL_ORDER: FunnelKey[] = ['messaged', 'replied', 'meeting', 'proposal', 'client'];

// Whether a contact ever got this far, whatever they did afterwards.
export function reached(contact: Contact, key: FunnelKey): boolean {
  switch (key) {
    case 'messaged':
      return contact.stage !== 'draft' || contact.messagesSent > 0;
    case 'replied':
      return (
        contact.stage === 'in-conversation' ||
        contact.stage === 'active-client' ||
        contact.stage === 'went-cold' ||
        contact.history.some((h) => h.stage === 'in-conversation')
      );
    case 'meeting':
      return hasMilestone(contact, 'meeting');
    case 'proposal':
      return hasMilestone(contact, 'proposal');
    case 'client':
      return contact.stage === 'active-client' || contact.history.some((h) => h.stage === 'active-client');
  }
}

export function reachedCount(contacts: Contact[], key: FunnelKey): number {
  return contacts.filter((c) => reached(c, key)).length;
}

export interface FunnelStep {
  key: FunnelKey;
  label: string;
  count: number;
  // Conversion from the previous step, 0-100. Null for the first step.
  fromPrevious: number | null;
}

export function funnel(contacts: Contact[]): FunnelStep[] {
  let previous: number | null = null;
  return FUNNEL_ORDER.map((key) => {
    const count = reachedCount(contacts, key);
    const fromPrevious =
      previous === null ? null : previous === 0 ? 0 : Math.round((count / previous) * 100);
    previous = count;
    return { key, label: FUNNEL_LABELS[key], count, fromPrevious };
  });
}

export interface WeekBucket {
  label: string; // e.g. "6 Jul"
  count: number;
}

// Logged moves per week across a range, for the activity bar chart.
export function weeklyActivity(contacts: Contact[], range: DateRange): WeekBucket[] {
  const start = startOfWeek(parseIsoDate(range.start));
  const end = parseIsoDate(range.end);
  const buckets: { weekStart: Date; count: number }[] = [];
  for (let week = new Date(start); week <= end; week.setDate(week.getDate() + 7)) {
    buckets.push({ weekStart: new Date(week), count: 0 });
  }

  for (const contact of contacts) {
    for (const entry of contact.history) {
      if (!inRange(entry.date, range)) continue;
      const week = startOfWeek(parseIsoDate(entry.date));
      const bucket = buckets.find((b) => b.weekStart.getTime() === week.getTime());
      if (bucket) bucket.count += 1;
    }
  }

  return buckets.map((b) => ({
    label: b.weekStart.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }),
    count: b.count,
  }));
}

function startOfWeek(date: Date): Date {
  const result = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const day = (result.getDay() + 6) % 7; // Monday = 0
  result.setDate(result.getDate() - day);
  return result;
}

export interface RangeActivity {
  messaged: number;
  replies: number;
  meetings: number;
  proposals: number;
  clientsWon: number;
  lost: number;
}

export function activityInRange(contacts: Contact[], range: DateRange): RangeActivity {
  return {
    messaged: enteredStage(contacts, 'awaiting-reply', range),
    replies: enteredStage(contacts, 'in-conversation', range),
    meetings: passedMilestone(contacts, 'meeting', range),
    proposals: passedMilestone(contacts, 'proposal', range),
    clientsWon: enteredStage(contacts, 'active-client', range),
    lost:
      enteredStage(contacts, 'no-response', range) +
      enteredStage(contacts, 'went-cold', range) +
      enteredStage(contacts, 'not-interested', range),
  };
}

export interface Insights {
  replyRate: number | null; // messaged -> replied
  meetingRate: number | null; // replied -> meeting held
  closeRate: number | null; // proposal -> client
  avgMessagesToReply: number | null;
  avgDaysToClient: number | null;
  draftsPending: number;
}

function percentage(part: number, whole: number): number | null {
  if (whole === 0) return null;
  return Math.round((part / whole) * 100);
}

export function insights(contacts: Contact[]): Insights {
  return {
    replyRate: percentage(reachedCount(contacts, 'replied'), reachedCount(contacts, 'messaged')),
    meetingRate: percentage(reachedCount(contacts, 'meeting'), reachedCount(contacts, 'replied')),
    closeRate: percentage(reachedCount(contacts, 'client'), reachedCount(contacts, 'proposal')),
    avgMessagesToReply: averageMessagesToReply(contacts),
    avgDaysToClient: averageDaysToClient(contacts),
    draftsPending: contacts.filter((c) => c.draft.trim().length > 0).length,
  };
}

// How many messages it usually takes before someone writes back. Only counts
// contacts who did reply, since the silent ones have no answer yet.
function averageMessagesToReply(contacts: Contact[]): number | null {
  const counts = contacts.filter((c) => reached(c, 'replied')).map((c) => c.messagesSent);
  if (counts.length === 0) return null;
  return Math.round((counts.reduce((a, b) => a + b, 0) / counts.length) * 10) / 10;
}

// Mean days from first message to becoming a client, for contacts where both
// dates are known.
function averageDaysToClient(contacts: Contact[]): number | null {
  const spans: number[] = [];
  for (const contact of contacts) {
    const first = contact.history.find((h) => h.stage === 'awaiting-reply');
    const won = contact.history.find((h) => h.stage === 'active-client');
    if (!first || !won) continue;
    const days =
      (parseIsoDate(won.date).getTime() - parseIsoDate(first.date).getTime()) / 86_400_000;
    if (days >= 0) spans.push(days);
  }
  if (spans.length === 0) return null;
  return Math.round(spans.reduce((a, b) => a + b, 0) / spans.length);
}
