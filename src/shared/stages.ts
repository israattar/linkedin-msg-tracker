// Single source of truth for the pipeline: stage definitions, the actions
// available at each stage, and how stage names map to Team Hub board columns.
//
// Pipeline: First msg -> Connected -> Second msg -> In conversation
//           -> Meeting held -> Proposal sent -> Active client
// Exits:    Maybe later (any active stage), Went cold (once talking),
//           Not interested (anywhere).
import type { Stage } from './types';

export const MAYBE_LATER_MONTHS = 1; // follow up one month after "maybe later"
export const STALE_FIRST_MSG_DAYS = 7; // nudge when a first message has had no reply this long

export interface StageAction {
  id: string;
  label: string; // button text
  to: Stage;
  // History line template. "{followUp}" is replaced with the next follow-up date.
  log: string;
  kind: 'advance' | 'exit' | 'snooze';
  // True when this action means THEY messaged US: the contact now waits on
  // the user's reply and joins the Reply page.
  setsNeedsReply?: boolean;
}

export interface StageDef {
  id: Stage;
  label: string;
  // Normalised Team Hub column titles that map to this stage (see normaliseTitle).
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

export const STAGES: Record<Stage, StageDef> = {
  draft: {
    id: 'draft',
    label: 'Draft',
    teamhubAliases: [],
    actions: [
      {
        id: 'sent-first',
        label: 'First message sent',
        to: 'first-msg',
        log: 'First message sent',
        kind: 'advance',
      },
    ],
    terminal: false,
  },
  'first-msg': {
    id: 'first-msg',
    label: 'First msg',
    teamhubAliases: ['firstmsg', 'firstmessage', '1stmsg', '1stmessage'],
    actions: [
      {
        id: 'accepted',
        label: 'They accepted the connection',
        to: 'connected',
        log: 'Connection accepted',
        kind: 'advance',
      },
      MAYBE_LATER,
      NOT_INTERESTED,
    ],
    terminal: false,
  },
  connected: {
    id: 'connected',
    label: 'Connected',
    teamhubAliases: ['connected', 'connect'],
    actions: [
      {
        id: 'sent-second',
        label: 'Second message sent',
        to: 'second-msg',
        log: 'Second message sent',
        kind: 'advance',
      },
      MAYBE_LATER,
      NOT_INTERESTED,
    ],
    terminal: false,
  },
  'second-msg': {
    id: 'second-msg',
    label: 'Second msg',
    teamhubAliases: ['secondmsg', 'secondmessage', '2ndmsg', '2ndmessage'],
    actions: [
      {
        id: 'replied',
        label: 'They replied',
        to: 'in-conversation',
        log: 'Replied, now in conversation',
        kind: 'advance',
        setsNeedsReply: true,
      },
      MAYBE_LATER,
      WENT_COLD,
      NOT_INTERESTED,
    ],
    terminal: false,
  },
  'in-conversation': {
    id: 'in-conversation',
    label: 'In conversation',
    teamhubAliases: ['inconversation', 'inconvo', 'conversation'],
    actions: [
      {
        id: 'held-meeting',
        label: 'Held a meeting',
        to: 'meeting-held',
        log: 'Meeting held',
        kind: 'advance',
      },
      {
        id: 'sent-proposal',
        label: 'Sent the proposal',
        to: 'proposal-sent',
        log: 'Proposal sent',
        kind: 'advance',
      },
      MAYBE_LATER,
      WENT_COLD,
      NOT_INTERESTED,
    ],
    terminal: false,
  },
  'meeting-held': {
    id: 'meeting-held',
    label: 'Meeting held',
    teamhubAliases: ['meetingheld', 'meeting', 'meetingdone'],
    actions: [
      {
        id: 'sent-proposal',
        label: 'Sent the proposal',
        to: 'proposal-sent',
        log: 'Proposal sent',
        kind: 'advance',
      },
      MAYBE_LATER,
      WENT_COLD,
      NOT_INTERESTED,
    ],
    terminal: false,
  },
  'proposal-sent': {
    id: 'proposal-sent',
    label: 'Proposal sent',
    // "pricingsent" kept as an alias: the board column was renamed from
    // "Pricing sent" and either title should keep matching.
    teamhubAliases: ['proposalsent', 'proposal', 'pricingsent', 'pricing'],
    actions: [
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
    actions: [
      {
        id: 'back-in-touch',
        label: 'They got back in touch',
        to: 'in-conversation',
        log: 'Back in touch, in conversation',
        kind: 'advance',
        setsNeedsReply: true,
      },
      NOT_INTERESTED,
    ],
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

// Left-to-right board order, used for the progress indicator, funnel, and filters.
export const PIPELINE_ORDER: Stage[] = [
  'first-msg',
  'connected',
  'second-msg',
  'in-conversation',
  'meeting-held',
  'proposal-sent',
  'active-client',
];

export const ALL_STAGES: Stage[] = [
  ...PIPELINE_ORDER,
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
