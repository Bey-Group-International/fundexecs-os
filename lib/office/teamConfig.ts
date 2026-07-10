/**
 * FundExecs OS — team configuration (the Delegation Designer's saved state).
 *
 * The Delegation Designer is a no-code editor for the AI executive team: which
 * executives Earn may delegate to, which model provider each prefers, and
 * whether their outputs pass through a human-in-the-loop approval gate (and at
 * which risk tier). This module owns the pure, framework-free state — a
 * per-executive override map persisted to localStorage — so the editor can work
 * in a sandbox and "Apply" commits the draft here.
 *
 * Mirrors the other client-native floor stores (deskClaim / roomPrivacy /
 * presenceStatus): dependency-light so it unit-tests in Node, load/save take an
 * injectable `Storage`, and a save emits a window event the floor reacts to.
 *
 * It captures the operator's intended team design and surfaces it on the floor
 * (roster + inspector). Deep model routing stays env-driven server-side
 * (lib/office/agentModelRouter.ts) — this is the design/preference layer over it.
 */
import type { AgentId, RiskTier } from "@/components/virtual-office/program/officeProgram";

/** localStorage key the team config is persisted under. */
export const TEAM_CONFIG_KEY = "office:team-config";

/** Window event emitted after Apply, so the floor updates live. */
export const TEAM_CONFIG_EVENT = "office:team-config-changed";

/** Minimal storage surface — `window.localStorage` satisfies it, as does a stub. */
export type TeamConfigStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

/** Model providers an executive can be assigned (mirrors agentModelRouter). */
export const TEAM_PROVIDERS = [
  "anthropic",
  "openai",
  "google",
  "deepseek",
  "groq",
  "qwen",
  "glm",
  "ollama",
] as const;
export type TeamProvider = (typeof TEAM_PROVIDERS)[number];

export const PROVIDER_LABELS: Record<TeamProvider, string> = {
  anthropic: "Claude",
  openai: "OpenAI",
  google: "Gemini",
  deepseek: "DeepSeek",
  groq: "Groq",
  qwen: "Qwen",
  glm: "GLM",
  ollama: "Ollama",
};

const RISK_TIERS_SET: ReadonlySet<string> = new Set(["internal", "external_facing", "capital_binding"]);

/** Per-executive configuration. */
export type ExecConfig = {
  /** On the delegable team — when false, Earn won't route work here. */
  enabled: boolean;
  /** Preferred model provider. */
  provider: TeamProvider;
  /** Route this executive's outputs through a human-in-the-loop approval gate. */
  humanInLoop: boolean;
  /** Minimum risk tier that triggers the gate. */
  gateTier: RiskTier;
};

/** Overrides only — anything absent resolves to DEFAULT_EXEC_CONFIG. */
export type TeamConfig = Partial<Record<AgentId, ExecConfig>>;

/** The out-of-the-box config for every executive (today's behavior). */
export const DEFAULT_EXEC_CONFIG: ExecConfig = {
  enabled: true,
  provider: "anthropic",
  humanInLoop: false,
  gateTier: "external_facing",
};

/** Resolve an executive's effective config: defaults merged with any override. */
export function resolveExecConfig(agentId: AgentId, config: TeamConfig): ExecConfig {
  return { ...DEFAULT_EXEC_CONFIG, ...config[agentId] };
}

function resolveStorage(explicit?: TeamConfigStorage): TeamConfigStorage | null {
  if (explicit) return explicit;
  if (typeof window !== "undefined" && window.localStorage) return window.localStorage;
  return null;
}

/** Coerce an unknown parsed value into a valid ExecConfig, or null if unusable. */
function sanitizeExec(raw: unknown): ExecConfig | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const provider = TEAM_PROVIDERS.includes(r.provider as TeamProvider)
    ? (r.provider as TeamProvider)
    : DEFAULT_EXEC_CONFIG.provider;
  const gateTier = RISK_TIERS_SET.has(r.gateTier as string)
    ? (r.gateTier as RiskTier)
    : DEFAULT_EXEC_CONFIG.gateTier;
  return {
    enabled: typeof r.enabled === "boolean" ? r.enabled : DEFAULT_EXEC_CONFIG.enabled,
    provider,
    humanInLoop: typeof r.humanInLoop === "boolean" ? r.humanInLoop : DEFAULT_EXEC_CONFIG.humanInLoop,
    gateTier,
  };
}

/** The saved team config (overrides only). Empty object when unset/malformed. */
export function loadTeamConfig(storage?: TeamConfigStorage): TeamConfig {
  const store = resolveStorage(storage);
  if (!store) return {};
  const raw = store.getItem(TEAM_CONFIG_KEY);
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (!parsed || typeof parsed !== "object") return {};
    const out: TeamConfig = {};
    for (const [id, val] of Object.entries(parsed)) {
      const exec = sanitizeExec(val);
      if (exec) out[id as AgentId] = exec;
    }
    return out;
  } catch {
    return {};
  }
}

/** Persist the team config and notify the floor. */
export function saveTeamConfig(config: TeamConfig, storage?: TeamConfigStorage): void {
  const store = resolveStorage(storage);
  if (store) store.setItem(TEAM_CONFIG_KEY, JSON.stringify(config));
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent(TEAM_CONFIG_EVENT, { detail: config }));
  }
}

/** Count how many executives differ from the out-of-the-box defaults. */
export function countCustomized(config: TeamConfig): number {
  return (Object.keys(config) as AgentId[]).filter((id) => {
    const c = config[id];
    if (!c) return false;
    return (
      c.enabled !== DEFAULT_EXEC_CONFIG.enabled ||
      c.provider !== DEFAULT_EXEC_CONFIG.provider ||
      c.humanInLoop !== DEFAULT_EXEC_CONFIG.humanInLoop ||
      c.gateTier !== DEFAULT_EXEC_CONFIG.gateTier
    );
  }).length;
}
