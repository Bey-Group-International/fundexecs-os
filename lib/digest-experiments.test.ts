// lib/digest-experiments.test.ts
// Unit tests for the PURE subject-line A/B layer — deterministic variant pick,
// variant rendering, and the engagement performance summary (incl. tie-breaking,
// empty state, determinism). No DB, no network, no clock.
import {
  SUBJECT_VARIANTS,
  SUBJECT_LINE_EXPERIMENT,
  SEND_TIME_EXPERIMENT,
  SEND_TIME_VARIANTS,
  findVariant,
  findSendTimeVariant,
  pickVariant,
  pickSendTimeVariant,
  summarizeVariantPerformance,
  summarizeByExperiment,
  type SubjectVariant,
  type SendTimeVariant,
  type SubjectContext,
  type VariantEngagementRow,
  type KeyedVariantEngagementRow,
} from "@/lib/digest-experiments";

const ctx = (over: Partial<SubjectContext> = {}): SubjectContext => ({
  defaultSubject: "Daily Act-now Radar — 3 to act on (top: Acme)",
  count: 3,
  topName: "Acme",
  cadenceLabel: "Daily",
  ...over,
});

describe("variant catalogue", () => {
  it("exposes a stable experiment key", () => {
    expect(SUBJECT_LINE_EXPERIMENT).toBe("subject_line");
  });

  it("has a control variant that renders the default subject unchanged", () => {
    const control = findVariant("control");
    expect(control).toBeDefined();
    expect(control!.render(ctx())).toBe(ctx().defaultSubject);
  });

  it("non-control variants produce a different subject", () => {
    for (const v of SUBJECT_VARIANTS.filter((x) => x.key !== "control")) {
      expect(v.render(ctx())).not.toBe(ctx().defaultSubject);
      expect(v.render(ctx()).length).toBeGreaterThan(0);
    }
  });

  it("every variant has a non-empty empty-state subject", () => {
    for (const v of SUBJECT_VARIANTS) {
      const s = v.render(ctx({ count: 0, topName: null }));
      expect(typeof s).toBe("string");
      expect(s.length).toBeGreaterThan(0);
    }
  });

  it("findVariant returns undefined for an unknown key", () => {
    expect(findVariant("nope")).toBeUndefined();
  });
});

describe("pickVariant", () => {
  it("is deterministic: same (org, period) → same variant", () => {
    const a = pickVariant("org-1", "2026-06-22");
    const b = pickVariant("org-1", "2026-06-22");
    expect(a.key).toBe(b.key);
  });

  it("different periods can reshuffle the assignment over time", () => {
    // Across many periods a single org should see more than one variant — the
    // exposure that makes a winner findable. (Not asserting a specific spread,
    // just that assignment is period-sensitive.)
    const keys = new Set(
      Array.from({ length: 50 }, (_, i) => pickVariant("org-1", `2026-W${i}`).key),
    );
    expect(keys.size).toBeGreaterThan(1);
  });

  it("always returns one of the supplied variants", () => {
    const valid = new Set(SUBJECT_VARIANTS.map((v) => v.key));
    for (let i = 0; i < 20; i++) {
      expect(valid.has(pickVariant(`org-${i}`, "2026-06-22").key)).toBe(true);
    }
  });

  it("respects a custom variant list", () => {
    const only: SubjectVariant[] = [
      { key: "solo", label: "Solo", render: (c) => c.defaultSubject },
    ];
    expect(pickVariant("any", "any", only).key).toBe("solo");
  });

  it("throws on an empty variant list", () => {
    expect(() => pickVariant("org", "period", [])).toThrow();
  });
});

describe("summarizeVariantPerformance", () => {
  it("returns an empty summary with no leader for no rows", () => {
    expect(summarizeVariantPerformance([])).toEqual({ variants: [], leader: null });
  });

  it("computes open/click rates per variant with default sends=1 per row", () => {
    const rows: VariantEngagementRow[] = [
      { variant: "control", opens: 1, clicks: 0 },
      { variant: "control", opens: 0, clicks: 0 },
      { variant: "urgent", opens: 1, clicks: 1 },
      { variant: "urgent", opens: 1, clicks: 0 },
    ];
    const out = summarizeVariantPerformance(rows);
    const control = out.variants.find((v) => v.variant === "control")!;
    const urgent = out.variants.find((v) => v.variant === "urgent")!;
    expect(control.sends).toBe(2);
    expect(control.openRate).toBeCloseTo(0.5);
    expect(control.clickRate).toBe(0);
    expect(urgent.sends).toBe(2);
    expect(urgent.openRate).toBe(1);
    expect(urgent.clickRate).toBeCloseTo(0.5);
    // Higher click rate wins the lead.
    expect(out.leader).toBe("urgent");
  });

  it("honors an explicit sends count for pre-grouped rows", () => {
    const out = summarizeVariantPerformance([
      { variant: "a", sends: 10, opens: 5, clicks: 2 },
    ]);
    expect(out.variants[0].openRate).toBeCloseTo(0.5);
    expect(out.variants[0].clickRate).toBeCloseTo(0.2);
  });

  it("breaks click-rate ties by open rate, then sends, then key", () => {
    // Same click rate (0); open rate decides.
    const out = summarizeVariantPerformance([
      { variant: "low", sends: 2, opens: 0, clicks: 0 },
      { variant: "high", sends: 2, opens: 2, clicks: 0 },
    ]);
    expect(out.leader).toBe("high");

    // Fully tied on rates → key ascending decides, deterministically.
    const tie = summarizeVariantPerformance([
      { variant: "bravo", sends: 1, opens: 1, clicks: 1 },
      { variant: "alpha", sends: 1, opens: 1, clicks: 1 },
    ]);
    expect(tie.leader).toBe("alpha");
  });

  it("is order-independent (deterministic) for the same multiset of rows", () => {
    const rows: VariantEngagementRow[] = [
      { variant: "x", opens: 1, clicks: 1 },
      { variant: "y", opens: 3, clicks: 0 },
      { variant: "x", opens: 0, clicks: 0 },
    ];
    const a = summarizeVariantPerformance(rows);
    const b = summarizeVariantPerformance([...rows].reverse());
    expect(a).toEqual(b);
  });
});

