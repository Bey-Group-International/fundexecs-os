// lib/skills/catalog/capital-call.ts
// Native skill: PREPARE a capital call notice DRAFT for an investor. Pure,
// deterministic core — the tested execution path.
//
// This skill only PREPARES a draft notice. It NEVER moves capital and NEVER
// sends anything. Issuing a capital call is a Tier-3, compliance-/capital-binding
// action reserved for a human operator — it is a prohibited action here. Bank /
// wiring details are NEVER fabricated: the wiring section is always an OPEN item,
// a placeholder that only the fund admin may populate. A missing input becomes an
// open item / flagged field — never an invented figure.

import type { JsonSchema, SkillCore, SkillCoreResult, SkillDefinition, SkillManifest, SkillSource } from "@/lib/skills/types";

// ---------------------------------------------------------------------------
// I/O types
// ---------------------------------------------------------------------------

export interface CapitalCallInput {
  fundName: string;
  investorName?: string;
  callNumber?: number;
  /** Percentage of committed capital being called, 0–100. */
  callPercent?: number;
  totalCommitment?: number;
  /** Explicit amount; when absent it is derived from commitment × percent. */
  callAmount?: number;
  dueDate?: string;
  purpose?: string;
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

export interface CapitalCallOutput {
  /** The amount called — provided, derived (calculation), or null when neither. */
  callAmount: number | null;
  noticeDraft: NoticeDraft;
  sections: NoticeSection[];
  missingFields: string[];
  openItems: string[];
  recommendedAction: string;
}

// ---------------------------------------------------------------------------
// Deterministic core
// ---------------------------------------------------------------------------

/** Wiring is NEVER auto-populated — this placeholder is the only permitted body. */
const WIRING_PLACEHOLDER =
  "Placeholder — wiring details must be supplied by fund admin; never auto-populated.";
const DUE_DATE_PENDING = "Pending — confirm due date";

const round2 = (n: number): number => Math.round(n * 100) / 100;
const clean = (s: string | undefined): string => (s ?? "").trim();

const run: SkillCore<CapitalCallInput, CapitalCallOutput> = (input): SkillCoreResult<CapitalCallOutput> => {
  const fundName = clean(input.fundName);
  const investorName = clean(input.investorName);
  const purpose = clean(input.purpose);
  const dueDate = clean(input.dueDate);
  const { callNumber, callPercent, totalCommitment } = input;

  const sources: SkillSource[] = [];
  const openItems: string[] = [];
  const missingFields: string[] = [];
  const sections: NoticeSection[] = [];

  const add = (heading: string, body: string, status: NoticeSectionStatus): void => {
    sections.push({ heading, body, status });
  };

  // Provided data is recorded as FACTS — never fabricated.
  sources.push({ label: "Fund name", kind: "fact", value: fundName });
  if (investorName) sources.push({ label: "Investor name", kind: "fact", value: investorName });
  if (callNumber != null) sources.push({ label: "Call number", kind: "fact", value: callNumber });
  if (totalCommitment != null) sources.push({ label: "Total commitment", kind: "fact", value: totalCommitment });
  if (callPercent != null) sources.push({ label: "Call percent", kind: "fact", value: callPercent });

  // Core amount: provided (fact), else derived from commitment × percent
  // (calculation), else null. The amount is NEVER invented from nothing.
  let callAmount: number | null;
  if (input.callAmount != null) {
    callAmount = input.callAmount;
    sources.push({ label: "Call amount", kind: "fact", value: callAmount });
  } else if (totalCommitment != null && callPercent != null) {
    callAmount = round2((totalCommitment * callPercent) / 100);
    sources.push({
      label: "Call amount",
      kind: "calculation",
      value: callAmount,
      ref: "totalCommitment × callPercent ÷ 100",
    });
  } else {
    callAmount = null;
  }

  // 1. Header — fund + investor + call number. fundName is required, so complete.
  const headerBody =
    `Capital Call Notice — ${fundName}` +
    `${callNumber != null ? ` (Call No. ${callNumber})` : ""}` +
    `${investorName ? ` — ${investorName}` : ""}`;
  add("Header", headerBody, "complete");

  // 2. Amount Due — the called amount, or an open item when it cannot be formed.
  //    REQUIRE fundName AND (callAmount OR (totalCommitment AND callPercent)).
  if (callAmount != null) {
    add("Amount Due", `Amount due: ${callAmount}.`, "complete");
  } else {
    add(
      "Amount Due",
      "Pending — provide callAmount, or both totalCommitment and callPercent so it can be derived.",
      "open",
    );
    missingFields.push("Call amount (callAmount, or both totalCommitment and callPercent)");
    openItems.push("Amount due pending — provide callAmount, or both totalCommitment and callPercent.");
  }

  // 3. Due Date — provided, else open. Never guessed.
  if (dueDate) {
    add("Due Date", `Due date: ${dueDate}.`, "complete");
  } else {
    add("Due Date", DUE_DATE_PENDING, "open");
    openItems.push("Due date pending — confirm due date.");
  }

  // 4. Purpose — provided, else open.
  if (purpose) {
    add("Purpose", purpose, "complete");
  } else {
    add("Purpose", "Pending — state the purpose of the call.", "open");
    openItems.push("Purpose pending — state the purpose of the call.");
  }

  // 5. Wiring Instructions — ALWAYS open. Wiring is never auto-populated; only the
  //    fund admin may supply it. This is the core anti-fabrication guardrail.
  add("Wiring Instructions", WIRING_PLACEHOLDER, "open");
  openItems.push("Wiring instructions pending — must be supplied by fund admin; never auto-populated.");
  sources.push({ label: "Wiring instructions", kind: "generated", value: "placeholder — fund admin must supply" });

  // The DRAFT is assembled ONLY from the complete sections; the open Wiring
  // placeholder is therefore never woven into the notice body.
  const completeSections = sections.filter((s) => s.status === "complete");
  const noticeDraft: NoticeDraft = {
    heading: headerBody,
    body: completeSections
      .filter((s) => s.heading !== "Header")
      .map((s) => `${s.heading}: ${s.body}`)
      .join("\n"),
  };

  const missingSections = sections.filter((s) => s.status === "open").map((s) => s.heading);
  const completeness = Math.round((completeSections.length / sections.length) * 100) / 100;

  const recommendedAction =
    "DRAFT capital call notice prepared for operator review only. Preparing a notice never moves capital " +
    "and never sends anything — issuing the capital call is a Tier-3 action that requires explicit human " +
    "authorization. Have the fund admin supply the wiring instructions and resolve all open items before any " +
    "notice is issued.";

  const structured: CapitalCallOutput = {
    callAmount,
    noticeDraft,
    sections,
    missingFields,
    openItems,
    recommendedAction,
  };

  const confidence = Math.max(0.2, Math.min(0.9, 0.3 + completeness * 0.6));

  const narrative =
    `Capital call notice DRAFT for ${fundName}${investorName ? ` / ${investorName}` : ""} assembled: ` +
    `${completeSections.length}/${sections.length} sections complete` +
    `${missingSections.length ? `, ${missingSections.length} open (${missingSections.join(", ")})` : ""}. ` +
    `${callAmount != null ? `Amount due: ${callAmount}. ` : "Amount not yet determinable. "}` +
    `This PREPARES a draft only — it never moves capital and never sends. Issuing the call requires human ` +
    `authorization (Tier 3); wiring details are never auto-populated.`;

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
    callNumber: { type: "integer", minimum: 1 },
    callPercent: { type: "number", minimum: 0, maximum: 100 },
    totalCommitment: { type: "number", minimum: 0 },
    callAmount: { type: "number", minimum: 0 },
    dueDate: { type: "string" },
    purpose: { type: "string" },
  },
};

