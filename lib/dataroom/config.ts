/**
 * lib/dataroom/config.ts — Materials & Data Room config (pure).
 *
 * Ported from the onboarding prototype's `materials.jsx` data layer: the
 * copiloted investor-material builders (you shape it, Earn drafts it) plus the
 * data-room scaffolding (folders, seeded access/activity, invitee + recipient
 * benches). Illustrative until a documents/data-room schema lands. Pure (no
 * React, no IO) so it unit-tests cleanly.
 */

export type MaterialStage = 'Draft' | 'Ready';

export interface MaterialMeta {
  cat: string;
  /** lucide-ish icon name (resolved by the view). */
  icon: string;
  fmt: string;
  folder: string;
}

export const MAT_META: Record<string, MaterialMeta> = {
  deck: { cat: 'Narrative', icon: 'presentation', fmt: '14 slides', folder: 'Fund Overview' },
  onepager: { cat: 'Narrative', icon: 'file-text', fmt: '1 page', folder: 'Fund Overview' },
  ddq: { cat: 'Diligence', icon: 'clipboard-list', fmt: 'Q&A', folder: 'Diligence' },
  track: { cat: 'Proof', icon: 'trending-up', fmt: 'Dataset', folder: 'Track Record' },
  model: { cat: 'Financials', icon: 'calculator', fmt: 'XLSX', folder: 'Track Record' },
  update: { cat: 'Investor', icon: 'mail', fmt: 'Template', folder: 'Diligence' }
};

export const MAT_DOCS = ['deck', 'onepager', 'ddq', 'track', 'model', 'update'] as const;

export const MAT_LABEL: Record<string, string> = {
  deck: 'Pitch deck',
  onepager: 'One-pager',
  ddq: 'Due-diligence questionnaire',
  track: 'Track record',
  model: 'Financial model',
  update: 'LP update template'
};

/** Documents Formation produces (read-only here; they flow into the room). */
export const FORM_DOC_META: Record<string, { name: string; folder: string }> = {
  story: { name: 'Fund narrative', folder: 'Fund Overview' },
  entity: { name: 'Certificate of Formation', folder: 'Legal & Terms' },
  lpa: { name: 'Limited Partnership Agreement', folder: 'Legal & Terms' },
  ppm: { name: 'Private Placement Memorandum', folder: 'Legal & Terms' },
  subdocs: { name: 'Subscription pack', folder: 'Legal & Terms' },
  regd: { name: 'Form D', folder: 'Legal & Terms' }
};

export interface MaterialDecision {
  key: string;
  kind: 'radio' | 'multi';
  label: string;
  opts: string[];
}

export type MaterialValue = string | string[];

export interface MaterialBuildCfg {
  intro: string;
  decisions: MaterialDecision[];
  rec: Record<string, MaterialValue>;
  recText: string;
}

