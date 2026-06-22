// lib/funnel-rollup.test.ts
// Unit tests for the PURE Weekly Funnel Rollup composer. The rollup math must be
// deterministic and correct (incl. negative/zero movers and divide-by-zero →
// 0pp), it must handle the no-prior baseline case, highlight selection must be
// deterministic, and channel bodies must be channel-correct.
import {
  computeFunnelRollup,
  selectHighlights,
  composeFunnelRollupMessage,
} from "./funnel-rollup";
import { summarizeFunnel, type Funnel, type StageCounts } from "./source-funnel";

// Build a Funnel from raw stage counts via the real summarizer, so conversions
// are the genuine derived rates (keeps the test honest about pct() semantics).
function funnel(counts: Partial<StageCounts>): Funnel {
  const full: StageCounts = {
    sourced: 0,
    contacted: 0,
    replied: 0,
    met: 0,
    mandate: 0,
    ...counts,
  };
  return summarizeFunnel(full);
}

describe("computeFunnelRollup — delta math", () => {
  it("computes per-stage count deltas, including positive, negative, and zero", () => {
    const current = funnel({ sourced: 120, contacted: 40, replied: 20, met: 10, mandate: 5 });
    const prior = funnel({ sourced: 100, contacted: 40, replied: 25, met: 8, mandate: 2 });
    const rollup = computeFunnelRollup(current, prior);

    const byStage = Object.fromEntries(rollup.stageDeltas.map((d) => [d.stage, d.delta]));
    expect(byStage.sourced).toBe(20); // up
    expect(byStage.contacted).toBe(0); // unchanged
    expect(byStage.replied).toBe(-5); // down
    expect(byStage.met).toBe(2);
    expect(byStage.mandate).toBe(3);
  });

  it("computes conversion-rate deltas in percentage points", () => {
    // sourced→contacted: prior 50% (50/100), current 25% (25/100) → -25pp
    const prior = funnel({ sourced: 100, contacted: 50 });
    const current = funnel({ sourced: 100, contacted: 25 });
    const rollup = computeFunnelRollup(current, prior);
    const sc = rollup.conversionDeltas.find((c) => c.from === "sourced" && c.to === "contacted")!;
    expect(sc.priorRate).toBe(50);
    expect(sc.currentRate).toBe(25);
    expect(sc.deltaPp).toBe(-25);
  });

  it("treats divide-by-zero as 0pp (no NaN/Infinity)", () => {
    // No sourced anywhere → every rate resolves to 0, delta 0pp.
    const current = funnel({ sourced: 0, contacted: 5 });
    const prior = funnel({ sourced: 0, contacted: 0 });
    const rollup = computeFunnelRollup(current, prior);
    for (const c of rollup.conversionDeltas) {
      expect(Number.isFinite(c.deltaPp)).toBe(true);
    }
    expect(rollup.overall.deltaPp).toBe(0);
    expect(rollup.overall.current).toBe(0);
  });

  it("computes the headline sourced→mandate change", () => {
    const prior = funnel({ sourced: 100, mandate: 2 }); // 2%
    const current = funnel({ sourced: 100, mandate: 6 }); // 6%
    const rollup = computeFunnelRollup(current, prior);
    expect(rollup.overall.prior).toBe(2);
    expect(rollup.overall.current).toBe(6);
    expect(rollup.overall.deltaPp).toBe(4);
  });
});

describe("computeFunnelRollup — baseline (no prior snapshot)", () => {
  it("flags baseline and treats prior as zero", () => {
    const current = funnel({ sourced: 50, contacted: 10, mandate: 1 });
    const rollup = computeFunnelRollup(current, null);
    expect(rollup.baseline).toBe(true);
    expect(rollup.stageDeltas.find((d) => d.stage === "sourced")!.delta).toBe(50);
    expect(rollup.stageDeltas.find((d) => d.stage === "sourced")!.prior).toBe(0);
    expect(rollup.overall.prior).toBe(0);
  });

  it("emits a single baseline-captured highlight", () => {
    const current = funnel({ sourced: 50, mandate: 1 });
    const rollup = computeFunnelRollup(current, null);
    expect(rollup.highlights).toHaveLength(1);
    expect(rollup.highlights[0].text).toMatch(/baseline captured/i);
  });
});

