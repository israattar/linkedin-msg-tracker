// Single source of truth for the pipeline: stage definitions, the actions
// available at each stage, and how stage names map to Team Hub board columns.
//
// Pipeline: Draft -> Awaiting reply -> In conversation -> Active client
// Exits:    No response (three messages, still silence), Maybe later,
//           Went cold (stopped replying mid-conversation), Not interested.
//
// Two things are deliberately not stages. Messages sent are a counter on the
// contact, so "first message" and "second message" are the same queue seen at
// different points. Meetings and proposals are milestone flags, so one person
// can hold both and still read as "In conversation". Connections are not here
// at all: they are a daily tally on their own page, not tracked per contact.
import type { Contact, Milestone, Stage } from './types';
import { addDaysIso, addMonthsIso } from './dates';

export const MAYBE_LATER_MONTHS = 1; // default follow-up: one month after "maybe later"

// The chase cadence. Silence is measured from the last message sent.
export const MAX_OUTREACH_MESSAGES = 3; // first, second, final
export const CHASE_AFTER_FIRST_DAYS = 3; // no reply to the first message
export const CHASE_AFTER_SECOND_DAYS = 7; // no reply to the second message
export const GIVE_UP_AFTER_FINAL_DAYS = 7; // no reply to the final message -> No response
export const CONVERSATION_QUIET_DAYS = 3; // a live conversation gone silent

// Connections are counted per day against this target.
export const CONNECTIONS_DAILY_GOAL = 50;

// Timeframes offered when "maybe later" is chosen. The user picks one of
// these or a custom calendar date; the resulting date is stored on the
// contact and brings them back into the Focus queue when it comes due.
export interface FollowUpPreset {
  id: string;
  label: string;
  days?: number;
  months?: number;
}

export const FOLLOW_UP_PRESETS: FollowUpPreset[] = [
  { id: 'week', label: '1 week', days: 7 },
  { id: 'fortnight', label: '2 weeks', days: 14 },
  { id: 'month', label: '1 month', months: MAYBE_LATER_MONTHS },
];

export function followUpDateFor(preset: FollowUpPreset, fromIso: string): string {
  return preset.months !== undefined
    ? addMonthsIso(fromIso, preset.months)
    : addDaysIso(fromIso, preset.days ?? 0);
}

// The date used when no timeframe was chosen: an import, or a snooze that
// arrived without one.
export function defaultFollowUpDate(fromIso: string): string {
  return addMonthsIso(fromIso, MAYBE_LATER_MONTHS);
}

// "First" / "Second" / "Final", the names the messages go by everywhere.
export function ordinalMessage(n: number): string {
  if (n <= 1) return 'First';
  if (n === 2) return 'Second';
  if (n === 3) return 'Final';
  return `Message ${n}`;
}

// How an awaiting-reply contact reads on a row: "Second message sent".
export function messagesSentLabel(messagesSent: number): string {
  if (messagesSent <= 0) return 'Not messaged yet';
  return `${ordinalMessage(messagesSent)} message sent`;
}

export interface StageAction {
  id: string;
  label: string; // button text
  to: Stage;
  // History line template. "{followUp}" is replaced with the next follow-up
  // date, "{ordinal}" with the name of the message being logged.
  log: string;
  kind: 'advance' | 'exit' | 'snooze' | 'nudge' | 'milestone';
  // True when this action means THEY messaged US: the contact now waits on
  // the user's reply and joins the Reply page.
  setsNeedsReply?: boolean;
  // Logs an outbound message: bumps the counter and restarts the silence
  // timers without moving the contact anywhere.
  sendsMessage?: boolean;
  // Records a milestone flag rather than a stage change.
  milestone?: Milestone;
}

export interface StageDef {
  id: Stage;
  label: string;
  // Normalised Team Hub column titles that map to this stage (see
  // normaliseTitle). The first alias is the column title the app prefers when
  // a board offers more than one match.
  teamhubAliases: string[];
  actions: StageAction[];
  terminal: boolean;
}

const MAYBE_LATER: StageAction = {
  id: 'maybe-later',
  label: 'Maybe later',
  to: 'maybe-later',
  log: 'Maybe later, follow up {followUp}',
  kind: 'exit',
};

