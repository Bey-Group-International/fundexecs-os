/**
 * lib/formation/config.ts — Fund Formation flow config + helpers (pure).
 *
 * Ported from the onboarding prototype's `formation.jsx` data layer into typed,
 * dependency-free config the Formation flow renders. Formation is a regulated
 * surface: this drives an **illustrative** copiloted walkthrough (no filings,
 * no DB writes) until the formation schema lands and counsel signs off.
 *
 * Pure (no React, no IO) so it unit-tests without a DOM and is safe to import
 * from both client components and (future) server actions.
 */

export type FormationKind =
  | 'story'
  | 'structure'
  | 'terms'
  | 'ppm'
  | 'subscription'
  | 'regulatory'
  | 'bank';

export interface FormationItem {
  id: string;
  name: string;
  /** Which specialist leads this step. */
  who: string;
  kind: FormationKind;
  /** The document this step produces. */
  doc: string;
}

export const FORMATION_ITEMS: readonly FormationItem[] = [
  {
    id: 'story',
    name: 'Your fund story',
    who: 'Sienna · Comms',
    kind: 'story',
    doc: 'Fund narrative'
  },
  {
    id: 'entity',
    name: 'Fund entity (LP + GP)',
    who: 'Adrian · Counsel',
    kind: 'structure',
    doc: 'Certificate of Formation'
  },
  {
    id: 'lpa',
    name: 'Limited Partnership Agreement',
    who: 'Adrian · Counsel',
    kind: 'terms',
    doc: 'LPA'
  },
  {
    id: 'ppm',
    name: 'Private Placement Memorandum',
    who: 'Adrian · Counsel',
    kind: 'ppm',
    doc: 'PPM'
  },
  {
    id: 'subdocs',
    name: 'Subscription documents',
    who: 'Adrian · Counsel',
    kind: 'subscription',
    doc: 'Subscription pack'
  },
  {
    id: 'regd',
    name: 'Reg D / Form D filing',
    who: 'Adrian · Counsel',
    kind: 'regulatory',
    doc: 'Form D'
  },
  {
    id: 'bank',
    name: 'Bank & escrow accounts',
    who: 'Sterling · CoS',
    kind: 'bank',
    doc: 'Accounts'
  }
] as const;

export const F_EDGES = [
  'Operator experience',
  'Proprietary sourcing',
  'Deep sector expertise',
  'Strong network',
  'Differentiated thesis',
  'Proven track record',
  'Technical / product depth',
  'Founder relationships'
] as const;

export interface FormationData {
  storyHook: string;
  storyOrigin: string;
  storyEdges: string[];
  storyWhyNow: string;
  entity: string;
  domicile: string;
  gp: string;
  mgmtco: string;
  fee: number;
  carry: number;
  hurdle: number;
  gpCommit: number;
  term: number;
  termsUndecided: boolean;
  ppmTrack: boolean;
  ppmFee: boolean;
  ppmConflicts: boolean;
  ppmSector: boolean;
  minCommit: string;
  accredMethod: string;
  sideLetters: boolean;
  exemption: string;
  accred: string;
  erisa: boolean;
  bank: string;
  escrow: string;
  acctType: string;
}

export const FORMATION_D0: FormationData = {
  storyHook: '',
  storyOrigin: '',
  storyEdges: [],
  storyWhyNow: '',
  entity: 'Delaware LP',
  domicile: 'Delaware, USA',
  gp: 'GP, LLC',
  mgmtco: 'Management, LLC',
  fee: 2,
  carry: 20,
  hurdle: 8,
  gpCommit: 2,
  term: 10,
  termsUndecided: false,
  ppmTrack: true,
  ppmFee: true,
  ppmConflicts: true,
  ppmSector: true,
  minCommit: '$250K',
  accredMethod: 'Self-certification (506(b))',
  sideLetters: false,
  exemption: '506(b)',
  accred: 'Accredited investors only',
  erisa: false,
  bank: 'First Republic — fund banking',
  escrow: 'Standish Escrow',
  acctType: 'Capital-call + operating'
};

export interface FormationOption {
  id: string;
  icon: string;
  label: string;
  sub: string;
  recommended?: boolean;
}

export const F_ENTITY_OPTS: readonly FormationOption[] = [
  {
    id: 'Delaware LP',
    icon: 'landmark',
    label: 'Delaware LP',
    sub: 'US standard · pass-through · LP-familiar',
    recommended: true
  },
  {
    id: 'Cayman Exempted LP',
    icon: 'globe',
    label: 'Cayman Exempted LP',
    sub: 'Offshore · non-US & tax-exempt LPs'
  },
  {
    id: 'Delaware LLC',
    icon: 'layers',
    label: 'Delaware LLC',
    sub: 'Flexible · smaller vehicles & SPVs'
  },
  {
    id: 'Undecided',
    icon: 'circle-help',
    label: "I'm not sure yet",
    sub: 'Earn recommends the right structure and flags it for review'
  }
] as const;

