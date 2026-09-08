// The actions available for a contact at their current stage. Two layouts:
// full rows with keyboard hints (Focus page) or compact buttons (All page).
// Anything landing in "maybe later" asks when to follow up first, rather than
// silently assuming a month.
import { useEffect, useState } from 'react';
import type { Contact } from '../../../shared/types';
import type { StageAction } from '../../../shared/stages';
import { actionsFor, FOLLOW_UP_PRESETS, followUpDateFor, STAGES } from '../../../shared/stages';
import { formatShort, todayIso } from '../../../shared/dates';

interface Props {
  contact: Contact;
  onAct: (actionId: string, followUpDate?: string) => void;
  compact?: boolean;
  // Focus mode: 1-9 trigger the actions in order.
  keyboard?: boolean;
  // Lets the page mute its own shortcuts while the follow-up picker is open.
  onPickingChange?: (picking: boolean) => void;
  // The move a timer is proposing. Highlighted rather than reordered, so the
  // number keys stay where the muscle memory expects them.
  suggestedActionId?: string;
}

export default function ActionButtons({
  contact,
  onAct,
  compact = false,
  keyboard = false,
  onPickingChange,
  suggestedActionId,
}: Props) {
  const actions = actionsFor(contact);
  const [picking, setPicking] = useState<StageAction | null>(null);

  // Moving to another contact or stage abandons a half-made choice.
  useEffect(() => {
    setPicking(null);
    onPickingChange?.(false);
  }, [contact.id, contact.stage]);

  function startPicking(action: StageAction): void {
    setPicking(action);
    onPickingChange?.(true);
  }

  function cancelPicking(): void {
    setPicking(null);
    onPickingChange?.(false);
  }

  function run(action: StageAction): void {
    if (action.to === 'maybe-later') startPicking(action);
    else onAct(action.id);
  }

  function pick(followUpDate: string): void {
    const action = picking;
    cancelPicking();
    if (action) onAct(action.id, followUpDate);
  }

  // No dependency array: the handler closes over the current action list and
  // picking state, and is cheap to re-bind.
  useEffect(() => {
    if (!keyboard) return;
    function onKeyDown(event: KeyboardEvent): void {
      const target = event.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'SELECT' || target.tagName === 'TEXTAREA') return;
      if (picking) {
        if (event.key === 'Escape') cancelPicking();
        return;
      }
      const index = Number(event.key) - 1;
      if (index >= 0 && index < actions.length) run(actions[index]);
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  });

  if (actions.length === 0) return null;

  if (picking) {
    return <FollowUpPicker action={picking} onPick={pick} onCancel={cancelPicking} />;
  }

  if (compact) {
    return (
      <div className="actions">
        {actions.map((action) => (
          <button
            key={action.id}
            className={`btn small ${action.kind === 'advance' ? 'primary' : action.id === 'not-interested' ? 'danger' : ''} ${
              action.id === suggestedActionId ? 'suggested' : ''
            }`}
            onClick={() => run(action)}
          >
            {action.label}
          </button>
        ))}
      </div>
    );
  }

  return (
    <div className="action-list">
      {actions.map((action, index) => (
        <button
          key={action.id}
          className={`action-row ${action.kind === 'advance' ? 'advance' : ''} ${
            action.id === 'not-interested' ? 'exit-danger' : ''
          } ${action.id === suggestedActionId ? 'suggested' : ''}`}
          onClick={() => run(action)}
        >
          <kbd>{index + 1}</kbd>
          {action.label}
          {/* The fill says "this one"; the label is here for screen readers,
              which cannot see it. */}
          {action.id === suggestedActionId && <span className="sr-only">, suggested</span>}
          <span className="to">{destinationLabel(action, contact)}</span>
        </button>
      ))}
    </div>
  );
}

// What the row says will happen: the stage it moves to, or what it records
// when it moves nobody.
function destinationLabel(action: StageAction, contact: Contact): string {
  if (action.kind === 'milestone') return 'milestone';
  if (action.to === contact.stage) return 'stays put';
  return STAGES[action.to].label;
}

// Asks when the contact should come back: one of the preset timeframes, or
// any date from the calendar. Each option shows the date it resolves to so
// the choice is never a guess.
function FollowUpPicker({
  action,
  onPick,
  onCancel,
}: {
  action: StageAction;
  onPick: (followUpDate: string) => void;
  onCancel: () => void;
}) {
  const today = todayIso();
  const [custom, setCustom] = useState('');

  return (
    <div className="followup-picker">
      <div className="followup-head">
        <span>{action.kind === 'snooze' ? 'Still maybe later - when next?' : 'Maybe later - when should they come back?'}</span>
        <button className="btn small quiet" onClick={onCancel}>
          Cancel
        </button>
      </div>

      <div className="followup-options">
        {FOLLOW_UP_PRESETS.map((preset) => {
          const iso = followUpDateFor(preset, today);
          return (
            <button
              key={preset.id}
              className={`followup-option ${preset.id === 'month' ? 'default' : ''}`}
              onClick={() => onPick(iso)}
            >
              <span className="lbl">{preset.label}</span>
              <span className="date">{formatShort(iso)}</span>
            </button>
          );
        })}
      </div>

      <div className="followup-custom">
        <span className="lbl">Or pick a date</span>
        <input
          type="date"
          value={custom}
          min={today}
          onChange={(e) => setCustom(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && custom) onPick(custom);
          }}
        />
        <button className="btn small" disabled={!custom} onClick={() => onPick(custom)}>
          Set date
        </button>
      </div>
    </div>
  );
}
