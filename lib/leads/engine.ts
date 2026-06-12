/**
 * lib/leads/engine.ts — the Lead Engine's pure vocabulary.
 *
 * Post-acquisition customer generation: each closed acquisition gets an
 * engine whose leads move New → Qualified → Contacted → Meeting through the
 * approve loop. Pure so the server actions and the board can never disagree
 * on stage order, and so AI-discovered candidates are shape-guarded before
 * they touch the table.
 */

export const LEAD_STAGES = [
  { key: 'new', label: 'New' },
  { key: 'qualified', label: 'Qualified' },
  { key: 'contacted', label: 'Contacted' },
  { key: 'meeting', label: 'Meeting' }
] as const;

export type LeadStageKey = (typeof LEAD_STAGES)[number]['key'];

export function isLeadStage(s: string): s is LeadStageKey {
  return LEAD_STAGES.some((st) => st.key === s);
}

/** The only legal transition is to the next stage in order. */
export function nextLeadStage(stage: LeadStageKey): LeadStageKey | null {
  const i = LEAD_STAGES.findIndex((s) => s.key === stage);
  return i >= 0 && i < LEAD_STAGES.length - 1 ? LEAD_STAGES[i + 1].key : null;
}

/** Earn's move per non-terminal stage — the prototype's `LEAD_NEXT`. */
export const LEAD_NEXT: Record<Exclude<LeadStageKey, 'meeting'>, string> = {
  new: 'Qualify',
  qualified: 'Reach out',
  contacted: 'Book meeting'
};

/** The ActionRunner choreography for an advance — the prototype's `runLead`. */
export function leadRunSteps(act: string): string[] {
  return [
    'Pull intent + firmographics',
    `Draft the ${act.toLowerCase()}`,
    'Personalize to their segment',
    'Prepare for your approval'
  ];
}

/** The funnel-summary roll-up: live leads, est. pipeline value, meetings. */
export function summarizeLeads(
  leads: ReadonlyArray<{ stage: LeadStageKey; estValue: number | null }>
): { live: number; pipelineValue: number; meetings: number } {
  return {
    live: leads.length,
    pipelineValue: leads.reduce((s, l) => s + (l.estValue ?? 0), 0),
    meetings: leads.filter((l) => l.stage === 'meeting').length
  };
}

const DAY_MS = 86_400_000;

/** "Last activity" label from a timestamp: — / Today / Nd ago. */
export function lastActivityLabel(iso: string | null, now: Date = new Date()): string {
  if (!iso) return '—';
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return '—';
  const days = Math.floor(Math.max(0, now.getTime() - t) / DAY_MS);
  return days <= 0 ? 'Today' : `${days}d ago`;
}

/** An AI-discovered customer lead, shape-guarded before insert. */
export interface LeadCandidate {
  name: string;
  segment: string | null;
  intent: number | null;
  estValue: number | null;
  signal: string | null;
}

const MAX_STR = 300;

const clampIntent = (v: unknown): number | null =>
  typeof v === 'number' && Number.isFinite(v) ? Math.max(0, Math.min(100, Math.round(v))) : null;

const str = (v: unknown): string | null =>
  typeof v === 'string' && v.trim().length > 0 ? v.trim().slice(0, MAX_STR) : null;

/** Coerce unknown AI output into bounded, well-typed lead candidates. */
export function sanitizeLeadCandidates(input: unknown, max = 8): LeadCandidate[] {
  if (!Array.isArray(input)) return [];
  const out: LeadCandidate[] = [];
  for (const raw of input) {
    if (!raw || typeof raw !== 'object') continue;
    const r = raw as Record<string, unknown>;
    const name = str(r.name) ?? str(r.companyName);
    if (!name) continue;
    out.push({
      name,
      segment: str(r.segment),
      intent: clampIntent(r.intent ?? r.intentScore),
      estValue:
        typeof r.estValue === 'number' && Number.isFinite(r.estValue) && r.estValue >= 0
          ? Math.round(r.estValue)
          : null,
      signal: str(r.signal)
    });
    if (out.length >= max) break;
  }
  return out;
}
