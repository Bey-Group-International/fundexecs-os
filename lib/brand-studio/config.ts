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
