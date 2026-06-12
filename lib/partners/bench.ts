/**
 * lib/partners/bench.ts — the Partner Network's bench vocabulary (pure).
 *
 * The prototype works the vetted bench on a three-stage ladder
 * (`PROV_STAGES`: Suggested → Contacted → Engaged) with exactly one move
 * per non-final stage (`PROV_NEXT`: "Request intro" → "Engage"). The live
 * bench derives that ladder from real state — the provider's directory
 * `status` plus the requester's tracked `partner_intro_requests` row:
 *
 *   provider status active|engaged|retained      → engaged
 *   intro request 'introduced'                   → engaged
 *   intro request 'requested' | 'accepted'       → contacted
 *   anything else (incl. 'declined' — the intro
 *   can be re-requested)                         → suggested
 *
 * Fit, terms and the note line come from what is actually on file
 * (capability tags + the `_meta` block `adoptProvider` writes) — never
 * invented.
 */

export type BenchStage = 'suggested' | 'contacted' | 'engaged';

export const BENCH_STAGES: readonly BenchStage[] = ['suggested', 'contacted', 'engaged'];

/** The prototype's PROV_TONE, over the app's badge tones. */
export const BENCH_STAGE_META: Record<
  BenchStage,
  { label: string; tone: 'neutral' | 'azure' | 'success' }
> = {
  suggested: { label: 'Suggested', tone: 'neutral' },
  contacted: { label: 'Contacted', tone: 'azure' },
  engaged: { label: 'Engaged', tone: 'success' }
};

/** The prototype's PROV_NEXT — Earn's one move per non-final stage. */
export const BENCH_NEXT: Partial<Record<BenchStage, string>> = {
  suggested: 'Request intro',
  contacted: 'Engage'
};

/** Directory statuses that read as an active relationship ('active' is the
 *  schema default and what the marketplace writes for live providers).
 *  Exact match (normalized) — a substring test would wrongly promote
 *  'inactive' / 'disengaged'. */
const ENGAGED_STATUS = new Set(['active', 'engaged', 'retained']);

const INTRO_CONTACTED = new Set(['requested', 'accepted']);
const INTRO_ENGAGED = new Set(['introduced']);

export function benchStage(
  providerStatus: string | null | undefined,
  introStatus?: string | null
): BenchStage {
  if (ENGAGED_STATUS.has((providerStatus ?? '').trim().toLowerCase())) return 'engaged';
  const s = (introStatus ?? '').toLowerCase();
  if (INTRO_ENGAGED.has(s)) return 'engaged';
  if (INTRO_CONTACTED.has(s)) return 'contacted';
  return 'suggested';
}

/* ── categories & essential coverage ─────────────────────────────────────── */

export type BenchCategoryKey =
  | 'counsel'
  | 'admin'
  | 'audit'
  | 'placement'
  | 'capital'
  | 'prime'
  | 'other';

/** Free-form directory categories → the prototype's category set. Order
 *  matters: "Placement agent" must hit placement before the broker/prime
 *  patterns. */
const CATEGORY_MATCH: readonly [BenchCategoryKey, RegExp][] = [
  ['counsel', /legal|counsel|law/i],
  ['admin', /admin/i],
  ['audit', /audit|tax|account/i],
  ['placement', /placement|distribution/i],
  ['prime', /prime|brokerage|broker|custod/i],
  ['capital', /capital|lend|credit|debt/i]
];

export function benchCategoryKey(category: string | null | undefined): BenchCategoryKey {
  for (const [key, re] of CATEGORY_MATCH) {
    if (re.test(category ?? '')) return key;
  }
  return 'other';
}

/** The prototype's PROV_ESSENTIAL — the four roles every raise needs. */
export const ESSENTIALS: readonly { key: BenchCategoryKey; label: string }[] = [
  { key: 'counsel', label: 'Fund counsel' },
  { key: 'admin', label: 'Fund administration' },
  { key: 'audit', label: 'Audit & tax' },
  { key: 'placement', label: 'Placement agent' }
];

/** Per the prototype, an essential chip lights only when a provider of that
 *  category is Engaged — in-flight intros don't count as coverage. */
export function essentialCoverage(
  rows: readonly { category: string | null; stage: BenchStage }[]
): { key: BenchCategoryKey; label: string; engaged: boolean }[] {
  return ESSENTIALS.map((e) => ({
    ...e,
    engaged: rows.some((r) => benchCategoryKey(r.category) === e.key && r.stage === 'engaged')
  }));
}

