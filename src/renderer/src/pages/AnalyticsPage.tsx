// Dashboards over the pipeline: fixed-window headline numbers, the current
// state of every stage, the conversion funnel, activity over a chosen date
// range, and derived rates that point at what to improve.
import { useMemo, useState } from 'react';
import type { ConnectionDay, Contact } from '../../../shared/types';
import { formatShort } from '../../../shared/dates';
import {
  activityInRange,
  currentCounts,
  enteredStage,
  funnel,
  insights,
  metThenWentCold,
  passedMilestone,
  rangeOfPastDays,
  weeklyActivity,
  type DateRange,
} from '../lib/analytics';
import { totalIn } from '../lib/connections';
import EmptyState from '../components/EmptyState';

interface Props {
  contacts: Contact[];
  connections: ConnectionDay[];
}

type Preset = '7d' | '30d' | 'custom';

export default function AnalyticsPage({ contacts, connections }: Props) {
  const [preset, setPreset] = useState<Preset>('30d');
  const [customStart, setCustomStart] = useState(rangeOfPastDays(30).start);
  const [customEnd, setCustomEnd] = useState(rangeOfPastDays(1).end);

  const range: DateRange =
    preset === '7d'
      ? rangeOfPastDays(7)
      : preset === '30d'
        ? rangeOfPastDays(30)
        : { start: customStart, end: customEnd };

  const tracked = useMemo(() => contacts.filter((c) => c.stage !== 'draft'), [contacts]);
  const counts = useMemo(() => currentCounts(tracked), [tracked]);
  const steps = useMemo(() => funnel(tracked), [tracked]);
  const activity = useMemo(() => activityInRange(tracked, range), [tracked, range]);
  const weeks = useMemo(() => weeklyActivity(tracked, range), [tracked, range]);
  const derived = useMemo(() => insights(tracked), [tracked]);
  const allTimeConnections = connections.reduce((sum, day) => sum + day.count, 0);

  if (tracked.length === 0) {
    return (
      <div className="page-inner wide">
        <h1 className="page-title">Analytics</h1>
        <p className="page-sub">Numbers appear once there are contacts in the pipeline.</p>
        <div className="card" style={{ marginTop: 24 }}>
          <EmptyState title="Nothing to count yet">
            Add contacts or import your board, then check back here.
          </EmptyState>
        </div>
      </div>
    );
  }

  const maxWeek = Math.max(1, ...weeks.map((w) => w.count));
  const maxFunnel = Math.max(1, steps[0]?.count ?? 1);

  return (
    <div className="page-inner wide">
      <h1 className="page-title">Analytics</h1>
      <p className="page-sub">How the pipeline is really doing.</p>

      <div className="stat-row">
        <div className="card stat-multi">
          <div className="label">New people messaged</div>
          <div className="cells">
            <Cell value={enteredStage(tracked, 'awaiting-reply', rangeOfPastDays(7))} hint="past 7 days" />
            <Cell value={enteredStage(tracked, 'awaiting-reply', rangeOfPastDays(10))} hint="past 10 days" />
            <Cell value={enteredStage(tracked, 'awaiting-reply', rangeOfPastDays(30))} hint="past 30 days" />
          </div>
        </div>
        <div className="card stat-multi">
          <div className="label">Connections made</div>
          <div className="cells">
            <Cell value={totalIn(connections, rangeOfPastDays(7))} hint="past 7 days" />
            <Cell value={totalIn(connections, rangeOfPastDays(30))} hint="past 30 days" />
            <Cell value={allTimeConnections} hint="all time" />
          </div>
        </div>
      </div>

      <h2 className="section-label">Right now</h2>
      <div className="stat-grid">
        <MiniStat label="Awaiting reply" value={counts.get('awaiting-reply') ?? 0} />
        <MiniStat label="Talking to you" value={counts.get('in-conversation') ?? 0} />
        <MiniStat label="Met, still talking" value={inConversationWith(tracked, 'meeting')} />
        <MiniStat label="Proposal out" value={inConversationWith(tracked, 'proposal')} />
        <MiniStat label="Active clients" value={counts.get('active-client') ?? 0} accent />
        <MiniStat label="Maybe later" value={counts.get('maybe-later') ?? 0} />
        <MiniStat label="No response" value={counts.get('no-response') ?? 0} loss />
        <MiniStat label="Went cold" value={counts.get('went-cold') ?? 0} loss />
        <MiniStat label="Met, then went cold" value={metThenWentCold(tracked)} loss />
        <MiniStat label="Not interested" value={counts.get('not-interested') ?? 0} loss />
      </div>

      <div className="card" style={{ marginBottom: 14 }}>
        <h3 className="card-title">Funnel, all time</h3>
        <p className="card-sub">
          How many people got this far, and the conversion from the step before.
        </p>
        <div className="funnel">
          {steps.map((step) => (
            <div key={step.key} className="funnel-row">
              <span className="f-label">{step.label}</span>
              <div className="f-track">
                <div
                  className={`f-bar ${step.key === 'client' ? 'win' : ''}`}
                  style={{ width: `${Math.max(2, (step.count / maxFunnel) * 100)}%` }}
                />
              </div>
              <span className="f-count">{step.count}</span>
              <span className="f-pct">
                {step.fromPrevious === null ? '' : `${step.fromPrevious}%`}
              </span>
            </div>
          ))}
        </div>
      </div>

      <div className="card" style={{ marginBottom: 14 }}>
        <div className="card-head">
          <div>
            <h3 className="card-title">Activity</h3>
            <p className="card-sub">
              {formatShort(range.start)} to {formatShort(range.end)}
            </p>
          </div>
          <div className="range-picker">
            <button
              className={`filter-chip ${preset === '7d' ? 'active' : ''}`}
              onClick={() => setPreset('7d')}
            >
              Past 7 days
            </button>
            <button
              className={`filter-chip ${preset === '30d' ? 'active' : ''}`}
              onClick={() => setPreset('30d')}
            >
              Past 30 days
            </button>
            <button
              className={`filter-chip ${preset === 'custom' ? 'active' : ''}`}
              onClick={() => setPreset('custom')}
            >
              Custom
            </button>
            {preset === 'custom' && (
              <>
                <input
                  type="date"
                  value={customStart}
                  max={customEnd}
                  onChange={(e) => setCustomStart(e.target.value)}
                />
                <input
                  type="date"
                  value={customEnd}
                  min={customStart}
                  onChange={(e) => setCustomEnd(e.target.value)}
                />
              </>
            )}
          </div>
        </div>

        <div className="stat-grid" style={{ marginBottom: 18 }}>
          <MiniStat label="Messaged" value={activity.messaged} />
          <MiniStat label="Connections" value={totalIn(connections, range)} />
          <MiniStat label="Replies" value={activity.replies} />
          <MiniStat label="Meetings" value={activity.meetings} />
          <MiniStat label="Proposals" value={activity.proposals} />
          <MiniStat label="Clients won" value={activity.clientsWon} accent />
          <MiniStat label="Lost or parked" value={activity.lost} loss />
        </div>

        <div className="week-chart">
          {weeks.map((week, index) => (
            <div key={index} className="wc-col" title={`${week.count} moves, week of ${week.label}`}>
              <div className="wc-bar" style={{ height: `${(week.count / maxWeek) * 100}%` }} />
              <span className="wc-label">{week.label}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="card">
        <h3 className="card-title">What the numbers say</h3>
        <div className="insight-list">
          <Insight
            label="Reply rate"
            value={ratio(derived.replyRate)}
            hint="of everyone messaged who wrote back"
          />
          <Insight
            label="Meeting rate"
            value={ratio(derived.meetingRate)}
            hint="of conversations that reach a meeting"
          />
          <Insight
            label="Close rate"
            value={ratio(derived.closeRate)}
            hint="of proposals that become clients"
          />
          <Insight
            label="Messages to a reply"
            value={derived.avgMessagesToReply === null ? 'n/a' : String(derived.avgMessagesToReply)}
            hint="average sent before they answered"
          />
          <Insight
            label="Average time to client"
            value={derived.avgDaysToClient === null ? 'n/a' : `${derived.avgDaysToClient} days`}
            hint="from first message to signing"
          />
          <Insight
            label="Drafts waiting"
            value={String(derived.draftsPending)}
            hint="half-written messages on the Reply page"
          />
        </div>
      </div>
    </div>
  );
}

// Milestones counted only for live conversations, which is what "right now"
// means on this page.
function inConversationWith(contacts: Contact[], milestone: 'meeting' | 'proposal'): number {
  return passedMilestone(
    contacts.filter((c) => c.stage === 'in-conversation'),
    milestone,
  );
}

function ratio(value: number | null): string {
  return value === null ? 'n/a' : `${value}%`;
}

function Cell({ value, hint }: { value: number; hint: string }) {
  return (
    <div className="cell">
      <div className="value">{value}</div>
      <div className="hint">{hint}</div>
    </div>
  );
}

function MiniStat({
  label,
  value,
  accent = false,
  loss = false,
}: {
  label: string;
  value: number;
  accent?: boolean;
  // People the pipeline lost. Worth reading in a different colour from the wins.
  loss?: boolean;
}) {
  return (
    <div className={`mini-stat ${accent ? 'accent' : ''} ${loss ? 'loss' : ''}`}>
      <div className="value">{value}</div>
      <div className="label">{label}</div>
    </div>
  );
}

function Insight({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <div className="insight">
      <span className="i-value">{value}</span>
      <span className="i-label">{label}</span>
      <span className="i-hint">{hint}</span>
    </div>
  );
}
