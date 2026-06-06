import 'server-only';
import { createClient } from '@/lib/supabase/server';
import type { MemberType } from '@/lib/member-types';

/* ============================================================================
 * lib/queries/fund-profile.ts — the Source-of-Truth fund/manager record.
 *
 * Per the spec, Fund Profile is "the canonical fund/manager record everything
 * else reads from": thesis, strategy, target raise, terms, track record, team.
 * Wave 1 reuses `member_profiles` (no schema churn) — the org owner's profile
 * row is the manager record, joined with the `organizations` row for fund-level
 * name/tier. We layer a `completenessScore` and a `gaps[]` list on top so the
 * Dashboard, Fund Readiness, and the lifecycle engine can all read the same
 * credibility signal an LP would probe.
 *
 * Structured fields (thesis, strategy, target raise, terms, track record,
 * team) live in `member_profiles.details` (Json) until/unless a dedicated
 * schema lands. We read them defensively so a partially-filled profile never
 * throws.
 * ========================================================================= */

/** The dimensions an LP probes — each maps to a gap when missing/weak. */
export type FundProfileField =
  | 'thesis'
  | 'strategy'
  | 'targetRaise'
  | 'terms'
  | 'trackRecord'
  | 'team';

/** A missing-or-weak field an LP would probe, with why it matters. */
export interface FundProfileGap {
  field: FundProfileField;
  label: string;
  /** Why an LP cares — used as Earn's prompt to fill it. */
  reason: string;
  /** 'missing' = absent; 'weak' = present but thin. */
  severity: 'missing' | 'weak';
}

/** Track-record summary an LP scans first. All optional until entered. */
export interface FundTrackRecord {
  /** Prior funds / deals count, when stated. */
  priorDeals: number | null;
  /** Realized or marked returns blurb (free text in Wave 1). */
  returnsSummary: string | null;
  /** Notable exits / wins (free text). */
  highlights: string | null;
}

/** A team member on the fund's masthead. */
export interface FundTeamMember {
  name: string;
  role: string | null;
}

/** Economic terms an LP diligences. */
export interface FundTerms {
  /** Management fee %, e.g. 2. */
  managementFeePct: number | null;
  /** Carried interest %, e.g. 20. */
  carryPct: number | null;
  /** Fund structure / vehicle blurb. */
  structure: string | null;
}

/**
 * The canonical Source-of-Truth payload. Numbers + plain objects only, so it
 * serializes cleanly to the Fund Profile UI and the Dashboard side rail.
 */
export interface FundProfile {
  orgId: string;
  /** The org/fund display name (from `organizations.name`). */
  fundName: string;
  /** Org tier label, e.g. "Emerging manager". */
  fundTier: string | null;
  /** The owning manager's user id (null when no owner resolved). */
  managerUserId: string | null;
  /** Manager display name (member_profiles.display_name or profile name). */
  managerName: string | null;
  /** Manager member type — investment_firm for most funds. */
  memberType: MemberType | null;

  /** Investment thesis — the "why now / why us". */
  thesis: string | null;
  /** Strategy: stage, sector, geography focus (free text in Wave 1). */
  strategy: string | null;
  /** Target raise amount in dollars (0/null until sized). */
  targetRaise: number | null;
  terms: FundTerms;
  trackRecord: FundTrackRecord;
  team: FundTeamMember[];
  /** Focus areas from member_profiles (used as a strategy fallback signal). */
  focusAreas: string[];

  /** 0–100 completeness of the LP-probed fields. Feeds readiness + lifecycle. */
  completenessScore: number;
  /** The fields an LP would probe that are missing or weak. */
  gaps: FundProfileGap[];
}

/* ---------------------------------------------------------------------------
 * Field extraction helpers — read defensively from member_profiles.details.
 * ------------------------------------------------------------------------- */

type Details = Record<string, unknown>;

function str(details: Details, ...keys: string[]): string | null {
  for (const k of keys) {
    const v = details[k];
    if (typeof v === 'string' && v.trim().length > 0) return v.trim();
  }
  return null;
}

