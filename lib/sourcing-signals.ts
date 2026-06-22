// lib/sourcing-signals.ts
// The Signals & Triggers engine — the market-intelligence + predictive layer on
// top of the Sourcing Intelligence catalog (lib/sourcing-intel.ts, migration
// 0042). This is the FundExecs answer to SourceScrub/Cyndx "triggers": discrete,
// time-stamped market signals about an entity (funding rounds, hiring, ownership
// changes, news, growth, and the soft intent signals) rolled into a deterministic
// propensity score — how likely the entity is to SELL or to RAISE.
//
// Design mirrors lib/source-ai.ts: the SCORING + SUMMARIZING helpers are PURE
// (no DB, no key, fully unit-testable — exported under __test), the GENERATE path
// is Claude-optional and falls back to deterministic output so the loop works in
// CI/preview with no ANTHROPIC_API_KEY, and the DB helpers (record/list) are
// thin, best-effort wrappers. A real third-party feed plugs in behind the
// generateSignals seam (see the comment there).
import Anthropic from "@anthropic-ai/sdk";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import type { EntityKind } from "@/lib/sourcing-intel";

type Client = SupabaseClient<Database>;

const MODEL = process.env.CLAUDE_MODEL || "claude-sonnet-4-6";

// True when a model key is present; otherwise everything falls back deterministically.
export function signalsLive(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

// ---------------------------------------------------------------------------
// Taxonomy
// ---------------------------------------------------------------------------
export type SignalType =
  | "funding_round"
  | "hiring"
  | "ownership_change"
  | "news"
  | "growth"
  | "raise_intent"
  | "sale_intent";

export const SIGNAL_TYPES: SignalType[] = [
  "funding_round",
  "hiring",
  "ownership_change",
  "news",
  "growth",
  "raise_intent",
  "sale_intent",
];

// Human-readable label per signal type (for badges / feed rows).
export const SIGNAL_LABELS: Record<SignalType, string> = {
  funding_round: "Funding round",
  hiring: "Hiring surge",
  ownership_change: "Ownership change",
  news: "In the news",
  growth: "Growth spike",
  raise_intent: "Raise intent",
  sale_intent: "Sale intent",
};

// A normalized signal as the engine + UI consume it.
export interface EntitySignalInput {
  entityId?: string | null;
  subjectName: string;
  kind?: EntityKind | null;
  signalType: SignalType;
  strength: number; // 0–100
  summary?: string | null;
  sourceUrl?: string | null;
  occurredAt?: string | null;
  metadata?: Record<string, unknown>;
}

// A signal as read back from the catalog (the feed shape).
export interface SignalRecord {
  id: string;
  entityId: string | null;
  subjectName: string;
  kind: string | null;
  signalType: SignalType;
  strength: number;
  summary: string | null;
  sourceUrl: string | null;
  occurredAt: string | null;
  createdAt: string;
}

// The predictive read on an entity from its signal bundle.
export interface Propensity {
  /** 0–100 likelihood the entity is heading toward a sale/exit. */
  sell: number;
  /** 0–100 likelihood the entity is heading toward a raise. */
  raise: number;
}

const clampPct = (n: unknown): number => {
  const v = typeof n === "number" ? n : Number(n);
  if (!Number.isFinite(v)) return 0;
  return Math.max(0, Math.min(100, Math.round(v)));
};

function coerceSignalType(v: unknown): SignalType | null {
  return SIGNAL_TYPES.includes(v as SignalType) ? (v as SignalType) : null;
}

// ===========================================================================
// PURE — propensity scoring + summaries (no DB, no key, unit-testable)
// ===========================================================================

// How each signal type pulls the two propensity dials. Weights are the marginal
// contribution of a full-strength (100) signal of that type; multiple signals
// compound with diminishing returns (see propensityScore). Intent signals are
// the strongest, direct evidence; funding/ownership are transaction-adjacent;
// hiring/growth/news are softer momentum tells.
const SELL_WEIGHTS: Record<SignalType, number> = {
  sale_intent: 0.9,
  ownership_change: 0.55,
  news: 0.2,
  growth: 0.18,
  hiring: 0.1,
  funding_round: -0.15, // a fresh raise usually defers a sale
  raise_intent: -0.1,
};

const RAISE_WEIGHTS: Record<SignalType, number> = {
  raise_intent: 0.9,
  funding_round: 0.5,
  hiring: 0.4,
  growth: 0.45,
  news: 0.2,
  ownership_change: -0.1,
  sale_intent: -0.2,
};

// Compound a set of weighted contributions into a 0–100 score with diminishing
// returns, so ten weak signals never beat one strong one and the score is
// bounded + deterministic. Each contribution c in [-1,1] (weight × strength/100).
function compound(contributions: number[]): number {
  // Positive evidence accumulates as 1 - Π(1 - c); negative evidence discounts it.
  let pos = 0;
  let neg = 0;
  for (const c of contributions) {
    if (c > 0) pos = pos + (1 - pos) * Math.min(1, c);
    else neg = neg + Math.min(1, -c) * 0.5; // negatives are softer
  }
  return clampPct((Math.max(0, pos - neg)) * 100);
}

/**
 * Deterministic propensity read: given an entity and its signals, score
 * likelihood-to-sell and likelihood-to-raise in 0–100. Pure — same input always
 * yields the same output. The `entity` arg is accepted for future firmographic
 * weighting (and to keep the call site honest) but scoring is signal-driven.
 */
export function propensityScore(
  entity: { kind?: EntityKind | string | null } | null,
  signals: { signalType: SignalType; strength: number }[],
): Propensity {
  if (!signals.length) return { sell: 0, raise: 0 };
  const sellContribs: number[] = [];
  const raiseContribs: number[] = [];
  for (const s of signals) {
    const type = coerceSignalType(s.signalType);
    if (!type) continue;
    const strength = clampPct(s.strength) / 100;
    sellContribs.push(SELL_WEIGHTS[type] * strength);
    raiseContribs.push(RAISE_WEIGHTS[type] * strength);
  }
  return { sell: compound(sellContribs), raise: compound(raiseContribs) };
}

// Tone bucket for a 0–100 score, used to color badges. Pure.
export function signalTone(score: number): "hot" | "warm" | "cool" {
  if (score >= 66) return "hot";
  if (score >= 33) return "warm";
  return "cool";
}

/**
 * One-line distillation of a signal bundle: the dominant signal types and the
 * stronger propensity. Returns "" for an empty bundle. Pure.
 */
export function summarizeSignals(
  signals: { signalType: SignalType; strength: number }[],
): string {
  if (!signals.length) return "No signals yet.";
  const counts = new Map<SignalType, number>();
  for (const s of signals) {
    const type = coerceSignalType(s.signalType);
    if (!type) continue;
    counts.set(type, (counts.get(type) ?? 0) + 1);
  }
  const top = [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([t, n]) => (n > 1 ? `${SIGNAL_LABELS[t]} ×${n}` : SIGNAL_LABELS[t]));
  const { sell, raise } = propensityScore(null, signals);
  const lead =
    sell > raise && sell >= 33
      ? `Leaning sell (${sell}%)`
      : raise >= 33
        ? `Leaning raise (${raise}%)`
        : "Quiet";
  return `${lead} · ${top.join(", ")}`;
}

// ===========================================================================
// GENERATE — produce plausible signals for an entity (Claude-optional)
// ===========================================================================
function client(): Anthropic | null {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  return apiKey ? new Anthropic({ apiKey }) : null;
}

function textOf(message: Anthropic.Message): string {
  return message.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("\n")
    .trim();
}

const cleanStr = (v: unknown, max: number): string =>
  typeof v === "string" ? v.trim().slice(0, max) : "";

// A small deterministic hash so generated strength/types are stable per subject
// (same entity → same plausible signals every run, key or no key).
function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h);
}

