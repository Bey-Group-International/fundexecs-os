// lib/skills/catalog/investor-profile.ts
// Native skill: build a structured LP/investor profile from caller-SUPPLIED data.
// Pure, deterministic core — the tested execution path. It NEVER invents an
// investor's AUM, wealth, mandate, PEP status, or preferences: it organizes the
// facts the caller provides, assesses fit against a fund's targeting criteria, and
// FLAGS missing fields rather than fabricating them. Every supplied investor field
// is a `fact`; fitScore and ticketBand are `calculation`s over supplied facts.
// LLM enrichment of the narrative is an optional follow-on that wraps this core;
// every number and flag comes from here.

import type { JsonSchema, SkillCore, SkillCoreResult, SkillDefinition, SkillManifest, SkillSource } from "@/lib/skills/types";

// ---------------------------------------------------------------------------
// I/O types
// ---------------------------------------------------------------------------

export interface InvestorInput {
  name: string;
  type?: string; // e.g. "family_office","pension","fund_of_funds","hnw"
  aum?: number; // USD millions
  typicalTicket?: number; // USD millions
  sectorsOfInterest?: string[];
  geographiesOfInterest?: string[];
  priorCommitments?: number;
  relationshipOwner?: string;
}

export interface FundCriteria {
  minTicket?: number; // USD millions
  targetSectors?: string[];
  targetGeographies?: string[];
}

export interface InvestorProfileInput {
  investor: InvestorInput;
  fundCriteria?: FundCriteria;
}

export type FitStatus = "fit" | "partial" | "miss" | "unknown";

export interface FitSignal {
  dimension: string;
  status: FitStatus;
  note: string;
}

export interface InvestorProfileOutput {
  profile: {
    name: string;
    type: string | null;
    aum: number | null;
    typicalTicket: number | null;
    ticketBand: string | null;
    priorCommitments: number | null;
    relationshipOwner: string | null;
  };
  fitSignals: FitSignal[];
  fitScore: number; // 0–100
  missingFields: string[];
  suggestedNextStep: string;
  missingContext: string[];
}

// ---------------------------------------------------------------------------
// Deterministic core
// ---------------------------------------------------------------------------

interface DimFit {
  status: FitStatus;
  score: number; // 0–100, only meaningful when status !== "unknown"
}

const lc = (s: string) => s.toLowerCase().trim();

/** Ticket fit: the investor's typical check against the fund's minimum. Unknown when either side is silent. */
function ticketFit(typicalTicket: number | undefined, minTicket: number | undefined): DimFit {
  if (typicalTicket == null) return { status: "unknown", score: 0 }; // investor silent
  if (minTicket == null) return { status: "unknown", score: 0 }; // criteria silent
  return typicalTicket >= minTicket ? { status: "fit", score: 100 } : { status: "miss", score: 0 };
}

/** List overlap: investor interests against a fund target list. Unknown when either side is silent. */
function overlapFit(values: string[] | undefined, targets: string[] | undefined): DimFit {
  if (!values || values.length === 0) return { status: "unknown", score: 0 }; // investor silent
  if (!targets || targets.length === 0) return { status: "unknown", score: 0 }; // criteria silent
  const t = targets.map(lc);
  const hits = values.filter((v) => t.includes(lc(v)));
  if (hits.length === 0) return { status: "miss", score: 0 };
  if (hits.length === values.length) return { status: "fit", score: 100 };
  return { status: "partial", score: 50 };
}

/** Coarse ticket band from a SUPPLIED typical check (USD millions). Null when not supplied — never invented. */
function ticketBandFor(typicalTicket: number | undefined): string | null {
  if (typicalTicket == null) return null;
  if (typicalTicket < 1) return "<1M";
  if (typicalTicket < 5) return "1-5M";
  if (typicalTicket < 25) return "5-25M";
  return "25M+";
}

