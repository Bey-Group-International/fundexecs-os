// lib/skills/catalog/cim.ts
// Native skill: assemble a Confidential Information Memorandum (CIM) DRAFT OUTLINE
// from caller-SUPPLIED deal facts. Pure, deterministic core — the tested path.
//
// This skill DRAFTS for review. It NEVER publishes, distributes, or shares (those
// are Tier-2, prohibited here). It NEVER invents financials: every figure comes
// from the supplied facts; a section with no supplied content is FLAGGED as a
// placeholder, never filled. Connective and framing prose is labelled `generated`;
// every supplied figure is a `fact` carried from input. Distribution of the
// finished CIM is a separate, gated action — this core prepares the draft only.

import type { JsonSchema, SkillCore, SkillCoreResult, SkillDefinition, SkillManifest, SkillSource } from "@/lib/skills/types";

// ---------------------------------------------------------------------------
// I/O types
// ---------------------------------------------------------------------------

export interface CimHistoricalRow {
  year: number;
  revenue?: number;
  ebitda?: number;
}

export interface CimManager {
  name?: string;
  role?: string;
}

export interface CimDeal {
  codename?: string;
  sector?: string;
  description?: string;
  revenue?: number;
  ebitda?: number;
  growthRate?: number;
  historicalFinancials?: CimHistoricalRow[];
  products?: string[];
  management?: CimManager[];
  marketNotes?: string;
  transactionAsk?: string;
}

export interface CimInput {
  deal: CimDeal;
  /** When true (default), omit any real names and name the deal by codename only. */
  anonymize?: boolean;
}

export type CimSectionStatus = "complete" | "placeholder";

export interface CimSection {
  key: string;
  title: string;
  body: string;
  status: CimSectionStatus;
}

export interface CimOutput {
  sections: CimSection[];
  anonymized: boolean;
  missingFields: string[];
  disclaimer: string;
  recommendedAction: string;
}

// ---------------------------------------------------------------------------
// Deterministic core
// ---------------------------------------------------------------------------

// A fixed disclaimer — the CIM is a draft, not an offer, figures are as-supplied.
const DISCLAIMER =
  "This Confidential Information Memorandum is a preliminary DRAFT prepared for " +
  "internal review only and is strictly confidential. It is not an offer, " +
  "solicitation, or recommendation to buy or sell any security. All figures are as " +
  "supplied and unverified; the CIM must be reviewed and approved by a human before " +
  "any distribution.";

const clean = (s: string | undefined): string => (s ?? "").trim();
const nonEmpty = (xs: string[] | undefined): string[] => (xs ?? []).map((x) => clean(x)).filter((x) => x !== "");
const bulleted = (xs: string[]): string => xs.map((x) => `• ${x}`).join("\n");

/** First sentence of a free-text description, trimmed — used for the summary one-liner. */
function oneLine(description: string): string {
  const firstStop = description.search(/[.!?]/);
  const sentence = firstStop === -1 ? description : description.slice(0, firstStop + 1);
  return sentence.trim();
}

