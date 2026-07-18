// lib/skills/catalog/lp-update.ts
// Native skill: assemble a quarterly LP update LETTER from already-structured
// fund data. Pure, deterministic core — the tested execution path.
//
// This skill PREPARES a DRAFT letter for review; it NEVER distributes it. External
// distribution to LPs is a Tier-2, human-gated action (prohibited here). It never
// fabricates a performance metric — a missing metric becomes an OPEN ITEM
// ("Pending — confirm from fund admin"), never an invented number.

import type { JsonSchema, SkillCore, SkillCoreResult, SkillDefinition, SkillManifest, SkillSource } from "@/lib/skills/types";

// ---------------------------------------------------------------------------
// I/O types
// ---------------------------------------------------------------------------

export interface LpUpdateInput {
  fundName: string;
  period?: string;
  nav?: number;
  dpi?: number;
  tvpi?: number;
  netIrrPct?: number;
  highlights?: string[];
  portfolioNotes?: string;
  capitalActivity?: string;
}

export type LpUpdateSectionStatus = "complete" | "open";

export interface LpUpdateSection {
  heading: string;
  body: string;
  status: LpUpdateSectionStatus;
}

export interface LpUpdateOutput {
  sections: LpUpdateSection[];
  /** Names of the performance metrics actually provided (NAV/DPI/TVPI/Net IRR). */
  statedMetrics: string[];
  openItems: string[];
  missingFields: string[];
  /** 0–1 fraction of sections that are complete. */
  completeness: number;
  recommendedAction: string;
}

// ---------------------------------------------------------------------------
// Deterministic core
// ---------------------------------------------------------------------------

/** The four performance metrics. Each is stated as a FACT only when provided —
 *  a missing metric is flagged, NEVER fabricated. */
const METRIC_DEFS: Array<{ key: "nav" | "dpi" | "tvpi" | "netIrrPct"; name: string; format: (v: number) => string }> = [
  { key: "nav", name: "NAV", format: (v) => `NAV: ${v}` },
  { key: "dpi", name: "DPI", format: (v) => `DPI: ${v}x` },
  { key: "tvpi", name: "TVPI", format: (v) => `TVPI: ${v}x` },
  { key: "netIrrPct", name: "Net IRR", format: (v) => `Net IRR: ${v}%` },
];

/** The standard note attached wherever performance metrics are absent. */
const PERFORMANCE_PENDING = "Pending — confirm from fund admin";

const clean = (s: string | undefined): string => (s ?? "").trim();
const nonEmpty = (xs: string[] | undefined): string[] => (xs ?? []).map((x) => clean(x)).filter((x) => x !== "");

const run: SkillCore<LpUpdateInput, LpUpdateOutput> = (input): SkillCoreResult<LpUpdateOutput> => {
  const { fundName, period, highlights, portfolioNotes, capitalActivity } = input;
  const sources: SkillSource[] = [];
  const openItems: string[] = [];
  const sections: LpUpdateSection[] = [];

  const fund = clean(fundName);
  const per = clean(period);
  const notes = clean(portfolioNotes);
  const highlightList = nonEmpty(highlights);
  const capital = clean(capitalActivity);

  const add = (heading: string, body: string, status: LpUpdateSectionStatus): void => {
    sections.push({ heading, body, status });
  };

  // Provided data is recorded as FACTS — never fabricated.
  if (fund) sources.push({ label: "Fund name", kind: "fact", value: fund });
  if (per) sources.push({ label: "Period", kind: "fact", value: per });

  // Which metrics were actually provided.
  const providedMetrics = METRIC_DEFS.filter((m) => input[m.key] != null);
  const statedMetrics = providedMetrics.map((m) => m.name);
  for (const m of providedMetrics) {
    sources.push({ label: m.name, kind: "fact", value: input[m.key] as number });
  }

  // 1. Summary — fund + period. Complete when the fund name is present (required).
  if (fund) {
    const summaryBody =
      `${fund}${per ? ` — ${per}` : ""} quarterly LP update (DRAFT for review). ` +
      `This letter is prepared for internal review; it is not distributed to LPs.`;
    add("Summary", summaryBody, "complete");
  } else {
    add("Summary", "Pending — provide the fund name.", "open");
    openItems.push("Summary");
  }

  // 2. Performance — list ONLY the provided metrics as stated figures. If NONE were
  //    provided, this is an OPEN item; nothing is ever invented.
  if (providedMetrics.length > 0) {
    const lines = providedMetrics.map((m) => m.format(input[m.key] as number));
    add("Performance", `${lines.join(" · ")}. Figures as supplied; confirm against the fund admin statement.`, "complete");
  } else {
    add("Performance", `${PERFORMANCE_PENDING}. No performance metrics were provided; none are fabricated.`, "open");
    openItems.push("Performance");
    openItems.push(`Performance metrics ${PERFORMANCE_PENDING.toLowerCase()}.`);
  }

  // 3. Portfolio Highlights — from highlights[] / portfolioNotes, else open.
  if (highlightList.length > 0 || notes) {
    const parts: string[] = [];
    if (highlightList.length > 0) parts.push(highlightList.map((h, i) => `${i + 1}. ${h}`).join("\n"));
    if (notes) parts.push(notes);
    add("Portfolio Highlights", parts.join("\n\n"), "complete");
    if (highlightList.length > 0) sources.push({ label: "Portfolio highlights", kind: "fact", value: highlightList.join("; ") });
    if (notes) sources.push({ label: "Portfolio notes", kind: "fact", value: notes });
  } else {
    add("Portfolio Highlights", "Pending — provide portfolio highlights or notes.", "open");
    openItems.push("Portfolio Highlights");
  }

  // 4. Capital Activity — from capitalActivity, else open.
  if (capital) {
    add("Capital Activity", capital, "complete");
    sources.push({ label: "Capital activity", kind: "fact", value: capital });
  } else {
    add("Capital Activity", "Pending — provide capital activity (calls / distributions) for the period.", "open");
    openItems.push("Capital Activity");
  }

  // 5. Outlook — a NEUTRAL, GENERATED placeholder. No forward-looking performance
  //    commitments are asserted.
  const outlookBody =
    "The general partner continues to execute the fund's strategy and will provide a further update in the next quarterly report. " +
    "This outlook is a neutral placeholder and makes no forward-looking performance commitments.";
  add("Outlook", outlookBody, "complete");
  sources.push({ label: "Outlook", kind: "generated", value: outlookBody });

  // Material inputs that were not provided (labelled, never invented).
  const missingFields: string[] = [];
  if (!per) missingFields.push("Period");
  for (const m of METRIC_DEFS) if (input[m.key] == null) missingFields.push(m.name);
  if (highlightList.length === 0 && !notes) missingFields.push("Portfolio highlights");
  if (!capital) missingFields.push("Capital activity");

  const missingSections = sections.filter((s) => s.status === "open").map((s) => s.heading);
  const completeCount = sections.length - missingSections.length;
  const completeness = Math.round((completeCount / sections.length) * 100) / 100;

  const recommendedAction =
    openItems.length === 0
      ? "Draft complete — route to the operator for review. External distribution to LPs requires human sign-off (Tier 2) and is not performed by this skill."
      : "Draft prepared with open items — confirm the pending figures (performance metrics from the fund admin) before review. External distribution to LPs requires human sign-off (Tier 2) and is not performed by this skill.";

  const structured: LpUpdateOutput = {
    sections,
    statedMetrics,
    openItems,
    missingFields,
    completeness,
    recommendedAction,
  };

  const confidence = Math.max(0.2, Math.min(0.9, 0.3 + completeness * 0.6));

  const narrative =
    `Draft quarterly LP update for ${fund || "the fund"}${per ? ` (${per})` : ""} assembled: ` +
    `${completeCount}/${sections.length} sections complete` +
    `${missingSections.length ? `, ${missingSections.length} open (${missingSections.join(", ")})` : ""}. ` +
    `${statedMetrics.length ? `Stated metrics: ${statedMetrics.join(", ")}. ` : `No performance metrics provided — ${PERFORMANCE_PENDING.toLowerCase()}. `}` +
    `This prepares a DRAFT for review; it does not distribute the letter to LPs.`;

  return { structured, narrative, sources, confidence, completeness, missingData: missingFields };
};

