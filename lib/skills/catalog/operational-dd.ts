// lib/skills/catalog/operational-dd.ts
// Operational DD Memo (PE department · Due Diligence 06). Tests whether operations can deliver
// the plan: capacity, supply chain, people and the cost base.
//   * cost map by function, tied to the reported cost base, against any benchmark the user supplies;
//   * capacity test that uses the PLAN'S OWN volume numbers — a plan volume that is not supplied
//     is flagged, never estimated;
//   * key person dependencies and supplier concentration;
//   * the plan's KPI moves, set against the firm's materiality (standing default labelled);
//   * an improvement register: every improvement in the plan cites evidence or is marked untested;
//     improvements not in the plan are listed and never added to the plan's savings.
// Desk-based operational DD misses what a site visit shows; pair it with a visit before IC. Pure core.

import type {
  JsonSchema,
  SkillCore,
  SkillCoreResult,
  SkillDefinition,
  SkillManifest,
  SkillSource,
} from "@/lib/skills/types";
import {
  documentGaps,
  issueInSchema,
  keyPersonIssue,
  rankIssues,
  toRedFlagHandoff,
  type IssueIn,
  type IssueOut,
  type KeyPersonIn,
  type RedFlagHandoff,
} from "@/lib/pe/dd-issues";
import {
  canSupportPrice,
  DEFAULT_EVIDENCE_POLICY,
  gradeOf,
  parseEvidencePolicy,
  type EvidenceGrade,
} from "@/lib/pe/evidence";
import { DEFAULT_KPI_POLICY, parseKpiPolicy } from "@/lib/pe/kpi-policy";

export const OPS_CATEGORIES = [
  "cost-base",
  "capacity",
  "people",
  "suppliers",
  "improvements",
  "other",
] as const;
export type OpsCategory = (typeof OPS_CATEGORIES)[number];
const REVIEWED_CATEGORIES = OPS_CATEGORIES.filter((c) => c !== "other");
const DEFAULT_EXPECTED_DOCUMENTS = [
  "org chart and headcount data",
  "site and capacity data",
  "supplier list and spend",
  "operating kpis",
];

export interface CostLineIn {
  function: string;
  cost: number;
  /** Benchmark for this function as a percent of revenue, if the user has one. */
  benchmarkPctOfRevenue?: number;
  documentRef?: string;
}

export interface CapacityIn {
  /** Site, line or resource. */
  unit: string;
  metric?: string;
  currentVolume?: number;
  capacity: number;
  /** The volume in the PLAN. Not estimated: without it the test is not run. */
  planVolume?: number;
  documentRef?: string;
}

export interface SupplierIn {
  name: string;
  spend: number;
  critical?: boolean;
  alternativeSupplier?: "yes" | "no" | "unknown";
  documentRef?: string;
}

export interface KpiIn {
  name: string;
  current: number;
  plan: number;
  documentRef?: string;
}

export interface ImprovementIn {
  name: string;
  inPlan: boolean;
  savingLow?: number;
  savingHigh?: number;
  savingBasis?: string;
  /** What shows it will work: a document, a pilot result, a benchmark. */
  evidence?: string;
  evidenceGrade?: EvidenceGrade;
}

export type OpsIssueIn = Omit<IssueIn, "category"> & { category?: OpsCategory };

export interface OperationalDdInput {
  dealName?: string;
  documentsReceived?: string[];
  expectedDocuments?: string[];
  revenue?: number;
  costBase?: CostLineIn[];
  /** The cost base as reported, to tie the map to. */
  reportedCostBase?: number;
  /** Differences up to this absolute amount tie. Absent = any difference is flagged (default labelled). */
  tieOutToleranceAbs?: number;
  /** Cost lines within this many points of a benchmark are 'in line'. Absent = exact comparison (default labelled). */
  benchmarkTolerancePts?: number;
  capacity?: CapacityIn[];
  /** Flag a capacity test amber above this utilisation of the plan volume. Absent = only a breach is flagged. */
  warnAbovePct?: number;
  keyPeople?: KeyPersonIn[];
  suppliers?: SupplierIn[];
  /** Flag a supplier as amber above this share of listed spend. Absent = shares are reported, not flagged. */
  supplierConcentrationPct?: number;
  kpis?: KpiIn[];
  kpiPolicy?: { materialityPct?: number };
  improvements?: ImprovementIn[];
  issues?: OpsIssueIn[];
  categoriesReviewed?: OpsCategory[];
  /** True once a site has been visited. */
  siteVisitDone?: boolean;
  evidencePolicy?: {
    supportsPrice?: { A?: boolean; B?: boolean; C?: boolean };
  };
  gateOwner?: string;
}

