// lib/capital-ops.test.ts — pure capital-run allocation, no I/O.
import { planCapitalCall, planDistribution, planRun, type CommitmentLike } from "@/lib/capital-ops";

function c(o: Partial<CommitmentLike> & { id: string }): CommitmentLike {
  return { investor_id: `inv-${o.id}`, committed_amount: 0, called_amount: 0, distributed_amount: 0, ...o };
}

describe("planCapitalCall", () => {
  it("allocates pro-rata by committed capital", () => {
    const plan = planCapitalCall(
      [c({ id: "a", committed_amount: 3_000_000 }), c({ id: "b", committed_amount: 1_000_000 })],
      1_000_000,
    );
    const by = Object.fromEntries(plan.allocations.map((a) => [a.commitmentId, a.allocation]));
    expect(by.a).toBe(750_000); // 75%
    expect(by.b).toBe(250_000); // 25%
    expect(plan.totalAllocated).toBe(1_000_000);
    expect(plan.shortfall).toBe(0);
  });

  it("caps each allocation at the LP's unfunded balance and reports shortfall", () => {
    // b is fully called already → can't take its 25% share; that becomes shortfall.
    const plan = planCapitalCall(
      [
        c({ id: "a", committed_amount: 3_000_000, called_amount: 0 }),
        c({ id: "b", committed_amount: 1_000_000, called_amount: 1_000_000 }),
      ],
      1_000_000,
    );
    const by = Object.fromEntries(plan.allocations.map((a) => [a.commitmentId, a.allocation]));
    expect(by.a).toBe(750_000);
    expect(by.b).toBe(0); // fully funded, nothing callable
    expect(plan.totalAllocated).toBe(750_000);
    expect(plan.shortfall).toBe(250_000);
  });

  it("allocates nothing when there are no commitments", () => {
    const plan = planCapitalCall([], 500_000);
    expect(plan.totalAllocated).toBe(0);
    expect(plan.shortfall).toBe(500_000);
  });
});

describe("planDistribution", () => {
  it("allocates the full amount pro-rata by committed, uncapped", () => {
    const plan = planDistribution(
      [
        c({ id: "a", committed_amount: 2_000_000, called_amount: 2_000_000 }),
        c({ id: "b", committed_amount: 2_000_000, called_amount: 500_000 }),
      ],
      600_000,
    );
    const by = Object.fromEntries(plan.allocations.map((a) => [a.commitmentId, a.allocation]));
    expect(by.a).toBe(300_000);
    expect(by.b).toBe(300_000);
    expect(plan.kind).toBe("distribution");
    expect(plan.totalAllocated).toBe(600_000);
  });
});

describe("planRun", () => {
  it("dispatches by kind", () => {
    const c1 = [c({ id: "a", committed_amount: 1_000_000 })];
    expect(planRun("capital_call", c1, 100).kind).toBe("capital_call");
    expect(planRun("distribution", c1, 100).kind).toBe("distribution");
  });
});
