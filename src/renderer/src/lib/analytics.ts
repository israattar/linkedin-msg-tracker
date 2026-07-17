// Pure calculations behind the Analytics page. Everything derives from the
// contact list: history entries record the stage they moved a contact into,
// so counting "who entered X during Y" is a filter over those entries.
import type { Contact, Stage } from '../../../shared/types';
import { PIPELINE_ORDER } from '../../../shared/stages';
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

export function currentCounts(contacts: Contact[]): Map<Stage, number> {
  const counts = new Map<Stage, number>();
  for (const contact of contacts) {
    counts.set(contact.stage, (counts.get(contact.stage) ?? 0) + 1);
  }
  return counts;
}

// "Met and went cold": had a meeting at some point, now sitting in Went cold.
export function metThenWentCold(contacts: Contact[]): number {
  return contacts.filter(
    (c) => c.stage === 'went-cold' && c.history.some((h) => h.stage === 'meeting-held'),
  ).length;
}

function pipelineIndex(stage: Stage): number {
  return PIPELINE_ORDER.indexOf(stage);
}

// A contact "reached" a pipeline stage if it is at or past it now, or ever
// passed through it. Imported contacts count from their imported stage, so
// earlier stages they skipped are credited too.
function furthestIndex(contact: Contact): number {
  let furthest = pipelineIndex(contact.stage);
  for (const entry of contact.history) {
    if (!entry.stage) continue;
    furthest = Math.max(furthest, pipelineIndex(entry.stage));
  }
  return furthest;
}

export function reachedCount(contacts: Contact[], stage: Stage): number {
  const index = pipelineIndex(stage);
  return contacts.filter((c) => furthestIndex(c) >= index).length;
}

export interface FunnelStep {
  stage: Stage;
  count: number;
  // Conversion from the previous pipeline stage, 0-100. Null for the first step.
  fromPrevious: number | null;
}

export function funnel(contacts: Contact[]): FunnelStep[] {
  let previous: number | null = null;
  return PIPELINE_ORDER.map((stage) => {
    const count = reachedCount(contacts, stage);
    const fromPrevious =
      previous === null ? null : previous === 0 ? 0 : Math.round((count / previous) * 100);
    previous = count;
    return { stage, count, fromPrevious };
  });
}

export interface WeekBucket {
  label: string; // e.g. "6 Jul"
  count: number;
}

// Stage moves per week across a range, for the activity bar chart.
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
  added: number;
  connections: number;
  conversations: number;
  meetings: number;
  proposals: number;
  clientsWon: number;
}

export function activityInRange(contacts: Contact[], range: DateRange): RangeActivity {
  return {
    added: enteredStage(contacts, 'first-msg', range),
    connections: enteredStage(contacts, 'connected', range),
    conversations: enteredStage(contacts, 'in-conversation', range),
    meetings: enteredStage(contacts, 'meeting-held', range),
    proposals: enteredStage(contacts, 'proposal-sent', range),
    clientsWon: enteredStage(contacts, 'active-client', range),
  };
}

export interface Insights {
  connectionRate: number | null; // first msg -> connected
  conversationRate: number | null; // second msg -> in conversation
  closeRate: number | null; // proposal -> client
  avgDaysToClient: number | null;
  draftsPending: number;
}

function percentage(part: number, whole: number): number | null {
  if (whole === 0) return null;
  return Math.round((part / whole) * 100);
}

export function insights(contacts: Contact[]): Insights {
  const avgDays = averageDaysToClient(contacts);
  return {
    connectionRate: percentage(reachedCount(contacts, 'connected'), reachedCount(contacts, 'first-msg')),
    conversationRate: percentage(
      reachedCount(contacts, 'in-conversation'),
      reachedCount(contacts, 'second-msg'),
    ),
    closeRate: percentage(
      reachedCount(contacts, 'active-client'),
      reachedCount(contacts, 'proposal-sent'),
    ),
    avgDaysToClient: avgDays,
    draftsPending: contacts.filter((c) => c.draft.trim().length > 0).length,
  };
}

// Mean days from first message to becoming a client, for contacts where both
// dates are known.
function averageDaysToClient(contacts: Contact[]): number | null {
  const spans: number[] = [];
  for (const contact of contacts) {
    const first = contact.history.find((h) => h.stage === 'first-msg');
    const won = contact.history.find((h) => h.stage === 'active-client');
    if (!first || !won) continue;
    const days =
      (parseIsoDate(won.date).getTime() - parseIsoDate(first.date).getTime()) / 86_400_000;
    if (days >= 0) spans.push(days);
  }
  if (spans.length === 0) return null;
  return Math.round(spans.reduce((a, b) => a + b, 0) / spans.length);
}
