// lib/diligence-agent.ts
// Pure engine for the Due-diligence data-room agent: a multi-lens analysis of a
// deal's data room that produces a structured risk memo across LEGAL, FINANCIAL,
// COMMERCIAL, OPERATIONAL, and COMPLIANCE lenses.
//
// This module is intentionally React-free and network-free so it can be unit
// tested in isolation and imported from both a server action (to build the
// prompt/schema and provide the no-key fallback) and a client component (to
// aggregate the returned findings into a risk gauge). All AI/network concerns
// live in components/run/diligence-agent-actions.ts.

// ---------------------------------------------------------------------------
// Lenses & severities
// ---------------------------------------------------------------------------

/** The five diligence lenses, each with a display label for the UI. */
export const DILIGENCE_LENSES = [
  { key: "legal", label: "Legal" },
  { key: "financial", label: "Financial" },
  { key: "commercial", label: "Commercial" },
  { key: "operational", label: "Operational" },
  { key: "compliance", label: "Compliance" },
] as const;

/** The lens key union: 'legal' | 'financial' | 'commercial' | 'operational' | 'compliance'. */
export type DiligenceLens = (typeof DILIGENCE_LENSES)[number]["key"];

/** Ordered severity ladder, ascending. */
export type Severity = "low" | "medium" | "high" | "critical";

/** A single risk observation on one lens. */
export interface Finding {
  lens: DiligenceLens;
  title: string;
  severity: Severity;
  detail: string;
  recommendation: string;
}

const LENS_KEYS = DILIGENCE_LENSES.map((l) => l.key) as DiligenceLens[];

/** Rank used to compare severities (higher = worse). Exported for reuse in UI. */
export const SEVERITY_RANK: Record<Severity, number> = {
  low: 1,
  medium: 2,
  high: 3,
  critical: 4,
};

/**
 * Per-severity independent risk contribution used by the noisy-OR aggregation
 * in `aggregateRisk`. Read as: "the probability that a finding of this severity,
 * on its own, makes the deal materially risky."
 *
 * These are the documented severity weights:
 *   low      → 0.05   (a minor flag; barely moves the needle)
 *   medium   → 0.15   (worth diligence follow-up)
 *   high     → 0.35   (a serious issue; a single one lands the deal in "high")
 *   critical → 0.60   (deal-threatening; one is enough to reach "high",
 *                       two compound into "severe")
 */
export const SEVERITY_RISK_WEIGHT: Record<Severity, number> = {
  low: 0.05,
  medium: 0.15,
  high: 0.35,
  critical: 0.6,
};

export type RiskLevel = "low" | "elevated" | "high" | "severe";

export interface RiskAggregate {
  /** 0–100, higher = riskier. */
  score: number;
  level: RiskLevel;
  byLens: Record<DiligenceLens, { count: number; top: Severity | null }>;
}

function isSeverity(v: unknown): v is Severity {
  return v === "low" || v === "medium" || v === "high" || v === "critical";
}

function isLens(v: unknown): v is DiligenceLens {
  return LENS_KEYS.includes(v as DiligenceLens);
}

function emptyByLens(): Record<DiligenceLens, { count: number; top: Severity | null }> {
  const out = {} as Record<DiligenceLens, { count: number; top: Severity | null }>;
  for (const k of LENS_KEYS) out[k] = { count: 0, top: null };
  return out;
}

/**
 * Aggregate a set of findings into an overall risk score (0–100, higher =
 * riskier), a discrete level, and a per-lens rollup.
 *
 * Scoring — noisy-OR over independent severity weights:
 *   combined = 1 − Π(1 − weight_i)      score = round(100 × combined)
 * This means every finding can only *raise* risk, a single critical dominates,
 * and stacking many moderate findings saturates toward (but never exceeds) 100.
 *
 * Level thresholds on the score:
 *   < 25  → low       25–49 → elevated
 *   50–74 → high      ≥ 75  → severe
 */
