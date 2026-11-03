// lib/skills/catalog/data-room-prep.ts
// Data Room Preparation (PE department · Exit 06). Builds the index by workstream,
// maps every expected buyer request to a document or a gap, lists documents that
// need redaction or staged release, and opens a Q&A log row for each gap. It indexes
// what it is told about; confidentiality obligations to third parties in contracts
// are for counsel. Counsel approves the redaction list before the room opens.
// Pure core.

import type { JsonSchema, SkillCore, SkillCoreResult, SkillDefinition, SkillManifest, SkillSource } from "@/lib/skills/types";

export type Sensitivity = "normal" | "competitor-sensitive" | "personal-data" | "third-party-confidential";

export interface DocIn {
  name: string;
  workstream: string;
  sensitivity?: Sensitivity;
  /** Already redacted. */
  redacted?: boolean;
  /** Held back for a later round. */
  staged?: boolean;
  /** Ids of buyer requests this document answers. */
  answers?: string[];
}

export interface RequestIn {
  id: string;
  workstream: string;
  request: string;
}

export interface DataRoomInput {
  company: string;
  documents: DocIn[];
  /** The buyer request list / VDD scope. Absent = the labelled generic default list. */
  expectedRequests?: RequestIn[];
  qaOwner?: string;
  qaResponseHours?: number;
  gateOwner?: string;
}

export interface DataRoomOutput {
  index: Array<{ workstream: string; documents: string[] }>;
  coverage: Array<{ requestId: string; request: string; workstream: string; documents: string[]; status: "covered" | "gap" }>;
  gaps: string[];
  redactionList: Array<{ document: string; sensitivity: Sensitivity; action: string }>;
  qaLog: Array<{ ref: string; question: string; owner: string | null; respondWithinHours: number | null }>;
  requestListIsDefault: boolean;
  limitation: string;
  gate: string;
}

/** A labelled generic list — NOT a substitute for the buyer's real request list. */
export const DEFAULT_REQUESTS: RequestIn[] = [
  { id: "fin-1", workstream: "financial", request: "Audited accounts, last three years" },
  { id: "fin-2", workstream: "financial", request: "Monthly management accounts, last 24 months and LTM" },
  { id: "fin-3", workstream: "financial", request: "Budget and forecast with assumptions" },
  { id: "fin-4", workstream: "financial", request: "Net debt and debt-like items schedule" },
  { id: "com-1", workstream: "commercial", request: "Revenue by customer by month, 24 months" },
  { id: "com-2", workstream: "commercial", request: "Top-20 customer contracts" },
  { id: "leg-1", workstream: "legal", request: "Corporate structure chart and constitutional documents" },
  { id: "leg-2", workstream: "legal", request: "Material contracts including change-of-control terms" },
  { id: "leg-3", workstream: "legal", request: "Litigation and claims register" },
  { id: "tax-1", workstream: "tax", request: "Tax returns and correspondence, last three years" },
  { id: "hr-1", workstream: "people", request: "Employee census and key-employee contracts" },
  { id: "ops-1", workstream: "operational", request: "Insurance schedule and claims history" },
  { id: "tech-1", workstream: "technology", request: "IT systems overview and security assessments" },
];

const norm = (s: string) => s.toLowerCase().trim();

const run: SkillCore<DataRoomInput, DataRoomOutput> = (input): SkillCoreResult<DataRoomOutput> => {
  const sources: SkillSource[] = [];
  const missingData: string[] = [];
  const requests = input.expectedRequests?.length ? input.expectedRequests : DEFAULT_REQUESTS;
  const requestListIsDefault = !input.expectedRequests?.length;
  if (requestListIsDefault) {
    sources.push({ label: "Buyer request list", kind: "assumption", value: "generic default list (13 requests)", ref: "supply the buyer's or VDD scope list" });
    missingData.push("The buyer's real request list — coverage was checked against a generic default");
  }

  const byWs = new Map<string, string[]>();
  for (const d of input.documents) byWs.set(d.workstream, [...(byWs.get(d.workstream) ?? []), d.name]);
  const index = [...byWs.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([workstream, documents]) => ({ workstream, documents: documents.sort() }));

  const coverage: DataRoomOutput["coverage"] = requests.map((r) => {
    const docs = input.documents.filter((d) => (d.answers ?? []).some((a) => norm(a) === norm(r.id))).map((d) => d.name);
    return { requestId: r.id, request: r.request, workstream: r.workstream, documents: docs, status: docs.length ? "covered" : "gap" };
  });
  const gaps = coverage.filter((c) => c.status === "gap").map((c) => `${c.requestId}: ${c.request}`);

  // Documents mapped to an id that is not on the request list (typos hide gaps).
  const known = new Set(requests.map((r) => norm(r.id)));
  for (const d of input.documents) for (const a of d.answers ?? []) if (!known.has(norm(a))) missingData.push(`${d.name}: answers unknown request id "${a}"`);

  const redactionList: DataRoomOutput["redactionList"] = [];
  for (const d of input.documents) {
    const s = d.sensitivity ?? "normal";
    if (s === "normal") continue;
    if (s === "competitor-sensitive" && !d.staged) redactionList.push({ document: d.name, sensitivity: s, action: "Stage for a later round or clean-team only; not for the open room." });
    else if (s === "personal-data" && !d.redacted) redactionList.push({ document: d.name, sensitivity: s, action: "Redact or anonymise personal data before release." });
    else if (s === "third-party-confidential") redactionList.push({ document: d.name, sensitivity: s, action: "Counsel to check the confidentiality obligation before release." });
  }

  const owner = input.qaOwner?.trim() || null;
  const hours = typeof input.qaResponseHours === "number" ? input.qaResponseHours : null;
  if (!owner) missingData.push("Q&A owner not named");
  if (hours === null) missingData.push("Q&A response time not set");
  const qaLog = coverage.filter((c) => c.status === "gap").map((c, i) => ({ ref: `QA-${String(i + 1).padStart(3, "0")}`, question: `Buyer request ${c.requestId} has no document: ${c.request}`, owner, respondWithinHours: hours }));

  const gateOwner = input.gateOwner?.trim() || "Counsel";
  const gate = `${gateOwner} approves the redaction list before the room opens.`;
  const limitation = "The skill indexes what it is told about. It cannot judge confidentiality obligations to third parties in contracts; counsel must check.";
  const narrative = `Data room, ${input.company}: ${input.documents.length} document(s) indexed across ${index.length} workstream(s); ${coverage.length - gaps.length}/${coverage.length} expected requests covered, ${gaps.length} gap(s); ${redactionList.length} document(s) on the redaction/staging list. ${gate}`;

  const completeness = coverage.length ? Math.round(((coverage.length - gaps.length) / coverage.length) * 100) / 100 : 0;
  return { structured: { index, coverage, gaps, redactionList, qaLog, requestListIsDefault, limitation, gate }, narrative, sources, confidence: Math.max(0.3, Math.min(0.85, 0.35 + completeness * 0.45 - (requestListIsDefault ? 0.1 : 0))), completeness, missingData };
};

