// The actions available for a contact at their current stage. Two layouts:
// full rows with keyboard hints (Focus page) or compact buttons (All page).
import type { Contact } from '../../../shared/types';
import { STAGES } from '../../../shared/stages';

interface Props {
  contact: Contact;
  onAct: (actionId: string) => void;
  compact?: boolean;
}

export default function ActionButtons({ contact, onAct, compact = false }: Props) {
  const actions = STAGES[contact.stage].actions;
  if (actions.length === 0) return null;

  if (compact) {
    return (
      <div className="actions">
        {actions.map((action) => (
          <button
            key={action.id}
            className={`btn small ${action.kind === 'advance' ? 'primary' : action.id === 'not-interested' ? 'danger' : ''}`}
            onClick={() => onAct(action.id)}
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
          }`}
          onClick={() => onAct(action.id)}
        >
          <kbd>{index + 1}</kbd>
          {action.label}
          <span className="to">{action.to === contact.stage ? 'stays put' : STAGES[action.to].label}</span>
        </button>
      ))}
    </div>
  );
}