function num(details: Details, ...keys: string[]): number | null {
  for (const k of keys) {
    const v = details[k];
    if (typeof v === 'number' && Number.isFinite(v)) return v;
    if (typeof v === 'string') {
      const parsed = Number(v.replace(/[^0-9.]/g, ''));
      if (Number.isFinite(parsed) && parsed > 0) return parsed;
    }
  }
  return null;
}

function team(details: Details): FundTeamMember[] {
  const raw = details['team'];
  if (!Array.isArray(raw)) return [];
  const out: FundTeamMember[] = [];
  for (const m of raw) {
    if (typeof m === 'string' && m.trim()) {
      out.push({ name: m.trim(), role: null });
    } else if (m && typeof m === 'object') {
      const rec = m as Record<string, unknown>;
      const name = typeof rec.name === 'string' ? rec.name.trim() : null;
      if (name) out.push({ name, role: typeof rec.role === 'string' ? rec.role : null });
    }
  }
  return out;
}

/** A string is "weak" (vs. absent) when present but shorter than this. */
const WEAK_TEXT_LEN = 40;

/**
 * Score completeness and collect gaps over the six LP-probed fields. Each
 * field is worth an equal share (100 / 6). A present-but-thin text field
 * scores half and is reported as a `weak` gap.
 */
function scoreAndGaps(p: {
  thesis: string | null;
  strategy: string | null;
  targetRaise: number | null;
  terms: FundTerms;
  trackRecord: FundTrackRecord;
  team: FundTeamMember[];
}): { completenessScore: number; gaps: FundProfileGap[] } {
  const gaps: FundProfileGap[] = [];
  const per = 100 / 6;
  let score = 0;

  const textField = (
    value: string | null,
    field: FundProfileField,
    label: string,
    reason: string
  ) => {
    if (!value) {
      gaps.push({ field, label, reason, severity: 'missing' });
    } else if (value.length < WEAK_TEXT_LEN) {
      gaps.push({ field, label, reason, severity: 'weak' });
      score += per / 2;
    } else {
      score += per;
    }
  };

  textField(
    p.thesis,
    'thesis',
    'Investment thesis',
    'LPs lead with "why now, why you" — a sharp thesis is table stakes.'
  );
  textField(
    p.strategy,
    'strategy',
    'Strategy',
    'Stage, sector, and geography focus let LPs check mandate fit.'
  );

  if (p.targetRaise && p.targetRaise > 0) {
    score += per;
  } else {
    gaps.push({
      field: 'targetRaise',
      label: 'Target raise',
      reason: 'LPs need the fund size to size their own check and assess concentration.',
      severity: 'missing'
    });
  }

  const hasTerms =
    p.terms.managementFeePct != null || p.terms.carryPct != null || !!p.terms.structure;
  if (hasTerms) {
    // Full credit only when fee, carry, and structure are all present.
    const filled = [
      p.terms.managementFeePct != null,
      p.terms.carryPct != null,
      !!p.terms.structure
    ];
    const ratio = filled.filter(Boolean).length / filled.length;
    score += per * ratio;
    if (ratio < 1) {
      gaps.push({
        field: 'terms',
        label: 'Terms',
        reason: 'Fee, carry, and structure must all be explicit before an LP commits.',
        severity: 'weak'
      });
    }
  } else {
    gaps.push({
      field: 'terms',
      label: 'Terms',
      reason: 'Fee, carry, and structure must all be explicit before an LP commits.',
      severity: 'missing'
    });
  }

  const hasTrack =
    (p.trackRecord.priorDeals ?? 0) > 0 ||
    !!p.trackRecord.returnsSummary ||
    !!p.trackRecord.highlights;
  if (hasTrack) {
    score += per;
  } else {
    gaps.push({
      field: 'trackRecord',
      label: 'Track record',
      reason: 'Prior deals and realized returns are the single biggest LP diligence item.',
      severity: 'missing'
    });
  }

  if (p.team.length > 0) {
    score += per;
  } else {
    gaps.push({
      field: 'team',
      label: 'Team',
      reason: 'LPs back people — name the GP and key team with their roles.',
      severity: 'missing'
    });
  }

  return { completenessScore: Math.max(0, Math.min(100, Math.round(score))), gaps };
}

/* ---------------------------------------------------------------------------
 * Loader
 * ------------------------------------------------------------------------- */