const inputSchema: JsonSchema = {
  type: "object",
  required: ["company", "documents"],
  properties: {
    company: { type: "string", minLength: 1 },
    documents: {
      type: "array",
      items: {
        type: "object",
        required: ["name", "workstream"],
        properties: {
          name: { type: "string", minLength: 1 },
          workstream: { type: "string", minLength: 1 },
          sensitivity: { type: "string", enum: ["normal", "competitor-sensitive", "personal-data", "third-party-confidential"] },
          redacted: { type: "boolean" },
          staged: { type: "boolean" },
          answers: { type: "array", items: { type: "string" } },
        },
      },
    },
    expectedRequests: { type: "array", items: { type: "object", required: ["id", "workstream", "request"], properties: { id: { type: "string", minLength: 1 }, workstream: { type: "string" }, request: { type: "string" } } } },
    qaOwner: { type: "string" },
    qaResponseHours: { type: "number", minimum: 0 },
    gateOwner: { type: "string" },
  },
};

const outputSchema: JsonSchema = {
  type: "object",
  required: ["index", "coverage", "gaps", "redactionList", "qaLog", "requestListIsDefault", "limitation", "gate"],
  properties: {
    index: { type: "array", items: { type: "object", required: ["workstream", "documents"] } },
    coverage: { type: "array", items: { type: "object", required: ["requestId", "request", "status"] } },
    gaps: { type: "array", items: { type: "string" } },
    redactionList: { type: "array", items: { type: "object", required: ["document", "sensitivity", "action"] } },
    qaLog: { type: "array", items: { type: "object", required: ["ref", "question"] } },
    requestListIsDefault: { type: "boolean" },
    limitation: { type: "string" },
    gate: { type: "string" },
  },
};

export const dataRoomPrepManifest: SkillManifest = {
  id: "data-room-prep",
  name: "Data Room Preparation",
  version: "1.0.0",
  owner: "fundexecs",
  hub: "execute",
  applicableExecutives: ["legal_closing", "diligence"],
  supportedEntityTypes: ["asset", "deal", "company"],
  requiredInputs: ["company", "documents"],
  optionalInputs: ["expectedRequests", "qaOwner", "qaResponseHours", "gateOwner"],
  outputs: ["index", "coverage", "gaps", "redactionList", "qaLog", "gate"],
  artifactTypes: ["analysis"],
  dataPermissions: ["document:read", "data_room:read"],
  tools: [],
  approvalTier: 1,
  riskClassification: "moderate",
  executionTimeoutMs: 10_000,
  retryPolicy: { maxAttempts: 1, backoffMs: 0 },
  validationRules: ["input matches input.schema.json", "output matches output.schema.json", "every expected request maps to a document or a gap", "competitor-sensitive documents are staged"],
  evaluationCriteria: ["gaps listed", "competitor-sensitive not staged flagged", "default request list labelled", "unknown request ids reported"],
  providerCapabilities: ["structured_extraction"],
  allowedDownstreamSkills: ["exit-readiness", "buyer-list"],
  prohibitedActions: ["send_outreach", "distribute_report", "share_materials", "sign_document", "move_capital"],
  inputSchema,
  outputSchema,
};

export const dataRoomPrep: SkillDefinition<DataRoomInput, DataRoomOutput> = { manifest: dataRoomPrepManifest, run };
