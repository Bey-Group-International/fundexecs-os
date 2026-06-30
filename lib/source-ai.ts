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

// External enrichment (web search) is opt-in: it needs a model key AND an
// explicit flag, since the web_search server tool must be enabled on the
// account and incurs extra cost. When off, generation uses model knowledge.
export function sourcingEnrichmentEnabled(): boolean {
  return sourcingLive() && /^(1|true|on)$/i.test(process.env.SOURCE_WEB_SEARCH ?? "");
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

// Per-request operator context the engine reasons WITH, on top of the mandate.
// Assembled DB-side by lib/source-intelligence.ts and passed in, so the engine
// itself stays DB-free. Every field is an already-distilled string; the engine
// only formats and injects them. This is what makes sourcing context-aware
// (recent activity, portfolio), user-aware (identity), and continually learning
// (the learned digest from past accept/reject signals).
export interface OperatorContext {
  /** Per-user distilled preferences from past accept/reject/queue signals. */
  learned?: string;
  /** Recent pipeline additions + what's stalling, for the relevant module(s). */
  activity?: string;
  /** Cross-hub portfolio/holdings state so Source knows what's already held. */
  portfolio?: string;
  /** The current operator's name/title/role, for relevance + tone. */
  user?: string;
}

// Render the assembled operator context as a labeled prompt block (or "" when
// empty). Injected right after the mandate so Claude reasons with who's asking,
// what's already moving, and what this operator has historically preferred.
export function operatorContextBlock(ctx?: OperatorContext): string {
  if (!ctx) return "";
  const parts = [
    ctx.user ? `Operator: ${ctx.user}` : null,
    ctx.portfolio ? `Portfolio context: ${ctx.portfolio}` : null,
    ctx.activity ? `Recent pipeline activity: ${ctx.activity}` : null,
    ctx.learned ? `Learned preferences (weight these, don't over-fit): ${ctx.learned}` : null,
  ].filter(Boolean);
  return parts.length ? parts.join("\n") + "\n\n" : "";
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
  /** Supporting source URL when found via web-search enrichment. */
  sourceUrl?: string;
  // Pre-review intel — populated by Claude + Apollo before the user reviews candidates.
  website?: string;
  contactName?: string;
  contactRole?: string;
  contactEmail?: string;
  contactPhone?: string;
  aumRange?: string;
  ticketRange?: string;
  strategies?: string[];
  geography?: string;
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

// Keep only well-formed http(s) URLs — the source citation for a candidate.
function cleanUrl(v: unknown): string | undefined {
  if (typeof v !== "string") return undefined;
  const s = v.trim();
  return /^https?:\/\/\S+$/i.test(s) ? s.slice(0, 500) : undefined;
}

// Extract a JSON array from free-form model text (handles ```json fences and
// surrounding prose). Used for the web-search path, where structured-output
// formatting is unavailable alongside the server tool.
function parseJsonArray(text: string): unknown[] | null {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const body = fenced ? fenced[1] : text;
  const start = body.indexOf("[");
  const end = body.lastIndexOf("]");
  if (start === -1 || end === -1 || end < start) return null;
  try {
    const parsed = JSON.parse(body.slice(start, end + 1));
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

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
          name: { type: "string", description: "Specific, real-world target name" },
          category: { type: "string", description: "One category label for this target" },
          fitScore: { type: "number", description: "0–100 fit against the mandate" },
          rationale: { type: "string", description: "One sentence: why this fits the mandate" },
          firstMove: { type: "string", description: "Short imperative first move" },
          website: { type: "string", description: "Company or fund website URL" },
          contactName: { type: "string", description: "Key decision maker full name" },
          contactRole: { type: "string", description: "Their title or role" },
          aumRange: { type: "string", description: "AUM or fund size range, e.g. '$500M–$2B'" },
          ticketRange: { type: "string", description: "Typical check or ticket size, e.g. '$1M–$5M'" },
          strategies: { type: "array", items: { type: "string" }, description: "Primary investment strategies or focus areas" },
          geography: { type: "string", description: "HQ city/country or geographic focus" },
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
  query?: string,
  context?: OperatorContext,
): Promise<SourceCandidate[]> {
  const cfg = sourceConfigFor(key);
  if (!cfg) return [];
  const options = categoryOptions(cfg);
  const anthropic = client();
  if (!anthropic) return fallbackCandidates(cfg, mandate, existingNames, options, query);

  // External enrichment first (opt-in): real, currently-operating targets with
  // a source citation. Falls through to model knowledge if it yields nothing.
  if (sourcingEnrichmentEnabled()) {
    const enriched = await enrichedTargets(anthropic, cfg, mandate, existingNames, options, query, context);
    if (enriched.length) return enriched;
  }

  const agentName = AGENT_BY_KEY[cfg.agent]?.name ?? "Sourcing";
  const catLine = cfg.freeCategory
    ? `Set "category" to the most fitting asset class.`
    : `Set "category" to exactly one of: ${options.join(", ")}.`;
  const queryLine = query ? `Operator request: ${query}\n` : "";
  try {
    const message = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 1500,
      system: `You are the ${agentName} agent inside FundExecs OS, sourcing ${cfg.entities} for a private-market operator. Propose specific, real-world targets that fit the firm's mandate and the operator's request — the kind a sharp ${agentName.toLowerCase()} would put on a call sheet. For each target include wherever you have reliable knowledge: the company website, a key decision maker's name and title, estimated AUM or fund size range, typical check or ticket size, primary strategies or focus areas, and headquarters location. Leave a field empty rather than guessing. ${catLine}`,
      output_config: { effort: "low", format: { type: "json_schema", schema: CANDIDATES_SCHEMA } },
      messages: [
        {
          role: "user",
          content:
            `Mandate:\n${mandateContext(mandate)}\n\n` +
            operatorContextBlock(context) +
            queryLine +
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
    return out.length ? out : fallbackCandidates(cfg, mandate, existingNames, options, query);
  } catch {
    return fallbackCandidates(cfg, mandate, existingNames, options, query);
  }
}

// Web-search-backed generation. Searches for real, currently-operating targets
// and asks for a plain JSON array (structured-output formatting isn't combinable
// with the server tool), then parses it. Returns [] on any failure so the
// caller falls back to model-knowledge generation.
const WEB_SEARCH_TOOLS = [
  { type: "web_search_20260209", name: "web_search", max_uses: 5 },
] as unknown as NonNullable<Anthropic.MessageCreateParamsNonStreaming["tools"]>;

async function enrichedTargets(
  anthropic: Anthropic,
  cfg: SourceAiConfig,
  mandate: SourcingMandate | null,
  existingNames: string[],
  options: string[],
  query?: string,
  context?: OperatorContext,
): Promise<SourceCandidate[]> {
  const agentName = AGENT_BY_KEY[cfg.agent]?.name ?? "Sourcing";
  const catLine = cfg.freeCategory
    ? `Set "category" to the most fitting asset class.`
    : `Set "category" to exactly one of: ${options.join(", ")}.`;
  const queryLine = query ? `Operator request: ${query}\n` : "";
  try {
    const message = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 3000,
      output_config: { effort: "low" },
      system: `You are the ${agentName} agent inside FundExecs OS, sourcing ${cfg.entities} for a private-market operator. Use web search to find REAL, currently-operating ${cfg.entities} that fit the firm's mandate and the operator's request. For each include: sourceUrl (a supporting page), website, a key decision maker name and title, AUM or fund size range, typical check or ticket size, primary strategies, and geography. Return ONLY a JSON array (no prose, no markdown) of objects with keys: name, category, fitScore (0-100), rationale, firstMove, sourceUrl, website, contactName, contactRole, aumRange, ticketRange, strategies (array of strings), geography. ${catLine}`,
      tools: WEB_SEARCH_TOOLS,
      messages: [
        {
          role: "user",
          content:
            `Mandate:\n${mandateContext(mandate)}\n\n` +
            operatorContextBlock(context) +
            queryLine +
            `Find 3–6 ${cfg.entities}: ${cfg.hint}.\n` +
            (existingNames.length
              ? `Already in the pipeline (do not repeat): ${existingNames.slice(0, 40).join(", ")}.\n`
              : "") +
            `Return the JSON array.`,
        },
      ],
    });
    const raw = parseJsonArray(textOf(message));
    if (!raw) return [];
    return normalizeCandidates(raw, cfg, options, existingNames);
  } catch {
    return [];
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
    const rawStrategies = o.strategies;
    const strategies = Array.isArray(rawStrategies)
      ? (rawStrategies as unknown[]).filter((s): s is string => typeof s === "string").map((s) => s.trim()).filter(Boolean).slice(0, 5)
      : undefined;
    out.push({
      name,
      category: category || (cfg.freeCategory ? "" : options[0] ?? "other"),
      fitScore: clampScore(o.fitScore),
      rationale: cleanStr(o.rationale, 240) || "Fits the mandate.",
      firstMove: cleanStr(o.firstMove, 120) || "Research and qualify.",
      sourceUrl: cleanUrl(o.sourceUrl),
      website: cleanUrl(o.website),
      contactName: cleanStr(o.contactName, 120) || undefined,
      contactRole: cleanStr(o.contactRole, 120) || undefined,
      aumRange: cleanStr(o.aumRange, 60) || undefined,
      ticketRange: cleanStr(o.ticketRange, 60) || undefined,
      strategies: strategies?.length ? strategies : undefined,
      geography: cleanStr(o.geography, 120) || undefined,
    });
    if (out.length >= 6) break;
  }
  return out.sort((a, b) => b.fitScore - a.fitScore);
}

// After Claude generates candidates, look up real decision-maker contacts via
// Apollo for any candidate that lacks an email. Runs in parallel batches of 3
// with a 4s timeout; failures are non-fatal — the candidate keeps Claude data.
export async function apolloEnrichCandidates(candidates: SourceCandidate[]): Promise<SourceCandidate[]> {
  const { searchPeople } = await import("@/lib/integrations/providers/apollo");
  const BATCH = 3;
  const result = [...candidates];
  for (let i = 0; i < result.length; i += BATCH) {
    const chunk = result.slice(i, i + BATCH);
    const settled = await Promise.allSettled(
      chunk.map(async (c) => {
        if (c.contactEmail) return c;
        try {
          let _t: ReturnType<typeof setTimeout> | undefined;
          const res = await Promise.race([
            searchPeople({ company: c.name, person_seniority: ["c_suite", "vp", "director"], per_page: 1 })
              .finally(() => clearTimeout(_t)),
            new Promise<never>((_, rej) => { _t = setTimeout(() => rej(new Error("timeout")), 4000); }),
          ]);
          if (res.status === "success" && res.data?.[0]) {
            const p = res.data[0];
            return {
              ...c,
              contactName: c.contactName || p.name,
              contactRole: c.contactRole || p.title,
              contactEmail: c.contactEmail || p.email,
              contactPhone: c.contactPhone || p.phone,
            };
          }
        } catch { /* non-fatal */ }
        return c;
      })
    );
    settled.forEach((r, j) => {
      if (r.status === "fulfilled") result[i + j] = r.value;
    });
  }
  return result;
}

// Deterministic archetypes from the mandate — honest "go find one of these"
// profiles rather than fabricated firm names, so the feature works with no key.
function fallbackCandidates(
  cfg: SourceAiConfig,
  mandate: SourcingMandate | null,
  existingNames: string[],
  options: string[],
  query?: string,
): SourceCandidate[] {
  const geos = mandate?.geographies?.length ? mandate.geographies : ["your core market"];
  const classes = mandate?.assetClasses?.length ? mandate.assetClasses : ["the target strategy"];
  const seen = new Set(existingNames.map((n) => n.toLowerCase()));
  const picks: SourceCandidate[] = [];
  const focus = query?.trim().slice(0, 180);
  const focusClause = focus ? ` Operator request: ${focus}.` : "";
  const add = (name: string, category: string, fitScore: number, rationale: string, firstMove: string) => {
    if (seen.has(name.toLowerCase()) || picks.length >= 5) return;
    seen.add(name.toLowerCase());
    picks.push({ name, category, fitScore, rationale: `${rationale}${focusClause}`, firstMove });
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
// 1b. PLAN (Earn) — turn an operator's request into a multi-agent search
// ===========================================================================
export interface SourceSearchStep {
  /** A source module key, e.g. "source/lp_pipeline". */
  module: string;
  /** The Source agent that owns this step (derived from the module). */
  agent: AgentKey;
  /** Short imperative title, e.g. "Surface anchor LPs". */
  title: string;
  /** Refined, module-specific query for this step. */
  query: string;
}
export interface SourceSearchPlan {
  summary: string;
  steps: SourceSearchStep[];
}

const SOURCE_MODULE_KEYS = Object.keys(CONFIGS);

const PLAN_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    summary: { type: "string", description: "One sentence on what this search will do" },
    steps: {
      type: "array",
      description: "1–4 module searches the request implies, best-fit first",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          module: { type: "string", enum: SOURCE_MODULE_KEYS },
          title: { type: "string", description: "Short imperative step title" },
          query: { type: "string", description: "Refined query for this module" },
        },
        required: ["module", "title", "query"],
      },
    },
  },
  required: ["summary", "steps"],
} as const;

function stepFor(module: string, query: string, title?: string): SourceSearchStep | null {
  const cfg = sourceConfigFor(module);
  if (!cfg) return null;
  return { module, agent: cfg.agent, title: title || `Source ${cfg.entities}`, query };
}

// Deterministic plan when no model key is present (or Claude fails): map the
// request to modules by keyword, always returning at least the two pipelines.
function fallbackPlan(prompt: string): SourceSearchPlan {
  const t = prompt.toLowerCase();
  const picks: SourceSearchStep[] = [];
  const add = (module: string) => {
    if (picks.some((p) => p.module === module)) return;
    const s = stepFor(module, prompt);
    if (s) picks.push(s);
  };
  if (/\blp\b|lps|investor|allocator|family office|capital/.test(t)) add("source/lp_pipeline");
  if (/deal|target|acquisition|company|asset|opportunit/.test(t)) add("source/deal_pipeline");
  if (/lender|debt|credit|loan|mezz|financ/.test(t)) add("source/debt");
  if (/partner|co-?gp|operating|advisor|introducer/.test(t)) add("source/partners");
  if (/legal|audit|\btax\b|fund admin|administrator|provider|counsel|placement/.test(t)) add("source/providers");
  if (picks.length === 0) {
    add("source/lp_pipeline");
    add("source/deal_pipeline");
  }
  return { summary: `Source against the mandate: ${prompt}`.slice(0, 160), steps: picks.slice(0, 4) };
}

function normalizePlan(raw: Partial<SourceSearchPlan> | null, prompt: string): SourceSearchPlan {
  if (!raw || !Array.isArray(raw.steps)) return fallbackPlan(prompt);
  const seen = new Set<string>();
  const steps: SourceSearchStep[] = [];
  for (const r of raw.steps) {
    if (!r || typeof r !== "object") continue;
    const o = r as unknown as Record<string, unknown>;
    const moduleKey = cleanStr(o.module, 60);
    if (!sourceConfigFor(moduleKey) || seen.has(moduleKey)) continue;
    seen.add(moduleKey);
    const s = stepFor(moduleKey, cleanStr(o.query, 280) || prompt, cleanStr(o.title, 80));
    if (s) steps.push(s);
    if (steps.length >= 4) break;
  }
  if (steps.length === 0) return fallbackPlan(prompt);
  return { summary: cleanStr(raw.summary, 200) || `Source against the mandate: ${prompt}`.slice(0, 160), steps };
}

/**
 * Earn plans an operator's free-text sourcing request into a small set of
 * module searches, each delegated to the owning Source agent. Claude-backed
 * with a deterministic keyword fallback.
 */
export async function planSourceSearch(
  prompt: string,
  mandate: SourcingMandate | null,
  context?: OperatorContext,
): Promise<SourceSearchPlan> {
  const anthropic = client();
  if (!anthropic) return fallbackPlan(prompt);
  try {
    const message = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 1200,
      system:
        `You are Earn, the command layer of FundExecs OS, coordinating the Source team for a private-market operator. ` +
        `Given a sourcing request, choose the 1–4 Source modules it actually implies and write a refined query for each. ` +
        `Modules: source/lp_pipeline (LPs / capital allocators), source/deal_pipeline (acquisition targets), ` +
        `source/debt (lenders / structured capital), source/partners (co-GPs / operating partners / advisors), ` +
        `source/providers (legal / audit / tax / fund admin). Only include modules the request implies.`,
      output_config: { effort: "low", format: { type: "json_schema", schema: PLAN_SCHEMA } },
      messages: [
        {
          role: "user",
          content: `Mandate:\n${mandateContext(mandate)}\n\n${operatorContextBlock(context)}Request: ${prompt}\n\nReturn the plan.`,
        },
      ],
    });
    const json = textOf(message);
    return normalizePlan(json ? (JSON.parse(json) as Partial<SourceSearchPlan>) : null, prompt);
  } catch {
    return fallbackPlan(prompt);
  }
}

