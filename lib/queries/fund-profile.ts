import 'server-only';
import { createClient } from '@/lib/supabase/server';
import type { MemberType } from '@/lib/member-types';
import { getQuestionSet, type ProfileQuestion } from '@/lib/proof-of-truth/questions';

/* ============================================================================
 * lib/queries/fund-profile.ts — the Profile, the Source-of-Truth record.
 *
 * The Profile is the canonical record every counterparty reads from. It is
 * built during onboarding and adapts to who the member is: an investment firm,
 * a service provider, a startup, an individual investor, or a student.
 *
 * Single source of truth: the Profile's sections, completeness, and gaps are
 * derived from the SAME per-member-type question set onboarding uses
 * (`lib/proof-of-truth/questions.ts`). That keeps the two in lockstep — every
 * gap shown here is one you can close in onboarding, and onboarding is exactly
 * the act of building this record.
 *
 * Wave 1 reuses `member_profiles` (no schema churn): the org owner's profile
 * row is the entity record, joined with the `organizations` row for entity-level
 * name/tier. We layer a `completenessScore`, a `gaps[]` list, and the rendered
 * `sections[]` on top so the Profile surface, the Dashboard, Fund Readiness, and
 * the lifecycle engine all read the same credibility signal.
 *
 * A handful of fund-specific fields (target raise, terms, track record, team)
 * are still extracted defensively for the fund-raise lifecycle, which is
 * intrinsically fund-centric.
 * ========================================================================= */

/** A missing-or-weak field a counterparty would probe, with why it matters. */
export interface FundProfileGap {
  /** The question id this gap maps to (stable within a member type's set). */
  field: string;
  label: string;
  /** Why a counterparty cares — used as Earn's prompt to fill it. */
  reason: string;
  /** 'missing' = absent; 'weak' = present but thin. */
  severity: 'missing' | 'weak';
}

/**
 * One rendered Profile section, derived from a question + the member's answer.
 * `kind` drives how the value renders (chips for tags, link for url, etc.).
 */
export interface ProfileSection {
  /** Question id. */
  id: string;
  label: string;
  kind: ProfileQuestion['kind'];
  /** Display text for text/textarea/select; null when absent. */
  text: string | null;
  /** Values for `kind: 'tags'`; empty otherwise. */
  tags: string[];
  /** Normalized href for `kind: 'url'`; null otherwise. */
  href: string | null;
  present: boolean;
  optional: boolean;
  /** Why this section matters, for empty-state coaching. */
  why: string | null;
}

/** Track-record summary an LP scans first. All optional until entered. */
export interface FundTrackRecord {
  priorDeals: number | null;
  returnsSummary: string | null;
  highlights: string | null;
}

/** A team member on the fund's masthead. */
export interface FundTeamMember {
  name: string;
  role: string | null;
}

/** Economic terms an LP diligences. */
export interface FundTerms {
  managementFeePct: number | null;
  carryPct: number | null;
  structure: string | null;
}

/**
 * The canonical Source-of-Truth payload. Numbers + plain objects only, so it
 * serializes cleanly to the Profile UI and the Dashboard side rail.
 */
export interface FundProfile {
  orgId: string;
  /** The org/entity display name (from `organizations.name`). */
  fundName: string;
  /** Org tier label, e.g. "Emerging manager". */
  fundTier: string | null;
  /** The owning member's user id (null when no owner resolved). */
  managerUserId: string | null;
  /** Owner display name (member_profiles.display_name or profile name). */
  managerName: string | null;
  /** The member's type — drives which sections/gaps apply. */
  memberType: MemberType | null;
  /** One-line headline from the member profile, when set. */
  headline: string | null;

  /** Member-type-aware sections, in display order (common, then specific). */
  sections: ProfileSection[];

  /** Investment thesis — the "why now / why us" (fund-specific). */
  thesis: string | null;
  /** Strategy: stage, sector, geography focus (fund-specific). */
  strategy: string | null;
  /** Target raise amount in dollars (fund-specific; feeds the raise lifecycle). */
  targetRaise: number | null;
  terms: FundTerms;
  trackRecord: FundTrackRecord;
  team: FundTeamMember[];
  /** Focus areas from member_profiles. */
  focusAreas: string[];

  /** 0–100 completeness of the required profile fields. Feeds readiness. */
  completenessScore: number;
  /** The required fields that are missing or weak. */
  gaps: FundProfileGap[];
}

/** Back-compat alias — the Profile record. */
export type ProfileRecord = FundProfile;

/* ---------------------------------------------------------------------------
 * Field extraction helpers — read defensively from member_profiles.
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

function strList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((v) => (typeof v === 'string' ? v.trim() : '')).filter((v) => v.length > 0);
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

/** Free-text kinds where a too-short answer counts as "weak", not done. */
const PROSE_KINDS = new Set<ProfileQuestion['kind']>(['textarea']);

/** The columns on `member_profiles` a 'profile'-target question can read. */
interface MemberRow {
  display_name: string | null;
  headline: string | null;
  bio: string | null;
  focus_areas: string[] | null;
  details: Details;
}

/** Resolve a question's raw answer from the member row. */
function answerFor(q: ProfileQuestion, row: MemberRow): string | string[] | null {
  if (q.target === 'profile') {
    switch (q.field) {
      case 'display_name':
        return row.display_name?.trim() || null;
      case 'headline':
        return row.headline?.trim() || null;
      case 'bio':
        return row.bio?.trim() || null;
      case 'focus_areas':
        return strList(row.focus_areas);
      default:
        return null;
    }
  }
  // details-target
  const raw = row.details[q.field];
  if (q.kind === 'tags') return strList(raw);
  if (typeof raw === 'string' && raw.trim().length > 0) return raw.trim();
  return null;
}

