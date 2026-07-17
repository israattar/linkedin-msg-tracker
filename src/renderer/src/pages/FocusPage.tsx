// Focus mode: the day's follow-ups, one contact at a time, cleared with
// number keys. 1-9 pick an action, S skips, Z undoes the last move.
import { useEffect, useMemo, useState } from 'react';
import type { Contact, QueueItem } from '../../../shared/types';
import { PIPELINE_ORDER, STAGES } from '../../../shared/stages';
import { formatLogLine } from '../../../shared/dates';
import { api } from '../lib/api';
import Avatar from '../components/Avatar';
import StageBadge from '../components/StageBadge';
import ActionButtons from '../components/ActionButtons';
import EmptyState from '../components/EmptyState';

interface Props {
  contacts: Contact[];
  queue: QueueItem[];
  refresh: () => Promise<void>;
}

export default function FocusPage({ contacts, queue, refresh }: Props) {
  const [skippedIds, setSkippedIds] = useState<string[]>([]);
  const [clearedToday, setClearedToday] = useState(0);

  const contactById = useMemo(
    () => new Map(contacts.map((c) => [c.id, c])),
    [contacts],
  );

  const remaining = queue.filter((item) => !skippedIds.includes(item.contactId));
  const currentItem = remaining[0] ?? null;
  const current = currentItem ? (contactById.get(currentItem.contactId) ?? null) : null;
  const total = clearedToday + queue.length;

  async function act(actionId: string): Promise<void> {
    if (!current) return;
    const result = await api.applyAction(current.id, actionId);
    if (result) setClearedToday((n) => n + 1);
    await refresh();
  }

  function skip(): void {
    if (!current) return;
    setSkippedIds((ids) => [...ids, current.id]);
  }

  async function undo(): Promise<void> {
    const restored = await api.undoLastAction();
    if (!restored) return;
    setClearedToday((n) => Math.max(0, n - 1));
    await refresh();
  }

  // Keyboard shortcuts. Disabled while typing in a form field.
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent): void {
      const target = event.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'SELECT' || target.tagName === 'TEXTAREA') return;

      if (event.key === 's' || event.key === 'S') {
        skip();
        return;
      }
      if (event.key === 'z' || event.key === 'Z') {
        void undo();
        return;
      }
      if (!current) return;
      const index = Number(event.key) - 1;
      const actions = STAGES[current.stage].actions;
      if (index >= 0 && index < actions.length) {
        void act(actions[index].id);
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  });

  if (!current) {
    return (
      <div className="page-inner">
        <h1 className="page-title">Focus</h1>
        <p className="page-sub">Everyone who needs an action today, one at a time.</p>
        <div className="card" style={{ marginTop: 24 }}>
          <EmptyState title={clearedToday > 0 ? 'Queue cleared, nice work' : 'Nothing needs a follow-up today'}>
            {skippedIds.length > 0
              ? `${skippedIds.length} skipped, they will be back tomorrow.`
              : 'New follow-ups appear here when they come due.'}
          </EmptyState>
        </div>
      </div>
    );
  }

  const pipelineIndex = PIPELINE_ORDER.indexOf(current.stage);
  const recentLog = current.history.slice(-3).reverse();
  const nextUp = remaining.slice(1, 3);

  return (
    <div className="page-inner">
      <h1 className="page-title">Focus</h1>
      <p className="page-sub">Everyone who needs an action today, one at a time.</p>

      <div className="queue-meter">
        <span>
          {clearedToday} of {total} cleared
        </span>
        <div className="track">
          <div className="fill" style={{ width: total > 0 ? `${(clearedToday / total) * 100}%` : '0%' }} />
        </div>
        <span>{remaining.length} left</span>
      </div>

      <div className="card focus-card">
        <div className="focus-head">
          <Avatar name={current.name} size={52} />
          <div className="who">
            <div className="name">{current.name}</div>
            <div className="links">
              <a href={current.linkedinUrl} target="_blank" rel="noreferrer">
                LinkedIn profile
              </a>
              {current.websiteUrl && (
                <a href={current.websiteUrl} target="_blank" rel="noreferrer">
                  Website
                </a>
              )}
            </div>
          </div>
          <StageBadge stage={current.stage} />
        </div>

        <div className="reason-chip">{currentItem?.reason}</div>

        {pipelineIndex >= 0 && (
          <div className="pipeline-dots">
            {PIPELINE_ORDER.map((stage, index) => (
              <span
                key={stage}
                className={`dot ${index < pipelineIndex ? 'done' : ''} ${index === pipelineIndex ? 'current' : ''}`}
              />
            ))}
            <span className="label">{STAGES[current.stage].label}</span>
          </div>
        )}

        {recentLog.length > 0 && (
          <div className="focus-log">
            {recentLog.map((entry, index) => (
              <div key={index} className="line">
                {formatLogLine(entry)}
              </div>
            ))}
          </div>
        )}

        <ActionButtons contact={current} onAct={(id) => void act(id)} />

        <div className="focus-foot">
          <span>
            <kbd>S</kbd> skip
          </span>
          <span>
            <kbd>Z</kbd> undo
          </span>
          <span className="spacer" />
          <button className="btn quiet small" onClick={skip}>
            Skip for today
          </button>
        </div>
      </div>

      {nextUp.length > 0 && (
        <div className="next-up">
          {nextUp.map((item) => {
            const contact = contactById.get(item.contactId);
            return (
              <div key={item.contactId} className="peek">
                Next: {contact?.name ?? 'Unknown'} — {item.reason}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