export function aggregateRisk(findings: Finding[]): RiskAggregate {
  const byLens = emptyByLens();
  let survival = 1; // Π(1 − weight_i)

  for (const f of findings ?? []) {
    if (!f || !isLens(f.lens) || !isSeverity(f.severity)) continue;
    survival *= 1 - SEVERITY_RISK_WEIGHT[f.severity];
    const bucket = byLens[f.lens];
    bucket.count += 1;
    if (bucket.top == null || SEVERITY_RANK[f.severity] > SEVERITY_RANK[bucket.top]) {
      bucket.top = f.severity;
    }
  }

  const score = Math.round(100 * (1 - survival));
  const level: RiskLevel =
    score >= 75 ? "severe" : score >= 50 ? "high" : score >= 25 ? "elevated" : "low";

  return { score, level, byLens };
}

// ---------------------------------------------------------------------------
// Deterministic fallback — keyword/heuristic scan (no API key path)
// ---------------------------------------------------------------------------

interface FallbackRule {
  lens: DiligenceLens;
  re: RegExp;
  severity: Severity;
  title: string;
  detail: string;
  recommendation: string;
}

// Ordered signal library. Each matching rule contributes one baseline finding,
// so a data-room excerpt with signals across lenses yields a memo spanning them.
const FALLBACK_RULES: FallbackRule[] = [
  // LEGAL
  {
    lens: "legal",
    re: /litigation|law\s?suits?|injunction|breach of contract|legal dispute/i,
    severity: "high",
    title: "Active or threatened litigation",
    detail: "The data room references litigation, lawsuits, or legal disputes involving the target.",
    recommendation:
      "Obtain the full litigation schedule and outside-counsel assessment of exposure, reserves, and insurance coverage.",
  },
  {
    lens: "legal",
    re: /\bip\b|intellectual property|patent (dispute|infringement)|infringement|title defect/i,
    severity: "medium",
    title: "Intellectual-property / title question",
    detail: "Signals suggest unresolved IP ownership, infringement risk, or a title defect.",
    recommendation: "Confirm chain of title and IP assignments; obtain freedom-to-operate and lien searches.",
  },
  // FINANCIAL
  {
    lens: "financial",
    re: /going concern|covenant|\bdefault(ed)?\b|restatement|material weakness/i,
    severity: "high",
    title: "Solvency / financial-reporting risk",
    detail:
      "The materials reference going-concern language, covenant pressure, defaults, or a financial restatement.",
    recommendation:
      "Request the covenant compliance certificates, auditor management letters, and a 13-week cash flow.",
  },
  {
    lens: "financial",
    re: /declining revenue|net loss|negative (ebitda|margin|cash)|cash burn|impairment/i,
    severity: "medium",
    title: "Deteriorating financial performance",
    detail: "Signals of declining revenue, losses, cash burn, or asset impairment appear in the data room.",
    recommendation: "Bridge the trend with a quality-of-earnings review and a downside sensitivity case.",
  },
  // COMMERCIAL
  {
    lens: "commercial",
    re: /customer concentration|single customer|top customer|revenue concentration|key account/i,
    severity: "high",
    title: "Customer concentration",
    detail: "Revenue appears concentrated in one or few customers, raising commercial fragility.",
    recommendation: "Quantify revenue by customer, review contract terms/termination rights, and stress churn.",
  },
  {
    lens: "commercial",
    re: /churn|competitive pressure|market share loss|pricing pressure|demand softness/i,
    severity: "medium",
    title: "Demand / competitive pressure",
    detail: "The materials flag churn, pricing pressure, or competitive share loss.",
    recommendation: "Validate the pipeline, retention cohorts, and win/loss data before underwriting growth.",
  },
  // OPERATIONAL
  {
    lens: "operational",
    re: /key person|key man|founder dependen|single supplier|supplier concentration|sole source/i,
    severity: "medium",
    title: "Key-person / supply dependency",
    detail: "Operations appear dependent on a key individual or a concentrated supplier.",
    recommendation: "Assess succession/retention plans and qualify alternate suppliers; test business continuity.",
  },
  {
    lens: "operational",
    re: /system outage|integration risk|manual process|scalab|technical debt|legacy system/i,
    severity: "low",
    title: "Operational scalability question",
    detail: "Signals of manual processes, legacy systems, or integration risk that may limit scale.",
    recommendation: "Scope a 100-day operational plan and validate the integration/IT roadmap.",
  },
  // COMPLIANCE
  {
    lens: "compliance",
    re: /\bgdpr\b|\bccpa\b|data breach|privacy (violation|incident)|personal data/i,
    severity: "high",
    title: "Data-privacy exposure",
    detail: "References to GDPR/CCPA, privacy incidents, or sensitive personal-data handling.",
    recommendation: "Review the privacy program, breach history, DPAs, and any regulator correspondence.",
  },
  {
    lens: "compliance",
    re: /\baml\b|sanctions?|\bofac\b|bribery|\bfcpa\b|anti-money|export control/i,
    severity: "high",
    title: "Regulatory / financial-crime exposure",
    detail: "The materials reference AML, sanctions/OFAC, bribery/FCPA, or export-control concerns.",
    recommendation: "Run sanctions/PEP screening and confirm the AML and anti-bribery compliance framework.",
  },
];

