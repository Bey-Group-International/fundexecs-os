/**
 * lib/source/vocab.ts — the Source hub's persona vocabulary (pure).
 *
 * The prototype titles the hub's first tab per operator group (`SRC_TITLE`):
 * a fund manager maps LPs, a capital allocator maps allocation targets, a
 * services firm maps clients. The live grouping derives from the org-level
 * `organizations.type` enum; a missing/unknown type reads as a fund (the
 * app's primary persona). Shared by the hub shell and the tab interiors so
 * every surface speaks the same noun.
 */

export type SourceGroup = 'fund' | 'capital' | 'service';

/** The prototype's SRC_TITLE — the first tab's label per group. */
export const SRC_TITLE: Record<SourceGroup, string> = {
  fund: 'LP Capital Map',
  capital: 'Allocation targets',
  service: 'Client pipeline'
};

/** The prototype's SRC_NOUN — what the operator is sourcing. */
export const SRC_NOUN: Record<SourceGroup, string> = {
  fund: 'LP',
  capital: 'target',
  service: 'client'
};

/** Plural forms for tile labels ("LPs advanced", "clients advanced"). */
export const SRC_NOUN_PLURAL: Record<SourceGroup, string> = {
  fund: 'LPs',
  capital: 'targets',
  service: 'clients'
};

/** Map an `organizations.type` enum value to the prototype's group. */
export function sourceGroupFor(orgType: string | null | undefined): SourceGroup {
  switch (orgType) {
    case 'lp':
    case 'capital_provider':
      return 'capital';
    case 'service_provider':
    case 'partner':
      return 'service';
    default:
      // 'fund', 'operator', null/unknown — the app's primary persona.
      return 'fund';
  }
}
