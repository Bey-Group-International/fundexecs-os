/**
 * lib/brand-studio/config.ts — Profile & Brand config (pure).
 *
 * Ported from the onboarding prototype's `brand.jsx` data layer: the public face
 * of the raise — the GP profile, firm brand kit, and digital presence, each
 * produced copiloted from the fund story (you set the posture, Earn produces
 * it). Illustrative until a brand/profile schema lands. Pure (no React, no IO)
 * so it unit-tests cleanly.
 */

export interface BrandDecision {
  key: string;
  kind: 'radio' | 'multi';
  label: string;
  opts: string[];
}

export type BrandValue = string | string[];

export interface BrandBuildCfg {
  intro: string;
  decisions: BrandDecision[];
  rec: Record<string, BrandValue>;
  recText: string;
}

/** The copiloted brand builders, keyed by item id. */
export const BRAND_BUILD: Record<string, BrandBuildCfg> = {
  bio: {
    intro:
      'Your professional bio — the first thing an LP reads about you. Earn drafts it from your fund story.',
    decisions: [
      {
        key: 'voice',
        kind: 'radio',
        label: 'Position as',
        opts: ['Operator', 'Investor', 'Visionary']
      },
      { key: 'length', kind: 'radio', label: 'Length', opts: ['Short', 'Standard', 'Full'] },
      {
        key: 'include',
        kind: 'multi',
        label: 'Highlight',
        opts: ['Track record', 'Operating wins', 'Education', 'Network', 'Thesis']
      }
    ],
    rec: {
      voice: 'Operator',
      length: 'Standard',
      include: ['Track record', 'Operating wins', 'Thesis']
    },
    recText:
      'Position as an operator — LPs back managers who’ve done the work, not just allocated. Keep it standard length, leading with track record, operating wins and your thesis.'
  },
  brandkit: {
    intro: 'Your firm’s visual identity — wordmark, palette and voice. Institutional but distinct.',
    decisions: [
      {
        key: 'aesthetic',
        kind: 'radio',
        label: 'Aesthetic',
        opts: ['Institutional', 'Modern', 'Bold']
      },
      {
        key: 'palette',
        kind: 'radio',
        label: 'Palette',
        opts: ['Navy & gold', 'Charcoal & ivory', 'Forest & brass']
      },
      { key: 'voice', kind: 'radio', label: 'Voice', opts: ['Measured', 'Direct', 'Visionary'] }
    ],
    rec: { aesthetic: 'Institutional', palette: 'Navy & gold', voice: 'Measured' },
    recText:
      'Institutional with a navy-and-gold palette reads as serious capital — the register LPs trust. A measured voice ages well across a decade of letters and updates.'
  },
  website: {
    intro: 'A clean fund site at your own domain — credibility LPs check before the first call.',
    decisions: [
      { key: 'type', kind: 'radio', label: 'Format', opts: ['One-pager', 'Multi-page'] },
      {
        key: 'sections',
        kind: 'multi',
        label: 'Sections',
        opts: ['Thesis', 'Team', 'Portfolio', 'Approach', 'Contact']
      },
      {
        key: 'gate',
        kind: 'radio',
        label: 'Investor area',
        opts: ['Public + gated room', 'Public only']
      }
    ],
    rec: {
      type: 'One-pager',
      sections: ['Thesis', 'Team', 'Approach', 'Contact'],
      gate: 'Public + gated room'
    },
    recText:
      'A one-pager is enough to start — thesis, team, approach, contact — with a gated link through to your data room. I’ll deploy it to your domain and keep it in sync.'
  }
};

/** Per-asset stage in the studio: To do → Produced → Live. */
export type BrandStage = 'todo' | 'produced' | 'live';

export const BRAND_STAGES: Record<BrandStage, string> = {
  todo: 'To do',
  produced: 'Produced',
  live: 'Live'
};

/** Badge tone per stage (mirrors the governance grid's tones). */
export const BRAND_TONE: Record<BrandStage, 'neutral' | 'gold' | 'success'> = {
  todo: 'neutral',
  produced: 'gold',
  live: 'success'
};

/** Published wins; a produced-but-unpublished spec reads Produced; else To do. */
export function brandStage(live: boolean, produced: boolean): BrandStage {
  return live ? 'live' : produced ? 'produced' : 'todo';
}

export const BRAND_ITEM_NAME: Record<string, string> = {
  bio: 'Professional bio',
  brandkit: 'Brand kit',
  website: 'Fund website',
  credentials: 'Credentials & track record'
};

/** Brand palettes → [dark, mid, accent] swatches for the live brand preview. */
export const PALETTES: Record<string, [string, string, string]> = {
  'Navy & gold': ['#0f1c34', '#1f3a63', '#F7C948'],
  'Charcoal & ivory': ['#1a1d24', '#3a3f4b', '#e8e2d4'],
  'Forest & brass': ['#13241c', '#1f4636', '#c8a44d']
};

