import type { CapitalStackSummary } from '@/lib/queries/capital-stack';
import type { FundProfile } from '@/lib/queries/fund-profile';

export const MATERIAL_KINDS = ['pitch_deck', 'lp_one_pager', 'ic_memo', 'data_room_index'] as const;

export type MaterialKind = (typeof MATERIAL_KINDS)[number];

export const MATERIAL_AUDIENCES = [
  'institutional_lp',
  'family_office',
  'co_investor',
  'internal_ic'
] as const;

export type MaterialAudience = (typeof MATERIAL_AUDIENCES)[number];

export const MATERIAL_STATUSES = ['draft', 'ready', 'archived'] as const;

export type MaterialStatus = (typeof MATERIAL_STATUSES)[number];

export const MATERIAL_SOURCES = ['deterministic_template', 'manual_edit', 'ai_generator'] as const;

export type MaterialSource = (typeof MATERIAL_SOURCES)[number];

export const MATERIAL_KIND_LABEL: Record<MaterialKind, string> = {
  pitch_deck: 'Pitch deck',
  lp_one_pager: 'LP one-pager',
  ic_memo: 'IC memo',
  data_room_index: 'Data-room index'
};

export const MATERIAL_KIND_NOTE: Record<MaterialKind, string> = {
  pitch_deck: 'Investor narrative from profile, raise, terms, and proof gaps.',
  lp_one_pager: 'A tight LP-facing summary for first meetings and follow-ups.',
  ic_memo: 'Committee-ready memo with thesis, support, risks, and open items.',
  data_room_index: 'A traceable checklist of folders and documents to assemble.'
};

export const MATERIAL_AUDIENCE_LABEL: Record<MaterialAudience, string> = {
  institutional_lp: 'Institutional LP',
  family_office: 'Family office',
  co_investor: 'Co-investor',
  internal_ic: 'Internal IC'
};

export const MATERIAL_STATUS_LABEL: Record<MaterialStatus, string> = {
  draft: 'Draft',
  ready: 'Ready',
  archived: 'Archived'
};

export interface MaterialSourceSnapshot {
  fundName: string;
  fundTier: string | null;
  managerName: string | null;
  headline: string | null;
  memberType: string | null;
  thesis: string | null;
  strategy: string | null;
  targetRaise: number | null;
  currency: string;
  committedTotal: number;
  softCircleTotal: number;
  gapToTarget: number;
  focusAreas: string[];
  managementFeePct: number | null;
  carryPct: number | null;
  structure: string | null;
  priorDeals: number | null;
  returnsSummary: string | null;
  highlights: string | null;
  team: Array<{ name: string; role: string | null }>;
  profileCompleteness: number;
  openProfileGaps: string[];
  generatedAt: string;
}

export interface MaterialDraft {
  title: string;
  body: string;
}

function money(amount: number | null | undefined, currency = 'USD'): string {
  const value = Number(amount ?? 0);
  if (!Number.isFinite(value) || value <= 0) return 'TBD';
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
    maximumFractionDigits: 0
  }).format(value);
}

function percent(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return 'TBD';
  return `${value}%`;
}

function present(value: string | null | undefined, fallback = 'Not documented yet'): string {
  const trimmed = value?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : fallback;
}

function list(values: string[], fallback = 'Not documented yet'): string {
  return values.length > 0 ? values.join(', ') : fallback;
}

function team(snapshot: MaterialSourceSnapshot): string {
  if (snapshot.team.length === 0) return '- Team: Not documented yet';
  return snapshot.team
    .slice(0, 6)
    .map((member) => `- ${member.name}${member.role ? `, ${member.role}` : ''}`)
    .join('\n');
}

function gaps(snapshot: MaterialSourceSnapshot): string {
  if (snapshot.openProfileGaps.length === 0) return '- No Source-of-Truth gaps flagged.';
  return snapshot.openProfileGaps
    .slice(0, 6)
    .map((gap) => `- ${gap}`)
    .join('\n');
}

function terms(snapshot: MaterialSourceSnapshot): string {
  return [
    `- Structure: ${present(snapshot.structure, 'TBD')}`,
    `- Management fee: ${percent(snapshot.managementFeePct)}`,
    `- Carry: ${percent(snapshot.carryPct)}`
  ].join('\n');
}

function raise(snapshot: MaterialSourceSnapshot): string {
  return [
    `- Target: ${money(snapshot.targetRaise, snapshot.currency)}`,
    `- Committed: ${money(snapshot.committedTotal, snapshot.currency)}`,
    `- Soft-circled: ${money(snapshot.softCircleTotal, snapshot.currency)}`,
    `- Gap to target: ${money(snapshot.gapToTarget, snapshot.currency)}`
  ].join('\n');
}

function footer(snapshot: MaterialSourceSnapshot): string {
  return [
    '',
    'Source snapshot',
    `- Generated: ${new Date(snapshot.generatedAt).toLocaleString('en-US')}`,
    `- Profile completeness: ${snapshot.profileCompleteness}%`,
    '- Generation mode: deterministic template, ready for Emergent AI rewrite integration.'
  ].join('\n');
}

