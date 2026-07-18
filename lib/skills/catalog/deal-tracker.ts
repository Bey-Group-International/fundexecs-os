// lib/skills/catalog/deal-tracker.ts
// Native skill: roll up the status of a deal in flight from a SUPPLIED set of
// workstreams/milestones. Pure, deterministic core — the tested execution path.
// It NEVER invents milestones or dates: it organizes only the milestones the
// caller provides. An empty milestone set returns an empty roll-up plus a note.
// Every provided milestone field (label/owner/dueDate) is a `fact`; a status the
// caller omits is defaulted and labelled an `assumption`, never a fact; the
// completion percentage is a `calculation`. This skill ORGANIZES a supplied set —
// it never advances a deal, signs anything, or moves capital.

import type { JsonSchema, SkillCore, SkillCoreResult, SkillDefinition, SkillManifest, SkillSource } from "@/lib/skills/types";

// ---------------------------------------------------------------------------
// I/O types
// ---------------------------------------------------------------------------

export type MilestoneStatus = "not_started" | "in_progress" | "blocked" | "done";

export interface DealInput {
  name: string;
  stage?: string;
  targetCloseDate?: string;
}

export interface MilestoneInput {
  label: string;
  status?: MilestoneStatus;
  owner?: string;
  dueDate?: string;
  critical?: boolean;
}

export interface DealTrackerInput {
  deal: DealInput;
  milestones?: MilestoneInput[];
}

export interface TrackedMilestone {
  label: string;
  status: MilestoneStatus;
  owner: string | null;
  dueDate: string | null;
  critical: boolean;
  atRisk: boolean;
}

export interface DealTrackerOutput {
  tracked: TrackedMilestone[];
  byStatus: Record<string, number>;
  atRisk: string[];
  overallStatus: string;
  completionPct: number;
  totalMilestones: number;
  nextActions: string[];
  missingContext: string[];
  recommendedAction: string;
}

// ---------------------------------------------------------------------------
// Deterministic core
// ---------------------------------------------------------------------------

const STATUSES: MilestoneStatus[] = ["not_started", "in_progress", "blocked", "done"];
const DEFAULT_STATUS: MilestoneStatus = "not_started";
const MAX_NEXT_ACTIONS = 10;

const NO_MILESTONES_NOTE =
  "No milestones supplied — this skill tracks a provided milestone set; it does not fabricate milestones.";

