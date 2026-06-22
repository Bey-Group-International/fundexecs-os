// lib/source-ai.test.ts
// Unit tests for the AI Sourcing engine's pure paths: config, normalization,
// and the deterministic fallbacks used when no model key is present. No network
// or database is touched (ANTHROPIC_API_KEY is unset in the test env).
import {
  generateTargets,
  scorePipeline,
  type SourcingMandate,
  __test,
} from "@/lib/source-ai";

const {
  sourceConfigFor,
  categoryOptions,
  mandateContext,
  normalizeCandidates,
  normalizeScores,
  coerceAction,
  clampScore,
  cleanUrl,
  parseJsonArray,
  fallbackPlan,
  normalizePlan,
  fallbackTriagePlan,
  normalizeTriagePlan,
  SOURCE_ACTIONS,
  tierForAction,
} = __test;

const MANDATE: SourcingMandate = {
  thesisTitle: "US lower-middle-market industrials",
  assetClasses: ["Industrial", "Logistics"],
  geographies: ["Texas", "Southeast US"],
  checkSizeMin: 1_000_000,
  checkSizeMax: 5_000_000,
  targetIrr: 20,
  targetMoic: 2.5,
};

describe("sourceConfigFor", () => {
  it("resolves every Source module and rejects others", () => {
    for (const k of [
      "source/lp_pipeline",
      "source/deal_pipeline",
      "source/debt",
      "source/partners",
      "source/providers",
    ]) {
      expect(sourceConfigFor(k)?.key).toBe(k);
    }
    expect(sourceConfigFor("run/diligence")).toBeNull();
    expect(sourceConfigFor("build/thesis")).toBeNull();
  });

  it("derives category options from the add-row config", () => {
    const cfg = sourceConfigFor("source/lp_pipeline")!;
    const opts = categoryOptions(cfg);
    expect(opts).toContain("family_office");
    expect(opts).toContain("institution");
  });
});

describe("mandateContext", () => {
  it("summarizes an active mandate", () => {
    const ctx = mandateContext(MANDATE);
    expect(ctx).toContain("Industrial");
    expect(ctx).toContain("Texas");
    expect(ctx).toContain("20%");
  });
  it("handles a missing mandate", () => {
    expect(mandateContext(null)).toMatch(/no active thesis/i);
  });
});

describe("clampScore / coerceAction", () => {
  it("clamps scores into 0–100", () => {
    expect(clampScore(140)).toBe(100);
    expect(clampScore(-5)).toBe(0);
    expect(clampScore("abc")).toBe(50);
  });
  it("only allows safe sourcing actions and never a capital-binding one", () => {
    expect(coerceAction("send_outreach")).toBe("send_outreach");
    expect(coerceAction("move_capital")).toBe("research"); // Tier 3 rejected
    for (const a of SOURCE_ACTIONS) expect(tierForAction(a)).toBeLessThan(3);
  });
});

describe("cleanUrl", () => {
  it("keeps well-formed http(s) URLs and rejects the rest", () => {
    expect(cleanUrl("https://acme.com/about")).toBe("https://acme.com/about");
    expect(cleanUrl("http://x.io")).toBe("http://x.io");
    expect(cleanUrl("acme.com")).toBeUndefined();
    expect(cleanUrl("javascript:alert(1)")).toBeUndefined();
    expect(cleanUrl(123)).toBeUndefined();
  });
});

describe("parseJsonArray", () => {
  it("parses a bare JSON array", () => {
    expect(parseJsonArray('[{"name":"A"}]')).toEqual([{ name: "A" }]);
  });
  it("extracts from a ```json fenced block with prose around it", () => {
    const text = 'Here are the results:\n```json\n[{"name":"B"}]\n```\nDone.';
    expect(parseJsonArray(text)).toEqual([{ name: "B" }]);
  });
  it("returns null when no array is present", () => {
    expect(parseJsonArray("no json here")).toBeNull();
    expect(parseJsonArray("{not: an array}")).toBeNull();
  });
});