const outputSchema: JsonSchema = {
  type: "object",
  required: ["noticeDraft", "sections", "missingFields", "openItems", "recommendedAction"],
  properties: {
    callAmount: { type: "number", minimum: 0 },
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

export const capitalCallManifest: SkillManifest = {
  id: "capital-call",
  name: "Capital Call Notice",
  version: "1.0.0",
  owner: "fundexecs",
  hub: "execute",
  applicableExecutives: ["investor_relations"],
  supportedEntityTypes: ["fund", "investor", "capital_activity"],
  requiredInputs: ["fundName"],
  optionalInputs: ["investorName", "callNumber", "callPercent", "totalCommitment", "callAmount", "dueDate", "purpose"],
  outputs: ["callAmount", "noticeDraft", "sections", "missingFields", "openItems", "recommendedAction"],
  artifactTypes: ["memo"],
  dataPermissions: ["fund:read", "investor:read"],
  tools: [],
  approvalTier: 1,
  riskClassification: "moderate",
  executionTimeoutMs: 15_000,
  retryPolicy: { maxAttempts: 1, backoffMs: 0 },
  validationRules: [
    "input matches input.schema.json",
    "output matches output.schema.json",
    "prepares a DRAFT only — never moves capital and never sends",
    "wiring / bank details are never auto-populated — always an open item",
    "a missing input becomes an open item, never a fabricated figure",
  ],
  evaluationCriteria: [
    "call amount derived correctly, or flagged when not determinable",
    "wiring instructions are ALWAYS an open placeholder, never fabricated",
    "the notice is a preliminary draft for operator review, never sent",
    "issuing the call is a Tier-3 action requiring human authorization",
    "facts, calculations, and generated placeholders separated in sources",
  ],
  providerCapabilities: ["structured_extraction"],
  allowedDownstreamSkills: [],
  prohibitedActions: ["capital_call", "move_capital", "distribute_report", "send_reply", "sign_document"],
  inputSchema,
  outputSchema,
};

export const capitalCall: SkillDefinition<CapitalCallInput, CapitalCallOutput> = {
  manifest: capitalCallManifest,
  run,
};