// ===========================================================================
// 1c. TRIAGE PLAN (Earn) — turn a triage request into the modules to score
// ===========================================================================
// Unlike planSourceSearch (which finds NEW targets), triage works on the rows
// already in the pipeline: Earn picks which Source modules the question implies,
// then each module's live rows are scored + ranked. DB-free; the server action
// loads the rows. Claude-backed with a deterministic keyword fallback.
export interface TriagePlan {
  summary: string;
  /** 1–4 source/* module keys to triage, best-fit first. */
  modules: string[];
}

const TRIAGE_PLAN_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    summary: { type: "string", description: "One sentence on what this triage will do" },
    modules: {
      type: "array",
      description: "1–4 module keys the request implies, best-fit first",
      items: { type: "string", enum: SOURCE_MODULE_KEYS },
    },
  },
  required: ["summary", "modules"],
} as const;

// Deterministic triage plan: map the request to modules by keyword (same style
// as fallbackPlan), always returning at least the two pipelines.
function fallbackTriagePlan(prompt: string): TriagePlan {
  const t = prompt.toLowerCase();
  const picks: string[] = [];
  const add = (moduleKey: string) => {
    if (picks.includes(moduleKey) || !sourceConfigFor(moduleKey)) return;
    picks.push(moduleKey);
  };
  if (/\blp\b|lps|investor|allocator|family office|capital|chase|raise/.test(t)) add("source/lp_pipeline");
  if (/deal|target|acquisition|company|asset|opportunit|pipeline/.test(t)) add("source/deal_pipeline");
  if (/lender|debt|credit|loan|mezz|financ/.test(t)) add("source/debt");
  if (/partner|co-?gp|operating|advisor|introducer|bench|dormant/.test(t)) add("source/partners");
  if (/legal|audit|\btax\b|fund admin|administrator|provider|counsel|placement/.test(t)) add("source/providers");
  if (picks.length === 0) {
    add("source/lp_pipeline");
    add("source/deal_pipeline");
  }
  return { summary: `Triage the pipeline: ${prompt}`.slice(0, 160), modules: picks.slice(0, 4) };
}