const run: SkillCore<CimInput, CimOutput> = (input): SkillCoreResult<CimOutput> => {
  const deal = input.deal ?? {};
  const anonymized = input.anonymize !== false; // default true
  const sources: SkillSource[] = [];
  const sections: CimSection[] = [];
  const missingFields: string[] = [];

  const codename = clean(deal.codename);
  const sector = clean(deal.sector);
  const description = clean(deal.description);
  const marketNotes = clean(deal.marketNotes);
  const transactionAsk = clean(deal.transactionAsk);
  const products = nonEmpty(deal.products);
  const management = (deal.management ?? []).filter((m) => clean(m?.name) !== "" || clean(m?.role) !== "");
  const historical = (deal.historicalFinancials ?? []).filter((r) => r && typeof r.year === "number");

  // Supplied identity fields are FACTS carried from input — never fabricated. The
  // CIM only ever names the deal by its codename; no real company name is emitted.
  if (codename) sources.push({ label: "Codename", kind: "fact", value: codename });
  if (sector) sources.push({ label: "Sector", kind: "fact", value: sector });
  if (transactionAsk) sources.push({ label: "Transaction ask", kind: "fact", value: transactionAsk });

  const add = (key: string, title: string, body: string, status: CimSectionStatus): void => {
    sections.push({ key, title, body, status });
    if (status === "placeholder") missingFields.push(key);
  };

  const codenameDisplay = codename || "[Codename to be assigned]";
  const sectorDisplay = sector || "[sector TBD]";

  // 1. Executive Summary — a synthesized one-liner from supplied identity +
  //    description + ask. Connective FRAMING is generated; identity fields are facts.
  if (description) {
    const askSuffix = transactionAsk ? ` Transaction: ${transactionAsk}.` : "";
    const summaryBody = `${codenameDisplay} — ${sectorDisplay}. ${oneLine(description)}${askSuffix}`;
    add("executiveSummary", "Executive Summary", summaryBody, "complete");
    sources.push({ label: "Executive summary framing", kind: "generated", value: summaryBody });
  } else {
    add("executiveSummary", "Executive Summary", "[Executive summary to be provided]", "placeholder");
  }

  // 2. Company Overview — from the supplied description; NEVER invented.
  if (description) {
    add("companyOverview", "Company Overview", description, "complete");
  } else {
    add("companyOverview", "Company Overview", "[Company overview to be provided]", "placeholder");
  }

  // 3. Market Overview — from supplied market notes; absent → flagged placeholder.
  if (marketNotes) {
    add("marketOverview", "Market Overview", marketNotes, "complete");
    sources.push({ label: "Market notes", kind: "fact", value: marketNotes });
  } else {
    add("marketOverview", "Market Overview", "[Market overview to be provided]", "placeholder");
  }

  // 4. Products & Services — bullets from the supplied array; absent → flagged.
  if (products.length > 0) {
    add("productsServices", "Products & Services", bulleted(products), "complete");
    sources.push({ label: "Products/services", kind: "fact", value: products.join(" | ") });
  } else {
    add("productsServices", "Products & Services", "[Products and services to be provided]", "placeholder");
  }

  // 5. Financial Summary — ONLY supplied revenue / EBITDA / growth and historical
  //    rows. Each figure is a FACT. GUARDRAIL: if none are supplied, this is a
  //    flagged placeholder — a financial figure not in the input is NEVER fabricated.
  const finLines: string[] = [];
  if (deal.revenue != null) {
    finLines.push(`Revenue: ${deal.revenue}`);
    sources.push({ label: "Reported revenue", kind: "fact", value: deal.revenue });
  }
  if (deal.ebitda != null) {
    finLines.push(`EBITDA: ${deal.ebitda}`);
    sources.push({ label: "Reported EBITDA", kind: "fact", value: deal.ebitda });
  }
  if (deal.growthRate != null) {
    finLines.push(`Growth rate: ${deal.growthRate}%`);
    sources.push({ label: "Reported growth rate", kind: "fact", value: deal.growthRate });
  }
  for (const row of historical) {
    const parts: string[] = [];
    if (row.revenue != null) {
      parts.push(`revenue ${row.revenue}`);
      sources.push({ label: `FY${row.year} revenue`, kind: "fact", value: row.revenue });
    }
    if (row.ebitda != null) {
      parts.push(`EBITDA ${row.ebitda}`);
      sources.push({ label: `FY${row.year} EBITDA`, kind: "fact", value: row.ebitda });
    }
    if (parts.length > 0) finLines.push(`FY${row.year}: ${parts.join(", ")}`);
  }
  if (finLines.length > 0) {
    add("financialSummary", "Financial Summary", finLines.join("\n"), "complete");
  } else {
    add("financialSummary", "Financial Summary", "[Financial summary to be provided]", "placeholder");
  }

  // 6. Management — supplied team. Anonymized (default) → names omitted, roles kept.
  if (management.length > 0) {
    const lines = management.map((m) => {
      const role = clean(m.role);
      const name = clean(m.name);
      // Roles are facts. A name is a fact only when the CIM is NOT anonymized.
      if (role) sources.push({ label: "Management role", kind: "fact", value: role });
      if (anonymized) return role || "Undisclosed role (name withheld)";
      if (name) sources.push({ label: "Management name", kind: "fact", value: name });
      const namePart = name || "[Name TBD]";
      return role ? `${namePart} — ${role}` : namePart;
    });
    add("management", "Management", lines.join("\n"), "complete");
  } else {
    add("management", "Management", "[Management team to be provided]", "placeholder");
  }

  // 7. Transaction Overview — from the supplied ask; absent → flagged placeholder.
  if (transactionAsk) {
    add("transactionOverview", "Transaction Overview", transactionAsk, "complete");
  } else {
    add("transactionOverview", "Transaction Overview", "[Transaction overview to be provided]", "placeholder");
  }

  // The standard confidentiality / disclaimer language is GENERATED, not a claim.
  sources.push({ label: "Confidentiality language", kind: "generated", value: DISCLAIMER });

  const placeholderCount = missingFields.length;
  const completeCount = sections.length - placeholderCount;
  const completeness = Math.round((completeCount / sections.length) * 100) / 100;
  const confidence = Math.max(0.2, Math.min(0.9, 0.3 + completeness * 0.6));

  const recommendedAction =
    `Draft CIM outline assembled with ${placeholderCount} placeholder section(s); complete and route ` +
    "to a human for review before any distribution (distribution is a gated action).";

  const structured: CimOutput = {
    sections,
    anonymized,
    missingFields,
    disclaimer: DISCLAIMER,
    recommendedAction,
  };

  const narrative =
    `CIM DRAFT outline for ${codenameDisplay} assembled: ${completeCount}/${sections.length} sections complete` +
    `${placeholderCount ? `, ${placeholderCount} placeholder(s) (${missingFields.join(", ")})` : ""}. ` +
    `${anonymized ? "Anonymized — named by codename only, management names withheld. " : ""}` +
    "Every figure is carried from supplied facts; blank sections are flagged, not filled. " +
    "This drafts for review; it does not publish, distribute, or share (distribution is a gated action).";

  return { structured, narrative, sources, confidence, completeness, missingData: [...missingFields] };
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
      properties: {
        codename: { type: "string" },
        sector: { type: "string" },
        description: { type: "string" },
        revenue: { type: "number", minimum: 0 },
        ebitda: { type: "number" },
        growthRate: { type: "number" },
        historicalFinancials: {
          type: "array",
          items: {
            type: "object",
            required: ["year"],
            properties: {
              year: { type: "number" },
              revenue: { type: "number", minimum: 0 },
              ebitda: { type: "number" },
            },
          },
        },
        products: { type: "array", items: { type: "string" } },
        management: {
          type: "array",
          items: {
            type: "object",
            properties: {
              name: { type: "string" },
              role: { type: "string" },
            },
          },
        },
        marketNotes: { type: "string" },
        transactionAsk: { type: "string" },
      },
    },
    anonymize: { type: "boolean" },
  },
};

