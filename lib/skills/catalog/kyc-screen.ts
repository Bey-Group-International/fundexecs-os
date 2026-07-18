// lib/skills/catalog/kyc-screen.ts
// Native skill: KYC / AML SCREENING SUPPORT. It evaluates a subject against a
// deterministic rules grid — document completeness, expiry, screening-check
// results, PEP and sanctions flags — surfaces gaps, and ROUTES EXCEPTIONS to a
// compliance officer. Pure, deterministic core — the tested execution path.
//
// CRITICAL GUARDRAIL (non-negotiable): this skill NEVER approves onboarding and
// NEVER makes a final compliance determination. Its status is NEVER "approved".
// It prepares and routes; a COMPLIANCE OFFICER makes the final onboarding
// determination. A missing input is FLAGGED, a provided figure is a FACT, and a
// computed figure is a CALCULATION — nothing is fabricated.

import type { JsonSchema, SkillContext, SkillCore, SkillCoreResult, SkillDefinition, SkillManifest, SkillSource } from "@/lib/skills/types";

// ---------------------------------------------------------------------------
// I/O types
// ---------------------------------------------------------------------------

export type SubjectType = "individual" | "entity";

export interface KycDocument {
  type: string;
  present?: boolean;
  /** ISO date string; a past or near-term expiry is flagged. */
  expiresAt?: string;
}

export type CheckResult = "pass" | "fail" | "pending";

export interface KycCheck {
  name: string;
  result?: CheckResult;
}

export interface KycScreenInput {
  subjectName: string;
  subjectType?: SubjectType;
  documents?: KycDocument[];
  checks?: KycCheck[];
  pepFlag?: boolean;
  sanctionsHit?: boolean;
}

/** NEVER "approved" / "clear" — this skill does not make a final determination. */
export type ScreeningStatus = "clear_for_review" | "incomplete" | "escalate";

export interface KycScreenOutput {
  screeningStatus: ScreeningStatus;
  /** 0–1 fraction of provided documents that are present. */
  documentCompleteness: number;
  missingDocuments: string[];
  expiringDocuments: string[];
  failedChecks: string[];
  escalationReasons: string[];
  missingFields: string[];
  recommendedAction: string;
}

// ---------------------------------------------------------------------------
// Deterministic core
// ---------------------------------------------------------------------------

const round2 = (n: number): number => Math.round(n * 100) / 100;

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

/** The standard closing clause — a compliance officer owns the final call. */
const OFFICER_DETERMINATION = "A compliance officer makes the final onboarding determination; this skill only prepares and routes the file.";

/** Material inputs whose absence is flagged (never invented). */
const MATERIAL_FIELDS: Array<[keyof KycScreenInput, string]> = [
  ["subjectType", "Subject type"],
  ["documents", "Identity documents"],
  ["checks", "Screening checks"],
  ["pepFlag", "PEP screening"],
  ["sanctionsHit", "Sanctions screening"],
];

function isFieldMissing(input: KycScreenInput, key: keyof KycScreenInput): boolean {
  const v = input[key];
  if (v == null) return true;
  if (Array.isArray(v)) return v.length === 0;
  return false;
}

