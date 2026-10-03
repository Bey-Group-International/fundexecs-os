import { needsSummary, refreshStaleSummaries } from "./summaries.server";

jest.mock("@/lib/inbox/data", () => ({ refreshThreadSummary: jest.fn() }));

function makeDb(never: unknown[], recent: unknown[]) {
  let call = 0;
  const from = () => {
    const mine = call++ === 0 ? never : recent;
    const chain: Record<string, unknown> = {};
    Object.assign(chain, {
      select: () => chain,
      is: () => chain,
      not: () => chain,
      order: () => chain,
      limit: () => Promise.resolve({ data: mine, error: null }),
    });
    return chain;
  };
  return { from } as never;
}

const t = (id: string, last: string | null, summaryAt: string | null) => ({
  id,
  organization_id: "org-1",
  last_message_at: last,
  ai_summary_at: summaryAt,
});

describe("needsSummary", () => {
  it("is due when the newest message is newer than the summary, or there is none", () => {
    expect(needsSummary(t("a", "2026-10-02T10:00:00Z", null))).toBe(true);
    expect(needsSummary(t("a", "2026-10-02T10:00:00Z", "2026-10-02T09:00:00Z"))).toBe(true);
    expect(needsSummary(t("a", "2026-10-02T10:00:00Z", "2026-10-02T11:00:00Z"))).toBe(false);
    expect(needsSummary(t("a", null, null))).toBe(false);
  });
});

describe("refreshStaleSummaries", () => {
  it("summarises only the changed threads, newest first, within the limit", async () => {
    const refresh = jest.fn(async () => {});
    const db = makeDb(
      [t("never-old", "2026-10-01T00:00:00Z", null), t("never-new", "2026-10-03T00:00:00Z", null)],
      [
        t("stale", "2026-10-02T12:00:00Z", "2026-10-02T08:00:00Z"),
        t("fresh", "2026-10-02T12:00:00Z", "2026-10-02T13:00:00Z"),
      ],
    );
    const r = await refreshStaleSummaries(db, { refresh, limit: 2 });
    expect(r).toEqual({ candidates: 3, summarized: 2 });
    expect(refresh.mock.calls.map((c) => (c as unknown as [string, string])[1]).sort()).toEqual(["never-new", "stale"]);
  });

  it("carries on past a thread that fails", async () => {
    const refresh = jest.fn().mockRejectedValueOnce(new Error("x")).mockResolvedValue(undefined);
    const db = makeDb([t("a", "2026-10-03T00:00:00Z", null), t("b", "2026-10-02T00:00:00Z", null)], []);
    const r = await refreshStaleSummaries(db, { refresh });
    expect(r.summarized).toBe(1);
  });
});
