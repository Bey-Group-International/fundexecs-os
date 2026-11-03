// lib/skills/catalog/kpi-variance.ts
// KPI Variance Tracking (PE department · Portfolio 02). Variance of each KPI to
// budget and prior year, flagged on the firm's materiality, with direction-aware
// favourable / adverse reading, a computed trend test, and driver decomposition
// that must sum to the variance. A reviewer's "timing" call with no evidence is
// flagged as management's word only, and contradicted when the data shows a trend.
// Pure core.

import type { JsonSchema, SkillCore, SkillCoreResult, SkillDefinition, SkillManifest, SkillSource } from "@/lib/skills/types";
import { DEFAULT_KPI_POLICY, type KpiPolicy } from "@/lib/pe/kpi-policy";

export type Classification = "timing" | "one-off" | "trend";

export interface KpiIn {
  name: string;
  unit?: string;
  /** Default true. Set false for cost-like KPIs where lower is better. */
  higherIsBetter?: boolean;
  actual: number;
  budget: number;
  priorYear?: number;
  /** Recent periods' actuals, oldest first, ending with the current period. */
  series?: number[];
  drivers?: Array<{ name: string; amount: number }>;
  commentary?: string;
  /** Reviewer's call. */
  classification?: Classification;
  /** Evidence for that call (document, data). */
  evidence?: string;
}

export interface KpiVarianceInput {
  company: string;
  period: string;
  kpis: KpiIn[];
  kpiPolicy?: KpiPolicy;
  gateOwner?: string;
}

export interface KpiRow {
  name: string;
  actual: number;
  budget: number;
  varianceAbs: number;
  variancePct: number | null;
  vsPriorYearPct: number | null;
  direction: "favourable" | "adverse" | "on-budget";
  material: boolean;
  computedTrend: boolean | null;
  drivers: { sum: number; unexplained: number; ties: boolean } | null;
  classification: Classification | null;
  challenges: string[];
}

export interface KpiVarianceOutput {
  rows: KpiRow[];
  materialCount: number;
  policy: KpiPolicy;
  policyIsDefault: boolean;
  limitation: string;
  gate: string;
}

const r2 = (n: number) => Math.round(n * 100) / 100;

const run: SkillCore<KpiVarianceInput, KpiVarianceOutput> = (input): SkillCoreResult<KpiVarianceOutput> => {
  const sources: SkillSource[] = [];
  const missingData: string[] = [];
  const policy = input.kpiPolicy ?? DEFAULT_KPI_POLICY;
  const policyIsDefault = !input.kpiPolicy;
  if (policyIsDefault) sources.push({ label: "Materiality", kind: "assumption", value: `${policy.materialityPct}% of budget (standing default; no absolute floor or trend test set)`, ref: "run on default settings — set root-kpi" });

  const rows: KpiRow[] = input.kpis.map((k) => {
    const higher = k.higherIsBetter !== false;
    const varianceAbs = r2(k.actual - k.budget);
    const variancePct = k.budget !== 0 ? r2((varianceAbs / Math.abs(k.budget)) * 100) : null;
    const vsPriorYearPct = typeof k.priorYear === "number" && k.priorYear !== 0 ? r2(((k.actual - k.priorYear) / Math.abs(k.priorYear)) * 100) : null;
    const favourable = higher ? varianceAbs > 0 : varianceAbs < 0;
    const direction: KpiRow["direction"] = varianceAbs === 0 ? "on-budget" : favourable ? "favourable" : "adverse";

    const overPct = variancePct !== null && Math.abs(variancePct) >= policy.materialityPct;
    const overAbs = policy.materialityAbs === undefined || Math.abs(varianceAbs) >= policy.materialityAbs;
    if (variancePct === null) missingData.push(`${k.name}: budget is zero — percentage variance not computable`);
    const material = overPct && overAbs;

    // Trend: N consecutive adverse movements ending now (only when the firm sets a trend test and the data exists).
    let computedTrend: boolean | null = null;
    if (policy.trendPeriods && k.series && k.series.length > policy.trendPeriods) {
      const s = k.series;
      let run = 0;
      for (let i = s.length - 1; i > 0; i--) {
        const moved = s[i] - s[i - 1];
        const adverse = higher ? moved < 0 : moved > 0;
        if (adverse) run++;
        else break;
      }
      computedTrend = run >= policy.trendPeriods;
    } else if (policy.trendPeriods && material) {
      missingData.push(`${k.name}: trend test needs a series of more than ${policy.trendPeriods} periods`);
    }

    let drivers: KpiRow["drivers"] = null;
    if (k.drivers?.length) {
      const sum = r2(k.drivers.reduce((s, d) => s + d.amount, 0));
      const unexplained = r2(varianceAbs - sum);
      drivers = { sum, unexplained, ties: Math.abs(unexplained) < 0.005 };
    }

    const challenges: string[] = [];
    if (material) {
      if (!k.drivers?.length) challenges.push("Material variance with no driver decomposition.");
      else if (drivers && !drivers.ties) challenges.push(`Drivers do not sum to the variance (unexplained ${drivers.unexplained}).`);
      if (k.classification && !k.evidence?.trim()) challenges.push(`Classified "${k.classification}" on management's word only — no evidence cited.`);
      if (!k.classification) challenges.push("Not yet classified as timing, one-off or trend.");
      if (k.classification === "timing" && computedTrend) challenges.push("Called timing, but the series shows an adverse trend.");
      if (k.classification === "one-off" && computedTrend) challenges.push("Called one-off, but the series shows an adverse trend.");
      if (k.commentary && !k.evidence?.trim()) challenges.push("Commentary explains the variance in management's interest — test it against the data.");
    }

    sources.push({ label: `${k.name} variance to budget`, kind: "calculation", value: variancePct === null ? varianceAbs : `${variancePct}%`, ref: "actual − budget" });
    return { name: k.name, actual: k.actual, budget: k.budget, varianceAbs, variancePct, vsPriorYearPct, direction, material, computedTrend, drivers, classification: k.classification ?? null, challenges };
  });

  // Material adverse first, then material favourable, then the rest by size.
  rows.sort((a, b) => Number(b.material) - Number(a.material) || Number(b.direction === "adverse") - Number(a.direction === "adverse") || Math.abs(b.variancePct ?? 0) - Math.abs(a.variancePct ?? 0));

  const materialCount = rows.filter((r) => r.material).length;
  const gateOwner = input.gateOwner?.trim() || "The deal lead";
  const gate = `${gateOwner} reviews trend classifications.`;
  const limitation = "Management commentary explains variances in management's interest. Test the explanation against the data; this skill reads the numbers it is given.";
  const narrative =
    `KPI variance, ${input.company} ${input.period}: ${materialCount} of ${rows.length} KPI(s) material (≥${policy.materialityPct}% of budget${policy.materialityAbs !== undefined ? ` and ≥${policy.materialityAbs}` : ""}). ` +
    `${rows.filter((r) => r.material && r.direction === "adverse").map((r) => r.name).join(", ") || "No material adverse variance"}. ${gate}`;

  const unclassified = rows.filter((r) => r.material && !r.classification).length;
  const completeness = materialCount === 0 ? 1 : Math.round(((materialCount - unclassified) / materialCount) * 100) / 100;
  return { structured: { rows, materialCount, policy, policyIsDefault, limitation, gate }, narrative, sources, confidence: Math.max(0.3, Math.min(0.9, 0.4 + completeness * 0.4)), completeness, missingData };
};

