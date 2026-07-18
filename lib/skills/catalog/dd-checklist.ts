// lib/skills/catalog/dd-checklist.ts
// Native skill: assemble a workstream-organized diligence REQUEST LIST for a deal.
// Pure, deterministic core — it PREPARES the list of items to request from a
// target; it never SENDS the request out (that is a separate Tier-2 action,
// `send_diligence_request`, prohibited here). The base catalog is a standard PE
// template, so those items are labelled `generated` (a starting request list to
// confirm), not facts about the company. Tailoring is simple, additive, and
// rule-based off the deal's sector / transaction type.

import type { JsonSchema, SkillCore, SkillCoreResult, SkillDefinition, SkillManifest, SkillSource } from "@/lib/skills/types";

// ---------------------------------------------------------------------------
// I/O types
// ---------------------------------------------------------------------------

export interface DdChecklistDeal {
  companyName: string;
  sector?: string;
  transactionType?: string;
  dealSize?: number;
}

export interface DdChecklistInput {
  deal: DdChecklistDeal;
  /** Optional filter — if provided, only these workstream keys are included. */
  workstreams?: string[];
}

export type WorkstreamPriority = "high" | "medium";

export interface DdChecklistWorkstream {
  key: string;
  label: string;
  priority: WorkstreamPriority;
  requests: string[];
}

export interface DdChecklistOutput {
  workstreams: DdChecklistWorkstream[];
  totalRequests: number;
  /** Which tailoring rules fired, as operator-facing notes. */
  tailoredFor: string[];
  /** Material context that was absent (e.g. sector), surfaced not invented. */
  missingContext: string[];
  recommendedAction: string;
}

// ---------------------------------------------------------------------------
// Base catalog — a standard PE diligence request template (16 workstreams).
// These are GENERATED template items, not facts about the target.
// ---------------------------------------------------------------------------

interface WorkstreamSpec {
  key: string;
  label: string;
  base: string[];
}

// Canonical order is the source of truth for output ordering.
const CATALOG: WorkstreamSpec[] = [
  {
    key: "financial",
    label: "Financial",
    base: [
      "Audited financial statements (3 years)",
      "Monthly management accounts (TTM)",
      "Quality of earnings / EBITDA normalization schedule",
      "Working capital analysis (last 24 months)",
      "Revenue by customer and segment",
    ],
  },
  {
    key: "commercial",
    label: "Commercial",
    base: [
      "Market sizing and growth outlook",
      "Competitive landscape and win/loss analysis",
      "Pipeline and backlog by stage",
      "Pricing model and discounting history",
    ],
  },
  {
    key: "legal",
    label: "Legal",
    base: [
      "Corporate organizational chart and subsidiary list",
      "Material contracts and change-of-control provisions",
      "Litigation, claims, and dispute schedule",
      "Permits, licenses, and consents register",
    ],
  },
  {
    key: "tax",
    label: "Tax",
    base: [
      "Federal, state, and local tax returns (3 years)",
      "Tax attributes (NOLs, credits) schedule",
      "Transfer pricing documentation",
      "Sales/use and indirect tax nexus analysis",
    ],
  },
  {
    key: "operational",
    label: "Operational",
    base: [
      "Facilities, lease, and site list",
      "Supply chain and procurement overview",
      "Capacity utilization and throughput metrics",
      "Business continuity and disaster recovery plans",
    ],
  },
  {
    key: "technology",
    label: "Technology",
    base: [
      "Technology architecture and systems inventory",
      "Product roadmap and development pipeline",
      "IT spend and capitalization policy",
    ],
  },
  {
    key: "cybersecurity",
    label: "Cybersecurity",
    base: [
      "Information security policies and controls",
      "Incident history and breach disclosures",
      "Penetration test and vulnerability scan results",
    ],
  },
  {
    key: "human_capital",
    label: "Human Capital",
    base: [
      "Organizational chart and headcount by function",
      "Compensation, benefits, and equity plans",
      "Key employee agreements and retention terms",
      "Employee turnover and engagement metrics",
    ],
  },
  {
    key: "environmental",
    label: "Environmental",
    base: [
      "Environmental permits and compliance history",
      "Phase I / II environmental site assessments",
      "Sustainability and emissions reporting",
    ],
  },
  {
    key: "insurance",
    label: "Insurance",
    base: [
      "Insurance policy schedule and coverage limits",
      "Claims history (5 years)",
      "Coverage gap and adequacy analysis",
    ],
  },
  {
    key: "regulatory",
    label: "Regulatory",
    base: [
      "Regulatory licenses and registrations",
      "Regulatory examination and audit history",
      "Compliance policies and procedures",
    ],
  },
  {
    key: "customer",
    label: "Customer",
    base: [
      "Customer concentration and top-20 revenue",
      "Contract terms, renewal, and churn rates",
      "Customer satisfaction / NPS data",
    ],
  },
  {
    key: "vendor",
    label: "Vendor",
    base: [
      "Top vendor and supplier list with spend",
      "Key supplier contracts and dependencies",
      "Vendor concentration and single-source risks",
    ],
  },
  {
    key: "ownership",
    label: "Ownership & Structure",
    base: [
      "Capitalization table and equity ownership",
      "Shareholder agreements and rights",
      "Legal entity and ownership structure chart",
    ],
  },
  {
    key: "debt",
    label: "Debt & Financing",
    base: [
      "Debt schedule and facility agreements",
      "Covenant compliance certificates",
      "Off-balance-sheet obligations and guarantees",
    ],
  },
  {
    key: "ip",
    label: "Intellectual Property",
    base: [
      "Patent, trademark, and copyright registry",
      "IP ownership and assignment agreements",
      "Open-source and third-party license inventory",
    ],
  },
];

