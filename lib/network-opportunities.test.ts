import {
  buildOpportunityPatch,
  resolveStageTransition,
  weightedAmount,
  STAGE_DEFAULT_PROBABILITY,
  type OpportunityStage,
  type OpportunityStatus,
} from "@/lib/network-opportunities";
import type { FieldDef } from "@/lib/network-fields";

const NOW = new Date("2026-09-19T12:00:00.000Z");

function current(over: Partial<{
  stage: OpportunityStage;
  status: OpportunityStatus;
  probability: number;
  closedAt: string | null;
  custom: Record<string, unknown>;
}> = {}) {
  return {
    stage: "diligence" as OpportunityStage,
    status: "open" as OpportunityStatus,
    probability: 40,
    closedAt: null,
    custom: {},
    ...over,
  };
}

describe("weightedAmount", () => {
  it("discounts the target by the odds", () => {
    expect(weightedAmount(10_000_000, 40)).toBe(4_000_000);
    expect(weightedAmount(10_000_000, 0)).toBe(0);
    expect(weightedAmount(10_000_000, 100)).toBe(10_000_000);
  });

  it("is zero when there is no target size", () => {
    expect(weightedAmount(null, 50)).toBe(0);
    expect(weightedAmount(0, 50)).toBe(0);
  });
});

describe("resolveStageTransition", () => {
  it("closes a deal moved to committed, and pins it at certain", () => {
    const t = resolveStageTransition("committed", current(), NOW);
    expect(t.status).toBe("won");
    expect(t.probability).toBe(100);
    expect(t.closedAt).toBe(NOW.toISOString());
  });

  it("closes a deal moved to passed, and drops it out of the forecast", () => {
    // Leaving 40% on a lost deal would keep it in the weighted pipeline.
    const t = resolveStageTransition("passed", current(), NOW);
    expect(t.status).toBe("lost");
    expect(t.probability).toBe(0);
    expect(t.closedAt).toBe(NOW.toISOString());
  });

  it("keeps the original close date when a closed deal moves between terminal stages", () => {
    const closedAt = "2026-01-05T00:00:00.000Z";
    const t = resolveStageTransition("passed", current({ status: "won", closedAt }), NOW);
    expect(t.closedAt).toBe(closedAt);
  });

  it("reopens a deal moved back out of a terminal stage", () => {
    const t = resolveStageTransition(
      "diligence",
      current({ stage: "committed", status: "won", probability: 100, closedAt: NOW.toISOString() }),
      NOW,
    );
    expect(t.status).toBe("open");
    expect(t.closedAt).toBeNull();
    // 100 came from closing it, so it must not survive the reopen.
    expect(t.probability).toBe(STAGE_DEFAULT_PROBABILITY.diligence);
  });

  it("does not overwrite a probability someone chose by hand", () => {
    // The deal is open at 65% — a judgement. Moving it must respect that.
    const t = resolveStageTransition("ic_review", current({ probability: 65 }), NOW);
    expect(t.probability).toBeUndefined();
  });
});

describe("buildOpportunityPatch", () => {
  it("returns nothing to do for an empty input", () => {
    const result = buildOpportunityPatch({}, current(), [], NOW);
    expect(result.ok).toBe(true);
    expect(result.patch).toEqual({});
    expect(result.stageChange).toBeNull();
  });

  it("reports a stage change for the timeline", () => {
    const result = buildOpportunityPatch({ stage: "ic_review" }, current(), [], NOW);
    expect(result.stageChange).toEqual({ from: "diligence", to: "ic_review" });
    expect(result.patch.stage).toBe("ic_review");
  });

  it("ignores a stage move to the stage it is already in", () => {
    const result = buildOpportunityPatch({ stage: "diligence" }, current(), [], NOW);
    expect(result.stageChange).toBeNull();
    expect(result.patch).toEqual({});
  });

  it("lets an explicit probability win over the one a stage move inferred", () => {
    const result = buildOpportunityPatch(
      { stage: "ic_review", probability: 75 },
      current({ probability: 0, status: "lost" }),
      [],
      NOW,
    );
    expect(result.patch.probability).toBe(75);
  });

  it("rejects an unknown stage and an out-of-range probability", () => {
    expect(buildOpportunityPatch({ stage: "negotiating" }, current(), [], NOW).ok).toBe(false);
    expect(buildOpportunityPatch({ probability: 150 }, current(), [], NOW).ok).toBe(false);
    expect(buildOpportunityPatch({ probability: -1 }, current(), [], NOW).ok).toBe(false);
  });

  it("parses a typed amount and refuses a negative one", () => {
    expect(buildOpportunityPatch({ targetAmount: "10,000,000" }, current(), [], NOW).patch)
      .toEqual({ target_amount: 10_000_000 });
    expect(buildOpportunityPatch({ targetAmount: null }, current(), [], NOW).patch)
      .toEqual({ target_amount: null });
    expect(buildOpportunityPatch({ targetAmount: "-5" }, current(), [], NOW).ok).toBe(false);
    expect(buildOpportunityPatch({ targetAmount: "ten million" }, current(), [], NOW).ok).toBe(false);
  });

  it("normalises the expected close to a plain day", () => {
    const result = buildOpportunityPatch(
      { expectedClose: "2026-12-31T18:00:00Z" },
      current(),
      [],
      NOW,
    );
    expect(result.patch.expected_close).toBe("2026-12-31");
  });

  it("requires a real currency code", () => {
    expect(buildOpportunityPatch({ currency: "eur" }, current(), [], NOW).patch)
      .toEqual({ currency: "EUR" });
    expect(buildOpportunityPatch({ currency: "dollars" }, current(), [], NOW).ok).toBe(false);
  });

  it("refuses an empty name", () => {
    expect(buildOpportunityPatch({ name: "   " }, current(), [], NOW).ok).toBe(false);
  });

  it("refuses to strip a deal of both counterparties", () => {
    // The database constraint would catch it, but with an opaque error.
    const result = buildOpportunityPatch(
      { contactId: null, investorId: null },
      current(),
      [],
      NOW,
    );
    expect(result.ok).toBe(false);
    expect(result.errors).toContain("A deal needs a contact or an investor.");
  });

  it("validates custom values against the org's definitions", () => {
    const defs: FieldDef[] = [
      {
        id: "f1",
        entity: "opportunity",
        key: "ticket",
        label: "Ticket",
        type: "currency",
        options: [],
        helpText: null,
        required: false,
        position: 0,
      },
    ];
    const good = buildOpportunityPatch({ custom: { ticket: "5,000,000" } }, current(), defs, NOW);
    expect(good.ok).toBe(true);
    expect(good.patch.custom).toEqual({ ticket: 5_000_000 });

    const bad = buildOpportunityPatch({ custom: { ticket: "big" } }, current(), defs, NOW);
    expect(bad.ok).toBe(false);
  });

  it("de-duplicates and bounds tags", () => {
    const result = buildOpportunityPatch(
      { tags: ["lp", "lp", " priority ", ""] },
      current(),
      [],
      NOW,
    );
    expect(result.patch.tags).toEqual(["lp", "priority"]);
  });
});