/* ── fit, terms & notes from what's actually on file ─────────────────────── */

const STAGE_FIT: Record<BenchStage, number> = { suggested: 0, contacted: 12, engaged: 24 };

/**
 * Bench fit (58–98) from real signals: relationship progress (most weight),
 * whether the category covers an essential role, and vetting depth — how
 * much is actually on file (capability tags, terms, a vetting note).
 */
export function computeBenchFit(input: {
  stage: BenchStage;
  essential: boolean;
  capabilityCount: number;
  hasTerms: boolean;
  hasNote: boolean;
}): number {
  const depth =
    Math.min(Math.max(input.capabilityCount, 0), 5) * 2 +
    (input.hasTerms ? 3 : 0) +
    (input.hasNote ? 3 : 0);
  return Math.min(98, 58 + STAGE_FIT[input.stage] + (input.essential ? 8 : 0) + depth);
}

export interface BenchMeta {
  /** Capability tags (object keys; underscore-prefixed keys are internal). */
  tags: string[];
  terms: string | null;
  note: string | null;
}

/** Read what `adoptProvider` (and future enrichment) stores in the
 *  `capabilities` jsonb: tag keys + a `_meta` block. */
export function benchMeta(capabilities: Record<string, unknown> | null | undefined): BenchMeta {
  const caps = capabilities ?? {};
  const tags = Object.keys(caps).filter((k) => !k.startsWith('_'));
  const meta = (typeof caps._meta === 'object' && caps._meta !== null ? caps._meta : {}) as Record<
    string,
    unknown
  >;
  const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null);
  return { tags, terms: str(meta.terms), note: str(meta.description) ?? str(meta.fitRationale) };
}

const STAGE_NOTE: Record<BenchStage, string> = {
  suggested: 'Vetted for your bench',
  contacted: 'Intro in motion',
  engaged: 'Active relationship'
};

/** The card's note line: the vetting note if one is on file, else the
 *  capability tags, else an honest read of the relationship state. */
export function benchNote(stage: BenchStage, meta: BenchMeta): string {
  if (meta.note) return meta.note;
  if (meta.tags.length > 0) return meta.tags.slice(0, 3).join(' · ');
  return STAGE_NOTE[stage];
}

/* ── the derived bench row ───────────────────────────────────────────────── */

export interface BenchProviderInput {
  id: string;
  name: string;
  category: string | null;
  status: string;
  capabilities: Record<string, unknown>;
}

export interface BenchRow {
  id: string;
  name: string;
  /** Display category (raw directory value, 'Provider' when missing). */
  category: string;
  key: BenchCategoryKey;
  stage: BenchStage;
  fit: number;
  terms: string | null;
  note: string;
  essential: boolean;
}

/** The prototype's grid order: Engaged first, then fit, then name. */
export function compareBench(
  a: Pick<BenchRow, 'stage' | 'fit' | 'name'>,
  b: Pick<BenchRow, 'stage' | 'fit' | 'name'>
): number {
  return (
    (b.stage === 'engaged' ? 1 : 0) - (a.stage === 'engaged' ? 1 : 0) ||
    b.fit - a.fit ||
    a.name.localeCompare(b.name)
  );
}

export function deriveBench(
  providers: readonly BenchProviderInput[],
  introStatus: Record<string, string>
): BenchRow[] {
  return providers
    .map((p) => {
      const stage = benchStage(p.status, introStatus[p.id]);
      const key = benchCategoryKey(p.category);
      const essential = ESSENTIALS.some((e) => e.key === key);
      const meta = benchMeta(p.capabilities);
      const fit = computeBenchFit({
        stage,
        essential,
        capabilityCount: meta.tags.length,
        hasTerms: meta.terms !== null,
        hasNote: meta.note !== null
      });
      return {
        id: p.id,
        name: p.name,
        category: p.category?.trim() || 'Provider',
        key,
        stage,
        fit,
        terms: meta.terms,
        note: benchNote(stage, meta),
        essential
      };
    })
    .sort(compareBench);
}

/** "Last activity" framing for the drawer ('—' when nothing is on record). */
export function relativeActivity(iso: string | null | undefined, now = Date.now()): string {
  if (!iso) return '—';
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return '—';
  const days = Math.floor(Math.max(0, now - t) / 86_400_000);
  if (days === 0) return 'Today';
  if (days < 7) return `${days}d ago`;
  if (days < 30) return `${Math.floor(days / 7)}w ago`;
  return `${Math.floor(days / 30)}mo ago`;
}
