import type { BadgeTone } from '@/components/ui/Badge';

/**
 * Shared display helpers for the diligence surfaces (status + conviction tone
 * mapping). Tiny and dependency-free so server pages and client components can
 * both import them.
 */

/** Map a run status string to a Badge tone. */
export function statusTone(status: string): BadgeTone {
  switch (status) {
    case 'complete':
      return 'success';
    case 'running':
    case 'queued':
      return 'azure';
    case 'error':
      return 'danger';
    default:
      return 'neutral';
  }
}

/** A friendly label for a run status. */
export function statusLabel(status: string): string {
  switch (status) {
    case 'complete':
      return 'Complete';
    case 'running':
      return 'Running';
    case 'queued':
      return 'Queued';
    case 'error':
      return 'Error';
    default:
      return status;
  }
}

/** Tone for a 0–100 conviction / score value. */
export function convictionTone(value: number): BadgeTone {
  if (value >= 70) return 'success';
  if (value >= 45) return 'gold';
  return 'danger';
}

/** Fill color for a 0–100 conviction / score bar. */
export function scoreColor(score: number): string {
  if (score >= 70) return 'var(--success)';
  if (score >= 45) return 'var(--gold-1)';
  return 'var(--danger)';
}
