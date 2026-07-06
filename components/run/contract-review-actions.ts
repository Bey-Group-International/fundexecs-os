"use server";

// Server action for the Run › Contract Review module. Runs a CUAD-style clause
// & risk extraction over a contract's text. Mirrors the AI pattern in
// lib/claude.ts EXACTLY: it guards on ANTHROPIC_API_KEY, builds the client via
// anthropicClient, gates output_config with effortConfig, parses the JSON text
// out, validates it against the CLAUSE_TYPES taxonomy, and ALWAYS falls back to
// the deterministic `fallbackReview` when there is no key or the call fails —
// so CI/preview (which have no key) still return a full result.
import Anthropic from "@anthropic-ai/sdk";
import { anthropicClient } from "@/lib/anthropic-client";
import { effortConfig } from "@/lib/claude";
import {
  fallbackReview,
  CONTRACT_REVIEW_SCHEMA,
  CLAUSE_KEYS,
  type Finding,
  type RiskLevel,
} from "@/lib/contract-review";

const MODEL = process.env.CLAUDE_MODEL || "claude-sonnet-4-6";

const REVIEW_SYSTEM =
  "You are an experienced M&A counsel reviewing a contract for a private-market acquirer. " +
  "For each clause type in the schema, determine its presence, quote a short verbatim excerpt " +
  "(<= 240 chars) when present, rate the risk it (or its absence) poses to the acquirer, and " +
  "propose a concise redline. Never invent text that is not present in the contract — if a clause " +
  "is absent, set present=false and excerpt=null. Return every clause type exactly once.";

const RISK_VALUES: RiskLevel[] = ["none", "low", "medium", "high"];

function textOf(message: Anthropic.Message): string {
  return message.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("\n")
    .trim();
}

// Coerce one raw AI finding into a valid Finding, or null if it can't be
// mapped onto a known clause type. Validation guards against the model drifting
// outside the CLAUSE_TYPES taxonomy / risk enum.
function normalizeFinding(raw: unknown): Finding | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const clause_type = typeof r.clause_type === "string" ? r.clause_type : "";
  if (!CLAUSE_KEYS.includes(clause_type)) return null;
  const risk = RISK_VALUES.includes(r.risk as RiskLevel) ? (r.risk as RiskLevel) : "none";
  const excerpt = typeof r.excerpt === "string" && r.excerpt.trim() ? r.excerpt.trim().slice(0, 240) : null;
  const redline = typeof r.redline === "string" && r.redline.trim() ? r.redline.trim().slice(0, 400) : null;
  return {
    clause_type,
    present: Boolean(r.present),
    risk,
    excerpt,
    redline,
  };
}

// Merge AI findings onto the full clause taxonomy: the deterministic review is
// the base (guarantees one finding per clause type), and any valid AI finding
// overrides its clause. This keeps the result complete even if the model omits
// a clause.
function mergeOntoFallback(text: string, aiFindings: Finding[]): Finding[] {
  const base = fallbackReview(text);
  const byKey = new Map(base.map((f) => [f.clause_type, f]));
  for (const f of aiFindings) byKey.set(f.clause_type, f);
  // Preserve canonical clause order.
  return base.map((f) => byKey.get(f.clause_type) ?? f);
}

export async function reviewContract(input: {
  title?: string;
  text: string;
}): Promise<{ findings: Finding[]; source: "ai" | "fallback" }> {
  const text = typeof input?.text === "string" ? input.text : "";
  // Guard empty text: nothing to review — return the deterministic all-missing set.
  if (text.trim().length === 0) {
    return { findings: fallbackReview(""), source: "fallback" };
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return { findings: fallbackReview(text), source: "fallback" };
  }

  try {
    const anthropic = anthropicClient(apiKey);
    const message = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 3000,
      system: [{ type: "text", text: REVIEW_SYSTEM, cache_control: { type: "ephemeral" } }],
      ...effortConfig(MODEL, "medium", CONTRACT_REVIEW_SCHEMA),
      messages: [
        {
          role: "user",
          content:
            (input.title ? `Contract: ${input.title}\n\n` : "") +
            `Review the following contract text:\n\n${text.slice(0, 24000)}`,
        },
      ],
    });
    const json = textOf(message);
    if (!json) return { findings: fallbackReview(text), source: "fallback" };
    const parsed = JSON.parse(json) as { findings?: unknown };
    const rawList = Array.isArray(parsed.findings) ? parsed.findings : [];
    const aiFindings = rawList
      .map(normalizeFinding)
      .filter((f): f is Finding => f !== null);
    if (aiFindings.length === 0) return { findings: fallbackReview(text), source: "fallback" };
    return { findings: mergeOntoFallback(text, aiFindings), source: "ai" };
  } catch (err) {
    console.error("[reviewContract] Claude API error:", err);
    return { findings: fallbackReview(text), source: "fallback" };
  }
}
