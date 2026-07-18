// lib/skills/catalog/distribution-notice.ts
// Native skill: PREPARE a distribution notice DRAFT for an investor from
// ALREADY-STRUCTURED distribution data. Pure, deterministic core — the tested
// execution path.
//
// This skill PREPARES a draft only. It NEVER moves capital and NEVER sends the
// notice — releasing funds or transmitting the notice is a human decision
// (Tier-3 / Tier-2). Amounts, dates, and bank details are NEVER fabricated: a
// missing input becomes an OPEN ITEM, never an invented figure.

import type { JsonSchema, SkillCore, SkillCoreResult, SkillDefinition, SkillManifest, SkillSource } from "@/lib/skills/types";

// ---------------------------------------------------------------------------
// I/O types
// ---------------------------------------------------------------------------

export type DistributionType = "return_of_capital" | "profit" | "dividend";

export interface DistributionNoticeInput {
  fundName: string;
  investorName?: string;
  distributionNumber?: number;
  distributionAmount?: number;
  distributionType?: DistributionType;
  recordDate?: string;
  paymentDate?: string;
  sourceProceeds?: string;
}

export type NoticeSectionStatus = "complete" | "open";

export interface NoticeSection {
  heading: string;
  body: string;
  status: NoticeSectionStatus;
}

export interface NoticeDraft {
  heading: string;
  body: string;
}

export interface DistributionNoticeOutput {
  noticeDraft: NoticeDraft;
  sections: NoticeSection[];
  missingFields: string[];
  openItems: string[];
  recommendedAction: string;
}

// ---------------------------------------------------------------------------
// Deterministic core
// ---------------------------------------------------------------------------

const clean = (s: string | undefined): string => (s ?? "").trim();

/** Human-readable label for a distribution type — a fixed, generated mapping. */
const TYPE_LABEL: Record<DistributionType, string> = {
  return_of_capital: "Return of capital",
  profit: "Profit distribution",
  dividend: "Dividend",
};

const run: SkillCore<DistributionNoticeInput, DistributionNoticeOutput> = (input): SkillCoreResult<DistributionNoticeOutput> => {
  const { fundName, investorName, distributionNumber, distributionAmount, distributionType, recordDate, paymentDate, sourceProceeds } = input;
  const sources: SkillSource[] = [];
  const sections: NoticeSection[] = [];

  const add = (heading: string, body: string, status: NoticeSectionStatus): void => {
    sections.push({ heading, body, status });
  };

  // Required core inputs — the notice cannot be a real draft without them.
  // A missing required input is FLAGGED, never invented.
  const missingFields: string[] = [];
  if (clean(fundName) === "") missingFields.push("fundName");
  if (distributionAmount == null) missingFields.push("distributionAmount");

  // Provided figures are recorded as FACTS; nothing is fabricated.
  if (clean(fundName) !== "") sources.push({ label: "Fund name", kind: "fact", value: clean(fundName) });
  if (clean(investorName) !== "") sources.push({ label: "Investor name", kind: "fact", value: clean(investorName) });
  if (distributionNumber != null) sources.push({ label: "Distribution number", kind: "fact", value: distributionNumber });
  if (distributionAmount != null) sources.push({ label: "Distribution amount", kind: "fact", value: distributionAmount });
  if (distributionType != null) sources.push({ label: "Distribution type", kind: "fact", value: distributionType });
  if (clean(recordDate) !== "") sources.push({ label: "Record date", kind: "fact", value: clean(recordDate) });
  if (clean(paymentDate) !== "") sources.push({ label: "Payment date", kind: "fact", value: clean(paymentDate) });
  if (clean(sourceProceeds) !== "") sources.push({ label: "Source of proceeds", kind: "fact", value: clean(sourceProceeds) });

  // 1. Header — fund + investor + distribution number.
  const headerParts: string[] = [];
  headerParts.push(clean(fundName) !== "" ? `Fund: ${clean(fundName)}` : "Fund: not specified");
  headerParts.push(clean(investorName) !== "" ? `Investor: ${clean(investorName)}` : "Investor: not specified");
  headerParts.push(distributionNumber != null ? `Distribution No.: ${distributionNumber}` : "Distribution No.: not specified");
  add("Header", headerParts.join(" · "), clean(fundName) !== "" ? "complete" : "open");

  // 2. Amount — the provided amount, else an open item. NEVER fabricated.
  if (distributionAmount != null) {
    add("Amount", `Distribution amount: ${distributionAmount}. Figure as supplied; confirm against the fund's distribution schedule before release.`, "complete");
  } else {
    add("Amount", "Open — distribution amount not provided. No amount is asserted without a source.", "open");
  }

  // 3. Type — the classification, else an open item.
  if (distributionType != null) {
    add("Type", `${TYPE_LABEL[distributionType]} (${distributionType}).`, "complete");
  } else {
    add("Type", "Pending — confirm classification (return of capital, profit, or dividend).", "open");
  }

  // 4. Record Date — provided, else open. NEVER fabricated.
  if (clean(recordDate) !== "") {
    add("Record Date", `Record date: ${clean(recordDate)}.`, "complete");
  } else {
    add("Record Date", "Open — record date not provided. No date is asserted without a source.", "open");
  }

  // 5. Payment Date — provided, else open. NEVER fabricated.
  if (clean(paymentDate) !== "") {
    add("Payment Date", `Payment date: ${clean(paymentDate)}.`, "complete");
  } else {
    add("Payment Date", "Open — payment date not provided. No date is asserted without a source.", "open");
  }

  // 6. Source of Proceeds — provided, else open.
  if (clean(sourceProceeds) !== "") {
    add("Source of Proceeds", clean(sourceProceeds), "complete");
  } else {
    add("Source of Proceeds", "Open — source of proceeds not provided.", "open");
  }

  // Open items — the headings of every section that could not be completed.
  const openItems = sections.filter((s) => s.status === "open").map((s) => s.heading);

  // Notice draft — assembled ONLY from the complete sections. The heading names
  // the fund; the body is the complete sections, each as "Heading: body".
  const completeSections = sections.filter((s) => s.status === "complete");
  const draftHeading = `DRAFT Distribution Notice — ${clean(fundName) !== "" ? clean(fundName) : "(fund name pending)"}`;
  const draftBody = completeSections.map((s) => `${s.heading}: ${s.body}`).join("\n");
  const noticeDraft: NoticeDraft = { heading: draftHeading, body: draftBody };
  sources.push({ label: "Notice draft", kind: "generated", value: draftHeading });

  const completeness = Math.round((completeSections.length / sections.length) * 100) / 100;

  // Recommended action — always stresses this is a DRAFT for operator review, and
  // that capital movement / sending is a human (Tier-3 / Tier-2) decision.
  const recommendedAction =
    missingFields.length > 0
      ? `Do NOT release or send. This is a DRAFT for operator review only — required data is missing (${missingFields.join(", ")}). Supply the missing inputs and re-run before any human authorises payment. Moving capital is a Tier-3 human decision this skill never performs.`
      : `DRAFT prepared for operator review only. This skill NEVER moves capital and NEVER sends the notice — releasing funds is a Tier-3 human decision and transmitting the notice is a Tier-2 human decision.${openItems.length > 0 ? ` Resolve open items first: ${openItems.join(", ")}.` : ""}`;

  const structured: DistributionNoticeOutput = {
    noticeDraft,
    sections,
    missingFields,
    openItems,
    recommendedAction,
  };

  const confidence = Math.max(0.2, Math.min(0.9, 0.3 + completeness * 0.6));

  const narrative =
    `DRAFT distribution notice for ${clean(fundName) !== "" ? clean(fundName) : "(fund name pending)"} assembled: ` +
    `${completeSections.length}/${sections.length} sections complete` +
    `${openItems.length ? `, ${openItems.length} open (${openItems.join(", ")})` : ""}. ` +
    `${missingFields.length ? `Missing required: ${missingFields.join(", ")}. ` : ""}` +
    `This prepares a draft for operator review; it never moves capital and never sends the notice.`;

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
    investorName: { type: "string" },
    distributionNumber: { type: "number", minimum: 0 },
    distributionAmount: { type: "number", minimum: 0 },
    distributionType: { type: "string", enum: ["return_of_capital", "profit", "dividend"] },
    recordDate: { type: "string" },
    paymentDate: { type: "string" },
    sourceProceeds: { type: "string" },
  },
};

