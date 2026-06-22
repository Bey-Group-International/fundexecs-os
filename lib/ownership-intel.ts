// lib/ownership-intel.ts
// The Ownership & Buyer Intelligence engine — the FundExecs answer to Mergr:
// acquisition history, buyer lists, and add-on / strategic-buyer discovery, on
// top of the Sourcing Intelligence catalog (0042) and the deals table.
//
// The file is split into two halves on purpose:
//
//   1. PURE helpers (no DB, no I/O) — scoreBuyerFit / rankBuyersForTarget /
//      addOnFitScore / summarizeAcquisitions. These mirror lib/matching.ts: small,
//      deterministic, trivially unit-testable, and exported under `__test`.
//
//   2. DB-aware functions — discoverBuyers / discoverAddOns / recordAcquisitions /
//      recordBuyers / listAcquisitions / listBuyers. Discovery is Claude-optional
//      behind the same client() seam as lib/source-ai.ts: when no ANTHROPIC_API_KEY
//      is present every path falls back to deterministic output, so the loop stays
//      demoable in CI/preview with no key and no spend (REQUIRED — CI has no key).
import Anthropic from "@anthropic-ai/sdk";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Acquisition, BuyerProfile, Database } from "@/lib/supabase/database.types";

type Client = SupabaseClient<Database>;

const MODEL = process.env.CLAUDE_MODEL || "claude-sonnet-4-6";

