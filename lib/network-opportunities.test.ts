import {
  adjustPipelineSummary,
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

  it("refuses to let an explicit probability outrank a closed stage", () => {
    // Closing a deal at 50% would leave half its size in the weighted forecast
    // forever — the firm would under-report the capital it actually raised.
    const won = buildOpportunityPatch(
      { stage: "committed", probability: 50 },
      current(),
      [],
      NOW,
    );
    expect(won.ok).toBe(true);
    expect(won.patch.status).toBe("won");
    expect(won.patch.probability).toBe(100);

    // And a lost deal held at 80% would keep money in a pipeline nobody works.
    const lost = buildOpportunityPatch(
      { stage: "passed", probability: 80 },
      current(),
      [],
      NOW,
    );
    expect(lost.patch.status).toBe("lost");
    expect(lost.patch.probability).toBe(0);
  });

  it("pins a probability edit on a deal that is ALREADY closed", () => {
    // No stage in the patch, so nothing re-derives it — this is the path that
    // would otherwise reach the database and trip the check constraint.
    const result = buildOpportunityPatch(
      { probability: 50 },
      current({ stage: "committed", status: "won", probability: 100, closedAt: NOW.toISOString() }),
      [],
      NOW,
    );
    expect(result.ok).toBe(true);
    expect(result.patch.probability).toBe(100);
  });

  it("still lets an explicit probability win on an OPEN stage", () => {
    // The pinning must not swallow ordinary forecasting judgement.
    const result = buildOpportunityPatch(
      { stage: "legal", probability: 70 },
      current(),
      [],
      NOW,
    );
    expect(result.patch.probability).toBe(70);
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

  it("rejects non-string text instead of throwing on .slice", () => {
    // These arrive as parsed JSON; a number here used to throw a TypeError and
    // turn a 400 into an unhandled 500.
    for (const field of ["source", "notes", "lostReason"] as const) {
      const result = buildOpportunityPatch({ [field]: 123 }, current(), [], NOW);
      expect(result.ok).toBe(false);
    }
    expect(() => buildOpportunityPatch({ name: 42 }, current(), [], NOW)).not.toThrow();
    expect(buildOpportunityPatch({ name: 42 }, current(), [], NOW).ok).toBe(false);
    expect(() => buildOpportunityPatch({ currency: 5 }, current(), [], NOW)).not.toThrow();
    expect(buildOpportunityPatch({ currency: 5 }, current(), [], NOW).ok).toBe(false);
    expect(buildOpportunityPatch({ expectedClose: 20261231 }, current(), [], NOW).ok).toBe(false);
  });

  it("still accepts null to clear a text field", () => {
    const result = buildOpportunityPatch({ source: null, notes: null }, current(), [], NOW);
    expect(result.ok).toBe(true);
    expect(result.patch).toEqual({ source: null, notes: null });
  });

  it("reports cleared custom keys for the database-side merge", () => {
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
    const result = buildOpportunityPatch(
      { custom: { ticket: null } },
      current({ custom: { ticket: 5 } }),
      defs,
      NOW,
    );
    expect(result.customRemoved).toEqual(["ticket"]);
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

describe("adjustPipelineSummary", () => {
  const base = [
    { stage: "diligence" as const, currency: "USD", dealCount: 40, targetTotal: 400_000_000, weightedTotal: 160_000_000 },
    { stage: "legal" as const, currency: "USD", dealCount: 5, targetTotal: 50_000_000, weightedTotal: 42_500_000 },
  ];

  it("returns the server's rollup untouched when nothing moved", () => {
    expect(adjustPipelineSummary(base, [])).toEqual(base);
  });

  it("keeps totals authoritative for an org past the card cap", () => {
    // This is the whole point: the board holds at most 200 cards, but the org
    // has 40 deals in diligence worth 400M. Moving ONE card must not collapse
    // the header to just the cards on screen.
    const out = adjustPipelineSummary(base, [
      {
        id: "d1",
        fromStage: "diligence",
        toStage: "legal",
        currency: "USD",
        before: { targetAmount: 10_000_000, probability: 40 },
        after: { targetAmount: 10_000_000, probability: 85 },
      },
    ]);
    const dil = out.find((r) => r.stage === "diligence")!;
    const legal = out.find((r) => r.stage === "legal")!;
    expect(dil.dealCount).toBe(39);
    expect(dil.targetTotal).toBe(390_000_000);
    expect(dil.weightedTotal).toBe(156_000_000);
    expect(legal.dealCount).toBe(6);
    expect(legal.targetTotal).toBe(60_000_000);
    expect(legal.weightedTotal).toBe(51_000_000);
  });

  it("never merges two currencies into one number", () => {
    const mixed = [
      ...base,
      { stage: "diligence" as const, currency: "EUR", dealCount: 2, targetTotal: 20_000_000, weightedTotal: 8_000_000 },
    ];
    const out = adjustPipelineSummary(mixed, []);
    const usd = out.find((r) => r.stage === "diligence" && r.currency === "USD")!;
    const eur = out.find((r) => r.stage === "diligence" && r.currency === "EUR")!;
    expect(usd.targetTotal).toBe(400_000_000);
    expect(eur.targetTotal).toBe(20_000_000);
  });

  it("opens a row for a stage the rollup never reported", () => {
    const out = adjustPipelineSummary(base, [
      {
        id: "d1",
        fromStage: "legal",
        toStage: "committed",
        currency: "USD",
        before: { targetAmount: 10_000_000, probability: 85 },
        after: { targetAmount: 10_000_000, probability: 100 },
      },
    ]);
    const committed = out.find((r) => r.stage === "committed")!;
    expect(committed.dealCount).toBe(1);
    expect(committed.weightedTotal).toBe(10_000_000);
  });

  it("ignores a delta that did not change stage", () => {
    expect(
      adjustPipelineSummary(base, [
        {
          id: "d1",
          fromStage: "legal",
          toStage: "legal",
          currency: "USD",
          before: { targetAmount: 1, probability: 1 },
          after: { targetAmount: 999, probability: 99 },
        },
      ]),
    ).toEqual(base);
  });

  it("clamps rather than rendering a negative pipeline", () => {
    // If the base and the deltas ever disagree, a negative total on screen is
    // worse than a slightly stale one.
    const out = adjustPipelineSummary(
      [{ stage: "legal", currency: "USD", dealCount: 0, targetTotal: 0, weightedTotal: 0 }],
      [
        {
          id: "d1",
          fromStage: "legal",
          toStage: "committed",
          currency: "USD",
          before: { targetAmount: 10_000_000, probability: 85 },
          after: { targetAmount: 10_000_000, probability: 100 },
        },
      ],
    );
    expect(out.every((r) => r.dealCount >= 0 && r.targetTotal >= 0)).toBe(true);
  });
});
