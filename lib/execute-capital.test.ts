// lib/execute-capital.test.ts
// Unit tests for the pure capital-events roll-up. No database is hit.
import { rollupCapitalEvents, directionOf } from "@/lib/execute-capital";
import type { CapitalEvent, Fund } from "@/lib/supabase/database.types";

// Record-provenance fields shared by managed-record tables.
const meta = {
  provenance: "manual",
  verification_status: "unverified",
  verified_at: null,
  verified_by: null,
  verification_note: null,
  archived_at: null,
};

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
    ...meta,
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

describe("directionOf", () => {
  it("classifies flow direction by type", () => {
    expect(directionOf("capital_call")).toBe("in");
    expect(directionOf("contribution")).toBe("in");
    expect(directionOf("distribution")).toBe("out");
    expect(directionOf("return_of_capital")).toBe("out");
    expect(directionOf("fee")).toBe("cost");
    expect(directionOf("carry")).toBe("cost");
  });
});

describe("rollupCapitalEvents", () => {
  it("is empty with no events", () => {
    const s = rollupCapitalEvents([], []);
    expect(s.count).toBe(0);
    expect(s.net).toBe(0);
    expect(s.ledger).toHaveLength(0);
  });

  it("aggregates paid-in vs returned and net to LPs", () => {
    const s = rollupCapitalEvents(
      [
        makeEvent({ id: "a", event_type: "capital_call", amount: 1_000_000 }),
        makeEvent({ id: "b", event_type: "contribution", amount: 200_000 }),
        makeEvent({ id: "c", event_type: "distribution", amount: 500_000 }),
        makeEvent({ id: "d", event_type: "return_of_capital", amount: 300_000 }),
        makeEvent({ id: "e", event_type: "fee", amount: 50_000 }),
        makeEvent({ id: "f", event_type: "carry", amount: 25_000 }),
      ],
      [makeFund()],
    );
    expect(s.called).toBe(1_200_000);
    expect(s.distributed).toBe(800_000);
    expect(s.fees).toBe(50_000);
    expect(s.carry).toBe(25_000);
    expect(s.net).toBe(-400_000);
  });

  it("builds a chronological ledger with a running net and fund names", () => {
    const s = rollupCapitalEvents(
      [
        makeEvent({ id: "later", event_type: "distribution", amount: 600_000, effective_date: "2025-06-01" }),
        makeEvent({ id: "earlier", event_type: "capital_call", amount: 1_000_000, effective_date: "2024-01-01" }),
      ],
      [makeFund()],
    );
    // Ledger is chronological ascending.
    expect(s.ledger[0].event.id).toBe("earlier");
    expect(s.ledger[0].runningNet).toBe(-1_000_000); // call: −
    expect(s.ledger[1].runningNet).toBe(-400_000); // + distribution
    expect(s.ledger[1].fundName).toBe("Fund I");
    expect(s.ledger[1].direction).toBe("out");
  });

  it("surfaces the next capital call coming due", () => {
    const future = new Date(Date.now() + 20 * 86_400_000).toISOString().slice(0, 10);
    const past = new Date(Date.now() - 20 * 86_400_000).toISOString().slice(0, 10);
    const s = rollupCapitalEvents(
      [
        makeEvent({ id: "old", event_type: "capital_call", amount: 100, effective_date: past, due_date: past }),
        makeEvent({ id: "due", event_type: "capital_call", amount: 750_000, effective_date: "2026-01-01", due_date: future }),
      ],
      [makeFund()],
    );
    expect(s.upcoming?.amount).toBe(750_000);
    expect(s.upcoming?.date).toBe(future);
  });

  it("breaks events down by type, largest first", () => {
    const s = rollupCapitalEvents(
      [
        makeEvent({ id: "a", event_type: "capital_call", amount: 1_000_000 }),
        makeEvent({ id: "b", event_type: "distribution", amount: 400_000 }),
        makeEvent({ id: "c", event_type: "distribution", amount: 100_000 }),
      ],
      [],
    );
    expect(s.byType[0]).toMatchObject({ type: "capital_call", count: 1, total: 1_000_000 });
    const dist = s.byType.find((t) => t.type === "distribution")!;
    expect(dist).toMatchObject({ count: 2, total: 500_000 });
  });
});