const run: SkillCore<DealTrackerInput, DealTrackerOutput> = (input): SkillCoreResult<DealTrackerOutput> => {
  const deal = input.deal ?? { name: "" };
  const milestones = input.milestones ?? [];
  const sources: SkillSource[] = [];
  const missingContext: string[] = [];

  // Deal identity + stage/close date are FACTS when supplied — nothing invented.
  if (deal.name) sources.push({ label: "Deal — name", kind: "fact", value: deal.name });
  if (deal.stage) sources.push({ label: "Deal — stage", kind: "fact", value: deal.stage });
  if (deal.targetCloseDate) sources.push({ label: "Deal — target close date", kind: "fact", value: deal.targetCloseDate });
  if (!deal.stage) missingContext.push("Deal stage not supplied — status roll-up is not anchored to a pipeline stage.");
  if (!deal.targetCloseDate) missingContext.push("Deal target close date not supplied — timeline pressure not assessed.");

  // GUARDRAIL: an empty milestone set is NEVER filled in. Return an empty roll-up
  // and say so — this skill tracks what it is given, it does not invent milestones.
  if (milestones.length === 0) {
    missingContext.unshift(NO_MILESTONES_NOTE);
    const structured: DealTrackerOutput = {
      tracked: [],
      byStatus: {},
      atRisk: [],
      overallStatus: "not_started",
      completionPct: 0,
      totalMilestones: 0,
      nextActions: [],
      missingContext,
      recommendedAction:
        "Supply the deal's workstreams/milestones (closing checklist, CP list, or tracker export) — this skill rolls up a provided milestone set, it does not generate one.",
    };
    const narrative =
      `No milestones supplied for ${deal.name || "this deal"}. This skill rolls up a provided milestone set into a status snapshot; ` +
      "it does not fabricate milestones or dates. Provide the milestone set to track.";
    return { structured, narrative, sources, confidence: 0.2, completeness: 0, missingData: [...missingContext] };
  }

  const byStatus: Record<string, number> = {};
  for (const s of STATUSES) byStatus[s] = 0;

  let fieldTotal = 0;
  let fieldPossible = 0;
  const missingOwner: string[] = [];
  const missingDueDate: string[] = [];
  const defaultedStatus: string[] = [];

  const tracked: TrackedMilestone[] = milestones.map((m) => {
    // Label is always a FACT.
    sources.push({ label: `${m.label} — milestone`, kind: "fact", value: m.label });

    // Status: supplied → FACT; absent → defaulted + labelled an ASSUMPTION, never a fact.
    const statusProvided = m.status != null;
    const status: MilestoneStatus = statusProvided ? (m.status as MilestoneStatus) : DEFAULT_STATUS;
    if (statusProvided) {
      sources.push({ label: `${m.label} — status`, kind: "fact", value: status });
    } else {
      sources.push({ label: `${m.label} — status`, kind: "assumption", value: status, ref: "defaulted (no status supplied)" });
      defaultedStatus.push(m.label);
    }

    // Owner / dueDate are FACTS when supplied, flagged when missing — never invented.
    if (m.owner) sources.push({ label: `${m.label} — owner`, kind: "fact", value: m.owner });
    else missingOwner.push(m.label);
    if (m.dueDate) sources.push({ label: `${m.label} — due date`, kind: "fact", value: m.dueDate });
    else missingDueDate.push(m.label);

    const critical = m.critical === true;

    // At risk: blocked, OR a critical milestone that is not yet done.
    const atRisk = status === "blocked" || (critical && status !== "done");

    byStatus[status] += 1;

    // Field coverage for completeness (status / owner / dueDate per milestone).
    fieldPossible += 3;
    if (statusProvided) fieldTotal += 1;
    if (m.owner) fieldTotal += 1;
    if (m.dueDate) fieldTotal += 1;

    return {
      label: m.label,
      status,
      owner: m.owner ?? null,
      dueDate: m.dueDate ?? null,
      critical,
      atRisk,
    };
  });

  const total = tracked.length;
  const atRiskItems = tracked.filter((t) => t.atRisk);
  const atRisk = atRiskItems.map((t) => t.label);

  // Overall status. Precedence: complete > at_risk > not_started > on_track.
  let overallStatus: string;
  if (tracked.every((t) => t.status === "done")) overallStatus = "complete";
  else if (atRisk.length > 0) overallStatus = "at_risk";
  else if (tracked.every((t) => t.status === "not_started")) overallStatus = "not_started";
  else overallStatus = "on_track";

  // completionPct is a CALCULATION, never a fact.
  const doneCount = byStatus["done"];
  const completionPct = Math.round((doneCount / total) * 100);
  sources.push({ label: "Deal — completion %", kind: "calculation", value: completionPct, ref: "done / total milestones" });

  // Next actions: one concrete action per at-risk item. Capped; truncation is noted.
  const nextActions: string[] = [];
  for (const t of atRiskItems) {
    if (nextActions.length >= MAX_NEXT_ACTIONS) break;
    nextActions.push(t.status === "blocked" ? `Unblock: ${t.label}` : `Advance critical: ${t.label}`);
  }
  if (atRiskItems.length > MAX_NEXT_ACTIONS) {
    missingContext.push(
      `${atRiskItems.length} at-risk items — next actions capped at ${MAX_NEXT_ACTIONS}; ${atRiskItems.length - MAX_NEXT_ACTIONS} not listed.`,
    );
  }

  // Missing-context notes — surfaced, never silently assumed.
  if (defaultedStatus.length)
    missingContext.push(`Status defaulted to "${DEFAULT_STATUS}" (assumption) for ${defaultedStatus.length} milestone(s) with no status supplied.`);
  if (missingOwner.length) missingContext.push(`Owner missing for ${missingOwner.length} milestone(s) — accountability not assigned.`);
  if (missingDueDate.length) missingContext.push(`Due date missing for ${missingDueDate.length} milestone(s) — timeline not tracked for them.`);

  const completeness = fieldPossible ? Math.round((fieldTotal / fieldPossible) * 100) / 100 : 0;
  const confidence = Math.max(0.2, Math.min(0.95, 0.4 + completeness * 0.5));

  const recommendedAction =
    atRisk.length > 0
      ? `Resolve ${atRisk.length} at-risk item(s) (${atRisk.slice(0, 5).join(", ")}${atRisk.length > 5 ? ", …" : ""}) before advancing the deal.`
      : overallStatus === "complete"
        ? "All supplied milestones are done — route to the closing owner for a final review; this skill does not advance or sign the deal."
        : "No at-risk items — keep supplied milestones moving; this skill tracks status, it does not advance or sign the deal.";

  const narrative =
    `${deal.name || "Deal"}${deal.stage ? ` (${deal.stage})` : ""}: ${completionPct}% complete across ${total} tracked milestone(s), ` +
    `status ${overallStatus}` +
    `${atRisk.length ? `, ${atRisk.length} at risk (${atRisk.slice(0, 5).join(", ")}${atRisk.length > 5 ? ", …" : ""})` : ""}. ` +
    `Next: ${recommendedAction}`;

  const structured: DealTrackerOutput = {
    tracked,
    byStatus,
    atRisk,
    overallStatus,
    completionPct,
    totalMilestones: total,
    nextActions,
    missingContext,
    recommendedAction,
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
        stage: { type: "string" },
        targetCloseDate: { type: "string" },
      },
    },
    milestones: {
      type: "array",
      items: {
        type: "object",
        required: ["label"],
        properties: {
          label: { type: "string", minLength: 1 },
          status: { type: "string", enum: ["not_started", "in_progress", "blocked", "done"] },
          owner: { type: "string" },
          dueDate: { type: "string" },
          critical: { type: "boolean" },
        },
      },
    },
  },
};