export function ownershipLive(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

function client(): Anthropic | null {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  return apiKey ? new Anthropic({ apiKey }) : null;
}

// ---------------------------------------------------------------------------
// Domain vocabulary
// ---------------------------------------------------------------------------
export type BuyerType = "strategic" | "financial" | "pe" | "family_office" | "search_fund";
export const BUYER_TYPES: BuyerType[] = ["strategic", "financial", "pe", "family_office", "search_fund"];

export type AcquisitionStructure = "majority" | "minority" | "add_on" | "merger" | "asset" | "recap";
export const ACQUISITION_STRUCTURES: AcquisitionStructure[] = [
  "majority",
  "minority",
  "add_on",
  "merger",
  "asset",
  "recap",
];

// A buyer the engine reasons over (a subset of the buyer_profiles row, plus the
// shape discovery emits before it is persisted).
export interface BuyerLike {
  name: string;
  buyerType?: BuyerType | string | null;
  thesis?: string | null;
  sectors?: string[] | null;
  geographies?: string[] | null;
  checkMin?: number | null;
  checkMax?: number | null;
  /** 0–100 acquisitiveness signal. */
  appetite?: number | null;
}

// The business a buyer is being matched against ("who would buy this?").
export interface TargetLike {
  name: string;
  sector?: string | null;
  geography?: string | null;
  /** Headline deal size / enterprise value, if known. */
  size?: number | null;
}

export interface BuyerFit {
  /** 0–100 — how well this buyer fits this target. */
  score: number;
  reasons: string[];
}

export interface RankedBuyer extends BuyerFit {
  buyer: BuyerLike;
}

// ---------------------------------------------------------------------------
// PURE helpers
// ---------------------------------------------------------------------------
function humanize(s: string): string {
  return s.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

const clampPct = (n: number): number => Math.max(0, Math.min(100, Math.round(n)));

// Token-overlap helper for free-text sector/geography matching, so "industrial
// services" matches "Industrial Services & Distribution".
function tokens(s: string): Set<string> {
  return new Set(
    s
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter((w) => w.length > 2),
  );
}

// Does any value in `list` overlap `needle` (by substring or shared token)?
function listMatches(list: string[] | null | undefined, needle: string | null | undefined): boolean {
  if (!needle || !list || list.length === 0) return false;
  const n = needle.toLowerCase().trim();
  if (!n) return false;
  const nTokens = tokens(n);
  for (const raw of list) {
    const v = raw.toLowerCase().trim();
    if (!v) continue;
    if (v.includes(n) || n.includes(v)) return true;
    const vTokens = tokens(v);
    for (const t of vTokens) if (nTokens.has(t)) return true;
  }
  return false;
}

/**
 * Score how well a buyer fits a target, 0–100. Deterministic — the bands mirror
 * lib/matching.ts so Source surfaces feel like one instrument:
 *
 *   sector fit     → up to 40   (the dominant signal in M&A buyer mapping)
 *   geography      → up to 20
 *   check-band fit → up to 25   (does the target's size sit in their band?)
 *   appetite       → up to 15   (acquisitiveness)
 *
 * Missing data is treated as neutral partial credit, never a penalty.
 */
export function scoreBuyerFit(buyer: BuyerLike, target: TargetLike): BuyerFit {
  const reasons: string[] = [];
  let score = 0;

  // Sector fit (up to 40).
  if (target.sector && buyer.sectors && buyer.sectors.length) {
    if (listMatches(buyer.sectors, target.sector)) {
      score += 40;
      reasons.push(`Active in ${target.sector}.`);
    } else {
      score += 8;
      reasons.push("Different core sector — a diversifying move for them.");
    }
  } else {
    score += 16; // unknown sector mapping — neutral.
  }

  // Geography (up to 20).
  if (target.geography && buyer.geographies && buyer.geographies.length) {
    if (listMatches(buyer.geographies, target.geography)) {
      score += 20;
      reasons.push(`Operates in ${target.geography}.`);
    }
  } else {
    score += 8;
  }

  // Check-band fit (up to 25). Does the deal size sit inside their band?
  const size = target.size;
  const lo = buyer.checkMin ?? null;
  const hi = buyer.checkMax ?? null;
  if (size != null && (lo != null || hi != null)) {
    const low = lo ?? 0;
    const high = hi ?? Number.POSITIVE_INFINITY;
    if (size >= low && size <= high) {
      score += 25;
      reasons.push("Deal size fits their check band.");
    } else if (size < low) {
      score += 12;
      reasons.push("Below their typical check — a small bolt-on for them.");
    } else {
      score += 6;
      reasons.push("Above their typical check — they'd have to stretch or club.");
    }
  } else {
    score += 12; // no size / no band — neutral.
  }

  // Appetite (up to 15).
  const appetite = buyer.appetite;
  if (appetite != null && Number.isFinite(appetite)) {
    const a = Math.max(0, Math.min(100, appetite));
    score += Math.round((a / 100) * 15);
    if (a >= 70) reasons.push("Highly acquisitive right now.");
  } else {
    score += 7;
  }

  return { score: clampPct(score), reasons };
}

/**
 * Rank a pool of buyers for one target, best fit first. `minScore` drops weak
 * matches; `limit` caps the surfaced set.
 */
export function rankBuyersForTarget(
  buyers: BuyerLike[],
  target: TargetLike,
  opts: { minScore?: number; limit?: number } = {},
): RankedBuyer[] {
  const { minScore = 35, limit = 8 } = opts;
  return buyers
    .map((buyer) => ({ buyer, ...scoreBuyerFit(buyer, target) }))
    .filter((m) => m.score >= minScore)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

// A bolt-on candidate measured against a platform company.
export interface PlatformLike {
  name: string;
  sector?: string | null;
  geography?: string | null;
}
export interface AddOnCandidate {
  name: string;
  sector?: string | null;
  geography?: string | null;
  /** Optional revenue/size signal. */
  size?: number | null;
}
export interface AddOnFit {
  score: number;
  reasons: string[];
}

/**
 * Score a bolt-on / add-on candidate against a platform, 0–100. Add-ons are
 * sector-led (same vertical = consolidation) and geography-aware (adjacent market
 * = expansion); smaller is better for a tuck-in.
 *
 *   sector adjacency → up to 55
 *   geography        → up to 30 (same = consolidate, else expansion credit)
 *   tuck-in size     → up to 15 (smaller candidates favored)
 */
export function addOnFitScore(candidate: AddOnCandidate, platform: PlatformLike): AddOnFit {
  const reasons: string[] = [];
  let score = 0;

  if (platform.sector && candidate.sector) {
    if (
      candidate.sector.toLowerCase().includes(platform.sector.toLowerCase()) ||
      platform.sector.toLowerCase().includes(candidate.sector.toLowerCase()) ||
      listMatches([candidate.sector], platform.sector)
    ) {
      score += 55;
      reasons.push(`Same vertical as ${platform.name} — consolidation play.`);
    } else {
      score += 18;
      reasons.push("Adjacent capability — broadens the platform.");
    }
  } else {
    score += 28;
  }

  if (platform.geography && candidate.geography) {
    if (listMatches([candidate.geography], platform.geography)) {
      score += 22;
      reasons.push("Same geography — operational overlap.");
    } else {
      score += 30;
      reasons.push(`New market (${candidate.geography}) — geographic expansion.`);
    }
  } else {
    score += 15;
  }

  // Tuck-in: smaller candidates are cleaner bolt-ons.
  if (candidate.size != null && candidate.size > 0) {
    score += candidate.size <= 25_000_000 ? 15 : candidate.size <= 100_000_000 ? 8 : 3;
  } else {
    score += 8;
  }

  return { score: clampPct(score), reasons };
}

// ---------------------------------------------------------------------------
// Acquisition-history summarization (pure)
// ---------------------------------------------------------------------------
export interface AcquisitionLike {
  acquirerName: string;
  targetName: string;
  announcedOn?: string | null;
  priceAmount?: number | null;
  currency?: string | null;
  structure?: string | null;
  sector?: string | null;
}

export interface AcquisitionSummary {
  count: number;
  /** Total disclosed price across rows that carry one. */
  totalDisclosed: number;
  /** ISO years spanned, e.g. "2019–2024" or "" when no dates. */
  span: string;
  /** Distinct sectors touched, most frequent first. */
  topSectors: string[];
  /** Count by structure, e.g. { add_on: 4, majority: 2 }. */
  byStructure: Record<string, number>;
  /** Most acquisitive name + its deal count (the serial acquirer). */
  topAcquirer: { name: string; count: number } | null;
}

/**
 * Summarize an acquisition history into the headline facts a buyer-mapping
 * surface shows: how many deals, disclosed value, the year span, the sectors
 * touched, the structure mix, and the most active acquirer. Pure.
 */
export function summarizeAcquisitions(rows: AcquisitionLike[]): AcquisitionSummary {
  const summary: AcquisitionSummary = {
    count: rows.length,
    totalDisclosed: 0,
    span: "",
    topSectors: [],
    byStructure: {},
    topAcquirer: null,
  };
  if (rows.length === 0) return summary;

  const years: number[] = [];
  const sectorCounts = new Map<string, number>();
  const acquirerCounts = new Map<string, number>();

  for (const r of rows) {
    if (typeof r.priceAmount === "number" && Number.isFinite(r.priceAmount) && r.priceAmount > 0) {
      summary.totalDisclosed += r.priceAmount;
    }
    if (r.announcedOn) {
      const y = Number(String(r.announcedOn).slice(0, 4));
      if (Number.isFinite(y) && y > 1900) years.push(y);
    }
    if (r.sector) sectorCounts.set(r.sector, (sectorCounts.get(r.sector) ?? 0) + 1);
    const st = r.structure ?? "unknown";
    summary.byStructure[st] = (summary.byStructure[st] ?? 0) + 1;
    if (r.acquirerName) {
      acquirerCounts.set(r.acquirerName, (acquirerCounts.get(r.acquirerName) ?? 0) + 1);
    }
  }

  if (years.length) {
    const lo = Math.min(...years);
    const hi = Math.max(...years);
    summary.span = lo === hi ? String(lo) : `${lo}–${hi}`;
  }
  summary.topSectors = [...sectorCounts.entries()].sort((a, b) => b[1] - a[1]).map(([s]) => s).slice(0, 5);
  const topAcq = [...acquirerCounts.entries()].sort((a, b) => b[1] - a[1])[0];
  if (topAcq) summary.topAcquirer = { name: topAcq[0], count: topAcq[1] };

  return summary;
}

// ---------------------------------------------------------------------------
// Claude-optional discovery plumbing
// ---------------------------------------------------------------------------
const clampScore = (n: unknown): number => {
  const v = typeof n === "number" ? n : Number(n);
  if (!Number.isFinite(v)) return 50;
  return Math.max(0, Math.min(100, Math.round(v)));
};
const cleanStr = (v: unknown, max: number): string => (typeof v === "string" ? v.trim().slice(0, max) : "");
function cleanNum(v: unknown): number | null {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) && n > 0 ? n : null;
}
function cleanStrArr(v: unknown, max: number): string[] {
  if (!Array.isArray(v)) return [];
  return v.map((x) => cleanStr(x, 60)).filter(Boolean).slice(0, max);
}
function coerceBuyerType(v: unknown): BuyerType {
  const s = cleanStr(v, 40).toLowerCase().replace(/\s+/g, "_");
  return (BUYER_TYPES as string[]).includes(s) ? (s as BuyerType) : "financial";
}
function textOf(message: Anthropic.Message): string {
  return message.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("\n")
    .trim();
}

export interface BuyerCandidate extends BuyerLike {
  buyerType: BuyerType;
  /** 0–100 fit against the target. */
  fitScore: number;
  rationale: string;
  sourceUrl?: string | null;
}

const BUYERS_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    buyers: {
      type: "array",
      description: "4–8 plausible buyers for the target, best fit first",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          name: { type: "string", description: "Specific, plausible buyer name" },
          buyerType: { type: "string", enum: BUYER_TYPES, description: "Kind of buyer" },
          thesis: { type: "string", description: "One line on their acquisition thesis" },
          sectors: { type: "array", items: { type: "string" } },
          geographies: { type: "array", items: { type: "string" } },
          rationale: { type: "string", description: "Why this buyer would want the target" },
        },
        required: ["name", "buyerType", "thesis", "rationale"],
      },
    },
  },
  required: ["buyers"],
} as const;

