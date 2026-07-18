// lib/skills/catalog/policy-check.ts
// Native skill: evaluate a proposed action against a SUPPLIED policy set and FLAG
// potential restrictions or conflicts for review. Pure, deterministic core — the
// tested execution path.
//
// GUARDRAIL: This skill is SUPPORT only. It never makes a final legal or
// compliance determination and never authorizes the action. Each flag is a
// signal for a human; `recommendedAction` always defers the final call to a
// compliance or legal officer. A restriction it cannot evaluate (because the
// relevant context is missing) is surfaced as "review", never silently passed —
// and nothing is fabricated: a missing input is flagged.

import type { JsonSchema, SkillCore, SkillCoreResult, SkillDefinition, SkillManifest, SkillSource } from "@/lib/skills/types";

// ---------------------------------------------------------------------------
// I/O types
// ---------------------------------------------------------------------------

export interface PolicyContext {
  counterpartyDomain?: string;
  dollarAmount?: number;
  jurisdiction?: string;
}

export interface PolicyRule {
  name: string;
  rule: string;
  restricted?: boolean;
  forbiddenDomains?: string[];
  maxDollar?: number;
  jurisdictions?: string[];
}

export interface PolicyCheckInput {
  action: string;
  context?: PolicyContext;
  policies?: PolicyRule[];
}

export type PolicyStatus = "ok" | "review" | "restricted";

export interface PolicyFlag {
  policy: string;
  status: PolicyStatus;
  reason: string;
}

export interface PolicyCheckOutput {
  flags: PolicyFlag[];
  restrictedCount: number;
  reviewCount: number;
  requiresEscalation: boolean;
  missingContext: string[];
  recommendedAction: string;
}

// ---------------------------------------------------------------------------
// Deterministic core
// ---------------------------------------------------------------------------

const lc = (s: string) => s.toLowerCase().trim();

// The final determination is ALWAYS a compliance/legal officer's — this phrase is
// woven into every recommendedAction so the skill can never read as authorization.
const OFFICER = "a compliance or legal officer makes the final determination";

const NO_POLICIES = "No policies supplied — provide the applicable policy set to evaluate.";
const MISSING_DOMAIN = "Counterparty domain — needed to evaluate a forbidden-domain policy.";
const MISSING_DOLLAR = "Dollar amount — needed to evaluate a dollar-limit policy.";
const MISSING_JURISDICTION = "Jurisdiction — needed to evaluate a jurisdiction policy.";

interface PolicyEval {
  status: PolicyStatus;
  reason: string;
  missing: string[];
}

function evaluatePolicy(p: PolicyRule, ctx: PolicyContext): PolicyEval {
  const restrictedReasons: string[] = [];
  const reviewReasons: string[] = [];
  const missing: string[] = [];

  // An explicitly restricted policy is a hard flag, regardless of context.
  if (p.restricted === true) {
    restrictedReasons.push("the policy is marked restricted");
  }

  // Forbidden counterparty domains.
  if (p.forbiddenDomains && p.forbiddenDomains.length > 0) {
    if (ctx.counterpartyDomain != null && ctx.counterpartyDomain !== "") {
      const cd = lc(ctx.counterpartyDomain);
      if (p.forbiddenDomains.some((d) => lc(d) === cd)) {
        restrictedReasons.push(`counterparty domain "${ctx.counterpartyDomain}" is on the policy's forbidden-domain list`);
      }
    } else {
      reviewReasons.push("the policy restricts specific counterparty domains, but no counterparty domain was supplied");
      missing.push(MISSING_DOMAIN);
    }
  }

  // Dollar ceiling.
  if (p.maxDollar != null) {
    if (ctx.dollarAmount != null) {
      if (ctx.dollarAmount > p.maxDollar) {
        restrictedReasons.push(`dollar amount ${ctx.dollarAmount} exceeds the policy limit of ${p.maxDollar}`);
      }
    } else {
      reviewReasons.push(`the policy sets a dollar limit of ${p.maxDollar}, but no dollar amount was supplied`);
      missing.push(MISSING_DOLLAR);
    }
  }

  // Permitted jurisdictions.
  if (p.jurisdictions && p.jurisdictions.length > 0) {
    if (ctx.jurisdiction != null && ctx.jurisdiction !== "") {
      const j = lc(ctx.jurisdiction);
      if (!p.jurisdictions.some((x) => lc(x) === j)) {
        restrictedReasons.push(`jurisdiction "${ctx.jurisdiction}" is not within the policy's permitted jurisdictions`);
      }
    } else {
      reviewReasons.push("the policy restricts jurisdictions, but no jurisdiction was supplied");
      missing.push(MISSING_JURISDICTION);
    }
  }

  if (restrictedReasons.length > 0) {
    return {
      status: "restricted",
      reason: `Potential restriction flagged — ${restrictedReasons.join("; ")}. Escalate for review.`,
      missing,
    };
  }
  if (reviewReasons.length > 0) {
    return {
      status: "review",
      reason: `Cannot evaluate on the available context — ${reviewReasons.join("; ")}. Needs human review.`,
      missing,
    };
  }
  return {
    status: "ok",
    reason: `No restriction triggered by "${p.name}" on the available context.`,
    missing,
  };
}

