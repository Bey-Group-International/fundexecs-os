// lib/skills/types.ts
// The native FundExecs skill runtime — provider-neutral, engine-agnostic types.
//
// A SKILL is a versioned, schema-defined, policy-governed reusable workflow: it
// declares its inputs/outputs as JSON Schema, its approval tier and risk, the
// executives allowed to run it, and a deterministic executable core. The runtime
// (validate → run → validate → persist → audit) owns governance; the skill owns
// the domain logic. Everything here is pure types + a couple of pure helpers, so
// a skill's core is testable with zero I/O.

import type { ActionKind, GateTier } from "@/lib/gates";
import type { Hub } from "@/lib/supabase/database.types";
import type { ExecutiveKey } from "@/lib/executives/registry";

/** A minimal JSON-Schema subset the native validator understands (lib/skills/validate.ts). */
export interface JsonSchema {
  type?: "object" | "array" | "string" | "number" | "integer" | "boolean" | "null";
  properties?: Record<string, JsonSchema>;
  required?: string[];
  items?: JsonSchema;
  enum?: Array<string | number | boolean | null>;
  minimum?: number;
  maximum?: number;
  minLength?: number;
  description?: string;
  /** Unknown keys are ignored by the validator, never rejected. */
  additionalProperties?: boolean;
}

export type RiskClassification = "low" | "moderate" | "elevated" | "high";

/** A claim's epistemic status — never collapse these. */
export type SourceKind = "fact" | "assumption" | "calculation" | "generated";

export interface SkillSource {
  /** Human-readable label, e.g. "Reported revenue" or "Assumed exit multiple". */
  label: string;
  kind: SourceKind;
  /** The value the claim carries (number or string), when applicable. */
  value?: string | number;
  /** A deep link / provenance ref (document id, cell, url). */
  ref?: string;
}

/** The manifest — the machine-readable contract mirrored by /skills/<id>/skill.yaml. */
export interface SkillManifest {
  id: string;
  name: string;
  version: string;
  owner: string;
  hub: Hub | null;
  applicableExecutives: ExecutiveKey[];
  supportedEntityTypes: string[];
  requiredInputs: string[];
  optionalInputs: string[];
  outputs: string[];
  artifactTypes: string[];
  dataPermissions: string[];
  tools: string[];
  approvalTier: GateTier;
  riskClassification: RiskClassification;
  executionTimeoutMs: number;
  retryPolicy: { maxAttempts: number; backoffMs: number };
  validationRules: string[];
  evaluationCriteria: string[];
  providerCapabilities: string[];
  allowedDownstreamSkills: string[];
  prohibitedActions: ActionKind[];
  inputSchema: JsonSchema;
  outputSchema: JsonSchema;
}

/** The context a skill runs in — resolved by the runner from the session/mandate. */
export interface SkillContext {
  workspaceId: string;
  principalId: string;
  executive: ExecutiveKey;
  sessionId?: string | null;
  workflowTaskId?: string | null;
  /** Deterministic clock for testability. */
  now?: number;
}

/** The structured result a skill core returns (before persistence). */
export interface SkillCoreResult<T> {
  structured: T;
  narrative: string;
  sources: SkillSource[];
  /** 0–1 model/analysis confidence. */
  confidence: number;
  /** 0–1 how complete the required inputs were. */
  completeness: number;
  /** Human-readable labels of material inputs that were missing. */
  missingData: string[];
}

/** A skill's deterministic executable core — pure, no I/O, fully testable. */
export type SkillCore<I, O> = (input: I, ctx: SkillContext) => SkillCoreResult<O>;

/** A registered skill = manifest + its executable core. */
export interface SkillDefinition<I = unknown, O = unknown> {
  manifest: SkillManifest;
  run: SkillCore<I, O>;
}

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

/** The full result the runner returns (and persists as a skill_run). */
export interface SkillResult<T = unknown> {
  ok: boolean;
  skillId: string;
  version: string;
  status: SkillRunStatus;
  structured: T | null;
  narrative: string;
  sources: SkillSource[];
  confidence: number;
  completeness: number;
  missingData: string[];
  approvalTier: GateTier;
  /** True when a follow-on action would need a human gate before it can run. */
  requiresApproval: boolean;
  inputValidation: ValidationResult;
  outputValidation: ValidationResult;
  warnings: string[];
}

export type SkillRunStatus = "succeeded" | "failed" | "rejected";

/** The persisted skill_run row (mirror of the migration). */
export interface SkillRunRecord {
  id: string;
  workspaceId: string;
  skillId: string;
  skillVersion: string;
  executiveKey: string;
  backingAgent: string | null;
  sessionId: string | null;
  workflowTaskId: string | null;
  status: SkillRunStatus;
  approvalTier: GateTier;
  risk: RiskClassification;
  confidence: number;
  completeness: number;
  input: unknown;
  output: unknown;
  sources: SkillSource[];
  missingData: string[];
  validation: unknown;
  provider: string | null;
  model: string | null;
  artifactId: string | null;
  error: string | null;
  createdBy: string | null;
  createdAt: string;
}
