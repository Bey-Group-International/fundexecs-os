// lib/source-ai.ts
// The AI Sourcing engine for the Source hub. Three capabilities, one mandate:
//
//   1. Generate — propose ranked, thesis-fit targets the firm doesn't have yet
//                 (LPs, deals, lenders, partners, providers), each with a fit
//                 score, rationale, and a suggested first move.
//   2. Score    — rate the targets already in a module against the mandate and
//                 surface the single next-best action per row.
//   3. Act      — every proposed move maps to a gated ActionKind so the operator
//                 stays in control (see lib/gates.ts + source-ai-actions.ts).
//
// Claude (lib/claude.ts model) reasons over the firm's mandate; when no
// ANTHROPIC_API_KEY is present every path falls back to deterministic output so
// the loop stays demoable in CI/preview. The engine itself is DB-free — callers
// pass the mandate + rows — which keeps it unit-testable.
import Anthropic from "@anthropic-ai/sdk";
import type { ActionKind } from "@/lib/gates";
import { tierForAction } from "@/lib/gates";
import { ADD_ROW_CONFIGS } from "@/lib/module-forms";
import { stageToTemperature } from "@/lib/capital-map";
import { AGENT_BY_KEY } from "@/lib/agents";
import type { AgentKey } from "@/lib/supabase/database.types";

const MODEL = process.env.CLAUDE_MODEL || "claude-sonnet-4-6";