const run: SkillCore<PolicyCheckInput, PolicyCheckOutput> = (input): SkillCoreResult<PolicyCheckOutput> => {
  const action = input.action;
  const ctx = input.context ?? {};
  const policies = input.policies ?? [];
  const sources: SkillSource[] = [];

  // Record supplied inputs as FACTS — nothing is fabricated.
  sources.push({ label: "Proposed action", kind: "fact", value: action });
  if (ctx.counterpartyDomain != null && ctx.counterpartyDomain !== "") sources.push({ label: "Counterparty domain", kind: "fact", value: ctx.counterpartyDomain });
  if (ctx.dollarAmount != null) sources.push({ label: "Dollar amount", kind: "fact", value: ctx.dollarAmount });
  if (ctx.jurisdiction != null && ctx.jurisdiction !== "") sources.push({ label: "Jurisdiction", kind: "fact", value: ctx.jurisdiction });

  const flags: PolicyFlag[] = [];
  const missingSet = new Set<string>();

  if (policies.length === 0) {
    // Missing the policy set entirely — flag it, evaluate nothing.
    missingSet.add(NO_POLICIES);
  }

  for (const p of policies) {
    const { status, reason, missing } = evaluatePolicy(p, ctx);
    flags.push({ policy: p.name, status, reason });
    for (const m of missing) missingSet.add(m);
  }

  const restrictedCount = flags.filter((f) => f.status === "restricted").length;
  const reviewCount = flags.filter((f) => f.status === "review").length;
  const requiresEscalation = restrictedCount > 0;
  const missingContext = [...missingSet];

  sources.push({ label: "Restricted policy count", kind: "calculation", value: restrictedCount, ref: "count of flags with status=restricted" });
  sources.push({ label: "Review-needed policy count", kind: "calculation", value: reviewCount, ref: "count of flags with status=review" });

  // recommendedAction ALWAYS defers the final call to a compliance/legal officer.
  let recommendedAction: string;
  if (policies.length === 0) {
    recommendedAction =
      `No policy set was supplied, so no restriction check could be performed for "${action}". ` +
      `Provide the applicable policies; ${OFFICER} before this action proceeds. This check does not authorize the action.`;
  } else if (restrictedCount > 0) {
    recommendedAction =
      `Do not proceed on this check alone. ${restrictedCount} potential restriction(s) were flagged for "${action}" and must be escalated — ${OFFICER}. ` +
      `This check flags issues for review; it does not authorize the action.`;
  } else if (reviewCount > 0) {
    recommendedAction =
      `Hold for review. ${reviewCount} policy(ies) could not be evaluated on the available context for "${action}"; obtain the missing context and escalate — ${OFFICER}. ` +
      `This check does not authorize the action.`;
  } else {
    recommendedAction =
      `No policy restriction was triggered for "${action}" on the available context. This is not an authorization: ${OFFICER} before the action proceeds.`;
  }
  sources.push({ label: "Recommended next step", kind: "generated", value: `${restrictedCount} restricted / ${reviewCount} review`, ref: "deterministic escalation rule" });

  const structured: PolicyCheckOutput = {
    flags,
    restrictedCount,
    reviewCount,
    requiresEscalation,
    missingContext,
    recommendedAction,
  };

  // Completeness — fraction of context fields the supplied policies actually
  // needed that were provided. No policies ⇒ nothing could be assessed.
  const needed = new Set<string>();
  for (const p of policies) {
    if (p.forbiddenDomains && p.forbiddenDomains.length > 0) needed.add(MISSING_DOMAIN);
    if (p.maxDollar != null) needed.add(MISSING_DOLLAR);
    if (p.jurisdictions && p.jurisdictions.length > 0) needed.add(MISSING_JURISDICTION);
  }
  const fieldMissing = [MISSING_DOMAIN, MISSING_DOLLAR, MISSING_JURISDICTION].filter((l) => missingSet.has(l)).length;
  const completeness =
    policies.length === 0 ? 0 : needed.size === 0 ? 1 : Math.round(((needed.size - fieldMissing) / needed.size) * 100) / 100;

  const confidence = Math.max(0.2, Math.min(0.95, 0.4 + completeness * 0.4 + (policies.length > 0 ? 0.1 : 0)));

  const narrative =
    `Policy check of "${action}": ${restrictedCount} restricted, ${reviewCount} to review across ${policies.length} policy(ies). ` +
    `${requiresEscalation ? "Escalation required. " : ""}` +
    `${missingContext.length ? `Missing: ${missingContext.length} item(s). ` : ""}` +
    `Not a final determination — ${OFFICER}.`;

  return { structured, narrative, sources, confidence, completeness, missingData: missingContext };
};

