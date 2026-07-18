// lib/skills/catalog/teaser.ts
// Native skill: assemble a one-page anonymized deal TEASER DRAFT from
// caller-SUPPLIED facts. Pure, deterministic core — the tested execution path.
//
// This skill DRAFTS for review. It NEVER publishes, sends, or shares (those are
// Tier-2, prohibited here). It NEVER invents financials: every figure comes from
// the supplied facts; a blank is FLAGGED as a placeholder, never filled. Narrative
// connective prose is labelled `generated`; every supplied number is a `fact`
// carried from input. Distribution of the finished teaser is a separate, gated
// action — this core prepares the draft only.

import type { JsonSchema, SkillCore, SkillCoreResult, SkillDefinition, SkillManifest, SkillSource } from "@/lib/skills/types";

// ---------------------------------------------------------------------------
// I/O types
// ---------------------------------------------------------------------------

export interface TeaserDeal {
  codename?: string;
  sector?: string;
  geography?: string;
  description?: string;
  revenue?: number;
  ebitda?: number;
  growthRate?: number;
  askType?: string; // e.g. "majority", "minority", "debt"
  investmentHighlights?: string[];
  useOfProceeds?: string;
}

export interface TeaserInput {
  deal: TeaserDeal;
  /** When true (default), omit any real company name and use the codename only. */
  anonymize?: boolean;
}

export type TeaserSectionStatus = "complete" | "placeholder";

export interface TeaserSection {
  key: string;
  title: string;
  body: string;
  status: TeaserSectionStatus;
}

export interface TeaserOutput {
  sections: TeaserSection[];
  anonymized: boolean;
  missingFields: string[];
  disclaimer: string;
  recommendedAction: string;
}

// ---------------------------------------------------------------------------
// Deterministic core
// ---------------------------------------------------------------------------

// A fixed, GENERATED process line — neutral framing, never a deal-specific claim.
const PROCESS_LINE =
  "Indicative interest requested by [date TBD]; further information available under NDA.";

// A fixed disclaimer — the teaser is a draft, not an offer, figures are as-supplied.
const DISCLAIMER =
  "This teaser is a preliminary DRAFT prepared for internal review only. It is not an " +
  "offer, solicitation, or recommendation to buy or sell any security. All figures are " +
  "as supplied and unverified; the teaser must be reviewed and approved by a human before " +
  "any distribution.";

const clean = (s: string | undefined): string => (s ?? "").trim();
const nonEmpty = (xs: string[] | undefined): string[] => (xs ?? []).map((x) => clean(x)).filter((x) => x !== "");
const bulleted = (xs: string[]): string => xs.map((x) => `• ${x}`).join("\n");

/** First sentence of a free-text description, trimmed — used for the headline one-liner. */
function oneLine(description: string): string {
  const firstStop = description.search(/[.!?]/);
  const sentence = firstStop === -1 ? description : description.slice(0, firstStop + 1);
  return sentence.trim();
}