const outputSchema: JsonSchema = {
  type: "object",
  required: ["noticeDraft", "sections", "missingFields", "openItems", "recommendedAction"],
  properties: {
    noticeDraft: {
      type: "object",
      required: ["heading", "body"],
      properties: {
        heading: { type: "string" },
        body: { type: "string" },
      },
    },
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
    missingFields: { type: "array", items: { type: "string" } },
    openItems: { type: "array", items: { type: "string" } },
    recommendedAction: { type: "string" },
  },
};

export const distributionNoticeManifest: SkillManifest = {
  id: "distribution-notice",
  name: "Distribution Notice",
  version: "1.0.0",
  owner: "fundexecs",
  hub: "execute",
  applicableExecutives: ["investor_relations"],
  supportedEntityTypes: ["fund", "investor", "distribution"],
  requiredInputs: ["fundName", "distributionAmount"],
  optionalInputs: ["investorName", "distributionNumber", "distributionType", "recordDate", "paymentDate", "sourceProceeds"],
  outputs: ["noticeDraft", "sections", "missingFields", "openItems", "recommendedAction"],
  artifactTypes: ["memo"],
  dataPermissions: ["fund:read", "investor:read", "distribution:read"],
  tools: [],
  approvalTier: 1,
  riskClassification: "moderate",
  executionTimeoutMs: 15_000,
  retryPolicy: { maxAttempts: 1, backoffMs: 0 },
  validationRules: [
    "input matches input.schema.json",
    "output matches output.schema.json",
    "no fabricated amounts, dates, or bank details — a missing input becomes an open item",
  ],
  evaluationCriteria: [
    "prepares a DRAFT notice only — never moves capital, never sends",
    "requires fundName and distributionAmount, else flags them missing",
    "sections assembled in order with correct complete/open status",
    "amounts and dates never fabricated — missing inputs become open items",
  ],
  providerCapabilities: ["structured_extraction"],
  allowedDownstreamSkills: [],
  prohibitedActions: ["move_capital", "distribute_report", "send_reply", "sign_document"],
  inputSchema,
  outputSchema,
};

export const distributionNotice: SkillDefinition<DistributionNoticeInput, DistributionNoticeOutput> = {
  manifest: distributionNoticeManifest,
  run,
};
