// The message-back list: everyone currently waiting on a message from the
// user. Ticking someone either advances them (Connected people get their
// second message logged) or clears their reply flag. Each row also holds a
// private draft box for half-written messages.
import { useEffect, useRef, useState } from 'react';
import type { Contact } from '../../../shared/types';
import { daysSince } from '../../../shared/dates';
import { api } from '../lib/api';
import Avatar from '../components/Avatar';
import StageBadge from '../components/StageBadge';
import EmptyState from '../components/EmptyState';

interface Props {
  contacts: Contact[];
  refresh: () => Promise<void>;
}

interface ReplyItem {
  contact: Contact;
  reason: string;
  tickLabel: string;
}

// Who owes a message: Connected people (their second message is due) and
// anyone flagged as awaiting a reply, in-conversation or otherwise.
function buildReplyList(contacts: Contact[]): ReplyItem[] {
  const connected: ReplyItem[] = contacts
    .filter((c) => c.stage === 'connected')
    .map((c) => ({
      contact: c,
      reason: `Accepted your connection ${describeDays(c)} - second message due`,
      tickLabel: 'Second message sent',
    }));

  const flagged: ReplyItem[] = contacts
    .filter((c) => c.stage !== 'connected' && c.needsReply)
    .map((c) => ({
      contact: c,
      reason: 'Waiting on your reply',
      tickLabel: 'Messaged them back',
    }));

  const oldestFirst = (a: ReplyItem, b: ReplyItem) =>
    a.contact.updatedAt.localeCompare(b.contact.updatedAt);
  return [...connected.sort(oldestFirst), ...flagged.sort(oldestFirst)];
}

function describeDays(contact: Contact): string {
  const last = contact.history[contact.history.length - 1];
  const days = last ? daysSince(last.date) : 0;
  if (days === 0) return 'today';
  if (days === 1) return 'yesterday';
  return `${days} days ago`;
}

export default function ReplyPage({ contacts, refresh }: Props) {
  const items = buildReplyList(contacts);
  const [tickedToday, setTickedToday] = useState(0);
  const total = tickedToday + items.length;

  async function tick(item: ReplyItem): Promise<void> {
    const result =
      item.contact.stage === 'connected'
        ? await api.applyAction(item.contact.id, 'sent-second')
        : await api.markReplied(item.contact.id);
    if (result) setTickedToday((n) => n + 1);
    await refresh();
  }

  return (
    <div className="page-inner">
      <h1 className="page-title">Reply</h1>
      <p className="page-sub">Everyone waiting on a message from you. Nobody gets left on read.</p>

      {total > 0 && (
        <div className="queue-meter">
          <span>
            {tickedToday} of {total} messaged back
          </span>
          <div className="track">
            <div className="fill" style={{ width: total > 0 ? `${(tickedToday / total) * 100}%` : '0%' }} />
          </div>
          <span>{items.length} left</span>
        </div>
      )}

      {items.length === 0 ? (
        <div className="card" style={{ marginTop: 20 }}>
          <EmptyState title={tickedToday > 0 ? 'All messaged back, inbox zero' : 'Nobody is waiting on you'}>
            People appear here when they accept your connection or send you a message.
          </EmptyState>
        </div>
      ) : (
        <div style={{ marginTop: items.length > 0 && total === 0 ? 20 : 0 }}>
          {items.map((item) => (
            <ReplyRow key={item.contact.id} item={item} onTick={() => void tick(item)} />
          ))}
        </div>
      )}
    </div>
  );
}

function ReplyRow({ item, onTick }: { item: ReplyItem; onTick: () => void }) {
  const { contact } = item;
  const [showDraft, setShowDraft] = useState(contact.draft.length > 0);

  return (
    <div className="reply-row">
      <div className="reply-main">
        <Avatar name={contact.name} size={38} />
        <div className="grow">
          <div className="name">{contact.name}</div>
          <div className="meta">{item.reason}</div>
        </div>
        <StageBadge stage={contact.stage} />
        <a
          className="btn small quiet"
          href={contact.linkedinUrl}
          target="_blank"
          rel="noreferrer"
        >
          Open LinkedIn
        </a>
        <button className="btn small" onClick={() => setShowDraft((v) => !v)}>
          {contact.draft ? 'Draft saved' : 'Draft'}
        </button>
        <button className="btn small lime" onClick={onTick}>
          {item.tickLabel}
        </button>
      </div>
      {showDraft && <DraftBox contact={contact} />}
    </div>
  );
}

// Auto-saving scratchpad for a half-written message. Saves shortly after
// typing stops; Copy puts it on the clipboard ready to paste into LinkedIn.
function DraftBox({ contact }: { contact: Contact }) {
  const [text, setText] = useState(contact.draft);
  const [state, setState] = useState<'idle' | 'saving' | 'saved' | 'copied'>('idle');
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);

  function onChange(value: string): void {
    setText(value);
    setState('saving');
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      void api.saveDraft(contact.id, value).then(() => setState('saved'));
    }, 500);
  }

  async function copy(): Promise<void> {
    await navigator.clipboard.writeText(text);
    setState('copied');
  }

  return (
    <div className="draft-box">
      <textarea
        value={text}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Draft your message here, it saves itself..."
        rows={4}
      />
      <div className="draft-foot">
        <span className="faint-text">
          {state === 'saving' && 'Saving...'}
          {state === 'saved' && 'Saved'}
          {state === 'copied' && 'Copied to clipboard'}
        </span>
        <button className="btn small quiet" disabled={text.length === 0} onClick={() => void copy()}>
          Copy message
        </button>
      </div>
    </div>
  );
}
