/**
 * The shared archive clauses.
 *
 * The test that earns this file is the report embed's ordering. Regenerating a
 * report INSERTS a row, so a meeting can have several, and an embed with no order
 * on it hands back an arbitrary one. In a list that shows a stale summary — ugly,
 * and someone notices. In a SEARCH it reads words nobody said any more and misses
 * the ones they did, and nobody notices at all.
 *
 * Asserted by recording the clauses rather than by checking a result, because a
 * query missing its embed order returns perfectly plausible rows.
 */

import { hitScanBound, narrowArchive, reportEmbed } from "./session-archive.server";
import { LIST_PAGE, SEARCH_SCAN } from "./session-archive";

interface Call {
  method: string;
  args: unknown[];
}

/** A builder that records what was asked of it and returns itself. */
function recorder() {
  const calls: Call[] = [];
  const q = {
    eq(column: string, value: unknown) {
      calls.push({ method: "eq", args: [column, value] });
      return q;
    },
    is(column: string, value: unknown) {
      calls.push({ method: "is", args: [column, value] });
      return q;
    },
    order(column: string, opts?: Record<string, unknown>) {
      calls.push({ method: "order", args: [column, opts] });
      return q;
    },
    limit(count: number, opts?: Record<string, unknown>) {
      calls.push({ method: "limit", args: [count, opts] });
      return q;
    },
  };
  return { q, calls };
}

const find = (calls: Call[], method: string) => calls.filter((c) => c.method === method);

describe("narrowArchive", () => {
  it("takes the newest report, not an arbitrary one", () => {
    // THE reason this file exists. A meeting with a regenerated report has two
    // rows; without this order the search reads whichever comes back.
    const { q, calls } = recorder();
    narrowArchive(q, {
      kind: "meeting",
      visibility: { scope: "org", organizationId: "org-1" },
      searching: true,
    });

    const embedOrder = find(calls, "order").find(
      (c) => (c.args[1] as { referencedTable?: string } | undefined)?.referencedTable === "live_meeting_reports",
    );
    expect(embedOrder).toBeDefined();
    expect(embedOrder!.args[0]).toBe("created_at");
    expect((embedOrder!.args[1] as { ascending: boolean }).ascending).toBe(false);

    const embedLimit = find(calls, "limit").find(
      (c) => (c.args[1] as { referencedTable?: string } | undefined)?.referencedTable === "live_meeting_reports",
    );
    expect(embedLimit).toBeDefined();
    expect(embedLimit!.args[0]).toBe(1);
  });

  it("scopes a recorded call to its host and nobody else", () => {
    // A call belongs to whoever recorded it. Sharing this function must not share
    // that rule away.
    const { q, calls } = recorder();
    narrowArchive(q, {
      kind: "one_way",
      visibility: { scope: "host", hostId: "host-1" },
      searching: false,
    });

    expect(find(calls, "eq")).toEqual(
      expect.arrayContaining([
        { method: "eq", args: ["host_id", "host-1"] },
        { method: "eq", args: ["kind", "one_way"] },
      ]),
    );
    // And emphatically NOT by organisation, which would list everyone's calls.
    expect(find(calls, "eq").some((c) => c.args[0] === "organization_id")).toBe(false);
  });

  it("keeps a host's calls inside the organisation they were recorded in", () => {
    // Both clauses, not either: ownership says whose the call is, and the
    // organisation says which of their working contexts it belongs to. Somebody
    // in two organisations should not find one's calls in the other's archive.
    const { q, calls } = recorder();
    narrowArchive(q, {
      kind: "one_way",
      visibility: { scope: "host", hostId: "host-1", organizationId: "org-1" },
      searching: false,
    });

    expect(find(calls, "eq")).toEqual(
      expect.arrayContaining([
        { method: "eq", args: ["host_id", "host-1"] },
        { method: "eq", args: ["organization_id", "org-1"] },
      ]),
    );
  });

  it("still scopes by the host when no organisation is given", () => {
    // The optional half must not become the only half: a missing organisation
    // widens the list to the same person's other work, never to anybody else's.
    const { q, calls } = recorder();
    narrowArchive(q, {
      kind: "one_way",
      visibility: { scope: "host", hostId: "host-1" },
      searching: false,
    });
    expect(find(calls, "eq").some((c) => c.args[0] === "host_id")).toBe(true);
    expect(find(calls, "eq").some((c) => c.args[0] === "organization_id")).toBe(false);
  });

  it("scopes a meeting to its organisation", () => {
    const { q, calls } = recorder();
    narrowArchive(q, {
      kind: "meeting",
      visibility: { scope: "org", organizationId: "org-1" },
      searching: false,
    });

    expect(find(calls, "eq")).toEqual(
      expect.arrayContaining([
        { method: "eq", args: ["organization_id", "org-1"] },
        { method: "eq", args: ["kind", "meeting"] },
      ]),
    );
    expect(find(calls, "eq").some((c) => c.args[0] === "host_id")).toBe(false);
  });

  it("never returns deleted sessions", () => {
    const { q, calls } = recorder();
    narrowArchive(q, { kind: "meeting", visibility: { scope: "org", organizationId: "o" }, searching: false });
    expect(find(calls, "is")).toEqual([{ method: "is", args: ["deleted_at", null] }]);
  });

  it("orders newest first, because that is what a bounded search gets to see", () => {
    const { q, calls } = recorder();
    narrowArchive(q, { kind: "meeting", visibility: { scope: "org", organizationId: "o" }, searching: true });
    const outer = find(calls, "order").find((c) => c.args[1] === undefined || !(c.args[1] as Record<string, unknown>).referencedTable);
    expect(outer!.args[0]).toBe("created_at");
    expect((outer!.args[1] as { ascending: boolean }).ascending).toBe(false);
  });

  it("goes deeper for a search than for a list", () => {
    const list = recorder();
    narrowArchive(list.q, { kind: "meeting", visibility: { scope: "org", organizationId: "o" }, searching: false });
    const search = recorder();
    narrowArchive(search.q, { kind: "meeting", visibility: { scope: "org", organizationId: "o" }, searching: true });

    const outerLimit = (calls: Call[]) =>
      find(calls, "limit").find((c) => c.args[1] === undefined)!.args[0];

    expect(outerLimit(list.calls)).toBe(LIST_PAGE);
    expect(outerLimit(search.calls)).toBe(SEARCH_SCAN);
  });

  it("takes the bounds it is given over the defaults", () => {
    const { q, calls } = recorder();
    narrowArchive(q, {
      kind: "meeting",
      visibility: { scope: "org", organizationId: "o" },
      searching: true,
      scan: 7,
    });
    expect(find(calls, "limit").find((c) => c.args[1] === undefined)!.args[0]).toBe(7);
  });

  it("returns the same builder, so it composes", () => {
    const { q } = recorder();
    expect(narrowArchive(q, { kind: "meeting", visibility: { scope: "org", organizationId: "o" }, searching: false })).toBe(q);
  });
});

