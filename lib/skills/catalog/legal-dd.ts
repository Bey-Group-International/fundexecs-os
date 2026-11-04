// lib/skills/catalog/legal-dd.ts
// Legal DD Issues List (PE department · Due Diligence 04). Turns the legal data room
// into a ranked issues list for counsel, so counsel's time goes to the issues that matter:
//   * a contract abstract table (parties, term, change of control, exclusivity, assignment,
//     termination rights, liability cap) — a field not stated stays "not stated", never guessed;
//   * issues ranked red / amber / green with the document and clause they rest on;
//   * missing documents listed as gaps; categories not reviewed named;
//   * change-of-control, exclusivity and IP-title issues derived by stated rules from the abstract.
// This is an issues list for counsel, not legal advice. Counsel signs. Pure core.

import type {
  JsonSchema,
  SkillCore,
  SkillCoreResult,
  SkillDefinition,
  SkillManifest,
  SkillSource,
} from "@/lib/skills/types";
import {
  documentGaps,
  issueInSchema,
  rankIssues,
  toRedFlagHandoff,
  type IssueIn,
  type IssueOut,
  type RedFlagHandoff,
} from "@/lib/pe/dd-issues";

export const LEGAL_CATEGORIES = [
  "contract",
  "litigation",
  "regulatory",
  "ip",
  "corporate",
  "employment",
] as const;
export type LegalCategory = (typeof LEGAL_CATEGORIES)[number];
const DEFAULT_EXPECTED_DOCUMENTS = [
  "material contracts",
  "corporate records",
  "litigation file",
  "ip register",
  "employment contracts",
];

export type ChangeOfControl =
  | "consent-required"
  | "termination-right"
  | "notice-only"
  | "none"
  | "unknown";
export type Exclusivity = "yes" | "no" | "unknown";

export interface ContractIn {
  name: string;
  counterparty?: string;
  term?: string;
  changeOfControl?: ChangeOfControl;
  exclusivity?: Exclusivity;
  assignment?: string;
  terminationRights?: string;
  liabilityCap?: string;
  documentRef?: string;
  /** Clause the change-of-control (or exclusivity) position rests on. */
  clauseRef?: string;
}

export interface IpAssetIn {
  name: string;
  ownerOfRecord?: string;
  /** What shows the target holds title. "none" and "unknown" raise an issue. */
  titleEvidence?: "assignment" | "registration" | "none" | "unknown";
  documentRef?: string;
}

export interface LegalDdInput {
  dealName?: string;
  /** What the data room contains, by name. Compared to the expected list. */
  documentsReceived?: string[];
  /** Defaults to the five standard legal data room folders. */
  expectedDocuments?: string[];
  contracts?: ContractIn[];
  ipAssets?: IpAssetIn[];
  issues?: IssueIn[];
  /** Categories counsel or the team has actually reviewed. */
  categoriesReviewed?: LegalCategory[];
  gateOwner?: string;
}

export interface AbstractRow {
  name: string;
  counterparty: string | null;
  term: string | null;
  changeOfControl: ChangeOfControl;
  exclusivity: Exclusivity;
  assignment: string | null;
  terminationRights: string | null;
  liabilityCap: string | null;
  documentRef: string | null;
  /** Which of the seven abstract fields are not stated. */
  notStated: string[];
}

export interface LegalDdOutput {
  issues: IssueOut[];
  counts: { red: number; amber: number; green: number };
  abstract: AbstractRow[];
  documentGaps: string[];
  notReviewed: LegalCategory[];
  uncited: string[];
  duplicatesMerged: number;
  derivedCount: number;
  handoff: { findings: RedFlagHandoff[]; needingImpact: string[] };
  limitation: string;
  note: string;
  gate: string;
}

const present = (s: string | undefined) =>
  typeof s === "string" && s.trim() ? s.trim() : null;

