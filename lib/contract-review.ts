// lib/contract-review.ts
// M&A contract-review — CUAD-style clause & risk extraction.
//
// PURE module (no React, no network): a documented CUAD-inspired clause
// taxonomy, a deterministic assessment (score/level/highs/missing), a
// keyword/regex fallback that classifies a contract without any model, and the
// JSON schema the AI path validates against. The server action in
// components/run/contract-review-actions.ts wraps this with Claude and always
// degrades to `fallbackReview` when no API key is present.
//
// CUAD (the Contract Understanding Atticus Dataset) catalogues ~40+ clause
// categories that commercial counsel look for. We track a focused subset most
// material to M&A / private-market transactions, each annotated with whether
// its *presence* or its *absence* is the risk signal.

export type RiskLevel = "none" | "low" | "medium" | "high";
export type OverallLevel = "low" | "moderate" | "elevated" | "high";

export interface ClauseType {
  /** Stable machine key (snake_case). */
  key: string;
  /** Human label for the UI. */
  label: string;
  /**
   * Baseline risk when the clause IS present in the contract. Some clauses are
   * inherently adverse to a buyer/acquirer when they exist (e.g. a non-compete
   * or exclusivity binding the acquirer, an MFN ratchet).
   */
  riskIfPresent?: RiskLevel;
  /**
   * Baseline risk when the clause is ABSENT. Protective clauses (indemnity,
   * limitation of liability, governing law, audit rights) are risks by their
   * omission — you want them there.
   */
  riskIfAbsent?: RiskLevel;
}

/**
 * CUAD-style taxonomy — the ~12 clauses this reviewer extracts. `riskIfPresent`
 * / `riskIfAbsent` encode the default heuristic direction; the AI or fallback
 * scan refines the actual per-contract risk from the language found.
 */
export const CLAUSE_TYPES: ClauseType[] = [
  { key: "governing_law", label: "Governing Law", riskIfAbsent: "medium" },
  { key: "change_of_control", label: "Change of Control", riskIfPresent: "high" },
  { key: "exclusivity", label: "Exclusivity / No-Shop", riskIfPresent: "medium" },
  { key: "indemnification", label: "Indemnification", riskIfAbsent: "high" },
  { key: "limitation_of_liability", label: "Limitation of Liability", riskIfAbsent: "high" },
  { key: "termination", label: "Termination", riskIfAbsent: "medium" },
  { key: "assignment", label: "Assignment", riskIfPresent: "low" },
  { key: "non_compete", label: "Non-Compete", riskIfPresent: "high" },
  { key: "confidentiality", label: "Confidentiality", riskIfAbsent: "medium" },
  { key: "most_favored_nation", label: "Most Favored Nation", riskIfPresent: "high" },
  { key: "anti_assignment", label: "Anti-Assignment", riskIfPresent: "high" },
  { key: "audit_rights", label: "Audit Rights", riskIfAbsent: "low" },
];

/** Fast lookup from key → clause metadata. */
export const CLAUSE_TYPE_BY_KEY: Record<string, ClauseType> = Object.fromEntries(
  CLAUSE_TYPES.map((c) => [c.key, c]),
);

/** The set of valid clause keys — used to validate AI output. */
export const CLAUSE_KEYS: string[] = CLAUSE_TYPES.map((c) => c.key);

export interface Finding {
  /** One of CLAUSE_KEYS. */
  clause_type: string;
  present: boolean;
  risk: RiskLevel;
  /** A short quote from the contract, or null when absent / not quoted. */
  excerpt: string | null;
  /** A suggested redline / drafting fix, or null. */
  redline: string | null;
}

// ---------------------------------------------------------------------------
// Assessment — a pure roll-up of findings into an overall risk picture.
// ---------------------------------------------------------------------------

// Weights (points added to the raw risk tally) per finding risk level. High-risk
// clauses dominate; a "none"/"low" contributes little. Missing protective
// clauses are surfaced separately and also feed the tally via their finding's
// risk (the fallback/AI assigns a risk to an absent protective clause).
const RISK_WEIGHT: Record<RiskLevel, number> = {
  none: 0,
  low: 4,
  medium: 10,
  high: 22,
};

/**
 * Roll findings up into an overall risk score (0..100, higher = riskier), a
 * banded level, the list of high-risk findings, and the labels of missing
 * protective clauses (present === false where the clause carries `riskIfAbsent`).
 *
 * Scoring: sum each finding's RISK_WEIGHT, normalize against the theoretical
 * max (every clause at "high"), and scale to 0..100. This keeps the score
 * stable regardless of how many clause types exist. Levels band the score:
 *   < 15 low · < 35 moderate · < 60 elevated · else high.
 */
