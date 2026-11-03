// lib/skills/catalog/revenue-quality.ts
// Revenue Quality and Customer Concentration (PE department · Due Diligence 03).
// From customer-by-year revenue: ties the customer file to reported revenue,
// computes top-1/5/10 share per year (merging customers under common ownership),
// splits revenue by class, computes retention, and lists customers above the
// concentration threshold with their change-of-control status. Pure core.

import type { JsonSchema, SkillCore, SkillCoreResult, SkillDefinition, SkillManifest, SkillSource } from "@/lib/skills/types";

export type RevenueClass = "contracted-recurring" | "repeat" | "one-off";
export type CocStatus = "yes" | "no" | "unknown";

export interface CustomerIn {
  name: string;
  /** Revenue per period label, e.g. { "2023": 4.1, "2024": 5.2 }. */
  revenueByYear: Record<string, number>;
  revenueClass?: RevenueClass;
  contractEnd?: string;
  /** Change-of-control clause, CONFIRMED from the contract. Absent = unknown. */
  changeOfControl?: CocStatus;
  /** Customers under common ownership share a group and are concentrated together. */
  relatedGroup?: string;
}

export interface RevenueQualityInput {
  /** Period labels, oldest to newest. */
  years: string[];
  reportedRevenue: Record<string, number>;
  customers: CustomerIn[];
  /** Concentration threshold, % of revenue. Default 10 (labelled assumption). */
  thresholdPct?: number;
  gateOwner?: string;
}

export interface YearConcentration {
  year: string;
  customerTotal: number;
  reportedRevenue: number | null;
  tieDifference: number | null;
  ties: boolean | null;
  top1Pct: number | null;
  top5Pct: number | null;
  top10Pct: number | null;
}

export interface RevenueQualityOutput {
  byYear: YearConcentration[];
  latestClassSplit: { contractedRecurringPct: number; repeatPct: number; oneOffPct: number; unclassifiedPct: number };
  retention: { fromYear: string; toYear: string; netRevenueRetentionPct: number; grossRevenueRetentionPct: number } | null;
  keyCustomers: Array<{ name: string; sharePct: number; contractEnd: string | null; changeOfControl: CocStatus; churnNote: string }>;
  thresholdPct: number;
  limitation: string;
  gate: string;
}

const r1 = (n: number) => Math.round(n * 10) / 10;
const rev = (c: CustomerIn, y: string) => (typeof c.revenueByYear[y] === "number" && Number.isFinite(c.revenueByYear[y]) ? c.revenueByYear[y] : 0);

/** Merge customers sharing a relatedGroup into one concentration unit. */
function units(customers: CustomerIn[], y: string): Array<{ name: string; value: number }> {
  const map = new Map<string, { name: string; value: number }>();
  for (const c of customers) {
    const key = c.relatedGroup?.trim() ? `g:${c.relatedGroup.trim().toLowerCase()}` : `c:${c.name.toLowerCase()}`;
    const cur = map.get(key) ?? { name: c.relatedGroup?.trim() || c.name, value: 0 };
    cur.value += rev(c, y);
    map.set(key, cur);
  }
  return [...map.values()].sort((a, b) => b.value - a.value);
}

