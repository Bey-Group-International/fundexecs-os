// Tests for the sensitivity deterministic core. Base deal, worked by hand:
//   EBITDA 10 x 10.0 entry = EV 100; debt 4.0x = 40; equity 60; hold 5 years; growth 10%.
//   Exit EBITDA 10 x 1.1^5 = 16.1; exit multiple tracks entry (10x) -> exit EV 161.0; exit equity 121.
//   MOIC 121 / 60 = 2.0167; IRR = 2.0167^(1/5) - 1 = 15.06%  -> misses the default 20% / 2.5x hurdle.
//   Exit at 12x: EV 193.2, equity 153.2, MOIC 2.5533, IRR 20.62% -> clears.
//   MOIC 2.5x needs exit equity 150 -> exit EV 190 -> exit multiple 190 / 16.1 = 11.80x (MOIC binds before IRR 20%).
import { sensitivity, type SensitivityInput } from "./sensitivity";
import { validate } from "@/lib/skills/validate";
import type { SkillContext } from "@/lib/skills/types";

const ctx: SkillContext = {
  workspaceId: "org1",
  principalId: "p1",
  executive: "analyst",
};

const input: SensitivityInput = {
  dealName: "Acme",
  entryEbitda: 10,
  entryMultiple: 10,
  holdYears: 5,
  leverageMultiple: 4,
  ebitdaGrowthRate: 0.1,
  drivers: [
    { driver: "exitMultiple", values: [8, 10, 12] },
    { driver: "ebitdaGrowthRate", values: [0, 0.1, 0.2] },
    { driver: "entryMultiple", values: [9, 10, 11] },
    { driver: "leverageMultiple", values: [3, 4, 5] },
  ],
  cases: [
    {
      name: "Upside",
      kind: "upside",
      overrides: { exitMultiple: 12, ebitdaGrowthRate: 0.15 },
    },
    {
      name: "Combined downside",
      kind: "downside",
      overrides: { exitMultiple: 8, ebitdaGrowthRate: 0.02 },
    },
  ],
};
const run = (i: SensitivityInput) => sensitivity.run(i, ctx);