const run: SkillCore<KycScreenInput, KycScreenOutput> = (input, ctx): SkillCoreResult<KycScreenOutput> => {
  const { subjectName, subjectType, documents, checks, pepFlag, sanctionsHit } = input;
  const sources: SkillSource[] = [];
  const now = ctx.now ?? Date.now();

  // Provided data is recorded as FACTS — nothing is fabricated.
  sources.push({ label: "Subject name", kind: "fact", value: subjectName });
  if (subjectType) sources.push({ label: "Subject type", kind: "fact", value: subjectType });
  if (pepFlag != null) sources.push({ label: "PEP flag", kind: "fact", value: String(pepFlag) });
  if (sanctionsHit != null) sources.push({ label: "Sanctions hit", kind: "fact", value: String(sanctionsHit) });

  // --- Documents grid ---
  const docs = documents ?? [];
  const documentsAbsent = docs.length === 0;
  const documentCompleteness = docs.length ? round2(docs.filter((d) => d.present === true).length / docs.length) : 0;
  if (docs.length) {
    sources.push({ label: "Document completeness", kind: "calculation", value: documentCompleteness, ref: "present documents ÷ total documents" });
  }
  const missingDocuments = docs.filter((d) => d.present !== true).map((d) => d.type);
  const expiringDocuments = docs
    .filter((d) => {
      if (!d.expiresAt) return false;
      const t = Date.parse(d.expiresAt);
      if (Number.isNaN(t)) return false;
      return t <= now + THIRTY_DAYS_MS; // past OR within 30 days
    })
    .map((d) => d.type);

  // --- Screening checks ---
  const checkList = checks ?? [];
  const failedChecks = checkList.filter((c) => c.result === "fail").map((c) => c.name);
  const anyPending = checkList.some((c) => c.result === "pending");

  // --- Escalation reasons — the exception routing basis (GENERATED). ---
  const escalationReasons: string[] = [];
  if (sanctionsHit === true) escalationReasons.push("Sanctions hit");
  if (pepFlag === true) escalationReasons.push("PEP flag");
  for (const name of failedChecks) escalationReasons.push(`Failed check: ${name}`);
  if (escalationReasons.length) {
    sources.push({ label: "Escalation routing basis", kind: "generated", value: escalationReasons.join("; ") });
  }

  // --- Status — NEVER "approved" / "clear". A final determination is a human's. ---
  let screeningStatus: ScreeningStatus;
  if (escalationReasons.length > 0) {
    screeningStatus = "escalate";
  } else if (missingDocuments.length > 0 || anyPending || documentsAbsent) {
    screeningStatus = "incomplete";
  } else {
    screeningStatus = "clear_for_review";
  }

  // --- Missing material fields ---
  const missingFields = MATERIAL_FIELDS.filter(([k]) => isFieldMissing(input, k)).map(([, label]) => label);

  // --- Recommended action — ALWAYS ends by deferring to a compliance officer. ---
  let actionLede: string;
  if (screeningStatus === "escalate") {
    actionLede = `Route this exception to a compliance officer for review: ${escalationReasons.join("; ")}.`;
  } else if (screeningStatus === "incomplete") {
    const gaps: string[] = [];
    if (documentsAbsent) gaps.push("collect identity documentation");
    else if (missingDocuments.length) gaps.push(`obtain missing documents (${missingDocuments.join(", ")})`);
    if (anyPending) gaps.push("resolve pending screening checks");
    if (expiringDocuments.length) gaps.push(`refresh expiring documents (${expiringDocuments.join(", ")})`);
    actionLede = `Screening file is incomplete — ${gaps.length ? gaps.join("; ") : "gather the outstanding items"}, then re-screen.`;
  } else {
    const caveat = expiringDocuments.length ? ` Note expiring documents (${expiringDocuments.join(", ")}).` : "";
    actionLede = `No exceptions detected on the rules grid; the file is prepared for compliance review.${caveat}`;
  }
  const recommendedAction = `${actionLede} ${OFFICER_DETERMINATION}`;

  // --- Completeness + confidence ---
  const completeness = round2((MATERIAL_FIELDS.length - missingFields.length) / MATERIAL_FIELDS.length);
  const confidence = Math.max(0.2, Math.min(0.95, 0.4 + completeness * 0.5 + (escalationReasons.length ? 0.1 : 0)));

  const structured: KycScreenOutput = {
    screeningStatus,
    documentCompleteness,
    missingDocuments,
    expiringDocuments,
    failedChecks,
    escalationReasons,
    missingFields,
    recommendedAction,
  };

  const narrative =
    `KYC/AML screening of ${subjectName}${subjectType ? ` (${subjectType})` : ""}: ${screeningStatus.toUpperCase()}. ` +
    `${escalationReasons.length ? `Escalation reasons: ${escalationReasons.join("; ")}. ` : ""}` +
    `Document completeness ${documentCompleteness}${missingDocuments.length ? `, missing: ${missingDocuments.join(", ")}` : ""}` +
    `${expiringDocuments.length ? `, expiring: ${expiringDocuments.join(", ")}` : ""}. ` +
    `This skill never approves onboarding and never makes a final compliance determination — ${OFFICER_DETERMINATION}`;

  return { structured, narrative, sources, confidence, completeness, missingData: missingFields };
};