function abstractRow(c: ContractIn): AbstractRow {
  const row: Omit<AbstractRow, "notStated"> = {
    name: c.name.trim(),
    counterparty: present(c.counterparty),
    term: present(c.term),
    changeOfControl: c.changeOfControl ?? "unknown",
    exclusivity: c.exclusivity ?? "unknown",
    assignment: present(c.assignment),
    terminationRights: present(c.terminationRights),
    liabilityCap: present(c.liabilityCap),
    documentRef: present(c.documentRef),
  };
  const notStated: string[] = [];
  if (!row.counterparty) notStated.push("parties");
  if (!row.term) notStated.push("term");
  if (row.changeOfControl === "unknown") notStated.push("change of control");
  if (row.exclusivity === "unknown") notStated.push("exclusivity");
  if (!row.assignment) notStated.push("assignment");
  if (!row.terminationRights) notStated.push("termination rights");
  if (!row.liabilityCap) notStated.push("liability cap");
  return { ...row, notStated };
}

/** Issues the abstract implies, by stated rules. Ratings are conservative defaults; counsel re-rates. */
function derive(contracts: ContractIn[], ipAssets: IpAssetIn[]): IssueIn[] {
  const out: IssueIn[] = [];
  for (const c of contracts) {
    const name = c.name.trim();
    const doc = present(c.documentRef) ?? undefined;
    const clause = present(c.clauseRef) ?? undefined;
    const cp = present(c.counterparty);
    const label = cp ? `${name} (${cp})` : name;
    const coc = c.changeOfControl ?? "unknown";
    if (coc === "consent-required" || coc === "termination-right") {
      out.push({
        title: `Change of control: ${label} — ${coc === "consent-required" ? "counterparty consent required" : "counterparty may terminate"}`,
        rating: "amber",
        category: "contract",
        documentRef: doc,
        clauseRef: clause,
        evidenceGrade: "A",
        question:
          "Is the consent or waiver obtainable before signing, and on what terms?",
        derived: true,
      });
    } else if (coc === "unknown") {
      out.push({
        title: `Change of control unconfirmed: ${label}`,
        rating: "amber",
        category: "contract",
        documentRef: doc,
        clauseRef: clause,
        evidenceGrade: "U",
        question:
          "What does the contract say on change of control? Read the clause before relying on this contract.",
        derived: true,
      });
    }
    if (c.exclusivity === "yes") {
      out.push({
        title: `Exclusivity: ${label}`,
        rating: "amber",
        category: "contract",
        documentRef: doc,
        clauseRef: clause,
        evidenceGrade: "A",
        question:
          "What does the exclusivity restrict, for how long, and does it bind the buyer's other portfolio companies?",
        derived: true,
      });
    }
  }
  for (const a of ipAssets) {
    const t = a.titleEvidence ?? "unknown";
    if (t === "none" || t === "unknown") {
      out.push({
        title: `IP title unconfirmed: ${a.name.trim()}`,
        rating: "amber",
        category: "ip",
        documentRef: present(a.documentRef) ?? undefined,
        evidenceGrade: "U",
        question:
          t === "none"
            ? "No assignment or registration shows the target owns this. What chain of title exists?"
            : "Obtain the assignment or registration that shows title.",
        derived: true,
      });
    }
  }
  return out;
}

