/**
 * FundExecs OS — multi-model agent router.
 *
 * Ported in spirit from `bagidea-office` (MIT), whose office agents can each run
 * on a different provider (Claude, GLM, DeepSeek, OpenAI, Gemini, Groq, Qwen,
 * local Ollama, …). This is the native routing/config layer for that: it maps
 * an office agent to a concrete `{ provider, model, baseUrl, apiKeyEnv }` spec,
 * driven entirely by environment variables, and reports which providers are
 * actually configured.
 *
 * It is deliberately a *routing* layer only — it does not construct SDK clients
 * or make requests. Callers (e.g. lib/claude.ts) keep owning the API call; this
 * just answers "which model should this agent use, and is it configured?". The
 * default is today's behavior exactly — Anthropic with `CLAUDE_MODEL` (falling
 * back to `claude-sonnet-4-6`) — so wiring it in changes nothing until an
 * operator sets the new env vars.
 *
 * Env precedence for an agent, highest first:
 *   1. `OFFICE_MODEL_<AGENT>`   — per-agent override (e.g. OFFICE_MODEL_AGENT_EARN)
 *   2. `OFFICE_MODEL_DEFAULT`   — floor-wide default
 *   3. `CLAUDE_MODEL`           — the existing Anthropic model var
 *   4. Anthropic `claude-sonnet-4-6`
 * Each value is a `provider:model` ref, or a bare model (assumed Anthropic).
 *
 * Attribution: concept from https://github.com/bagidea/bagidea-office (MIT).
 */

export type ModelProvider =
  | "anthropic"
  | "openai"
  | "google"
  | "deepseek"
  | "groq"
  | "qwen"
  | "glm"
  | "ollama";

export type ModelSpec = {
  provider: ModelProvider;
  model: string;
  /** OpenAI-compatible base URL for non-Anthropic providers. */
  baseUrl?: string;
  /** Env var expected to hold the API key; undefined for keyless (Ollama). */
  apiKeyEnv?: string;
};

/** An environment bag; defaults to `process.env` but injectable for tests. */
export type Env = Record<string, string | undefined>;

/**
 * Per-provider defaults: key env, OpenAI-compatible base URL, default model.
 * `enableEnv` gates a keyless provider (Ollama) so it counts as configured only
 * when the operator explicitly opts in — otherwise nothing would ever route to
 * a local `localhost` server by surprise.
 */
const PROVIDER_META: Record<
  ModelProvider,
  { apiKeyEnv?: string; enableEnv?: string; baseUrl?: string; defaultModel: string }
> = {
  anthropic: { apiKeyEnv: "ANTHROPIC_API_KEY", defaultModel: "claude-sonnet-4-6" },
  openai: {
    apiKeyEnv: "OPENAI_API_KEY",
    baseUrl: "https://api.openai.com/v1",
    defaultModel: "gpt-4o",
  },
  google: {
    apiKeyEnv: "GEMINI_API_KEY",
    baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
    defaultModel: "gemini-2.0-flash",
  },
  deepseek: {
    apiKeyEnv: "DEEPSEEK_API_KEY",
    baseUrl: "https://api.deepseek.com",
    defaultModel: "deepseek-chat",
  },
  groq: {
    apiKeyEnv: "GROQ_API_KEY",
    baseUrl: "https://api.groq.com/openai/v1",
    defaultModel: "llama-3.3-70b-versatile",
  },
  qwen: {
    apiKeyEnv: "DASHSCOPE_API_KEY",
    baseUrl: "https://dashscope-intl.aliyuncs.com/compatible-mode/v1",
    defaultModel: "qwen-plus",
  },
  glm: {
    apiKeyEnv: "ZHIPU_API_KEY",
    baseUrl: "https://open.bigmodel.cn/api/paas/v4",
    defaultModel: "glm-4-plus",
  },
  ollama: {
    enableEnv: "OLLAMA_BASE_URL",
    baseUrl: "http://localhost:11434/v1",
    defaultModel: "llama3.1",
  },
};

export const MODEL_PROVIDERS = Object.keys(PROVIDER_META) as ModelProvider[];

