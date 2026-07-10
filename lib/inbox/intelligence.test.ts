import {
  computePriority,
  priorityBucket,
  PRIORITY_BUCKETS,
  inboxTab,
  partitionByTab,
  suggestedAction,
  buildDigest,
  fallbackSummary,
  fallbackDraft,
  draftReply,
  type DigestThread,
  type FocusSignals,
} from "./intelligence";

describe("computePriority", () => {
  it("ranks an unread, in-context, urgent booking far above a stale cold message", () => {
    const hot = computePriority({
      category: "booking",
      unread: true,
      hasContext: true,
      ageHours: 1,
      intent: "Wants to sign today",
    });
    const cold = computePriority({
      category: "messaging",
      unread: false,
      hasContext: false,
      ageHours: 200,
      intent: null,
    });
    expect(hot).toBeGreaterThan(cold);
    expect(hot).toBeLessThanOrEqual(100);
    expect(cold).toBeGreaterThanOrEqual(0);
  });

  it("clamps to the 0-100 range even when every bonus stacks", () => {
    const score = computePriority({
      category: "signing",
      unread: true,
      hasContext: true,
      ageHours: 0,
      intent: "urgent wire deadline term sheet",
    });
    expect(score).toBe(100);
  });

  it("gives unread threads a strictly higher score than the same thread read", () => {
    const base = { category: "messaging" as const, hasContext: true, ageHours: 5, intent: null };
    expect(computePriority({ ...base, unread: true })).toBeGreaterThan(
      computePriority({ ...base, unread: false }),
    );
  });
});

describe("priorityBucket", () => {
  it("maps the score ranges to now / soon / later", () => {
    expect(priorityBucket(90)).toBe("now");
    expect(priorityBucket(66)).toBe("now");
    expect(priorityBucket(50)).toBe("soon");
    expect(priorityBucket(33)).toBe("soon");
    expect(priorityBucket(10)).toBe("later");
  });

  it("every bucket has presentation metadata", () => {
    for (const key of ["now", "soon", "later"] as const) {
      expect(PRIORITY_BUCKETS[key].label).toBeTruthy();
    }
  });
});

describe("inboxTab", () => {
  const base: FocusSignals = { priority: 10, unread: false, hasContext: false };

  it("focuses anything ranked above the 'later' bucket", () => {
    expect(inboxTab({ ...base, priority: 66 })).toBe("focused"); // now
    expect(inboxTab({ ...base, priority: 33 })).toBe("focused"); // soon
  });

  it("focuses an unread or in-context thread even when it ranks 'later'", () => {
    expect(inboxTab({ ...base, priority: 10, unread: true })).toBe("focused");
    expect(inboxTab({ ...base, priority: 10, hasContext: true })).toBe("focused");
  });

  it("routes the read, low-priority, unattached remainder to Other", () => {
    expect(inboxTab({ priority: 10, unread: false, hasContext: false })).toBe("other");
  });
});

describe("partitionByTab", () => {
  it("splits into the two tabs and preserves input order within each", () => {
    const items: (FocusSignals & { id: string })[] = [
      { id: "a", priority: 80, unread: false, hasContext: false }, // focused (now)
      { id: "b", priority: 5, unread: false, hasContext: false }, // other
      { id: "c", priority: 5, unread: true, hasContext: false }, // focused (unread)
      { id: "d", priority: 5, unread: false, hasContext: false }, // other
    ];
    const { focused, other } = partitionByTab(items);
    expect(focused.map((i) => i.id)).toEqual(["a", "c"]);
    expect(other.map((i) => i.id)).toEqual(["b", "d"]);
  });
});

describe("suggestedAction", () => {
  it("maps each pillar to its gated next move", () => {
    expect(suggestedAction({ category: "messaging" })?.action).toBe("send_reply");
    expect(suggestedAction({ category: "video" })?.action).toBe("create_video_meeting");
    expect(suggestedAction({ category: "signing" })).toBeNull();
  });

  it("flips booking from propose to confirm once a time is on the table", () => {
    expect(suggestedAction({ category: "booking", meeting_at: null })?.action).toBe(
      "propose_meeting",
    );
    expect(
      suggestedAction({ category: "booking", meeting_at: "2026-07-01T15:00:00Z" })?.action,
    ).toBe("confirm_booking");
  });
});

describe("buildDigest", () => {
  const t = (over: Partial<DigestThread>): DigestThread => ({
    category: "messaging",
    status: "open",
    unread: false,
    priority: 10,
    ...over,
  });

  it("counts open, unread, and needs-you, and only counts open threads by category", () => {
    const digest = buildDigest([
      t({ priority: 80, unread: true }), // now + unread
      t({ category: "booking", priority: 70 }), // now
      t({ priority: 20, unread: true }), // later + unread
      t({ status: "done", priority: 90 }), // closed — excluded everywhere
    ]);
    expect(digest.total).toBe(4);
    expect(digest.open).toBe(3);
    expect(digest.unread).toBe(2);
    expect(digest.needsYou).toBe(2);
    expect(digest.byCategory.find((c) => c.category === "booking")?.count).toBe(1);
    expect(digest.headline).toContain("need");
  });

  it("reports an all-clear when nothing is open", () => {
    const digest = buildDigest([t({ status: "done" }), t({ status: "snoozed" })]);
    expect(digest.open).toBe(0);
    expect(digest.headline.toLowerCase()).toContain("clear");
  });
});

describe("fallbackSummary", () => {
  it("summarizes from the latest inbound message and labels intent by pillar", () => {
    const out = fallbackSummary({
      subject: "Re: Fund II",
      category: "booking",
      counterparty: "Acme FO",
      messages: [
        { direction: "outbound", body: "Sharing our deck." },
        { direction: "inbound", body: "Can we find 30 minutes next week?" },
      ],
    });
    expect(out.summary).toContain("Acme FO");
    expect(out.summary).toContain("30 minutes");
    expect(out.intent).toBe("Wants to schedule");
  });
});

describe("fallbackDraft", () => {
  it("opens by naming the counterparty when known and only commits to a follow-up", () => {
    const draft = fallbackDraft({
      subject: "Invoice overdue",
      category: "finance",
      counterparty: "Blackpine",
      messages: [{ direction: "inbound", body: "Invoice INV-2043 is past due." }],
    });
    expect(draft).toContain("Blackpine");
    // Never fabricates specifics — commits to reviewing / following up.
    expect(draft.toLowerCase()).toMatch(/review|follow up|next steps/);
  });

  it("stays generic (no name) when the counterparty is unknown", () => {
    const draft = fallbackDraft({
      subject: "Hello",
      category: "messaging",
      counterparty: null,
      messages: [],
    });
    expect(draft.length).toBeGreaterThan(0);
    expect(draft).not.toContain("undefined");
    expect(draft).not.toContain("null");
  });
});

describe("draftReply (offline / no API key)", () => {
  const prev = process.env.ANTHROPIC_API_KEY;
  beforeAll(() => {
    delete process.env.ANTHROPIC_API_KEY;
  });
  afterAll(() => {
    if (prev !== undefined) process.env.ANTHROPIC_API_KEY = prev;
  });

  it("returns the deterministic fallback draft with live=false and no network", async () => {
    const input = {
      subject: "Re: Fund II — allocation",
      category: "messaging" as const,
      counterparty: "Acme FO",
      messages: [{ direction: "inbound" as const, body: "Can you confirm the minimum?" }],
    };
    const out = await draftReply(input);
    expect(out.live).toBe(false);
    expect(out.draft).toBe(fallbackDraft(input));
  });
});