describe("normalizeCandidates", () => {
  const cfg = sourceConfigFor("source/lp_pipeline")!;
  const opts = categoryOptions(cfg);

  it("keeps a valid sourceUrl and drops an invalid one", () => {
    const out = normalizeCandidates(
      [
        { name: "Cited LP", category: "lp", fitScore: 80, rationale: "x", firstMove: "y", sourceUrl: "https://lp.com" },
        { name: "Bad URL LP", category: "lp", fitScore: 70, rationale: "x", firstMove: "y", sourceUrl: "not-a-url" },
      ],
      cfg,
      opts,
      [],
    );
    expect(out.find((c) => c.name === "Cited LP")?.sourceUrl).toBe("https://lp.com");
    expect(out.find((c) => c.name === "Bad URL LP")?.sourceUrl).toBeUndefined();
  });

  it("coerces an invalid category to a valid enum value", () => {
    const out = normalizeCandidates(
      [{ name: "Acme FO", category: "not_a_type", fitScore: 80, rationale: "x", firstMove: "y" }],
      cfg,
      opts,
      [],
    );
    expect(out).toHaveLength(1);
    expect(opts).toContain(out[0].category);
  });

  it("drops duplicates of existing names and sorts by fit", () => {
    const out = normalizeCandidates(
      [
        { name: "Existing LP", category: "lp", fitScore: 90, rationale: "x", firstMove: "y" },
        { name: "New A", category: "family_office", fitScore: 60, rationale: "x", firstMove: "y" },
        { name: "New B", category: "institution", fitScore: 85, rationale: "x", firstMove: "y" },
      ],
      cfg,
      opts,
      ["Existing LP"],
    );
    expect(out.map((c) => c.name)).toEqual(["New B", "New A"]);
  });
});

describe("generateTargets fallback", () => {
  it("carries the operator query into deterministic candidates when no model key is present", async () => {
    const out = await generateTargets(
      "source/lp_pipeline",
      MANDATE,
      [],
      "family offices that like industrial platforms",
    );

    expect(out.length).toBeGreaterThan(0);
    expect(out[0].rationale).toContain("family offices that like industrial platforms");
  });
});

describe("normalizeScores", () => {
  it("keeps only rows that map to a known id and coerces the action", () => {
    const rows = [
      { id: "a", name: "Alpha", fields: {} },
      { id: "b", name: "Beta", fields: {} },
    ];
    const out = normalizeScores(
      [
        { id: "a", fitScore: 70, rationale: "x", action: "send_outreach", actionLabel: "Reach out" },
        { id: "ghost", fitScore: 99, rationale: "x", action: "research", actionLabel: "z" },
        { id: "b", fitScore: 40, rationale: "x", action: "move_capital", actionLabel: "bad" },
      ],
      rows,
    );
    expect(out.map((s) => s.id)).toEqual(["a", "b"]);
    expect(out[1].action).toBe("research"); // move_capital rejected
  });
});

describe("fallbackPlan (Earn planner, no API key)", () => {
  it("routes keywords to the matching modules with the owning agent", () => {
    const plan = fallbackPlan("Find lenders and co-GPs for the strategy");
    const modules = plan.steps.map((s) => s.module);
    expect(modules).toContain("source/debt");
    expect(modules).toContain("source/partners");
    expect(plan.steps.find((s) => s.module === "source/debt")?.agent).toBe("capital_connector");
  });

  it("defaults to the two pipelines when nothing matches", () => {
    const plan = fallbackPlan("hello there");
    expect(plan.steps.map((s) => s.module)).toEqual(["source/lp_pipeline", "source/deal_pipeline"]);
  });

  it("caps at four steps", () => {
    const plan = fallbackPlan("lp investor deal target lender debt partner co-gp legal audit provider");
    expect(plan.steps.length).toBeLessThanOrEqual(4);
  });
});

describe("normalizePlan", () => {
  it("drops unknown modules, dedupes, and assigns the owning agent", () => {
    const plan = normalizePlan(
      {
        summary: "Test",
        steps: [
          { module: "source/lp_pipeline", title: "LPs", query: "q" },
          { module: "source/lp_pipeline", title: "dupe", query: "q" },
          { module: "nope/bad", title: "x", query: "q" },
          { module: "source/providers", title: "Bench", query: "q" },
        ],
      } as never,
      "fallback prompt",
    );
    expect(plan.steps.map((s) => s.module)).toEqual(["source/lp_pipeline", "source/providers"]);
    expect(plan.steps[0].agent).toBe("capital_raiser");
  });

  it("falls back when no valid steps remain", () => {
    const plan = normalizePlan({ summary: "x", steps: [{ module: "bad", title: "t", query: "q" }] } as never, "find LPs");
    expect(plan.steps.length).toBeGreaterThan(0);
  });
});

