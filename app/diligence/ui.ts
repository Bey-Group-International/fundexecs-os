import type { BadgeTone } from '@/components/ui';

/**
 * Shared, render-environment-agnostic display helpers for diligence UI (status
 * + conviction tone mapping). Kept tiny and dependency-free so both the server
 * list/detail pages and any client component can import them.
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