export function assessContract(findings: Finding[]): {
  score: number;
  level: OverallLevel;
  highs: Finding[];
  missing: string[];
} {
  const highs = findings.filter((f) => f.risk === "high");

  // Missing protective clauses: absent clauses that carry a `riskIfAbsent`
  // signal (you *want* these present).
  const missing = findings
    .filter((f) => !f.present && CLAUSE_TYPE_BY_KEY[f.clause_type]?.riskIfAbsent)
    .map((f) => CLAUSE_TYPE_BY_KEY[f.clause_type]?.label ?? f.clause_type);

  const tally = findings.reduce((sum, f) => sum + (RISK_WEIGHT[f.risk] ?? 0), 0);
  // Normalize against "every finding high" so the score is a 0..100 percentage
  // of worst-case risk. Guard the empty-findings case.
  const max = findings.length * RISK_WEIGHT.high;
  const score = max > 0 ? Math.round((tally / max) * 100) : 0;

  const level: OverallLevel =
    score < 15 ? "low" : score < 35 ? "moderate" : score < 60 ? "elevated" : "high";

  return { score, level, highs, missing };
}

// ---------------------------------------------------------------------------
// Deterministic fallback — keyword/regex scan (no model, never throws).
// ---------------------------------------------------------------------------

// One detector per clause key: a regex that signals the clause's presence.
const CLAUSE_DETECTORS: Record<string, RegExp> = {
  governing_law: /governing law|governed by the laws|shall be governed|jurisdiction of/i,
  change_of_control: /change of control|change in control/i,
  exclusivity: /exclusiv|no[- ]shop|no shop/i,
  indemnification: /indemnif/i,
  limitation_of_liability: /limitation of liability|limit(?:ation)? of liability|in no event shall|liability shall not exceed|aggregate liability/i,
  termination: /terminat/i,
  assignment: /\bassign(?:ment|ed|s)?\b/i,
  non_compete: /non-?compete|not to compete|covenant not to compete|restrictive covenant/i,
  confidentiality: /confidential|non-?disclosure|\bNDA\b/i,
  most_favored_nation: /most favou?red nation|\bMFN\b/i,
  anti_assignment: /shall not (?:be )?assign|may not (?:be )?assign|no assignment|anti-?assignment|without (?:the )?(?:prior )?(?:written )?consent[^.]{0,40}assign/i,
  audit_rights: /audit right|right to audit|shall have the right to (?:inspect|audit)|books and records/i,
};

/**
 * Build the heuristic risk for a clause given whether it was detected. When a
 * clause is present we lean on `riskIfPresent`; when absent, on `riskIfAbsent`.
 * A present clause with no adverse-presence signal is "low" (it's simply there);
 * an absent clause with no absence signal is "none".
 */
function heuristicRisk(clause: ClauseType, present: boolean): RiskLevel {
  if (present) return clause.riskIfPresent ?? "low";
  return clause.riskIfAbsent ?? "none";
}

// A short, generic redline suggestion when a protective clause is missing.
function missingRedline(clause: ClauseType): string {
  return `No ${clause.label} clause detected. Add an explicit ${clause.label} provision to protect the acquirer.`;
}

// A short caution when an adverse clause is present.
function presentRedline(clause: ClauseType): string {
  return `${clause.label} clause detected — review its scope and negotiate carve-outs or thresholds.`;
}

/**
 * Deterministic review: scan the text for every clause type and emit a Finding
 * for each (present or missing). Never throws. Empty/blank text yields an
 * all-missing set with a note redline on protective clauses.
 */
export function fallbackReview(text: string): Finding[] {
  const source = typeof text === "string" ? text : "";
  const blank = source.trim().length === 0;

  return CLAUSE_TYPES.map((clause) => {
    const detector = CLAUSE_DETECTORS[clause.key];
    const match = blank || !detector ? null : detector.exec(source);
    const present = Boolean(match);
    const risk = heuristicRisk(clause, present);

    // Quote a short window around the match as the excerpt.
    let excerpt: string | null = null;
    if (match) {
      const start = Math.max(0, match.index - 40);
      const end = Math.min(source.length, match.index + match[0].length + 80);
      excerpt = source.slice(start, end).replace(/\s+/g, " ").trim();
    }

    const redline = present
      ? clause.riskIfPresent
        ? presentRedline(clause)
        : null
      : clause.riskIfAbsent
        ? missingRedline(clause)
        : null;

    return { clause_type: clause.key, present, risk, excerpt, redline };
  });
}

// ---------------------------------------------------------------------------
// JSON schema for the AI path — the findings array shape Claude returns.
// ---------------------------------------------------------------------------
export const CONTRACT_REVIEW_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    findings: {
      type: "array",
      description:
        "One entry per clause type reviewed. Include every clause type whether present or absent.",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          clause_type: {
            type: "string",
            enum: CLAUSE_KEYS,
            description: "Which CUAD-style clause this finding is about.",
          },
          present: {
            type: "boolean",
            description: "Whether the clause appears in the contract.",
          },
          risk: {
            type: "string",
            enum: ["none", "low", "medium", "high"],
            description: "Risk this clause (or its absence) poses to the acquirer.",
          },
          excerpt: {
            type: ["string", "null"],
            description: "A short verbatim quote from the contract, or null if absent.",
          },
          redline: {
            type: ["string", "null"],
            description: "A suggested drafting change / redline, or null.",
          },
        },
        required: ["clause_type", "present", "risk", "excerpt", "redline"],
      },
    },
  },
  required: ["findings"],
} as const;