describe("hitScanBound", () => {
  it("is true once a search filled its scan", () => {
    expect(hitScanBound(SEARCH_SCAN, { searching: true })).toBe(true);
  });

  it("uses >= so an off-by-one does not claim the whole archive was read", () => {
    expect(hitScanBound(SEARCH_SCAN + 1, { searching: true })).toBe(true);
  });

  it("is false for a search that ran out of sessions before running out of scan", () => {
    expect(hitScanBound(SEARCH_SCAN - 1, { searching: true })).toBe(false);
  });

  it("is never true for a plain list", () => {
    // A first page is not a failure to find things, and saying so would put a
    // "searched only the most recent…" caveat on a page nobody searched.
    expect(hitScanBound(LIST_PAGE, { searching: false })).toBe(false);
    expect(hitScanBound(10_000, { searching: false })).toBe(false);
  });

  it("respects a caller's own scan", () => {
    expect(hitScanBound(7, { searching: true, scan: 7 })).toBe(true);
    expect(hitScanBound(6, { searching: true, scan: 7 })).toBe(false);
  });
});

describe("reportEmbed", () => {
  it("leaves the transcript out of a plain list", () => {
    // Up to 120,000 characters a row, and a list shows the summary. Selecting it
    // anyway moved megabytes nobody looked at.
    expect(reportEmbed(false)).not.toContain("full_transcript");
    expect(reportEmbed(false)).toContain("summary");
  });

  it("reads the transcript only when searching it", () => {
    expect(reportEmbed(true)).toContain("full_transcript");
  });

  it("always carries what a row renders, either way", () => {
    for (const embed of [reportEmbed(true), reportEmbed(false)]) {
      expect(embed).toContain("summary");
      expect(embed).toContain("key_points");
      expect(embed).toContain("action_items");
      // has_transcript, not full_transcript: a generated boolean saying whether
      // the text exists, which is what decides "Regenerate from transcript"
      // without reading the text to find out.
      expect(embed).toContain("has_transcript");
      expect(embed).toContain("created_at");
    }
  });
});