// ---------------------------------------------------------------------------
// Schemas + manifest
// ---------------------------------------------------------------------------

const inputSchema: JsonSchema = {
  type: "object",
  required: ["subjectName"],
  properties: {
    subjectName: { type: "string", minLength: 1 },
    subjectType: { type: "string", enum: ["individual", "entity"] },
    documents: {
      type: "array",
      items: {
        type: "object",
        required: ["type"],
        properties: {
          type: { type: "string", minLength: 1 },
          present: { type: "boolean" },
          expiresAt: { type: "string" },
        },
      },
    },
    checks: {
      type: "array",
      items: {
        type: "object",
        required: ["name"],
        properties: {
          name: { type: "string", minLength: 1 },
          result: { type: "string", enum: ["pass", "fail", "pending"] },
        },
      },
    },
    pepFlag: { type: "boolean" },
    sanctionsHit: { type: "boolean" },
  },
};

const outputSchema: JsonSchema = {
  type: "object",
  required: ["screeningStatus", "documentCompleteness", "escalationReasons", "recommendedAction"],
  properties: {
    screeningStatus: { type: "string", enum: ["clear_for_review", "incomplete", "escalate"] },
    documentCompleteness: { type: "number", minimum: 0, maximum: 1 },
    missingDocuments: { type: "array", items: { type: "string" } },
    expiringDocuments: { type: "array", items: { type: "string" } },
    failedChecks: { type: "array", items: { type: "string" } },
    escalationReasons: { type: "array", items: { type: "string" } },
    missingFields: { type: "array", items: { type: "string" } },
    recommendedAction: { type: "string" },
  },
};

export const kycScreenManifest: SkillManifest = {
  id: "kyc-screen",
  name: "KYC / AML Screening",
  version: "1.0.0",
  owner: "fundexecs",
  hub: "run",
  applicableExecutives: ["risk_compliance"],
  supportedEntityTypes: ["subject", "investor", "counterparty"],
  requiredInputs: ["subjectName"],
  optionalInputs: ["subjectType", "documents", "checks", "pepFlag", "sanctionsHit"],
  outputs: ["screeningStatus", "documentCompleteness", "missingDocuments", "expiringDocuments", "failedChecks", "escalationReasons", "missingFields", "recommendedAction"],
  artifactTypes: ["risk_report"],
  dataPermissions: ["subject:read", "screening:read"],
  tools: [],
  approvalTier: 1,
  riskClassification: "elevated",
  executionTimeoutMs: 15_000,
  retryPolicy: { maxAttempts: 1, backoffMs: 0 },
  validationRules: [
    "input matches input.schema.json",
    "output matches output.schema.json",
    "screeningStatus is never 'approved' — this skill makes no final determination",
    "exceptions are routed to a compliance officer, never auto-cleared",
  ],
  evaluationCriteria: [
    "correct screeningStatus on golden cases (never 'approved')",
    "sanctions hit, PEP flag, and failed checks always escalate",
    "missing documents / checks flagged, never invented",
    "recommendedAction always defers the final determination to a compliance officer",
  ],
  providerCapabilities: ["structured_extraction"],
  allowedDownstreamSkills: ["policy-check"],
  prohibitedActions: ["sign_document", "execute_subdoc", "move_capital"],
  inputSchema,
  outputSchema,
};

export const kycScreen: SkillDefinition<KycScreenInput, KycScreenOutput> = {
  manifest: kycScreenManifest,
  run,
};