function normalizeBuyers(raw: unknown[], target: TargetLike): BuyerCandidate[] {
  const seen = new Set<string>();
  const out: BuyerCandidate[] = [];
  for (const r of raw) {
    if (!r || typeof r !== "object") continue;
    const o = r as Record<string, unknown>;
    const name = cleanStr(o.name, 120);
    if (!name || seen.has(name.toLowerCase())) continue;
    seen.add(name.toLowerCase());
    const buyerType = coerceBuyerType(o.buyerType);
    const sectors = cleanStrArr(o.sectors, 6);
    const geographies = cleanStrArr(o.geographies, 6);
    const appetite = o.appetite != null ? clampScore(o.appetite) : null;
    const buyer: BuyerLike = {
      name,
      buyerType,
      thesis: cleanStr(o.thesis, 240) || null,
      sectors: sectors.length ? sectors : target.sector ? [target.sector] : [],
      geographies,
      checkMin: cleanNum(o.checkMin),
      checkMax: cleanNum(o.checkMax),
      appetite,
    };
    // Trust the deterministic scorer over a model-claimed number for consistency.
    const fit = scoreBuyerFit(buyer, target).score;
    out.push({
      ...buyer,
      buyerType,
      fitScore: o.fitScore != null ? Math.round((clampScore(o.fitScore) + fit) / 2) : fit,
      rationale: cleanStr(o.rationale, 240) || "Plausible buyer for this profile.",
      sourceUrl: null,
    });
    if (out.length >= 8) break;
  }
  return out.sort((a, b) => b.fitScore - a.fitScore);
}

