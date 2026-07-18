// lib/skills/catalog/kpi-ingest.ts
// Native skill: ingest and normalize a portfolio company's KPIs into a uniform,
// provenanced scorecard. Pure, deterministic core — it NEVER invents a metric:
// a provided value is a `fact`, a computed variance is a `calculation`, and a
// missing value is FLAGGED (surfaced in missingKpis / missingFields), never
// fabricated. Status is derived purely from the value/target pair and the
// metric's polarity. LLM commentary is an optional follow-on that wraps this
// core; the normalized figures and the counts come from here.

import type { JsonSchema, SkillCore, SkillCoreResult, SkillDefinition, SkillManifest, SkillSource } from "@/lib/skills/types";

// ---------------------------------------------------------------------------
// I/O types
// ---------------------------------------------------------------------------

export type KpiDirection = "higher_better" | "lower_better";

export interface KpiInput {
  name: string;
  value?: number;
  unit?: string;
  period?: string;
  target?: number;
  direction?: KpiDirection;
}

export interface KpiIngestInput {
  companyName: string;
  kpis?: KpiInput[];
}

export type KpiStatus = "on_track" | "off_track" | "no_target" | "unknown";

export interface NormalizedKpi {
  name: string;
  value: number | null;
  unit: string | null;
  period: string | null;
  target: number | null;
  variance: number | null;
  status: KpiStatus;
}

export interface KpiIngestOutput {
  normalized: NormalizedKpi[];
  kpiCount: number;
  onTrackCount: number;
  offTrackCount: number;
  missingKpis: string[];
  missingFields: string[];
  recommendedAction: string;
}

// ---------------------------------------------------------------------------
// Deterministic core
// ---------------------------------------------------------------------------

const round2 = (n: number) => Math.round(n * 100) / 100;

const run: SkillCore<KpiIngestInput, KpiIngestOutput> = (input): SkillCoreResult<KpiIngestOutput> => {
  const companyName = input.companyName;
  const kpis = input.kpis ?? [];
  const sources: SkillSource[] = [];

  // Required inputs — flagged, never assumed.
  const missingFields: string[] = [];
  if (!companyName) missingFields.push("companyName");
  if (kpis.length === 0) missingFields.push("kpis");

  const missingKpis: string[] = [];
  let onTrackCount = 0;
  let offTrackCount = 0;

  const normalized: NormalizedKpi[] = kpis.map((kpi) => {
    const value = kpi.value ?? null;
    const target = kpi.target ?? null;
    const direction: KpiDirection = kpi.direction ?? "higher_better";
    const variance = value != null && target != null ? round2(value - target) : null;

    let status: KpiStatus;
    if (value == null) {
      status = "unknown";
      missingKpis.push(kpi.name);
    } else if (target == null) {
      status = "no_target";
    } else {
      const onTrack = direction === "lower_better" ? value <= target : value >= target;
      status = onTrack ? "on_track" : "off_track";
      if (onTrack) onTrackCount += 1;
      else offTrackCount += 1;
    }

    // Provided values are FACTS; computed variances are CALCULATIONS.
    if (value != null) {
      sources.push({ label: kpi.name, kind: "fact", value });
    }
    if (variance != null) {
      sources.push({ label: `${kpi.name} variance`, kind: "calculation", value: variance, ref: "value − target" });
    }

    return {
      name: kpi.name,
      value,
      unit: kpi.unit ?? null,
      period: kpi.period ?? null,
      target,
      variance,
      status,
    };
  });

  const kpiCount = normalized.length;

  const recommendedAction =
    missingFields.length > 0
      ? "Provide companyName and at least one KPI, then re-run ingestion."
      : missingKpis.length > 0
        ? "Backfill the missing KPI values flagged above, then re-run to complete the scorecard."
        : offTrackCount > 0
          ? "Route the off-track KPIs to portfolio review for corrective action."
          : "All KPIs on track against target — proceed to portfolio review.";

  const structured: KpiIngestOutput = {
    normalized,
    kpiCount,
    onTrackCount,
    offTrackCount,
    missingKpis,
    missingFields,
    recommendedAction,
  };

  // Completeness reflects how many provided KPIs carried a value.
  const withValue = normalized.filter((k) => k.value != null).length;
  const completeness = kpiCount === 0 ? 0 : round2(withValue / kpiCount);
  const confidence = Math.max(0.2, Math.min(0.95, 0.4 + completeness * 0.5));

  const missingData = [...missingFields, ...missingKpis];

  const narrative =
    `KPI ingestion for ${companyName || "(company not provided)"}: ${kpiCount} KPI(s) normalized — ` +
    `${onTrackCount} on track, ${offTrackCount} off track. ` +
    `${missingKpis.length ? `Missing values: ${missingKpis.join(", ")}. ` : ""}` +
    `${missingFields.length ? `Missing required input(s): ${missingFields.join(", ")}. ` : ""}` +
    "Provided values are facts; variances are calculations; nothing is invented. " +
    `Next: ${recommendedAction}`;

  return { structured, narrative, sources, confidence, completeness, missingData };
};