function normalizeHref(value: string): string {
  if (/^https?:\/\//i.test(value)) return value;
  return `https://${value}`;
}

/**
 * Build the member-type-aware sections + completeness + gaps from the question
 * schema and the member's answers. This is the heart of the Profile: it adapts
 * to the member type and stays in lockstep with onboarding.
 */
function buildFromSchema(
  memberType: MemberType,
  row: MemberRow
): { sections: ProfileSection[]; completenessScore: number; gaps: FundProfileGap[] } {
  const questions = getQuestionSet(memberType);
  const sections: ProfileSection[] = [];
  const gaps: FundProfileGap[] = [];

  let required = 0;
  let earned = 0;

  for (const q of questions) {
    const answer = answerFor(q, row);
    const isTags = q.kind === 'tags';
    const tags = isTags && Array.isArray(answer) ? answer : [];
    const text = !isTags && typeof answer === 'string' ? answer : null;
    const present = isTags ? tags.length > 0 : Boolean(text);
    const weak =
      present && !isTags && PROSE_KINDS.has(q.kind) && (text?.length ?? 0) < WEAK_TEXT_LEN;

    sections.push({
      id: q.id,
      label: q.label,
      kind: q.kind,
      text,
      tags,
      href: q.kind === 'url' && text ? normalizeHref(text) : null,
      present,
      optional: Boolean(q.optional),
      why: q.why ?? null
    });

    if (!q.optional) {
      required += 1;
      if (present && !weak) earned += 1;
      else if (present && weak) earned += 0.5;

      if (!present) {
        gaps.push({
          field: q.id,
          label: q.label,
          reason: q.why ?? `${q.label} helps counterparties trust the record.`,
          severity: 'missing'
        });
      } else if (weak) {
        gaps.push({
          field: q.id,
          label: q.label,
          reason: q.why ?? `${q.label} reads thin — a little more detail goes a long way.`,
          severity: 'weak'
        });
      }
    }
  }

  const completenessScore =
    required === 0 ? 0 : Math.max(0, Math.min(100, Math.round((earned / required) * 100)));

  return { sections, completenessScore, gaps };
}

/* ---------------------------------------------------------------------------
 * Loader
 * ------------------------------------------------------------------------- */

/**
 * Resolve the org's canonical Profile (Source of Truth). RLS-scoped via the
 * server client. The member record is the org owner's `member_profiles` row;
 * entity-level name/tier come from `organizations`. Any query error degrades to
 * a name-only profile (with every required field reported as a gap) so callers
 * never throw at render time.
 *
 * The owner is the org's `owner` (falling back to `admin`, then earliest
 * member), resolved from `org_members`; their `profiles` + `member_profiles`
 * rows supply the member identity, type, and answers.
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

  const fundName = org?.name ?? 'Your workspace';
  const fundTier = org?.tier ?? null;

  const memberList = (members ?? []) as Array<{ user_id: string; role: string }>;
  const owner =
    memberList.find((m) => m.role === 'owner') ??
    memberList.find((m) => m.role === 'admin') ??
    memberList[0] ??
    null;

  // Default to the app's primary persona when no member type is set yet, so the
  // Profile still has a meaningful schema to render and score against.
  const buildBase = (memberType: MemberType | null, row: MemberRow): FundProfile => {
    const schema = buildFromSchema(memberType ?? 'investment_firm', row);
    const details = row.details;
    return {
      orgId,
      fundName,
      fundTier,
      managerUserId: owner?.user_id ?? null,
      managerName: (row.display_name ?? '').trim() || null,
      memberType,
      headline: row.headline?.trim() || null,
      sections: schema.sections,
      thesis: str(details, 'thesis', 'investment_thesis') ?? row.bio ?? null,
      strategy:
        str(details, 'strategy', 'sector', 'focus') ??
        (strList(row.focus_areas).length > 0 ? strList(row.focus_areas).join(', ') : null) ??
        row.headline ??
        null,
      targetRaise: num(details, 'target_raise', 'targetRaise', 'fund_size', 'raise_target'),
      terms: {
        managementFeePct: num(details, 'management_fee', 'managementFeePct', 'mgmt_fee'),
        carryPct: num(details, 'carry', 'carryPct', 'carried_interest'),
        structure: str(details, 'structure', 'vehicle', 'fund_structure')
      },
      trackRecord: {
        priorDeals: num(details, 'prior_deals', 'priorDeals', 'deals_count'),
        returnsSummary: str(details, 'returns', 'returns_summary', 'track_record'),
        highlights: str(details, 'highlights', 'exits', 'notable_wins')
      },
      team: team(details),
      focusAreas: strList(row.focus_areas),
      completenessScore: schema.completenessScore,
      gaps: schema.gaps
    };
  };

  const emptyRow: MemberRow = {
    display_name: null,
    headline: null,
    bio: null,
    focus_areas: [],
    details: {}
  };

  if (!owner) {
    return buildBase(null, emptyRow);
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

  const row: MemberRow = {
    display_name: (mp?.display_name ?? '').trim() || profile?.full_name || null,
    headline: mp?.headline ?? null,
    bio: mp?.bio ?? null,
    focus_areas: (mp?.focus_areas as string[] | null) ?? [],
    details: ((mp?.details as Details) ?? {}) as Details
  };

  const memberType = (profile?.member_type ?? null) as MemberType | null;
  return buildBase(memberType, row);
}

/** Back-compat alias — `getProfile` is the preferred name for the loader. */
export const getProfile = getFundProfile;
