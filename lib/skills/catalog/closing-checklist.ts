// lib/skills/catalog/closing-checklist.ts
// Native skill: produce a canonical closing-readiness checklist for a deal by
// merging a fixed set of standard closing tasks / conditions-precedent with the
// caller's SUPPLIED completion status, and compute a readiness %. Pure,
// deterministic core — the tested execution path. It PREPARES readiness for a
// human to review. It NEVER marks the deal closed, signs, or executes: closing
// and signing are Tier-3 human actions, prohibited here. Every supplied completion
// fact is a `fact` source; the readiness % is a `calculation`. Nothing is invented.

import type { JsonSchema, SkillCore, SkillCoreResult, SkillDefinition, SkillManifest, SkillSource } from "@/lib/skills/types";

// ---------------------------------------------------------------------------
// I/O types
// ---------------------------------------------------------------------------

export interface ClosingDeal {
  name: string;
  type?: string; // e.g. "acquisition", "secondary", "primary_raise"
}

export interface ConditionPrecedentInput {
  label: string;
  satisfied?: boolean;
  blocking?: boolean;
}

export interface ClosingChecklistInput {
  deal: ClosingDeal;
  completedItems?: string[];
  conditionsPrecedent?: ConditionPrecedentInput[];
}

export type ChecklistStatus = "done" | "open";

export interface ChecklistItem {
  key: string;
  label: string;
  category: string;
  status: ChecklistStatus;
}

export interface ClosingChecklistOutput {
  items: ChecklistItem[];
  readinessPct: number;
  openItems: string[];
  blockingItems: string[];
  totalItems: number;
  doneItems: number;
  recommendedAction: string;
  missingContext: string[];
}

// ---------------------------------------------------------------------------
// Canonical closing checklist — the fixed set of standard closing tasks /
// conditions-precedent every deal is measured against. `critical` items that are
// still open surface as blocking items (a close should not be scheduled over them).
// ---------------------------------------------------------------------------

interface CanonicalTask {
  key: string;
  label: string;
  category: string;
  critical: boolean;
}

const CANONICAL_TASKS: CanonicalTask[] = [
  { key: "purchase_agreement_executed", label: "Signed purchase agreement / subscription documents executed", category: "documents", critical: true },
  { key: "funds_flow_confirmed", label: "Funds flow memo confirmed", category: "capital", critical: false },
  { key: "kyc_aml_cleared", label: "KYC / AML cleared", category: "compliance", critical: true },
  { key: "board_ic_approvals_recorded", label: "Board & IC approvals recorded", category: "governance", critical: false },
  { key: "disclosure_schedules_finalized", label: "Disclosure schedules finalized", category: "documents", critical: false },
  { key: "closing_conditions_satisfied", label: "Closing conditions satisfied", category: "conditions", critical: true },
  { key: "legal_opinions_delivered", label: "Legal opinions delivered", category: "legal", critical: false },
  { key: "post_closing_filings_prepared", label: "Post-closing filings prepared", category: "filings", critical: false },
];

const lc = (s: string) => s.toLowerCase().trim();

/** Slug a CP label into a stable-ish key, prefixed so it never collides with a canonical key. */
function cpKey(label: string): string {
  const slug = lc(label).replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  return `cp_${slug || "unlabeled"}`;
}

// ---------------------------------------------------------------------------
// Deterministic core
// ---------------------------------------------------------------------------

