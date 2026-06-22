import { __test, type RoutingCorrectionRow } from "@/lib/routing-feedback";

const { formatRoutingCorrections } = __test;

function row(
  from: string,
  to: string,
  title: string,
  created_at?: string,
): RoutingCorrectionRow {
  return {
    subject: `${from} → ${to}`,
    metadata: { from_engine: from, to_engine: to, lifecycle_stage: "run", title },
    created_at,
  };
}

describe("formatRoutingCorrections", () => {
  it("returns undefined when there are no corrections", () => {
    expect(formatRoutingCorrections([])).toBeUndefined();
    expect(formatRoutingCorrections(null)).toBeUndefined();
    expect(formatRoutingCorrections(undefined)).toBeUndefined();
  });

  it("returns undefined when no row yields a from→to pair", () => {
    const bad: RoutingCorrectionRow[] = [{ subject: "", metadata: {} }];
    expect(formatRoutingCorrections(bad)).toBeUndefined();
  });

  it("summarizes a single correction with the title", () => {
    const out = formatRoutingCorrections([row("Source", "Run", "Draft the IC memo")]);
    expect(out).toBe(
      'Operator routing corrections to respect: requests like "Draft the IC memo" belong in Run (was mis-routed to Source). Prefer the corrected engine for similar work.',
    );
  });

  it("summarizes multiple distinct corrections", () => {
    const out = formatRoutingCorrections([
      row("Source", "Run", "Draft the IC memo"),
      row("Run", "Execute", "Wire the capital call"),
    ]);
    expect(out).toContain('requests like "Draft the IC memo" belong in Run (was mis-routed to Source)');
    expect(out).toContain('requests like "Wire the capital call" belong in Execute (was mis-routed to Run)');
    expect(out?.startsWith("Operator routing corrections to respect:")).toBe(true);
    expect(out?.endsWith("Prefer the corrected engine for similar work.")).toBe(true);
  });

  it("falls back to a generic phrasing when no title is present", () => {
    const out = formatRoutingCorrections([
      { subject: "Source → Run", metadata: { from_engine: "Source", to_engine: "Run" } },
    ]);
    expect(out).toContain("such requests belong in Run (was mis-routed to Source)");
  });

  it("derives the pair from the subject when metadata is missing", () => {
    const out = formatRoutingCorrections([{ subject: "Source → Execute", metadata: null }]);
    expect(out).toContain("such requests belong in Execute (was mis-routed to Source)");
  });

  it("de-duplicates repeated from→to pairs, keeping the first (newest) seen", () => {
    const out = formatRoutingCorrections([
      row("Source", "Run", "Newest IC memo"),
      row("Source", "Run", "Older IC memo"),
      row("Run", "Execute", "Wire the capital call"),
    ]);
    expect(out).toContain('requests like "Newest IC memo" belong in Run');
    expect(out).not.toContain("Older IC memo");
    expect(out).toContain('requests like "Wire the capital call" belong in Execute');
  });

  it("caps the summary at ~5 distinct corrections", () => {
    const rows: RoutingCorrectionRow[] = [
      row("A", "B", "one"),
      row("C", "D", "two"),
      row("E", "F", "three"),
      row("G", "H", "four"),
      row("I", "J", "five"),
      row("K", "L", "six"),
    ];
    const out = formatRoutingCorrections(rows) ?? "";
    expect(out).toContain('"five"');
    expect(out).not.toContain('"six"');
    // five corrections => four "; " separators
    expect(out.split("; ")).toHaveLength(5);
  });
});