const run: SkillCore<TeaserInput, TeaserOutput> = (input): SkillCoreResult<TeaserOutput> => {
  const deal = input.deal ?? {};
  const anonymized = input.anonymize !== false; // default true
  const sources: SkillSource[] = [];
  const sections: TeaserSection[] = [];
  const missingFields: string[] = [];

  const codename = clean(deal.codename);
  const sector = clean(deal.sector);
  const geography = clean(deal.geography);
  const description = clean(deal.description);
  const askType = clean(deal.askType);
  const useOfProceeds = clean(deal.useOfProceeds);
  const highlights = nonEmpty(deal.investmentHighlights);

  // Supplied identity/text fields are FACTS carried from input — never fabricated.
  // The teaser only ever names the deal by its codename; no real company name is emitted.
  if (codename) sources.push({ label: "Codename", kind: "fact", value: codename });
  if (sector) sources.push({ label: "Sector", kind: "fact", value: sector });
  if (geography) sources.push({ label: "Geography", kind: "fact", value: geography });
  if (askType) sources.push({ label: "Ask type", kind: "fact", value: askType });
  if (useOfProceeds) sources.push({ label: "Use of proceeds", kind: "fact", value: useOfProceeds });

  const add = (key: string, title: string, body: string, status: TeaserSectionStatus): void => {
    sections.push({ key, title, body, status });
    if (status === "placeholder") missingFields.push(key);
  };

  // 1. Headline — codename + sector + a one-liner from the supplied description.
  //    Connective framing is GENERATED; the underlying identity fields are facts.
  const codenameDisplay = codename || "[Codename to be assigned]";
  const sectorDisplay = sector || "[sector TBD]";
  const geoSuffix = geography ? `, ${geography}` : "";
  const askSuffix = askType ? ` · ${askType} process` : "";
  const oneLineSuffix = description ? ` — ${oneLine(description)}` : "";
  const headlineBody = `${codenameDisplay} — ${sectorDisplay}${geoSuffix}${askSuffix}${oneLineSuffix}`;
  const headlineComplete = codename !== "";
  add("headline", "Headline", headlineBody, headlineComplete ? "complete" : "placeholder");
  sources.push({ label: "Headline framing", kind: "generated", value: headlineBody });

  // 2. Business Overview — from the supplied description; NEVER invented.
  if (description) {
    const body = useOfProceeds ? `${description}\n\nUse of proceeds: ${useOfProceeds}` : description;
    add("businessOverview", "Business Overview", body, "complete");
  } else {
    add("businessOverview", "Business Overview", "[Business overview to be provided]", "placeholder");
  }

  // 3. Financial Highlights — ONLY supplied revenue / EBITDA / growth. Each is a
  //    FACT. GUARDRAIL: if none are supplied, this is a flagged placeholder — a
  //    financial figure that was not in the input is NEVER fabricated.
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
  if (finLines.length > 0) {
    add("financialHighlights", "Financial Highlights", finLines.join("\n"), "complete");
  } else {
    add("financialHighlights", "Financial Highlights", "[Financials to be provided]", "placeholder");
  }

  // 4. Investment Highlights — bullets from the supplied array; absent → flagged.
  if (highlights.length > 0) {
    add("investmentHighlights", "Investment Highlights", bulleted(highlights), "complete");
    sources.push({ label: "Investment highlights", kind: "fact", value: highlights.join(" | ") });
  } else {
    add("investmentHighlights", "Investment Highlights", "[Investment highlights to be provided]", "placeholder");
  }

  // 5. Process — a fixed, neutral, GENERATED process line. Always complete.
  add("process", "Process", PROCESS_LINE, "complete");
  sources.push({ label: "Process line", kind: "generated", value: PROCESS_LINE });

  const placeholderCount = missingFields.length;
  const completeCount = sections.length - placeholderCount;
  const completeness = Math.round((completeCount / sections.length) * 100) / 100;
  const confidence = Math.max(0.2, Math.min(0.9, 0.3 + completeness * 0.6));

  const recommendedAction =
    `Draft teaser assembled with ${placeholderCount} placeholder section(s); complete and route ` +
    "to a human for review before any distribution (distribution is a gated action).";

  const structured: TeaserOutput = {
    sections,
    anonymized,
    missingFields,
    disclaimer: DISCLAIMER,
    recommendedAction,
  };

  const narrative =
    `Teaser DRAFT for ${codenameDisplay} assembled: ${completeCount}/${sections.length} sections complete` +
    `${placeholderCount ? `, ${placeholderCount} placeholder(s) (${missingFields.join(", ")})` : ""}. ` +
    `${anonymized ? "Anonymized — named by codename only. " : ""}` +
    "Every figure is carried from supplied facts; blanks are flagged, not filled. " +
    "This drafts for review; it does not publish, send, or share (distribution is a gated action).";

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
        geography: { type: "string" },
        description: { type: "string" },
        revenue: { type: "number", minimum: 0 },
        ebitda: { type: "number" },
        growthRate: { type: "number" },
        askType: { type: "string" },
        investmentHighlights: { type: "array", items: { type: "string" } },
        useOfProceeds: { type: "string" },
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

export const teaserManifest: SkillManifest = {
  id: "teaser",
  name: "Deal Teaser (Draft)",
  version: "1.0.0",
  owner: "fundexecs",
  hub: "build",
  applicableExecutives: ["communications"],
  supportedEntityTypes: ["deal", "company", "teaser"],
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
    "no fabricated financials — a missing figure becomes a flagged placeholder, never a number",
  ],
  evaluationCriteria: [
    "assembles headline, business overview, financial highlights, investment highlights, and process",
    "every supplied figure is a fact source; connective prose is a generated source",
    "missing sections fall back to flagged placeholders, never fabricated content",
    "drafts for review — never publishes, sends, or shares (distribution is gated)",
  ],
  providerCapabilities: ["structured_extraction"],
  allowedDownstreamSkills: [],
  prohibitedActions: ["distribute_report", "share_materials", "send_outreach", "sign_document"],
  inputSchema,
  outputSchema,
};

export const teaser: SkillDefinition<TeaserInput, TeaserOutput> = {
  manifest: teaserManifest,
  run,
};