const run: SkillCore<RevenueQualityInput, RevenueQualityOutput> = (input): SkillCoreResult<RevenueQualityOutput> => {
  const { years, customers } = input;
  const sources: SkillSource[] = [];
  const missingData: string[] = [];

  const thresholdPct = input.thresholdPct ?? 10;
  if (input.thresholdPct === undefined) sources.push({ label: "Concentration threshold", kind: "assumption", value: "10% of revenue (default — set the firm's own)" });

  const byYear: YearConcentration[] = years.map((y) => {
    const u = units(customers, y);
    const total = u.reduce((s, x) => s + x.value, 0);
    const reported = typeof input.reportedRevenue[y] === "number" ? input.reportedRevenue[y] : null;
    const share = (n: number) => (total > 0 ? r1((u.slice(0, n).reduce((s, x) => s + x.value, 0) / total) * 100) : null);
    const diff = reported !== null ? Math.round((total - reported) * 100) / 100 : null;
    if (reported === null) missingData.push(`Reported revenue for ${y} — customer file cannot be tied`);
    sources.push({ label: `Customer revenue ${y}`, kind: "fact", value: Math.round(total * 100) / 100 });
    return {
      year: y,
      customerTotal: Math.round(total * 100) / 100,
      reportedRevenue: reported,
      tieDifference: diff,
      ties: diff === null || reported === null ? null : Math.abs(diff) <= Math.abs(reported) * 0.005,
      top1Pct: share(1),
      top5Pct: share(5),
      top10Pct: share(10),
    };
  });

  const latest = years[years.length - 1];
  const prior = years.length > 1 ? years[years.length - 2] : null;
  const latestTotal = customers.reduce((s, c) => s + rev(c, latest), 0);

  // Class split of the latest year.
  const cls = (k: RevenueClass | undefined) => customers.filter((c) => c.revenueClass === k).reduce((s, c) => s + rev(c, latest), 0);
  const pctOf = (n: number) => (latestTotal > 0 ? r1((n / latestTotal) * 100) : 0);
  const latestClassSplit = {
    contractedRecurringPct: pctOf(cls("contracted-recurring")),
    repeatPct: pctOf(cls("repeat")),
    oneOffPct: pctOf(cls("one-off")),
    unclassifiedPct: pctOf(cls(undefined)),
  };
  if (latestClassSplit.unclassifiedPct > 0) missingData.push(`${latestClassSplit.unclassifiedPct}% of ${latest} revenue is unclassified (recurring / repeat / one-off)`);

  // Retention: customers that existed in the prior year.
  let retention: RevenueQualityOutput["retention"] = null;
  if (prior) {
    const cohort = customers.filter((c) => rev(c, prior) > 0);
    const priorSum = cohort.reduce((s, c) => s + rev(c, prior), 0);
    if (priorSum > 0) {
      const curSum = cohort.reduce((s, c) => s + rev(c, latest), 0);
      const kept = cohort.reduce((s, c) => s + Math.min(rev(c, latest), rev(c, prior)), 0);
      retention = { fromYear: prior, toYear: latest, netRevenueRetentionPct: r1((curSum / priorSum) * 100), grossRevenueRetentionPct: r1((kept / priorSum) * 100) };
      sources.push({ label: `Net revenue retention ${prior}→${latest}`, kind: "calculation", value: `${retention.netRevenueRetentionPct}%`, ref: "cohort revenue now ÷ cohort revenue then" });
    }
  }

  // Key customers above the threshold (group-merged), latest year.
  const keyCustomers: RevenueQualityOutput["keyCustomers"] = [];
  const latestUnits = units(customers, latest);
  for (const u of latestUnits) {
    const sharePct = latestTotal > 0 ? r1((u.value / latestTotal) * 100) : 0;
    if (sharePct < thresholdPct) continue;
    const members = customers.filter((c) => (c.relatedGroup?.trim() || c.name) === u.name);
    const coc = members.some((m) => m.changeOfControl === "yes") ? "yes" : members.every((m) => m.changeOfControl === "no") ? "no" : "unknown";
    const contractEnd = members.map((m) => m.contractEnd).filter(Boolean).sort()[0] ?? null;
    keyCustomers.push({
      name: u.name,
      sharePct,
      contractEnd,
      changeOfControl: coc,
      churnNote:
        coc === "unknown"
          ? "Change-of-control clause not confirmed from the contract — ask; do not assume."
          : coc === "yes"
            ? "Change-of-control clause confirmed — consent or waiver is a condition to price or structure."
            : "No change-of-control clause confirmed.",
    });
  }

  const limitation = "Customer names in a data room are often coded; concentration across customers under common ownership can hide in separate codes — set relatedGroup when you know of one. Change-of-control status is taken only as supplied.";
  const gateOwner = input.gateOwner?.trim() || "The deal lead";
  const gate = `${gateOwner} decides whether concentration needs price, structure or a condition.`;

  const latestRow = byYear[byYear.length - 1];
  const narrative =
    `Revenue quality ${latest}: top customer ${latestRow.top1Pct ?? "n/a"}%, top 5 ${latestRow.top5Pct ?? "n/a"}%, contracted recurring ${latestClassSplit.contractedRecurringPct}%. ` +
    `${retention ? `NRR ${retention.netRevenueRetentionPct}%, GRR ${retention.grossRevenueRetentionPct}%. ` : ""}` +
    `${keyCustomers.length} customer(s) at or above ${thresholdPct}%. ${byYear.some((b) => b.ties === false) ? "Customer file does not tie to reported revenue in at least one year. " : ""}${gate}`;

  const tied = byYear.filter((b) => b.ties !== null).length;
  const completeness = Math.round(((tied / byYear.length) * 0.5 + (latestClassSplit.unclassifiedPct === 0 ? 0.5 : 0.25)) * 100) / 100;
  return { structured: { byYear, latestClassSplit, retention, keyCustomers, thresholdPct, limitation, gate }, narrative, sources, confidence: Math.max(0.25, Math.min(0.9, 0.3 + completeness * 0.5)), completeness, missingData };
};