// The deterministic archetypes per entity kind — which signal types are plausible
// for that kind of entity, in priority order.
const KIND_SIGNAL_PROFILE: Record<string, SignalType[]> = {
  company: ["growth", "hiring", "funding_round", "sale_intent", "news"],
  investor: ["raise_intent", "funding_round", "news", "hiring"],
  fund: ["raise_intent", "funding_round", "news"],
  advisor: ["news", "hiring", "growth"],
  lender: ["news", "growth", "funding_round"],
  provider: ["growth", "hiring", "news"],
};

/**
 * Deterministic signal generation: derive 2–3 plausible signals for an entity
 * from its kind + name hash. Honest "here's what to watch for" archetypes rather
 * than fabricated facts, so the feature works with no model key.
 */
export function fallbackSignals(entity: {
  entityId?: string | null;
  name: string;
  kind?: EntityKind | string | null;
}): EntitySignalInput[] {
  const name = (entity.name ?? "").trim();
  if (!name) return [];
  const kind = (entity.kind as string) || "company";
  const profile = KIND_SIGNAL_PROFILE[kind] ?? KIND_SIGNAL_PROFILE.company;
  const seed = hashString(`${kind}:${name.toLowerCase()}`);
  const count = 2 + (seed % 2); // 2 or 3 signals
  const out: EntitySignalInput[] = [];
  for (let i = 0; i < count; i++) {
    const type = profile[(seed + i) % profile.length];
    const strength = 45 + ((seed >> (i + 1)) % 50); // 45–94, stable
    out.push({
      entityId: entity.entityId ?? null,
      subjectName: name,
      kind: (kind as EntityKind) ?? null,
      signalType: type,
      strength,
      summary: `${SIGNAL_LABELS[type]} signal for ${name} — verify against a live source.`,
      occurredAt: null,
      metadata: { generated: "deterministic" },
    });
  }
  return out;
}

