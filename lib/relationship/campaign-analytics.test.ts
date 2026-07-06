// Coverage for the pure campaign-analytics summarizers. Contracts:
//   - deriveStatus reads state from timestamps (a "replied" stop is a reply)
//   - summarizeEnrollments counts by derived status and computes reply rate
//   - buildCampaignAnalytics groups by sequence and sorts by enrollment volume

import {
  deriveStatus,
  summarizeEnrollments,
  buildCampaignAnalytics,
} from "./campaign-analytics";

describe("deriveStatus", () => {
  it("derives active / completed / stopped / replied from timestamps", () => {
    expect(deriveStatus({})).toBe("active");
    expect(deriveStatus({ completed_at: "2026-01-01" })).toBe("completed");
    expect(deriveStatus({ stopped_at: "2026-01-01", stopped_reason: "manual" })).toBe("stopped");
    expect(deriveStatus({ stopped_at: "2026-01-01", stopped_reason: "target replied" })).toBe("replied");
  });
});

describe("summarizeEnrollments", () => {
  it("counts by status and computes reply rate", () => {
    const s = summarizeEnrollments([
      {},
      { completed_at: "x" },
      { stopped_at: "x", stopped_reason: "replied" },
      { stopped_at: "x", stopped_reason: "bounced" },
    ]);
    expect(s.total).toBe(4);
    expect(s.active).toBe(1);
    expect(s.completed).toBe(1);
    expect(s.replied).toBe(1);
    expect(s.stopped).toBe(1);
    expect(s.replyRate).toBe(25);
  });

  it("is safe on an empty set", () => {
    expect(summarizeEnrollments([]).replyRate).toBe(0);
  });
});

describe("buildCampaignAnalytics", () => {
  it("groups enrollments per sequence and sorts by volume", () => {
    const sequences = [
      { id: "a", name: "Cadence A" },
      { id: "b", name: "Cadence B" },
    ];
    const enrollments = [
      { sequence_id: "a" },
      { sequence_id: "a", stopped_at: "x", stopped_reason: "replied" },
      { sequence_id: "b" },
    ];
    const out = buildCampaignAnalytics(sequences, enrollments);
    expect(out.campaigns[0].id).toBe("a"); // most-enrolled first
    expect(out.campaigns[0].total).toBe(2);
    expect(out.campaigns[0].replied).toBe(1);
    expect(out.totals.total).toBe(3);
  });
});
