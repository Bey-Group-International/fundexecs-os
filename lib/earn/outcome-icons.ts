import {
  Radar,
  FileSearch,
  Mail,
  RotateCcw,
  NotebookPen,
  DoorOpen,
  KeyRound,
  Target,
  type LucideIcon
} from 'lucide-react';
import type { OutcomeKind } from './outcomes';

/* ============================================================================
 * lib/earn/outcome-icons — the display half of the Earn outcome catalog.
 *
 * Split out of `outcomes.ts` so the pure vocabulary stays unit-testable:
 * lucide-react trips `react.createContext` under the test runner, so only the
 * client `/earn` surface imports this. Same pattern as integrations'
 * providers/catalog split.
 * ========================================================================= */

export const OUTCOME_ICONS: Record<OutcomeKind, LucideIcon> = {
  deal_sourced: Radar,
  diligence_run: FileSearch,
  lp_letter: Mail,
  reactivation: RotateCcw,
  meeting_notes: NotebookPen,
  closing_opened: DoorOpen,
  data_room_grant: KeyRound,
  target_scored: Target
};