export const F_EXEMPTION_OPTS: readonly FormationOption[] = [
  {
    id: '506(b)',
    icon: 'lock',
    label: 'Rule 506(b)',
    sub: 'No public solicitation · pre-existing relationships',
    recommended: true
  },
  {
    id: '506(c)',
    icon: 'megaphone',
    label: 'Rule 506(c)',
    sub: 'Market publicly · all LPs verified accredited'
  },
  {
    id: 'Undecided',
    icon: 'circle-help',
    label: 'Not sure yet',
    sub: 'Earn picks the right exemption for how you raise'
  }
] as const;

/** Earn's market-standard recommendation per step (applied on request). */
export const F_REC: Record<FormationKind, Partial<FormationData>> = {
  story: {
    storyHook:
      'A focused fund backing overlooked industrial operators with an unfair sourcing edge.',
    storyOrigin:
      'Ten years operating in the sector taught me where value hides — and who the best operators trust.',
    storyEdges: ['Operator experience', 'Proprietary sourcing', 'Deep sector expertise'],
    storyWhyNow:
      'A generational ownership transition is putting quality assets in play at attractive entries, and incumbents are too slow to act.'
  },
  structure: { entity: 'Delaware LP', domicile: 'Delaware, USA' },
  terms: { fee: 2, carry: 20, hurdle: 8, gpCommit: 2, term: 10, termsUndecided: true },
  ppm: { ppmTrack: true, ppmFee: true, ppmConflicts: true, ppmSector: true },
  subscription: {
    minCommit: '$250K',
    accredMethod: 'Self-certification (506(b))',
    sideLetters: false
  },
  regulatory: { exemption: '506(b)', accred: 'Accredited investors only', erisa: false },
  bank: {
    bank: 'First Republic — fund banking',
    escrow: 'Standish Escrow',
    acctType: 'Capital-call + operating'
  }
};

export const F_REC_TEXT: Record<FormationKind, string> = {
  story:
    'This is what LPs back first — you, before the numbers. The strongest emerging-manager narratives name a real origin, one sharp edge, and a clear “why now.” Keep it honest and specific; I’ll shape it into the through-line your deck, PPM and LP conversations all inherit.',
  structure:
    'For a US fund raising chiefly from US LPs, a Delaware LP is the institutional default — clean tax pass-through, the structure LPs already know.',
  terms:
    'Market for an emerging manager: 2% management fee, 20% carry, an 8% preferred return, a 1–2% GP commitment, and a 10-year term with extensions.',
  ppm: 'Include your track record and a worked fee example — LPs look for both. I’ll draft standard risk factors plus ones specific to your thesis.',
  subscription:
    'A $250K minimum keeps your cap table clean without shutting out smaller LPs. Under 506(b), self-certification is standard.',
  regulatory:
    'Start with Rule 506(b): no general-solicitation rules to police, and you can rely on pre-existing relationships. Move to 506(c) only to market publicly.',
  bank: 'A dedicated capital-call account plus an operating account is the clean setup. I can open both with your fund admin.'
};

export interface FormationArcStep {
  n: string;
  lead: string;
  icon: string;
  text: string;
}

export const FORMATION_ARC: readonly FormationArcStep[] = [
  {
    n: '01',
    lead: 'First, your story',
    icon: 'feather',
    text: 'The narrative LPs back — your origin, your edge, and why now. Everything else inherits it.'
  },
  {
    n: '02',
    lead: 'A legal body',
    icon: 'landmark',
    text: 'Your fund becomes a real entity — the LP that holds capital and the GP that runs it.'
  },
  {
    n: '03',
    lead: 'The rules',
    icon: 'scale',
    text: 'The Limited Partnership Agreement — the economics and governance between you and your LPs.'
  },
  {
    n: '04',
    lead: 'The offering',
    icon: 'file-text',
    text: 'Your PPM — how the opportunity, terms and risks are presented to investors.'
  },
  {
    n: '05',
    lead: 'How they commit',
    icon: 'pen-line',
    text: 'Subscription documents — the way an LP formally comes into the fund.'
  },
  {
    n: '06',
    lead: 'Permission to raise',
    icon: 'shield-check',
    text: 'Your Reg D exemption and Form D filing — the regulatory green light to accept capital.'
  },
  {
    n: '07',
    lead: 'Where capital lands',
    icon: 'banknote',
    text: 'Bank and escrow accounts, ready to receive committed capital.'
  }
] as const;