export interface CostRow {
  function: string;
  cost: number;
  pctOfTotal: number;
  pctOfRevenue: number | null;
  benchmarkPctOfRevenue: number | null;
  variancePts: number | null;
  vsBenchmark: "above" | "below" | "in-line" | "no-benchmark" | "no-revenue";
}

export interface CapacityRow {
  unit: string;
  metric: string | null;
  currentVolume: number | null;
  capacity: number;
  planVolume: number | null;
  currentUtilisationPct: number | null;
  planUtilisationPct: number | null;
  status: "breach" | "warn" | "within" | "plan-volume-missing";
}

export interface SupplierRow {
  name: string;
  spend: number;
  sharePct: number;
  critical: boolean;
  alternativeSupplier: "yes" | "no" | "unknown";
}

export interface KpiRow {
  name: string;
  current: number;
  plan: number;
  changePct: number | null;
  material: boolean;
}

export interface ImprovementRow {
  name: string;
  inPlan: boolean;
  status: "evidenced" | "untested";
  evidence: string | null;
  evidenceGrade: EvidenceGrade;
  saving: { low: number; high: number; basis: string } | null;
  savingDropped: string | null;
  canSupportPrice: boolean;
}

export interface OperationalDdOutput {
  costMap: {
    rows: CostRow[];
    total: number | null;
    reportedCostBase: number | null;
    tiesToReported: boolean | null;
    difference: number | null;
    benchmarkToleranceIsDefault: boolean;
  };
  capacity: CapacityRow[];
  suppliers: {
    rows: SupplierRow[];
    totalSpend: number | null;
    topSharePct: number | null;
  };
  kpis: { rows: KpiRow[]; materialityPct: number; policyIsDefault: boolean };
  improvements: ImprovementRow[];
  /** Savings the PLAN counts on, split by evidence. Improvements outside the plan are never added. */
  planSavings: {
    evidenced: { low: number; high: number; count: number } | null;
    untested: { low: number; high: number; count: number } | null;
    priceSupported: { low: number; high: number; count: number } | null;
  };
  outsidePlan: Array<{
    name: string;
    saving: { low: number; high: number; basis: string } | null;
  }>;
  issues: IssueOut[];
  counts: { red: number; amber: number; green: number };
  documentGaps: string[];
  categoriesNotReviewed: OpsCategory[];
  uncited: string[];
  rangesDropped: string[];
  evidencePolicyIsDefault: boolean;
  basisOfReview: string;
  duplicatesMerged: number;
  derivedCount: number;
  handoff: { findings: RedFlagHandoff[]; needingImpact: string[] };
  limitation: string;
  note: string;
  gate: string;
}

const r1 = (n: number) => Math.round(n * 10) / 10;
const r2 = (n: number) => Math.round(n * 100) / 100;
const clean = (s: string | undefined) =>
  typeof s === "string" && s.trim() ? s.trim() : null;
const isNum = (v: unknown): v is number =>
  typeof v === "number" && Number.isFinite(v);
const sumRange = (xs: Array<{ low: number; high: number }>) =>
  xs.length
    ? {
        low: r2(xs.reduce((s, x) => s + x.low, 0)),
        high: r2(xs.reduce((s, x) => s + x.high, 0)),
        count: xs.length,
      }
    : null;