export function buildMaterialSourceSnapshot(
  profile: FundProfile,
  capital: CapitalStackSummary | null,
  generatedAt = new Date().toISOString()
): MaterialSourceSnapshot {
  return {
    fundName: profile.fundName,
    fundTier: profile.fundTier,
    managerName: profile.managerName,
    headline: profile.headline,
    memberType: profile.memberType,
    thesis: profile.thesis,
    strategy: profile.strategy,
    targetRaise: profile.targetRaise ?? capital?.targetTotal ?? null,
    currency: capital?.currency ?? 'USD',
    committedTotal: capital?.committedTotal ?? 0,
    softCircleTotal: capital?.softCircleTotal ?? 0,
    gapToTarget: capital?.gapToTarget ?? Math.max(0, (profile.targetRaise ?? 0) - 0),
    focusAreas: profile.focusAreas,
    managementFeePct: profile.terms.managementFeePct,
    carryPct: profile.terms.carryPct,
    structure: profile.terms.structure,
    priorDeals: profile.trackRecord.priorDeals,
    returnsSummary: profile.trackRecord.returnsSummary,
    highlights: profile.trackRecord.highlights,
    team: profile.team,
    profileCompleteness: profile.completenessScore,
    openProfileGaps: profile.gaps.map((gap) => gap.label),
    generatedAt
  };
}

export function defaultMaterialTitle(kind: MaterialKind, snapshot: MaterialSourceSnapshot): string {
  return `${snapshot.fundName} ${MATERIAL_KIND_LABEL[kind]}`;
}

export function buildMaterialDraft(input: {
  kind: MaterialKind;
  audience: MaterialAudience;
  snapshot: MaterialSourceSnapshot;
  title?: string | null;
}): MaterialDraft {
  const { kind, audience, snapshot } = input;
  const title = input.title?.trim() || defaultMaterialTitle(kind, snapshot);
  const audienceLabel = MATERIAL_AUDIENCE_LABEL[audience];

  if (kind === 'pitch_deck') {
    return {
      title,
      body: [
        `${title}`,
        `Audience: ${audienceLabel}`,
        '',
        '1. Cover',
        `${snapshot.fundName} - ${present(snapshot.headline, 'Capital formation overview')}`,
        '',
        '2. Why this strategy',
        present(snapshot.thesis),
        '',
        '3. Strategy and focus',
        present(snapshot.strategy),
        `Focus areas: ${list(snapshot.focusAreas)}`,
        '',
        '4. Raise snapshot',
        raise(snapshot),
        '',
        '5. Track record',
        `- Prior deals: ${snapshot.priorDeals ?? 'TBD'}`,
        `- Returns: ${present(snapshot.returnsSummary, 'Not documented yet')}`,
        `- Highlights: ${present(snapshot.highlights, 'Not documented yet')}`,
        '',
        '6. Team',
        team(snapshot),
        '',
        '7. Terms',
        terms(snapshot),
        '',
        '8. Open diligence items',
        gaps(snapshot),
        footer(snapshot)
      ].join('\n')
    };
  }

  if (kind === 'lp_one_pager') {
    return {
      title,
      body: [
        `${title}`,
        `Audience: ${audienceLabel}`,
        '',
        'Summary',
        present(snapshot.thesis, `${snapshot.fundName} is preparing its investor narrative.`),
        '',
        'Strategy',
        present(snapshot.strategy),
        '',
        'Raise status',
        raise(snapshot),
        '',
        'Why now',
        `The record is ${snapshot.profileCompleteness}% complete and grounded in FundExecs Source-of-Truth fields.`,
        '',
        'Terms',
        terms(snapshot),
        '',
        'Follow-up ask',
        '- Confirm fit against mandate.',
        '- Identify diligence gaps before the next meeting.',
        '- Route questions through the LP Room so answers stay on the record.',
        footer(snapshot)
      ].join('\n')
    };
  }

  if (kind === 'ic_memo') {
    return {
      title,
      body: [
        `${title}`,
        `Audience: ${audienceLabel}`,
        '',
        'Recommendation',
        'Proceed with structured review once open Source-of-Truth gaps below are resolved.',
        '',
        'Thesis',
        present(snapshot.thesis),
        '',
        'Evidence supporting the case',
        `- Strategy: ${present(snapshot.strategy)}`,
        `- Focus: ${list(snapshot.focusAreas)}`,
        `- Track record: ${present(snapshot.returnsSummary, 'Not documented yet')}`,
        `- Highlights: ${present(snapshot.highlights, 'Not documented yet')}`,
        '',
        'Capital formation posture',
        raise(snapshot),
        '',
        'Risks and diligence gaps',
        gaps(snapshot),
        '',
        'Decision checklist',
        '- Verify fund terms and governing documents.',
        '- Confirm capital pipeline quality and close timing.',
        '- Compare track record claims against Chain-of-Trust evidence.',
        footer(snapshot)
      ].join('\n')
    };
  }

  return {
    title,
    body: [
      `${title}`,
      `Audience: ${audienceLabel}`,
      '',
      'Folder 01 - Source of Truth',
      '- Fund profile export',
      '- Strategy and thesis memo',
      '- Team biographies',
      '',
      'Folder 02 - Fund terms',
      '- LPA or operating agreement',
      '- Subscription documents',
      '- Fee, carry, and structure summary',
      '',
      'Folder 03 - Track record',
      '- Deal list',
      '- Case studies',
      '- Attribution notes',
      '',
      'Folder 04 - Capital formation',
      '- Raise snapshot',
      '- LP pipeline report',
      '- Commitment and soft-circle support',
      '',
      'Folder 05 - Chain of Trust',
      '- Proof of Truth evidence',
      '- Proof of Concept evidence',
      '- Proof of Execution evidence',
      '- Proof of Work evidence',
      '',
      'Open items from Source of Truth',
      gaps(snapshot),
      footer(snapshot)
    ].join('\n')
  };
}