const WENT_COLD: StageAction = {
  id: 'went-cold',
  label: 'Went cold',
  to: 'went-cold',
  log: 'Went cold',
  kind: 'exit',
};

const NOT_INTERESTED: StageAction = {
  id: 'not-interested',
  label: 'Not interested',
  to: 'not-interested',
  log: 'Marked not interested',
  kind: 'exit',
};

const BACK_IN_TOUCH: StageAction = {
  id: 'back-in-touch',
  label: 'They got back in touch',
  to: 'in-conversation',
  log: 'Back in touch, in conversation',
  kind: 'advance',
  setsNeedsReply: true,
};

export const STAGES: Record<Stage, StageDef> = {
  draft: {
    id: 'draft',
    label: 'Draft',
    teamhubAliases: [],
    actions: [
      {
        id: 'sent-first',
        label: 'First message sent',
        to: 'awaiting-reply',
        log: '{ordinal} message sent',
        kind: 'advance',
        sendsMessage: true,
      },
    ],
    terminal: false,
  },
  'awaiting-reply': {
    id: 'awaiting-reply',
    label: 'Awaiting reply',
    // The old per-message and connection columns fold in here so an existing
    // board keeps matching and its cards still import.
    teamhubAliases: [
      'awaitingreply',
      'awaiting',
      'outreach',
      'messaged',
      'firstmsg',
      'firstmessage',
      '1stmsg',
      '1stmessage',
      'secondmsg',
      'secondmessage',
      '2ndmsg',
      '2ndmessage',
      'connected',
      'connect',
    ],
    actions: [
      {
        id: 'replied',
        label: 'They replied',
        to: 'in-conversation',
        log: 'Replied, now in conversation',
        kind: 'advance',
        setsNeedsReply: true,
      },
      {
        id: 'sent-another',
        label: 'Sent another message',
        to: 'awaiting-reply',
        log: '{ordinal} message sent',
        kind: 'nudge',
        sendsMessage: true,
      },
      {
        id: 'no-response',
        label: 'No response',
        to: 'no-response',
        log: 'No response after {messages}',
        kind: 'exit',
      },
      MAYBE_LATER,
      NOT_INTERESTED,
    ],
    terminal: false,
  },
  'in-conversation': {
    id: 'in-conversation',
    label: 'In conversation',
    // Meeting and proposal columns fold in: those are milestones now, and a
    // card sitting in one still describes someone you are talking to.
    teamhubAliases: [
      'inconversation',
      'inconvo',
      'conversation',
      'meetingheld',
      'meeting',
      'meetingdone',
      'proposalsent',
      'proposal',
      'pricingsent',
      'pricing',
    ],
    actions: [
      {
        id: 'held-meeting',
        label: 'Held a meeting',
        to: 'in-conversation',
        log: 'Meeting held',
        kind: 'milestone',
        milestone: 'meeting',
      },
      {
        id: 'sent-proposal',
        label: 'Sent the proposal',
        to: 'in-conversation',
        log: 'Proposal sent',
        kind: 'milestone',
        milestone: 'proposal',
      },
      {
        id: 'sent-follow-up',
        label: 'Sent a follow-up',
        to: 'in-conversation',
        log: 'Sent a follow-up message',
        kind: 'nudge',
        sendsMessage: true,
      },
      {
        id: 'became-client',
        label: 'Became a client',
        to: 'active-client',
        log: 'Became an active client',
        kind: 'advance',
      },
      MAYBE_LATER,
      WENT_COLD,
      NOT_INTERESTED,
    ],
    terminal: false,
  },
  'active-client': {
    id: 'active-client',
    label: 'Active client',
    teamhubAliases: ['activeclient', 'activeclients', 'client', 'clients'],
    actions: [],
    terminal: true,
  },
  'no-response': {
    id: 'no-response',
    label: 'No response',
    teamhubAliases: ['noresponse', 'noreply', 'unresponsive', 'noanswer'],
    actions: [BACK_IN_TOUCH, NOT_INTERESTED],
    terminal: false,
  },
  'maybe-later': {
    id: 'maybe-later',
    label: 'Maybe later',
    teamhubAliases: ['maybelater'],
    actions: [
      {
        id: 'followed-up',
        label: 'Followed up, talking again',
        to: 'in-conversation',
        log: 'Followed up, back in conversation',
        kind: 'advance',
      },
      {
        id: 'snooze',
        label: 'Still maybe later',
        to: 'maybe-later',
        log: 'Still maybe later, next follow-up {followUp}',
        kind: 'snooze',
      },
      NOT_INTERESTED,
    ],
    terminal: false,
  },
  'went-cold': {
    id: 'went-cold',
    label: 'Went cold',
    teamhubAliases: ['wentcold', 'ghosted', 'wentcoldghosted', 'cold'],
    actions: [BACK_IN_TOUCH, NOT_INTERESTED],
    terminal: false,
  },
  'not-interested': {
    id: 'not-interested',
    label: 'Not interested',
    teamhubAliases: ['notinterested'],
    actions: [],
    terminal: true,
  },
};