/**
 * Resolve the org's canonical Source-of-Truth fund profile. RLS-scoped via the
 * server client. The manager record is the org owner's `member_profiles` row;
 * fund-level name/tier come from `organizations`. Any query error degrades to
 * a name-only profile (with every field reported as a gap) so callers never
 * throw at render time.
 *
 * The owner is the org's `owner` (falling back to `admin`) member, resolved
 * from `org_members`; their `profiles` + `member_profiles` rows supply the
 * manager identity and the structured fields.
 */
export async function getFundProfile(orgId: string): Promise<FundProfile> {
  const supabase = await createClient();

  const [{ data: org }, { data: members }] = await Promise.all([
    supabase.from('organizations').select('name, tier, type').eq('id', orgId).maybeSingle(),
    supabase
      .from('org_members')
      .select('user_id, role, created_at')
      .eq('org_id', orgId)
      .eq('status', 'active')
      .order('created_at', { ascending: true })
  ]);

  const fundName = org?.name ?? 'Your fund';
  const fundTier = org?.tier ?? null;

  // Pick the owning manager: prefer an owner, then an admin, then the earliest
  // member. `members` is already ascending by created_at.
  const memberList = (members ?? []) as Array<{ user_id: string; role: string }>;
  const owner =
    memberList.find((m) => m.role === 'owner') ??
    memberList.find((m) => m.role === 'admin') ??
    memberList[0] ??
    null;

  const base: FundProfile = {
    orgId,
    fundName,
    fundTier,
    managerUserId: owner?.user_id ?? null,
    managerName: null,
    memberType: null,
    thesis: null,
    strategy: null,
    targetRaise: null,
    terms: { managementFeePct: null, carryPct: null, structure: null },
    trackRecord: { priorDeals: null, returnsSummary: null, highlights: null },
    team: [],
    focusAreas: [],
    completenessScore: 0,
    gaps: []
  };

  if (!owner) {
    return { ...base, ...scoreAndGaps(base) };
  }

  const [{ data: profile }, { data: mp }] = await Promise.all([
    supabase
      .from('profiles')
      .select('full_name, member_type')
      .eq('id', owner.user_id)
      .maybeSingle(),
    supabase
      .from('member_profiles')
      .select('display_name, headline, bio, focus_areas, details')
      .eq('user_id', owner.user_id)
      .maybeSingle()
  ]);

  const details = ((mp?.details as Details) ?? {}) as Details;
  const focusAreas = mp?.focus_areas ?? [];

  // Strategy falls back to focus areas / headline when no explicit field set.
  const strategy =
    str(details, 'strategy', 'sector', 'focus') ??
    (focusAreas.length > 0 ? focusAreas.join(', ') : null) ??
    mp?.headline ??
    null;

  const terms: FundTerms = {
    managementFeePct: num(details, 'management_fee', 'managementFeePct', 'mgmt_fee'),
    carryPct: num(details, 'carry', 'carryPct', 'carried_interest'),
    structure: str(details, 'structure', 'vehicle', 'fund_structure')
  };

  const trackRecord: FundTrackRecord = {
    priorDeals: num(details, 'prior_deals', 'priorDeals', 'deals_count'),
    returnsSummary: str(details, 'returns', 'returns_summary', 'track_record'),
    highlights: str(details, 'highlights', 'exits', 'notable_wins')
  };

  const partial = {
    thesis: str(details, 'thesis', 'investment_thesis') ?? mp?.bio ?? null,
    strategy,
    targetRaise: num(details, 'target_raise', 'targetRaise', 'fund_size', 'raise_target'),
    terms,
    trackRecord,
    team: team(details)
  };

  const profile_: FundProfile = {
    ...base,
    managerName: (mp?.display_name ?? '').trim() || profile?.full_name || null,
    memberType: (profile?.member_type ?? null) as MemberType | null,
    thesis: partial.thesis,
    strategy: partial.strategy,
    targetRaise: partial.targetRaise,
    terms: partial.terms,
    trackRecord: partial.trackRecord,
    team: partial.team,
    focusAreas
  };

  return { ...profile_, ...scoreAndGaps(partial) };
}