const run: SkillCore<LegalDdInput, LegalDdOutput> = (
  input,
): SkillCoreResult<LegalDdOutput> => {
  const sources: SkillSource[] = [];
  const missingData: string[] = [];
  const contracts = (input.contracts ?? []).filter((c) => c && present(c.name));
  const ipAssets = (input.ipAssets ?? []).filter((a) => a && present(a.name));
  const supplied = input.issues ?? [];

  const abstract = contracts.map(abstractRow);
  const derived = derive(contracts, ipAssets);
  const all = [...supplied.map((i) => ({ ...i, derived: false })), ...derived];
  const ranked = rankIssues(all, {
    requireClause: true,
    defaultCategory: "contract",
  });

  const expected = input.expectedDocuments?.length
    ? input.expectedDocuments
    : DEFAULT_EXPECTED_DOCUMENTS;
  if (!input.expectedDocuments?.length)
    sources.push({
      label: "Expected documents",
      kind: "assumption",
      value: DEFAULT_EXPECTED_DOCUMENTS.join(", "),
      ref: "standing list of legal data room folders",
    });
  const gaps =
    input.documentsReceived === undefined
      ? expected
      : documentGaps(expected, input.documentsReceived);
  if (input.documentsReceived === undefined)
    missingData.push(
      "What the data room contains was not supplied — every expected document is shown as a gap",
    );
  else if (gaps.length)
    missingData.push(`Documents not received: ${gaps.join(", ")}`);

  const reviewed = new Set(input.categoriesReviewed ?? []);
  const notReviewed = LEGAL_CATEGORIES.filter((c) => !reviewed.has(c));
  if (!input.categoriesReviewed?.length)
    missingData.push(
      "No review coverage stated — none of the legal categories is shown as reviewed",
    );
  else if (notReviewed.length)
    missingData.push(`Not reviewed: ${notReviewed.join(", ")}`);

  if (contracts.length === 0)
    missingData.push("No contracts abstracted — the abstract table is empty");
  for (const r of abstract)
    if (r.notStated.length)
      missingData.push(`${r.name}: not stated — ${r.notStated.join(", ")}`);
  if (ranked.uncited.length)
    missingData.push(
      `${ranked.uncited.length} issue${ranked.uncited.length === 1 ? "" : "s"} cite no document and clause: ${ranked.uncited.join("; ")}`,
    );

  for (const r of abstract)
    sources.push({
      label: `Contract: ${r.name}`,
      kind: "fact",
      value: r.counterparty ?? "counterparty not stated",
      ref: r.documentRef ?? undefined,
    });
  const derivedCount = ranked.issues.filter((i) => i.derived).length;
  if (derivedCount)
    sources.push({
      label: "Issues derived from the abstract",
      kind: "calculation",
      value: derivedCount,
      ref: "change of control, exclusivity and IP title rules",
    });

  const handoff = toRedFlagHandoff(ranked.issues, "legal");
  const gateOwner = input.gateOwner?.trim() || "Deal counsel";
  const gate = `${gateOwner} reviews and owns the legal findings.`;
  const limitation =
    "This is an issues list for counsel. It is not legal advice and does not replace a legal DD report. Counsel signs.";
  const { red, amber, green } = ranked.counts;
  const note =
    ranked.issues.length === 0
      ? "No legal issues were supplied or derived. That is not a clean bill: " +
        (gaps.length ? "documents are missing, and " : "") +
        "the list reflects only what was reviewed."
      : `${ranked.issues.length} legal issue${ranked.issues.length === 1 ? "" : "s"}: ${red} red, ${amber} amber, ${green} green${derivedCount ? ` (${derivedCount} derived from the contract abstract)` : ""}. ${gaps.length ? `${gaps.length} expected document${gaps.length === 1 ? "" : "s"} not received. ` : ""}${ranked.uncited.length ? `${ranked.uncited.length} cite no document and clause and are graded U. ` : ""}`.trim();

  const structured: LegalDdOutput = {
    issues: ranked.issues,
    counts: ranked.counts,
    abstract,
    documentGaps: gaps,
    notReviewed,
    uncited: ranked.uncited,
    duplicatesMerged: ranked.duplicatesMerged,
    derivedCount,
    handoff,
    limitation,
    note,
    gate,
  };
  const completeness =
    Math.round(
      (((contracts.length ? 1 : 0) +
        (input.documentsReceived !== undefined ? 1 : 0) +
        (input.categoriesReviewed?.length ? 1 : 0) +
        (ranked.uncited.length === 0 && ranked.issues.length > 0 ? 1 : 0)) /
        4) *
        100,
    ) / 100;
  return {
    structured,
    narrative: `${note} ${limitation} ${gate}`,
    sources,
    confidence: Math.max(0.2, Math.min(0.8, 0.3 + completeness * 0.45)),
    completeness,
    missingData,
  };
};

const contractSchema: JsonSchema = {
  type: "object",
  required: ["name"],
  properties: {
    name: { type: "string" },
    counterparty: { type: "string" },
    term: { type: "string" },
    changeOfControl: {
      type: "string",
      enum: [
        "consent-required",
        "termination-right",
        "notice-only",
        "none",
        "unknown",
      ],
    },
    exclusivity: { type: "string", enum: ["yes", "no", "unknown"] },
    assignment: { type: "string" },
    terminationRights: { type: "string" },
    liabilityCap: { type: "string" },
    documentRef: { type: "string" },
    clauseRef: { type: "string" },
  },
};
const strList: JsonSchema = { type: "array", items: { type: "string" } };
const category: JsonSchema = { type: "string", enum: [...LEGAL_CATEGORIES] };

