// Earn Diligence Brain — "ask your fund documents what matters."
//
// The Diligence surface is a thin query layer: each preset routes to the BGI
// Brain best suited to answer, with a goal template. This keeps "the Diligence
// Brain" a capability composed from the specialized executives rather than a
// monolith.

import type { BrainKey } from "@/lib/brains/types";

export interface DiligencePreset {
  id: string;
  label: string;
  brain: BrainKey;
  goal: string;
}

export const DILIGENCE_PRESETS: DiligencePreset[] = [
  {
    id: "lp_review",
    label: "Review this like an institutional LP",
    brain: "executive_advisor",
    goal: "Review the provided materials the way a sophisticated institutional LP would. Cover strategy, team, track record, terms, and risks; state what is compelling and what is missing.",
  },
  {
    id: "diligence_gaps",
    label: "What diligence gaps would stop a family office?",
    brain: "deal_sourcer",
    goal: "Identify the diligence gaps and unanswered questions that would stop a family office from committing. Be specific and prioritized.",
  },
  {
    id: "cim_to_memo",
    label: "Turn this CIM into an investment memo",
    brain: "marketing_pr",
    goal: "Turn the provided CIM/materials into a concise institutional investment memo: thesis, business, market, financials, risks, and recommendation.",
  },
  {
    id: "red_flags",
    label: "Red flags in this acquisition target",
    brain: "deal_sourcer",
    goal: "Surface the red flags in this acquisition target across financial, legal, operational, customer, and key-person dimensions. Rank by severity.",
  },
  {
    id: "seller_questions",
    label: "Generate follow-up questions for the seller",
    brain: "deal_sourcer",
    goal: "Generate the sharp follow-up questions to ask the seller, grouped by financials, operations, legal, and deal structure.",
  },
];

export const PRESET_BY_ID: Record<string, DiligencePreset> = Object.fromEntries(
  DILIGENCE_PRESETS.map((p) => [p.id, p]),
);
