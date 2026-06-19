// lib/execute-performance.test.ts
// Unit tests for the pure Execute-hub performance roll-up. No database is hit —
// the fetch (getExecutePerformance) is the only impure wrapper; the math in
// rollupExecutePerformance is exercised here with small in-memory fixtures.
import { rollupExecutePerformance } from "@/lib/execute-performance";
import type { Asset, CapitalEvent, Fund } from "@/lib/supabase/database.types";

// --- Fixtures ---------------------------------------------------------------
function makeAsset(overrides: Partial<Asset> = {}): Asset {
  return {
    id: "asset-1",
    organization_id: "org-1",
    deal_id: null,
    fund_id: null,
    name: "Maple Logistics",
    asset_type: "real_estate",
    acquisition_date: "2024-01-01",
    acquisition_cost: 1_000_000,
    current_value: 1_500_000,
    noi: null,
    cap_rate: null,
    status: "active",
    session_id: null,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

function makeEvent(overrides: Partial<CapitalEvent> = {}): CapitalEvent {
  return {
    id: "ce-1",
    organization_id: "org-1",
    fund_id: "fund-1",
    investor_id: null,
    event_type: "capital_call",
    amount: 1_000_000,
    currency: "USD",
    effective_date: "2024-01-01",
    due_date: null,
    reference: null,
    notes: null,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

function makeFund(overrides: Partial<Fund> = {}): Fund {
  return {
    id: "fund-1",
    organization_id: "org-1",
    name: "Fund I",
    fund_type: "fund",
    vintage_year: 2024,
    target_size: 0,
    committed_capital: 0,
    called_capital: 0,
    distributed_capital: 0,
    currency: "USD",
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

describe("rollupExecutePerformance", () => {
  it("returns an empty, pre-deployment state with no data", () => {
    const p = rollupExecutePerformance([], [], []);
    expect(p.hasData).toBe(false);
    expect(p.nav).toBe(0);
    expect(p.stage.key).toBe("pre");
    expect(p.tvpi).toBeNull();
    expect(p.nextAction?.href).toBe("/execute/asset_management");
  });

  it("sums NAV and cost over held assets only, excluding exited", () => {
    const p = rollupExecutePerformance(
      [
        makeAsset({ id: "a1", acquisition_cost: 1_000_000, current_value: 1_500_000 }),
        makeAsset({ id: "a2", status: "exited", acquisition_cost: 500_000, current_value: 900_000 }),
      ],
      [],
      [],
    );
    expect(p.nav).toBe(1_500_000);
    expect(p.cost).toBe(1_000_000);
    expect(p.unrealizedGain).toBe(500_000);
    expect(p.activeAssets).toBe(1);
    expect(p.exitedAssets).toBe(1);
    expect(p.grossMoic).toBe(1.5);
  });

  it("derives the capital ledger and PE multiples from capital events", () => {
    const p = rollupExecutePerformance(
      [makeAsset({ acquisition_cost: 1_000_000, current_value: 1_200_000 })],
      [
        makeEvent({ id: "c1", event_type: "capital_call", amount: 1_000_000 }),
        makeEvent({ id: "d1", event_type: "distribution", amount: 600_000 }),
      ],
      [],
    );
    expect(p.called).toBe(1_000_000);
    expect(p.distributed).toBe(600_000);
    expect(p.netCashflow).toBe(-400_000);
    expect(p.dpi).toBe(0.6); // 600k / 1M
    expect(p.rvpi).toBe(1.2); // 1.2M / 1M
    expect(p.tvpi).toBe(1.8); // (600k + 1.2M) / 1M
    expect(p.heroLabel).toBe("TVPI");
  });

  it("prefers fund aggregates over the events ledger when present", () => {
    const p = rollupExecutePerformance(
      [makeAsset({ acquisition_cost: 1_000_000, current_value: 1_000_000 })],
      [makeEvent({ event_type: "capital_call", amount: 100 })],
      [makeFund({ committed_capital: 5_000_000, called_capital: 2_000_000, distributed_capital: 500_000 })],
    );
    expect(p.committed).toBe(5_000_000);
    expect(p.called).toBe(2_000_000);
    expect(p.distributed).toBe(500_000);
    expect(p.deploymentPct).toBe(40); // 2M / 5M
  });

  it("falls back to gross MOIC for the hero when there is no capital", () => {
    const p = rollupExecutePerformance(
      [makeAsset({ acquisition_cost: 1_000_000, current_value: 2_000_000 })],
      [],
      [],
    );
    expect(p.tvpi).toBeNull();
    expect(p.heroLabel).toBe("Gross MOIC");
    expect(p.heroMultiple).toBe(2);
  });

  it("advances the lifecycle stage as distributions flow", () => {
    const operating = rollupExecutePerformance([makeAsset()], [], []);
    expect(operating.stage.key).toBe("operating");

    const harvesting = rollupExecutePerformance(
      [makeAsset()],
      [
        makeEvent({ id: "c", event_type: "capital_call", amount: 1_000_000 }),
        makeEvent({ id: "d", event_type: "distribution", amount: 400_000 }),
      ],
      [],
    );
    expect(harvesting.stage.key).toBe("harvesting"); // dpi 0.4

    const realized = rollupExecutePerformance(
      [makeAsset()],
      [
        makeEvent({ id: "c", event_type: "capital_call", amount: 1_000_000 }),
        makeEvent({ id: "d", event_type: "distribution", amount: 1_100_000 }),
      ],
      [],
    );
    expect(realized.stage.key).toBe("realized"); // dpi >= 1
  });

  it("surfaces the strongest held mark as the top asset", () => {
    const p = rollupExecutePerformance(
      [
        makeAsset({ id: "a1", name: "Steady", acquisition_cost: 1_000_000, current_value: 1_100_000 }),
        makeAsset({ id: "a2", name: "Rocket", acquisition_cost: 1_000_000, current_value: 3_000_000 }),
      ],
      [],
      [],
    );
    expect(p.topAsset?.name).toBe("Rocket");
    expect(p.topAsset?.multiple).toBe(3);
  });

  it("flags the next capital call coming due", () => {
    const future = new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10);
    const p = rollupExecutePerformance(
      [makeAsset()],
      [makeEvent({ event_type: "capital_call", amount: 250_000, due_date: future })],
      [],
    );
    expect(p.upcomingCall?.amount).toBe(250_000);
    expect(p.upcomingCall?.date).toBe(future);
  });
});
