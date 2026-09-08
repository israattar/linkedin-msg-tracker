// The connection counter. Connections are not contacts - at fifty a day
// nobody wants a card each - so this page is a tally: one big button, a
// running count against the daily goal, and the day-by-day numbers behind it.
import { useEffect, useMemo, useState } from 'react';
import type { ConnectionDay } from '../../../shared/types';
import { CONNECTIONS_DAILY_GOAL } from '../../../shared/stages';
import { formatShort, todayIso } from '../../../shared/dates';
import { api } from '../lib/api';
import { countOn, seriesFor, statsFor } from '../lib/connections';
import { rangeOfPastDays, type DateRange } from '../lib/analytics';

interface Props {
  connections: ConnectionDay[];
  refresh: () => Promise<void>;
}

type Preset = '7d' | '30d' | 'custom';

export default function ConnectedPage({ connections, refresh }: Props) {
  const [preset, setPreset] = useState<Preset>('7d');
  const [customStart, setCustomStart] = useState(rangeOfPastDays(14).start);
  const [customEnd, setCustomEnd] = useState(todayIso());
  const [editing, setEditing] = useState<string | null>(null);

  const today = todayIso();
  const todayCount = countOn(connections, today);
  const remaining = Math.max(0, CONNECTIONS_DAILY_GOAL - todayCount);
  const goalPct = Math.min(100, Math.round((todayCount / CONNECTIONS_DAILY_GOAL) * 100));

  const range: DateRange =
    preset === '7d'
      ? rangeOfPastDays(7)
      : preset === '30d'
        ? rangeOfPastDays(30)
        : { start: customStart, end: customEnd };

  const series = useMemo(() => seriesFor(connections, range), [connections, range]);
  const stats = useMemo(() => statsFor(connections, range), [connections, range]);
  const chartMax = Math.max(CONNECTIONS_DAILY_GOAL, ...series.map((d) => d.count));

  async function log(delta: number): Promise<void> {
    await api.logConnection(delta);
    await refresh();
  }

  async function correct(date: string, count: number): Promise<void> {
    await api.setConnections(date, count);
    setEditing(null);
    await refresh();
  }

  // Counting fifty a day by mouse alone is a chore: space and + add one, and
  // - takes one back. Ignored while a form field has the keyboard.
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent): void {
      const target = event.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT') return;
      if (event.key === ' ' || event.key === '+' || event.key === '=') {
        event.preventDefault();
        void log(1);
      }
      if (event.key === '-' || event.key === '_') {
        event.preventDefault();
        void log(-1);
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  });

  return (
    <div className="page-inner wide">
      <h1 className="page-title">Connected</h1>
      <p className="page-sub">
        Tap once per connection. The goal is {CONNECTIONS_DAILY_GOAL} a day.
      </p>

      <div className="tally-card card">
        <div className="tally-left">
          <div className="tally-count">{todayCount}</div>
          <div className="tally-of">
            of {CONNECTIONS_DAILY_GOAL} today
            <span className="tally-date">{formatShort(today)}</span>
          </div>
          <div className="goal-track">
            <div className={`goal-fill ${todayCount >= CONNECTIONS_DAILY_GOAL ? 'met' : ''}`} style={{ width: `${goalPct}%` }} />
          </div>
          <div className="tally-status">
            {todayCount >= CONNECTIONS_DAILY_GOAL
              ? `Goal met - ${todayCount - CONNECTIONS_DAILY_GOAL} over`
              : `${remaining} to go`}
          </div>
        </div>

        <div className="tally-right">
          <button className="tally-add" onClick={() => void log(1)}>
            <span className="plus">+1</span>
            <span className="sub">connected</span>
          </button>
          <div className="tally-keys">
            <button className="btn small quiet" disabled={todayCount === 0} onClick={() => void log(-1)}>
              Undo one
            </button>
            <span className="faint-text">
              <kbd>space</kbd> to add
            </span>
          </div>
        </div>
      </div>

      <div className="card">
        <div className="card-head">
          <div>
            <h3 className="card-title">Connections per day</h3>
            <p className="card-sub">
              {formatShort(range.start)} to {formatShort(range.end)}
            </p>
          </div>
          <div className="range-picker">
            <button className={`filter-chip ${preset === '7d' ? 'active' : ''}`} onClick={() => setPreset('7d')}>
              Past 7 days
            </button>
            <button className={`filter-chip ${preset === '30d' ? 'active' : ''}`} onClick={() => setPreset('30d')}>
              Past 30 days
            </button>
            <button className={`filter-chip ${preset === 'custom' ? 'active' : ''}`} onClick={() => setPreset('custom')}>
              Custom
            </button>
            {preset === 'custom' && (
              <>
                <input type="date" value={customStart} max={customEnd} onChange={(e) => setCustomStart(e.target.value)} />
                <input type="date" value={customEnd} min={customStart} onChange={(e) => setCustomEnd(e.target.value)} />
              </>
            )}
          </div>
        </div>

        <div className="stat-grid" style={{ marginBottom: 18 }}>
          <MiniStat label="Total connections" value={stats.total} accent />
          <MiniStat
            label="vs previous period"
            value={stats.changePct === null ? '-' : `${stats.changePct > 0 ? '+' : ''}${stats.changePct}%`}
            hint={`${stats.previousTotal} before`}
          />
          <MiniStat label="Average per active day" value={stats.averagePerActiveDay} />
          <MiniStat
            label="Best day"
            value={stats.bestDay?.count ?? 0}
            hint={stats.bestDay ? formatShort(stats.bestDay.date) : 'nothing logged'}
          />
          <MiniStat label={`Days at ${CONNECTIONS_DAILY_GOAL}+`} value={stats.goalDays} />
          <MiniStat label="Day streak" value={stats.streak} />
        </div>

        <div className="day-chart">
          {/* Spans the plot band exactly, so the goal sits at its own height
              among the bars rather than at a guessed offset. */}
          <div
            className="goal-line"
            style={{ ['--goal-pct' as string]: `${(CONNECTIONS_DAILY_GOAL / chartMax) * 100}%` }}
          >
            <span>goal {CONNECTIONS_DAILY_GOAL}</span>
          </div>
          {series.map((day) => (
            <button
              key={day.date}
              className={`dc-col ${day.count >= CONNECTIONS_DAILY_GOAL ? 'met' : ''} ${editing === day.date ? 'editing' : ''}`}
              title={`${day.count} on ${formatShort(day.date)} - click to correct`}
              onClick={() => setEditing(editing === day.date ? null : day.date)}
            >
              <span className="dc-value">{day.count > 0 ? day.count : ''}</span>
              <span className="dc-track">
                <span className="dc-bar" style={{ height: `${(day.count / chartMax) * 100}%` }} />
              </span>
              <span className="dc-label">{shortDay(day.date)}</span>
            </button>
          ))}
        </div>

        {editing && (
          <DayEditor
            date={editing}
            count={countOn(connections, editing)}
            onSave={(count) => void correct(editing, count)}
            onCancel={() => setEditing(null)}
          />
        )}
      </div>
    </div>
  );
}