// ---------------------------------------------------------------------------
// Schemas + manifest
// ---------------------------------------------------------------------------

const inputSchema: JsonSchema = {
  type: "object",
  required: ["action"],
  properties: {
    action: { type: "string", minLength: 1 },
    context: {
      type: "object",
      properties: {
        counterpartyDomain: { type: "string" },
        dollarAmount: { type: "number", minimum: 0 },
        jurisdiction: { type: "string" },
      },
    },
    policies: {
      type: "array",
      items: {
        type: "object",
        required: ["name", "rule"],
        properties: {
          name: { type: "string", minLength: 1 },
          rule: { type: "string" },
          restricted: { type: "boolean" },
          forbiddenDomains: { type: "array", items: { type: "string" } },
          maxDollar: { type: "number", minimum: 0 },
          jurisdictions: { type: "array", items: { type: "string" } },
        },
      },
    },
  },
};

const outputSchema: JsonSchema = {
  type: "object",
  required: ["flags", "restrictedCount", "reviewCount", "requiresEscalation", "missingContext", "recommendedAction"],
  properties: {
    flags: {
      type: "array",
      items: {
        type: "object",
        required: ["policy", "status", "reason"],
        properties: {
          policy: { type: "string" },
          status: { type: "string", enum: ["ok", "review", "restricted"] },
          reason: { type: "string" },
        },
      },
    },
    restrictedCount: { type: "integer", minimum: 0 },
    reviewCount: { type: "integer", minimum: 0 },
    requiresEscalation: { type: "boolean" },
    missingContext: { type: "array", items: { type: "string" } },
    recommendedAction: { type: "string" },
  },
};

export const policyCheckManifest: SkillManifest = {
  id: "policy-check",
  name: "Policy & Restricted-Action Check",
  version: "1.0.0",
  owner: "fundexecs",
  hub: "run",
  applicableExecutives: ["risk_compliance"],
  supportedEntityTypes: ["action", "policy"],
  requiredInputs: ["action"],
  optionalInputs: ["context", "policies"],
  outputs: ["flags", "restrictedCount", "reviewCount", "requiresEscalation", "missingContext", "recommendedAction"],
  artifactTypes: ["risk_report", "analysis"],
  dataPermissions: ["policy:read"],
  tools: [],
  approvalTier: 1,
  riskClassification: "elevated",
  executionTimeoutMs: 15_000,
  retryPolicy: { maxAttempts: 1, backoffMs: 0 },
  validationRules: [
    "input matches input.schema.json",
    "output matches output.schema.json",
    "never a final compliance/legal determination",
    "never authorizes the action",
    "missing context flagged not assumed away",
  ],
  evaluationCriteria: [
    "restricted policies flagged for review",
    "unevaluable policies surfaced as review, not passed",
    "missing context flagged not invented",
    "recommendedAction always defers to a compliance/legal officer",
  ],
  providerCapabilities: ["structured_extraction"],
  allowedDownstreamSkills: [],
  prohibitedActions: ["sign_document", "move_capital", "submit_term_sheet"],
  inputSchema,
  outputSchema,
};

export const policyCheck: SkillDefinition<PolicyCheckInput, PolicyCheckOutput> = {
  manifest: policyCheckManifest,
  run,
};
