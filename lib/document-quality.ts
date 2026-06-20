// lib/document-quality.ts
// Makes the document builder self-aware and institutional: per-section guidance
// (the structure an allocator expects) and a deterministic readiness score that
// critiques the current draft. Pure — used both client-side (live score) and
// server-side (injected into Earn's system prompt). Unit-tested.

export interface SectionGuidance {
  /** One-line institutional structure guidance, fed to Earn. */
  structure: string;
  /** Lowercase topic keywords an institutional version should cover. */
  topics: string[];
  /** Whether quantitative figures are expected (numbers/percentages/$). */
  quantitative: boolean;
}

const DEFAULT_GUIDANCE: SectionGuidance = {
  structure:
    "Lead with the outcome; use clear headings, concise paragraphs, and bullet points; be specific and verifiable.",
  topics: ["overview", "details", "next steps"],
  quantitative: false,
};

const GUIDANCE: Record<string, SectionGuidance> = {
  overview: {
    structure:
      "Firm overview: one-line positioning, what you do, differentiated edge, headline proof points, and how to engage.",
    topics: ["positioning", "strategy", "edge", "highlights"],
    quantitative: false,
  },
  marketing: {
    structure:
      "Executive summary / collateral: positioning, strategy, headline performance, team, and a clear ask — tight and skimmable.",
    topics: ["positioning", "strategy", "performance", "team", "ask"],
    quantitative: true,
  },
  thesis: {
    structure:
      "Investment strategy: market opportunity, strategy & focus, differentiated edge, target returns, check size & stage, and key risks.",
    topics: ["market", "strategy", "edge", "returns", "check size", "risk"],
    quantitative: true,
  },
  track_record: {
    structure:
      "Track record: pooled performance (gross IRR / MOIC / DPI), realized vs unrealized, representative deals, and return attribution.",
    topics: ["irr", "moic", "realized", "attribution", "deal"],
    quantitative: true,
  },
  portfolio: {
    structure:
      "Portfolio: holdings overview, representative case studies (entry → value creation → status), and current marks.",
    topics: ["holdings", "case study", "value creation", "marks"],
    quantitative: true,
  },
  team: {
    structure:
      "Team & governance: principals with bios, relevant experience, organizational structure, and decision governance.",
    topics: ["principals", "experience", "governance"],
    quantitative: false,
  },
  fund_terms: {
    structure:
      "Fund terms: structure & target size, management fee & carried interest, term, GP commitment, hurdle/preferred return, and key terms.",
    topics: ["structure", "fee", "carry", "term", "gp commit", "hurdle"],
    quantitative: true,
  },
  legal: {
    structure: "Legal & structure: entities, jurisdictions of formation, ownership, and material agreements.",
    topics: ["entity", "jurisdiction", "ownership", "agreement"],
    quantitative: false,
  },
  financials: {
    structure: "Financials: AUM/NAV, fund and management-company financials, and audit status with the auditor named.",
    topics: ["aum", "nav", "audit"],
    quantitative: true,
  },
  compliance: {
    structure: "Compliance & regulatory: registrations (e.g. Form ADV), AML/KYC, and key compliance policies.",
    topics: ["adv", "aml", "kyc", "policy"],
    quantitative: false,
  },
  diligence: {
    structure: "Diligence / DDQ: scope, structured questions and responses, aligned to the ILPA DDQ where possible.",
    topics: ["scope", "ilpa", "response"],
    quantitative: false,
  },
};

export function sectionGuidance(section: string | null): SectionGuidance {
  return (section && GUIDANCE[section]) || DEFAULT_GUIDANCE;
}

/** Institutional structure guidance for a document, injected into Earn prompts. */
export function guidanceText(docName: string, section: string | null): string {
  const name = docName.toLowerCase();
  if (name.includes("executive summary") || name.includes("one-pager") || name.includes("one pager")) {
    return GUIDANCE.marketing.structure;
  }
  return sectionGuidance(section).structure;
}

export interface QualityCheck {
  label: string;
  ok: boolean;
}
export interface QualityReport {
  score: number; // 0–100
  level: "Empty" | "Draft" | "Solid" | "Institutional";
  checks: QualityCheck[];
  gaps: string[];
}

const wordsOf = (s: string) => s.trim().split(/\s+/).filter(Boolean).length;

/** Score a draft against the institutional bar for its section. Deterministic. */
export function scoreDocument(docName: string, section: string | null, content: string): QualityReport {
  const text = (content ?? "").trim();
  const lower = text.toLowerCase();
  const g = sectionGuidance(
    /executive summary|one-?pager/.test(docName.toLowerCase()) ? "marketing" : section,
  );

  if (!text) {
    return {
      score: 0,
      level: "Empty",
      checks: [{ label: "Has content", ok: false }],
      gaps: ["The document is empty — answer the guided setup or draft with Earn."],
    };
  }

  const words = wordsOf(text);
  const hasHeadings = /(^|\n)#{1,6}\s/.test(text) || /(^|\n)\s*[-*]\s+/.test(text);
  const noTodos = !/\[todo/i.test(text);
  const hasNumbers = /\d/.test(text);
  const coveredTopics = g.topics.filter((t) => lower.includes(t));
  const topicCoverage = g.topics.length ? coveredTopics.length / g.topics.length : 1;

  const checks: QualityCheck[] = [
    { label: "Substantive length (150+ words)", ok: words >= 150 },
    { label: "Structured (headings or bullets)", ok: hasHeadings },
    { label: "No open [TODO] gaps", ok: noTodos },
    { label: "Covers the expected topics", ok: topicCoverage >= 0.6 },
  ];
  if (g.quantitative) checks.push({ label: "Includes figures / metrics", ok: hasNumbers });

  const passed = checks.filter((c) => c.ok).length;
  const score = Math.round((passed / checks.length) * 100);
  const level: QualityReport["level"] = score >= 80 ? "Institutional" : score >= 50 ? "Solid" : "Draft";

  const gaps: string[] = [];
  if (words < 150) gaps.push("Add depth — expand beyond a stub.");
  if (!hasHeadings) gaps.push("Add structure with headings or bullet points.");
  if (!noTodos) gaps.push("Resolve the remaining [TODO] placeholders.");
  if (topicCoverage < 0.6) {
    const missing = g.topics.filter((t) => !lower.includes(t));
    gaps.push(`Cover the missing topics: ${missing.join(", ")}.`);
  }
  if (g.quantitative && !hasNumbers) gaps.push("Back claims with figures (IRR/MOIC, $ amounts, dates).");

  return { score, level, checks, gaps };
}
