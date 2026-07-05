// Tests for the trust budget / prioritizer — the make-or-break stage.
import { prioritize, compositePriority, type ScoredInput } from "./prioritize";
import { TRUST_BUDGET } from "./config";
import type { Hub } from "@/lib/supabase/database.types";
import type { ProactiveCandidate } from "./types";
import type { GateTier } from "@/lib/gates";

function candidate(hub: Hub, subjectId: string): ProactiveCandidate {
  return {
    signal: {
      triggerKey: "cold_lp",
      hub,
      signalClass: "market",
      subjectType: "investor",
      subjectId,
      subjectName: `LP ${subjectId}`,
      summary: "went cold",
      occurredAt: new Date().toISOString(),
      baseConfidence: 60,
      baseUrgency: 60,
      metadata: {},
    },
    sendAction: "send_outreach",
    claims: [],
    objective: "draft",
    title: "t",
  };
}

function input(
  hub: Hub,
  id: string,
  urgency: number,
  confidence: number,
  blastRadius: GateTier = 2,
  learnedWeight = 1,
): ScoredInput {
  return { candidate: candidate(hub, id), urgency, confidence, blastRadius, learnedWeight };
}

describe("compositePriority", () => {
  it("is multiplicative — needs both urgency AND confidence", () => {
    expect(compositePriority(input("source", "a", 80, 80))).toBe(64);
    // urgent but unfounded scores low
    expect(compositePriority(input("source", "b", 90, 20))).toBe(18);
    // certain but not urgent scores low
    expect(compositePriority(input("source", "c", 20, 90))).toBe(18);
  });

  it("discounts higher blast radius (Tier 3 must be surer to clear the bar)", () => {
    const t2 = compositePriority(input("execute", "a", 80, 80, 2));
    const t3 = compositePriority(input("execute", "a", 80, 80, 3));
    expect(t3).toBeLessThan(t2);
  });

  it("folds in the learned weight", () => {
    const neutral = compositePriority(input("source", "a", 80, 80, 2, 1));
    const decayed = compositePriority(input("source", "a", 80, 80, 2, 0.5));
    expect(decayed).toBe(Math.round(neutral * 0.5));
  });
});

describe("prioritize — cutoff", () => {
  it("suppresses (does not queue) anything below its hub cutoff", () => {
    const { surfaced, suppressed } = prioritize([
      input("source", "hi", 80, 80), // 64 ≥ 45 → surfaces
      input("source", "lo", 50, 50), // 25 < 45 → suppressed
    ]);
    expect(surfaced.map((s) => s.candidate.signal.subjectId)).toEqual(["hi"]);
    expect(suppressed.map((s) => s.candidate.signal.subjectId)).toEqual(["lo"]);
    expect(suppressed[0].reason).toMatch(/suppressed/i);
  });

  it("applies per-hub cutoffs (Run tighter than Source)", () => {
    // priority 49: clears Source's 45 but not Run's 60.
    const src = prioritize([input("source", "s", 70, 70)]); // 49
    const run = prioritize([input("run", "r", 70, 70)]); // 49
    expect(src.surfaced).toHaveLength(1);
    expect(run.surfaced).toHaveLength(0);
  });
});

describe("prioritize — budget ceilings", () => {
  it("enforces the per-hub ceiling, keeping the highest-priority items", () => {
    // Source ceiling is 3; feed 5 clearing candidates with distinct scores.
    const inputs = [
      input("source", "1", 90, 90),
      input("source", "2", 88, 88),
      input("source", "3", 86, 86),
      input("source", "4", 84, 84),
      input("source", "5", 82, 82),
    ];
    const { surfaced } = prioritize(inputs);
    expect(surfaced).toHaveLength(TRUST_BUDGET.perHub.source.maxPerPeriod);
    expect(surfaced.map((s) => s.candidate.signal.subjectId)).toEqual(["1", "2", "3"]);
  });

  it("enforces the global ceiling across hubs", () => {
    const inputs: ScoredInput[] = [];
    (["source", "build"] as Hub[]).forEach((h) =>
      [1, 2, 3].forEach((n) => inputs.push(input(h, `${h}${n}`, 90, 90))),
    );
    const { surfaced } = prioritize(inputs);
    expect(surfaced.length).toBeLessThanOrEqual(TRUST_BUDGET.globalMaxPerPeriod);
  });
});

describe("prioritize — PMI effect on ranking", () => {
  it("PMI lifting confidence/urgency moves an item from suppressed to surfaced", () => {
    // Same cold-LP subject; base scores below the Source cutoff, PMI-boosted
    // scores above it. This is PMI's leverage on the prioritizer.
    const base = prioritize([input("source", "x", 55, 55)]); // ~30 < 45
    expect(base.surfaced).toHaveLength(0);

    const boosted = prioritize([input("source", "x", 67, 75)]); // ~50 ≥ 45
    expect(boosted.surfaced).toHaveLength(1);
  });

  it("ranks a PMI-grounded candidate above an ungrounded peer", () => {
    const { ranked } = prioritize([
      input("source", "ungrounded", 60, 55),
      input("source", "grounded", 72, 80), // PMI-boosted urgency + confidence
    ]);
    expect(ranked[0].candidate.signal.subjectId).toBe("grounded");
  });
});