// Deterministic buyer archetypes from the target — honest "go find one of these"
// profiles rather than fabricated firm names, so discovery works with no key.
function fallbackBuyers(target: TargetLike): BuyerCandidate[] {
  const sector = target.sector?.trim() || "the sector";
  const geo = target.geography?.trim() || "the target's region";
  const sectors = target.sector ? [target.sector] : [];
  const geos = target.geography ? [target.geography] : [];
  const archetypes: Array<Omit<BuyerCandidate, "fitScore">> = [
    {
      name: `PE platform consolidating ${sector}`,
      buyerType: "pe",
      thesis: `Buy-and-build roll-up in ${sector}.`,
      sectors,
      geographies: geos,
      checkMin: null,
      checkMax: null,
      appetite: 80,
      rationale: `A sponsor running a ${sector} platform would treat ${target.name} as an add-on.`,
    },
    {
      name: `Strategic acquirer in ${sector}`,
      buyerType: "strategic",
      thesis: `Adjacency / market-share expansion in ${sector}.`,
      sectors,
      geographies: geos,
      checkMin: null,
      checkMax: null,
      appetite: 65,
      rationale: `An incumbent operator gains capability and customers from ${target.name}.`,
    },
    {
      name: `Generalist financial sponsor — ${geo}`,
      buyerType: "financial",
      thesis: `Control buyout of profitable lower-mid-market businesses in ${geo}.`,
      sectors,
      geographies: geos,
      checkMin: null,
      checkMax: null,
      appetite: 55,
      rationale: `Fits a generalist control mandate active in ${geo}.`,
    },
    {
      name: `Family office — direct ${sector} hold`,
      buyerType: "family_office",
      thesis: "Long-hold direct ownership of cash-generative businesses.",
      sectors,
      geographies: geos,
      checkMin: null,
      checkMax: null,
      appetite: 45,
      rationale: "Patient capital seeking a durable, owner-operated asset.",
    },
    {
      name: `Search fund / independent sponsor — ${geo}`,
      buyerType: "search_fund",
      thesis: "Owner-succession acquisition of a single established business.",
      sectors,
      geographies: geos,
      checkMin: null,
      checkMax: null,
      appetite: 50,
      rationale: `An operator-buyer targeting succession deals in ${geo}.`,
    },
  ];
  return archetypes
    .map((a) => ({ ...a, fitScore: scoreBuyerFit(a, target).score }))
    .sort((a, b) => b.fitScore - a.fitScore);
}

