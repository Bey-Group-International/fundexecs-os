// lib/skills/catalog/tax-dd.ts
// Tax DD Issues List (PE department · Due Diligence 05). Identifies historic tax
// exposures and structuring questions for the tax adviser:
//   * open years by jurisdiction, each reconciled (or not) from the charge in the accounts
//     to the computation — an open year with no computation is named, never assumed clean;
//   * exposures by type (transfer pricing, permanent establishment, VAT / sales tax, payroll
//     taxes, unused losses) with jurisdiction, year and the document each rests on;
//   * an exposure range only where a basis is stated, and a plain sum of the supported ranges;
//   * the questions the adviser should be asked.
// The skill flags issues; it does not quantify or opine. Pure core.

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
  rankIssues,
  toRedFlagHandoff,
  type IssueIn,
  type IssueOut,
  type RedFlagHandoff,
} from "@/lib/pe/dd-issues";

export const EXPOSURE_TYPES = [
  "transfer-pricing",
  "permanent-establishment",
  "vat-sales-tax",
  "payroll-tax",
  "unused-losses",
  "other",
] as const;
export type ExposureType = (typeof EXPOSURE_TYPES)[number];
/** The five exposure types the standard review covers; "other" is open-ended. */
const REVIEWED_TYPES: ExposureType[] = [
  "transfer-pricing",
  "permanent-establishment",
  "vat-sales-tax",
  "payroll-tax",
  "unused-losses",
];
const DEFAULT_EXPECTED_DOCUMENTS = [
  "tax returns and computations",
  "tax authority correspondence",
  "group structure chart",
  "transfer pricing documentation",
];

export interface OpenYearsIn {
  jurisdiction: string;
  years: number[];
}

export interface ReconciliationIn {
  jurisdiction: string;
  year: number;
  chargeInAccounts: number;
  chargePerComputation: number;
  /** Part of the difference the company or its advisers have explained (a positive amount). */
  explained?: number;
  documentRef?: string;
}

export interface LossIn {
  jurisdiction: string;
  amount: number;
  restrictionOnChangeOfControl?: "yes" | "no" | "unknown";
  documentRef?: string;
}

export type TaxIssueIn = Omit<IssueIn, "category"> & {
  category?: ExposureType;
};

export interface TaxDdInput {
  dealName?: string;
  documentsReceived?: string[];
  expectedDocuments?: string[];
  openYears?: OpenYearsIn[];
  reconciliations?: ReconciliationIn[];
  /** Differences up to this absolute amount count as reconciled. Absent = every difference is listed. */
  toleranceAbs?: number;
  losses?: LossIn[];
  issues?: TaxIssueIn[];
  exposureTypesReviewed?: ExposureType[];
  gateOwner?: string;
}

export interface YearRow {
  jurisdiction: string;
  year: number;
  open: boolean;
  status: "reconciled" | "difference" | "no-computation";
  chargeInAccounts: number | null;
  chargePerComputation: number | null;
  difference: number | null;
  explained: number | null;
  unexplained: number | null;
  note: string | null;
}

export interface TaxDdOutput {
  issues: IssueOut[];
  counts: { red: number; amber: number; green: number };
  years: YearRow[];
  documentGaps: string[];
  typesNotReviewed: ExposureType[];
  uncited: string[];
  rangesDropped: string[];
  /** A plain sum of the supported ranges; overlaps between exposures are not netted. */
  rangeTotal: {
    low: number;
    high: number;
    issuesIncluded: number;
    redAmberWithoutRange: number;
  } | null;
  adviserQuestions: Array<{
    issue: string;
    jurisdiction: string | null;
    period: string | null;
    question: string;
  }>;
  duplicatesMerged: number;
  derivedCount: number;
  handoff: { findings: RedFlagHandoff[]; needingImpact: string[] };
  limitation: string;
  note: string;
  gate: string;
}