// Correcting a day you miscounted, or filling one in after the fact.
function DayEditor({
  date,
  count,
  onSave,
  onCancel,
}: {
  date: string;
  count: number;
  onSave: (count: number) => void;
  onCancel: () => void;
}) {
  const [value, setValue] = useState(String(count));

  useEffect(() => {
    setValue(String(count));
  }, [date, count]);

  return (
    <div className="day-editor">
      <span className="lbl">{formatShort(date)}</span>
      <input
        type="number"
        min={0}
        value={value}
        autoFocus
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') onSave(Number(value));
          if (e.key === 'Escape') onCancel();
        }}
      />
      <button className="btn small primary" onClick={() => onSave(Number(value))}>
        Save count
      </button>
      <button className="btn small quiet" onClick={onCancel}>
        Cancel
      </button>
    </div>
  );
}

function MiniStat({
  label,
  value,
  hint,
  accent = false,
}: {
  label: string;
  value: number | string;
  hint?: string;
  accent?: boolean;
}) {
  return (
    <div className={`mini-stat ${accent ? 'accent' : ''}`}>
      <div className="value">{value}</div>
      <div className="label">{label}</div>
      {hint && <div className="hint">{hint}</div>}
    </div>
  );
}

// "Mon 8" - enough to find a day without crowding the axis.
function shortDay(iso: string): string {
  const date = new Date(iso);
  return date.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric' });
}