// ---------------------------------------------------------------------------
// Schemas + manifest
// ---------------------------------------------------------------------------

const inputSchema: JsonSchema = {
  type: "object",
  required: ["fundName"],
  properties: {
    fundName: { type: "string", minLength: 1 },
    period: { type: "string" },
    nav: { type: "number" },
    dpi: { type: "number", minimum: 0 },
    tvpi: { type: "number", minimum: 0 },
    netIrrPct: { type: "number" },
    highlights: { type: "array", items: { type: "string" } },
    portfolioNotes: { type: "string" },
    capitalActivity: { type: "string" },
  },
};

const outputSchema: JsonSchema = {
  type: "object",
  required: ["sections", "statedMetrics", "openItems", "missingFields", "completeness", "recommendedAction"],
  properties: {
    sections: {
      type: "array",
      items: {
        type: "object",
        required: ["heading", "body", "status"],
        properties: {
          heading: { type: "string" },
          body: { type: "string" },
          status: { type: "string", enum: ["complete", "open"] },
        },
      },
    },
    statedMetrics: { type: "array", items: { type: "string" } },
    openItems: { type: "array", items: { type: "string" } },
    missingFields: { type: "array", items: { type: "string" } },
    completeness: { type: "number", minimum: 0, maximum: 1 },
    recommendedAction: { type: "string" },
  },
};

export const lpUpdateManifest: SkillManifest = {
  id: "lp-update",
  name: "Quarterly LP Update",
  version: "1.0.0",
  owner: "fundexecs",
  hub: "execute",
  applicableExecutives: ["investor_relations"],
  supportedEntityTypes: ["fund", "lp_update"],
  requiredInputs: ["fundName"],
  optionalInputs: ["period", "nav", "dpi", "tvpi", "netIrrPct", "highlights", "portfolioNotes", "capitalActivity"],
  outputs: ["sections", "statedMetrics", "openItems", "missingFields", "completeness", "recommendedAction"],
  artifactTypes: ["lp_update"],
  dataPermissions: ["fund:read", "lp_update:read"],
  tools: [],
  approvalTier: 1,
  riskClassification: "low",
  executionTimeoutMs: 15_000,
  retryPolicy: { maxAttempts: 1, backoffMs: 0 },
  validationRules: [
    "input matches input.schema.json",
    "output matches output.schema.json",
    "no fabricated performance metric — a missing metric becomes an open item (Pending — confirm from fund admin)",
  ],
  evaluationCriteria: [
    "all five sections assembled in order",
    "only provided metrics are stated; missing metrics flagged, never invented",
    "prepares a DRAFT for review, never distributes it externally",
    "facts and generated content separated in sources",
  ],
  providerCapabilities: ["structured_extraction"],
  allowedDownstreamSkills: [],
  prohibitedActions: ["distribute_report", "send_reply", "sign_document"],
  inputSchema,
  outputSchema,
};

export const lpUpdate: SkillDefinition<LpUpdateInput, LpUpdateOutput> = {
  manifest: lpUpdateManifest,
  run,
};
