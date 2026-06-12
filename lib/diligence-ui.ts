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

/* ── the prototype's risk-register vocabulary (DD_STATUS / DD_SEV / verdict) ── */

export type WorkstreamStatus = 'clear' | 'caution' | 'flag' | 'pending';

/** The prototype's DD_STATUS chips: tone + label per workstream status. */
export const WORKSTREAM_STATUS: Record<WorkstreamStatus, { tone: BadgeTone; label: string }> = {
  clear: { tone: 'success', label: 'Clear' },
  caution: { tone: 'info', label: 'Caution' },
  flag: { tone: 'warning', label: 'Needs review' },
  pending: { tone: 'neutral', label: 'Running' }
};

/** The prototype's DD_SEV: severity tone + bar color. */
export type WorkstreamSeverity = 'High' | 'Medium' | 'Low';
export const SEVERITY_TONE: Record<WorkstreamSeverity, { tone: BadgeTone; color: string }> = {
  High: { tone: 'danger', color: 'var(--danger)' },
  Medium: { tone: 'warning', color: 'var(--warning)' },
  Low: { tone: 'info', color: 'var(--info)' }
};

/**
 * Map a real analyst score to the prototype's workstream status. An
 * operator-resolved finding is always clear; an unscored finding is still
 * running.
 */
export function workstreamStatus(score: number | null, resolved: boolean): WorkstreamStatus {
  if (resolved) return 'clear';
  if (score == null) return 'pending';
  if (score >= 70) return 'clear';
  if (score >= 45) return 'caution';
  return 'flag';
}

/** Severity of a non-clear workstream, from how far the score falls. */
export function workstreamSeverity(score: number | null): WorkstreamSeverity {
  if (score == null) return 'Low';
  if (score < 30) return 'High';
  if (score < 45) return 'Medium';
  return 'Low';
}

export interface RunVerdict {
  label: string;
  tone: BadgeTone;
  note: string;
}

/**
 * The prototype's verdict ladder over the workstreams: high-severity flags
 * hold the deal; flags pass conditionally; cautions pass with notes;
 * otherwise the deal is IC-ready.
 */
export function runVerdict(
  workstreams: ReadonlyArray<{ status: WorkstreamStatus; severity: WorkstreamSeverity }>
): RunVerdict {
  const flags = workstreams.filter((w) => w.status === 'flag');
  const highFlags = flags.filter((w) => w.severity === 'High').length;
  const open = workstreams.filter((w) => w.status === 'flag' || w.status === 'caution').length;
  if (highFlags > 0) {
    return {
      label: 'On hold',
      tone: 'danger',
      note: `${highFlags} high-severity item${highFlags > 1 ? 's' : ''} to resolve`
    };
  }
  if (flags.length > 0) {
    return {
      label: 'Conditional pass',
      tone: 'warning',
      note: `${flags.length} open item${flags.length > 1 ? 's' : ''} before IC`
    };
  }
  if (open > 0) {
    return {
      label: 'Pass with notes',
      tone: 'info',
      note: `${open} caution${open > 1 ? 's' : ''} logged`
    };
  }
  return { label: 'Clear to proceed', tone: 'success', note: 'IC-ready' };
}
