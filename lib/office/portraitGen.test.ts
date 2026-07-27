import {
  resolvePortraitGenerator,
  portraitGenerationConfigured,
  sanitizeSvg,
} from "@/lib/office/portraitGen";

// Snapshot + restore the env vars this module reads.
const KEYS = ["ANTHROPIC_API_KEY", "OFFICE_PORTRAIT_MODEL"] as const;
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

describe("resolvePortraitGenerator", () => {
  it("returns null when no Anthropic key is configured", () => {
    expect(resolvePortraitGenerator()).toBeNull();
    expect(portraitGenerationConfigured()).toBe(false);
  });

  it("treats a blank/whitespace key as unconfigured", () => {
    process.env.ANTHROPIC_API_KEY = "   ";
    expect(resolvePortraitGenerator()).toBeNull();
  });

  it("resolves the Anthropic generator with a sensible default model", () => {
    process.env.ANTHROPIC_API_KEY = "sk-ant-test";
    const gen = resolvePortraitGenerator();
    expect(gen).not.toBeNull();
    expect(gen?.id).toBe("anthropic");
    expect(gen?.model).toBe("claude-sonnet-4-6");
    expect(portraitGenerationConfigured()).toBe(true);
  });

  it("honors an explicit model override", () => {
    process.env.ANTHROPIC_API_KEY = "sk-ant-test";
    process.env.OFFICE_PORTRAIT_MODEL = "claude-opus-4-8";
    expect(resolvePortraitGenerator()?.model).toBe("claude-opus-4-8");
  });
});

describe("sanitizeSvg", () => {
  it("returns null when there is no svg", () => {
    expect(sanitizeSvg("sorry, here is a description")).toBeNull();
    expect(sanitizeSvg("")).toBeNull();
  });

  it("extracts a clean svg from surrounding prose and code fences", () => {
    const raw = "Here you go:\n```svg\n<svg viewBox=\"0 0 512 512\"><rect/></svg>\n```\nEnjoy!";
    const out = sanitizeSvg(raw);
    expect(out).not.toBeNull();
    expect(out!.startsWith("<svg")).toBe(true);
    expect(out!.endsWith("</svg>")).toBe(true);
    expect(out).not.toMatch(/```/);
    expect(out).not.toMatch(/Enjoy/);
  });

  // Reject-on-match: any dangerous construct fails the whole SVG (returns null)
  // rather than being partially cleaned.
  it.each([
    ["a script element", '<svg><script>alert(1)</script></svg>'],
    ["a script end tag with odd whitespace", '<svg></script\t\n bar></svg>'],
    ["an inline event handler", '<svg onload="steal()"><rect/></svg>'],
    ["a handler on a child", '<svg><circle onclick="x()" r="5"/></svg>'],
    ["an <image> element", '<svg><image href="https://evil.example/x.png"/></svg>'],
    ["a <foreignObject>", '<svg><foreignObject><body/></foreignObject></svg>'],
    ["a <use> external ref", '<svg><use href="#g"/></svg>'],
    ["an <a> hyperlink", '<svg><a href="https://x"><rect/></a></svg>'],
    ["a javascript: url", '<svg><rect fill="url(javascript:alert(1))"/></svg>'],
    ["a vbscript: url", '<svg><rect fill="vbscript:msgbox(1)"/></svg>'],
    ["a nested data: uri", '<svg><rect fill="data:text/html,x"/></svg>'],
    ["any href attribute", '<svg><rect href="#g"/></svg>'],
  ])("rejects %s", (_label, raw) => {
    expect(sanitizeSvg(raw)).toBeNull();
  });

  it("accepts a clean gradient-referencing svg and adds a missing xmlns", () => {
    const raw =
      '<svg viewBox="0 0 512 512"><defs><linearGradient id="g"/></defs>' +
      '<rect fill="url(#g)"/><circle r="5"/></svg>';
    const out = sanitizeSvg(raw)!;
    expect(out).not.toBeNull();
    expect(out).toMatch(/xmlns="http:\/\/www\.w3\.org\/2000\/svg"/);
    expect(out).toMatch(/url\(#g\)/);
  });

  it("preserves an existing xmlns without duplicating it", () => {
    const raw = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><rect/></svg>';
    const out = sanitizeSvg(raw)!;
    expect(out.match(/xmlns=/g)?.length).toBe(1);
  });
});