/** Resolve a palette by name, falling back to the recommended navy & gold. */
export function paletteFor(name: string | undefined): [string, string, string] {
  return PALETTES[name ?? ''] ?? PALETTES['Navy & gold'];
}

/* ── the dedicated bio builder (composeBio + facts) ──────────────────────── */

/** The bio spec the dedicated builder publishes (decisions + facts + text). */
export interface BioSpec {
  voice: string;
  length: string;
  include: string[];
  years: string;
  prior: string;
  win: string;
  edu: string;
  /** The composed paragraph, rendered on the public profile. */
  text: string;
}

export const BIO_REC: Omit<BioSpec, 'text'> = {
  voice: 'Operator',
  length: 'Standard',
  include: ['Track record', 'Operating wins', 'Thesis'],
  years: '10',
  prior: 'Head of Operations at a sector incumbent',
  win: 'three exits and a top-quartile angel track record',
  edu: 'an MBA from a top program'
};

/** Compose the actual bio paragraph from the facts + posture (the prototype's composeBio). */
export function composeBio(
  d: Partial<Omit<BioSpec, 'text'>>,
  principal: string,
  firm: string
): string {
  const first = (principal || 'Jordan Avery').split(' ')[0];
  const yrs = d.years || '10';
  const prior = d.prior || 'a decade operating in the sector';
  const win = d.win || 'three exits and a portfolio built on conviction';
  const edu = d.edu || '';
  const voiceOpen =
    {
      Operator: `${principal} is the Managing Partner of ${firm} — an operator-turned-investor who spent ${yrs} years building in the sector before backing it.`,
      Investor: `${principal} is the Managing Partner of ${firm}, an investor with ${yrs} years of disciplined sector focus and a track record of finding value others miss.`,
      Visionary: `${principal} is the Managing Partner of ${firm}, building the firm to back the operators and ideas the market is only now catching up to.`
    }[d.voice ?? 'Operator'] ??
    `${principal} is the Managing Partner of ${firm} — an operator-turned-investor who spent ${yrs} years building in the sector before backing it.`;
  const include = d.include ?? [];
  const parts = [voiceOpen];
  if (include.includes('Operating wins'))
    parts.push(
      `Before ${firm}, ${first} led ${prior.toLowerCase().startsWith('a ') ? prior : 'work at ' + prior} — earning the relationships and pattern-recognition that now drive the fund's edge.`
    );
  if (include.includes('Track record')) parts.push(`That work produced ${win}.`);
  if (include.includes('Thesis'))
    parts.push(
      `Today ${first} invests behind a focused thesis: backing overlooked operators with an unfair sourcing edge.`
    );
  if (include.includes('Network'))
    parts.push(
      `${first}'s network across the sector turns into proprietary deal flow and warm capital.`
    );
  if (include.includes('Education') && edu) parts.push(`${first} holds ${edu}.`);
  const full = parts.join(' ');
  if (d.length === 'Short') return parts.slice(0, 2).join(' ');
  if (d.length === 'Full')
    return (
      full +
      ` ${first} writes and speaks regularly on the space, and sits at the center of the conversations that shape it.`
    );
  return full;
}

/* ── the dedicated brand-kit builder (live brand board) ──────────────────── */

export interface BrandKitSpec {
  tagline: string;
  logo: string;
  palette: string;
  type: string;
  voice: string;
  aesthetic: string;
}

export const BK_LOGOS = ['Monogram', 'Coin', 'Symbol'] as const;
export const BK_VOICES = ['Measured', 'Direct', 'Visionary'] as const;
export const BK_AESTHETICS = ['Institutional', 'Modern', 'Bold'] as const;

/** Typeface options → CSS stack + weight for the live brand board. */
export const BK_TYPES: Record<string, { stack: string; weight: number }> = {
  'Geist · modern': { stack: "'Geist', system-ui, sans-serif", weight: 600 },
  'Serif · classic': { stack: "'Georgia', serif", weight: 600 },
  'Grotesk · bold': { stack: 'system-ui, sans-serif', weight: 700 }
};

export const BK_TAGLINES = [
  'Backing the operators others overlook.',
  'Conviction, earned on the ground.',
  'Where operating insight meets capital.',
  'The unfair edge, institutionalized.'
] as const;

export const BK_REC: Omit<BrandKitSpec, 'aesthetic'> = {
  tagline: 'Backing the operators others overlook.',
  logo: 'Monogram',
  palette: 'Navy & gold',
  type: 'Geist · modern',
  voice: 'Measured'
};

/** The prototype's aesthetic derivation at publish time. */
export function brandKitAesthetic(voice: string): string {
  return voice === 'Visionary' ? 'Bold' : 'Institutional';
}

/** Resolve a typeface by name, falling back to the recommended modern stack. */
export function typeFor(name: string | undefined): { stack: string; weight: number } {
  return BK_TYPES[name ?? ''] ?? BK_TYPES['Geist · modern'];
}

/* ── the credentials & track-record builder ──────────────────────────────── */

