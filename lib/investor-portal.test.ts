// lib/investor-portal.test.ts — pure portal-view summary, no I/O.
import { summarizePortalViews } from "@/lib/investor-portal";

describe("summarizePortalViews", () => {
  it("counts views and tracks the most recent per share", () => {
    const m = summarizePortalViews([
      { share_id: "s1", created_at: "2026-01-01T10:00:00Z" },
      { share_id: "s1", created_at: "2026-03-01T10:00:00Z" },
      { share_id: "s2", created_at: "2026-02-01T10:00:00Z" },
    ]);
    expect(m.get("s1")).toEqual({ count: 2, last: "2026-03-01T10:00:00Z" });
    expect(m.get("s2")).toEqual({ count: 1, last: "2026-02-01T10:00:00Z" });
  });

  it("ignores rows with no share id and returns empty for no views", () => {
    expect(summarizePortalViews([]).size).toBe(0);
    expect(summarizePortalViews([{ share_id: null, created_at: "2026-01-01T10:00:00Z" }]).size).toBe(0);
  });
});