const run: SkillCore<InvestorProfileInput, InvestorProfileOutput> = (input): SkillCoreResult<InvestorProfileOutput> => {
  const investor = input.investor ?? ({ name: "" } as InvestorInput);
  const criteria = input.fundCriteria ?? {};
  const sources: SkillSource[] = [];
  const missingContext: string[] = [];

  // Record every SUPPLIED investor field as a FACT — nothing is fabricated.
  if (investor.name) sources.push({ label: `${investor.name} — name`, kind: "fact", value: investor.name });
  if (investor.type) sources.push({ label: `${investor.name} — type`, kind: "fact", value: investor.type });
  if (investor.aum != null) sources.push({ label: `${investor.name} — AUM`, kind: "fact", value: investor.aum });
  if (investor.typicalTicket != null)
    sources.push({ label: `${investor.name} — typical ticket`, kind: "fact", value: investor.typicalTicket });
  if (investor.sectorsOfInterest?.length)
    sources.push({ label: `${investor.name} — sectors of interest`, kind: "fact", value: investor.sectorsOfInterest.join(", ") });
  if (investor.geographiesOfInterest?.length)
    sources.push({ label: `${investor.name} — geographies of interest`, kind: "fact", value: investor.geographiesOfInterest.join(", ") });
  if (investor.priorCommitments != null)
    sources.push({ label: `${investor.name} — prior commitments`, kind: "fact", value: investor.priorCommitments });
  if (investor.relationshipOwner)
    sources.push({ label: `${investor.name} — relationship owner`, kind: "fact", value: investor.relationshipOwner });

  // Fit assessment — only against dimensions the criteria constrains and the investor provides.
  const ticket = ticketFit(investor.typicalTicket, criteria.minTicket);
  const sector = overlapFit(investor.sectorsOfInterest, criteria.targetSectors);
  const geography = overlapFit(investor.geographiesOfInterest, criteria.targetGeographies);

  const noteFor = (dim: string, d: DimFit): string => {
    if (d.status === "unknown") return `${dim}: not scored — investor data or fund criteria not supplied.`;
    if (d.status === "fit") return `${dim}: matches fund criteria.`;
    if (d.status === "partial") return `${dim}: partial overlap with fund criteria.`;
    return `${dim}: outside fund criteria.`;
  };

  const fitSignals: FitSignal[] = [
    { dimension: "ticket", status: ticket.status, note: noteFor("Ticket", ticket) },
    { dimension: "sector", status: sector.status, note: noteFor("Sector", sector) },
    { dimension: "geography", status: geography.status, note: noteFor("Geography", geography) },
  ];

  // fitScore = average of KNOWN dimension fits. Silent dimensions are excluded, never penalised.
  const knownDims = [ticket, sector, geography].filter((d) => d.status !== "unknown");
  const fitScore = knownDims.length ? Math.round(knownDims.reduce((s, d) => s + d.score, 0) / knownDims.length) : 0;
  sources.push({
    label: `${investor.name} — fit score`,
    kind: "calculation",
    value: fitScore,
    ref: "average of known dimension fits (ticket, sector, geography)",
  });

  // ticketBand — a CALCULATION bucketing a supplied fact. Null (and flagged) when no ticket supplied.
  const ticketBand = ticketBandFor(investor.typicalTicket);
  if (ticketBand != null)
    sources.push({ label: `${investor.name} — ticket band`, kind: "calculation", value: ticketBand, ref: "bucketed from typical ticket" });

  // missingFields — important-but-absent fields, SURFACED, never filled.
  const missingFields: string[] = [];
  if (!investor.type) missingFields.push("type");
  if (investor.aum == null) missingFields.push("aum");
  if (investor.typicalTicket == null) missingFields.push("typicalTicket");
  if (!investor.sectorsOfInterest?.length) missingFields.push("sectorsOfInterest");
  if (!investor.geographiesOfInterest?.length) missingFields.push("geographiesOfInterest");
  if (investor.priorCommitments == null) missingFields.push("priorCommitments");
  if (!investor.relationshipOwner) missingFields.push("relationshipOwner");

  // Missing-context notes — surfaced, never silently assumed or invented.
  if (investor.typicalTicket == null)
    missingContext.push("Typical ticket not supplied — ticket band not derived and ticket fit not scored.");
  if (!criteria.minTicket && investor.typicalTicket != null)
    missingContext.push("Fund criteria does not set a minimum ticket — ticket fit not scored.");
  if (!criteria.targetSectors?.length) missingContext.push("Fund criteria does not constrain sectors — sector fit not scored.");
  if (!criteria.targetGeographies?.length)
    missingContext.push("Fund criteria does not constrain geographies — geography fit not scored.");
  if (knownDims.length === 0)
    missingContext.push("No known fit dimensions — fitScore reflects low completeness, not a poor fit.");
  if (missingFields.length)
    missingContext.push(`Profile incomplete — ${missingFields.length} field(s) missing: ${missingFields.join(", ")}.`);

  const completeness = Math.round(((7 - missingFields.length) / 7) * 100) / 100;
  const confidence = Math.max(0.2, Math.min(0.95, 0.4 + completeness * 0.4 + (knownDims.length ? 0.15 : 0)));

  const suggestedNextStep = missingFields.length
    ? `Complete profile: ${missingFields.length} field(s) missing (${missingFields.join(", ")}).`
    : "Profile complete — route to Capital Formation for targeting.";

  const profile: InvestorProfileOutput["profile"] = {
    name: investor.name,
    type: investor.type ?? null,
    aum: investor.aum ?? null,
    typicalTicket: investor.typicalTicket ?? null,
    ticketBand,
    priorCommitments: investor.priorCommitments ?? null,
    relationshipOwner: investor.relationshipOwner ?? null,
  };

  const structured: InvestorProfileOutput = {
    profile,
    fitSignals,
    fitScore,
    missingFields,
    suggestedNextStep,
    missingContext,
  };

  const scoredCount = knownDims.length;
  const narrative =
    `Profile for ${investor.name}${investor.type ? ` (${investor.type})` : ""}: ` +
    `${scoredCount ? `fit ${fitScore}/100 across ${scoredCount} known dimension(s)` : "fit not scored (no known dimensions)"}` +
    `${ticketBand ? `, ticket band ${ticketBand}` : ""}. ` +
    `${missingFields.length ? `${missingFields.length} field(s) missing — flagged, not fabricated. ` : "Profile complete. "}` +
    `Next: ${suggestedNextStep}`;

  return { structured, narrative, sources, confidence, completeness, missingData: [...missingFields] };
};