describe("fallbackTriagePlan (Earn triage planner, no API key)", () => {
  it("routes keywords to the matching modules", () => {
    const plan = fallbackTriagePlan("Which LPs should I chase this week?");
    expect(plan.modules).toContain("source/lp_pipeline");
  });

  it("maps bench/dormant language to partners", () => {
    const plan = fallbackTriagePlan("Who in my bench is dormant?");
    expect(plan.modules).toContain("source/partners");
  });

  it("defaults to the two pipelines when nothing matches", () => {
    const plan = fallbackTriagePlan("hello there");
    expect(plan.modules).toEqual(["source/lp_pipeline", "source/deal_pipeline"]);
  });

  it("caps at four modules", () => {
    const plan = fallbackTriagePlan("lp investor deal target lender debt partner co-gp legal audit provider");
    expect(plan.modules.length).toBeLessThanOrEqual(4);
  });
});

describe("normalizeTriagePlan", () => {
  it("drops unknown modules and dedupes", () => {
    const plan = normalizeTriagePlan(
      {
        summary: "Test",
        modules: ["source/lp_pipeline", "source/lp_pipeline", "nope/bad", "source/providers"],
      } as never,
      "fallback prompt",
    );
    expect(plan.modules).toEqual(["source/lp_pipeline", "source/providers"]);
  });

  it("falls back when no valid modules remain", () => {
    const plan = normalizeTriagePlan({ summary: "x", modules: ["bad"] } as never, "triage LPs");
    expect(plan.modules.length).toBeGreaterThan(0);
    expect(plan.modules).toContain("source/lp_pipeline");
  });

  it("falls back when modules is missing", () => {
    const plan = normalizeTriagePlan({ summary: "x" } as never, "triage deals");
    expect(plan.modules.length).toBeGreaterThan(0);
  });
});

describe("generateTargets (fallback, no API key)", () => {
  it("produces mandate-shaped archetypes for every Source module", async () => {
    for (const k of [
      "source/lp_pipeline",
      "source/deal_pipeline",
      "source/debt",
      "source/partners",
      "source/providers",
    ]) {
      const out = await generateTargets(k, MANDATE, []);
      expect(out.length).toBeGreaterThan(0);
      for (const c of out) {
        expect(c.name).toBeTruthy();
        expect(c.fitScore).toBeGreaterThanOrEqual(0);
        expect(c.fitScore).toBeLessThanOrEqual(100);
      }
    }
  });

  it("returns nothing for a non-Source module", async () => {
    expect(await generateTargets("run/diligence", MANDATE, [])).toEqual([]);
  });

  it("respects existing names", async () => {
    const first = await generateTargets("source/lp_pipeline", MANDATE, []);
    const excluded = first[0]?.name;
    const second = await generateTargets("source/lp_pipeline", MANDATE, [excluded]);
    expect(second.map((c) => c.name)).not.toContain(excluded);
  });
});

describe("scorePipeline (fallback, no API key)", () => {
  it("scores LPs by temperature with a sensible next action", async () => {
    const scores = await scorePipeline("source/lp_pipeline", MANDATE, [
      { id: "1", name: "Cold LP", fields: { pipeline_stage: "prospect" } },
      { id: "2", name: "Hot LP", fields: { pipeline_stage: "committed" } },
    ]);
    const hot = scores.find((s) => s.id === "2")!;
    const cold = scores.find((s) => s.id === "1")!;
    expect(hot.fitScore).toBeGreaterThan(cold.fitScore);
    expect(cold.action).toBe("research");
    // Ranked best-first.
    expect(scores[0].id).toBe("2");
  });

  it("returns empty for no rows", async () => {
    expect(await scorePipeline("source/partners", MANDATE, [])).toEqual([]);
  });
});