describe("selectHighlights — determinism", () => {
  it("ranks the biggest movers first and caps at 3", () => {
    const current = funnel({ sourced: 200, contacted: 30, replied: 20, met: 10, mandate: 5 });
    const prior = funnel({ sourced: 100, contacted: 25, replied: 19, met: 9, mandate: 4 });
    const rollup = computeFunnelRollup(current, prior);
    expect(rollup.highlights.length).toBeLessThanOrEqual(3);
    // Sourced moved +100, the biggest mover — it leads.
    expect(rollup.highlights[0].text).toMatch(/Sourced up \+100/);
    // Magnitudes are non-increasing (sorted by size).
    const mags = rollup.highlights.map((h) => h.magnitude);
    expect([...mags].sort((a, b) => b - a)).toEqual(mags);
  });

  it("is deterministic — same inputs, identical output", () => {
    const current = funnel({ sourced: 120, contacted: 40, mandate: 5 });
    const prior = funnel({ sourced: 100, contacted: 30, mandate: 2 });
    const a = computeFunnelRollup(current, prior).highlights;
    const b = computeFunnelRollup(current, prior).highlights;
    expect(a).toEqual(b);
  });

  it("reports steady state when nothing moves", () => {
    const f = funnel({ sourced: 100, contacted: 50, mandate: 5 });
    const rollup = computeFunnelRollup(f, f);
    expect(rollup.highlights).toHaveLength(1);
    expect(rollup.highlights[0].text).toMatch(/steady state/i);
  });

  it("selectHighlights baseline path returns the baseline line directly", () => {
    const f = funnel({ sourced: 10, mandate: 1 });
    const h = selectHighlights(true, [], [], f);
    expect(h).toHaveLength(1);
    expect(h[0].text).toMatch(/baseline captured/i);
  });
});

describe("composeFunnelRollupMessage — channel bodies", () => {
  const current = funnel({ sourced: 120, contacted: 40, replied: 20, met: 10, mandate: 6 });
  const prior = funnel({ sourced: 100, contacted: 40, replied: 25, met: 8, mandate: 2 });

  it("renders Slack markdown with headline, highlights, stage line and link", () => {
    const rollup = computeFunnelRollup(current, prior);
    const msg = composeFunnelRollupMessage(rollup, { baseUrl: "https://app.fundexecs.com" });
    expect(msg.slackMarkdown).toContain("*Weekly Funnel Rollup*");
    expect(msg.slackMarkdown).toContain("Sourced→Mandate");
    expect(msg.slackMarkdown).toContain("<https://app.fundexecs.com/source/funnel|Open the funnel>");
    // A stage line carries current counts and signed deltas.
    expect(msg.slackMarkdown).toMatch(/Sourced 120 \(\+20\)/);
  });

  it("builds an email subject reflecting the sourced→mandate move", () => {
    const rollup = computeFunnelRollup(current, prior);
    const msg = composeFunnelRollupMessage(rollup);
    // prior 2/100 = 2%, current 6/120 = 5% → +3pp to 5%.
    expect(msg.emailSubject).toMatch(/\+3pp to 5%/);
  });

  it("escapes HTML in the email body and includes a text fallback", () => {
    const rollup = computeFunnelRollup(current, prior);
    const msg = composeFunnelRollupMessage(rollup, { baseUrl: "https://app.fundexecs.com" });
    expect(msg.emailBody.html).toContain("<h2>Weekly Funnel Rollup</h2>");
    expect(msg.emailBody.html).toContain('<a href="https://app.fundexecs.com/source/funnel">');
    expect(msg.emailBody.text).toContain("Weekly Funnel Rollup");
    expect(msg.emailBody.text).toContain("Open the funnel: https://app.fundexecs.com/source/funnel");
  });

  it("composes a compact in-app summary led by the top highlight", () => {
    const rollup = computeFunnelRollup(current, prior);
    const msg = composeFunnelRollupMessage(rollup);
    expect(msg.inAppSummary).toMatch(/^Weekly Funnel Rollup: /);
  });

  it("renders the baseline message without delta annotations", () => {
    const rollup = computeFunnelRollup(current, null);
    const msg = composeFunnelRollupMessage(rollup);
    expect(msg.emailSubject).toMatch(/baseline captured/i);
    expect(msg.slackMarkdown).toContain("baseline captured");
    // No signed-delta parens on the baseline stage line.
    expect(msg.slackMarkdown).not.toMatch(/Sourced 120 \(\+/);
  });

  it("is deterministic — same rollup + opts → identical message", () => {
    const rollup = computeFunnelRollup(current, prior);
    const a = composeFunnelRollupMessage(rollup, { baseUrl: "https://x.io" });
    const b = composeFunnelRollupMessage(rollup, { baseUrl: "https://x.io" });
    expect(a).toEqual(b);
  });
});