const outputSchema: JsonSchema = {
  type: "object",
  required: ["sections", "anonymized", "missingFields", "disclaimer", "recommendedAction"],
  properties: {
    sections: {
      type: "array",
      items: {
        type: "object",
        required: ["key", "title", "body", "status"],
        properties: {
          key: { type: "string" },
          title: { type: "string" },
          body: { type: "string" },
          status: { type: "string", enum: ["complete", "placeholder"] },
        },
      },
    },
    anonymized: { type: "boolean" },
    missingFields: { type: "array", items: { type: "string" } },
    disclaimer: { type: "string" },
    recommendedAction: { type: "string" },
  },
};

export const cimManifest: SkillManifest = {
  id: "cim",
  name: "CIM Outline (Draft)",
  version: "1.0.0",
  owner: "fundexecs",
  hub: "build",
  applicableExecutives: ["communications"],
  supportedEntityTypes: ["deal", "company", "cim"],
  requiredInputs: ["deal"],
  optionalInputs: ["anonymize"],
  outputs: ["sections", "anonymized", "missingFields", "disclaimer", "recommendedAction"],
  artifactTypes: ["document"],
  dataPermissions: ["deal:read", "company:read"],
  tools: [],
  approvalTier: 1,
  riskClassification: "low",
  executionTimeoutMs: 15_000,
  retryPolicy: { maxAttempts: 1, backoffMs: 0 },
  validationRules: [
    "input matches input.schema.json",
    "output matches output.schema.json",
    "no fabricated financials — a section with no supplied content becomes a flagged placeholder, never a number",
  ],
  evaluationCriteria: [
    "assembles executive summary, company overview, market overview, products/services, financial summary, management, and transaction overview",
    "every supplied figure is a fact source; connective/disclaimer prose is a generated source",
    "missing sections fall back to flagged placeholders, never fabricated content",
    "anonymized by default — codename only, management names withheld",
    "drafts for review — never publishes, distributes, or shares (distribution is gated)",
  ],
  providerCapabilities: ["structured_extraction"],
  allowedDownstreamSkills: [],
  prohibitedActions: ["distribute_report", "share_materials", "send_outreach", "sign_document"],
  inputSchema,
  outputSchema,
};

export const cim: SkillDefinition<CimInput, CimOutput> = {
  manifest: cimManifest,
  run,
};
