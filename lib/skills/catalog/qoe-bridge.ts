// lib/skills/catalog/qoe-bridge.ts
// Financial DD / Quality of Earnings (PE department · Due Diligence 02). Rebuilds
// diligence-adjusted EBITDA from reported EBITDA, tests every management addback
// ONE AT A TIME, and records adjustments management missed. The rule that matters:
// no adjustment is accepted without a document reference — an "accepted" call with
// no support is downgraded to unsupported and does not move the number. Pure core.

import type { JsonSchema, SkillCore, SkillCoreResult, SkillDefinition, SkillManifest, SkillSource } from "@/lib/skills/types";
import { gradeOf, isEvidenceGrade, type EvidenceGrade } from "@/lib/pe/evidence";

export type AdjStatus = "accepted" | "rejected" | "unsupported";

export interface MgmtAdjustmentIn {
  label: string;
  /** Signed: positive adds back to EBITDA. */
  amount: number;
  /** Reviewer's call. Absent = not yet reviewed (treated as unsupported). */
  status?: AdjStatus;
  /** Document reference: file, page / tab, cell. */
  support?: string;
  grade?: EvidenceGrade;
}

export interface DiligenceAdjustmentIn {
  label: string;
  amount: number;
  support?: string;
  grade?: EvidenceGrade;
}

export interface QoeInput {
  reportedEbitda: number;
  /** EBITDA per the audited accounts, to tie the starting point. */
  auditedEbitda?: number;
  /** Management's stated adjusted EBITDA, to reconcile against its own bridge. */
  managementAdjustedEbitda?: number;
  managementAdjustments?: MgmtAdjustmentIn[];
  diligenceAdjustments?: DiligenceAdjustmentIn[];
  gateOwner?: string;
}

export interface BridgeRow {
  origin: "management" | "diligence";
  label: string;
  amount: number;
  status: AdjStatus;
  support: string | null;
  grade: EvidenceGrade;
  inAdjustedEbitda: boolean;
  note: string;
}

export interface QoeOutput {
  reportedEbitda: number;
  auditedTie: { auditedEbitda: number; difference: number; ties: boolean } | null;
  rows: BridgeRow[];
  diligenceAdjustedEbitda: number;
  managementBridgeCheck: { statedAdjustedEbitda: number; fromOwnBridge: number; reconciles: boolean } | null;
  deltaVsManagement: number | null;
  /** Sum of management addbacks that did NOT survive diligence. */
  addbacksNotAccepted: number;
  icMemoReady: false;
  gate: string;
}

const r2 = (n: number) => Math.round(n * 100) / 100;

const run: SkillCore<QoeInput, QoeOutput> = (input): SkillCoreResult<QoeOutput> => {
  const sources: SkillSource[] = [];
  const rows: BridgeRow[] = [];
  const missingData: string[] = [];

  sources.push({ label: "Reported EBITDA", kind: "fact", value: input.reportedEbitda });

  let auditedTie: QoeOutput["auditedTie"] = null;
  if (typeof input.auditedEbitda === "number") {
    const diff = r2(input.reportedEbitda - input.auditedEbitda);
    auditedTie = { auditedEbitda: input.auditedEbitda, difference: diff, ties: Math.abs(diff) < 0.005 };
    sources.push({ label: "Audited EBITDA", kind: "fact", value: input.auditedEbitda });
  } else {
    missingData.push("Audited EBITDA — reported EBITDA is not tied to the audited accounts");
  }

  for (const a of input.managementAdjustments ?? []) {
    const support = a.support?.trim() || null;
    let status: AdjStatus = a.status ?? "unsupported";
    let note = "";
    if (status === "accepted" && !support) {
      status = "unsupported";
      note = "Marked accepted but no document reference — downgraded to unsupported; not counted.";
    } else if (!a.status) {
      note = "Not yet reviewed — counted as unsupported.";
    } else if (status === "rejected") {
      note = "Rejected in diligence.";
    } else if (status === "unsupported") {
      note = support ? "Support supplied does not establish it." : "No support supplied.";
    }
    const accepted = status === "accepted";
    const grade = accepted ? (isEvidenceGrade(a.grade) && a.grade !== "U" ? a.grade : "B") : "U";
    rows.push({ origin: "management", label: a.label, amount: a.amount, status, support, grade, inAdjustedEbitda: accepted, note });
    sources.push({ label: `Management adjustment: ${a.label}`, kind: "fact", value: a.amount, ref: support ?? undefined });
  }

  for (const a of input.diligenceAdjustments ?? []) {
    const support = a.support?.trim() || null;
    const counted = !!support;
    rows.push({
      origin: "diligence",
      label: a.label,
      amount: a.amount,
      status: counted ? "accepted" : "unsupported",
      support,
      grade: counted ? (isEvidenceGrade(a.grade) && a.grade !== "U" ? a.grade : "B") : gradeOf(undefined),
      inAdjustedEbitda: counted,
      note: counted ? "Found in diligence; supported." : "Proposed in diligence but no document reference — not counted.",
    });
    sources.push({ label: `Diligence adjustment: ${a.label}`, kind: "fact", value: a.amount, ref: support ?? undefined });
  }

  const counted = rows.filter((r) => r.inAdjustedEbitda).reduce((s, r) => s + r.amount, 0);
  const adjusted = r2(input.reportedEbitda + counted);
  sources.push({ label: "Diligence-adjusted EBITDA", kind: "calculation", value: adjusted, ref: "reported + accepted/supported adjustments" });

  const mgmt = rows.filter((r) => r.origin === "management");
  const fromOwnBridge = r2(input.reportedEbitda + mgmt.reduce((s, r) => s + r.amount, 0));
  const managementBridgeCheck =
    typeof input.managementAdjustedEbitda === "number"
      ? { statedAdjustedEbitda: input.managementAdjustedEbitda, fromOwnBridge, reconciles: Math.abs(fromOwnBridge - input.managementAdjustedEbitda) < 0.005 }
      : null;
  const deltaVsManagement = typeof input.managementAdjustedEbitda === "number" ? r2(adjusted - input.managementAdjustedEbitda) : null;
  const addbacksNotAccepted = r2(mgmt.filter((r) => !r.inAdjustedEbitda).reduce((s, r) => s + r.amount, 0));

  const gateOwner = input.gateOwner?.trim() || "The financial DD lead";
  const gate = `${gateOwner} signs the adjusted EBITDA figure. It does not reach the IC memo before that. Recalculate every bridge line against source first.`;

  const structured: QoeOutput = {
    reportedEbitda: input.reportedEbitda,
    auditedTie,
    rows,
    diligenceAdjustedEbitda: adjusted,
    managementBridgeCheck,
    deltaVsManagement,
    addbacksNotAccepted,
    icMemoReady: false,
    gate,
  };

  const unsupported = rows.filter((r) => r.status === "unsupported").length;
  const narrative =
    `QoE bridge: reported ${input.reportedEbitda} → diligence-adjusted ${adjusted}` +
    `${deltaVsManagement !== null ? ` (${deltaVsManagement >= 0 ? "+" : ""}${deltaVsManagement} vs management)` : ""}. ` +
    `${rows.length} adjustment(s) listed individually, ${unsupported} unsupported. ` +
    `${auditedTie && !auditedTie.ties ? `Reported EBITDA differs from audited by ${auditedTie.difference}. ` : ""}` +
    gate;

  const completeness = Math.round(((auditedTie ? 1 : 0) + (rows.length ? 1 : 0) + (managementBridgeCheck ? 1 : 0)) / 3 * 100) / 100;
  return { structured, narrative, sources, confidence: Math.max(0.25, Math.min(0.9, 0.35 + completeness * 0.5)), completeness, missingData };
};