/**
 * Discover plausible buyers for a target. Claude-backed when a key is present
 * (structured output), with a deterministic archetype fallback otherwise. The
 * `client()` seam is the adapter point for a real provider/web-search backend.
 */
export async function discoverBuyers(target: TargetLike): Promise<BuyerCandidate[]> {
  const anthropic = client();
  if (!anthropic) return fallbackBuyers(target);
  try {
    const message = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 1500,
      system:
        "You are the Ownership Intelligence agent inside FundExecs OS, mapping likely buyers " +
        "for a sell-side / sourcing target in private markets. Propose specific, plausible " +
        "buyer profiles (strategic, financial, PE, family office, search fund) that would " +
        "credibly acquire the target. These are AI suggestions the operator will verify — be " +
        "concrete but never fabricate confidential facts.",
      output_config: { effort: "low", format: { type: "json_schema", schema: BUYERS_SCHEMA } },
      messages: [
        {
          role: "user",
          content:
            `Target business:\n` +
            `- Name: ${target.name}\n` +
            (target.sector ? `- Sector: ${target.sector}\n` : "") +
            (target.geography ? `- Geography: ${target.geography}\n` : "") +
            (target.size ? `- Approx. size: ${target.size}\n` : "") +
            `\nReturn 4–8 ranked likely buyers.`,
        },
      ],
    });
    const json = textOf(message);
    const raw = json ? (JSON.parse(json) as { buyers?: unknown[] }) : null;
    const out = normalizeBuyers(raw?.buyers ?? [], target);
    return out.length ? out : fallbackBuyers(target);
  } catch {
    return fallbackBuyers(target);
  }
}

export interface AddOnResult extends AddOnCandidate {
  fitScore: number;
  rationale: string;
}

const ADDONS_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    addOns: {
      type: "array",
      description: "4–8 bolt-on / add-on candidates for the platform, best fit first",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          name: { type: "string" },
          sector: { type: "string" },
          geography: { type: "string" },
          rationale: { type: "string", description: "Why this bolts onto the platform" },
        },
        required: ["name", "rationale"],
      },
    },
  },
  required: ["addOns"],
} as const;

function normalizeAddOns(raw: unknown[], platform: PlatformLike): AddOnResult[] {
  const seen = new Set<string>();
  const out: AddOnResult[] = [];
  for (const r of raw) {
    if (!r || typeof r !== "object") continue;
    const o = r as Record<string, unknown>;
    const name = cleanStr(o.name, 120);
    if (!name || seen.has(name.toLowerCase())) continue;
    seen.add(name.toLowerCase());
    const candidate: AddOnCandidate = {
      name,
      sector: cleanStr(o.sector, 80) || platform.sector || null,
      geography: cleanStr(o.geography, 80) || null,
      size: cleanNum(o.size),
    };
    out.push({
      ...candidate,
      fitScore: addOnFitScore(candidate, platform).score,
      rationale: cleanStr(o.rationale, 240) || "Plausible bolt-on for the platform.",
    });
    if (out.length >= 8) break;
  }
  return out.sort((a, b) => b.fitScore - a.fitScore);
}