const run: SkillCore<OperationalDdInput, OperationalDdOutput> = (
  input,
): SkillCoreResult<OperationalDdOutput> => {
  const sources: SkillSource[] = [];
  const missingData: string[] = [];
  const derived: IssueIn[] = [];

  const parsedPolicy = parseEvidencePolicy(input.evidencePolicy);
  const policy = parsedPolicy ?? DEFAULT_EVIDENCE_POLICY;
  const evidencePolicyIsDefault = !parsedPolicy;
  if (evidencePolicyIsDefault)
    sources.push({
      label: "Evidence policy",
      kind: "assumption",
      value:
        "standing default: grades A and B can support a price; C and U cannot",
      ref: "run on default settings — set root-evidence",
    });
  const parsedKpi = parseKpiPolicy(input.kpiPolicy);
  const kpiPolicyIsDefault = !parsedKpi;
  const materialityPct = (parsedKpi ?? DEFAULT_KPI_POLICY).materialityPct;
  if (kpiPolicyIsDefault)
    sources.push({
      label: "KPI materiality",
      kind: "assumption",
      value: `${DEFAULT_KPI_POLICY.materialityPct}%`,
      ref: "run on default settings — set root-kpi",
    });

  // ---- cost map ----
  const lines = (input.costBase ?? []).filter(
    (c) => c && clean(c.function) && isNum(c.cost),
  );
  const total = lines.length ? r2(lines.reduce((s, c) => s + c.cost, 0)) : null;
  const revenue =
    isNum(input.revenue) && input.revenue > 0 ? input.revenue : null;
  const benchTol =
    isNum(input.benchmarkTolerancePts) && input.benchmarkTolerancePts >= 0
      ? input.benchmarkTolerancePts
      : 0;
  const benchmarkToleranceIsDefault = !isNum(input.benchmarkTolerancePts);
  if (benchmarkToleranceIsDefault)
    sources.push({
      label: "Benchmark tolerance",
      kind: "assumption",
      value: "0 points — exact comparison",
      ref: "no tolerance supplied",
    });
  const rows: CostRow[] = lines.map((c) => {
    const pctOfRevenue = revenue ? r1((c.cost / revenue) * 100) : null;
    const bench = isNum(c.benchmarkPctOfRevenue)
      ? c.benchmarkPctOfRevenue
      : null;
    const variancePts =
      pctOfRevenue !== null && bench !== null ? r1(pctOfRevenue - bench) : null;
    const vsBenchmark: CostRow["vsBenchmark"] =
      bench === null
        ? "no-benchmark"
        : variancePts === null
          ? "no-revenue"
          : Math.abs(variancePts) <= benchTol
            ? "in-line"
            : variancePts > 0
              ? "above"
              : "below";
    return {
      function: c.function.trim(),
      cost: c.cost,
      pctOfTotal: total ? r1((c.cost / total) * 100) : 0,
      pctOfRevenue,
      benchmarkPctOfRevenue: bench,
      variancePts,
      vsBenchmark,
    };
  });
  rows.sort((a, b) => b.cost - a.cost || a.function.localeCompare(b.function));
  if (lines.length === 0)
    missingData.push("No cost base supplied — the cost map is empty");
  if (lines.length && !revenue)
    missingData.push(
      "No revenue supplied — costs are not expressed as a percent of revenue and cannot be compared with benchmarks",
    );
  if (lines.length && rows.every((r) => r.benchmarkPctOfRevenue === null))
    missingData.push(
      "No benchmarks supplied — the cost map is not compared with anything",
    );
  for (const r of rows.filter((x) => x.vsBenchmark === "above")) {
    derived.push({
      title: `Cost above benchmark: ${r.function} at ${r.pctOfRevenue}% of revenue vs ${r.benchmarkPctOfRevenue}% (${r.variancePts} points)`,
      rating: "amber",
      category: "cost-base",
      documentRef:
        clean(
          lines.find((l) => l.function.trim() === r.function)?.documentRef,
        ) ?? undefined,
      evidenceGrade: "B",
      question:
        "Is the gap real and addressable, or does the benchmark compare unlike things?",
      derived: true,
    });
  }
  const reported = isNum(input.reportedCostBase)
    ? input.reportedCostBase
    : null;
  const tieTol =
    isNum(input.tieOutToleranceAbs) && input.tieOutToleranceAbs >= 0
      ? input.tieOutToleranceAbs
      : 0;
  if (!isNum(input.tieOutToleranceAbs) && reported !== null)
    sources.push({
      label: "Tie-out tolerance",
      kind: "assumption",
      value: "0 — any difference is flagged",
      ref: "no tolerance supplied",
    });
  const difference =
    total !== null && reported !== null ? r2(total - reported) : null;
  const ties = difference === null ? null : Math.abs(difference) <= tieTol;
  if (difference !== null && !ties) {
    derived.push({
      title: `Cost map does not tie to the reported cost base (map ${total} vs reported ${reported}; difference ${difference})`,
      rating: "amber",
      category: "cost-base",
      evidenceGrade: "A",
      question:
        "What explains the difference — a function missing from the map, or a cost that is not operating cost?",
      derived: true,
    });
  } else if (lines.length && reported === null)
    missingData.push(
      "No reported cost base supplied — the cost map was not tied out",
    );

  // ---- capacity: the plan's own volume ----
  const warn = isNum(input.warnAbovePct) ? input.warnAbovePct : null;
  const capacity: CapacityRow[] = [];
  for (const c of input.capacity ?? []) {
    if (!c || !clean(c.unit) || !isNum(c.capacity) || c.capacity <= 0) {
      if (c && clean(c.unit))
        missingData.push(
          `Capacity test "${c.unit}" needs a capacity above zero`,
        );
      continue;
    }
    const currentUtilisationPct = isNum(c.currentVolume)
      ? r1((c.currentVolume / c.capacity) * 100)
      : null;
    if (!isNum(c.planVolume)) {
      capacity.push({
        unit: c.unit.trim(),
        metric: clean(c.metric),
        currentVolume: isNum(c.currentVolume) ? c.currentVolume : null,
        capacity: c.capacity,
        planVolume: null,
        currentUtilisationPct,
        planUtilisationPct: null,
        status: "plan-volume-missing",
      });
      missingData.push(
        `Capacity test "${c.unit}" has no plan volume — it uses the plan's own number and was not run`,
      );
      continue;
    }
    const planUtilisationPct = r1((c.planVolume / c.capacity) * 100);
    const status: CapacityRow["status"] =
      c.planVolume > c.capacity
        ? "breach"
        : warn !== null && planUtilisationPct > warn
          ? "warn"
          : "within";
    capacity.push({
      unit: c.unit.trim(),
      metric: clean(c.metric),
      currentVolume: isNum(c.currentVolume) ? c.currentVolume : null,
      capacity: c.capacity,
      planVolume: c.planVolume,
      currentUtilisationPct,
      planUtilisationPct,
      status,
    });
    if (status !== "within") {
      derived.push({
        title: `${status === "breach" ? "Capacity breached by the plan" : "Capacity tight under the plan"}: ${c.unit.trim()} (plan ${c.planVolume} vs capacity ${c.capacity}${clean(c.metric) ? ` ${clean(c.metric)}` : ""})`,
        rating: status === "breach" ? "red" : "amber",
        category: "capacity",
        documentRef: clean(c.documentRef) ?? undefined,
        evidenceGrade: "B",
        question:
          "What does it cost, and how long does it take, to add the capacity the plan needs?",
        derived: true,
      });
    }
  }

  // ---- people ----
  for (const p of input.keyPeople ?? []) {
    const issue = keyPersonIssue(p, "people");
    if (issue) derived.push(issue);
  }

  // ---- suppliers ----
  const sups = (input.suppliers ?? []).filter(
    (s) => s && clean(s.name) && isNum(s.spend) && s.spend >= 0,
  );
  const totalSpend = sups.length
    ? r2(sups.reduce((s, x) => s + x.spend, 0))
    : null;
  const supplierRows: SupplierRow[] = sups
    .map((s) => ({
      name: s.name.trim(),
      spend: s.spend,
      sharePct: totalSpend ? r1((s.spend / totalSpend) * 100) : 0,
      critical: s.critical === true,
      alternativeSupplier: (s.alternativeSupplier ??
        "unknown") as SupplierRow["alternativeSupplier"],
    }))
    .sort((a, b) => b.spend - a.spend || a.name.localeCompare(b.name));
  const supDoc = new Map(
    sups.map((s) => [s.name.trim(), clean(s.documentRef) ?? undefined]),
  );
  for (const s of supplierRows) {
    if (s.critical && s.alternativeSupplier !== "yes") {
      derived.push({
        title: `Critical supplier with no confirmed alternative: ${s.name} (${s.sharePct}% of listed spend; alternative ${s.alternativeSupplier === "no" ? "none" : "not confirmed"})`,
        rating: s.alternativeSupplier === "no" ? "red" : "amber",
        category: "suppliers",
        documentRef: supDoc.get(s.name),
        evidenceGrade: supDoc.get(s.name) ? "B" : "U",
        question:
          "What happens if this supplier fails or reprices, and how long to qualify another?",
        derived: true,
      });
    }
    if (
      isNum(input.supplierConcentrationPct) &&
      s.sharePct > input.supplierConcentrationPct
    ) {
      derived.push({
        title: `Supplier concentration: ${s.name} is ${s.sharePct}% of listed spend (limit ${input.supplierConcentrationPct}%)`,
        rating: "amber",
        category: "suppliers",
        documentRef: supDoc.get(s.name),
        evidenceGrade: supDoc.get(s.name) ? "B" : "U",
        question:
          "Can spend be split or a second source qualified within the hold?",
        derived: true,
      });
    }
  }
  if (supplierRows.length === 0)
    missingData.push(
      "No suppliers supplied — supplier concentration was not tested",
    );

  // ---- KPI moves against materiality ----
  const kpiRows: KpiRow[] = [];
  for (const k of input.kpis ?? []) {
    if (!k || !clean(k.name) || !isNum(k.current) || !isNum(k.plan)) continue;
    const changePct =
      k.current === 0
        ? null
        : r1(((k.plan - k.current) / Math.abs(k.current)) * 100);
    const material =
      changePct !== null && Math.abs(changePct) >= materialityPct;
    kpiRows.push({
      name: k.name.trim(),
      current: k.current,
      plan: k.plan,
      changePct,
      material,
    });
    if (changePct === null)
      missingData.push(
        `KPI "${k.name}": the current value is zero, so the plan's move cannot be expressed as a percent`,
      );
    if (material) {
      derived.push({
        title: `Plan assumes a material change in ${k.name.trim()}: ${k.current} to ${k.plan} (${changePct}%)`,
        rating: "amber",
        category: "improvements",
        documentRef: clean(k.documentRef) ?? undefined,
        evidenceGrade: "C",
        question:
          "Which improvement delivers this move, and what evidence shows it is achievable?",
        derived: true,
      });
    }
  }

  // ---- improvement register ----
  const registry: ImprovementRow[] = [];
  for (const im of input.improvements ?? []) {
    const name = clean(im?.name);
    if (!name) continue;
    const evidence = clean(im.evidence);
    const status: ImprovementRow["status"] = evidence
      ? "evidenced"
      : "untested";
    const grade: EvidenceGrade = evidence
      ? gradeOf(im.evidenceGrade ?? "C")
      : "U";
    let saving: ImprovementRow["saving"] = null;
    let savingDropped: string | null = null;
    const hasAny =
      isNum(im.savingLow) || isNum(im.savingHigh) || clean(im.savingBasis);
    if (hasAny) {
      if (!isNum(im.savingLow) || !isNum(im.savingHigh))
        savingDropped = "Saving ignored: it needs both a low and a high.";
      else if (!clean(im.savingBasis))
        savingDropped =
          "Saving ignored: no basis is stated, and a saving without a basis is not given.";
      else if (im.savingLow < 0 || im.savingHigh < im.savingLow)
        savingDropped =
          "Saving ignored: it must be non-negative with low not above high.";
      else
        saving = {
          low: im.savingLow,
          high: im.savingHigh,
          basis: clean(im.savingBasis) as string,
        };
    }
    registry.push({
      name,
      inPlan: im.inPlan === true,
      status,
      evidence,
      evidenceGrade: grade,
      saving,
      savingDropped,
      canSupportPrice: canSupportPrice(grade, policy),
    });
    if (savingDropped)
      missingData.push(
        `${name}: ${savingDropped.replace("Saving ignored: ", "saving ignored — ")}`,
      );
    if (im.inPlan === true && status === "untested") {
      derived.push({
        title: `Plan relies on an untested improvement: ${name}${saving ? ` (saving ${saving.low}–${saving.high})` : ""}`,
        rating: "amber",
        category: "improvements",
        evidenceGrade: "U",
        question:
          "What evidence — a pilot, a benchmark, a comparable — shows this will deliver? Until then the saving should not support the price.",
        derived: true,
      });
    }
  }
  const inPlan = registry.filter((r) => r.inPlan);
  const planSavings: OperationalDdOutput["planSavings"] = {
    evidenced: sumRange(
      inPlan
        .filter((r) => r.status === "evidenced" && r.saving)
        .map((r) => r.saving as { low: number; high: number }),
    ),
    untested: sumRange(
      inPlan
        .filter((r) => r.status === "untested" && r.saving)
        .map((r) => r.saving as { low: number; high: number }),
    ),
    priceSupported: sumRange(
      inPlan
        .filter((r) => r.canSupportPrice && r.saving)
        .map((r) => r.saving as { low: number; high: number }),
    ),
  };
  const outsidePlan = registry
    .filter((r) => !r.inPlan)
    .map((r) => ({ name: r.name, saving: r.saving }));
  if (registry.length === 0)
    missingData.push(
      "No improvements supplied — the improvement register is empty",
    );
  if (planSavings.evidenced)
    sources.push({
      label: "Plan savings with evidence",
      kind: "calculation",
      value: `${planSavings.evidenced.low}–${planSavings.evidenced.high}`,
      ref: "plain sum; overlaps not netted",
    });
  if (planSavings.untested)
    sources.push({
      label: "Plan savings untested",
      kind: "calculation",
      value: `${planSavings.untested.low}–${planSavings.untested.high}`,
      ref: "plain sum; not supported by evidence",
    });

  // ---- rank ----
  const supplied = (input.issues ?? []).map((i) => ({ ...i, derived: false }));
  const ranked = rankIssues([...supplied, ...derived], {
    defaultCategory: "other",
  });

  // ---- gaps, coverage, basis ----
  const expected = input.expectedDocuments?.length
    ? input.expectedDocuments
    : DEFAULT_EXPECTED_DOCUMENTS;
  if (!input.expectedDocuments?.length)
    sources.push({
      label: "Expected documents",
      kind: "assumption",
      value: DEFAULT_EXPECTED_DOCUMENTS.join(", "),
      ref: "standing list of operational data room items",
    });
  const gaps =
    input.documentsReceived === undefined
      ? expected
      : documentGaps(expected, input.documentsReceived);
  if (input.documentsReceived === undefined)
    missingData.push(
      "What the data room contains was not supplied — every expected document is shown as a gap",
    );
  else if (gaps.length)
    missingData.push(`Documents not received: ${gaps.join(", ")}`);
  const reviewed = new Set(input.categoriesReviewed ?? []);
  const categoriesNotReviewed = REVIEWED_CATEGORIES.filter(
    (c) => !reviewed.has(c),
  );
  if (!input.categoriesReviewed?.length)
    missingData.push(
      "No review coverage stated — none of the operational categories is shown as reviewed",
    );
  else if (categoriesNotReviewed.length)
    missingData.push(`Not reviewed: ${categoriesNotReviewed.join(", ")}`);
  if (ranked.uncited.length)
    missingData.push(
      `${ranked.uncited.length} risk${ranked.uncited.length === 1 ? "" : "s"} cite no document and are graded U: ${ranked.uncited.join("; ")}`,
    );
  if (!input.siteVisitDone)
    missingData.push(
      "No site visit recorded — desk-based operational DD misses what a visit shows; pair it with one before IC",
    );

  const basisOfReview = input.siteVisitDone
    ? "Document review plus a site visit."
    : "Desk-based review only: no site visit.";
  const limitation =
    "Desk-based operational DD misses what a site visit shows. Pair this with a visit before IC.";
  const handoff = toRedFlagHandoff(ranked.issues, "operational");
  const gateOwner = input.gateOwner?.trim() || "The operating partner";
  const gate = `${gateOwner} signs the improvement register.`;
  const derivedCount = ranked.issues.filter((i) => i.derived).length;
  const { red, amber, green } = ranked.counts;
  const untestedInPlan = inPlan.filter((r) => r.status === "untested").length;
  const note =
    ranked.issues.length === 0 && registry.length === 0
      ? "No operational issues or improvements were supplied or derived. That is not a clean bill: the memo reflects only what was reviewed."
      : `${ranked.issues.length} operational issue${ranked.issues.length === 1 ? "" : "s"}: ${red} red, ${amber} amber, ${green} green${derivedCount ? ` (${derivedCount} derived by rule)` : ""}. ${capacity.some((c) => c.status === "breach") ? "The plan breaches capacity. " : ""}${inPlan.length ? `${inPlan.length - untestedInPlan} of ${inPlan.length} improvements in the plan are evidenced; ${untestedInPlan} untested. ` : ""}${planSavings.priceSupported ? `Savings that can support a price: ${planSavings.priceSupported.low}–${planSavings.priceSupported.high}${evidencePolicyIsDefault ? " (default evidence policy)" : ""}. ` : inPlan.some((r) => r.saving) ? "No plan saving is evidenced well enough to support a price. " : ""}${input.siteVisitDone ? "" : "No site visit yet. "}`.trim();

  const structured: OperationalDdOutput = {
    costMap: {
      rows,
      total,
      reportedCostBase: reported,
      tiesToReported: ties,
      difference,
      benchmarkToleranceIsDefault,
    },
    capacity,
    suppliers: {
      rows: supplierRows,
      totalSpend,
      topSharePct: supplierRows.length ? supplierRows[0].sharePct : null,
    },
    kpis: {
      rows: kpiRows,
      materialityPct,
      policyIsDefault: kpiPolicyIsDefault,
    },
    improvements: registry,
    planSavings,
    outsidePlan,
    issues: ranked.issues,
    counts: ranked.counts,
    documentGaps: gaps,
    categoriesNotReviewed,
    uncited: ranked.uncited,
    rangesDropped: ranked.rangesDropped,
    evidencePolicyIsDefault,
    basisOfReview,
    duplicatesMerged: ranked.duplicatesMerged,
    derivedCount,
    handoff,
    limitation,
    note,
    gate,
  };
  const completeness = r2(
    ((lines.length ? 1 : 0) +
      (capacity.some((c) => c.status !== "plan-volume-missing") ? 1 : 0) +
      (registry.length ? 1 : 0) +
      (input.siteVisitDone ? 1 : 0)) /
      4,
  );
  return {
    structured,
    narrative: `${note} ${limitation} ${gate}`,
    sources,
    confidence: Math.max(0.2, Math.min(0.8, 0.3 + completeness * 0.45)),
    completeness,
    missingData,
  };
};

