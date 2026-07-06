// Shared reference corpus for the Brain layer.
//
// Most knowledge in lib/brains/knowledge/ is per-Brain: one <brain_key>.md file
// that only that Brain retrieves over. A REFERENCE doc is cross-cutting field
// knowledge (a PE playbook, an agent-pattern catalog) that several Brains should
// be able to reason over. Because retrieval is keyed by brain (the
// brain_kb_chunks table + match_brain_kb_chunks RPC filter on brain_key), a
// reference doc is folded into EACH Brain it is mapped to at ingestion time —
// no schema change, and retrieval stays per-Brain and unchanged.
//
// Files live under lib/brains/knowledge/reference/. The ingest route
// (app/api/brains/ingest) reads each Brain's own KB file plus any reference docs
// mapped to it, and embeds them together under that brain_key.

import type { BrainKey } from "@/lib/brains/types";

export interface ReferenceDoc {
  // Filename under lib/brains/knowledge/reference/.
  file: string;
  // Brains this reference is folded into (retrievable by each of them).
  brains: BrainKey[];
}

// The reference-doc → Brain mapping. Keep each doc scoped to the Brains that
// would actually reason over it so retrieval stays purposeful.
export const REFERENCE_DOCS: ReferenceDoc[] = [
  {
    // Private-equity field guide: deal process, valuation, LBO, metrics,
    // diligence, value-creation levers. The deal/capital/advisory Brains.
    file: "private_equity_playbook.md",
    brains: [
      "executive_advisor",
      "deal_sourcer",
      "capital_connector",
      "capital_raiser",
      "investor_relations",
      "rainmaker",
    ],
  },
  {
    // Catalog of B2B AI agent archetypes across the revenue engine. The growth,
    // marketing, SEO, funnel, and intake Brains.
    file: "b2b_ai_agents_catalog.md",
    brains: [
      "funnel_lead_gen",
      "seo_disrupter",
      "marketing_pr",
      "automater_scrubber",
      "earnest_fundmaker",
    ],
  },
];

// Reference docs mapped to a given Brain (used by the ingest route).
export function referenceDocsForBrain(brainKey: BrainKey): ReferenceDoc[] {
  return REFERENCE_DOCS.filter((doc) => doc.brains.includes(brainKey));
}