function fallbackAddOns(platform: PlatformLike): AddOnResult[] {
  const sector = platform.sector?.trim() || "the platform's vertical";
  const geo = platform.geography?.trim();
  const candidates: AddOnCandidate[] = [
    { name: `Regional ${sector} operator`, sector: platform.sector ?? null, geography: geo ?? null, size: 15_000_000 },
    { name: `Adjacent-service ${sector} firm`, sector: platform.sector ?? null, geography: geo ?? null, size: 40_000_000 },
    { name: `Out-of-market ${sector} operator`, sector: platform.sector ?? null, geography: "a new region", size: 20_000_000 },
    { name: `Specialty ${sector} niche player`, sector: platform.sector ?? null, geography: geo ?? null, size: 8_000_000 },
  ];
  return candidates
    .map((c) => ({
      ...c,
      fitScore: addOnFitScore(c, platform).score,
      rationale: addOnFitScore(c, platform).reasons.join(" ") || "Plausible bolt-on for the platform.",
    }))
    .sort((a, b) => b.fitScore - a.fitScore);
}

/**
 * Discover companies that bolt onto a platform. Claude-backed with a
 * deterministic fallback (same Claude-optional pattern as discoverBuyers).
 */
export async function discoverAddOns(platform: PlatformLike): Promise<AddOnResult[]> {
  const anthropic = client();
  if (!anthropic) return fallbackAddOns(platform);
  try {
    const message = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 1500,
      system:
        "You are the Ownership Intelligence agent inside FundExecs OS, finding bolt-on / add-on " +
        "acquisition candidates for a platform company a sponsor owns or is building. Favor same- " +
        "vertical consolidation and adjacent-market expansion. These are AI suggestions the " +
        "operator will verify — concrete but never fabricated.",
      output_config: { effort: "low", format: { type: "json_schema", schema: ADDONS_SCHEMA } },
      messages: [
        {
          role: "user",
          content:
            `Platform company:\n` +
            `- Name: ${platform.name}\n` +
            (platform.sector ? `- Sector: ${platform.sector}\n` : "") +
            (platform.geography ? `- Geography: ${platform.geography}\n` : "") +
            `\nReturn 4–8 ranked bolt-on candidates.`,
        },
      ],
    });
    const json = textOf(message);
    const raw = json ? (JSON.parse(json) as { addOns?: unknown[] }) : null;
    const out = normalizeAddOns(raw?.addOns ?? [], platform);
    return out.length ? out : fallbackAddOns(platform);
  } catch {
    return fallbackAddOns(platform);
  }
}

// ---------------------------------------------------------------------------
// DB-aware persistence + reads (best-effort writes; never throw)
// ---------------------------------------------------------------------------
export interface AcquisitionInput {
  acquirerName: string;
  targetName: string;
  acquirerEntityId?: string | null;
  targetEntityId?: string | null;
  announcedOn?: string | null;
  priceAmount?: number | null;
  currency?: string | null;
  structure?: AcquisitionStructure | string | null;
  sector?: string | null;
  sourceUrl?: string | null;
  metadata?: Record<string, unknown>;
}

export interface BuyerInput {
  name: string;
  entityId?: string | null;
  buyerType?: BuyerType | string | null;
  thesis?: string | null;
  sectors?: string[] | null;
  geographies?: string[] | null;
  checkMin?: number | null;
  checkMax?: number | null;
  appetite?: number | null;
  sourceUrl?: string | null;
  metadata?: Record<string, unknown>;
}

type AcqInsert = Database["public"]["Tables"]["acquisitions"]["Insert"];
type BuyerInsert = Database["public"]["Tables"]["buyer_profiles"]["Insert"];

export async function recordAcquisitions(
  supabase: Client,
  orgId: string,
  userId: string | null,
  rows: AcquisitionInput[],
): Promise<number> {
  const clean = rows
    .map((r) => ({ ...r, acquirerName: (r.acquirerName ?? "").trim(), targetName: (r.targetName ?? "").trim() }))
    .filter((r) => r.acquirerName && r.targetName);
  if (clean.length === 0) return 0;
  try {
    const insert: AcqInsert[] = clean.map((r) => ({
      organization_id: orgId,
      acquirer_name: r.acquirerName.slice(0, 200),
      target_name: r.targetName.slice(0, 200),
      acquirer_entity_id: r.acquirerEntityId ?? null,
      target_entity_id: r.targetEntityId ?? null,
      announced_on: r.announcedOn ?? null,
      price_amount: r.priceAmount ?? null,
      currency: r.currency ?? "USD",
      structure: r.structure ?? null,
      sector: r.sector ?? null,
      source_url: r.sourceUrl ?? null,
      metadata: (r.metadata ?? {}) as AcqInsert["metadata"],
      created_by: userId,
    }));
    const { error } = await supabase.from("acquisitions").insert(insert);
    return error ? 0 : insert.length;
  } catch {
    return 0;
  }
}

