import { GOV_POLICIES, type GovMember, type GovPolicy, type PolicyValue } from './config';

/**
 * lib/governance/persistence.ts — shape guards for the governance jsonb
 * columns (pure).
 *
 * `governance_policies.decisions` and `governance_bodies.members` round-trip
 * through these sanitizers, so a stale or hand-edited row can never crash the
 * hub or smuggle junk into a write. Decisions are validated against the
 * policy's actual option lists; members keep only the known fields with
 * capped lengths.
 */

/** The persistable governance-body kinds (DB check constraint mirrors this). */
export type GovBodyKind =
  | 'fund_mgmt'
  | 'ic'
  | 'advisory'
  | 'lpac'
  | 'capital_partners'
  | 'legal_counsel';

export const GOV_BODY_KINDS: readonly GovBodyKind[] = [
  'fund_mgmt',
  'ic',
  'advisory',
  'lpac',
  'capital_partners',
  'legal_counsel'
] as const;

const MAX_MEMBERS = 12;
const MAX_STR = 200;

export function policyById(id: string): GovPolicy | null {
  return GOV_POLICIES.find((p) => p.id === id) ?? null;
}

/**
 * Keep only the policy's decision keys, and only values drawn from its option
 * lists — a radio decision falls back to the recommendation when the stored
 * value is unknown; a multi keeps the valid subset.
 */
export function sanitizePolicyDecisions(
  pol: GovPolicy,
  input: unknown
): Record<string, PolicyValue> {
  const raw = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>;
  const out: Record<string, PolicyValue> = {};
  for (const dec of pol.decisions) {
    const v = raw[dec.key];
    if (dec.kind === 'multi') {
      const rec = pol.rec[dec.key];
      const fallback = Array.isArray(rec) ? [...rec] : [];
      out[dec.key] = Array.isArray(v)
        ? v.filter((x): x is string => typeof x === 'string' && dec.opts.includes(x))
        : fallback;
    } else {
      const rec = pol.rec[dec.key];
      out[dec.key] =
        typeof v === 'string' && dec.opts.includes(v)
          ? v
          : typeof rec === 'string'
            ? rec
            : dec.opts[0];
    }
  }
  return out;
}

const cap = (v: unknown): string | undefined =>
  typeof v === 'string' && v.length > 0 ? v.slice(0, MAX_STR) : undefined;

/** Coerce unknown input into a bounded, well-typed member roster. */
export function sanitizeGovMembers(input: unknown): GovMember[] {
  if (!Array.isArray(input)) return [];
  return input
    .filter((m): m is Record<string, unknown> => !!m && typeof m === 'object')
    .slice(0, MAX_MEMBERS)
    .map((m, i) => ({
      id: cap(m.id) ?? `m${i}`,
      name: cap(m.name),
      role: cap(m.role) ?? 'Member',
      you: m.you === true || undefined,
      open: m.open === true || undefined,
      pending: m.pending === true || undefined,
      note: cap(m.note),
      carry: cap(m.carry)
    }));
}
