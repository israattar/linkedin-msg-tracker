// The message-back list: everyone currently owed a message from you, whether
// they wrote to you, never answered your last one, or have simply gone quiet.
// The rules live in shared/cadence so Focus and Reply always agree on who is
// due what. Each row holds a private draft box for half-written messages.
import { useEffect, useRef, useState } from 'react';
import type { Contact } from '../../../shared/types';
import { type DueItem, replyDueItems } from '../../../shared/cadence';
import { ordinalMessage } from '../../../shared/stages';
import { api } from '../lib/api';
import Avatar from '../components/Avatar';
import StageBadge from '../components/StageBadge';
import EmptyState from '../components/EmptyState';
import NotesBox from '../components/NotesBox';

interface Props {
  contacts: Contact[];
  refresh: () => Promise<void>;
}

export default function ReplyPage({ contacts, refresh }: Props) {
  const items = replyDueItems(contacts);
  const [tickedToday, setTickedToday] = useState(0);
  const total = tickedToday + items.length;

  // Ticking someone logs the message you just sent them. What that means
  // depends on why they were here: a reply, the next chase, or a nudge.
  async function tick(item: DueItem): Promise<void> {
    const result =
      item.kind === 'respond'
        ? await api.markReplied(item.contact.id)
        : await api.applyAction(item.contact.id, item.suggestedActionId ?? 'sent-follow-up');
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
            People appear here when they message you, or when the last message you sent has gone
            unanswered long enough to chase.
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

// What the tick button promises to log.
function tickLabel(item: DueItem): string {
  if (item.kind === 'respond') return 'Messaged them back';
  if (item.kind === 'chase') return `${ordinalMessage(item.contact.messagesSent + 1)} message sent`;
  return 'Follow-up sent';
}

function ReplyRow({ item, onTick }: { item: DueItem; onTick: () => void }) {
  const { contact } = item;
  const [showDraft, setShowDraft] = useState(contact.draft.length > 0);

  return (
    <div className={`reply-row ${item.kind}`}>
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
          {tickLabel(item)}
        </button>
      </div>
      <NotesBox contact={contact} />
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
