export type ResearchCategory =
  | "company"
  | "investor"
  | "partner"
  | "competitor"
  | "vendor"
  | "lender"
  | "advisor"
  | "acquisition_target"
  | "operator";

export type VerificationLevel =
  | "verified"
  | "high_confidence"
  | "medium_confidence"
  | "low_confidence"
  | "unavailable";

export interface SourceReference {
  title: string;
  url: string;
  sourceType: "primary" | "filing" | "news" | "database" | "profile" | "secondary";
  observedAt: string;
}

export interface PointOfContact {
  name: string;
  role: string;
  email: string;
  phone: string;
  linkedin: string;
  verification: VerificationLevel;
  sourceUrl: string;
}

export interface ResearchEntity {
  entity: string;
  category: ResearchCategory;
  website: string;
  headquarters: string;
  industry: string;
  pointOfContact: PointOfContact;
  strategicFit: string;
  risks: string[];
  confidence: VerificationLevel;
  sources: SourceReference[];
  recommendedNextAction: string;
}

export const RESEARCH_OUTPUT_COLUMNS = [
  "Entity",
  "Category",
  "Website",
  "Point of Contact",
  "Role",
  "Email",
  "Phone",
  "Strategic Fit",
  "Confidence",
  "Sources",
  "Recommended Next Action",
] as const;

const UNVERIFIED = "Not publicly verified";

export function emptyPointOfContact(sourceUrl = UNVERIFIED): PointOfContact {
  return {
    name: UNVERIFIED,
    role: UNVERIFIED,
    email: UNVERIFIED,
    phone: UNVERIFIED,
    linkedin: UNVERIFIED,
    verification: "unavailable",
    sourceUrl,
  };
}

export function verificationRank(level: VerificationLevel): number {
  return {
    verified: 5,
    high_confidence: 4,
    medium_confidence: 3,
    low_confidence: 2,
    unavailable: 1,
  }[level];
}

export function scoreSourceQuality(sources: SourceReference[]): VerificationLevel {
  if (sources.some((s) => s.sourceType === "primary" || s.sourceType === "filing")) return "verified";
  if (sources.length >= 2 && sources.some((s) => s.sourceType === "news" || s.sourceType === "database")) return "high_confidence";
  if (sources.length === 1) return "medium_confidence";
  return "unavailable";
}

export function normalizeResearchEntity(input: Partial<ResearchEntity> & Pick<ResearchEntity, "entity" | "category">): ResearchEntity {
  const sources = input.sources ?? [];
  const inferredConfidence = scoreSourceQuality(sources);
  const confidence =
    input.confidence && verificationRank(input.confidence) <= verificationRank(inferredConfidence)
      ? input.confidence
      : inferredConfidence;

  return {
    entity: input.entity.trim(),
    category: input.category,
    website: input.website?.trim() || UNVERIFIED,
    headquarters: input.headquarters?.trim() || UNVERIFIED,
    industry: input.industry?.trim() || UNVERIFIED,
    pointOfContact: input.pointOfContact ?? emptyPointOfContact(sources[0]?.url ?? UNVERIFIED),
    strategicFit: input.strategicFit?.trim() || "Fit requires additional verification.",
    risks: input.risks?.length ? input.risks : ["Data completeness requires verification."],
    confidence,
    sources,
    recommendedNextAction: input.recommendedNextAction?.trim() || "Verify source data before outreach.",
  };
}

export function shouldUseBrowserResearch(prompt: string): boolean {
  return /\b(source|find|verify|research|current|latest|news|filing|website|linkedin|competitor|market map|contact|email|phone|partner|target|investor|lender)\b/i.test(prompt);
}

export function toResearchTableRow(entity: ResearchEntity): Record<(typeof RESEARCH_OUTPUT_COLUMNS)[number], string> {
  return {
    Entity: entity.entity,
    Category: entity.category.replace(/_/g, " "),
    Website: entity.website,
    "Point of Contact": entity.pointOfContact.name,
    Role: entity.pointOfContact.role,
    Email: entity.pointOfContact.email,
    Phone: entity.pointOfContact.phone,
    "Strategic Fit": entity.strategicFit,
    Confidence: entity.confidence.replace(/_/g, " "),
    Sources: entity.sources.map((s) => s.url).join("; ") || UNVERIFIED,
    "Recommended Next Action": entity.recommendedNextAction,
  };
}
