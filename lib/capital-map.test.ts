// lib/capital-map.test.ts
// Unit tests for the pure helpers behind the Capital Map. No database is hit —
// all inputs are small in-memory fixtures.
import {
  stageToTemperature,
  scoreThesisFit,
  nextActionsFor,
  findIntroPath,
  type Adjacency,
} from "@/lib/capital-map";
import type { Investor, InvestmentThesis } from "@/lib/supabase/database.types";

// --- Fixtures ---------------------------------------------------------------
function makeInvestor(overrides: Partial<Investor> = {}): Investor {
  return {
    id: "inv-1",
    organization_id: "org-1",
    name: "Acme Family Office",
    investor_type: "family_office",
    contact_name: null,
    contact_email: null,
    jurisdiction: null,
    aum: null,
    typical_check_min: null,
    typical_check_max: null,
    notes: null,
    pipeline_stage: "new",
    session_id: null,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    provenance: "manual",
    verification_status: "unverified",
    verified_at: null,
    verified_by: null,
    verification_note: null,
    archived_at: null,
    ...overrides,
  };
}

function makeThesis(overrides: Partial<InvestmentThesis> = {}): InvestmentThesis {
  return {
    id: "thesis-1",
    organization_id: "org-1",
    title: "Active Mandate",
    summary: null,
    asset_classes: [],
    geographies: [],
    check_size_min: null,
    check_size_max: null,
    target_irr: null,
    target_moic: null,
    is_active: true,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

// --- stageToTemperature -----------------------------------------------------
describe("stageToTemperature", () => {
  it.each(["committed", "Closed", "Funded - Q1", "signed LOI"])(
    "maps %s to committed",
    (stage) => {
      expect(stageToTemperature(stage)).toBe("committed");
    },
  );

  it.each(["soft circle", "soft-circle", "In Diligence", "meeting booked", "term sheet", "negotiating"])(
    "maps %s to active",
    (stage) => {
      expect(stageToTemperature(stage)).toBe("active");
    },
  );

  it.each(["contacted", "Engaged", "replied", "warm lead", "intro made"])(
    "maps %s to warm",
    (stage) => {
      expect(stageToTemperature(stage)).toBe("warm");
    },
  );

  it.each(["", "new", "unknown", "prospect"])("maps %s to cold (conservative fallback)", (stage) => {
    expect(stageToTemperature(stage)).toBe("cold");
  });
});

// --- scoreThesisFit ---------------------------------------------------------
describe("scoreThesisFit", () => {
  it("returns null when there is no active thesis", () => {
    expect(scoreThesisFit(makeInvestor(), null)).toBeNull();
  });

  it("awards check-size points when the bands overlap", () => {
    const investor = makeInvestor({ typical_check_min: 1_000_000, typical_check_max: 5_000_000 });
    const thesis = makeThesis({ check_size_min: 2_000_000, check_size_max: 10_000_000 });
    const fit = scoreThesisFit(investor, thesis)!;
    expect(fit.reasons).toContain("Check size fits the mandate band.");
    expect(fit.score).toBeGreaterThanOrEqual(45);
  });

  it("flags a check size outside the band and does not award points for it", () => {
    const investor = makeInvestor({
      investor_type: "other",
      typical_check_min: 50_000,
      typical_check_max: 100_000,
    });
    const thesis = makeThesis({ check_size_min: 2_000_000, check_size_max: 10_000_000 });
    const fit = scoreThesisFit(investor, thesis)!;
    expect(fit.reasons).toContain("Check size sits outside the mandate band.");
    // "other" type scores 0 and no geography → no points at all.
    expect(fit.score).toBe(0);
  });

  it("awards geography points on a jurisdiction match", () => {
    const investor = makeInvestor({ investor_type: "other", jurisdiction: "Texas" });
    const thesis = makeThesis({ geographies: ["United States", "Texas"] });
    const fit = scoreThesisFit(investor, thesis)!;
    expect(fit.score).toBe(30);
    expect(fit.reasons.some((r) => r.includes("target geography"))).toBe(true);
  });

  it("weights investor type — institutions score higher than co-GPs", () => {
    const inst = scoreThesisFit(makeInvestor({ investor_type: "institution" }), makeThesis())!;
    const coGp = scoreThesisFit(makeInvestor({ investor_type: "co_gp" }), makeThesis())!;
    expect(inst.score).toBe(25);
    expect(coGp.score).toBe(12);
    expect(inst.score).toBeGreaterThan(coGp.score);
  });

  it("gives an 'other' investor type no type points", () => {
    const fit = scoreThesisFit(makeInvestor({ investor_type: "other" }), makeThesis())!;
    expect(fit.score).toBe(0);
    expect(fit.reasons).toHaveLength(0);
  });

  it("combines signals and caps the score at 100", () => {
    const investor = makeInvestor({
      investor_type: "institution",
      jurisdiction: "United States",
      typical_check_min: 1_000_000,
      typical_check_max: 20_000_000,
    });
    const thesis = makeThesis({
      check_size_min: 5_000_000,
      check_size_max: 15_000_000,
      geographies: ["United States"],
    });
    const fit = scoreThesisFit(investor, thesis)!;
    // 45 (check) + 30 (geo) + 25 (institution) = 100
    expect(fit.score).toBe(100);
    expect(fit.score).toBeLessThanOrEqual(100);
  });
});

// --- nextActionsFor ---------------------------------------------------------
describe("nextActionsFor", () => {
  it("recommends an LP update and memo for committed investors", () => {
    const actions = nextActionsFor("committed", false);
    expect(actions.map((a) => a.action)).toEqual(["distribute_report", "draft_memo"]);
  });

  it("recommends a diligence pack for active investors", () => {
    const actions = nextActionsFor("active", false);
    expect(actions.map((a) => a.action)).toEqual(["send_diligence_request", "draft_message"]);
  });

  it("recommends outreach for warm investors", () => {
    const actions = nextActionsFor("warm", false);
    expect(actions.map((a) => a.action)).toEqual(["send_outreach", "draft_message"]);
  });

  it("recommends a warm-intro request for cold investors WITH an intro path", () => {
    const actions = nextActionsFor("cold", true);
    expect(actions.map((a) => a.action)).toEqual(["send_intro_request", "research"]);
  });

  it("falls back to research + cold outreach for cold investors WITHOUT an intro path", () => {
    const actions = nextActionsFor("cold", false);
    expect(actions.map((a) => a.action)).toEqual(["research", "draft_message"]);
  });

  it("tags each action with its gate tier", () => {
    const actions = nextActionsFor("active", false);
    const byAction = Object.fromEntries(actions.map((a) => [a.action, a.tier]));
    expect(byAction["send_diligence_request"]).toBe(2); // external
    expect(byAction["draft_message"]).toBe(1); // internal
  });
});

// --- findIntroPath ----------------------------------------------------------
describe("findIntroPath", () => {
  // Build an undirected adjacency map from edge pairs.
  function buildAdjacency(edges: [string, string][]): Adjacency {
    const adj: Adjacency = new Map();
    const link = (a: string, b: string) => {
      if (!adj.has(a)) adj.set(a, new Set());
      if (!adj.has(b)) adj.set(b, new Set());
      adj.get(a)!.add(b);
      adj.get(b)!.add(a);
    };
    for (const [a, b] of edges) link(a, b);
    return adj;
  }

  it("returns null when the target investor is not in the graph", () => {
    const adj = buildAdjacency([["principal:p1", "principal:p2"]]);
    expect(findIntroPath("inv-1", ["principal:p1"], adj, new Map())).toBeNull();
  });

  it("returns null when the target is unreachable from any self node", () => {
    // Two disconnected components.
    const adj = buildAdjacency([
      ["principal:p1", "investor:other"],
      ["principal:stranger", "investor:inv-1"],
    ]);
    expect(findIntroPath("inv-1", ["principal:p1"], adj, new Map())).toBeNull();
  });

  it("finds a path and labels the first hop 'You'", () => {
    const adj = buildAdjacency([
      ["principal:p1", "investor:inv-1"],
    ]);
    const labels = new Map([["investor:inv-1", "Acme FO"]]);
    const path = findIntroPath("inv-1", ["principal:p1"], adj, labels)!;
    expect(path).not.toBeNull();
    expect(path.hops[0]).toBe("You");
    expect(path.hops[path.hops.length - 1]).toBe("Acme FO");
  });

  it("finds the shortest path via BFS when multiple routes exist", () => {
    // Long route p1 -> a -> b -> inv-1 and a short route p1 -> jane -> inv-1.
    const adj = buildAdjacency([
      ["principal:p1", "principal:a"],
      ["principal:a", "principal:b"],
      ["principal:b", "investor:inv-1"],
      ["principal:p1", "principal:jane"],
      ["principal:jane", "investor:inv-1"],
    ]);
    const labels = new Map([
      ["principal:jane", "Jane Partner"],
      ["investor:inv-1", "Acme FO"],
    ]);
    const path = findIntroPath("inv-1", ["principal:p1"], adj, labels)!;
    // Shortest path is You -> Jane Partner -> Acme FO (3 hops, not 4).
    expect(path.hops).toEqual(["You", "Jane Partner", "Acme FO"]);
    expect(path.introducer).toBe("Jane Partner");
  });

  it("returns null when there are no self nodes present in the graph", () => {
    const adj = buildAdjacency([["principal:p1", "investor:inv-1"]]);
    expect(findIntroPath("inv-1", ["principal:absent"], adj, new Map())).toBeNull();
  });
});
