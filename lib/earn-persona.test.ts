import {
  earnWebSearchEnabled,
  extractWebSources,
  formatSourcesBlock,
  parseEarnPersona,
  spicyPersonaBlock,
  webSearchCount,
  webSearchTool,
  WEB_SEARCH_MAX_USES,
} from "@/lib/earn-persona";

describe("parseEarnPersona", () => {
  it("accepts only 'spicy'; everything else is standard", () => {
    expect(parseEarnPersona("spicy")).toBe("spicy");
    expect(parseEarnPersona("standard")).toBe("standard");
    expect(parseEarnPersona("unhinged")).toBe("standard");
    expect(parseEarnPersona(null)).toBe("standard");
    expect(parseEarnPersona(undefined)).toBe("standard");
  });
});

describe("spicyPersonaBlock", () => {
  it("keeps the voice clean and grounded", () => {
    const block = spicyPersonaBlock({ webSearch: false });
    expect(block).toMatch(/no profanity/i);
    expect(block).toMatch(/never at people/i);
    expect(block).toMatch(/no invented figures/i);
  });

  it("mentions the web_search tool only when search is on", () => {
    expect(spicyPersonaBlock({ webSearch: true })).toMatch(/web_search tool/);
    const off = spicyPersonaBlock({ webSearch: false });
    expect(off).not.toMatch(/web_search tool/);
    expect(off).toMatch(/live search is off/);
  });
});

describe("earnWebSearchEnabled", () => {
  const env = process.env;
  afterEach(() => {
    process.env = env;
  });

  it("needs both an API key and the explicit flag", () => {
    process.env = { ...env, ANTHROPIC_API_KEY: "k", EARN_WEB_SEARCH: "1" };
    expect(earnWebSearchEnabled()).toBe(true);
    process.env = { ...env, ANTHROPIC_API_KEY: "k", EARN_WEB_SEARCH: "" };
    expect(earnWebSearchEnabled()).toBe(false);
    process.env = { ...env, ANTHROPIC_API_KEY: "", EARN_WEB_SEARCH: "true" };
    expect(earnWebSearchEnabled()).toBe(false);
  });
});

describe("webSearchTool", () => {
  it("uses the original tool version on Haiku 4.5 and the current one elsewhere", () => {
    expect(webSearchTool("claude-haiku-4-5-20251001")).toEqual({
      type: "web_search_20250305",
      name: "web_search",
      max_uses: WEB_SEARCH_MAX_USES,
    });
    expect(webSearchTool("claude-sonnet-4-6")).toMatchObject({ type: "web_search_20260209" });
  });
});

describe("extractWebSources", () => {
  it("collects distinct web citations in order and skips LinkedIn and non-http URLs", () => {
    const message = {
      content: [
        { type: "server_tool_use", id: "x", name: "web_search", input: {} },
        {
          type: "text",
          text: "Rates rose.",
          citations: [
            { type: "web_search_result_location", url: "https://www.fed.gov/h15", title: "H.15 Rates" },
            { type: "web_search_result_location", url: "https://www.fed.gov/h15", title: "dupe" },
            { type: "web_search_result_location", url: "https://www.linkedin.com/in/someone", title: "Profile" },
          ],
        },
        {
          type: "text",
          text: "Deal closed.",
          citations: [
            { type: "web_search_result_location", url: "https://news.example.com/a", title: "" },
            { type: "web_search_result_location", url: "javascript:alert(1)", title: "bad" },
            { type: "char_location", url: "https://ignored.example.com", title: "doc" },
          ],
        },
        { type: "text", text: "No citations", citations: null },
      ],
    };
    expect(extractWebSources(message)).toEqual([
      { url: "https://www.fed.gov/h15", title: "H.15 Rates" },
      { url: "https://news.example.com/a", title: "news.example.com" },
    ]);
  });

  it("is safe on empty or malformed input", () => {
    expect(extractWebSources(null)).toEqual([]);
    expect(extractWebSources({ content: "nope" })).toEqual([]);
  });
});

describe("webSearchCount", () => {
  it("reads server_tool_use.web_search_requests", () => {
    expect(webSearchCount({ usage: { server_tool_use: { web_search_requests: 2 } } })).toBe(2);
    expect(webSearchCount({ usage: {} })).toBe(0);
    expect(webSearchCount(null)).toBe(0);
  });
});

describe("formatSourcesBlock", () => {
  it("renders a numbered markdown list, or nothing", () => {
    expect(formatSourcesBlock([])).toBe("");
    expect(formatSourcesBlock([{ url: "https://a.com", title: "A [beta]" }])).toBe(
      "\n\n**Sources**\n1. [A beta](https://a.com)\n",
    );
  });
});
