// lib/skills/catalog/technology-dd.ts
// Technology DD Issues List (PE department · Due Diligence 07). Assesses the technology
// stack, security posture and technical debt, and what they will cost to fix in the hold:
//   * the stack and hosting as supplied, with end-of-life components named;
//   * security findings rated by a stated rule (severity and status), the pen test's age;
//   * a capacity test that uses the plan's own growth numbers;
//   * key technical people and their retention risk;
//   * remediation cost ranges only with a stated basis, and the part of them that the
//     firm's evidence policy lets support a price.
// Without repository access and a technical reviewer this is a document review: it does not
// read code and will not find what a code audit finds. Pure core.

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
  keyPersonIssue,
  issueInSchema,
  rankIssues,
  toRedFlagHandoff,
  type IssueIn,
  type IssueOut,
  type Rating,
  type RedFlagHandoff,
} from "@/lib/pe/dd-issues";
import type { KeyPersonIn } from "@/lib/pe/dd-issues";

export type { KeyPersonIn, RetentionRisk } from "@/lib/pe/dd-issues";
import {
  canSupportPrice,
  DEFAULT_EVIDENCE_POLICY,
  parseEvidencePolicy,
} from "@/lib/pe/evidence";

export const TECH_CATEGORIES = [
  "security",
  "infrastructure",
  "technical-debt",
  "scalability",
  "people",
  "other",
] as const;
export type TechCategory = (typeof TECH_CATEGORIES)[number];
const DEFAULT_EXPECTED_DOCUMENTS = [
  "architecture documents",
  "security policies and pen test reports",
  "product roadmap",
  "it spend and team structure",
];
const DEFAULT_PEN_TEST_MAX_AGE_MONTHS = 12;

export type Severity = "critical" | "high" | "medium" | "low";
export type FindingStatus = "open" | "remediated" | "accepted" | "unknown";
export type SupportStatus = "supported" | "end-of-life" | "unknown";

export interface ComponentIn {
  name: string;
  kind?: string;
  version?: string;
  supportStatus?: SupportStatus;
  documentRef?: string;
}

export interface SecurityFindingIn {
  title: string;
  severity: Severity;
  status?: FindingStatus;
  documentRef?: string;
  evidenceGrade?: "A" | "B" | "C" | "U";
  remediation?: { low: number; high: number; basis?: string };
}

export interface CapacityTestIn {
  metric: string;
  currentPeak: number;
  capacity: number;
  /** The plan's own growth in this metric over the hold, in percent. */
  planGrowthPct: number;
  documentRef?: string;
}

export type TechIssueIn = Omit<IssueIn, "category"> & {
  category?: TechCategory;
};

export interface TechnologyDdInput {
  dealName?: string;
  documentsReceived?: string[];
  expectedDocuments?: string[];
  hosting?: string;
  components?: ComponentIn[];
  securityFindings?: SecurityFindingIn[];
  penTest?: { date?: string; documentRef?: string };
  /** Today's date (YYYY-MM-DD), to age the pen test. Without it, age is not tested. */
  asOf?: string;
  /** Default 12 months, labelled. */
  penTestMaxAgeMonths?: number;
  capacityTests?: CapacityTestIn[];
  /** Flag a capacity test as amber above this utilisation of the projected load. Absent = only a breach is flagged. */
  warnAbovePct?: number;
  keyPeople?: KeyPersonIn[];
  issues?: TechIssueIn[];
  categoriesReviewed?: TechCategory[];
  /** True if repository access was granted. This skill still does not read code. */
  repositoryAccess?: boolean;
  evidencePolicy?: {
    supportsPrice?: { A?: boolean; B?: boolean; C?: boolean };
  };
  gateOwner?: string;
}

export interface CapacityRow {
  metric: string;
  currentPeak: number;
  capacity: number;
  planGrowthPct: number;
  projected: number;
  utilisationPct: number;
  status: "breach" | "warn" | "within";
}