const r2 = (n: number) => Math.round(n * 100) / 100;
const clean = (s: string | undefined) =>
  typeof s === "string" && s.trim() ? s.trim() : null;
const norm = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
const isNum = (v: unknown): v is number =>
  typeof v === "number" && Number.isFinite(v);

const run: SkillCore<TaxDdInput, TaxDdOutput> = (
  input,
): SkillCoreResult<TaxDdOutput> => {
  const sources: SkillSource[] = [];
  const missingData: string[] = [];
  const tolerance =
    isNum(input.toleranceAbs) && input.toleranceAbs >= 0
      ? input.toleranceAbs
      : 0;
  if (!isNum(input.toleranceAbs))
    sources.push({
      label: "Reconciliation tolerance",
      kind: "assumption",
      value: "0 — every difference is listed",
      ref: "no tolerance supplied",
    });

  // ---- years table: open years x reconciliations ----
  const recs = (input.reconciliations ?? []).filter(
    (r) =>
      r &&
      clean(r.jurisdiction) &&
      isNum(r.year) &&
      isNum(r.chargeInAccounts) &&
      isNum(r.chargePerComputation),
  );
  const recKey = (j: string, y: number) => `${norm(j)}|${y}`;
  const recByKey = new Map(
    recs.map((r) => [recKey(r.jurisdiction, r.year), r]),
  );
  const openSet = new Map<string, { jurisdiction: string; year: number }>();
  for (const o of input.openYears ?? []) {
    const j = clean(o?.jurisdiction);
    if (!j) continue;
    for (const y of o.years ?? [])
      if (isNum(y)) openSet.set(recKey(j, y), { jurisdiction: j, year: y });
  }
  if (openSet.size === 0)
    missingData.push(
      "No open tax years supplied — which years are still open to challenge is not known",
    );

  const years: YearRow[] = [];
  const derived: IssueIn[] = [];
  const rowFor = (j: string, y: number, open: boolean): YearRow => {
    const rec = recByKey.get(recKey(j, y));
    if (!rec) {
      derived.push({
        title: `Open year not reconciled: ${j} ${y}`,
        rating: "amber",
        category: "other",
        jurisdiction: j,
        period: String(y),
        evidenceGrade: "U",
        question:
          "Obtain the computation for this year and reconcile it to the tax charge in the accounts.",
        derived: true,
      });
      return {
        jurisdiction: j,
        year: y,
        open,
        status: "no-computation",
        chargeInAccounts: null,
        chargePerComputation: null,
        difference: null,
        explained: null,
        unexplained: null,
        note: "No computation was supplied for this year.",
      };
    }
    const difference = r2(rec.chargeInAccounts - rec.chargePerComputation);
    const explained =
      isNum(rec.explained) && rec.explained > 0 ? r2(rec.explained) : 0;
    const abs = Math.abs(difference);
    const unexplained = r2(Math.max(0, abs - explained));
    const over = explained > abs;
    const status: YearRow["status"] =
      unexplained <= tolerance ? "reconciled" : "difference";
    if (status === "difference") {
      derived.push({
        title: `Unreconciled tax charge: ${j} ${y} — accounts ${rec.chargeInAccounts} vs computation ${rec.chargePerComputation} (unexplained ${unexplained})`,
        rating: "amber",
        category: "other",
        jurisdiction: j,
        period: String(y),
        documentRef: clean(rec.documentRef) ?? undefined,
        evidenceGrade: "A",
        question:
          "What explains the difference between the tax charge in the accounts and the computation, and is any of it an exposure?",
        derived: true,
      });
    }
    return {
      jurisdiction: j,
      year: y,
      open,
      status,
      chargeInAccounts: rec.chargeInAccounts,
      chargePerComputation: rec.chargePerComputation,
      difference,
      explained: explained || null,
      unexplained,
      note: over
        ? "The explained amount is larger than the difference; check the explanation."
        : null,
    };
  };
  for (const o of openSet.values())
    years.push(rowFor(o.jurisdiction, o.year, true));
  for (const r of recs)
    if (!openSet.has(recKey(r.jurisdiction, r.year)))
      years.push(rowFor(r.jurisdiction.trim(), r.year, false));
  years.sort(
    (a, b) => a.jurisdiction.localeCompare(b.jurisdiction) || a.year - b.year,
  );

  // ---- losses ----
  for (const l of input.losses ?? []) {
    const j = clean(l?.jurisdiction);
    if (!j || !isNum(l.amount)) continue;
    const r = l.restrictionOnChangeOfControl ?? "unknown";
    if (r === "no") continue;
    const doc = clean(l.documentRef) ?? undefined;
    derived.push({
      title: `Loss utilisation after change of control: ${j} — losses of ${l.amount} (${r === "yes" ? "restricted on a change of control" : "restriction not confirmed"})`,
      rating: "amber",
      category: "unused-losses",
      jurisdiction: j,
      documentRef: doc,
      evidenceGrade: r === "yes" ? "A" : "U",
      question:
        r === "yes"
          ? "How much of the losses survive the change of control, and is any value attributed to them in the price?"
          : "Do the losses survive a change of control? Confirm the rule before any value is attributed to them.",
      derived: true,
    });
  }

  // ---- rank ----
  const supplied = (input.issues ?? []).map((i) => ({ ...i, derived: false }));
  const ranked = rankIssues([...supplied, ...derived], {
    defaultCategory: "other",
  });

  // ---- gaps and coverage ----
  const expected = input.expectedDocuments?.length
    ? input.expectedDocuments
    : DEFAULT_EXPECTED_DOCUMENTS;
  if (!input.expectedDocuments?.length)
    sources.push({
      label: "Expected documents",
      kind: "assumption",
      value: DEFAULT_EXPECTED_DOCUMENTS.join(", "),
      ref: "standing list of tax data room items",
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
  const reviewed = new Set(input.exposureTypesReviewed ?? []);
  const typesNotReviewed = REVIEWED_TYPES.filter((t) => !reviewed.has(t));
  if (!input.exposureTypesReviewed?.length)
    missingData.push(
      "No review coverage stated — none of the exposure types is shown as reviewed",
    );
  else if (typesNotReviewed.length)
    missingData.push(
      `Exposure types not reviewed: ${typesNotReviewed.join(", ")}`,
    );
  if (ranked.uncited.length)
    missingData.push(
      `${ranked.uncited.length} exposure${ranked.uncited.length === 1 ? "" : "s"} cite no document and are graded U: ${ranked.uncited.join("; ")}`,
    );
  if (ranked.rangesDropped.length)
    missingData.push(
      `Exposure range ignored for: ${ranked.rangesDropped.join("; ")}`,
    );

  // ---- range total (only supported ranges) ----
  const withRange = ranked.issues.filter(
    (i) => i.range && i.rating !== "green",
  );
  const redAmberWithoutRange = ranked.issues.filter(
    (i) => i.rating !== "green" && !i.range,
  ).length;
  const rangeTotal = withRange.length
    ? {
        low: r2(withRange.reduce((s, i) => s + (i.range?.low ?? 0), 0)),
        high: r2(withRange.reduce((s, i) => s + (i.range?.high ?? 0), 0)),
        issuesIncluded: withRange.length,
        redAmberWithoutRange,
      }
    : null;
  if (rangeTotal)
    sources.push({
      label: "Sum of supported exposure ranges",
      kind: "calculation",
      value: `${rangeTotal.low}–${rangeTotal.high}`,
      ref: "plain sum; overlaps not netted",
    });

  const adviserQuestions = ranked.issues
    .filter((i) => i.question)
    .map((i) => ({
      issue: i.title,
      jurisdiction: i.jurisdiction,
      period: i.period,
      question: i.question as string,
    }));
  const noQuestion = ranked.issues.filter(
    (i) => i.rating !== "green" && !i.question,
  ).length;
  if (noQuestion)
    missingData.push(
      `${noQuestion} red or amber issue${noQuestion === 1 ? "" : "s"} carry no question for the adviser`,
    );

  for (const y of years)
    if (y.status !== "no-computation")
      sources.push({
        label: `Tax charge ${y.jurisdiction} ${y.year}`,
        kind: "fact",
        value: `accounts ${y.chargeInAccounts}, computation ${y.chargePerComputation}`,
        ref: recByKey.get(recKey(y.jurisdiction, y.year))?.documentRef,
      });
  const derivedCount = ranked.issues.filter((i) => i.derived).length;
  if (derivedCount)
    sources.push({
      label: "Issues derived from years and losses",
      kind: "calculation",
      value: derivedCount,
      ref: "reconciliation and loss rules",
    });

  const handoff = toRedFlagHandoff(ranked.issues, "tax");
  const gateOwner = input.gateOwner?.trim() || "The tax adviser";
  const gate = `${gateOwner} confirms each exposure before it moves into the price or SPA.`;
  const limitation =
    "Tax law varies by jurisdiction and changes. This skill flags issues; it does not quantify or opine. A qualified tax adviser quantifies and gives the opinion.";
  const { red, amber, green } = ranked.counts;
  const note =
    ranked.issues.length === 0
      ? "No tax issues were supplied or derived. That is not a clean bill: the list reflects only what was reviewed."
      : `${ranked.issues.length} tax issue${ranked.issues.length === 1 ? "" : "s"}: ${red} red, ${amber} amber, ${green} green${derivedCount ? ` (${derivedCount} derived from the years and losses)` : ""}. ${years.filter((y) => y.status === "no-computation").length ? `${years.filter((y) => y.status === "no-computation").length} year(s) have no computation. ` : ""}${rangeTotal ? `Supported ranges sum to ${rangeTotal.low}–${rangeTotal.high} across ${rangeTotal.issuesIncluded} issue${rangeTotal.issuesIncluded === 1 ? "" : "s"}; ${redAmberWithoutRange} red or amber issue${redAmberWithoutRange === 1 ? " has" : "s have"} no range. ` : "No exposure range is supported by a stated basis. "}${ranked.uncited.length ? `${ranked.uncited.length} cite no document. ` : ""}`.trim();

  const structured: TaxDdOutput = {
    issues: ranked.issues,
    counts: ranked.counts,
    years,
    documentGaps: gaps,
    typesNotReviewed,
    uncited: ranked.uncited,
    rangesDropped: ranked.rangesDropped,
    rangeTotal,
    adviserQuestions,
    duplicatesMerged: ranked.duplicatesMerged,
    derivedCount,
    handoff,
    limitation,
    note,
    gate,
  };
  const completeness = r2(
    ((openSet.size ? 1 : 0) +
      (input.documentsReceived !== undefined ? 1 : 0) +
      (input.exposureTypesReviewed?.length ? 1 : 0) +
      (years.length > 0 && years.every((y) => y.status !== "no-computation")
        ? 1
        : 0)) /
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
const exposureType: JsonSchema = { type: "string", enum: [...EXPOSURE_TYPES] };
const reviewedType: JsonSchema = { type: "string", enum: [...REVIEWED_TYPES] };
const taxIssueSchema: JsonSchema = {
  ...issueInSchema,
  properties: {
    ...(issueInSchema.properties as Record<string, JsonSchema>),
    category: exposureType,
  },
};

const inputSchema: JsonSchema = {
  type: "object",
  properties: {
    dealName: { type: "string" },
    documentsReceived: strList,
    expectedDocuments: strList,
    openYears: {
      type: "array",
      items: {
        type: "object",
        required: ["jurisdiction", "years"],
        properties: {
          jurisdiction: { type: "string" },
          years: { type: "array", items: { type: "number" } },
        },
      },
    },
    reconciliations: {
      type: "array",
      items: {
        type: "object",
        required: [
          "jurisdiction",
          "year",
          "chargeInAccounts",
          "chargePerComputation",
        ],
        properties: {
          jurisdiction: { type: "string" },
          year: { type: "number" },
          chargeInAccounts: { type: "number" },
          chargePerComputation: { type: "number" },
          explained: { type: "number", minimum: 0 },
          documentRef: { type: "string" },
        },
      },
    },
    toleranceAbs: { type: "number", minimum: 0 },
    losses: {
      type: "array",
      items: {
        type: "object",
        required: ["jurisdiction", "amount"],
        properties: {
          jurisdiction: { type: "string" },
          amount: { type: "number", minimum: 0 },
          restrictionOnChangeOfControl: {
            type: "string",
            enum: ["yes", "no", "unknown"],
          },
          documentRef: { type: "string" },
        },
      },
    },
    issues: { type: "array", items: taxIssueSchema },
    exposureTypesReviewed: { type: "array", items: reviewedType },
    gateOwner: { type: "string" },
  },
};

const outputSchema: JsonSchema = {
  type: "object",
  required: [
    "issues",
    "counts",
    "years",
    "documentGaps",
    "typesNotReviewed",
    "uncited",
    "rangesDropped",
    "adviserQuestions",
    "duplicatesMerged",
    "derivedCount",
    "handoff",
    "limitation",
    "note",
    "gate",
  ],
  properties: {
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
          evidenceGrade: { type: "string", enum: ["A", "B", "C", "U"] },
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
    years: {
      type: "array",
      items: {
        type: "object",
        required: ["jurisdiction", "year", "open", "status"],
        properties: {
          jurisdiction: { type: "string" },
          year: { type: "number" },
          open: { type: "boolean" },
          status: {
            type: "string",
            enum: ["reconciled", "difference", "no-computation"],
          },
        },
      },
    },
    documentGaps: strList,
    typesNotReviewed: { type: "array", items: reviewedType },
    uncited: strList,
    rangesDropped: strList,
    rangeTotal: {
      type: "object",
      required: ["low", "high", "issuesIncluded", "redAmberWithoutRange"],
      properties: {
        low: { type: "number" },
        high: { type: "number" },
        issuesIncluded: { type: "number" },
        redAmberWithoutRange: { type: "number" },
      },
    },
    adviserQuestions: {
      type: "array",
      items: {
        type: "object",
        required: ["issue", "question"],
        properties: { issue: { type: "string" }, question: { type: "string" } },
      },
    },
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

export const taxDdManifest: SkillManifest = {
  id: "tax-dd",
  name: "Tax DD Issues List",
  version: "1.0.0",
  owner: "fundexecs",
  hub: "run",
  applicableExecutives: ["diligence", "legal_closing"],
  supportedEntityTypes: ["deal"],
  requiredInputs: [],
  optionalInputs: [
    "documentsReceived",
    "expectedDocuments",
    "openYears",
    "reconciliations",
    "toleranceAbs",
    "losses",
    "issues",
    "exposureTypesReviewed",
    "gateOwner",
  ],
  outputs: [
    "issues",
    "years",
    "documentGaps",
    "typesNotReviewed",
    "rangeTotal",
    "adviserQuestions",
    "handoff",
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
    "every exposure cites a document or is graded U",
    "no range without a stated basis",
    "no year assumed clean without a computation",
  ],
  evaluationCriteria: [
    "open years without a computation named",
    "ranges dropped when no basis",
    "adviser questions listed",
    "states it flags and does not quantify",
    "tax adviser named as the gate",
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

export const taxDd: SkillDefinition<TaxDdInput, TaxDdOutput> = {
  manifest: taxDdManifest,
  run,
};