describe("send-time experiment", () => {
  it("exposes a stable, distinct experiment key", () => {
    expect(SEND_TIME_EXPERIMENT).toBe("send_time");
    expect(SEND_TIME_EXPERIMENT).not.toBe(SUBJECT_LINE_EXPERIMENT);
  });

  it("has a small set of non-overlapping hour-of-day windows", () => {
    expect(SEND_TIME_VARIANTS.length).toBeGreaterThan(1);
    for (const v of SEND_TIME_VARIANTS) {
      expect(v.startHour).toBeGreaterThanOrEqual(0);
      expect(v.endHour).toBeGreaterThan(v.startHour);
      expect(v.endHour).toBeLessThanOrEqual(24);
      expect(v.key.length).toBeGreaterThan(0);
      expect(v.label.length).toBeGreaterThan(0);
    }
  });

  it("findSendTimeVariant resolves a known key and rejects unknown", () => {
    expect(findSendTimeVariant("morning")?.key).toBe("morning");
    expect(findSendTimeVariant("nope")).toBeUndefined();
  });

  describe("pickSendTimeVariant", () => {
    it("is deterministic: same (org, period) → same window", () => {
      const a = pickSendTimeVariant("org-1", "2026-06-22");
      const b = pickSendTimeVariant("org-1", "2026-06-22");
      expect(a.key).toBe(b.key);
    });

    it("always returns one of the supplied windows", () => {
      const valid = new Set(SEND_TIME_VARIANTS.map((v) => v.key));
      for (let i = 0; i < 20; i++) {
        expect(valid.has(pickSendTimeVariant(`org-${i}`, "2026-06-22").key)).toBe(true);
      }
    });

    it("reshuffles across periods so an org sees more than one window", () => {
      const keys = new Set(
        Array.from({ length: 50 }, (_, i) => pickSendTimeVariant("org-1", `2026-W${i}`).key),
      );
      expect(keys.size).toBeGreaterThan(1);
    });

    it("is INDEPENDENT of the subject-line pick (different salt)", () => {
      // Over many (org, period) pairs the send-time index and subject index must
      // not be locked together — at least one pair where they disagree proves the
      // two experiments aren't correlated.
      let disagreements = 0;
      for (let i = 0; i < 100; i++) {
        const period = `2026-D${i}`;
        const subjIdx = SUBJECT_VARIANTS.findIndex(
          (v) => v.key === pickVariant("org-x", period).key,
        );
        const timeIdx = SEND_TIME_VARIANTS.findIndex(
          (v) => v.key === pickSendTimeVariant("org-x", period).key,
        );
        if (subjIdx !== timeIdx) disagreements++;
      }
      expect(disagreements).toBeGreaterThan(0);
    });

    it("respects a custom window list and throws on empty", () => {
      const only: SendTimeVariant[] = [
        { key: "solo", label: "Solo", startHour: 9, endHour: 10 },
      ];
      expect(pickSendTimeVariant("any", "any", only).key).toBe("solo");
      expect(() => pickSendTimeVariant("o", "p", [])).toThrow();
    });
  });
});

describe("summarizeByExperiment", () => {
  it("returns an empty map for no rows", () => {
    expect(summarizeByExperiment([])).toEqual({});
  });

  it("summarizes each experiment_key independently from the same stream", () => {
    const rows: KeyedVariantEngagementRow[] = [
      { experimentKey: SUBJECT_LINE_EXPERIMENT, variant: "control", opens: 1, clicks: 0 },
      { experimentKey: SUBJECT_LINE_EXPERIMENT, variant: "urgent", opens: 1, clicks: 1 },
      { experimentKey: SEND_TIME_EXPERIMENT, variant: "morning", opens: 0, clicks: 0 },
      { experimentKey: SEND_TIME_EXPERIMENT, variant: "midday", opens: 1, clicks: 1 },
    ];
    const out = summarizeByExperiment(rows);
    expect(Object.keys(out).sort()).toEqual(
      [SEND_TIME_EXPERIMENT, SUBJECT_LINE_EXPERIMENT].sort(),
    );
    expect(out[SUBJECT_LINE_EXPERIMENT].leader).toBe("urgent");
    expect(out[SEND_TIME_EXPERIMENT].leader).toBe("midday");
    // Buckets don't leak into each other.
    const subjectVariants = new Set(
      out[SUBJECT_LINE_EXPERIMENT].variants.map((v) => v.variant),
    );
    expect(subjectVariants.has("morning")).toBe(false);
  });

  it("is order-independent for the same multiset of rows", () => {
    const rows: KeyedVariantEngagementRow[] = [
      { experimentKey: "send_time", variant: "morning", opens: 2, clicks: 1 },
      { experimentKey: "subject_line", variant: "control", opens: 1, clicks: 0 },
      { experimentKey: "send_time", variant: "morning", opens: 0, clicks: 0 },
    ];
    expect(summarizeByExperiment(rows)).toEqual(
      summarizeByExperiment([...rows].reverse()),
    );
  });
});
