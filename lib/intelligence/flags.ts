// lib/intelligence/flags.ts
// Feature flags for the intelligence layer. Mirrors the house pattern
// (lib/proactive/config.ts PROACTIVE_ENABLED): simple env-string switches read
// server-side, defaulting OFF so nothing ships dark. The native CORE gates the
// whole layer; each capability and each provider is independently switchable so
// rollout is staged (see the rollout plan in docs/intelligence).
//
// Pure reads — no I/O — so callers and tests can reason about a flag without a
// process env by passing an explicit env map.

export type IntelligenceFlag =
  | "intelligence_core"
  | "intelligence_watchlists"
  | "intelligence_operating_brief"
  | "intelligence_exposure_mapping"
  | "intelligence_scenarios"
  | "provider_signal_bureau"
  | "provider_signal_bureau_mcp"
  | "provider_signal_bureau_ask"
  | "intelligence_private_desks";

/** Maps each flag to its environment variable. */
const FLAG_ENV: Record<IntelligenceFlag, string> = {
  intelligence_core: "INTELLIGENCE_CORE_ENABLED",
  intelligence_watchlists: "INTELLIGENCE_WATCHLISTS_ENABLED",
  intelligence_operating_brief: "INTELLIGENCE_OPERATING_BRIEF_ENABLED",
  intelligence_exposure_mapping: "INTELLIGENCE_EXPOSURE_MAPPING_ENABLED",
  intelligence_scenarios: "INTELLIGENCE_SCENARIOS_ENABLED",
  provider_signal_bureau: "PROVIDER_SIGNAL_BUREAU_ENABLED",
  provider_signal_bureau_mcp: "PROVIDER_SIGNAL_BUREAU_MCP_ENABLED",
  provider_signal_bureau_ask: "PROVIDER_SIGNAL_BUREAU_ASK_ENABLED",
  intelligence_private_desks: "INTELLIGENCE_PRIVATE_DESKS_ENABLED",
};

/**
 * True when a flag is enabled. Reads process.env by default; accepts an explicit
 * env map for tests. A flag is on only when its var is exactly "true".
 */
export function flagEnabled(
  flag: IntelligenceFlag,
  env: Record<string, string | undefined> = process.env,
): boolean {
  return env[FLAG_ENV[flag]] === "true";
}

/**
 * The core switch. Every downstream capability also requires its own flag AND
 * the core — a capability can never be live while the core is dark.
 */
export function coreEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return flagEnabled("intelligence_core", env);
}

/** A capability flag is effective only when BOTH it and the core are on. */
export function capabilityEnabled(
  flag: IntelligenceFlag,
  env: Record<string, string | undefined> = process.env,
): boolean {
  return coreEnabled(env) && flagEnabled(flag, env);
}