const strList: JsonSchema = { type: "array", items: { type: "string" } };
const opsCategory: JsonSchema = { type: "string", enum: [...OPS_CATEGORIES] };
const reviewedCategory: JsonSchema = {
  type: "string",
  enum: [...REVIEWED_CATEGORIES],
};
const opsIssueSchema: JsonSchema = {
  ...issueInSchema,
  properties: {
    ...(issueInSchema.properties as Record<string, JsonSchema>),
    category: opsCategory,
  },
};
const grade: JsonSchema = { type: "string", enum: ["A", "B", "C", "U"] };
const nonNeg: JsonSchema = { type: "number", minimum: 0 };

const inputSchema: JsonSchema = {
  type: "object",
  properties: {
    dealName: { type: "string" },
    documentsReceived: strList,
    expectedDocuments: strList,
    revenue: nonNeg,
    costBase: {
      type: "array",
      items: {
        type: "object",
        required: ["function", "cost"],
        properties: {
          function: { type: "string" },
          cost: nonNeg,
          benchmarkPctOfRevenue: nonNeg,
          documentRef: { type: "string" },
        },
      },
    },
    reportedCostBase: nonNeg,
    tieOutToleranceAbs: nonNeg,
    benchmarkTolerancePts: nonNeg,
    capacity: {
      type: "array",
      items: {
        type: "object",
        required: ["unit", "capacity"],
        properties: {
          unit: { type: "string" },
          metric: { type: "string" },
          currentVolume: nonNeg,
          capacity: nonNeg,
          planVolume: nonNeg,
          documentRef: { type: "string" },
        },
      },
    },
    warnAbovePct: nonNeg,
    keyPeople: {
      type: "array",
      items: {
        type: "object",
        required: ["role"],
        properties: {
          role: { type: "string" },
          retentionRisk: {
            type: "string",
            enum: ["low", "medium", "high", "unknown"],
          },
          knowledgeDocumented: { type: "boolean" },
          documentRef: { type: "string" },
        },
      },
    },
    suppliers: {
      type: "array",
      items: {
        type: "object",
        required: ["name", "spend"],
        properties: {
          name: { type: "string" },
          spend: nonNeg,
          critical: { type: "boolean" },
          alternativeSupplier: {
            type: "string",
            enum: ["yes", "no", "unknown"],
          },
          documentRef: { type: "string" },
        },
      },
    },
    supplierConcentrationPct: nonNeg,
    kpis: {
      type: "array",
      items: {
        type: "object",
        required: ["name", "current", "plan"],
        properties: {
          name: { type: "string" },
          current: { type: "number" },
          plan: { type: "number" },
          documentRef: { type: "string" },
        },
      },
    },
    kpiPolicy: {
      type: "object",
      properties: { materialityPct: { type: "number", minimum: 0 } },
    },
    improvements: {
      type: "array",
      items: {
        type: "object",
        required: ["name", "inPlan"],
        properties: {
          name: { type: "string" },
          inPlan: { type: "boolean" },
          savingLow: nonNeg,
          savingHigh: nonNeg,
          savingBasis: { type: "string" },
          evidence: { type: "string" },
          evidenceGrade: grade,
        },
      },
    },
    issues: { type: "array", items: opsIssueSchema },
    categoriesReviewed: { type: "array", items: reviewedCategory },
    siteVisitDone: { type: "boolean" },
    evidencePolicy: {
      type: "object",
      properties: {
        supportsPrice: {
          type: "object",
          properties: {
            A: { type: "boolean" },
            B: { type: "boolean" },
            C: { type: "boolean" },
          },
        },
      },
    },
    gateOwner: { type: "string" },
  },
};