export function sourcingLive(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

function client(): Anthropic | null {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  return apiKey ? new Anthropic({ apiKey }) : null;
}

// The mandate context the engine sources against (a subset of build-readiness'
// Mandate, kept local so the engine has no app-layer dependency).
export interface SourcingMandate {
  thesisTitle: string | null;
  assetClasses: string[];
  geographies: string[];
  checkSizeMin: number | null;
  checkSizeMax: number | null;
  targetIrr: number | null;
  targetMoic: number | null;
}

export interface SourceCandidate {
  name: string;
  /** A value from the module's category enum (or a free asset class for deals). */
  category: string;
  /** 0–100 thesis fit. */
  fitScore: number;
  rationale: string;
  /** Short imperative first move, e.g. "Warm intro via a mutual GP". */
  firstMove: string;
}

export interface PipelineScore {
  id: string;
  name: string;
  fitScore: number;
  rationale: string;
  action: ActionKind;
  actionLabel: string;
}

// --- per-module configuration ----------------------------------------------
export interface SourceAiConfig {
  key: string;
  /** Backing table — used by the server actions for reads/inserts. */
  table: string;
  agent: AgentKey;
  /** Singular noun for a target, e.g. "LP" or "lender". */
  entity: string;
  /** Plural noun, e.g. "LPs". */
  entities: string;
  /** Column the candidate's `category` maps to. */
  categoryField: string;
  /** Default sourcing-stage column + value applied to accepted rows. */
  stageField: string;
  stageValue: string;
  /** Whether `category` is a free-text field (deals) vs a fixed enum. */
  freeCategory: boolean;
  /** Guidance describing what a strong target looks like. */
  hint: string;
}

const CONFIGS: Record<string, SourceAiConfig> = {
  "source/lp_pipeline": {
    key: "source/lp_pipeline",
    table: "investors",
    agent: "capital_raiser",
    entity: "LP",
    entities: "LPs",
    categoryField: "investor_type",
    stageField: "pipeline_stage",
    stageValue: "prospect",
    freeCategory: false,
    hint: "capital allocators — family offices, institutions, funds-of-funds, anchor LPs — whose typical check and mandate fit this raise's size and geography",
  },
  "source/deal_pipeline": {
    key: "source/deal_pipeline",
    table: "deals",
    agent: "deal_sourcer",
    entity: "deal",
    entities: "deals",
    categoryField: "asset_class",
    stageField: "stage",
    stageValue: "sourced",
    freeCategory: true,
    hint: "acquisition targets — founder-owned, underperforming, or transitioning businesses/assets — that match the thesis asset classes and geographies",
  },
  "source/debt": {
    key: "source/debt",
    table: "debt_facilities",
    agent: "capital_connector",
    entity: "lender",
    entities: "lenders & facilities",
    categoryField: "facility_type",
    stageField: "status",
    stageValue: "prospective",
    freeCategory: false,
    hint: "lenders and structured-capital sources — banks, private credit, mezzanine — that finance this strategy's capital stack",
  },
  "source/partners": {
    key: "source/partners",
    table: "partners",
    agent: "executive_advisor",
    entity: "partner",
    entities: "partners",
    categoryField: "partner_type",
    stageField: "status",
    stageValue: "prospective",
    freeCategory: false,
    hint: "co-GPs, operating partners, advisors, and introducers who extend the firm's reach into the target market",
  },
  "source/providers": {
    key: "source/providers",
    table: "service_providers",
    agent: "executive_advisor",
    entity: "service provider",
    entities: "service providers",
    categoryField: "provider_type",
    stageField: "status",
    stageValue: "prospective",
    freeCategory: false,
    hint: "the service bench an institutional LP expects — fund counsel, audit, tax, fund administration, placement",
  },
};

export function sourceConfigFor(key: string): SourceAiConfig | null {
  return CONFIGS[key] ?? null;
}

// Category enum is derived from the add-row config so the engine can never
// propose a value the insert path would reject.
function categoryOptions(cfg: SourceAiConfig): string[] {
  const add = ADD_ROW_CONFIGS[cfg.key];
  const field = add?.fields.find((f) => f.name === cfg.categoryField);
  return field?.options ?? [];
}

// --- mandate → prompt context ----------------------------------------------
function compactUsd(n: number | null): string | null {
  if (!n || n <= 0) return null;
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(n);
}

export function mandateContext(m: SourcingMandate | null): string {
  if (!m || !m.thesisTitle) return "No active thesis yet — source broadly against private-market best practice.";
  const check = [compactUsd(m.checkSizeMin), compactUsd(m.checkSizeMax)].filter(Boolean).join("–");
  const facts = [
    `Thesis: ${m.thesisTitle}`,
    m.assetClasses.length ? `Asset classes: ${m.assetClasses.join(", ")}` : null,
    m.geographies.length ? `Geographies: ${m.geographies.join(", ")}` : null,
    check ? `Check size: ${check}` : null,
    m.targetIrr != null ? `Target IRR: ${m.targetIrr}%` : null,
    m.targetMoic != null ? `Target MOIC: ${m.targetMoic}x` : null,
  ].filter(Boolean);
  return facts.join("\n");
}

// --- shared Claude plumbing -------------------------------------------------
function textOf(message: Anthropic.Message): string {
  return message.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("\n")
    .trim();
}

const clampScore = (n: unknown): number => {
  const v = typeof n === "number" ? n : Number(n);
  if (!Number.isFinite(v)) return 50;
  return Math.max(0, Math.min(100, Math.round(v)));
};
const cleanStr = (v: unknown, max: number): string =>
  typeof v === "string" ? v.trim().slice(0, max) : "";

// Action kinds the sourcing engine is allowed to recommend — a safe subset that
// excludes anything capital- or compliance-binding (Tier 3 never auto-sourced).
const SOURCE_ACTIONS: ActionKind[] = [
  "research",
  "build_list",
  "draft_message",
  "send_intro_request",
  "send_outreach",
  "share_materials",
];

function coerceAction(v: unknown): ActionKind {
  return SOURCE_ACTIONS.includes(v as ActionKind) ? (v as ActionKind) : "research";
}

// ===========================================================================
// 1. GENERATE
// ===========================================================================
const CANDIDATES_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    candidates: {
      type: "array",
      description: "3–6 ranked target candidates, best fit first",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          name: { type: "string", description: "Specific, plausible target name" },
          category: { type: "string", description: "One category label for this target" },
          fitScore: { type: "number", description: "0–100 fit against the mandate" },
          rationale: { type: "string", description: "One sentence: why this fits the mandate" },
          firstMove: { type: "string", description: "Short imperative first move" },
        },
        required: ["name", "category", "fitScore", "rationale", "firstMove"],
      },
    },
  },
  required: ["candidates"],
} as const;

export async function generateTargets(
  key: string,
  mandate: SourcingMandate | null,
  existingNames: string[] = [],
): Promise<SourceCandidate[]> {
  const cfg = sourceConfigFor(key);
  if (!cfg) return [];
  const options = categoryOptions(cfg);
  const anthropic = client();
  if (!anthropic) return fallbackCandidates(cfg, mandate, existingNames, options);

  const agentName = AGENT_BY_KEY[cfg.agent]?.name ?? "Sourcing";
  const catLine = cfg.freeCategory
    ? `Set "category" to the most fitting asset class.`
    : `Set "category" to exactly one of: ${options.join(", ")}.`;
  try {
    const message = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 1500,
      system: `You are the ${agentName} agent inside FundExecs OS, sourcing ${cfg.entities} for a private-market operator. Propose specific, plausible targets that fit the firm's mandate — the kind a sharp ${agentName.toLowerCase()} would put on a call sheet. These are AI suggestions the operator will verify, so be concrete but never fabricate confidential facts. ${catLine}`,
      output_config: { effort: "low", format: { type: "json_schema", schema: CANDIDATES_SCHEMA } },
      messages: [
        {
          role: "user",
          content:
            `Mandate:\n${mandateContext(mandate)}\n\n` +
            `Source ${cfg.entities}: ${cfg.hint}.\n` +
            (existingNames.length
              ? `Already in the pipeline (do not repeat): ${existingNames.slice(0, 40).join(", ")}.\n`
              : "") +
            `Return 3–6 ranked candidates.`,
        },
      ],
    });
    const json = textOf(message);
    const raw = json ? (JSON.parse(json) as { candidates?: unknown[] }) : null;
    const out = normalizeCandidates(raw?.candidates ?? [], cfg, options, existingNames);
    return out.length ? out : fallbackCandidates(cfg, mandate, existingNames, options);
  } catch {
    return fallbackCandidates(cfg, mandate, existingNames, options);
  }
}