export const MATERIAL_BUILD: Record<string, MaterialBuildCfg> = {
  deck: {
    intro:
      'Your fund deck — the narrative LPs read first. Choose what it leads with and what it covers; Earn drafts every slide.',
    decisions: [
      {
        key: 'emphasis',
        kind: 'radio',
        label: 'Lead with',
        opts: ['Thesis', 'Track record', 'Team']
      },
      {
        key: 'sections',
        kind: 'multi',
        label: 'Sections',
        opts: [
          'Thesis & why now',
          'Team & edge',
          'Track record',
          'Market map',
          'Portfolio construction',
          'Terms',
          'The ask'
        ]
      },
      {
        key: 'length',
        kind: 'radio',
        label: 'Length',
        opts: ['Tight · 10', 'Standard · 14', 'Full · 20']
      }
    ],
    rec: {
      emphasis: 'Thesis',
      sections: [
        'Thesis & why now',
        'Team & edge',
        'Track record',
        'Market map',
        'Terms',
        'The ask'
      ],
      length: 'Standard · 14'
    },
    recText:
      'Lead with your thesis — it’s what sets you apart. Keep it to ~14 slides covering thesis, team, track record, market, terms and a clear ask. I’ll draft each from your fund story.'
  },
  onepager: {
    intro: 'The one-pager an LP forwards internally. Pick the headline and what to include.',
    decisions: [
      { key: 'focus', kind: 'radio', label: 'Headline', opts: ['Returns', 'Strategy', 'Team'] },
      {
        key: 'include',
        kind: 'multi',
        label: 'Include',
        opts: ['Headline metrics', 'One-line thesis', 'Sector focus', 'Terms snapshot', 'Contact']
      }
    ],
    rec: {
      focus: 'Strategy',
      include: ['Headline metrics', 'One-line thesis', 'Terms snapshot', 'Contact']
    },
    recText:
      'Lead with strategy — for an emerging manager the thesis travels further than a short track record. Keep metrics, a one-line thesis, a terms snapshot and contact.'
  },
  ddq: {
    intro:
      'Your due-diligence questionnaire — the standard answers institutional LPs require. Choose the sets to cover.',
    decisions: [
      {
        key: 'sets',
        kind: 'multi',
        label: 'Question sets',
        opts: ['Firm & team', 'Strategy', 'Track record', 'Operations', 'Compliance', 'ESG']
      }
    ],
    rec: { sets: ['Firm & team', 'Strategy', 'Track record', 'Operations', 'Compliance'] },
    recText:
      'Cover the five sets institutional LPs always ask for. Add ESG if you’ll approach endowments or European capital — many now require it.'
  },
  track: {
    intro:
      'How your track record is presented. Returns can make or break the room — choose the basis and metrics.',
    decisions: [
      { key: 'basis', kind: 'radio', label: 'Returns basis', opts: ['Net to LP', 'Gross'] },
      {
        key: 'metrics',
        kind: 'multi',
        label: 'Show',
        opts: ['Realized deals', 'IRR', 'MOIC', 'DPI', 'Loss ratio', 'Benchmark']
      }
    ],
    rec: { basis: 'Net to LP', metrics: ['Realized deals', 'IRR', 'MOIC', 'Benchmark'] },
    recText:
      'Show net-to-LP returns — it’s what sophisticated LPs trust and compare. Lead with realized deals, IRR and MOIC, and benchmark against the vintage.'
  },
  model: {
    intro: 'Your financial model — the return math under the thesis. Choose scenarios and horizon.',
    decisions: [
      { key: 'scenarios', kind: 'multi', label: 'Scenarios', opts: ['Base', 'Upside', 'Downside'] },
      { key: 'horizon', kind: 'radio', label: 'Horizon', opts: ['5 years', '10 years'] }
    ],
    rec: { scenarios: ['Base', 'Upside', 'Downside'], horizon: '10 years' },
    recText:
      'Model all three scenarios over a 10-year horizon to match your fund term. LPs stress the downside hardest — showing it builds credibility.'
  },
  update: {
    intro:
      'A reusable LP update template — the cadence that keeps investors confident between raises.',
    decisions: [
      { key: 'cadence', kind: 'radio', label: 'Cadence', opts: ['Monthly', 'Quarterly'] },
      {
        key: 'sections',
        kind: 'multi',
        label: 'Sections',
        opts: ['NAV & performance', 'Portfolio news', 'Capital activity', 'Market commentary']
      }
    ],
    rec: {
      cadence: 'Quarterly',
      sections: ['NAV & performance', 'Portfolio news', 'Capital activity']
    },
    recText:
      'Quarterly is the institutional standard — enough signal without over-promising. Lead with NAV & performance, then portfolio news and capital activity.'
  }
};

export interface DataRoomAccess {
  id: string;
  name: string;
  type: string;
  status: string;
  tone: 'success' | 'azure' | 'neutral';
  live?: boolean;
}

export const DR_ACCESS_0: readonly DataRoomAccess[] = [
  {
    id: 'granite',
    name: 'Granite Endowment',
    type: 'Endowment',
    status: 'Viewing now',
    tone: 'success',
    live: true
  },
  {
    id: 'meridian',
    name: 'Meridian Family Office',
    type: 'Family office',
    status: 'Downloaded deck',
    tone: 'azure'
  },
  { id: 'coastal', name: 'Coastal Pension', type: 'Pension', status: 'Invited', tone: 'neutral' }
];