// Workstreams that are structurally high-priority regardless of tailoring.
const HIGH_PRIORITY = new Set<string>(["financial", "commercial", "legal", "tax"]);

// ---------------------------------------------------------------------------
// Deterministic core
// ---------------------------------------------------------------------------

const SOFTWARE_RE = /software|saas|tech/i;
const CARVEOUT_RE = /carve\W?out|carve-out|carveout/i;
const REGULATED_RE = /health|financ|bank|insur/i;

const run: SkillCore<DdChecklistInput, DdChecklistOutput> = (input): SkillCoreResult<DdChecklistOutput> => {
  const { deal } = input;
  const sector = deal.sector ?? "";
  const transactionType = deal.transactionType ?? "";

  // Start from a deep copy of the base catalog so the module state is never mutated.
  const items = new Map<string, string[]>(CATALOG.map((w) => [w.key, [...w.base]]));
  const elevated = new Set<string>();
  const tailoredFor: string[] = [];

  // Tailoring rule 1 — software / tech sector: add code + security diligence.
  if (SOFTWARE_RE.test(sector)) {
    items.get("technology")!.push("Code ownership & open-source license audit");
    items.get("cybersecurity")!.push("SOC 2 / security posture review");
    elevated.add("technology");
    elevated.add("cybersecurity");
    tailoredFor.push("Software/tech sector — added code ownership and security posture items");
  }

  // Tailoring rule 2 — carve-out: standalone cost + TSA scope in operations.
  if (CARVEOUT_RE.test(transactionType)) {
    items.get("operational")!.push("TSA scope and standalone cost analysis");
    elevated.add("operational");
    tailoredFor.push("Carve-out — added TSA scope and standalone cost analysis to operational");
  }

  // Tailoring rule 3 — regulated sector: add regulatory approval + licensing items.
  if (REGULATED_RE.test(sector)) {
    items.get("regulatory")!.push("Regulatory approval and change-of-control filing requirements");
    items.get("regulatory")!.push("Regulatory capital / licensing adequacy review");
    elevated.add("regulatory");
    tailoredFor.push("Regulated sector — added regulatory approval and licensing items");
  }

  // Optional workstream filter — keep canonical order, ignore unknown keys.
  const filter = input.workstreams && input.workstreams.length > 0 ? new Set(input.workstreams) : null;
  const selected = CATALOG.filter((w) => (filter ? filter.has(w.key) : true));

  const workstreams: DdChecklistWorkstream[] = selected.map((w) => {
    const requests = items.get(w.key)!;
    const priority: WorkstreamPriority = HIGH_PRIORITY.has(w.key) || elevated.has(w.key) ? "high" : "medium";
    return { key: w.key, label: w.label, priority, requests };
  });

  const totalRequests = workstreams.reduce((sum, w) => sum + w.requests.length, 0);

  // The base catalog items are a GENERATED template, not facts — one source per
  // included workstream, so provenance is explicit at the runtime layer.
  const sources: SkillSource[] = workstreams.map((w) => ({
    label: `${w.label} diligence requests (template)`,
    kind: "generated",
    value: w.requests.length,
    ref: `catalog:${w.key}`,
  }));

  // Missing context — surfaced, never invented.
  const missingContext: string[] = [];
  if (!deal.sector) missingContext.push("Sector not provided — checklist not sector-tailored");
  if (!deal.transactionType) missingContext.push("Transaction type not provided — structure-specific items not added");
  if (deal.dealSize == null) missingContext.push("Deal size not provided — scope not calibrated to transaction size");

  const recommendedAction =
    filter && workstreams.length === 0
      ? "No matching workstreams for the requested filter — widen the workstream selection and regenerate."
      : missingContext.length > 0
        ? "Confirm and prioritize these template requests, fill in the missing deal context, then issue the diligence request list to the target for review."
        : "Confirm and prioritize these template requests, then issue the diligence request list to the target for review.";

  const structured: DdChecklistOutput = { workstreams, totalRequests, tailoredFor, missingContext, recommendedAction };

  // Completeness reflects how much tailoring context was supplied (3 fields).
  const providedContext = [deal.sector, deal.transactionType, deal.dealSize].filter((v) => v != null && v !== "").length;
  const completeness = Math.round((providedContext / 3) * 100) / 100;
  const confidence = Math.max(0.4, Math.min(0.9, 0.55 + completeness * 0.3));

  const tailorNote = tailoredFor.length ? ` Tailored for: ${tailoredFor.length} rule(s).` : " Base template only (no tailoring context).";
  const narrative =
    `Diligence request list for ${deal.companyName}: ${workstreams.length} workstream(s), ${totalRequests} request(s).` +
    tailorNote +
    " These are a standard starting request list to confirm — not facts about the company." +
    (missingContext.length ? ` Missing context: ${missingContext.length} item(s).` : "") +
    ` Next: ${recommendedAction}`;

  return { structured, narrative, sources, confidence, completeness, missingData: missingContext };
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
      required: ["companyName"],
      properties: {
        companyName: { type: "string", minLength: 1 },
        sector: { type: "string" },
        transactionType: { type: "string" },
        dealSize: { type: "number", minimum: 0 },
      },
    },
    workstreams: { type: "array", items: { type: "string" } },
  },
};

