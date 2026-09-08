// Date helpers. Dates are stored as local ISO dates (YYYY-MM-DD) and only
// converted to full timestamps when talking to the Team Hub API.
import type { HistoryEntry } from './types';

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

export function toIsoDate(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function todayIso(): string {
  return toIsoDate(new Date());
}

// Parse YYYY-MM-DD as a local date (new Date("YYYY-MM-DD") would parse as UTC).
export function parseIsoDate(iso: string): Date {
  const [year, month, day] = iso.split('-').map(Number);
  return new Date(year, month - 1, day);
}

export function addMonthsIso(iso: string, months: number): string {
  const date = parseIsoDate(iso);
  date.setMonth(date.getMonth() + months);
  return toIsoDate(date);
}

export function addDaysIso(iso: string, days: number): string {
  const date = parseIsoDate(iso);
  date.setDate(date.getDate() + days);
  return toIsoDate(date);
}

// True for a well-formed local ISO date that is also a real calendar day, so
// "2026-02-31" is rejected rather than silently rolling into March.
export function isIsoDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  return toIsoDate(parseIsoDate(value)) === value;
}

export function daysSince(iso: string): number {
  const ms = Date.now() - parseIsoDate(iso).getTime();
  return Math.floor(ms / 86_400_000);
}

// "2026-07-14" -> "14 Jul 2026"
export function formatShort(iso: string): string {
  return parseIsoDate(iso).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

// One line of the dated log kept in each Team Hub card description.
export function formatLogLine(entry: HistoryEntry): string {
  return `${formatShort(entry.date)} - ${entry.text}`;
}

// Follow-up dates sync to Team Hub as a 9am local due time.
export function isoDateToDueDateTime(iso: string): string {
  const date = parseIsoDate(iso);
  date.setHours(9, 0, 0, 0);
  return date.toISOString();
}
