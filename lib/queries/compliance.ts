import { createClient } from '@/lib/supabase/server';
import type { Database } from '@/lib/supabase/database.types';
import {
  agedPriority,
  COMPLIANCE_OWNER_SLUG,
  type CompliancePriority
} from '@/lib/strategy/compliance';
import { getMemberOrCOO } from '@/lib/team/roster';

type ObjectiveRow = Database['public']['Tables']['governance_objectives']['Row'];

export interface ComplianceObjective {
  id: string;
  title: string;
  timeline: string | null;
  priority: CompliancePriority;
  /** True when the aging rule (not the stored value) raised it to High. */
  escalated: boolean;
  read: boolean;
  state: 'open' | 'done' | 'archived';
  pct: number;
  ai: string | null;
  /** 'lifecycle' = baseline seed, 'signal' = drafted off an SEC filing. */
  source: string;
}

export interface ComplianceLane {
  /** Owning specialist — always Adrian (GC/Compliance). */
  ownerName: string;
  ownerSlug: string;
  ownerRole: string;
  objectives: ComplianceObjective[];
  /** Count of objectives that have aged into High (the operator's risk queue). */
  highCount: number;
}

const owner = getMemberOrCOO(COMPLIANCE_OWNER_SLUG);

const EMPTY: ComplianceLane = {
  ownerName: owner.name,
  ownerSlug: owner.slug,
  ownerRole: owner.position,
  objectives: [],
  highCount: 0
};

/** Map the stored lowercase priority ('high'/'low'/...) to the UI's CompliancePriority, defaulting to Medium. */
function normalizePriority(priority: string): CompliancePriority {
  const p = priority.toLowerCase();
  if (p === 'high') return 'High';
  if (p === 'low') return 'Low';
  return 'Medium';
}

/** Collapse a stored status + archived_at into the lane's tri-state ('open' | 'done' | 'archived'). */
function normalizeState(status: string, archivedAt: string | null): ComplianceObjective['state'] {
  if (archivedAt) return 'archived';
  const s = status.toLowerCase();
  if (s === 'done' || s === 'complete' || s === 'completed' || s === 'closed') return 'done';
  if (s === 'archived') return 'archived';
  return 'open';
}

/**
 * Load the org's standing compliance lane (the Adrian-owned, never-empty
 * `category='compliance'` tier — blueprint Phase 4).
 *
 * Calls `ensure_compliance_tier` first so the lane is seeded on read even
 * before the cron has run — that is the never-empty guarantee. Then selects the
 * compliance objectives (RLS-scoped via the server client) and applies the
 * pure aging rule client-side so an objective ignored past the threshold reads
 * as High even if the scheduled refresh hasn't escalated it yet. Any failure
 * degrades to an empty lane (still labeled Adrian) — never throws at render.
 */
export async function getComplianceLane(orgId: string): Promise<ComplianceLane> {
  const supabase = await createClient();

  // Never-empty guarantee: seed the lane if it doesn't exist yet. Best-effort —
  // a failure here just means we read whatever already exists (possibly empty).
  try {
    await supabase.rpc('ensure_compliance_tier', { _org: orgId });
  } catch {
    // ignore — degrade to whatever is already there
  }

  const { data, error } = await supabase
    .from('governance_objectives')
    .select(
      'id, objective, timeline, priority, status, read_at, archived_at, ai_recommendation, source, updated_at'
    )
    .eq('org_id', orgId)
    .eq('category', 'compliance')
    .eq('owner_specialist', COMPLIANCE_OWNER_SLUG)
    .is('deleted_at', null)
    .order('created_at', { ascending: true });

  if (error || !data) return EMPTY;

  type Sel = Pick<
    ObjectiveRow,
    | 'id'
    | 'objective'
    | 'timeline'
    | 'priority'
    | 'status'
    | 'read_at'
    | 'archived_at'
    | 'ai_recommendation'
    | 'source'
    | 'updated_at'
  >;

  const now = new Date();
  let highCount = 0;

  const objectives = (data as Sel[]).map((o) => {
    const state = normalizeState(o.status, o.archived_at);
    const stored = normalizePriority(o.priority);
    const read = o.read_at != null;
    const priority = agedPriority(
      { priority: stored, open: state === 'open', read, updatedAt: o.updated_at },
      now
    );
    if (priority === 'High') highCount += 1;
    return {
      id: o.id,
      title: o.objective,
      timeline: o.timeline,
      priority,
      escalated: priority === 'High' && stored !== 'High',
      read,
      state,
      pct: state === 'done' ? 100 : 0,
      ai: o.ai_recommendation,
      source: o.source
    } satisfies ComplianceObjective;
  });

  return {
    ownerName: owner.name,
    ownerSlug: owner.slug,
    ownerRole: owner.position,
    objectives,
    highCount
  };
}
