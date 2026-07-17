import type { Stage } from '../../../shared/types';
import { STAGES } from '../../../shared/stages';

export default function StageBadge({ stage }: { stage: Stage }) {
  return <span className={`badge stage-${stage}`}>{STAGES[stage].label}</span>;
}