export interface DataRoomActivity {
  who: string;
  act: string;
  t: string;
  icon: string;
}

export const DR_ACTIVITY_0: readonly DataRoomActivity[] = [
  { who: 'Granite Endowment', act: 'opened Pitch deck', t: '2h ago', icon: 'eye' },
  { who: 'Meridian Family Office', act: 'downloaded One-pager', t: 'Yesterday', icon: 'download' },
  { who: 'You', act: 'shared the room with Coastal Pension', t: '2d ago', icon: 'share-2' }
];

export interface DataRoomInvitee {
  id: string;
  name: string;
  type: string;
}

export const DR_INVITEES: readonly DataRoomInvitee[] = [
  { id: 'beacon', name: 'Beacon Foundation', type: 'Foundation' },
  { id: 'summit', name: 'Summit Ventures LP', type: 'Institutional' },
  { id: 'aurelius', name: 'Aurelius Capital', type: 'Fund-of-funds' }
];

export interface DataRoomProspect {
  name: string;
  firm: string;
}

export const DR_PROSPECTS: readonly DataRoomProspect[] = [
  { name: 'David Chen', firm: 'Granite Endowment' },
  { name: 'Maria Solberg', firm: 'Meridian Family Office' },
  { name: 'James Okafor', firm: 'Coastal Pension' },
  { name: 'Lena Vossberg', firm: 'Aurelius Capital' }
];

export const MAT_TONE: Record<MaterialStage, 'neutral' | 'success'> = {
  Draft: 'neutral',
  Ready: 'success'
};

/** The expiry choices an operator picks from when generating a share link. */
export interface LinkExpiryPreset {
  id: string;
  label: string;
  days: number | null;
}

export const LINK_EXPIRY_PRESETS: readonly LinkExpiryPreset[] = [
  { id: '30d', label: 'Expires in 30 days', days: 30 },
  { id: '90d', label: 'Expires in 90 days', days: 90 },
  { id: 'never', label: 'No expiry', days: null }
];

export const DEFAULT_LINK_EXPIRY = '30d';

/** Resolve a preset id to the link's `expires_at` (null = no expiry).
 *  Unknown ids fall back to the default preset — never to "never". */
export function expiryTimestamp(presetId: string, now: Date = new Date()): string | null {
  const preset =
    LINK_EXPIRY_PRESETS.find((p) => p.id === presetId) ??
    LINK_EXPIRY_PRESETS.find((p) => p.id === DEFAULT_LINK_EXPIRY)!;
  return preset.days === null
    ? null
    : new Date(now.getTime() + preset.days * 86_400_000).toISOString();
}

/** A fresh, editable copy of a material's recommended decisions. */
export function materialDefaults(cfg: MaterialBuildCfg): Record<string, MaterialValue> {
  const out: Record<string, MaterialValue> = {};
  for (const [k, v] of Object.entries(cfg.rec)) out[k] = Array.isArray(v) ? [...v] : v;
  return out;
}

/** Review rows for a built material. */
export function materialRows(
  cfg: MaterialBuildCfg,
  d: Record<string, MaterialValue>
): [string, string][] {
  return cfg.decisions.map((dec) => {
    const v = d[dec.key];
    return [dec.label, Array.isArray(v) ? (v.length ? v.join(', ') : 'None') : (v ?? '—')];
  });
}

/** The (illustrative) build sequence shown while a material drafts. */
export function buildSteps(id: string): string[] {
  const meta = MAT_META[id];
  const name = (MAT_LABEL[id] ?? id).toLowerCase();
  return [
    'Pull your fund story & data',
    `Draft your ${name}`,
    'Format to institutional standard',
    `Place in ${meta?.folder ?? 'the data room'}`
  ];
}

/** A short, token-like link suffix (illustrative). Each segment is exactly 4
 *  base-36 chars (zero-padded) so the shape is stable for any rng value. */
export function linkToken(rand: () => number = Math.random): string {
  const seg = () =>
    Math.floor(rand() * 36 ** 4)
      .toString(36)
      .padStart(4, '0');
  return `${seg()}-${seg()}`;
}