function normalizeCandidates(
  raw: unknown[],
  cfg: SourceAiConfig,
  options: string[],
  existingNames: string[],
): SourceCandidate[] {
  const seen = new Set(existingNames.map((n) => n.toLowerCase()));
  const out: SourceCandidate[] = [];
  for (const r of raw) {
    if (!r || typeof r !== "object") continue;
    const o = r as Record<string, unknown>;
    const name = cleanStr(o.name, 120);
    if (!name || seen.has(name.toLowerCase())) continue;
    seen.add(name.toLowerCase());
    let category = cleanStr(o.category, 60);
    if (!cfg.freeCategory) {
      const match = options.find((opt) => opt.toLowerCase() === category.toLowerCase());
      category = match ?? options[0] ?? "other";
    }
    out.push({
      name,
      category: category || (cfg.freeCategory ? "" : options[0] ?? "other"),
      fitScore: clampScore(o.fitScore),
      rationale: cleanStr(o.rationale, 240) || "Fits the mandate.",
      firstMove: cleanStr(o.firstMove, 120) || "Research and qualify.",
    });
    if (out.length >= 6) break;
  }
  return out.sort((a, b) => b.fitScore - a.fitScore);
}

// Deterministic archetypes from the mandate — honest "go find one of these"
// profiles rather than fabricated firm names, so the feature works with no key.
function fallbackCandidates(
  cfg: SourceAiConfig,
  mandate: SourcingMandate | null,
  existingNames: string[],
  options: string[],
): SourceCandidate[] {
  const geos = mandate?.geographies?.length ? mandate.geographies : ["your core market"];
  const classes = mandate?.assetClasses?.length ? mandate.assetClasses : ["the target strategy"];
  const seen = new Set(existingNames.map((n) => n.toLowerCase()));
  const picks: SourceCandidate[] = [];
  const add = (name: string, category: string, fitScore: number, rationale: string, firstMove: string) => {
    if (seen.has(name.toLowerCase()) || picks.length >= 5) return;
    seen.add(name.toLowerCase());
    picks.push({ name, category, fitScore, rationale, firstMove });
  };
  const cat = (i: number) => (cfg.freeCategory ? classes[i % classes.length] : options[i % Math.max(1, options.length)] ?? "other");

  switch (cfg.key) {
    case "source/lp_pipeline":
      geos.forEach((g, i) =>
        add(`Family office — ${g}`, "family_office", 72 - i * 6, `Allocators in ${g} that match the check band.`, "Research principals and warm-intro path."),
      );
      add("Lower-mid-market fund-of-funds", "fund_of_funds", 64, "Programmatic allocators to emerging managers.", "Build a target list and qualify.");
      break;
    case "source/deal_pipeline":
      classes.forEach((c, i) =>
        add(`${c} target — ${geos[i % geos.length]}`, c, 70 - i * 5, `On-thesis ${c} opportunity in ${geos[i % geos.length]}.`, "Source off-market and screen thesis fit."),
      );
      break;
    case "source/debt":
      add("Regional bank — senior facility", "term_loan", 68, "Senior debt to anchor the capital stack.", "Request indicative terms.");
      add("Private credit fund — unitranche", "mezzanine", 62, "Flexible structured capital for the strategy.", "Open a financing conversation.");
      break;
    case "source/partners":
      add(`Operating partner — ${classes[0]}`, "operating_partner", 70, `Sector operator to add value in ${classes[0]}.`, "Research and qualify.");
      add("Co-GP — complementary mandate", "co_gp", 64, "Co-sponsor to extend deal capacity.", "Explore a co-GP conversation.");
      break;
    case "source/providers":
      ["legal", "audit", "tax", "fund_admin"].forEach((p, i) =>
        add(`${p.replace("_", " ")} provider — fund formation`, p, 66 - i * 4, "Core institutional service bench.", "Request a scope and quote."),
      );
      break;
  }
  return picks;
}

// ===========================================================================
// 2. SCORE
// ===========================================================================
export interface ScoreInputRow {
  id: string;
  name: string;
  /** Lightweight signal fields passed to the model / heuristic. */
  fields: Record<string, unknown>;
}

