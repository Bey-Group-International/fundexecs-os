import 'server-only';

/**
 * AI model tiering — the single source of truth for which Claude model backs
 * each kind of work across FundExecs OS. Centralising this keeps the rest of
 * the codebase from scattering raw model-id strings, and lets the whole desk
 * be re-tiered from one place (or via env) without hunting through call sites.
 *
 * Three tiers, each env-overridable:
 *   - `chat`      Interactive, operator-facing turns (Earn dock, beta ask,
 *                 inline suggestions). Optimised for fast first-token and a
 *                 natural conversational cadence. Sonnet by default.
 *   - `reasoning` Heavy, non-interactive judgment where depth beats latency
 *                 (diligence synthesis, deep analysis). Opus by default.
 *   - `fast`      High-volume, parallel, cheap work where throughput beats
 *                 nuance (the diligence analyst lanes). Haiku by default.
 *
 * Model IDs are the latest as of the Claude API skill: Opus 4.8, Sonnet 4.6,
 * Haiku 4.5. `EARN_MODEL` is honoured for back-compat as the chat default.
 */
export const AI_MODELS = {
  chat: process.env.EARN_MODEL || 'claude-sonnet-4-6',
  reasoning: process.env.EARN_REASONING_MODEL || 'claude-opus-4-8',
  fast: process.env.EARN_FAST_MODEL || 'claude-haiku-4-5-20251001'
} as const;

export type AiTier = keyof typeof AI_MODELS;

/** Resolve a tier to its model id. */
export function modelFor(tier: AiTier): string {
  return AI_MODELS[tier];
}