const inputSchema: JsonSchema = {
  type: "object",
  required: ["company", "period", "kpis"],
  properties: {
    company: { type: "string", minLength: 1 },
    period: { type: "string", minLength: 1 },
    kpis: {
      type: "array",
      items: {
        type: "object",
        required: ["name", "actual", "budget"],
        properties: {
          name: { type: "string", minLength: 1 },
          unit: { type: "string" },
          higherIsBetter: { type: "boolean" },
          actual: { type: "number" },
          budget: { type: "number" },
          priorYear: { type: "number" },
          series: { type: "array", items: { type: "number" } },
          drivers: { type: "array", items: { type: "object", required: ["name", "amount"], properties: { name: { type: "string" }, amount: { type: "number" } } } },
          commentary: { type: "string" },
          classification: { type: "string", enum: ["timing", "one-off", "trend"] },
          evidence: { type: "string" },
        },
      },
    },
    kpiPolicy: { type: "object", required: ["materialityPct"], properties: { materialityPct: { type: "number", minimum: 0 }, materialityAbs: { type: "number", minimum: 0 }, trendPeriods: { type: "integer", minimum: 1 } } },
    gateOwner: { type: "string" },
  },
};

const outputSchema: JsonSchema = {
  type: "object",
  required: ["rows", "materialCount", "policy", "policyIsDefault", "limitation", "gate"],
  properties: {
    rows: { type: "array", items: { type: "object", required: ["name", "actual", "budget", "varianceAbs", "direction", "material", "challenges"] } },
    materialCount: { type: "integer" },
    policy: { type: "object", required: ["materialityPct"] },
    policyIsDefault: { type: "boolean" },
    limitation: { type: "string" },
    gate: { type: "string" },
  },
};

export const kpiVarianceManifest: SkillManifest = {
  id: "kpi-variance",
  name: "KPI Variance Tracking",
  version: "1.0.0",
  owner: "fundexecs",
  hub: "execute",
  applicableExecutives: ["portfolio_ops"],
  supportedEntityTypes: ["asset", "company"],
  requiredInputs: ["company", "period", "kpis"],
  optionalInputs: ["kpiPolicy", "gateOwner"],
  outputs: ["rows", "materialCount", "policy", "gate"],
  artifactTypes: ["analysis"],
  dataPermissions: ["asset:read"],
  tools: [],
  approvalTier: 1,
  riskClassification: "low",
  executionTimeoutMs: 10_000,
  retryPolicy: { maxAttempts: 1, backoffMs: 0 },
  validationRules: ["input matches input.schema.json", "output matches output.schema.json", "drivers sum to variance", "classification cites evidence"],
  evaluationCriteria: ["materiality uses pct AND absolute floor when set", "cost KPIs read direction-aware", "driver residual reported", "unevidenced classification challenged"],
  providerCapabilities: ["financial_reasoning"],
  allowedDownstreamSkills: ["portfolio-review", "value-creation", "lp-update"],
  prohibitedActions: ["sign_document", "move_capital", "distribute_report", "send_outreach"],
  inputSchema,
  outputSchema,
};

export const kpiVariance: SkillDefinition<KpiVarianceInput, KpiVarianceOutput> = { manifest: kpiVarianceManifest, run };