const adj: JsonSchema = { type: "object", required: ["label", "amount"], properties: { label: { type: "string", minLength: 1 }, amount: { type: "number" }, support: { type: "string" }, grade: { type: "string", enum: ["A", "B", "C", "U"] } } };

const inputSchema: JsonSchema = {
  type: "object",
  required: ["reportedEbitda"],
  properties: {
    reportedEbitda: { type: "number" },
    auditedEbitda: { type: "number" },
    managementAdjustedEbitda: { type: "number" },
    managementAdjustments: { type: "array", items: { ...adj, properties: { ...adj.properties, status: { type: "string", enum: ["accepted", "rejected", "unsupported"] } } } },
    diligenceAdjustments: { type: "array", items: adj },
    gateOwner: { type: "string" },
  },
};

const outputSchema: JsonSchema = {
  type: "object",
  required: ["reportedEbitda", "rows", "diligenceAdjustedEbitda", "addbacksNotAccepted", "icMemoReady", "gate"],
  properties: {
    reportedEbitda: { type: "number" },
    auditedTie: { type: "object" },
    rows: { type: "array", items: { type: "object", required: ["origin", "label", "amount", "status", "grade", "inAdjustedEbitda"] } },
    diligenceAdjustedEbitda: { type: "number" },
    managementBridgeCheck: { type: "object" },
    deltaVsManagement: { type: "number" },
    addbacksNotAccepted: { type: "number" },
    icMemoReady: { type: "boolean" },
    gate: { type: "string" },
  },
};

export const qoeBridgeManifest: SkillManifest = {
  id: "qoe-bridge",
  name: "Quality of Earnings Bridge",
  version: "1.0.0",
  owner: "fundexecs",
  hub: "run",
  applicableExecutives: ["diligence", "analyst"],
  supportedEntityTypes: ["deal", "company"],
  requiredInputs: ["reportedEbitda"],
  optionalInputs: ["auditedEbitda", "managementAdjustedEbitda", "managementAdjustments", "diligenceAdjustments", "gateOwner"],
  outputs: ["rows", "diligenceAdjustedEbitda", "deltaVsManagement", "addbacksNotAccepted", "gate"],
  artifactTypes: ["analysis"],
  dataPermissions: ["deal:read", "document:read"],
  tools: [],
  approvalTier: 1,
  riskClassification: "low",
  executionTimeoutMs: 10_000,
  retryPolicy: { maxAttempts: 1, backoffMs: 0 },
  validationRules: ["input matches input.schema.json", "output matches output.schema.json", "no adjustment accepted without a document reference"],
  evaluationCriteria: ["accepted without support is downgraded", "bridge adds up", "management bridge reconciled", "adjusted EBITDA never reaches IC memo before sign-off"],
  providerCapabilities: ["financial_reasoning"],
  allowedDownstreamSkills: ["bid-range", "red-flag-register", "ic-memo", "lbo"],
  prohibitedActions: ["send_outreach", "distribute_report", "sign_document", "move_capital", "capital_call"],
  inputSchema,
  outputSchema,
};

export const qoeBridge: SkillDefinition<QoeInput, QoeOutput> = { manifest: qoeBridgeManifest, run };