export interface TechnologyDdOutput {
  stack: {
    hosting: string | null;
    components: Array<{
      name: string;
      kind: string | null;
      version: string | null;
      supportStatus: SupportStatus;
      documentRef: string | null;
    }>;
    supportUnknown: string[];
  };
  penTest: {
    status: "none" | "current" | "stale" | "age-unknown";
    date: string | null;
    ageMonths: number | null;
    maxAgeMonths: number;
    maxAgeIsDefault: boolean;
  };
  capacity: CapacityRow[];
  issues: IssueOut[];
  counts: { red: number; amber: number; green: number };
  documentGaps: string[];
  categoriesNotReviewed: TechCategory[];
  uncited: string[];
  rangesDropped: string[];
  /** Plain sum of every cost range that states a basis; overlaps not netted. */
  rangeTotal: { low: number; high: number; issuesIncluded: number } | null;
  /** The part of those ranges whose evidence grade the firm's policy lets support a price. */
  priceSupportedRange: {
    low: number;
    high: number;
    issuesIncluded: number;
    excludedForEvidence: number;
  } | null;
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

function parseDate(
  s: string | undefined,
): { y: number; m: number; d: number } | null {
  if (typeof s !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const [y, m, d] = s.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y &&
    dt.getUTCMonth() === m - 1 &&
    dt.getUTCDate() === d
    ? { y, m, d }
    : null;
}
/** Whole months from a to b (b later). */
const monthsBetween = (
  a: { y: number; m: number; d: number },
  b: { y: number; m: number; d: number },
) => (b.y - a.y) * 12 + (b.m - a.m) - (b.d < a.d ? 1 : 0);

const run: SkillCore<TechnologyDdInput, TechnologyDdOutput> = (
  input,
): SkillCoreResult<TechnologyDdOutput> => {
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

  // ---- stack ----
  const components = (input.components ?? [])
    .filter((c) => c && clean(c.name))
    .map((c) => ({
      name: c.name.trim(),
      kind: clean(c.kind),
      version: clean(c.version),
      supportStatus: (c.supportStatus ?? "unknown") as SupportStatus,
      documentRef: clean(c.documentRef),
    }));
  const supportUnknown = components
    .filter((c) => c.supportStatus === "unknown")
    .map((c) => c.name);
  if (components.length === 0)
    missingData.push(
      "No stack described — components and hosting were not supplied",
    );
  if (supportUnknown.length)
    missingData.push(
      `Support status not stated for: ${supportUnknown.join(", ")}`,
    );
  for (const c of components) {
    if (c.supportStatus === "end-of-life") {
      derived.push({
        title: `End-of-life component: ${c.name}${c.version ? ` ${c.version}` : ""}`,
        rating: "amber",
        category: "infrastructure",
        documentRef: c.documentRef ?? undefined,
        evidenceGrade: "A",
        question:
          "What is the upgrade path, what does it cost, and is it in the plan?",
        derived: true,
      });
    }
  }

  // ---- pen test ----
  const maxAge =
    isNum(input.penTestMaxAgeMonths) && input.penTestMaxAgeMonths > 0
      ? input.penTestMaxAgeMonths
      : DEFAULT_PEN_TEST_MAX_AGE_MONTHS;
  const maxAgeIsDefault = !(
    isNum(input.penTestMaxAgeMonths) && input.penTestMaxAgeMonths > 0
  );
  if (maxAgeIsDefault)
    sources.push({
      label: "Pen test maximum age",
      kind: "assumption",
      value: `${DEFAULT_PEN_TEST_MAX_AGE_MONTHS} months`,
      ref: "no maximum age supplied",
    });
  const ptDate = parseDate(input.penTest?.date);
  const asOf = parseDate(input.asOf);
  let penTest: TechnologyDdOutput["penTest"];
  if (
    !input.penTest ||
    (!clean(input.penTest.date) && !clean(input.penTest.documentRef))
  ) {
    penTest = {
      status: "none",
      date: null,
      ageMonths: null,
      maxAgeMonths: maxAge,
      maxAgeIsDefault,
    };
    derived.push({
      title: "No penetration test report seen",
      rating: "amber",
      category: "security",
      evidenceGrade: "U",
      question:
        "Has an independent penetration test been done? Obtain the latest report and its remediation status.",
      derived: true,
    });
  } else if (ptDate && asOf) {
    const age = monthsBetween(ptDate, asOf);
    const stale = age > maxAge;
    penTest = {
      status: stale ? "stale" : "current",
      date: input.penTest.date as string,
      ageMonths: age,
      maxAgeMonths: maxAge,
      maxAgeIsDefault,
    };
    if (stale) {
      derived.push({
        title: `Penetration test is ${age} months old (limit ${maxAge})`,
        rating: "amber",
        category: "security",
        documentRef: clean(input.penTest.documentRef) ?? undefined,
        evidenceGrade: "A",
        question:
          "What has changed in the estate since this test? A fresh test may be needed before relying on it.",
        derived: true,
      });
    }
  } else {
    penTest = {
      status: "age-unknown",
      date: clean(input.penTest.date),
      ageMonths: null,
      maxAgeMonths: maxAge,
      maxAgeIsDefault,
    };
    missingData.push(
      ptDate
        ? "No as-of date supplied — the pen test's age was not tested"
        : "The pen test date is missing or not a valid YYYY-MM-DD date — its age was not tested",
    );
  }

  // ---- security findings: rating by stated rule ----
  for (const f of input.securityFindings ?? []) {
    const title = clean(f?.title);
    if (!title) continue;
    const status: FindingStatus = f.status ?? "unknown";
    const sev = f.severity;
    let rating: Rating =
      sev === "critical" || sev === "high"
        ? "red"
        : sev === "medium"
          ? "amber"
          : "green";
    if (status === "remediated") rating = "green";
    const suffix =
      status === "accepted"
        ? " (risk accepted by management)"
        : status === "unknown"
          ? " (status not stated; treated as open)"
          : status === "remediated"
            ? " (remediated)"
            : "";
    const rem = f.remediation;
    const doc = clean(f.documentRef) ?? undefined;
    derived.push({
      title: `Security: ${title}${suffix}`,
      rating,
      category: "security",
      documentRef: doc,
      evidenceGrade: f.evidenceGrade ?? (doc ? "A" : "U"),
      ...(rem && isNum(rem.low) && isNum(rem.high)
        ? { rangeLow: rem.low, rangeHigh: rem.high, rangeBasis: rem.basis }
        : {}),
      question:
        rating === "green"
          ? undefined
          : "Is this fixed, by when, and at what cost? Confirm the fix with a retest.",
      derived: true,
    });
  }

  // ---- capacity: the plan's own numbers ----
  const capacity: CapacityRow[] = [];
  for (const t of input.capacityTests ?? []) {
    if (
      !t ||
      !clean(t.metric) ||
      !isNum(t.currentPeak) ||
      !isNum(t.capacity) ||
      !isNum(t.planGrowthPct) ||
      t.capacity <= 0
    ) {
      if (t && clean(t.metric))
        missingData.push(
          `Capacity test "${t.metric}" needs a current peak, a capacity above zero and the plan's growth`,
        );
      continue;
    }
    const projected = r2(t.currentPeak * (1 + t.planGrowthPct / 100));
    const utilisationPct = r1((projected / t.capacity) * 100);
    const warn = isNum(input.warnAbovePct) ? input.warnAbovePct : null;
    const status: CapacityRow["status"] =
      projected > t.capacity
        ? "breach"
        : warn !== null && utilisationPct > warn
          ? "warn"
          : "within";
    capacity.push({
      metric: t.metric.trim(),
      currentPeak: t.currentPeak,
      capacity: t.capacity,
      planGrowthPct: t.planGrowthPct,
      projected,
      utilisationPct,
      status,
    });
    if (status !== "within") {
      derived.push({
        title: `${status === "breach" ? "Capacity breached under the plan" : "Capacity tight under the plan"}: ${t.metric.trim()} (projected ${projected} vs capacity ${t.capacity})`,
        rating: status === "breach" ? "red" : "amber",
        category: "scalability",
        documentRef: clean(t.documentRef) ?? undefined,
        evidenceGrade: "B",
        question:
          "What does it cost, and how long does it take, to scale this to the plan's volume?",
        derived: true,
      });
    }
  }

  // ---- key people ----
  for (const p of input.keyPeople ?? []) {
    const issue = keyPersonIssue(p, "people");
    if (issue) derived.push(issue);
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
      ref: "standing list of technology data room items",
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
  const categoriesNotReviewed = TECH_CATEGORIES.filter(
    (c) => c !== "other" && !reviewed.has(c),
  );
  if (!input.categoriesReviewed?.length)
    missingData.push(
      "No review coverage stated — none of the technology categories is shown as reviewed",
    );
  else if (categoriesNotReviewed.length)
    missingData.push(`Not reviewed: ${categoriesNotReviewed.join(", ")}`);
  if (ranked.uncited.length)
    missingData.push(
      `${ranked.uncited.length} risk${ranked.uncited.length === 1 ? "" : "s"} ${ranked.uncited.length === 1 ? "cites" : "cite"} no document or test and ${ranked.uncited.length === 1 ? "is" : "are"} graded U: ${ranked.uncited.join("; ")}`,
    );
  if (ranked.rangesDropped.length)
    missingData.push(
      `Cost range ignored for: ${ranked.rangesDropped.join("; ")}`,
    );

  // ---- cost ranges ----
  const withRange = ranked.issues.filter(
    (i) => i.range && i.rating !== "green",
  );
  const rangeTotal = withRange.length
    ? {
        low: r2(withRange.reduce((s, i) => s + (i.range?.low ?? 0), 0)),
        high: r2(withRange.reduce((s, i) => s + (i.range?.high ?? 0), 0)),
        issuesIncluded: withRange.length,
      }
    : null;
  const priced = withRange.filter((i) =>
    canSupportPrice(i.evidenceGrade, policy),
  );
  const priceSupportedRange = withRange.length
    ? {
        low: r2(priced.reduce((s, i) => s + (i.range?.low ?? 0), 0)),
        high: r2(priced.reduce((s, i) => s + (i.range?.high ?? 0), 0)),
        issuesIncluded: priced.length,
        excludedForEvidence: withRange.length - priced.length,
      }
    : null;
  if (rangeTotal)
    sources.push({
      label: "Sum of cost ranges with a stated basis",
      kind: "calculation",
      value: `${rangeTotal.low}–${rangeTotal.high}`,
      ref: "plain sum; overlaps not netted",
    });
  if (priceSupportedRange && priceSupportedRange.excludedForEvidence)
    sources.push({
      label: "Cost ranges excluded from price support",
      kind: "calculation",
      value: priceSupportedRange.excludedForEvidence,
      ref: "evidence grade cannot support a price under the policy",
    });

  for (const c of components)
    sources.push({
      label: `Component: ${c.name}`,
      kind: "fact",
      value: `${c.version ?? "version not stated"}, ${c.supportStatus}`,
      ref: c.documentRef ?? undefined,
    });
  const derivedCount = ranked.issues.filter((i) => i.derived).length;
  if (derivedCount)
    sources.push({
      label: "Risks derived from the stack, findings, capacity and people",
      kind: "calculation",
      value: derivedCount,
      ref: "stated rating rules",
    });

  const handoff = toRedFlagHandoff(ranked.issues, "technology");
  const gateOwner = input.gateOwner?.trim() || "A technical reviewer";
  const gate = `${gateOwner} confirms the risk ratings.`;
  const basisOfReview = input.repositoryAccess
    ? "Document review. Repository access was granted, but this skill does not read code: a code audit is still needed."
    : "Document review only: no repository access.";
  const limitation =
    "Without repository access and a technical reviewer this is a document review. It will not find what a code audit finds.";
  const { red, amber, green } = ranked.counts;
  const note =
    ranked.issues.length === 0
      ? "No technology risks were supplied or derived. That is not a clean bill: the list reflects only what was reviewed."
      : `${ranked.issues.length} technology risk${ranked.issues.length === 1 ? "" : "s"}: ${red} red, ${amber} amber, ${green} green${derivedCount ? ` (${derivedCount} derived by rule)` : ""}. ${penTest.status === "stale" ? `Pen test ${penTest.ageMonths} months old. ` : penTest.status === "none" ? "No pen test report seen. " : ""}${capacity.some((c) => c.status === "breach") ? "Capacity is breached under the plan. " : ""}${rangeTotal ? `Cost ranges with a basis sum to ${rangeTotal.low}–${rangeTotal.high}; ${priceSupportedRange?.issuesIncluded ?? 0} of ${rangeTotal.issuesIncluded} can support a price${evidencePolicyIsDefault ? " (default evidence policy)" : ""}. ` : "No cost range is supported by a stated basis. "}${ranked.uncited.length ? `${ranked.uncited.length} ${ranked.uncited.length === 1 ? "cites" : "cite"} no document or test. ` : ""}`.trim();

  const structured: TechnologyDdOutput = {
    stack: { hosting: clean(input.hosting), components, supportUnknown },
    penTest,
    capacity,
    issues: ranked.issues,
    counts: ranked.counts,
    documentGaps: gaps,
    categoriesNotReviewed,
    uncited: ranked.uncited,
    rangesDropped: ranked.rangesDropped,
    rangeTotal,
    priceSupportedRange,
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
    ((components.length ? 1 : 0) +
      (input.documentsReceived !== undefined ? 1 : 0) +
      (input.categoriesReviewed?.length ? 1 : 0) +
      (penTest.status === "current" || penTest.status === "stale" ? 1 : 0)) /
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
const techCategory: JsonSchema = { type: "string", enum: [...TECH_CATEGORIES] };
const reviewedCategory: JsonSchema = {
  type: "string",
  enum: TECH_CATEGORIES.filter((c) => c !== "other"),
};
const techIssueSchema: JsonSchema = {
  ...issueInSchema,
  properties: {
    ...(issueInSchema.properties as Record<string, JsonSchema>),
    category: techCategory,
  },
};
const grade: JsonSchema = { type: "string", enum: ["A", "B", "C", "U"] };

const inputSchema: JsonSchema = {
  type: "object",
  properties: {
    dealName: { type: "string" },
    documentsReceived: strList,
    expectedDocuments: strList,
    hosting: { type: "string" },
    components: {
      type: "array",
      items: {
        type: "object",
        required: ["name"],
        properties: {
          name: { type: "string" },
          kind: { type: "string" },
          version: { type: "string" },
          supportStatus: {
            type: "string",
            enum: ["supported", "end-of-life", "unknown"],
          },
          documentRef: { type: "string" },
        },
      },
    },
    securityFindings: {
      type: "array",
      items: {
        type: "object",
        required: ["title", "severity"],
        properties: {
          title: { type: "string" },
          severity: {
            type: "string",
            enum: ["critical", "high", "medium", "low"],
          },
          status: {
            type: "string",
            enum: ["open", "remediated", "accepted", "unknown"],
          },
          documentRef: { type: "string" },
          evidenceGrade: grade,
          remediation: {
            type: "object",
            required: ["low", "high"],
            properties: {
              low: { type: "number", minimum: 0 },
              high: { type: "number", minimum: 0 },
              basis: { type: "string" },
            },
          },
        },
      },
    },
    penTest: {
      type: "object",
      properties: { date: { type: "string" }, documentRef: { type: "string" } },
    },
    asOf: { type: "string" },
    penTestMaxAgeMonths: { type: "number", minimum: 0 },
    capacityTests: {
      type: "array",
      items: {
        type: "object",
        required: ["metric", "currentPeak", "capacity", "planGrowthPct"],
        properties: {
          metric: { type: "string" },
          currentPeak: { type: "number", minimum: 0 },
          capacity: { type: "number", minimum: 0 },
          planGrowthPct: { type: "number" },
          documentRef: { type: "string" },
        },
      },
    },
    warnAbovePct: { type: "number", minimum: 0 },
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
    issues: { type: "array", items: techIssueSchema },
    categoriesReviewed: { type: "array", items: reviewedCategory },
    repositoryAccess: { type: "boolean" },
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

const outputSchema: JsonSchema = {
  type: "object",
  required: [
    "stack",
    "penTest",
    "capacity",
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
    stack: {
      type: "object",
      required: ["components", "supportUnknown"],
      properties: { components: { type: "array" }, supportUnknown: strList },
    },
    penTest: {
      type: "object",
      required: ["status", "maxAgeMonths", "maxAgeIsDefault"],
      properties: {
        status: {
          type: "string",
          enum: ["none", "current", "stale", "age-unknown"],
        },
        maxAgeMonths: { type: "number" },
        maxAgeIsDefault: { type: "boolean" },
      },
    },
    capacity: {
      type: "array",
      items: {
        type: "object",
        required: ["metric", "projected", "utilisationPct", "status"],
        properties: {
          metric: { type: "string" },
          projected: { type: "number" },
          utilisationPct: { type: "number" },
          status: { type: "string", enum: ["breach", "warn", "within"] },
        },
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
    rangeTotal: {
      type: "object",
      required: ["low", "high", "issuesIncluded"],
      properties: {
        low: { type: "number" },
        high: { type: "number" },
        issuesIncluded: { type: "number" },
      },
    },
    priceSupportedRange: {
      type: "object",
      required: ["low", "high", "issuesIncluded", "excludedForEvidence"],
      properties: {
        low: { type: "number" },
        high: { type: "number" },
        issuesIncluded: { type: "number" },
        excludedForEvidence: { type: "number" },
      },
    },
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

export const technologyDdManifest: SkillManifest = {
  id: "technology-dd",
  name: "Technology DD Issues List",
  version: "1.0.0",
  owner: "fundexecs",
  hub: "run",
  applicableExecutives: ["diligence", "analyst"],
  supportedEntityTypes: ["deal"],
  requiredInputs: [],
  optionalInputs: [
    "documentsReceived",
    "expectedDocuments",
    "hosting",
    "components",
    "securityFindings",
    "penTest",
    "asOf",
    "penTestMaxAgeMonths",
    "capacityTests",
    "warnAbovePct",
    "keyPeople",
    "issues",
    "categoriesReviewed",
    "repositoryAccess",
    "evidencePolicy",
    "gateOwner",
  ],
  outputs: [
    "stack",
    "penTest",
    "capacity",
    "issues",
    "rangeTotal",
    "priceSupportedRange",
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
    "every risk cites a document or test or is graded U",
    "no cost range without a stated basis",
    "capacity test uses the plan's own growth",
  ],
  evaluationCriteria: [
    "uncited risks flagged",
    "cost ranges dropped without a basis",
    "price-supported part of the range stated",
    "states it is a document review",
    "technical reviewer named as the gate",
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

export const technologyDd: SkillDefinition<
  TechnologyDdInput,
  TechnologyDdOutput
> = { manifest: technologyDdManifest, run };