const outputSchema: JsonSchema = {
  type: "object",
  required: ["workstreams", "totalRequests", "recommendedAction"],
  properties: {
    workstreams: {
      type: "array",
      items: {
        type: "object",
        required: ["key", "label", "priority", "requests"],
        properties: {
          key: { type: "string" },
          label: { type: "string" },
          priority: { type: "string", enum: ["high", "medium"] },
          requests: { type: "array", items: { type: "string" } },
        },
      },
    },
    totalRequests: { type: "number", minimum: 0 },
    tailoredFor: { type: "array", items: { type: "string" } },
    missingContext: { type: "array", items: { type: "string" } },
    recommendedAction: { type: "string" },
  },
};

export const ddChecklistManifest: SkillManifest = {
  id: "dd-checklist",
  name: "Diligence Request List",
  version: "1.0.0",
  owner: "fundexecs",
  hub: "run",
  applicableExecutives: ["diligence"],
  supportedEntityTypes: ["deal", "company", "diligence_request"],
  requiredInputs: ["deal.companyName"],
  optionalInputs: ["deal.sector", "deal.transactionType", "deal.dealSize", "workstreams"],
  outputs: ["workstreams", "totalRequests", "tailoredFor", "missingContext", "recommendedAction"],
  artifactTypes: ["analysis"],
  dataPermissions: ["deal:read"],
  tools: [],
  approvalTier: 1,
  riskClassification: "low",
  executionTimeoutMs: 15_000,
  retryPolicy: { maxAttempts: 1, backoffMs: 0 },
  validationRules: ["input matches input.schema.json", "output matches output.schema.json", "base catalog items labelled generated, not facts"],
  evaluationCriteria: ["all 16 workstreams present by default", "tailoring is additive and rule-based", "missing context flagged not invented", "workstream filter respected"],
  providerCapabilities: ["structured_extraction"],
  allowedDownstreamSkills: ["dd-prep", "ic-memo"],
  prohibitedActions: ["send_diligence_request", "send_outreach", "sign_document"],
  inputSchema,
  outputSchema,
};

export const ddChecklist: SkillDefinition<DdChecklistInput, DdChecklistOutput> = {
  manifest: ddChecklistManifest,
  run,
};