// ---------------------------------------------------------------------------
// Schemas + manifest
// ---------------------------------------------------------------------------

const inputSchema: JsonSchema = {
  type: "object",
  required: ["companyName"],
  properties: {
    companyName: { type: "string", minLength: 1 },
    kpis: {
      type: "array",
      items: {
        type: "object",
        required: ["name"],
        properties: {
          name: { type: "string", minLength: 1 },
          value: { type: "number" },
          unit: { type: "string" },
          period: { type: "string" },
          target: { type: "number" },
          direction: { type: "string", enum: ["higher_better", "lower_better"] },
        },
      },
    },
  },
};

const outputSchema: JsonSchema = {
  type: "object",
  required: ["normalized", "kpiCount", "onTrackCount", "offTrackCount", "recommendedAction"],
  properties: {
    normalized: {
      type: "array",
      items: {
        type: "object",
        required: ["name", "status"],
        properties: {
          name: { type: "string" },
          value: { type: "number" },
          unit: { type: "string" },
          period: { type: "string" },
          target: { type: "number" },
          variance: { type: "number" },
          status: { type: "string", enum: ["on_track", "off_track", "no_target", "unknown"] },
        },
      },
    },
    kpiCount: { type: "number", minimum: 0 },
    onTrackCount: { type: "number", minimum: 0 },
    offTrackCount: { type: "number", minimum: 0 },
    missingKpis: { type: "array", items: { type: "string" } },
    missingFields: { type: "array", items: { type: "string" } },
    recommendedAction: { type: "string" },
  },
};

export const kpiIngestManifest: SkillManifest = {
  id: "kpi-ingest",
  name: "KPI Ingestion & Normalization",
  version: "1.0.0",
  owner: "fundexecs",
  hub: "execute",
  applicableExecutives: ["portfolio_ops"],
  supportedEntityTypes: ["company", "portfolio_company", "kpi"],
  requiredInputs: ["companyName", "kpis"],
  optionalInputs: ["kpis[].value", "kpis[].unit", "kpis[].period", "kpis[].target", "kpis[].direction"],
  outputs: ["normalized", "kpiCount", "onTrackCount", "offTrackCount", "missingKpis", "missingFields", "recommendedAction"],
  artifactTypes: ["analysis"],
  dataPermissions: ["company:read", "kpi:read"],
  tools: [],
  approvalTier: 1,
  riskClassification: "low",
  executionTimeoutMs: 15_000,
  retryPolicy: { maxAttempts: 1, backoffMs: 0 },
  validationRules: ["input matches input.schema.json", "output matches output.schema.json", "no fabricated KPI values"],
  evaluationCriteria: ["status derived correctly from value/target and direction", "missing values flagged not invented", "variances labelled as calculations", "counts consistent with statuses"],
  providerCapabilities: ["structured_extraction"],
  allowedDownstreamSkills: ["portfolio-review"],
  prohibitedActions: ["distribute_report", "move_capital"],
  inputSchema,
  outputSchema,
};

export const kpiIngest: SkillDefinition<KpiIngestInput, KpiIngestOutput> = {
  manifest: kpiIngestManifest,
  run,
};