const SCORES_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    scores: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          id: { type: "string" },
          fitScore: { type: "number", description: "0–100 fit against the mandate" },
          rationale: { type: "string", description: "One line on fit + the recommended move" },
          action: { type: "string", enum: SOURCE_ACTIONS, description: "Recommended next action" },
          actionLabel: { type: "string", description: "Short label for the action" },
        },
        required: ["id", "fitScore", "rationale", "action", "actionLabel"],
      },
    },
  },
  required: ["scores"],
} as const;

export async function scorePipeline(
  key: string,
  mandate: SourcingMandate | null,
  rows: ScoreInputRow[],
): Promise<PipelineScore[]> {
  const cfg = sourceConfigFor(key);
  if (!cfg || rows.length === 0) return [];
  const anthropic = client();
  if (!anthropic) return fallbackScores(cfg, rows);

  try {
    const message = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 2000,
      system: `You are the ${AGENT_BY_KEY[cfg.agent]?.name ?? "Sourcing"} agent inside FundExecs OS. Score each existing ${cfg.entity} in the pipeline against the mandate and recommend the single next-best action. Recommend only internal or outreach actions — never anything capital- or compliance-binding.`,
      output_config: { effort: "low", format: { type: "json_schema", schema: SCORES_SCHEMA } },
      messages: [
        {
          role: "user",
          content:
            `Mandate:\n${mandateContext(mandate)}\n\n` +
            `Score these ${cfg.entities}:\n` +
            rows
              .slice(0, 30)
              .map((r) => `- id=${r.id} | ${r.name} | ${JSON.stringify(r.fields)}`)
              .join("\n"),
        },
      ],
    });
    const json = textOf(message);
    const raw = json ? (JSON.parse(json) as { scores?: unknown[] }) : null;
    const out = normalizeScores(raw?.scores ?? [], rows);
    return out.length ? out : fallbackScores(cfg, rows);
  } catch {
    return fallbackScores(cfg, rows);
  }
}

function normalizeScores(raw: unknown[], rows: ScoreInputRow[]): PipelineScore[] {
  const byId = new Map(rows.map((r) => [r.id, r.name]));
  const out: PipelineScore[] = [];
  for (const r of raw) {
    if (!r || typeof r !== "object") continue;
    const o = r as Record<string, unknown>;
    const id = cleanStr(o.id, 64);
    const name = byId.get(id);
    if (!name) continue;
    out.push({
      id,
      name,
      fitScore: clampScore(o.fitScore),
      rationale: cleanStr(o.rationale, 240) || "Scored against the mandate.",
      action: coerceAction(o.action),
      actionLabel: cleanStr(o.actionLabel, 60) || "Research",
    });
  }
  return out.sort((a, b) => b.fitScore - a.fitScore);
}

// Deterministic scoring: investors reuse the Capital Map's temperature read; the
// rest score on how far they've progressed and how complete the record is.
function fallbackScores(cfg: SourceAiConfig, rows: ScoreInputRow[]): PipelineScore[] {
  return rows
    .map((r) => {
      if (cfg.key === "source/lp_pipeline") {
        const temp = stageToTemperature(String(r.fields.pipeline_stage ?? "prospect"));
        const score = { cold: 35, warm: 55, active: 75, committed: 95 }[temp];
        const action: ActionKind =
          temp === "cold" ? "research" : temp === "warm" ? "draft_message" : "send_outreach";
        const label = temp === "cold" ? "Research" : temp === "warm" ? "Draft intro" : "Send outreach";
        return {
          id: r.id,
          name: r.name,
          fitScore: score,
          rationale: `${temp[0].toUpperCase()}${temp.slice(1)} relationship — advance the conversation.`,
          action,
          actionLabel: label,
        };
      }
      const status = String(r.fields.status ?? r.fields.stage ?? "").toLowerCase();
      const advanced = /active|committed|drawn|term_sheet|diligence|closing/.test(status);
      const hasContact = Boolean(r.fields.contact_email || r.fields.lender);
      const score = (advanced ? 70 : 45) + (hasContact ? 10 : 0);
      return {
        id: r.id,
        name: r.name,
        fitScore: Math.min(100, score),
        rationale: advanced ? "Engaged — keep it moving." : "Early — qualify and progress.",
        action: advanced ? "send_outreach" : "research",
        actionLabel: advanced ? "Send outreach" : "Research",
      } satisfies PipelineScore;
    })
    .sort((a, b) => b.fitScore - a.fitScore);
}

export const __test = {
  sourceConfigFor,
  categoryOptions,
  mandateContext,
  normalizeCandidates,
  normalizeScores,
  fallbackCandidates,
  fallbackScores,
  coerceAction,
  clampScore,
  SOURCE_ACTIONS,
  tierForAction,
};