const SIGNALS_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    signals: {
      type: "array",
      description: "2–4 plausible market signals for this entity, strongest first",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          signalType: { type: "string", enum: SIGNAL_TYPES },
          strength: { type: "number", description: "0–100 conviction/intensity" },
          summary: { type: "string", description: "One sentence on the signal" },
        },
        required: ["signalType", "strength", "summary"],
      },
    },
  },
  required: ["signals"],
} as const;

function normalizeGenerated(
  raw: unknown[],
  entity: { entityId?: string | null; name: string; kind?: EntityKind | string | null },
): EntitySignalInput[] {
  const out: EntitySignalInput[] = [];
  for (const r of raw) {
    if (!r || typeof r !== "object") continue;
    const o = r as Record<string, unknown>;
    const type = coerceSignalType(o.signalType);
    if (!type) continue;
    out.push({
      entityId: entity.entityId ?? null,
      subjectName: entity.name,
      kind: (entity.kind as EntityKind) ?? null,
      signalType: type,
      strength: clampPct(o.strength) || 50,
      summary: cleanStr(o.summary, 240) || `${SIGNAL_LABELS[type]} signal for ${entity.name}.`,
      occurredAt: null,
      metadata: { generated: "ai" },
    });
    if (out.length >= 4) break;
  }
  return out;
}

/**
 * Produce plausible signals for an entity. Claude-backed when ANTHROPIC_API_KEY
 * is present; otherwise (and on any failure) deterministic archetypes.
 *
 * ADAPTER SEAM: a real signal feed (news/funding/hiring providers) would replace
 * this function's body — fetch the provider's events for `entity`, map them onto
 * EntitySignalInput, and return them. The shape + downstream scoring stay the same.
 */
