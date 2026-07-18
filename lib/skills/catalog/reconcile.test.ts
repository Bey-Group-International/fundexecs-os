// Golden tests for the reconcile deterministic core.
import { reconcile, type ReconcileInput } from "./reconcile";
import type { SkillContext } from "@/lib/skills/types";

const ctx: SkillContext = { workspaceId: "org1", principalId: "p1", executive: "fund_admin" };
const run = (input: ReconcileInput) => reconcile.run(input, ctx);

describe("reconcile core", () => {
  it("ties a clean reconciliation with no breaks", () => {
    const r = run({
      accountName: "Operating — Chase 1234",
      statementBalance: 10000,
      ledgerBalance: 10000,
      transactions: [{ description: "Capital contribution", statementAmount: 500, ledgerAmount: 500, matched: true }],
    });
    const o = r.structured;
    expect(o.difference).toBe(0);
    expect(o.reconciled).toBe(true);
    expect(o.breaks).toEqual([]);
    expect(o.totalUnexplained).toBe(0);
    expect(o.matchedCount).toBe(1);
    expect(o.unmatchedCount).toBe(0);
    expect(o.missingFields).toEqual([]);
    expect(o.keyRisks).toEqual([]);
    // The difference is a CALCULATION, never a fact.
    expect(r.sources.find((s) => s.label === "Difference")?.kind).toBe("calculation");
  });

  it("computes the difference and detects breaks (unmatched item + amount mismatch)", () => {
    const r = run({
      accountName: "Operating",
      statementBalance: 10500,
      ledgerBalance: 10000,
      transactions: [
        { description: "Wire in", statementAmount: 500, ledgerAmount: 500, matched: true },
        { description: "Bank fee", statementAmount: -25, ledgerAmount: 0, matched: true },
        { description: "Outstanding check", statementAmount: 0, ledgerAmount: 100, matched: false },
      ],
    });
    const o = r.structured;
    expect(o.difference).toBe(500); // 10500 − 10000
    expect(o.reconciled).toBe(false);
    expect(o.breaks).toHaveLength(2); // Bank fee (mismatch) + Outstanding check (unmatched)
    expect(o.breaks.map((b) => b.description)).toEqual(["Bank fee", "Outstanding check"]);
    expect(o.breaks[0].variance).toBe(-25); // -25 − 0
    expect(o.breaks[1].variance).toBe(-100); // 0 − 100
    expect(o.totalUnexplained).toBe(-125);
    expect(o.matchedCount).toBe(2);
    expect(o.unmatchedCount).toBe(1);
    expect(o.keyRisks).toContain("Statement and ledger do not tie");
    expect(o.keyRisks).toContain("2 unexplained break(s)");
  });

  it("flags missing balances instead of inventing them; difference stays null", () => {
    const r = run({ accountName: "Mystery", statementBalance: 5000 });
    const o = r.structured;
    expect(o.difference).toBeNull();
    expect(o.reconciled).toBe(false);
    expect(o.missingFields).toEqual(["Ledger balance"]);
    expect(o.keyRisks).toContain("Reconciliation not computable — statement balance and/or ledger balance missing.");
    // No "do not tie" risk when the difference is null (null must not be treated as ≠ 0).
    expect(o.keyRisks).not.toContain("Statement and ledger do not tie");
    // Nothing fabricated: no fact source carries a ledger-balance number.
    expect(r.sources.some((s) => s.kind === "fact" && s.label === "Ledger balance")).toBe(false);
    expect(r.completeness).toBe(0.5);
  });

  it("flags both balances when neither is supplied", () => {
    const r = run({});
    const o = r.structured;
    expect(o.difference).toBeNull();
    expect(o.missingFields).toEqual(["Statement balance", "Ledger balance"]);
    expect(r.completeness).toBe(0);
  });

  it("is PREPARATION only — it never posts or closes, and its recommended action says so", () => {
    const r = run({ statementBalance: 100, ledgerBalance: 90 });
    expect(r.structured.recommendedAction).toMatch(/separate authorized action/i);
    // The manifest prohibits the posting/closing actions outright.
    expect(reconcile.manifest.prohibitedActions).toEqual(
      expect.arrayContaining(["post_journal_entry", "post_to_closed_period", "close_period"]),
    );
  });

  it("does not flag a mismatch when only one side of a transaction is present", () => {
    // statementAmount present, ledgerAmount absent, matched not false → not a break.
    const r = run({
      statementBalance: 100,
      ledgerBalance: 100,
      transactions: [{ description: "Deposit in transit", statementAmount: 250, matched: true }],
    });
    expect(r.structured.breaks).toEqual([]);
    expect(r.structured.reconciled).toBe(true);
  });

  it("always produces a recommended next action and a narrative", () => {
    const r = run({});
    expect(r.narrative.length).toBeGreaterThan(0);
    expect(r.structured.recommendedAction.length).toBeGreaterThan(0);
  });
});
