// lib/execute-war-room.test.ts
// Unit tests for the pure helpers behind the per-asset war room. No database is
// hit — all inputs are small in-memory fixtures. We deliberately avoid importing
// getAssetWarRoom here: it pulls in server-only Supabase wiring (cookies) that
// isn't available under jest.
import {
  assetMoic,
  unrealizedGain,
  assetLifecycleStage,
  formatCompactCurrency,
  deploymentNote,
  assetNextActions,
} from "@/lib/execute-war-room";
import type { Asset } from "@/lib/supabase/database.types";

// --- Fixtures ---------------------------------------------------------------
function makeAsset(overrides: Partial<Asset> = {}): Asset {
  return {
    id: "asset-1",
    organization_id: "org-1",
    deal_id: null,
    fund_id: null,
    name: "Maple Logistics Park",
    asset_type: "real_estate",
    acquisition_date: "2025-03-01",
    acquisition_cost: 1_000_000,
    current_value: 1_500_000,
    noi: 80_000,
    cap_rate: 5.5,
    status: "owned",
    session_id: null,
    created_at: "2025-03-01T00:00:00Z",
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

// --- assetMoic --------------------------------------------------------------
describe("assetMoic", () => {
  it("computes current value over cost, rounded to 2dp", () => {
    expect(assetMoic(1_000_000, 1_500_000)).toBe(1.5);
    expect(assetMoic(3, 10)).toBe(3.33);
  });

  it("is null when cost is zero or negative (no divide-by-zero)", () => {
    expect(assetMoic(0, 1_000_000)).toBeNull();
    expect(assetMoic(-100, 1_000_000)).toBeNull();
  });

  it("is null when either side is missing", () => {
    expect(assetMoic(null, 1_000_000)).toBeNull();
    expect(assetMoic(1_000_000, null)).toBeNull();
    expect(assetMoic(undefined, undefined)).toBeNull();
  });
});

// --- unrealizedGain ---------------------------------------------------------
describe("unrealizedGain", () => {
  it("is mark minus basis, and can go negative", () => {
    expect(unrealizedGain(1_000_000, 1_500_000)).toBe(500_000);
    expect(unrealizedGain(1_000_000, 700_000)).toBe(-300_000);
  });

  it("distinguishes a real $0 gain from an unknown one", () => {
    expect(unrealizedGain(1_000_000, 1_000_000)).toBe(0);
    expect(unrealizedGain(null, 1_000_000)).toBeNull();
    expect(unrealizedGain(1_000_000, undefined)).toBeNull();
  });
});

// --- assetLifecycleStage ----------------------------------------------------
describe("assetLifecycleStage", () => {
  it("is exited for any realized status", () => {
    expect(assetLifecycleStage(makeAsset({ status: "exited" }))).toBe("exited");
    expect(assetLifecycleStage(makeAsset({ status: "sold" }))).toBe("exited");
    expect(assetLifecycleStage(makeAsset({ status: "written_off" }))).toBe("exited");
  });

  it("is held when there is an acquisition date or cost basis", () => {
    expect(assetLifecycleStage(makeAsset({ status: "owned" }))).toBe("held");
    expect(
      assetLifecycleStage(makeAsset({ acquisition_date: null, acquisition_cost: 500_000 })),
    ).toBe("held");
  });

  it("is pre_acquisition with neither date nor basis and a non-exited status", () => {
    expect(
      assetLifecycleStage(
        makeAsset({ status: "pending", acquisition_date: null, acquisition_cost: null }),
      ),
    ).toBe("pre_acquisition");
  });
});

// --- formatCompactCurrency --------------------------------------------------
describe("formatCompactCurrency", () => {
  it("formats across magnitudes and trims trailing .0", () => {
    expect(formatCompactCurrency(2_400_000_000)).toBe("$2.4B");
    expect(formatCompactCurrency(1_500_000)).toBe("$1.5M");
    expect(formatCompactCurrency(2_000_000)).toBe("$2M");
    expect(formatCompactCurrency(850_000)).toBe("$850K");
    expect(formatCompactCurrency(420)).toBe("$420");
  });

  it("handles sign and nullish input", () => {
    expect(formatCompactCurrency(-300_000)).toBe("-$300K");
    expect(formatCompactCurrency(null)).toBe("$0");
    expect(formatCompactCurrency(undefined)).toBe("$0");
  });
});

// --- deploymentNote ---------------------------------------------------------
describe("deploymentNote", () => {
  it("reports basis, mark, and direction of the gain", () => {
    expect(deploymentNote(makeAsset({ acquisition_cost: 1_000_000, current_value: 1_500_000 }))).toContain(
      "up $500K",
    );
    expect(deploymentNote(makeAsset({ acquisition_cost: 1_000_000, current_value: 700_000 }))).toContain(
      "down $300K",
    );
  });

  it("calls out a missing mark or missing basis", () => {
    expect(deploymentNote(makeAsset({ current_value: null }))).toContain("not yet marked");
    expect(deploymentNote(makeAsset({ acquisition_cost: null, current_value: 900_000 }))).toContain(
      "no acquisition basis",
    );
  });
});

// --- assetNextActions -------------------------------------------------------
describe("assetNextActions", () => {
  it("a fully-marked held asset surfaces the exit-planning move", () => {
    const asset = makeAsset();
    const actions = assetNextActions(asset, "held", true);
    expect(actions.some((a) => a.key === "plan_exit")).toBe(true);
  });

  it("an unmarked held asset is told to mark it first", () => {
    const asset = makeAsset({ current_value: null });
    const actions = assetNextActions(asset, "held", true);
    expect(actions[0]?.key).toBe("mark_value");
    expect(actions.some((a) => a.key === "plan_exit")).toBe(false);
  });

  it("a pre-acquisition asset is told to confirm the close", () => {
    const asset = makeAsset({ status: "pending", acquisition_date: null, acquisition_cost: null });
    const actions = assetNextActions(asset, "pre_acquisition", false);
    expect(actions).toHaveLength(1);
    expect(actions[0].key).toBe("confirm_close");
  });

  it("an exited asset is told to record proceeds, and to reconcile when no flows exist", () => {
    const asset = makeAsset({ status: "exited" });
    expect(assetNextActions(asset, "exited", true).map((a) => a.key)).toEqual(["record_exit"]);
    expect(assetNextActions(asset, "exited", false).map((a) => a.key)).toEqual([
      "record_exit",
      "reconcile_flows",
    ]);
  });

  it("prompts for yield metrics when NOI or cap rate is missing", () => {
    const asset = makeAsset({ noi: null, cap_rate: null });
    const actions = assetNextActions(asset, "held", true);
    expect(actions.some((a) => a.key === "set_yield")).toBe(true);
  });
});
