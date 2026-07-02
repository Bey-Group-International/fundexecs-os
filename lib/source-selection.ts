import type { SourceCandidate } from "@/lib/source-ai";

export type SourceSelectionCandidate = Pick<
  SourceCandidate,
  | "name"
  | "category"
  | "rationale"
  | "fitScore"
  | "sourceUrl"
  | "website"
  | "contactName"
  | "contactRole"
  | "contactEmail"
  | "contactPhone"
  | "aumRange"
  | "ticketRange"
  | "strategies"
  | "geography"
>;

export interface SourceSelectionPayload {
  picks: {
    name: string;
    category: string;
    rationale: string;
    fitScore: number;
    sourceUrl?: string;
    website?: string;
    contactName?: string;
    contactRole?: string;
    contactEmail?: string;
    contactPhone?: string;
    aumRange?: string;
    ticketRange?: string;
    strategies?: string[];
    geography?: string;
  }[];
  rejected: {
    name: string;
    category: string;
    rationale: string;
    fitScore: number;
  }[];
}

/**
 * Convert a reviewed candidate list into accepted + rejected learning payloads.
 * Both Source Search and the in-module panel use this so feedback stays
 * consistent no matter where the operator sources from.
 */
export function buildSourceSelectionPayload(
  candidates: SourceSelectionCandidate[],
  isSelected: (candidate: SourceSelectionCandidate, index: number) => boolean,
): SourceSelectionPayload {
  const payload: SourceSelectionPayload = { picks: [], rejected: [] };
  candidates.forEach((candidate, index) => {
    const base = {
      name: candidate.name,
      category: candidate.category,
      rationale: candidate.rationale,
      fitScore: candidate.fitScore,
    };
    if (isSelected(candidate, index)) {
      payload.picks.push({
        ...base,
        sourceUrl: candidate.sourceUrl,
        website: candidate.website,
        contactName: candidate.contactName,
        contactRole: candidate.contactRole,
        contactEmail: candidate.contactEmail,
        contactPhone: candidate.contactPhone,
        aumRange: candidate.aumRange,
        ticketRange: candidate.ticketRange,
        strategies: candidate.strategies,
        geography: candidate.geography,
      });
    } else {
      payload.rejected.push(base);
    }
  });
  return payload;
}
