// lib/valuation-series.test.ts — pure series math, no I/O.
import { assetSeries, portfolioSeries } from "@/lib/valuation-series";

const today = new Date().toISOString().slice(0, 10);

describe("assetSeries", () => {
  it("starts at acquisition cost and walks through marks", () => {
    const s = assetSeries(
      { id: "a", acquisition_date: "2024-01-01", acquisition_cost: 1_000_000, current_value: 1_500_000 },
      [
        { asset_id: "a", as_of: "2024-06-30", value: 1_200_000 },
        { asset_id: "a", as_of: "2024-12-31", value: 1_500_000 },
      ],
    );
    expect(s.map((p) => p.value)).toEqual([1_000_000, 1_200_000, 1_500_000]);
    expect(s[0].date).toBe("2024-01-01");
  });

  it("appends the current value when it differs from the last mark", () => {
    const s = assetSeries(
      { id: "a", acquisition_date: "2024-01-01", acquisition_cost: 1_000_000, current_value: 2_000_000 },
      [{ asset_id: "a", as_of: "2024-06-30", value: 1_200_000 }],
    );
    expect(s[s.length - 1].value).toBe(2_000_000);
    expect(s[s.length - 1].date).toBe(today);
  });

  it("does not duplicate when current value equals the last mark", () => {
    const s = assetSeries(
      { id: "a", acquisition_date: null, acquisition_cost: null, current_value: 1_200_000 },
      [{ asset_id: "a", as_of: "2024-06-30", value: 1_200_000 }],
    );
    expect(s).toHaveLength(1);
    expect(s[0]).toEqual({ date: "2024-06-30", value: 1_200_000 });
  });

  it("yields a single point for an unmarked holding", () => {
    const s = assetSeries({ id: "a", acquisition_date: null, acquisition_cost: null, current_value: 500_000 }, []);
    expect(s).toEqual([{ date: today, value: 500_000 }]);
  });
});

describe("portfolioSeries", () => {
  it("carries each holding's last-known value forward across dates", () => {
    const assets = [
      { id: "a", acquisition_date: "2024-01-01", acquisition_cost: 1_000_000, current_value: 1_000_000 },
      { id: "b", acquisition_date: "2024-06-01", acquisition_cost: 500_000, current_value: 500_000 },
    ];
    const marks = [
      { asset_id: "a", as_of: "2024-12-31", value: 1_400_000 },
    ];
    const s = portfolioSeries(assets, marks);
    // dates: 2024-01-01 (a only), 2024-06-01 (a+b), 2024-12-31 (a marked up + b)
    const byDate = Object.fromEntries(s.map((p) => [p.date, p.value]));
    expect(byDate["2024-01-01"]).toBe(1_000_000);
    expect(byDate["2024-06-01"]).toBe(1_500_000);
    expect(byDate["2024-12-31"]).toBe(1_900_000);
  });

  it("is empty with no holdings", () => {
    expect(portfolioSeries([], [])).toEqual([]);
  });
});
