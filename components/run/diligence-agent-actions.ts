"use server";

// Server action for the Due-diligence data-room agent. Mirrors the AI pattern in
// lib/claude.ts: guard on ANTHROPIC_API_KEY, build the Anthropic client via
// anthropicClient(), request structured output with effortConfig(MODEL, "medium",
// DILIGENCE_SCHEMA), parse + validate, and ALWAYS fall back to the deterministic
// keyword scan so CI/preview (no key) and any upstream error still return a memo.
import Anthropic from "@anthropic-ai/sdk";
import { anthropicClient } from "@/lib/anthropic-client";
import { effortConfig } from "@/lib/claude";
import {
  DILIGENCE_SCHEMA,
  fallbackDiligence,
  isValidFinding,
  type Finding,
} from "@/lib/diligence-agent";

const MODEL = process.env.CLAUDE_MODEL || "claude-sonnet-4-6";

const DILIGENCE_SYSTEM =
  "You are a diligence lead running point on a private-markets acquisition. Analyze the provided " +
  "data-room excerpt across five lenses — LEGAL, FINANCIAL, COMMERCIAL, OPERATIONAL, and COMPLIANCE — " +
  "and return a structured risk memo. Cite only what the excerpt actually supports; never fabricate " +
  "facts, figures, entities, or issues that are not present in the text. Assign each finding a " +
  "severity of low, medium, high, or critical calibrated to the deal impact. Prefer a few well-founded " +
  "findings over speculation; if a lens has no supported signal, simply omit it. Every finding must " +
  "include a concrete, actionable diligence recommendation.";

function textOf(message: Anthropic.Message): string {
  return message.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("\n")
    .trim();
}

/**
 * Run the data-room agent. Returns findings plus their provenance:
 *   - No API key, or empty input, or any error → deterministic fallback scan.
 *   - Otherwise → validated AI findings (falling back if none validate).
 */
export async function runDiligenceAnalysis(input: {
  dealName?: string;
  dataRoomText: string;
}): Promise<{ findings: Finding[]; source: "ai" | "fallback" }> {
  const text = (input?.dataRoomText ?? "").trim();
  const apiKey = process.env.ANTHROPIC_API_KEY;

  // Guard empty input and the no-key path — deterministic fallback either way.
  if (!apiKey || text.length === 0) {
    return { findings: fallbackDiligence(text), source: "fallback" };
  }

  try {
    const anthropic = anthropicClient(apiKey);
    const dealLine = input.dealName?.trim() ? `Deal: ${input.dealName.trim()}\n\n` : "";
    const message = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 3000,
      system: [{ type: "text", text: DILIGENCE_SYSTEM, cache_control: { type: "ephemeral" } }],
      ...effortConfig(MODEL, "medium", DILIGENCE_SCHEMA),
      messages: [
        {
          role: "user",
          content:
            `${dealLine}Analyze the following data-room excerpt and return the findings array.\n\n` +
            `--- DATA ROOM EXCERPT ---\n${text.slice(0, 16000)}`,
        },
      ],
    });

    const json = textOf(message);
    if (!json) return { findings: fallbackDiligence(text), source: "fallback" };

    const raw = JSON.parse(json) as { findings?: unknown };
    const findings = Array.isArray(raw.findings)
      ? raw.findings.filter(isValidFinding).map((f) => ({
          lens: f.lens,
          title: f.title.slice(0, 160),
          severity: f.severity,
          detail: f.detail.slice(0, 1000),
          recommendation: f.recommendation.slice(0, 600),
        }))
      : [];

    if (findings.length === 0) return { findings: fallbackDiligence(text), source: "fallback" };
    return { findings, source: "ai" };
  } catch (err) {
    console.error("[runDiligenceAnalysis] Claude API error:", err);
    return { findings: fallbackDiligence(text), source: "fallback" };
  }
}