export async function recordBuyers(
  supabase: Client,
  orgId: string,
  userId: string | null,
  rows: BuyerInput[],
): Promise<number> {
  const clean = rows.map((r) => ({ ...r, name: (r.name ?? "").trim() })).filter((r) => r.name);
  if (clean.length === 0) return 0;
  try {
    const insert: BuyerInsert[] = clean.map((r) => ({
      organization_id: orgId,
      name: r.name.slice(0, 200),
      entity_id: r.entityId ?? null,
      buyer_type: r.buyerType ?? null,
      thesis: r.thesis?.slice(0, 1000) ?? null,
      sectors: (r.sectors ?? []).slice(0, 12),
      geographies: (r.geographies ?? []).slice(0, 12),
      check_min: r.checkMin ?? null,
      check_max: r.checkMax ?? null,
      appetite: r.appetite ?? null,
      source_url: r.sourceUrl ?? null,
      metadata: (r.metadata ?? {}) as BuyerInsert["metadata"],
      created_by: userId,
    }));
    const { error } = await supabase.from("buyer_profiles").insert(insert);
    return error ? 0 : insert.length;
  } catch {
    return 0;
  }
}

/**
 * List the org's acquisition history, newest announced first. Optionally filter
 * to rows mentioning a name (as acquirer or target), e.g. to show one company's
 * deal history.
 */
export async function listAcquisitions(
  supabase: Client,
  orgId: string,
  opts: { name?: string | null; limit?: number } = {},
): Promise<Acquisition[]> {
  const limit = opts.limit ?? 100;
  try {
    let q = supabase
      .from("acquisitions")
      .select("*")
      .eq("organization_id", orgId)
      .order("announced_on", { ascending: false, nullsFirst: false })
      .order("created_at", { ascending: false })
      .limit(limit);
    const name = opts.name?.trim();
    if (name) {
      const safe = name.replace(/[%,()]/g, " ");
      q = q.or(`acquirer_name.ilike.%${safe}%,target_name.ilike.%${safe}%`);
    }
    const { data } = await q;
    return (data ?? []) as Acquisition[];
  } catch {
    return [];
  }
}

/** List the org's buyer profiles, newest first. */
export async function listBuyers(
  supabase: Client,
  orgId: string,
  opts: { limit?: number } = {},
): Promise<BuyerProfile[]> {
  const limit = opts.limit ?? 200;
  try {
    const { data } = await supabase
      .from("buyer_profiles")
      .select("*")
      .eq("organization_id", orgId)
      .order("created_at", { ascending: false })
      .limit(limit);
    return (data ?? []) as BuyerProfile[];
  } catch {
    return [];
  }
}

// Map a persisted buyer_profiles row to the BuyerLike the scorers consume.
export function buyerRowToLike(row: BuyerProfile): BuyerLike {
  return {
    name: row.name,
    buyerType: row.buyer_type,
    thesis: row.thesis,
    sectors: row.sectors,
    geographies: row.geographies,
    checkMin: row.check_min,
    checkMax: row.check_max,
    appetite: row.appetite,
  };
}

// Map a persisted acquisitions row to the AcquisitionLike the summarizer consumes.
export function acquisitionRowToLike(row: Acquisition): AcquisitionLike {
  return {
    acquirerName: row.acquirer_name,
    targetName: row.target_name,
    announcedOn: row.announced_on,
    priceAmount: row.price_amount,
    currency: row.currency,
    structure: row.structure,
    sector: row.sector,
  };
}

export const __test = {
  scoreBuyerFit,
  rankBuyersForTarget,
  addOnFitScore,
  summarizeAcquisitions,
  normalizeBuyers,
  normalizeAddOns,
  fallbackBuyers,
  fallbackAddOns,
  coerceBuyerType,
  clampScore,
  humanize,
  BUYER_TYPES,
  ACQUISITION_STRUCTURES,
};
