import { resolveImageGenerator, imageGenerationConfigured } from "@/lib/office/imagegen";

// Snapshot + restore the env vars this module reads, so tests don't leak into
// each other or the rest of the suite.
const KEYS = ["OPENAI_API_KEY", "OFFICE_PORTRAIT_MODEL"] as const;
const saved: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const k of KEYS) saved[k] = process.env[k];
  for (const k of KEYS) delete process.env[k];
});
afterEach(() => {
  for (const k of KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

describe("resolveImageGenerator", () => {
  it("returns null when no key is configured", () => {
    expect(resolveImageGenerator()).toBeNull();
    expect(imageGenerationConfigured()).toBe(false);
  });

  it("treats a blank/whitespace key as unconfigured", () => {
    process.env.OPENAI_API_KEY = "   ";
    expect(resolveImageGenerator()).toBeNull();
  });

  it("resolves the OpenAI generator with gpt-image-1 by default", () => {
    process.env.OPENAI_API_KEY = "sk-test";
    const gen = resolveImageGenerator();
    expect(gen).not.toBeNull();
    expect(gen?.id).toBe("openai");
    expect(gen?.model).toBe("gpt-image-1");
    expect(imageGenerationConfigured()).toBe(true);
  });

  it("honors an explicit model override", () => {
    process.env.OPENAI_API_KEY = "sk-test";
    process.env.OFFICE_PORTRAIT_MODEL = "dall-e-3";
    expect(resolveImageGenerator()?.model).toBe("dall-e-3");
  });
});