const outputSchema: JsonSchema = {
  type: "object",
  required: [
    "tracked",
    "byStatus",
    "atRisk",
    "overallStatus",
    "completionPct",
    "totalMilestones",
    "nextActions",
    "recommendedAction",
  ],
  properties: {
    tracked: {
      type: "array",
      items: {
        type: "object",
        required: ["label", "status", "critical", "atRisk"],
        properties: {
          label: { type: "string" },
          status: { type: "string", enum: ["not_started", "in_progress", "blocked", "done"] },
          owner: { type: "string" },
          dueDate: { type: "string" },
          critical: { type: "boolean" },
          atRisk: { type: "boolean" },
        },
      },
    },
    byStatus: { type: "object" },
    atRisk: { type: "array", items: { type: "string" } },
    overallStatus: { type: "string" },
    completionPct: { type: "number", minimum: 0, maximum: 100 },
    totalMilestones: { type: "number", minimum: 0 },
    nextActions: { type: "array", items: { type: "string" } },
    missingContext: { type: "array", items: { type: "string" } },
    recommendedAction: { type: "string" },
  },
};

export const dealTrackerManifest: SkillManifest = {
  id: "deal-tracker",
  name: "Deal Tracker",
  version: "1.0.0",
  owner: "fundexecs",
  hub: "execute",
  applicableExecutives: ["legal_closing"],
  supportedEntityTypes: ["deal", "document", "data_room"],
  requiredInputs: ["deal"],
  optionalInputs: ["milestones"],
  outputs: [
    "tracked",
    "byStatus",
    "atRisk",
    "overallStatus",
    "completionPct",
    "totalMilestones",
    "nextActions",
    "missingContext",
    "recommendedAction",
  ],
  artifactTypes: ["analysis"],
  dataPermissions: ["deal:read", "document:read", "data_room:read"],
  tools: [],
  approvalTier: 1,
  riskClassification: "low",
  executionTimeoutMs: 15_000,
  retryPolicy: { maxAttempts: 1, backoffMs: 0 },
  validationRules: ["input matches input.schema.json", "output matches output.schema.json", "no fabricated milestones"],
  evaluationCriteria: [
    "tracks only supplied milestones",
    "empty milestone set returns empty roll-up with a note, never invents milestones",
    "blocked or critical-not-done milestones flagged at risk",
    "supplied fields labelled fact, defaulted status labelled assumption, completionPct labelled calculation",
  ],
  providerCapabilities: ["structured_extraction"],
  allowedDownstreamSkills: ["closing-checklist"],
  prohibitedActions: ["sign_document", "execute_subdoc", "move_capital"],
  inputSchema,
  outputSchema,
};

export const dealTracker: SkillDefinition<DealTrackerInput, DealTrackerOutput> = {
  manifest: dealTrackerManifest,
  run,
};