/** How many fields in a step are deferred to Earn ("Not sure yet"). */
export function itemUndecided(kind: FormationKind, d: FormationData): number {
  if (kind === 'structure') return d.entity === 'Undecided' ? 1 : 0;
  if (kind === 'terms') return d.termsUndecided ? 1 : 0;
  if (kind === 'regulatory')
    return (d.exemption === 'Undecided' ? 1 : 0) + (d.accred.startsWith('Not sure') ? 1 : 0);
  if (kind === 'subscription') return d.accredMethod.startsWith('Not sure') ? 1 : 0;
  if (kind === 'bank')
    return (d.bank.startsWith('Not sure') ? 1 : 0) + (d.escrow.startsWith('Not sure') ? 1 : 0);
  return 0;
}

/** The review rows shown for a completed step. */
export function resultRows(kind: FormationKind, d: FormationData): [string, string][] {
  const exemption = d.exemption === 'Undecided' ? 'Rule 506(b) (Earn)' : d.exemption;
  const entity = d.entity === 'Undecided' ? 'Delaware LP (Earn)' : d.entity;
  const sift = (v: string) => (v.startsWith('Not sure') ? 'Earn decides' : v);
  if (kind === 'story')
    return [
      ['Positioning', d.storyHook || 'Earn drafts'],
      ['Origin', d.storyOrigin || 'Earn drafts'],
      ['Your edge', d.storyEdges.length ? d.storyEdges.join(', ') : 'Earn drafts'],
      ['Why now', d.storyWhyNow || 'Earn drafts']
    ];
  if (kind === 'structure')
    return [
      ['Fund entity', entity],
      ['Domicile', d.domicile],
      ['GP entity', d.gp],
      ['Management co.', d.mgmtco]
    ];
  if (kind === 'terms')
    return [
      ['Management fee', `${d.fee}%`],
      ['Carried interest', `${d.carry}%`],
      ['Preferred return', `${d.hurdle}%`],
      ['GP commitment', `${d.gpCommit}%`],
      ['Fund term', `${d.term} years`],
      ...(d.termsUndecided ? ([['Basis', 'Market standard (Earn)']] as [string, string][]) : [])
    ];
  if (kind === 'ppm')
    return [
      ['Track record', d.ppmTrack ? 'Included' : 'Omitted'],
      ['Worked fee example', d.ppmFee ? 'Included' : 'Omitted'],
      ['Conflicts disclosure', d.ppmConflicts ? 'Included' : 'Omitted'],
      ['Sector risk factors', d.ppmSector ? 'Included' : 'Omitted']
    ];
  if (kind === 'subscription')
    return [
      ['Minimum commitment', sift(d.minCommit)],
      ['Accreditation', sift(d.accredMethod)],
      ['Side letters', d.sideLetters ? 'Allowed' : 'Not allowed']
    ];
  if (kind === 'regulatory')
    return [
      ['Exemption', exemption],
      ['Investor eligibility', sift(d.accred)],
      ['ERISA tracking', d.erisa ? 'On (25% limit)' : 'Off']
    ];
  if (kind === 'bank')
    return [
      ['Fund bank', sift(d.bank)],
      ['Escrow agent', sift(d.escrow)],
      ['Account setup', d.acctType]
    ];
  return [];
}

/** The (illustrative) filing sequence shown while a step "files". */
export function fileSteps(kind: FormationKind, d: FormationData): string[] {
  const ent = d.entity === 'Undecided' ? 'Delaware LP' : d.entity;
  const exm = d.exemption === 'Undecided' ? 'Rule 506(b)' : d.exemption;
  const base: Record<FormationKind, string[]> = {
    story: ['Shaping your narrative through-line', 'Drafting your positioning & origin'],
    structure: ['Reserving the entity name', `Forming the ${ent}`],
    terms: ['Drafting the LPA from your terms', 'Cross-checking against your mandate'],
    ppm: ['Assembling the PPM', 'Drafting your risk factors'],
    subscription: ['Generating subscription documents', 'Wiring up eligibility checks'],
    regulatory: ['Preparing Form D', `Filing · ${exm}`],
    bank: ['Opening the capital-call account', 'Opening the operating account']
  };
  const undec = itemUndecided(kind, d);
  const arr =
    undec > 0
      ? [`Finalizing ${undec} undecided item${undec > 1 ? 's' : ''} to the standard`, ...base[kind]]
      : [...base[kind]];
  // The bank step opens accounts; every other step files a real document
  // into the data room (capital_materials).
  if (kind !== 'bank') arr.push('Filing to your data room');
  arr.push('Logging to your Chain of Trust');
  return arr;
}

/** A short fund id derived from the firm name, for the "formed" identity strip. */
export function fundIdFor(firm: string): string {
  const slug =
    firm
      .replace(/[^A-Za-z]/g, '')
      .slice(0, 4)
      .toUpperCase() || 'FUND';
  return `FX-${slug}-0001`;
}
