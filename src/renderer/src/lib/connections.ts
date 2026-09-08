// Pure calculations behind the Connected page: the daily tally, how it
// compares day to day, and how it is tracking against the goal.
import type { ConnectionDay } from '../../../shared/types';
import { CONNECTIONS_DAILY_GOAL } from '../../../shared/stages';
import { addDaysIso, parseIsoDate, todayIso } from '../../../shared/dates';
import type { DateRange } from './analytics';

export function countOn(days: ConnectionDay[], date: string): number {
  return days.find((d) => d.date === date)?.count ?? 0;
}

// Every date in the range, zero-filled, oldest first. Charts need the empty
// days as much as the busy ones.
export function seriesFor(days: ConnectionDay[], range: DateRange): ConnectionDay[] {
  const byDate = new Map(days.map((d) => [d.date, d.count]));
  const series: ConnectionDay[] = [];
  for (let date = range.start; date <= range.end; date = addDaysIso(date, 1)) {
    series.push({ date, count: byDate.get(date) ?? 0 });
  }
  return series;
}

export function totalIn(days: ConnectionDay[], range: DateRange): number {
  return days
    .filter((d) => d.date >= range.start && d.date <= range.end)
    .reduce((sum, d) => sum + d.count, 0);
}

// The equally long stretch immediately before a range, for "vs previous".
export function previousRange(range: DateRange): DateRange {
  const length = daysBetween(range.start, range.end) + 1;
  return { start: addDaysIso(range.start, -length), end: addDaysIso(range.start, -1) };
}

function daysBetween(startIso: string, endIso: string): number {
  const ms = parseIsoDate(endIso).getTime() - parseIsoDate(startIso).getTime();
  return Math.round(ms / 86_400_000);
}

export interface ConnectionStats {
  total: number;
  previousTotal: number;
  // Percentage change against the previous stretch; null when there is no
  // previous activity to compare with.
  changePct: number | null;
  activeDays: number;
  averagePerActiveDay: number;
  bestDay: ConnectionDay | null;
  goalDays: number; // days the daily goal was met
  streak: number; // consecutive days up to today with any connections
}

export function statsFor(days: ConnectionDay[], range: DateRange): ConnectionStats {
  const series = seriesFor(days, range);
  const total = series.reduce((sum, d) => sum + d.count, 0);
  const active = series.filter((d) => d.count > 0);
  const previousTotal = totalIn(days, previousRange(range));
  const best = active.reduce<ConnectionDay | null>(
    (top, day) => (top === null || day.count > top.count ? day : top),
    null,
  );

  return {
    total,
    previousTotal,
    changePct: previousTotal === 0 ? null : Math.round(((total - previousTotal) / previousTotal) * 100),
    activeDays: active.length,
    averagePerActiveDay: active.length === 0 ? 0 : Math.round(total / active.length),
    bestDay: best,
    goalDays: series.filter((d) => d.count >= CONNECTIONS_DAILY_GOAL).length,
    streak: streakEndingToday(days),
  };
}

// Consecutive days with at least one connection, counting back from today.
// Today not being logged yet does not break yesterday's streak.
function streakEndingToday(days: ConnectionDay[]): number {
  const byDate = new Map(days.map((d) => [d.date, d.count]));
  const today = todayIso();
  let date = (byDate.get(today) ?? 0) > 0 ? today : addDaysIso(today, -1);
  let streak = 0;
  while ((byDate.get(date) ?? 0) > 0) {
    streak += 1;
    date = addDaysIso(date, -1);
  }
  return streak;
}

export { CONNECTIONS_DAILY_GOAL };