// ---------------------------------------------------------------------------
// Schemas + manifest
// ---------------------------------------------------------------------------

const inputSchema: JsonSchema = {
  type: "object",
  required: ["investor"],
  properties: {
    investor: {
      type: "object",
      required: ["name"],
      properties: {
        name: { type: "string", minLength: 1 },
        type: { type: "string" },
        aum: { type: "number", minimum: 0 },
        typicalTicket: { type: "number", minimum: 0 },
        sectorsOfInterest: { type: "array", items: { type: "string" } },
        geographiesOfInterest: { type: "array", items: { type: "string" } },
        priorCommitments: { type: "number", minimum: 0 },
        relationshipOwner: { type: "string" },
      },
    },
    fundCriteria: {
      type: "object",
      properties: {
        minTicket: { type: "number", minimum: 0 },
        targetSectors: { type: "array", items: { type: "string" } },
        targetGeographies: { type: "array", items: { type: "string" } },
      },
    },
  },
};

const outputSchema: JsonSchema = {
  type: "object",
  required: ["profile", "fitSignals", "fitScore", "missingFields", "suggestedNextStep"],
  properties: {
    profile: {
      type: "object",
      required: ["name"],
      properties: {
        name: { type: "string" },
        type: { type: "string" },
        aum: { type: "number" },
        typicalTicket: { type: "number" },
        ticketBand: { type: "string" },
        priorCommitments: { type: "number" },
        relationshipOwner: { type: "string" },
      },
    },
    fitSignals: {
      type: "array",
      items: {
        type: "object",
        required: ["dimension", "status", "note"],
        properties: {
          dimension: { type: "string" },
          status: { type: "string", enum: ["fit", "partial", "miss", "unknown"] },
          note: { type: "string" },
        },
      },
    },
    fitScore: { type: "number", minimum: 0, maximum: 100 },
    missingFields: { type: "array", items: { type: "string" } },
    suggestedNextStep: { type: "string" },
    missingContext: { type: "array", items: { type: "string" } },
  },
};

export const investorProfileManifest: SkillManifest = {
  id: "investor-profile",
  name: "Investor Profile",
  version: "1.0.0",
  owner: "fundexecs",
  hub: "source",
  applicableExecutives: ["investor_relations", "capital_formation"],
  supportedEntityTypes: ["investor", "lp", "contact"],
  requiredInputs: ["investor"],
  optionalInputs: ["fundCriteria"],
  outputs: ["profile", "fitSignals", "fitScore", "missingFields", "suggestedNextStep", "missingContext"],
  artifactTypes: ["analysis"],
  dataPermissions: ["investor:read", "lp:read"],
  tools: [],
  approvalTier: 1,
  riskClassification: "low",
  executionTimeoutMs: 15_000,
  retryPolicy: { maxAttempts: 1, backoffMs: 0 },
  validationRules: ["input matches input.schema.json", "output matches output.schema.json", "no fabricated investor data"],
  evaluationCriteria: [
    "organizes only supplied investor facts",
    "missing fields flagged, never fabricated (aum, ticket, mandate, PEP status, preferences)",
    "ticketBand null when no typical ticket supplied",
    "fitScore is a calculation over known dimensions only",
    "supplied fields labelled fact, fitScore and ticketBand labelled calculation",
  ],
  providerCapabilities: ["structured_extraction"],
  allowedDownstreamSkills: ["raise-pipeline", "commitment-tracker"],
  prohibitedActions: ["send_outreach", "send_intro_request", "sign_document"],
  inputSchema,
  outputSchema,
};

export const investorProfile: SkillDefinition<InvestorProfileInput, InvestorProfileOutput> = {
  manifest: investorProfileManifest,
  run,
};
