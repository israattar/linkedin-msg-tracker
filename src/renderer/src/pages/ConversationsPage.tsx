// Everyone who has replied, seen four ways at once. The sections overlap on
// purpose: someone you owe a reply can also be someone you held a meeting
// with, and both facts matter when you are deciding who to deal with next.
import { useState } from 'react';
import type { Contact } from '../../../shared/types';
import { CONVERSATION_QUIET_DAYS } from '../../../shared/stages';
import { daysSilent } from '../../../shared/cadence';
import { formatShort } from '../../../shared/dates';
import { api } from '../lib/api';
import Avatar from '../components/Avatar';
import EmptyState from '../components/EmptyState';
import ActionButtons from '../components/ActionButtons';
import NotesBox from '../components/NotesBox';

interface Props {
  contacts: Contact[];
  refresh: () => Promise<void>;
}

interface Section {
  id: string;
  title: string;
  hint: string;
  contacts: Contact[];
  tone?: 'urgent' | 'win';
}

export default function ConversationsPage({ contacts, refresh }: Props) {
  const talking = contacts.filter((c) => c.stage === 'in-conversation');

  const sections: Section[] = [
    {
      id: 'must-respond',
      title: 'Must respond to',
      hint: 'They wrote to you and are waiting.',
      contacts: talking.filter((c) => c.needsReply),
      tone: 'urgent',
    },
    {
      id: 'awaiting',
      title: 'Awaiting response',
      hint: 'You sent the last message; the ball is with them.',
      contacts: talking.filter((c) => !c.needsReply),
    },
    {
      id: 'meeting',
      title: 'Held a meeting',
      hint: 'Met at some point and still talking.',
      contacts: talking.filter((c) => c.meetingHeldDate !== null),
    },
    {
      id: 'proposal',
      title: 'Sent a proposal',
      hint: 'Priced up and waiting on a decision.',
      contacts: talking.filter((c) => c.proposalSentDate !== null),
      tone: 'win',
    },
  ];

  async function act(contactId: string, actionId: string, followUpDate?: string): Promise<void> {
    await api.applyAction(contactId, actionId, followUpDate);
    await refresh();
  }

  return (
    <div className="page-inner wide">
      <h1 className="page-title">In conversation</h1>
      <p className="page-sub">
        Everyone who replied. People show in every section that fits them, so the same name can
        appear more than once.
      </p>

      {talking.length === 0 ? (
        <div className="card" style={{ marginTop: 24 }}>
          <EmptyState title="No live conversations">
            People land here the moment you mark them as having replied.
          </EmptyState>
        </div>
      ) : (
        sections.map((section) => (
          <section key={section.id} className="convo-section">
            <div className="convo-head">
              <h2 className={`section-label ${section.tone ?? ''}`}>
                {section.title}
                <span className="count">{section.contacts.length}</span>
              </h2>
              <span className="hint">{section.hint}</span>
            </div>

            {section.contacts.length === 0 ? (
              <div className="convo-empty">Nobody here right now.</div>
            ) : (
              section.contacts.map((contact) => (
                <ConversationRow
                  key={contact.id}
                  contact={contact}
                  section={section.id}
                  onAct={(actionId, followUpDate) => void act(contact.id, actionId, followUpDate)}
                />
              ))
            )}
          </section>
        ))
      )}
    </div>
  );
}

function ConversationRow({
  contact,
  section,
  onAct,
}: {
  contact: Contact;
  section: string;
  onAct: (actionId: string, followUpDate?: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const quiet = daysSilent(contact);

  return (
    <div className={`convo-row ${contact.needsReply ? 'needs-reply' : ''}`}>
      <div className="convo-main">
        <Avatar name={contact.name} size={36} />
        <div className="grow">
          <div className="name">{contact.name}</div>
          <div className="meta">{rowMeta(contact, section, quiet)}</div>
        </div>
        <div className="milestones">
          {contact.meetingHeldDate && <span className="chip">Met</span>}
          {contact.proposalSentDate && <span className="chip win">Proposal</span>}
          {!contact.needsReply && quiet >= CONVERSATION_QUIET_DAYS && (
            <span className="chip warn">Quiet {quiet}d</span>
          )}
        </div>
        <a className="btn small quiet" href={contact.linkedinUrl} target="_blank" rel="noreferrer">
          Open LinkedIn
        </a>
        <button className="btn small" onClick={() => setOpen((v) => !v)}>
          {open ? 'Close' : 'Update'}
        </button>
      </div>

      {open && (
        <div className="convo-detail">
          <ActionButtons contact={contact} onAct={onAct} compact />
          <NotesBox contact={contact} />
        </div>
      )}
    </div>
  );
}

function rowMeta(contact: Contact, section: string, quiet: number): string {
  if (section === 'meeting' && contact.meetingHeldDate) {
    return `Meeting held ${formatShort(contact.meetingHeldDate)}`;
  }
  if (section === 'proposal' && contact.proposalSentDate) {
    return `Proposal sent ${formatShort(contact.proposalSentDate)}`;
  }
  if (contact.needsReply) return 'Waiting on your reply';
  if (quiet === 0) return 'You messaged them today';
  return `No reply for ${quiet} ${quiet === 1 ? 'day' : 'days'}`;
}
