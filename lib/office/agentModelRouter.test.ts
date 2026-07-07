import {
  MODEL_PROVIDERS,
  envKeyForAgent,
  isModelConfigured,
  isProviderConfigured,
  listConfiguredProviders,
  parseModelRef,
  resolveConfiguredModel,
  resolveModel,
  type Env,
} from "./agentModelRouter";

describe("parseModelRef", () => {
  it("parses a provider:model ref", () => {
    expect(parseModelRef("openai:gpt-4o")).toMatchObject({
      provider: "openai",
      model: "gpt-4o",
      baseUrl: "https://api.openai.com/v1",
      apiKeyEnv: "OPENAI_API_KEY",
    });
  });

  it("treats a bare model as Anthropic (CLAUDE_MODEL compatible)", () => {
    expect(parseModelRef("claude-opus-4-8")).toMatchObject({
      provider: "anthropic",
      model: "claude-opus-4-8",
      apiKeyEnv: "ANTHROPIC_API_KEY",
    });
  });

  it("fills the provider default model when only a provider is given", () => {
    expect(parseModelRef("deepseek:")).toMatchObject({ provider: "deepseek", model: "deepseek-chat" });
  });

  it("does not mistake an unknown prefix for a provider", () => {
    // A colon in an Anthropic-style name stays Anthropic, not a bad provider.
    expect(parseModelRef("some-model:v2").provider).toBe("anthropic");
  });

  it("keeps Ollama keyless", () => {
    expect(parseModelRef("ollama:llama3.1").apiKeyEnv).toBeUndefined();
  });
});

describe("envKeyForAgent", () => {
  it("builds a sanitized per-agent env key", () => {
    expect(envKeyForAgent("agent:earn")).toBe("OFFICE_MODEL_AGENT_EARN");
    expect(envKeyForAgent("build")).toBe("OFFICE_MODEL_BUILD");
  });
});

describe("resolveModel precedence", () => {
  it("defaults to Anthropic claude-sonnet-4-6 with no env", () => {
    expect(resolveModel({ env: {} })).toMatchObject({ provider: "anthropic", model: "claude-sonnet-4-6" });
  });

  it("honors the legacy CLAUDE_MODEL var", () => {
    const env: Env = { CLAUDE_MODEL: "claude-opus-4-8" };
    expect(resolveModel({ env }).model).toBe("claude-opus-4-8");
  });

  it("prefers OFFICE_MODEL_DEFAULT over CLAUDE_MODEL", () => {
    const env: Env = { CLAUDE_MODEL: "claude-opus-4-8", OFFICE_MODEL_DEFAULT: "openai:gpt-4o" };
    expect(resolveModel({ env })).toMatchObject({ provider: "openai", model: "gpt-4o" });
  });

  it("prefers a per-agent override over the default", () => {
    const env: Env = {
      OFFICE_MODEL_DEFAULT: "openai:gpt-4o",
      OFFICE_MODEL_AGENT_EARN: "google:gemini-2.0-flash",
    };
    expect(resolveModel({ agentId: "agent:earn", env })).toMatchObject({
      provider: "google",
      model: "gemini-2.0-flash",
    });
  });
});

describe("configuration checks", () => {
  it("reports keyless Ollama as configured only when opted in via OLLAMA_BASE_URL", () => {
    expect(isProviderConfigured("ollama", {})).toBe(false);
    expect(isProviderConfigured("ollama", { OLLAMA_BASE_URL: "http://localhost:11434/v1" })).toBe(true);
  });

  it("reports key-gated providers by env presence", () => {
    expect(isProviderConfigured("anthropic", {})).toBe(false);
    expect(isProviderConfigured("anthropic", { ANTHROPIC_API_KEY: "sk-x" })).toBe(true);
  });

  it("lists configured providers, including Ollama only when opted in", () => {
    const env: Env = { OPENAI_API_KEY: "sk-o", OLLAMA_BASE_URL: "http://localhost:11434/v1" };
    const list = listConfiguredProviders(env);
    expect(list).toContain("openai");
    expect(list).toContain("ollama");
    expect(list).not.toContain("anthropic");
    expect(list.every((p) => MODEL_PROVIDERS.includes(p))).toBe(true);
    // Without the opt-in, Ollama drops out.
    expect(listConfiguredProviders({ OPENAI_API_KEY: "sk-o" })).not.toContain("ollama");
  });
});

describe("resolveConfiguredModel fallback", () => {
  it("returns the requested model when its provider is configured", () => {
    const env: Env = { OFFICE_MODEL_DEFAULT: "openai:gpt-4o", OPENAI_API_KEY: "sk-o" };
    expect(resolveConfiguredModel({ env })).toMatchObject({ provider: "openai" });
  });

  it("falls back to the first configured provider when the requested one is not", () => {
    // Requested OpenAI, but only Anthropic is configured.
    const env: Env = { OFFICE_MODEL_DEFAULT: "openai:gpt-4o", ANTHROPIC_API_KEY: "sk-a" };
    expect(resolveConfiguredModel({ env })).toMatchObject({ provider: "anthropic", model: "claude-sonnet-4-6" });
  });

  it("returns the requested spec unchanged when nothing is configured", () => {
    const env: Env = { OFFICE_MODEL_DEFAULT: "openai:gpt-4o" };
    expect(isModelConfigured(resolveConfiguredModel({ env }), env)).toBe(false);
    expect(resolveConfiguredModel({ env }).provider).toBe("openai");
  });
});