function isProvider(value: string): value is ModelProvider {
  return value in PROVIDER_META;
}

/** Build a full spec for a provider + model, filling in base URL / key env. */
function specFor(provider: ModelProvider, model?: string): ModelSpec {
  const meta = PROVIDER_META[provider];
  return {
    provider,
    model: model || meta.defaultModel,
    baseUrl: meta.baseUrl,
    apiKeyEnv: meta.apiKeyEnv,
  };
}

/**
 * Parse a `provider:model` ref (e.g. `openai:gpt-4o`, `ollama:llama3.1`) or a
 * bare model string (assumed Anthropic, matching the legacy `CLAUDE_MODEL`).
 * An unknown provider prefix is treated as part of an Anthropic model name
 * rather than throwing, so a stray value never breaks resolution.
 */
export function parseModelRef(ref: string): ModelSpec {
  const trimmed = ref.trim();
  const sep = trimmed.indexOf(":");
  if (sep > 0) {
    const maybeProvider = trimmed.slice(0, sep).toLowerCase();
    if (isProvider(maybeProvider)) {
      return specFor(maybeProvider, trimmed.slice(sep + 1).trim() || undefined);
    }
  }
  // Bare model → Anthropic (backward compatible with CLAUDE_MODEL).
  return specFor("anthropic", trimmed);
}

/** The env var name that overrides a specific agent's model. */
export function envKeyForAgent(agentId: string): string {
  return "OFFICE_MODEL_" + agentId.toUpperCase().replace(/[^A-Z0-9]+/g, "_");
}

/**
 * Resolve which model an agent should use, by the env precedence documented
 * above. Never throws; always returns a usable spec (Anthropic default in the
 * worst case). Pass `agentId` to honor per-agent overrides.
 */
export function resolveModel(opts: { agentId?: string; env?: Env } = {}): ModelSpec {
  const env = opts.env ?? process.env;
  const perAgent = opts.agentId ? env[envKeyForAgent(opts.agentId)] : undefined;
  const ref = perAgent || env.OFFICE_MODEL_DEFAULT || env.CLAUDE_MODEL;
  return ref ? parseModelRef(ref) : specFor("anthropic");
}

/**
 * Whether a provider is usable: its API key is present, or (for a keyless
 * provider) its `enableEnv` opt-in is set. A provider with neither gate is
 * always on, but every provider here has one.
 */
export function isProviderConfigured(provider: ModelProvider, env: Env = process.env): boolean {
  const meta = PROVIDER_META[provider];
  if (meta.apiKeyEnv) return Boolean(env[meta.apiKeyEnv]);
  if (meta.enableEnv) return Boolean(env[meta.enableEnv]);
  return true;
}

/** Whether a resolved spec is usable (its provider's key is present). */
export function isModelConfigured(spec: ModelSpec, env: Env = process.env): boolean {
  return isProviderConfigured(spec.provider, env);
}

/** Every provider that is currently configured, in canonical order. */
export function listConfiguredProviders(env: Env = process.env): ModelProvider[] {
  return MODEL_PROVIDERS.filter((p) => isProviderConfigured(p, env));
}

// Fallback preference when an agent's requested provider isn't configured:
// keep the institution on a frontier model first, then strong OSS-compatible
// providers, then local.
const FALLBACK_ORDER: ModelProvider[] = [
  "anthropic",
  "openai",
  "google",
  "deepseek",
  "glm",
  "qwen",
  "groq",
  "ollama",
];

/**
 * Resolve an agent's model, but if that provider isn't configured, fall back to
 * the first configured provider in preference order (its default model). If
 * nothing is configured, returns the originally requested spec unchanged — the
 * caller's existing missing-key fallback (as in lib/claude.ts today) then
 * applies, so behavior degrades exactly as it does now.
 */
export function resolveConfiguredModel(opts: { agentId?: string; env?: Env } = {}): ModelSpec {
  const env = opts.env ?? process.env;
  const requested = resolveModel({ ...opts, env });
  if (isModelConfigured(requested, env)) return requested;
  for (const provider of FALLBACK_ORDER) {
    if (isProviderConfigured(provider, env)) return specFor(provider);
  }
  return requested;
}