const run: SkillCore<ClosingChecklistInput, ClosingChecklistOutput> = (input): SkillCoreResult<ClosingChecklistOutput> => {
  const deal = input.deal ?? { name: "" };
  const completedItems = input.completedItems ?? [];
  const conditionsPrecedent = input.conditionsPrecedent ?? [];
  const sources: SkillSource[] = [];
  const missingContext: string[] = [];

  // A canonical task is "done" only when the caller REPORTS it done — its key or
  // label appears in completedItems (case-insensitive). Nothing is assumed done.
  const reportedDone = (key: string, label: string): boolean =>
    completedItems.some((ci) => {
      const l = lc(ci);
      if (!l) return false;
      return l === lc(key) || l === lc(label) || lc(label).includes(l) || lc(key) === l;
    });

  const items: ChecklistItem[] = [];
  const openItems: string[] = [];
  const blockingItems: string[] = [];
  let suppliedStatusCount = 0;

  // 1) Canonical closing tasks, merged with SUPPLIED completion status.
  for (const task of CANONICAL_TASKS) {
    const done = reportedDone(task.key, task.label);
    const status: ChecklistStatus = done ? "done" : "open";
    if (done) {
      suppliedStatusCount += 1;
      // A supplied completion fact — labelled `fact`, never a calculation.
      sources.push({ label: `${task.label} — reported complete`, kind: "fact", value: "done" });
    } else {
      openItems.push(task.label);
      // An open CRITICAL task blocks scheduling a close.
      if (task.critical) blockingItems.push(task.label);
    }
    items.push({ key: task.key, label: task.label, category: task.category, status });
  }

  // 2) Caller-supplied conditions precedent, merged into the same list. The
  //    `blocking` flag is preserved: a blocking CP that is not satisfied is a
  //    blocking item that must be resolved before close.
  for (const cp of conditionsPrecedent) {
    const label = cp.label;
    const satisfied = cp.satisfied === true;
    const status: ChecklistStatus = satisfied ? "done" : "open";
    // The caller supplied this CP's satisfaction state — a `fact`.
    if (cp.satisfied !== undefined) {
      suppliedStatusCount += 1;
      sources.push({ label: `CP: ${label} — satisfied`, kind: "fact", value: satisfied ? "true" : "false" });
    }
    if (!satisfied) {
      openItems.push(label);
      if (cp.blocking === true) blockingItems.push(label);
    }
    items.push({ key: cpKey(label), label, category: "condition_precedent", status });
  }

  const totalItems = items.length;
  const doneItems = items.filter((i) => i.status === "done").length;

  // readinessPct is a CALCULATION, never a fact.
  const readinessPct = totalItems ? Math.round((doneItems / totalItems) * 100) : 0;
  sources.push({ label: "Closing readiness", kind: "calculation", value: readinessPct, ref: "done / total * 100" });

  // Missing-context notes — surfaced, never silently assumed.
  if (!deal.type) missingContext.push("Deal type not supplied — canonical closing checklist applied without deal-type tailoring.");
  if (completedItems.length === 0 && conditionsPrecedent.length === 0) {
    missingContext.push("No completion status supplied — every standard closing item is treated as open until reported.");
  }
  if (conditionsPrecedent.length === 0) {
    missingContext.push("No conditions precedent supplied — only the canonical closing checklist was assessed.");
  }

  // Recommended next action — closing/signing is ALWAYS a human, Tier-3 action.
  let recommendedAction: string;
  if (blockingItems.length > 0) {
    recommendedAction = `Resolve ${blockingItems.length} blocking item(s) before scheduling close`;
  } else if (openItems.length > 0) {
    recommendedAction = `Complete remaining ${openItems.length} item(s); closing/signing remains a human, Tier-3 action`;
  } else {
    recommendedAction = "All tracked items complete — route to a human for final closing authorization (never auto-close).";
  }

  const completeness = totalItems ? Math.round((suppliedStatusCount / totalItems) * 100) / 100 : 0;
  const confidence = Math.max(0.2, Math.min(0.95, 0.4 + completeness * 0.5));

  const narrative =
    `Closing readiness for ${deal.name || "the deal"}: ${readinessPct}% (${doneItems}/${totalItems} tracked items complete). ` +
    `${blockingItems.length ? `${blockingItems.length} blocking item(s) outstanding. ` : ""}` +
    `${openItems.length ? `${openItems.length} item(s) still open. ` : "All tracked items complete. "}` +
    `Next: ${recommendedAction}. Closing and signing remain a human, Tier-3 action — this skill prepares readiness for review, it never closes or signs.`;

  const structured: ClosingChecklistOutput = {
    items,
    readinessPct,
    openItems,
    blockingItems,
    totalItems,
    doneItems,
    recommendedAction,
    missingContext,
  };

  return { structured, narrative, sources, confidence, completeness, missingData: [...missingContext] };
};

// ---------------------------------------------------------------------------
// Schemas + manifest
// ---------------------------------------------------------------------------

const inputSchema: JsonSchema = {
  type: "object",
  required: ["deal"],
  properties: {
    deal: {
      type: "object",
      required: ["name"],
      properties: {
        name: { type: "string", minLength: 1 },
        type: { type: "string" },
      },
    },
    completedItems: {
      type: "array",
      items: { type: "string" },
    },
    conditionsPrecedent: {
      type: "array",
      items: {
        type: "object",
        required: ["label"],
        properties: {
          label: { type: "string", minLength: 1 },
          satisfied: { type: "boolean" },
          blocking: { type: "boolean" },
        },
      },
    },
  },
};

const outputSchema: JsonSchema = {
  type: "object",
  required: ["items", "readinessPct", "openItems", "blockingItems", "totalItems", "doneItems", "recommendedAction"],
  properties: {
    items: {
      type: "array",
      items: {
        type: "object",
        required: ["key", "label", "category", "status"],
        properties: {
          key: { type: "string" },
          label: { type: "string" },
          category: { type: "string" },
          status: { type: "string", enum: ["done", "open"] },
        },
      },
    },
    readinessPct: { type: "number", minimum: 0, maximum: 100 },
    openItems: { type: "array", items: { type: "string" } },
    blockingItems: { type: "array", items: { type: "string" } },
    totalItems: { type: "number", minimum: 0 },
    doneItems: { type: "number", minimum: 0 },
    recommendedAction: { type: "string" },
    missingContext: { type: "array", items: { type: "string" } },
  },
};

export const closingChecklistManifest: SkillManifest = {
  id: "closing-checklist",
  name: "Closing Checklist",
  version: "1.0.0",
  owner: "fundexecs",
  hub: "execute",
  applicableExecutives: ["legal_closing"],
  supportedEntityTypes: ["deal"],
  requiredInputs: ["deal"],
  optionalInputs: ["completedItems", "conditionsPrecedent"],
  outputs: ["items", "readinessPct", "openItems", "blockingItems", "totalItems", "doneItems", "recommendedAction", "missingContext"],
  artifactTypes: ["analysis"],
  dataPermissions: ["deal:read"],
  tools: [],
  approvalTier: 1,
  riskClassification: "low",
  executionTimeoutMs: 15_000,
  retryPolicy: { maxAttempts: 1, backoffMs: 0 },
  validationRules: ["input matches input.schema.json", "output matches output.schema.json", "no fabricated completion status"],
  evaluationCriteria: [
    "merges canonical closing checklist with supplied completion status only",
    "nothing is marked done unless the caller reports it done",
    "readinessPct is a labelled calculation; supplied completion facts are labelled facts",
    "an unsatisfied blocking condition precedent surfaces as a blocking item",
    "never marks the deal closed, signs, or executes — closing/signing stays a human Tier-3 action",
  ],
  providerCapabilities: ["structured_extraction"],
  allowedDownstreamSkills: [],
  prohibitedActions: ["sign_document", "execute_subdoc", "submit_term_sheet", "move_capital"],
  inputSchema,
  outputSchema,
};

export const closingChecklist: SkillDefinition<ClosingChecklistInput, ClosingChecklistOutput> = {
  manifest: closingChecklistManifest,
  run,
};