const rangeOut: JsonSchema = {
  type: "object",
  required: ["low", "high", "count"],
  properties: {
    low: { type: "number" },
    high: { type: "number" },
    count: { type: "number" },
  },
};

const outputSchema: JsonSchema = {
  type: "object",
  required: [
    "costMap",
    "capacity",
    "suppliers",
    "kpis",
    "improvements",
    "planSavings",
    "outsidePlan",
    "issues",
    "counts",
    "documentGaps",
    "categoriesNotReviewed",
    "uncited",
    "rangesDropped",
    "evidencePolicyIsDefault",
    "basisOfReview",
    "duplicatesMerged",
    "derivedCount",
    "handoff",
    "limitation",
    "note",
    "gate",
  ],
  properties: {
    costMap: {
      type: "object",
      required: ["rows", "benchmarkToleranceIsDefault"],
      properties: {
        rows: {
          type: "array",
          items: {
            type: "object",
            required: ["function", "cost", "pctOfTotal", "vsBenchmark"],
            properties: {
              function: { type: "string" },
              cost: { type: "number" },
              pctOfTotal: { type: "number" },
              vsBenchmark: {
                type: "string",
                enum: [
                  "above",
                  "below",
                  "in-line",
                  "no-benchmark",
                  "no-revenue",
                ],
              },
            },
          },
        },
        benchmarkToleranceIsDefault: { type: "boolean" },
      },
    },
    capacity: {
      type: "array",
      items: {
        type: "object",
        required: ["unit", "capacity", "status"],
        properties: {
          unit: { type: "string" },
          capacity: { type: "number" },
          status: {
            type: "string",
            enum: ["breach", "warn", "within", "plan-volume-missing"],
          },
        },
      },
    },
    suppliers: {
      type: "object",
      required: ["rows"],
      properties: {
        rows: {
          type: "array",
          items: {
            type: "object",
            required: [
              "name",
              "spend",
              "sharePct",
              "critical",
              "alternativeSupplier",
            ],
            properties: {
              name: { type: "string" },
              spend: { type: "number" },
              sharePct: { type: "number" },
              critical: { type: "boolean" },
              alternativeSupplier: {
                type: "string",
                enum: ["yes", "no", "unknown"],
              },
            },
          },
        },
      },
    },
    kpis: {
      type: "object",
      required: ["rows", "materialityPct", "policyIsDefault"],
      properties: {
        rows: {
          type: "array",
          items: {
            type: "object",
            required: ["name", "current", "plan", "material"],
            properties: {
              name: { type: "string" },
              current: { type: "number" },
              plan: { type: "number" },
              material: { type: "boolean" },
            },
          },
        },
        materialityPct: { type: "number" },
        policyIsDefault: { type: "boolean" },
      },
    },
    improvements: {
      type: "array",
      items: {
        type: "object",
        required: [
          "name",
          "inPlan",
          "status",
          "evidenceGrade",
          "canSupportPrice",
        ],
        properties: {
          name: { type: "string" },
          inPlan: { type: "boolean" },
          status: { type: "string", enum: ["evidenced", "untested"] },
          evidenceGrade: grade,
          canSupportPrice: { type: "boolean" },
        },
      },
    },
    planSavings: {
      type: "object",
      properties: {
        evidenced: rangeOut,
        untested: rangeOut,
        priceSupported: rangeOut,
      },
    },
    outsidePlan: {
      type: "array",
      items: {
        type: "object",
        required: ["name"],
        properties: { name: { type: "string" } },
      },
    },
    issues: {
      type: "array",
      items: {
        type: "object",
        required: [
          "rank",
          "title",
          "rating",
          "category",
          "evidenceGrade",
          "cited",
          "derived",
          "notes",
        ],
        properties: {
          rank: { type: "number" },
          title: { type: "string" },
          rating: { type: "string", enum: ["red", "amber", "green"] },
          category: { type: "string" },
          evidenceGrade: grade,
          cited: { type: "boolean" },
          derived: { type: "boolean" },
          notes: strList,
        },
      },
    },
    counts: {
      type: "object",
      required: ["red", "amber", "green"],
      properties: {
        red: { type: "number" },
        amber: { type: "number" },
        green: { type: "number" },
      },
    },
    documentGaps: strList,
    categoriesNotReviewed: { type: "array", items: reviewedCategory },
    uncited: strList,
    rangesDropped: strList,
    evidencePolicyIsDefault: { type: "boolean" },
    basisOfReview: { type: "string" },
    duplicatesMerged: { type: "number" },
    derivedCount: { type: "number" },
    handoff: {
      type: "object",
      required: ["findings", "needingImpact"],
      properties: { findings: { type: "array" }, needingImpact: strList },
    },
    limitation: { type: "string" },
    note: { type: "string" },
    gate: { type: "string" },
  },
};