const inputSchema: JsonSchema = {
  type: "object",
  properties: {
    dealName: { type: "string" },
    documentsReceived: strList,
    expectedDocuments: strList,
    contracts: { type: "array", items: contractSchema },
    ipAssets: {
      type: "array",
      items: {
        type: "object",
        required: ["name"],
        properties: {
          name: { type: "string" },
          ownerOfRecord: { type: "string" },
          titleEvidence: {
            type: "string",
            enum: ["assignment", "registration", "none", "unknown"],
          },
          documentRef: { type: "string" },
        },
      },
    },
    issues: { type: "array", items: issueInSchema },
    categoriesReviewed: { type: "array", items: category },
    gateOwner: { type: "string" },
  },
};

const outputSchema: JsonSchema = {
  type: "object",
  required: [
    "issues",
    "counts",
    "abstract",
    "documentGaps",
    "notReviewed",
    "uncited",
    "duplicatesMerged",
    "derivedCount",
    "handoff",
    "limitation",
    "note",
    "gate",
  ],
  properties: {
    issues: {
      type: "array",
      items: {
        type: "object",
        required: [
          "rank",
          "title",
          "rating",
          "category",
          "evidenceGrade",
          "cited",
          "derived",
          "notes",
        ],
        properties: {
          rank: { type: "number" },
          title: { type: "string" },
          rating: { type: "string", enum: ["red", "amber", "green"] },
          category: { type: "string" },
          evidenceGrade: { type: "string", enum: ["A", "B", "C", "U"] },
          cited: { type: "boolean" },
          derived: { type: "boolean" },
          notes: strList,
        },
      },
    },
    counts: {
      type: "object",
      required: ["red", "amber", "green"],
      properties: {
        red: { type: "number" },
        amber: { type: "number" },
        green: { type: "number" },
      },
    },
    abstract: {
      type: "array",
      items: {
        type: "object",
        required: ["name", "changeOfControl", "exclusivity", "notStated"],
        properties: {
          name: { type: "string" },
          changeOfControl: { type: "string" },
          exclusivity: { type: "string" },
          notStated: strList,
        },
      },
    },
    documentGaps: strList,
    notReviewed: { type: "array", items: category },
    uncited: strList,
    duplicatesMerged: { type: "number" },
    derivedCount: { type: "number" },
    handoff: {
      type: "object",
      required: ["findings", "needingImpact"],
      properties: { findings: { type: "array" }, needingImpact: strList },
    },
    limitation: { type: "string" },
    note: { type: "string" },
    gate: { type: "string" },
  },
};

export const legalDdManifest: SkillManifest = {
  id: "legal-dd",
  name: "Legal DD Issues List",
  version: "1.0.0",
  owner: "fundexecs",
  hub: "run",
  applicableExecutives: ["diligence", "legal_closing"],
  supportedEntityTypes: ["deal"],
  requiredInputs: [],
  optionalInputs: [
    "documentsReceived",
    "expectedDocuments",
    "contracts",
    "ipAssets",
    "issues",
    "categoriesReviewed",
    "gateOwner",
  ],
  outputs: [
    "issues",
    "abstract",
    "documentGaps",
    "notReviewed",
    "handoff",
    "note",
    "gate",
  ],
  artifactTypes: ["analysis"],
  dataPermissions: ["deal:read", "document:read", "data_room:read"],
  tools: [],
  approvalTier: 1,
  riskClassification: "moderate",
  executionTimeoutMs: 15_000,
  retryPolicy: { maxAttempts: 1, backoffMs: 0 },
  validationRules: [
    "input matches input.schema.json",
    "output matches output.schema.json",
    "every issue cites a document and clause or is graded U",
    "missing documents listed as gaps",
    "no rating invented for supplied issues",
  ],
  evaluationCriteria: [
    "uncited issues flagged",
    "document gaps listed",
    "contract abstract fields not stated are named",
    "states it is not legal advice",
    "counsel named as the gate",
  ],
  providerCapabilities: ["structured_extraction"],
  allowedDownstreamSkills: ["red-flag-register", "dd-checklist"],
  prohibitedActions: [
    "send_outreach",
    "distribute_report",
    "sign_document",
    "move_capital",
    "capital_call",
    "submit_term_sheet",
  ],
  inputSchema,
  outputSchema,
};

export const legalDd: SkillDefinition<LegalDdInput, LegalDdOutput> = {
  manifest: legalDdManifest,
  run,
};
