import {
  FORMATION_ITEMS,
  type FormationData,
  type FormationItem,
  type FormationKind
} from './config';

/**
 * lib/formation/steps.ts — step-level vocabulary for the formation buildout
 * (pure).
 *
 * Which slice of the shared FormationData document each step owns, whether a
 * step has been touched (for honest In-progress states), which steps must be
 * filed before another may file (server-enforced ordering), and how a filed
 * step maps onto a `capital_materials` data-room document. No React, no IO.
 */

/** How a filed step is on the record: version + filing/amendment times. */
export interface FormationStepMeta {
  version: number;
  filedAt: string;
  amendedAt: string | null;
}

/** The FormationData fields each step decides. */
export const STEP_FIELDS: Record<FormationKind, readonly (keyof FormationData)[]> = {
  story: ['storyHook', 'storyOrigin', 'storyEdges', 'storyWhyNow'],
  structure: ['entity', 'domicile', 'gp', 'mgmtco'],
  terms: ['fee', 'carry', 'hurdle', 'gpCommit', 'term', 'termsUndecided'],
  ppm: ['ppmTrack', 'ppmFee', 'ppmConflicts', 'ppmSector'],
  subscription: ['minCommit', 'accredMethod', 'sideLetters'],
  regulatory: ['exemption', 'accred', 'erisa'],
  bank: ['bank', 'escrow', 'acctType']
};

/** The step's decision slice — what persists as the data-room doc's `spec`. */
export function formationStepSpec(
  kind: FormationKind,
  d: FormationData
): Record<string, string | number | boolean | string[]> {
  const out: Record<string, string | number | boolean | string[]> = {};
  for (const field of STEP_FIELDS[kind]) {
    const v = d[field];
    out[field] = Array.isArray(v) ? [...v] : v;
  }
  return out;
}

/**
 * Whether the operator has decided anything on a step yet — its slice differs
 * from the (firm-personalized) defaults. Drives the checklist's honest
 * Not started / In progress distinction from real saved data.
 */
export function stepTouched(
  kind: FormationKind,
  d: FormationData,
  baseline: FormationData
): boolean {
  return STEP_FIELDS[kind].some((field) => {
    const a = d[field];
    const b = baseline[field];
    if (Array.isArray(a) || Array.isArray(b)) {
      const aa = Array.isArray(a) ? a : [];
      const bb = Array.isArray(b) ? b : [];
      return aa.length !== bb.length || aa.some((x, i) => x !== bb[i]);
    }
    return a !== b;
  });
}

/**
 * Steps that must be on the record before `kind` may file, in checklist
 * order. Formation builds sequentially (the entity must exist before the LPA
 * can govern it, the LPA before the PPM offers it, …), so a step's
 * prerequisites are every step ahead of it in FORMATION_ITEMS.
 */
export function missingPrereqs(
  kind: FormationKind,
  filed: ReadonlySet<FormationKind>
): FormationItem[] {
  const index = FORMATION_ITEMS.findIndex((i) => i.kind === kind);
  if (index <= 0) return [];
  return FORMATION_ITEMS.slice(0, index).filter((i) => !filed.has(i.kind));
}

/** The out-of-order filing error the server action returns (and the UI surfaces). */
export function orderingError(
  kind: FormationKind,
  filed: ReadonlySet<FormationKind>
): string | null {
  const missing = missingPrereqs(kind, filed);
  if (missing.length === 0) return null;
  const names = missing.map((m) => `“${m.name}”`).join(', then ');
  return `Formation builds in order — file ${names} before this step.`;
}

/**
 * filed formation step → capital_materials.kind. Must match the widened kind
 * check constraint. The bank step opens accounts; it produces no data-room
 * document, so it has no entry.
 */
export const FORMATION_MATERIAL_KIND: Partial<Record<FormationKind, string>> = {
  story: 'fund_narrative',
  structure: 'certificate_of_formation',
  terms: 'lpa',
  ppm: 'ppm',
  subscription: 'subscription_pack',
  regulatory: 'form_d'
};

/** Data-room document titles (match the room's FORM_DOC_META names). */
export const FORMATION_MATERIAL_TITLE: Partial<Record<FormationKind, string>> = {
  story: 'Fund narrative',
  structure: 'Certificate of Formation',
  terms: 'Limited Partnership Agreement',
  ppm: 'Private Placement Memorandum',
  subscription: 'Subscription pack',
  regulatory: 'Form D'
};

/**
 * Personalize the untouched entity-name defaults to the mandate's firm (the
 * prototype seeds "<firm> GP, LLC" / "<firm> Management, LLC"). Pure so the
 * page and the flow derive the same baseline for touched-state detection.
 */
export function personalizeFormationData(d: FormationData, firm: string): FormationData {
  return {
    ...d,
    gp: d.gp === 'GP, LLC' ? `${firm} GP, LLC` : d.gp,
    mgmtco: d.mgmtco === 'Management, LLC' ? `${firm} Management, LLC` : d.mgmtco
  };
}