export const operationalDdManifest: SkillManifest = {
  id: "operational-dd",
  name: "Operational DD Memo",
  version: "1.0.0",
  owner: "fundexecs",
  hub: "run",
  applicableExecutives: ["diligence", "analyst"],
  supportedEntityTypes: ["deal"],
  requiredInputs: [],
  optionalInputs: [
    "documentsReceived",
    "expectedDocuments",
    "revenue",
    "costBase",
    "reportedCostBase",
    "tieOutToleranceAbs",
    "benchmarkTolerancePts",
    "capacity",
    "warnAbovePct",
    "keyPeople",
    "suppliers",
    "supplierConcentrationPct",
    "kpis",
    "kpiPolicy",
    "improvements",
    "issues",
    "categoriesReviewed",
    "siteVisitDone",
    "evidencePolicy",
    "gateOwner",
  ],
  outputs: [
    "costMap",
    "capacity",
    "suppliers",
    "kpis",
    "improvements",
    "planSavings",
    "outsidePlan",
    "issues",
    "documentGaps",
    "handoff",
    "basisOfReview",
    "note",
    "gate",
  ],
  artifactTypes: ["analysis"],
  dataPermissions: ["deal:read", "document:read", "data_room:read"],
  tools: [],
  approvalTier: 1,
  riskClassification: "moderate",
  executionTimeoutMs: 15_000,
  retryPolicy: { maxAttempts: 1, backoffMs: 0 },
  validationRules: [
    "input matches input.schema.json",
    "output matches output.schema.json",
    "capacity test uses the plan's own volume",
    "every improvement cites evidence or is marked untested",
    "a saving needs a stated basis",
    "improvements outside the plan are never added to plan savings",
  ],
  evaluationCriteria: [
    "plan volume missing flagged not estimated",
    "untested improvements flagged",
    "plan savings split by evidence",
    "states desk-based and pairs with a site visit",
    "operating partner named as the gate",
  ],
  providerCapabilities: ["structured_extraction"],
  allowedDownstreamSkills: ["red-flag-register", "dd-checklist"],
  prohibitedActions: [
    "send_outreach",
    "distribute_report",
    "sign_document",
    "move_capital",
    "capital_call",
    "submit_term_sheet",
  ],
  inputSchema,
  outputSchema,
};

export const operationalDd: SkillDefinition<
  OperationalDdInput,
  OperationalDdOutput
> = { manifest: operationalDdManifest, run };