// Left-to-right board order, used for the progress indicator and filters.
export const PIPELINE_ORDER: Stage[] = ['awaiting-reply', 'in-conversation', 'active-client'];

export const ALL_STAGES: Stage[] = [
  ...PIPELINE_ORDER,
  'no-response',
  'maybe-later',
  'went-cold',
  'not-interested',
  'draft',
];

// Stages that live on the Team Hub board (drafts stay local until the first message is sent).
export const SYNCED_STAGES: Stage[] = ALL_STAGES.filter((s) => s !== 'draft');

export function getAction(stage: Stage, actionId: string): StageAction | null {
  return STAGES[stage].actions.find((a) => a.id === actionId) ?? null;
}

// The actions worth offering this contact right now. Only the chase differs:
// once the final message has gone there is no fourth one to send, and the
// decision left is whether to let them go.
export function actionsFor(contact: Contact): StageAction[] {
  return STAGES[contact.stage].actions.filter(
    (action) =>
      action.id !== 'sent-another' || contact.messagesSent < MAX_OUTREACH_MESSAGES,
  );
}

export const MILESTONE_LABELS: Record<Milestone, string> = {
  meeting: 'Held a meeting',
  proposal: 'Sent a proposal',
};

// "First Msg" / "first-msg" / "1st msg" all normalise to comparable keys.
export function normaliseTitle(title: string): string {
  return title.toLowerCase().replace(/[^a-z0-9]/g, '');
}

export function stageForSlotTitle(title: string): Stage | null {
  const key = normaliseTitle(title);
  for (const def of Object.values(STAGES)) {
    if (def.teamhubAliases.includes(key)) return def.id;
  }
  return null;
}

// How well a column title fits a stage, lowest wins. Boards that still have
// both "Awaiting reply" and the old "First msg" columns send moves to the
// first-listed alias rather than to whichever column happens to come first.
export function slotTitleRank(stage: Stage, title: string): number | null {
  const index = STAGES[stage].teamhubAliases.indexOf(normaliseTitle(title));
  return index < 0 ? null : index;
}

// Milestone columns on an existing board: a card imported from "Meeting held"
// keeps that fact as a flag even though the stage is now In conversation.
const MILESTONE_SLOT_ALIASES: Record<Milestone, string[]> = {
  meeting: ['meetingheld', 'meeting', 'meetingdone'],
  proposal: ['proposalsent', 'proposal', 'pricingsent', 'pricing'],
};

export function milestoneForSlotTitle(title: string): Milestone | null {
  const key = normaliseTitle(title);
  for (const [milestone, aliases] of Object.entries(MILESTONE_SLOT_ALIASES)) {
    if (aliases.includes(key)) return milestone as Milestone;
  }
  return null;
}

// How many messages a card in an old per-message column implies were sent.
export function messagesSentForSlotTitle(title: string): number {
  const key = normaliseTitle(title);
  const second = ['secondmsg', 'secondmessage', '2ndmsg', '2ndmessage'];
  return second.includes(key) ? 2 : 1;
}