export interface TrackDeal {
  company: string;
  year: string;
  multiple: string;
  status: 'Realized' | 'Unrealized';
}

export interface TrackAgg {
  count: number;
  realized: number;
  blended: string;
  top: string;
}

export interface CredentialsSpec {
  deals: TrackDeal[];
  edu: string;
  recognition: string[];
  agg: TrackAgg;
}

export const TR_REC_DEALS: readonly TrackDeal[] = [
  { company: 'Northwind Industrial', year: '2017', multiple: '4.1', status: 'Realized' },
  { company: 'Cedar Logistics', year: '2018', multiple: '2.8', status: 'Realized' },
  { company: 'Apex Components', year: '2020', multiple: '3.5', status: 'Realized' },
  { company: 'Helios Robotics', year: '2022', multiple: '2.2', status: 'Unrealized' }
];

export const TR_REC_CREDS = {
  edu: 'MBA, Wharton',
  recognition: ['Forbes 30 Under 30', '2 board seats', 'Ex-Head of Ops, sector incumbent']
};

export const TR_RECOGNITION_OPTS = [
  'Forbes 30 Under 30',
  '2 board seats',
  'Ex-Head of Ops, sector incumbent',
  'Published author',
  'Industry award',
  'Prior exit founder'
] as const;

/** Compute the live performance summary from the deal list (the prototype's trAgg). */
export function trAgg(
  deals: readonly Pick<TrackDeal, 'company' | 'multiple' | 'status'>[]
): TrackAgg {
  const valid = deals.filter((d) => d.company && parseFloat(d.multiple) > 0);
  const mults = valid.map((d) => parseFloat(d.multiple));
  const realized = valid.filter((d) => d.status === 'Realized').length;
  const blended = mults.length ? mults.reduce((a, b) => a + b, 0) / mults.length : 0;
  const top = mults.length ? Math.max(...mults) : 0;
  return { count: valid.length, realized, blended: blended.toFixed(1), top: top.toFixed(1) };
}

/** One-click integrations shown in the connections grid. */
export interface BrandConnector {
  id: string;
  name: string;
  /** lucide-ish icon name (resolved by the view). */
  icon: string;
}

export const CONNECTORS: readonly BrandConnector[] = [
  { id: 'linkedin', name: 'LinkedIn', icon: 'linkedin' },
  { id: 'x', name: 'X', icon: 'twitter' },
  { id: 'gmail', name: 'Gmail', icon: 'mail' },
  { id: 'calendar', name: 'Calendar', icon: 'calendar' },
  { id: 'calendly', name: 'Calendly', icon: 'calendar-clock' },
  { id: 'slack', name: 'Slack', icon: 'slack' }
];

/** A presence item that's connected (not copiloted-built) with a toggle. */
export interface PresenceItem {
  id: string;
  name: string;
  sub: string;
  /** lucide-ish icon name (resolved by the view). */
  icon: string;
}

export const PRESENCE_ITEMS: readonly PresenceItem[] = [
  { id: 'domain', name: 'Custom domain', sub: 'Secured & verified', icon: 'at-sign' },
  {
    id: 'company',
    name: 'LinkedIn company page',
    sub: 'On-brand, auto-updated',
    icon: 'building-2'
  },
  {
    id: 'content',
    name: 'Content & SEO engine',
    sub: 'Thought leadership cadence',
    icon: 'pen-line'
  }
];

/**
 * The prototype's approve-loop copy for setting up a presence item —
 * rendered by ActionRunner before anything persists.
 */
export function presenceRunCopy(itemName: string): {
  title: string;
  steps: string[];
  draftTitle: string;
  draft: string;
} {
  const title = `Set up ${itemName}`;
  return {
    title,
    steps: [
      'Verify the handle / domain',
      'Apply your brand & bio',
      'Link to your workspace',
      'Prepare for your approval'
    ],
    draftTitle: title,
    draft:
      'Earn set this up from your brand kit and profile. Approve to connect it and keep it in sync.'
  };
}

/** A fresh, editable copy of a builder's recommended decisions. */
export function brandDefaults(cfg: BrandBuildCfg): Record<string, BrandValue> {
  const out: Record<string, BrandValue> = {};
  for (const [k, v] of Object.entries(cfg.rec)) out[k] = Array.isArray(v) ? [...v] : v;
  return out;
}

/** Review rows for a produced brand item. */
export function brandRows(cfg: BrandBuildCfg, d: Record<string, BrandValue>): [string, string][] {
  return cfg.decisions.map((dec) => {
    const v = d[dec.key];
    return [dec.label, Array.isArray(v) ? (v.length ? v.join(', ') : 'None') : (v ?? '—')];
  });
}

/** The (illustrative) production sequence shown while a brand item builds. */
export function buildSteps(itemName: string): string[] {
  return [
    'Pull your fund story & profile',
    `Produce your ${itemName.toLowerCase()}`,
    'Polish to institutional standard',
    'Publish to your workspace'
  ];
}