function normalizeTriagePlan(raw: Partial<TriagePlan> | null, prompt: string): TriagePlan {
  if (!raw || !Array.isArray(raw.modules)) return fallbackTriagePlan(prompt);
  const seen = new Set<string>();
  const modules: string[] = [];
  for (const m of raw.modules) {
    const moduleKey = cleanStr(m, 60);
    if (!sourceConfigFor(moduleKey) || seen.has(moduleKey)) continue;
    seen.add(moduleKey);
    modules.push(moduleKey);
    if (modules.length >= 4) break;
  }
  if (modules.length === 0) return fallbackTriagePlan(prompt);
  return { summary: cleanStr(raw.summary, 200) || `Triage the pipeline: ${prompt}`.slice(0, 160), modules };
}

/**
 * Earn plans an operator's free-text triage request into the set of Source
 * modules whose existing rows should be scored + ranked. Claude-backed with a
 * deterministic keyword fallback.
 */
export async function planTriage(
  prompt: string,
  mandate: SourcingMandate | null,
  context?: OperatorContext,
): Promise<TriagePlan> {
  const anthropic = client();
  if (!anthropic) return fallbackTriagePlan(prompt);
  try {
    const message = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 800,
      system:
        `You are Earn, the command layer of FundExecs OS, coordinating the Source team for a private-market operator. ` +
        `The operator wants to triage rows ALREADY in their pipeline (not find new targets). ` +
        `Given a triage request, choose the 1–4 Source modules whose existing rows it implies. ` +
        `Modules: source/lp_pipeline (LPs / capital allocators), source/deal_pipeline (acquisition targets / deals), ` +
        `source/debt (lenders / structured capital), source/partners (co-GPs / operating partners / advisors / bench), ` +
        `source/providers (legal / audit / tax / fund admin). Only include modules the request implies.`,
      output_config: { effort: "low", format: { type: "json_schema", schema: TRIAGE_PLAN_SCHEMA } },
      messages: [
        {
          role: "user",
          content: `Mandate:\n${mandateContext(mandate)}\n\n${operatorContextBlock(context)}Triage request: ${prompt}\n\nReturn the plan.`,
        },
      ],
    });
    const json = textOf(message);
    return normalizeTriagePlan(json ? (JSON.parse(json) as Partial<TriagePlan>) : null, prompt);
  } catch {
    return fallbackTriagePlan(prompt);
  }
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
  context?: OperatorContext,
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
            operatorContextBlock(context) +
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
  operatorContextBlock,
  normalizeCandidates,
  normalizeScores,
  fallbackCandidates,
  fallbackScores,
  coerceAction,
  clampScore,
  cleanUrl,
  parseJsonArray,
  fallbackPlan,
  normalizePlan,
  fallbackTriagePlan,
  normalizeTriagePlan,
  SOURCE_ACTIONS,
  tierForAction,
};