export async function generateSignals(entity: {
  entityId?: string | null;
  name: string;
  kind?: EntityKind | string | null;
  description?: string | null;
}): Promise<EntitySignalInput[]> {
  const name = (entity.name ?? "").trim();
  if (!name) return [];
  const anthropic = client();
  if (!anthropic) return fallbackSignals(entity);
  try {
    const message = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 1000,
      system:
        `You are the Signals agent inside FundExecs OS, surfacing market triggers a private-market ` +
        `operator should act on. For the given entity, propose the kinds of signals a sharp analyst ` +
        `would watch for — funding rounds, hiring surges, ownership changes, news, growth, and raise/` +
        `sale intent. These are AI suggestions the operator verifies, so be concrete but never ` +
        `fabricate confidential facts; describe the signal type and what to look for.`,
      output_config: { effort: "low", format: { type: "json_schema", schema: SIGNALS_SCHEMA } },
      messages: [
        {
          role: "user",
          content:
            `Entity: ${name}` +
            (entity.kind ? ` (${entity.kind})` : "") +
            (entity.description ? `\nContext: ${entity.description}` : "") +
            `\n\nReturn 2–4 plausible signals.`,
        },
      ],
    });
    const json = textOf(message);
    const raw = json ? (JSON.parse(json) as { signals?: unknown[] }) : null;
    const out = normalizeGenerated(raw?.signals ?? [], entity);
    return out.length ? out : fallbackSignals(entity);
  } catch {
    return fallbackSignals(entity);
  }
}

// ===========================================================================
// DB — record + list (best-effort, org-scoped via RLS)
// ===========================================================================
function toRecord(row: {
  id: string;
  entity_id: string | null;
  subject_name: string;
  kind: string | null;
  signal_type: string;
  strength: number;
  summary: string | null;
  source_url: string | null;
  occurred_at: string | null;
  created_at: string;
}): SignalRecord {
  return {
    id: row.id,
    entityId: row.entity_id,
    subjectName: row.subject_name,
    kind: row.kind,
    signalType: (coerceSignalType(row.signal_type) ?? "news") as SignalType,
    strength: clampPct(row.strength),
    summary: row.summary,
    sourceUrl: row.source_url,
    occurredAt: row.occurred_at,
    createdAt: row.created_at,
  };
}

/**
 * Best-effort insert of signals into the org's catalog. Returns the count
 * inserted; any failure returns 0 so recording never breaks the scan that
 * produced it.
 */
export async function recordSignals(
  supabase: Client,
  orgId: string,
  userId: string | null,
  signals: EntitySignalInput[],
): Promise<number> {
  const rows = signals
    .filter((s) => s.subjectName?.trim() && coerceSignalType(s.signalType))
    .map((s) => ({
      organization_id: orgId,
      entity_id: s.entityId ?? null,
      subject_name: s.subjectName.trim().slice(0, 200),
      kind: s.kind ?? null,
      signal_type: s.signalType,
      strength: clampPct(s.strength),
      summary: s.summary?.slice(0, 600) ?? null,
      source_url: s.sourceUrl ?? null,
      occurred_at: s.occurredAt ?? null,
      metadata: (s.metadata ?? {}) as Database["public"]["Tables"]["entity_signals"]["Insert"]["metadata"],
      created_by: userId,
    }));
  if (rows.length === 0) return 0;
  try {
    const { error } = await supabase.from("entity_signals").insert(rows);
    return error ? 0 : rows.length;
  } catch {
    return 0;
  }
}

/**
 * List signals for the org, newest first, optionally filtered by entity or
 * signal type. Best-effort: returns [] on any failure.
 */
export async function listSignals(
  supabase: Client,
  orgId: string,
  opts: { entityId?: string | null; signalType?: SignalType | null; limit?: number } = {},
): Promise<SignalRecord[]> {
  try {
    let q = supabase
      .from("entity_signals")
      .select("id, entity_id, subject_name, kind, signal_type, strength, summary, source_url, occurred_at, created_at")
      .eq("organization_id", orgId)
      .order("created_at", { ascending: false })
      .limit(opts.limit ?? 60);
    if (opts.entityId) q = q.eq("entity_id", opts.entityId);
    if (opts.signalType) q = q.eq("signal_type", opts.signalType);
    const { data } = await q;
    return ((data ?? []) as Parameters<typeof toRecord>[0][]).map(toRecord);
  } catch {
    return [];
  }
}

export const __test = {
  propensityScore,
  summarizeSignals,
  signalTone,
  fallbackSignals,
  normalizeGenerated,
  compound,
  hashString,
  SIGNAL_LABELS,
  SIGNAL_TYPES,
};