const inputSchema: JsonSchema = {
  type: "object",
  required: ["years", "reportedRevenue", "customers"],
  properties: {
    years: { type: "array", items: { type: "string", minLength: 1 } },
    reportedRevenue: { type: "object" },
    customers: {
      type: "array",
      items: {
        type: "object",
        required: ["name", "revenueByYear"],
        properties: {
          name: { type: "string", minLength: 1 },
          revenueByYear: { type: "object" },
          revenueClass: { type: "string", enum: ["contracted-recurring", "repeat", "one-off"] },
          contractEnd: { type: "string" },
          changeOfControl: { type: "string", enum: ["yes", "no", "unknown"] },
          relatedGroup: { type: "string" },
        },
      },
    },
    thresholdPct: { type: "number", minimum: 0, maximum: 100 },
    gateOwner: { type: "string" },
  },
};

const outputSchema: JsonSchema = {
  type: "object",
  required: ["byYear", "latestClassSplit", "keyCustomers", "thresholdPct", "limitation", "gate"],
  properties: {
    byYear: { type: "array", items: { type: "object", required: ["year", "customerTotal"] } },
    latestClassSplit: { type: "object" },
    retention: { type: "object" },
    keyCustomers: { type: "array", items: { type: "object", required: ["name", "sharePct", "changeOfControl"] } },
    thresholdPct: { type: "number" },
    limitation: { type: "string" },
    gate: { type: "string" },
  },
};

export const revenueQualityManifest: SkillManifest = {
  id: "revenue-quality",
  name: "Revenue Quality & Customer Concentration",
  version: "1.0.0",
  owner: "fundexecs",
  hub: "run",
  applicableExecutives: ["diligence", "analyst"],
  supportedEntityTypes: ["deal", "company"],
  requiredInputs: ["years", "reportedRevenue", "customers"],
  optionalInputs: ["thresholdPct", "gateOwner"],
  outputs: ["byYear", "latestClassSplit", "retention", "keyCustomers", "gate"],
  artifactTypes: ["analysis"],
  dataPermissions: ["deal:read", "document:read"],
  tools: [],
  approvalTier: 1,
  riskClassification: "low",
  executionTimeoutMs: 10_000,
  retryPolicy: { maxAttempts: 1, backoffMs: 0 },
  validationRules: ["input matches input.schema.json", "output matches output.schema.json", "customer file tied to reported revenue", "change-of-control never assumed"],
  evaluationCriteria: ["concentration merges related groups", "tie-out difference reported", "unknown change-of-control stays unknown", "retention is a calculation"],
  providerCapabilities: ["financial_reasoning"],
  allowedDownstreamSkills: ["red-flag-register", "bid-range", "ic-memo"],
  prohibitedActions: ["send_outreach", "distribute_report", "sign_document", "move_capital", "capital_call"],
  inputSchema,
  outputSchema,
};

export const revenueQuality: SkillDefinition<RevenueQualityInput, RevenueQualityOutput> = { manifest: revenueQualityManifest, run };