/**
 * Deterministic keyword/heuristic scan of a data-room excerpt. Never throws.
 *
 * - Empty (or whitespace-only) text → a single low "insufficient data" finding.
 * - Otherwise → one baseline finding per matched signal, spanning whichever
 *   lenses have signals. When text is present but no signal matches, returns a
 *   single low finding noting that no material signals were detected.
 */
export function fallbackDiligence(text: string): Finding[] {
  const source = typeof text === "string" ? text : "";
  if (source.trim().length === 0) {
    return [
      {
        lens: "operational",
        title: "Insufficient data",
        severity: "low",
        detail: "No data-room text was provided, so no risk signals could be evaluated.",
        recommendation: "Paste or upload data-room documents to run a multi-lens diligence scan.",
      },
    ];
  }

  const findings: Finding[] = [];
  try {
    for (const rule of FALLBACK_RULES) {
      if (rule.re.test(source)) {
        findings.push({
          lens: rule.lens,
          title: rule.title,
          severity: rule.severity,
          detail: rule.detail,
          recommendation: rule.recommendation,
        });
      }
    }
  } catch {
    // Defensive: never throw from the fallback path.
  }

  if (findings.length === 0) {
    return [
      {
        lens: "operational",
        title: "No material risk signals detected",
        severity: "low",
        detail:
          "The provided excerpt did not surface recognized legal, financial, commercial, operational, or compliance signals.",
        recommendation: "Provide the full data-room index or connect an API key for a deeper AI review.",
      },
    ];
  }

  return findings;
}

// ---------------------------------------------------------------------------
// Structured-output schema for the AI path
// ---------------------------------------------------------------------------

/**
 * JSON schema for the findings array the model returns. Root is an object with a
 * `findings` array whose items match `Finding`, so it plugs directly into
 * `effortConfig(MODEL, "medium", DILIGENCE_SCHEMA)`.
 */
export const DILIGENCE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    findings: {
      type: "array",
      description:
        "Risk findings across the five diligence lenses. Cite only what the excerpt supports; never fabricate.",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          lens: { type: "string", enum: LENS_KEYS },
          title: { type: "string", description: "Short headline for the risk." },
          severity: { type: "string", enum: ["low", "medium", "high", "critical"] },
          detail: { type: "string", description: "What the data room shows and why it matters." },
          recommendation: { type: "string", description: "The concrete diligence follow-up." },
        },
        required: ["lens", "title", "severity", "detail", "recommendation"],
      },
    },
  },
  required: ["findings"],
} as const;

/** Runtime guard used by the server action to validate model output. */
export function isValidFinding(v: unknown): v is Finding {
  if (!v || typeof v !== "object") return false;
  const f = v as Record<string, unknown>;
  return (
    isLens(f.lens) &&
    isSeverity(f.severity) &&
    typeof f.title === "string" &&
    typeof f.detail === "string" &&
    typeof f.recommendation === "string"
  );
}
