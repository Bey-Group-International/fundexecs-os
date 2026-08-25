import {
  DEFAULT_BLOCK_TITLE,
  MAX_BLOCK_MINUTES,
  blocksToBusyIntervals,
  defaultBlockEnd,
  findBlockConflicts,
  serializeBlock,
  validateBlock,
} from "./blocks";

describe("validateBlock", () => {
  const VALID = { title: "Flight", startsAt: "2026-09-01T14:00:00.000Z", endsAt: "2026-09-01T18:00:00.000Z" };

  it("normalizes a good block to ISO instants", () => {
    const r = validateBlock(VALID);
    expect(r).toEqual({
      ok: true,
      title: "Flight",
      startsAt: "2026-09-01T14:00:00.000Z",
      endsAt: "2026-09-01T18:00:00.000Z",
    });
  });

  it("falls back to a default label rather than an empty one", () => {
    const r = validateBlock({ ...VALID, title: "   " });
    expect(r).toMatchObject({ ok: true, title: DEFAULT_BLOCK_TITLE });
  });

  it("rejects a block that ends before it starts", () => {
    const r = validateBlock({ ...VALID, endsAt: "2026-09-01T10:00:00.000Z" });
    expect(r).toEqual({ ok: false, error: "A block has to end after it starts." });
  });

  it("rejects a zero-length block, which would block nothing", () => {
    const r = validateBlock({ ...VALID, endsAt: VALID.startsAt });
    expect(r.ok).toBe(false);
  });

  it("rejects a block shorter than the minimum", () => {
    const r = validateBlock({ ...VALID, endsAt: "2026-09-01T14:01:00.000Z" });
    expect(r).toMatchObject({ ok: false });
    if (!r.ok) expect(r.error).toMatch(/at least/);
  });

  it("rejects a block longer than a day", () => {
    const end = new Date(new Date(VALID.startsAt).getTime() + (MAX_BLOCK_MINUTES + 1) * 60_000).toISOString();
    const r = validateBlock({ ...VALID, endsAt: end });
    expect(r).toMatchObject({ ok: false });
    if (!r.ok) expect(r.error).toMatch(/24 hours/);
  });

  it("rejects unparseable times instead of coercing them", () => {
    expect(validateBlock({ ...VALID, startsAt: "next tuesday" }).ok).toBe(false);
    expect(validateBlock({ ...VALID, endsAt: undefined }).ok).toBe(false);
  });

  it("truncates an overlong label rather than refusing it", () => {
    const r = validateBlock({ ...VALID, title: "x".repeat(500) });
    expect(r).toMatchObject({ ok: true });
    if (r.ok) expect(r.title.length).toBe(120);
  });
});

describe("blocksToBusyIntervals", () => {
  it("maps blocks to intervals and drops the label", () => {
    const out = blocksToBusyIntervals([
      { starts_at: "2026-09-01T14:00:00.000Z", ends_at: "2026-09-01T18:00:00.000Z" },
    ]);
    expect(out).toEqual([{ start: "2026-09-01T14:00:00.000Z", end: "2026-09-01T18:00:00.000Z" }]);
    // An invitee must never learn why a slot is gone.
    expect(JSON.stringify(out)).not.toMatch(/title/);
  });

  it("skips rows that could not block anything", () => {
    expect(
      blocksToBusyIntervals([
        { starts_at: "nonsense", ends_at: "2026-09-01T18:00:00.000Z" },
        { starts_at: "2026-09-01T18:00:00.000Z", ends_at: "2026-09-01T14:00:00.000Z" },
        { starts_at: "2026-09-01T14:00:00.000Z", ends_at: "2026-09-01T14:00:00.000Z" },
      ]),
    ).toEqual([]);
  });
});

describe("findBlockConflicts", () => {
  const BLOCKS = [
    { id: "b1", title: "Flight", starts_at: "2026-09-01T14:00:00.000Z", ends_at: "2026-09-01T18:00:00.000Z" },
  ];

  it("flags a meeting that lands inside a block", () => {
    const out = findBlockConflicts(BLOCKS, "2026-09-01T15:00:00.000Z", "2026-09-01T16:00:00.000Z");
    expect(out).toEqual([
      { id: "b1", title: "Flight", startsAt: "2026-09-01T14:00:00.000Z", endsAt: "2026-09-01T18:00:00.000Z" },
    ]);
  });

  it("flags a meeting that only partly overlaps", () => {
    expect(findBlockConflicts(BLOCKS, "2026-09-01T13:00:00.000Z", "2026-09-01T15:00:00.000Z")).toHaveLength(1);
    expect(findBlockConflicts(BLOCKS, "2026-09-01T17:00:00.000Z", "2026-09-01T19:00:00.000Z")).toHaveLength(1);
  });

  it("treats touching edges as free, not as a conflict", () => {
    // Ends exactly when the block starts.
    expect(findBlockConflicts(BLOCKS, "2026-09-01T13:00:00.000Z", "2026-09-01T14:00:00.000Z")).toEqual([]);
    // Starts exactly when the block ends.
    expect(findBlockConflicts(BLOCKS, "2026-09-01T18:00:00.000Z", "2026-09-01T19:00:00.000Z")).toEqual([]);
  });

  it("ignores a meeting nowhere near the block", () => {
    expect(findBlockConflicts(BLOCKS, "2026-09-02T15:00:00.000Z", "2026-09-02T16:00:00.000Z")).toEqual([]);
  });

  it("returns nothing for an unusable proposed span", () => {
    expect(findBlockConflicts(BLOCKS, "nope", "2026-09-01T16:00:00.000Z")).toEqual([]);
    expect(findBlockConflicts(BLOCKS, "2026-09-01T16:00:00.000Z", "2026-09-01T15:00:00.000Z")).toEqual([]);
  });
});

describe("defaultBlockEnd", () => {
  it("defaults to an hour after the clicked slot", () => {
    const start = new Date(2026, 8, 1, 14, 0).toISOString();
    expect(defaultBlockEnd(start)).toBe(new Date(2026, 8, 1, 15, 0).toISOString());
  });

  it("stops at the end of the day rather than spilling into tomorrow", () => {
    // A 23:30 click must not block the following morning the host never touched.
    const start = new Date(2026, 8, 1, 23, 30).toISOString();
    const end = new Date(defaultBlockEnd(start));
    expect(end.getDate()).toBe(1);
    expect(end.getHours()).toBe(23);
  });

  it("passes an unparseable start straight through", () => {
    expect(defaultBlockEnd("not-a-time")).toBe("not-a-time");
  });
});

describe("serializeBlock", () => {
  it("exposes only what a calendar needs — no user or org id", () => {
    const out = serializeBlock({
      id: "b1",
      user_id: "u1",
      organization_id: "org1",
      title: "Flight",
      starts_at: "2026-09-01T14:00:00.000Z",
      ends_at: "2026-09-01T18:00:00.000Z",
    });
    expect(out).toEqual({
      id: "b1",
      title: "Flight",
      startsAt: "2026-09-01T14:00:00.000Z",
      endsAt: "2026-09-01T18:00:00.000Z",
    });
  });
});