describe("sensitivity core", () => {
  it("computes the base from the lbo core and tests it against the (default) hurdle", () => {
    const r = run(input).structured;
    expect(r.base).toMatchObject({
      entryEV: 100,
      entryEquity: 60,
      debt: 40,
      moic: 2.0167,
      verdict: "misses",
    });
    expect(r.base.irr).toBeCloseTo(0.1506, 3);
    expect(r.hurdlesAreDefault).toBe(true);
    expect(r.assumptions.join(" ")).toMatch(/default return hurdles/);
    expect(r.assumptions.join(" ")).toMatch(
      /Exit multiple tracks the entry multiple/,
    );
  });

  it("flexes one driver at a time over the supplied values only, and labels an assumed base value", () => {
    const r = run(input).structured;
    const exit = r.oneWay.find((o) => o.driver === "exitMultiple")!;
    expect(exit.baseValue).toBe(10);
    expect(exit.baseIsAssumed).toBe(true); // no fixed exit multiple supplied
    expect(exit.points.map((p) => p.value)).toEqual([8, 10, 12]);
    expect(exit.points[2]).toMatchObject({ moic: 2.5533, verdict: "clears" });
    expect(exit.points[2].irr).toBeCloseTo(0.2062, 3);
    expect(exit.points[0].verdict).toBe("misses");
    const growth = r.oneWay.find((o) => o.driver === "ebitdaGrowthRate")!;
    expect(growth.baseIsAssumed).toBe(false);
    // 0% growth with exit tracking entry: exit equity 100 - 40 = 60 -> MOIC 1.0
    expect(growth.points[0]).toMatchObject({ moic: 1, verdict: "misses" });
  });

  it("a leverage flex replaces a fixed debt amount for those points, and says so", () => {
    const r = run({ ...input, leverageMultiple: undefined, debtAmount: 40 });
    const lev = r.structured.oneWay.find(
      (o) => o.driver === "leverageMultiple",
    )!;
    expect(lev.baseValue).toBe(4);
    // 5x leverage: debt 50, equity 50, exit equity 161 - 50 = 111 -> MOIC 2.22
    expect(lev.points[2].moic).toBe(2.22);
    expect(r.structured.warnings.join(" ")).toMatch(/fixed debt amount/);
  });

  it("builds a two-way table over the supplied values, defaulting (and labelling) the pairing", () => {
    const r = run(input).structured;
    expect(r.twoWay).toHaveLength(1);
    expect(r.twoWay[0]).toMatchObject({
      rowDriver: "exitMultiple",
      colDriver: "ebitdaGrowthRate",
      defaultPairing: true,
    });
    expect(r.twoWay[0].cells).toHaveLength(3);
    expect(r.twoWay[0].cells[0]).toHaveLength(3);
    expect(r.warnings.join(" ")).toMatch(/paired by default/);
    // cell [12x exit][10% growth] equals the one-way exit 12x point
    expect(r.twoWay[0].cells[2][1].moic).toBe(2.5533);

    const asked = run({
      ...input,
      twoWay: [
        { row: "entryMultiple", col: "exitMultiple" },
        { row: "exitMultiple", col: "exitMultiple" },
        { row: "holdYears", col: "exitMultiple" },
      ],
    });
    expect(
      asked.structured.twoWay.map((t) => [
        t.rowDriver,
        t.colDriver,
        t.defaultPairing,
      ]),
    ).toEqual([["entryMultiple", "exitMultiple", false]]);
    expect(asked.missingData.join(" ")).toMatch(
      /must be different drivers with values/,
    );
  });

  it("runs only the cases supplied, tests a downside against the downside hurdle, and flags a missing combined downside", () => {
    const r = run(input).structured;
    expect(r.cases.map((c) => c.name)).toEqual(["Upside", "Combined downside"]);
    expect(r.cases[0]).toMatchObject({
      kind: "upside",
      testedAgainst: "base hurdle",
      verdict: "clears",
    });
    expect(r.combinedDownsideSupplied).toBe(true);
    expect(r.cases[1]).toMatchObject({
      testedAgainst: "none",
      verdict: "not-tested",
    }); // default hurdles set no downside hurdle
    expect(r.warnings.join(" ")).toMatch(/firm sets no downside hurdle/);

    const firm = run({
      ...input,
      hurdles: {
        base: { irr: 0.2, moic: 2.5 },
        downside: { irr: 0.1, moic: 1.5 },
        holdYears: 5,
      },
    }).structured;
    expect(firm.cases[1]).toMatchObject({
      testedAgainst: "downside hurdle",
      verdict: "misses",
    });
    expect(firm.hurdlesAreDefault).toBe(false);

    const single = run({
      ...input,
      cases: [
        { name: "Soft exit", kind: "downside", overrides: { exitMultiple: 8 } },
      ],
    }).structured;
    expect(single.combinedDownsideSupplied).toBe(false);
    expect(single.warnings.join(" ")).toMatch(/No combined downside/);
    const none = run({ ...input, cases: undefined }).structured;
    expect(none.cases).toEqual([]);
    expect(none.warnings.join(" ")).toMatch(/No named cases supplied/);
  });

  it("solves the exit-multiple break-even against the binding (MOIC) threshold", () => {
    const r = run(input).structured;
    const be = r.breakEvens.find((b) => b.driver === "exitMultiple")!;
    expect(be.direction).toBe("minimum");
    expect(be.breakEvenValue).toBeCloseTo(11.8, 1); // 190 / 16.1
    expect(be.status).toBe("base-misses");
    expect(be.headroom).toBeCloseTo(-1.8, 1);
    expect(be.note).toMatch(/short by/);
    // At the solved value the hurdle is met; a notch below it is not.
    expect(
      run({ ...input, exitMultiple: be.breakEvenValue! }).structured.base
        .verdict,
    ).toBe("clears");
    expect(
      run({ ...input, exitMultiple: be.breakEvenValue! - 0.1 }).structured.base
        .verdict,
    ).toBe("misses");
  });

  it("solves the entry-multiple (maximum) and growth (minimum) break-evens, with room reported in the safe direction", () => {
    const r = run(input).structured;
    const entry = r.breakEvens.find((b) => b.driver === "entryMultiple")!;
    expect(entry.direction).toBe("maximum");
    expect(entry.breakEvenValue!).toBeLessThan(10);
    expect(entry.headroom!).toBeLessThan(0);
    expect(entry.note).toMatch(/tracks entry/);
    expect(
      run({ ...input, entryMultiple: entry.breakEvenValue! }).structured.base
        .verdict,
    ).toBe("clears");
    expect(
      run({ ...input, entryMultiple: entry.breakEvenValue! + 0.1 }).structured
        .base.verdict,
    ).toBe("misses");

    const g = r.breakEvens.find((b) => b.driver === "ebitdaGrowthRate")!;
    expect(g.breakEvenValue!).toBeGreaterThan(0.1);
    expect(
      run({ ...input, ebitdaGrowthRate: g.breakEvenValue! }).structured.base
        .verdict,
    ).toBe("clears");
    expect(
      run({ ...input, ebitdaGrowthRate: g.breakEvenValue! - 0.005 }).structured
        .base.verdict,
    ).toBe("misses");
  });

  it("when the base clears, break-evens show positive room; an easy hurdle is reported as not binding", () => {
    const easy = run({
      ...input,
      hurdles: { base: { irr: 0.1, moic: 1.5 }, holdYears: 5 },
    }).structured;
    expect(easy.base.verdict).toBe("clears");
    const exit = easy.breakEvens.find((b) => b.driver === "exitMultiple")!;
    expect(exit.status).toBe("base-clears");
    expect(exit.headroom!).toBeGreaterThan(0);
    expect(exit.note).toMatch(/room/);

    // All-equity with the exit tracking entry returns 1.61x at any price, so a 0.5x hurdle never binds on price.
    const trivial = run({
      ...input,
      leverageMultiple: undefined,
      hurdles: { base: { moic: 0.5 }, holdYears: 5 },
    }).structured;
    const entry = trivial.breakEvens.find((b) => b.driver === "entryMultiple")!;
    expect(entry).toMatchObject({
      status: "not-binding",
      breakEvenValue: null,
      headroom: null,
    });
  });

  it("a hurdle no value can reach is 'not-reachable', and uncomputable base returns skip the solve", () => {
    const hard = run({
      ...input,
      hurdles: { base: { moic: 500 }, holdYears: 5 },
    }).structured;
    expect(hard.breakEvens.every((b) => b.status === "not-reachable")).toBe(
      true,
    );
    const noEquity = run({ ...input, leverageMultiple: 12 }).structured; // debt 120 > EV 100 -> negative equity
    expect(noEquity.base.irr).toBeNull();
    expect(
      noEquity.breakEvens.every(
        (b) => b.status === "not-tested" && b.breakEvenValue === null,
      ),
    ).toBe(true);
  });

  it("never invents ranges: no drivers is flagged and no one-way or table is produced", () => {
    const r = run({ ...input, drivers: undefined, cases: undefined });
    expect(r.structured.oneWay).toEqual([]);
    expect(r.structured.twoWay).toEqual([]);
    expect(r.missingData.join(" ")).toMatch(/No drivers to flex/);
    // Break-evens need no ranges and are still produced.
    expect(r.structured.breakEvens).toHaveLength(3);
  });

  it("trims and cleans the supplied ranges: duplicates, too many drivers or values, unknown drivers, empty ranges", () => {
    const r = run({
      ...input,
      drivers: [
        { driver: "exitMultiple", values: [1, 2, 3, 4, 5, 6, 7, 8, 9, 9] },
        { driver: "exitMultiple", values: [10] },
        { driver: "holdYears", values: [] },
        { driver: "bogus" as never, values: [1] },
        { driver: "ebitdaGrowthRate", values: [0.05] },
        { driver: "entryMultiple", values: [9] },
        { driver: "leverageMultiple", values: [3] },
        { driver: "transactionFeesPct", values: [0.02] },
        { driver: "holdYears", values: [4] },
      ],
    });
    const s = r.structured;
    expect(s.oneWay[0].points).toHaveLength(7); // capped at 7 values
    expect(s.oneWay.map((o) => o.driver)).toEqual([
      "exitMultiple",
      "ebitdaGrowthRate",
      "entryMultiple",
      "leverageMultiple",
      "transactionFeesPct",
      "holdYears",
    ]);
    expect(s.warnings.join(" ")).toMatch(/listed twice/);
    expect(r.missingData.join(" ")).toMatch(/Hold years has no values to test/);
    expect(r.missingData.join(" ")).toMatch(
      /"bogus" is not one this skill can flex/,
    );
  });

  it("warns when few drivers are flexed or the hold differs from the underwriting hold", () => {
    const r = run({
      ...input,
      drivers: [{ driver: "exitMultiple", values: [10, 12] }],
      hurdles: { base: { irr: 0.2 }, holdYears: 7 },
    }).structured;
    expect(r.warnings.join(" ")).toMatch(/fewer than four/);
    expect(r.warnings.join(" ")).toMatch(/differs from the underwriting hold/);
  });

  it("is deterministic, validates against its schemas, and names the gate", () => {
    const a = run(input);
    expect(JSON.stringify(run(input).structured)).toBe(
      JSON.stringify(a.structured),
    );
    expect(
      validate(a.structured, sensitivity.manifest.outputSchema).valid,
    ).toBe(true);
    expect(validate(input, sensitivity.manifest.inputSchema).valid).toBe(true);
    expect(a.structured.gate).toBe(
      "The IC chooses which case the price rests on. This analysis informs the choice.",
    );
    expect(
      run({ ...input, gateOwner: "Jane Doe, deal partner" }).structured.gate,
    ).toMatch(/^Jane Doe, deal partner chooses/);
    expect(
      a.sources.some(
        (s) => s.kind === "calculation" && /Break-even/.test(s.label),
      ),
    ).toBe(true);
  });
});
