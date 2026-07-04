// lib/anthropic-client.ts
// The one place Anthropic clients are constructed. The SDK's default request
// timeout (~10 minutes) exceeds the 60–300s serverless function envelope, so
// a hung upstream call used to surface as an opaque platform 504 instead of a
// catchable SDK error — skipping the deterministic fallbacks every caller
// already has. Explicit timeouts make the failure the application's to handle.
import Anthropic from "@anthropic-ai/sdk";

// Interactive paths (chat, triage, drafting, search): fail fast enough that
// the caller's fallback renders well inside the function envelope.
export const INTERACTIVE_TIMEOUT_MS = 45_000;

// Long-run paths (meeting-transcript analysis, cron sweeps): more headroom,
// still bounded. Retry budget: maxRetries:1 → worst case 240s of Anthropic
// time PER CALL, so a long-run code path must not make more than one
// sequential long-run call or its total wall time approaches the 300s
// envelope.
export const LONG_RUN_TIMEOUT_MS = 120_000;

/**
 * Construct an Anthropic client with an explicit timeout. One retry (not the
 * SDK's default two) keeps worst-case latency at 2× the timeout. `apiKey` may
 * be undefined for call sites that let the SDK resolve ANTHROPIC_API_KEY
 * itself — presence checks stay the caller's job, as before.
 */
export function anthropicClient(
  apiKey: string | undefined,
  timeout: number = INTERACTIVE_TIMEOUT_MS,
): Anthropic {
  return new Anthropic({ apiKey, timeout, maxRetries: 1 });
}

/**
 * True when an error is the SDK's request-timeout error — the typed check
 * call sites use inside their catch-all fallbacks to tell "model was slow"
 * apart from "bad key / upstream 500" for logging and metrics, without
 * changing the fallback behavior itself.
 */
export function isAnthropicTimeout(err: unknown): boolean {
  return err instanceof Anthropic.APIConnectionTimeoutError;
}
